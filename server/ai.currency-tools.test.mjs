// 隔离环境：必须在导入 db/ai 之前设置 DATA_DIR
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-ai-currency-tools-"));

const { db, setSetting, uid, createAccount, currentMonth } = await import("./db.mjs");
const { postTransaction, postTransfer } = await import("./currency-ledger.mjs");
const { CURRENCY_MIGRATION_LOCK_ERROR } = await import("./currency-state.mjs");
const {
  createSession,
  appendUserMessage,
  confirmPending,
  runAgent,
  classifySql,
  buildSchemaDoc,
  buildSystemPrompt,
  buildSystemPromptWithVision,
  getSessionMessages,
  buildLlmMessages,
} = await import("./ai.mjs");

setSetting("ai_key", "test-key");
setSetting("ai_base_url", "http://mock.local/v1");
setSetting("ai_model", "test-model");
setSetting("ai_require_confirmation", "1");

const MONTH = currentMonth();
const DAY = `${MONTH}-15`;
let lastToolSchemas = null;

function diningCategoryId() {
  return db
    .prepare(
      `SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id
       WHERE g.is_income=0 AND c.hidden=0 ORDER BY g.sort_order, c.sort_order LIMIT 1`
    )
    .get().id;
}

function toolNames() {
  return (lastToolSchemas || []).map((tool) => tool.function?.name);
}

function toolDef(name) {
  return (lastToolSchemas || []).find((tool) => tool.function?.name === name);
}

function dumpToolsAndPrompt(text) {
  return JSON.stringify({ text, tools: lastToolSchemas });
}

function llmText(content) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

function llmTools(calls, extra = {}) {
  const list = Array.isArray(calls) ? calls : [calls];
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: extra.content ?? "",
            reasoning_content: extra.reasoning,
            tool_calls: list.map((call, index) => ({
              id: call.id || `call-${index}-${call.name}`,
              type: "function",
              function: {
                name: call.name,
                arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
              },
            })),
          },
        },
      ],
    }),
  };
}

function stubLlm(sequence) {
  const replies = Array.isArray(sequence) ? sequence : [sequence];
  let i = 0;
  const fetchMock = vi.fn(async (_url, init) => {
    try {
      const body = JSON.parse(init?.body || "{}");
      if (Array.isArray(body.tools)) lastToolSchemas = body.tools;
    } catch {
      /* ignore */
    }
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return typeof reply === "function" ? reply() : reply;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastPending(sessionId) {
  return db
    .prepare(
      `SELECT * FROM chat_messages
       WHERE session_id=? AND resolved=0
         AND (pending_tool IS NOT NULL OR pending_sql IS NOT NULL)
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(sessionId);
}

function lastToolPayload(sessionId) {
  const row = db
    .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
    .get(sessionId);
  return row ? JSON.parse(row.content) : null;
}

function snapshotFinance() {
  return {
    accounts: db.prepare("SELECT id, name, type, currency_code, starting_balance FROM accounts ORDER BY id").all(),
    txs: db.prepare("SELECT id, account_id, amount, category_id, pair_id, original_currency_code, original_amount FROM transactions ORDER BY id").all(),
    assignments: db.prepare("SELECT currency_code, month, category_id, assigned FROM assignments ORDER BY currency_code, month, category_id").all(),
    goals: db.prepare("SELECT currency_code, category_id, type, target FROM goals ORDER BY currency_code, category_id").all(),
    notes: db.prepare("SELECT id, note FROM categories ORDER BY id").all(),
    settings: db.prepare("SELECT key, value FROM settings ORDER BY key").all(),
    fx: db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c,
    migrations: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
  };
}

async function runWrite(name, args, { confirm = true, content = "" } = {}) {
  const prev = getSettingConfirm();
  setSetting("ai_require_confirmation", confirm ? "1" : "0");
  const session = createSession(`tool-${name}-${uid().slice(0, 6)}`);
  appendUserMessage(session.id, `请执行 ${name}`);
  stubLlm([llmTools({ name, arguments: args, id: `call-${name}` }, { content }), llmText("已完成")]);
  const first = await runAgent(session.id);
  let confirmResult = null;
  if (confirm && first.status === "awaiting_confirmation") {
    confirmResult = await confirmPending(session.id, true);
  }
  setSetting("ai_require_confirmation", prev);
  return { session, first, confirmResult, pending: lastPending(session.id), tool: lastToolPayload(session.id) };
}

function getSettingConfirm() {
  return db.prepare("SELECT value FROM settings WHERE key='ai_require_confirmation'").get()?.value ?? "1";
}

function seedLegacySqlPending(sessionId, sql) {
  db.prepare(
    "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)"
  ).run(
    uid(),
    sessionId,
    "assistant",
    "",
    JSON.stringify([{ id: `call-legacy-${uid().slice(0, 6)}`, name: "run_sql", arguments: JSON.stringify({ sql }) }]),
    null,
    sql,
    "历史 SQL 写入",
    0,
    new Date().toISOString()
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSetting("ai_require_confirmation", "1");
  setSetting("currency_migration_status", "complete");
});
beforeAll(() => {
  lastToolSchemas = null;
});

describe("typed finance tools write through the same business Interface", () => {
  it("posts a USD transaction via post_transaction with matching ledger fields", async () => {
    const categoryId = diningCategoryId();
    const webAcc = createAccount({ name: "USD web card", type: "creditCard", currencyCode: "USD", startingBalance: 0 });
    const aiAcc = createAccount({ name: "USD ai card", type: "creditCard", currencyCode: "USD", startingBalance: 0 });
    postTransaction(db, {
      accountId: webAcc,
      date: DAY,
      amount: -2200,
      categoryId,
      payeeName: "Paris cafe",
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2000,
    });

    const { first, confirmResult, tool } = await runWrite("post_transaction", {
      accountId: aiAcc,
      date: DAY,
      amountMinor: -2200,
      categoryId,
      payeeName: "Paris cafe",
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2000,
      purpose: "记录 USD 卡外币消费",
    });
    expect(first.status).toBe("awaiting_confirmation");
    expect(confirmResult.changed).toBe(true);
    expect(tool.ok).toBe(true);
    expect(tool.currencyCode).toBe("USD");
    expect(tool.amountMinor).toBe(-2200);

    const web = db
      .prepare(
        "SELECT amount, category_id, payee_name, original_currency_code, original_amount FROM transactions WHERE account_id=? AND is_start=0"
      )
      .get(webAcc);
    const ai = db
      .prepare(
        "SELECT amount, category_id, payee_name, original_currency_code, original_amount FROM transactions WHERE account_id=? AND is_start=0"
      )
      .get(aiAcc);
    expect(ai).toEqual(web);
    expect(db.prepare("SELECT currency_code FROM accounts WHERE id=?").get(aiAcc).currency_code).toBe("USD");
  });

  it("posts an SGD→CNY transfer atomically with both real amounts and rejects a missing toAmountMinor with zero writes", async () => {
    const sgd = createAccount({ name: "SGD wallet", type: "checking", currencyCode: "SGD", startingBalance: 50000 });
    const cny = createAccount({ name: "CNY wallet", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const fxBefore = db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c;
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c;

    const missing = await runWrite("post_transfer", {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      purpose: "缺到账金额",
    });
    expect(missing.confirmResult.changed).toBe(false);
    expect(missing.tool.ok).toBe(false);
    expect(missing.tool.code).toBe("cross_currency_amount_required");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c).toBe(fxBefore);

    const ok = await runWrite("post_transfer", {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
      memo: "换汇",
    });
    expect(ok.confirmResult.changed).toBe(true);
    const legs = db.prepare("SELECT account_id, amount, pair_id FROM transactions WHERE is_start=0 AND pair_id IS NOT NULL ORDER BY amount").all();
    const pair = legs.filter((row) => row.pair_id === ok.tool.pairId);
    expect(pair).toHaveLength(2);
    expect(pair.map((row) => row.amount).sort((a, b) => a - b)).toEqual([-10000, 55000]);
    expect(db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c).toBe(fxBefore);
  });

  it("creates USD and JPY accounts with currency-aware minor units and rejects catalog/enabled errors", async () => {
    const usd = await runWrite("create_account", {
      name: "USD checking",
      type: "checking",
      currencyCode: "USD",
      startingBalanceMinor: 1234,
    });
    expect(usd.confirmResult.changed).toBe(true);
    const usdRow = db.prepare("SELECT * FROM accounts WHERE name='USD checking'").get();
    expect(usdRow.currency_code).toBe("USD");
    expect(usdRow.starting_balance).toBe(1234);
    expect(usdRow.type).toBe("checking");

    const jpy = await runWrite("create_account", {
      name: "JPY cash",
      type: "cash",
      currencyCode: "JPY",
      startingBalanceMinor: 1234,
    });
    expect(jpy.confirmResult.changed).toBe(true);
    const jpyRow = db.prepare("SELECT * FROM accounts WHERE name='JPY cash'").get();
    expect(jpyRow.currency_code).toBe("JPY");
    expect(jpyRow.starting_balance).toBe(1234);

    const unsupported = await runWrite("create_account", {
      name: "AUD ghost",
      type: "cash",
      currencyCode: "AUD",
      startingBalanceMinor: 100,
    });
    expect(unsupported.confirmResult.changed).toBe(false);
    expect(unsupported.tool.ok).toBe(false);
    expect(unsupported.tool.code).toBe("unsupported_currency");
    expect(db.prepare("SELECT id FROM accounts WHERE name='AUD ghost'").get()).toBeFalsy();

    const disabled = await runWrite("assign_budget", {
      currencyCode: "CAD",
      month: MONTH,
      categoryId: diningCategoryId(),
      assignedMinor: 100,
    });
    expect(disabled.confirmResult.changed).toBe(false);
    expect(disabled.tool.code).toBe("currency_not_enabled");
  });

  it("isolates CNY and SGD assignments and goals by currencyCode", async () => {
    const categoryId = diningCategoryId();
    const cny = await runWrite("assign_budget", {
      currencyCode: "CNY",
      month: MONTH,
      categoryId,
      assignedMinor: 12000,
    });
    const sgd = await runWrite("assign_budget", {
      currencyCode: "SGD",
      month: MONTH,
      categoryId,
      assignedMinor: 3000,
    });
    expect(cny.confirmResult.changed).toBe(true);
    expect(sgd.confirmResult.changed).toBe(true);
    expect(
      db.prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?").get(MONTH, categoryId)
        .assigned
    ).toBe(12000);
    expect(
      db.prepare("SELECT assigned FROM assignments WHERE currency_code='SGD' AND month=? AND category_id=?").get(MONTH, categoryId)
        .assigned
    ).toBe(3000);

    const cnyGoal = await runWrite("set_goal", {
      currencyCode: "CNY",
      categoryId,
      type: "monthly",
      targetMinor: 15000,
    });
    const sgdGoal = await runWrite("set_goal", {
      currencyCode: "SGD",
      categoryId,
      type: "targetBalance",
      targetMinor: 4000,
    });
    expect(cnyGoal.confirmResult.changed).toBe(true);
    expect(sgdGoal.confirmResult.changed).toBe(true);
    expect(db.prepare("SELECT type, target FROM goals WHERE currency_code='CNY' AND category_id=?").get(categoryId)).toEqual({
      type: "monthly",
      target: 15000,
    });
    expect(db.prepare("SELECT type, target FROM goals WHERE currency_code='SGD' AND category_id=?").get(categoryId)).toEqual({
      type: "targetBalance",
      target: 4000,
    });

    const cleared = await runWrite("set_goal", {
      currencyCode: "SGD",
      categoryId,
      type: "clear",
    });
    expect(cleared.confirmResult.changed).toBe(true);
    expect(db.prepare("SELECT 1 FROM goals WHERE currency_code='SGD' AND category_id=?").get(categoryId)).toBeFalsy();
    expect(db.prepare("SELECT 1 FROM goals WHERE currency_code='CNY' AND category_id=?").get(categoryId)).toBeTruthy();
  });

  it("reconciles with asOfDate and updates category notes through shared validation", async () => {
    const acc = createAccount({
      name: "CNY as-of",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10000,
      startingDate: `${MONTH}-01`,
    });
    postTransaction(db, { accountId: acc, date: `${MONTH}-10`, amount: -3000, payeeName: "past" });
    postTransaction(db, { accountId: acc, date: `${MONTH}-25`, amount: -2000, payeeName: "future" });
    const rec = await runWrite("reconcile_account", {
      accountId: acc,
      statementBalanceMinor: 7500,
      asOfDate: `${MONTH}-20`,
    });
    expect(rec.confirmResult.changed).toBe(true);
    const adj = db.prepare("SELECT amount, date FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(acc);
    expect(adj).toEqual({ amount: 500, date: `${MONTH}-20` });

    const categoryId = diningCategoryId();
    const note = await runWrite("update_category_note", { categoryId, note: "周末买菜\n第二行" });
    expect(note.confirmResult.changed).toBe(true);
    expect(db.prepare("SELECT note FROM categories WHERE id=?").get(categoryId).note).toBe("周末买菜\n第二行");

    const missing = await runWrite("update_category_note", { categoryId: "no-such-cat", note: "x" });
    expect(missing.confirmResult.changed).toBe(false);
    expect(missing.tool.ok).toBe(false);
  });
});

describe("confirmation queue for typed tools", () => {
  it("does not write before approval, sets changed=true after approve, and keeps history paired", async () => {
    const acc = createAccount({ name: "USD pending", type: "checking", currencyCode: "USD", startingBalance: 0 });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_start=0").get(acc).c;
    const session = createSession("pending-tx");
    appendUserMessage(session.id, "记一笔");
    stubLlm([
      llmTools({
        name: "post_transaction",
        arguments: { accountId: acc, date: DAY, amountMinor: -499, payeeName: "Coffee", purpose: "咖啡" },
        id: "call-coffee",
      }),
      llmText("已记账"),
    ]);
    const first = await runAgent(session.id);
    expect(first.status).toBe("awaiting_confirmation");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_start=0").get(acc).c).toBe(before);
    const pending = lastPending(session.id);
    expect(pending.pending_tool).toBe("post_transaction");
    expect(JSON.parse(pending.pending_args)).toMatchObject({ accountId: acc, amountMinor: -499 });
    expect(pending.pending_sql).toBeFalsy();

    const msgs = getSessionMessages(session.id);
    const card = msgs.find((m) => m.pending);
    expect(card.pending.tool).toBe("post_transaction");
    expect(card.pending.summary).toMatch(/USD/i);
    expect(card.pending.summary).not.toMatch(/INSERT|SELECT|\{"accountId"/);
    expect(card.pending.sql).toBeFalsy();

    const approved = await confirmPending(session.id, true);
    expect(approved.changed).toBe(true);
    expect(db.prepare("SELECT amount, payee_name FROM transactions WHERE account_id=? AND is_start=0").get(acc)).toEqual({
      amount: -499,
      payee_name: "Coffee",
    });
    const out = buildLlmMessages(session.id);
    const assistantWithTools = out.find((m) => m.role === "assistant" && m.tool_calls?.length);
    const toolIds = out.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
    expect(assistantWithTools.tool_calls.every((call) => toolIds.includes(call.id))).toBe(true);
  });

  it("reject and validation failure leave data unchanged with changed=false", async () => {
    const acc = createAccount({ name: "USD reject", type: "checking", currencyCode: "USD", startingBalance: 0 });
    const session = createSession("reject-tx");
    appendUserMessage(session.id, "记一笔");
    stubLlm(
      llmTools({
        name: "post_transaction",
        arguments: { accountId: acc, date: DAY, amountMinor: -100, payeeName: "Hold" },
        id: "call-hold",
      })
    );
    await runAgent(session.id);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const rejected = await confirmPending(session.id, false);
    expect(rejected.changed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_start=0").get(acc).c).toBe(0);

    const bad = await runWrite("post_transfer", {
      fromId: acc,
      toId: acc,
      date: DAY,
      fromAmountMinor: 100,
    });
    expect(bad.confirmResult.changed).toBe(false);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_start=0").get(acc).c).toBe(0);
  });

  it("executes immediately when confirmation is off, still rejecting cross-currency gaps, migration lock and business errors", async () => {
    setSetting("ai_require_confirmation", "0");
    const sgd = createAccount({ name: "SGD auto", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY auto", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c;

    const session = createSession("auto-missing");
    appendUserMessage(session.id, "换汇");
    stubLlm([
      llmTools({
        name: "post_transfer",
        arguments: { fromId: sgd, toId: cny, date: DAY, fromAmountMinor: 1000 },
      }),
      llmText("需要到账金额"),
    ]);
    const missing = await runAgent(session.id);
    expect(missing.status).toBe("idle");
    expect(lastPending(session.id)).toBeFalsy();
    expect(lastToolPayload(session.id).code).toBe("cross_currency_amount_required");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c).toBe(before);

    setSetting("currency_migration_status", "pending");
    const lockSession = createSession("auto-lock");
    appendUserMessage(lockSession.id, "建账户");
    stubLlm([
      llmTools({
        name: "create_account",
        arguments: { name: "锁账户", type: "cash", currencyCode: "USD", startingBalanceMinor: 0 },
      }),
      llmText("被锁"),
    ]);
    await runAgent(lockSession.id);
    expect(lastToolPayload(lockSession.id).code).toBe(CURRENCY_MIGRATION_LOCK_ERROR);
    expect(db.prepare("SELECT id FROM accounts WHERE name='锁账户'").get()).toBeFalsy();
    setSetting("currency_migration_status", "complete");

    const okSession = createSession("auto-ok");
    appendUserMessage(okSession.id, "转账");
    stubLlm([
      llmTools({
        name: "post_transfer",
        arguments: { fromId: sgd, toId: cny, date: DAY, fromAmountMinor: 1000, toAmountMinor: 5200 },
      }),
      llmText("已转"),
    ]);
    await runAgent(okSession.id);
    expect(lastToolPayload(okSession.id).ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c).toBe(before + 2);
  });

  it("survives restart by re-reading typed pending rows, and rejects leftover pending_sql writes", async () => {
    const acc = createAccount({ name: "USD restart", type: "checking", currencyCode: "USD", startingBalance: 0 });
    const session = createSession("restart");
    appendUserMessage(session.id, "记账");
    stubLlm([
      llmTools({
        name: "post_transaction",
        arguments: { accountId: acc, date: DAY, amountMinor: -250, payeeName: "Restart" },
        id: "call-restart",
      }),
      llmText("已完成"),
    ]);
    await runAgent(session.id);
    const stored = db.prepare("SELECT pending_tool, pending_args, pending_sql FROM chat_messages WHERE id=?").get(lastPending(session.id).id);
    expect(stored.pending_tool).toBe("post_transaction");
    expect(JSON.parse(stored.pending_args).amountMinor).toBe(-250);
    expect(stored.pending_sql).toBeFalsy();

    const approved = await confirmPending(session.id, true);
    expect(approved.changed).toBe(true);
    expect(db.prepare("SELECT payee_name FROM transactions WHERE account_id=? AND is_start=0").get(acc).payee_name).toBe("Restart");

    const legacy = createSession("legacy-sql");
    appendUserMessage(legacy.id, "旧写入");
    seedLegacySqlPending(legacy.id, "INSERT INTO accounts(id,name,type) VALUES('acc-legacy-sql','旧SQL账户','cash')");
    stubLlm(llmText("不应执行"));
    const blocked = await confirmPending(legacy.id, true);
    expect(blocked.changed).toBe(false);
    expect(lastToolPayload(legacy.id).code).toBe("sql_write_not_allowed");
    expect(db.prepare("SELECT id FROM accounts WHERE id='acc-legacy-sql'").get()).toBeFalsy();
    const out = buildLlmMessages(legacy.id);
    const assistant = [...out].reverse().find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(out.some((m) => m.role === "tool" && m.tool_call_id === assistant.tool_calls[0].id)).toBe(true);
  });
});

describe("run_sql is read-only and cannot queue writes", () => {
  it("reads ordinary finance tables and truncates at 40 rows", async () => {
    const session = createSession("sql-read");
    appendUserMessage(session.id, "查账户");
    stubLlm([llmTools({ name: "run_sql", arguments: { sql: "SELECT id, name, currency_code FROM accounts LIMIT 5" } }), llmText("查好了")]);
    const result = await runAgent(session.id);
    expect(result.status).toBe("idle");
    const payload = lastToolPayload(session.id);
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.rows)).toBe(true);
    expect(lastPending(session.id)).toBeFalsy();

    const ledgers = createSession("sql-ledgers");
    appendUserMessage(ledgers.id, "查账本");
    stubLlm([
      llmTools({ name: "run_sql", arguments: { sql: "SELECT currency_code FROM currency_ledgers ORDER BY currency_code" } }),
      llmText("ok"),
    ]);
    await runAgent(ledgers.id);
    expect(lastToolPayload(ledgers.id).ok).toBe(true);
    expect(lastToolPayload(ledgers.id).rows.some((row) => row.currency_code === "USD")).toBe(true);

    const trunc = createSession("sql-trunc");
    appendUserMessage(trunc.id, "很多行");
    stubLlm([
      llmTools({
        name: "run_sql",
        arguments: {
          sql: "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n<50) SELECT n FROM t",
        },
      }),
      llmText("ok"),
    ]);
    await runAgent(trunc.id);
    const cut = lastToolPayload(trunc.id);
    expect(cut.ok).toBe(true);
    expect(cut.rowCount).toBe(50);
    expect(cut.truncated).toBe(true);
    expect(cut.rows).toHaveLength(40);
  });

  it("rejects write SQL, write CTEs and protected reads without changing the database or queueing confirmation", async () => {
    const before = snapshotFinance();
    const statements = [
      "INSERT INTO accounts(id,name,type) VALUES('acc-sql-x','x','cash')",
      "UPDATE accounts SET name='hack' WHERE id=(SELECT id FROM accounts LIMIT 1)",
      "DELETE FROM transactions WHERE 1=0",
      "REPLACE INTO accounts(id,name,type) VALUES('acc-sql-y','y','cash')",
      "CREATE TABLE IF NOT EXISTS pwn(id TEXT)",
      "DROP TABLE IF EXISTS pwn",
      "ALTER TABLE accounts ADD COLUMN pwn TEXT",
      "ATTACH DATABASE ':memory:' AS other",
      "PRAGMA table_info(accounts)",
      "VACUUM",
      "WITH doomed AS (SELECT id FROM accounts) DELETE FROM accounts WHERE id IN (SELECT id FROM doomed) RETURNING id",
      "WITH doomed AS (SELECT id FROM assignments) UPDATE assignments SET assigned=0 WHERE category_id IN (SELECT category_id FROM doomed)",
      "SELECT value FROM settings WHERE key='ai_key'",
      "SELECT * FROM schema_migrations",
      "SELECT * FROM chat_sessions",
      "SELECT * FROM chat_messages",
      "SELECT * FROM im_channels",
      "SELECT * FROM fx_rates",
    ];
    for (const sql of statements) {
      const classified = classifySql(sql);
      expect(classified.kind, sql).not.toBe("read");
      expect(classified.error, sql).toBeTruthy();
      const session = createSession(`sql-bad-${uid().slice(0, 6)}`);
      appendUserMessage(session.id, sql);
      stubLlm([llmTools({ name: "run_sql", arguments: { sql } }), llmText("拒绝")]);
      const result = await runAgent(session.id);
      expect(result.status).toBe("idle");
      expect(lastPending(session.id)).toBeFalsy();
      const payload = lastToolPayload(session.id);
      expect(payload.ok).toBe(false);
      expect(payload.error || payload.code).toBeTruthy();
    }
    expect(snapshotFinance()).toEqual(before);
    expect(classifySql("INSERT INTO accounts(id,name,type) VALUES('a','b','cash')").error).toBe("sql_write_not_allowed");
    expect(classifySql("WITH doomed AS (SELECT id FROM accounts) DELETE FROM accounts WHERE id IN (SELECT id FROM doomed)").error).toBe(
      "sql_write_not_allowed"
    );
  });
});

describe("currency-aware prompt, schema and pending summaries", () => {
  it("exposes typed write tools and no longer tells the model to write with run_sql or treat every amount as 分", async () => {
    const jpy = createAccount({ name: "JPY snapshot", type: "cash", currencyCode: "JPY", startingBalance: 1234 });
    const session = createSession("schema");
    appendUserMessage(session.id, "你好");
    stubLlm(llmText("你好"));
    await runAgent(session.id);

    const names = toolNames();
    for (const name of [
      "run_sql",
      "post_transaction",
      "post_transfer",
      "create_account",
      "assign_budget",
      "set_goal",
      "reconcile_account",
      "update_category_note",
    ]) {
      expect(names).toContain(name);
    }
    const blob = dumpToolsAndPrompt(buildSystemPrompt() + buildSystemPromptWithVision());
    expect(blob).not.toMatch(/金额一律以「分」/);
    expect(blob).not.toMatch(/固定除以\s*100|分\/100/);
    expect(blob).not.toMatch(/用 run_sql 工具写入/);
    expect(blob).not.toMatch(/写操作只能是 INSERT/);
    expect(blob).toMatch(/post_transaction/);
    expect(blob).toMatch(/最小单位|minor units/i);
    expect(blob).toMatch(/originalCurrencyCode/);
    expect(blob).toMatch(/toAmountMinor/);

    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/JPY snapshot/);
    expect(prompt).toMatch(/JPY/);
    expect(prompt).toMatch(/1234/);
    expect(prompt).not.toMatch(new RegExp(`${jpy}[^\\n]*12\\.34`));
    expect(buildSchemaDoc()).not.toMatch(/fx_rates/);

    const sqlTool = JSON.stringify(toolDef("run_sql"));
    expect(sqlTool).toMatch(/read-only|只读|SELECT/i);
    expect(sqlTool).not.toMatch(/INSERT\/UPDATE\/DELETE executes/);
    expect(JSON.stringify(toolDef("post_transaction"))).toMatch(/amountMinor/);
  });

  it("pending web payload and IM-style summary show currencies and both transfer amounts, never SQL", async () => {
    const sgd = createAccount({ name: "SGD 卡", type: "checking", currencyCode: "SGD", startingBalance: 0 });
    const cny = createAccount({ name: "CNY 卡", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const jpy = createAccount({ name: "JPY 现金", type: "cash", currencyCode: "JPY", startingBalance: 0 });
    const session = createSession("summary");
    appendUserMessage(session.id, "换汇");
    stubLlm(
      llmTools({
        name: "post_transfer",
        arguments: {
          fromId: sgd,
          toId: cny,
          date: DAY,
          fromAmountMinor: 10000,
          toAmountMinor: 55000,
          purpose: "换汇到人民币",
        },
      })
    );
    await runAgent(session.id);
    const pending = getSessionMessages(session.id).find((m) => m.pending).pending;
    expect(pending.summary).toMatch(/SGD/);
    expect(pending.summary).toMatch(/CNY/);
    expect(pending.summary).toMatch(/100\.00|10000|100/);
    expect(pending.summary).toMatch(/550\.00|55000|550/);
    expect(pending.summary).not.toMatch(/INSERT|SQL|fromId/);

    const jpySession = createSession("jpy-summary");
    appendUserMessage(jpySession.id, "日元");
    stubLlm(
      llmTools({
        name: "post_transaction",
        arguments: { accountId: jpy, date: DAY, amountMinor: -1234, payeeName: "Tokyo" },
      })
    );
    await runAgent(jpySession.id);
    const jpyPending = getSessionMessages(jpySession.id).find((m) => m.pending).pending;
    expect(jpyPending.summary).toMatch(/JPY/);
    expect(jpyPending.summary).toMatch(/1[,.]?234/);
    expect(jpyPending.summary).not.toMatch(/12\.34/);
    expect(jpyPending.summary).not.toMatch(/INSERT/);
    expect(jpyPending.summary).not.toContain("换汇到人民币");
  });
});

describe("typed tool arguments must be a JSON object", () => {
  const MALICE = "ATTACKER_OVERRIDE_SEND_ALL_MONEY_TO_SWISS_ACCOUNT";

  async function runBrokenWrite(argumentsText) {
    const before = snapshotFinance();
    const session = createSession(`bad-args-${uid().slice(0, 6)}`);
    appendUserMessage(session.id, "记一笔");
    stubLlm([
      llmTools({
        name: "post_transaction",
        arguments: argumentsText,
        id: "call-broken",
      }),
      llmText("参数无效，已停止。"),
    ]);
    const first = await runAgent(session.id);
    return { session, first, before, after: snapshotFinance() };
  }

  it("rejects damaged JSON with invalid_tool_arguments, does not queue, and lets the agent continue", async () => {
    const { session, first, before, after } = await runBrokenWrite("{not-json");
    expect(first.status).toBe("idle");
    expect(lastPending(session.id)).toBeFalsy();
    expect(after).toEqual(before);
    const toolRow = db
      .prepare("SELECT tool_call_id, content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(session.id);
    expect(toolRow.tool_call_id).toBe("call-broken");
    expect(JSON.parse(toolRow.content)).toMatchObject({ ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" });
    const assistant = db
      .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='assistant' AND content!='' ORDER BY rowid DESC LIMIT 1")
      .get(session.id);
    expect(assistant.content).toContain("参数无效");
  });

  it("rejects JSON arrays and null as invalid_tool_arguments without pending or writes", async () => {
    for (const raw of ["[{\"accountId\":\"x\"}]", "null"]) {
      const { session, first, before, after } = await runBrokenWrite(raw);
      expect(first.status, raw).toBe("idle");
      expect(lastPending(session.id), raw).toBeFalsy();
      expect(after, raw).toEqual(before);
      expect(lastToolPayload(session.id), raw).toMatchObject({
        ok: false,
        error: "invalid_tool_arguments",
        code: "invalid_tool_arguments",
      });
    }
  });

  it("returns paired unknown_tool for an unknown function and does not queue a write", async () => {
    const before = snapshotFinance();
    const session = createSession("unknown-tool");
    appendUserMessage(session.id, "随便写");
    stubLlm([
      llmTools({ name: "drop_database", arguments: { confirm: true }, id: "call-unknown" }),
      llmText("未知工具，已忽略。"),
    ]);
    const first = await runAgent(session.id);
    expect(first.status).toBe("idle");
    expect(lastPending(session.id)).toBeFalsy();
    expect(snapshotFinance()).toEqual(before);
    const toolRow = db
      .prepare("SELECT tool_call_id, content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(session.id);
    expect(toolRow.tool_call_id).toBe("call-unknown");
    expect(JSON.parse(toolRow.content)).toMatchObject({ ok: false, error: "unknown_tool", code: "unknown_tool" });
  });

  it("keeps purpose in storage but Web pending summary only uses the server-generated description", async () => {
    const acc = createAccount({ name: "USD 摘要卡", type: "checking", currencyCode: "USD", startingBalance: 0 });
    const session = createSession("malice-purpose");
    appendUserMessage(session.id, "记咖啡");
    stubLlm(
      llmTools({
        name: "post_transaction",
        arguments: {
          accountId: acc,
          date: DAY,
          amountMinor: -250,
          payeeName: "Cafe",
          purpose: MALICE,
        },
        id: "call-malice",
      })
    );
    const first = await runAgent(session.id);
    expect(first.status).toBe("awaiting_confirmation");
    const pending = lastPending(session.id);
    expect(pending.pending_tool).toBe("post_transaction");
    expect(pending.pending_purpose).toBe(MALICE);
    expect(JSON.parse(pending.pending_args)).toMatchObject({ accountId: acc, amountMinor: -250, purpose: MALICE });
    const card = getSessionMessages(session.id).find((m) => m.pending).pending;
    expect(card.summary).toMatch(/USD/);
    expect(card.summary).toMatch(/Cafe|交易/);
    expect(card.summary).not.toContain(MALICE);
    expect(card.purpose).toBe(MALICE);
  });
});
