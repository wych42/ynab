import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-currency-bootstrap-");

const { api } = await import("./routes.mjs");
const { db, setSetting, uid } = await import("./db.mjs");
const { appendUserMessage, confirmPending, createSession, runAgent } = await import("./ai.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);

const LOCK = "currency_migration_required";

describe("GET /api/bootstrap on a new database", () => {
  it("exposes migration status, seven supported currencies, five enabled ledgers and a null reporting currency", async () => {
    const r = await call("GET", "/api/bootstrap");
    expect(r.status).toBe(200);
    expect(r.json.currencyMigrationRequired).toBe(false);
    expect(r.json.enabledCurrencies).toEqual(["CNY", "USD", "SGD", "EUR", "JPY"]);
    expect(r.json.enabledCurrencies).not.toContain("CAD");
    expect(r.json.enabledCurrencies).not.toContain("GBP");
    expect(r.json.settings.reportingCurrency).toBeNull();
    expect(r.json.reportingCurrency ?? r.json.settings.reportingCurrency).toBeNull();
    const codes = r.json.supportedCurrencies.map((currency) => currency.code);
    expect(codes.sort()).toEqual(["CAD", "CNY", "EUR", "GBP", "JPY", "SGD", "USD"]);
    const jpy = r.json.supportedCurrencies.find((currency) => currency.code === "JPY");
    const cny = r.json.supportedCurrencies.find((currency) => currency.code === "CNY");
    expect(jpy.exponent).toBe(0);
    expect(cny.exponent).toBe(2);
    expect(jpy.enabledByDefault).toBe(true);
    expect(r.json.supportedCurrencies.find((currency) => currency.code === "CAD").enabledByDefault).toBe(false);
    expect(r.json.supportedCurrencies.find((currency) => currency.code === "GBP").enabledByDefault).toBe(false);
    expect(r.json.currentMonth).toBeTruthy();
  });

  it("keeps reporting currency null even when the old symbol is a dollar sign", async () => {
    await call("PUT", "/api/settings", { currencySymbol: "$" });
    const r = await call("GET", "/api/bootstrap");
    expect(r.json.settings.currencySymbol).toBe("$");
    expect(r.json.settings.reportingCurrency).toBeNull();
    expect(r.json.currencyMigrationRequired).toBe(false);
  });
});
describe("GET /api/settings", () => {
  it("returns the nullable reporting currency", async () => {
    const r = await call("GET", "/api/settings");
    expect(r.status).toBe(200);
    expect(r.json.reportingCurrency).toBeNull();
  });
});

describe("financial write lock while migration is pending", () => {
  let accountId;
  let categoryId;
  let month;
  let txId;
  let amountBeforeLock;

  beforeAll(async () => {
    const created = await call("POST", "/api/accounts", {
      name: "现金",
      type: "cash",
      currencyCode: "CNY",
      startingBalanceMinor: 10000,
    });
    expect(created.status).toBe(200);
    accountId = created.json.id;

    const boot = await call("GET", "/api/bootstrap");
    month = boot.json.currentMonth;
    const spendGroup = boot.json.groups.find((group) => !group.is_income);
    categoryId = spendGroup.categories[0].id;

    const posted = await call("POST", "/api/transactions", {
      accountId,
      date: "2026-08-01",
      amount: -2500,
      payeeName: "咖啡",
      categoryId,
    });
    expect(posted.status).toBe(200);
    txId = db.prepare("SELECT id FROM transactions WHERE payee_name='咖啡'").get().id;
    amountBeforeLock = db.prepare("SELECT amount FROM transactions WHERE id=?").get(txId).amount;

    setSetting("currency_migration_status", "pending");
  });

  it("returns currencyMigrationRequired from bootstrap without changing stored amounts", async () => {
    const r = await call("GET", "/api/bootstrap");
    expect(r.status).toBe(200);
    expect(r.json.currencyMigrationRequired).toBe(true);
    expect(r.json.enabledCurrencies).toEqual(["CNY", "USD", "SGD", "EUR", "JPY"]);
    expect(db.prepare("SELECT amount FROM transactions WHERE id=?").get(txId).amount).toBe(amountBeforeLock);
    expect(db.prepare("SELECT starting_balance FROM accounts WHERE id=?").get(accountId).starting_balance).toBe(10000);
  });

  it("rejects financial writes with a stable lock error", async () => {
    const writes = [
      ["POST", "/api/demo", {}],
      ["POST", "/api/accounts", { name: "银行", type: "checking", startingBalance: 1 }],
      ["PUT", `/api/accounts/${accountId}`, { name: "改名" }],
      ["DELETE", `/api/accounts/${accountId}`],
      ["POST", "/api/transactions", { accountId, date: "2026-08-02", amount: -100, payeeName: "茶" }],
      ["PUT", `/api/transactions/${txId}`, { accountId, date: "2026-08-01", amount: -1, payeeName: "咖啡" }],
      ["DELETE", `/api/transactions/${txId}`],
      ["PATCH", `/api/transactions/${txId}/category`, { categoryId }],
      ["PATCH", `/api/transactions/${txId}/cleared`, { cleared: 1 }],
      ["POST", "/api/transactions/bulk-category", { ids: [txId], categoryId }],
      ["POST", "/api/transactions/bulk-delete", { ids: [txId] }],
      ["POST", `/api/reconcile/${accountId}`, { statementBalance: 1 }],
      ["PUT", `/api/budget/${month}/category/${categoryId}/assign`, { assigned: 100 }],
      ["POST", `/api/budget/${month}/move`, { fromId: categoryId, toId: "rta", amount: 1 }],
      ["POST", `/api/budget/${month}/cover`, { categoryId, fromId: "rta" }],
      ["POST", `/api/budget/${month}/copy-previous`],
      ["POST", `/api/budget/${month}/auto-assign`],
      ["POST", "/api/category-groups", { name: "新组" }],
      ["POST", "/api/categories", { groupId: "missing", name: "新分类" }],
      ["PUT", `/api/goals/${categoryId}`, { type: "monthly", target: 100 }],
    ];

    for (const [method, url, body] of writes) {
      const r = await call(method, url, body);
      expect({ method, url, status: r.status, error: r.json.error, code: r.json.code }).toEqual({
        method,
        url,
        status: 409,
        error: LOCK,
        code: LOCK,
      });
    }

    expect(db.prepare("SELECT amount FROM transactions WHERE id=?").get(txId).amount).toBe(-2500);
    expect(db.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(1);
    expect(db.prepare("SELECT name FROM accounts WHERE id=?").get(accountId).name).toBe("现金");
  });

  it("keeps reads and the existing backup interface available", async () => {
    const reads = [
      await call("GET", "/api/bootstrap"),
      await call("GET", "/api/settings"),
      await call("GET", "/api/accounts"),
      await call("GET", `/api/accounts/${accountId}/transactions`),
      await call("GET", "/api/transactions"),
      await call("GET", `/api/budget/${month}?currency=CNY`),
      await call("GET", "/api/categories"),
      await call("GET", "/api/reports/overview?currency=CNY"),
    ];
    for (const r of reads) {
      expect(r.status).toBe(200);
      expect(r.json.error).toBeUndefined();
    }
    expect(reads[2].json.accounts[0].starting_balance).toBe(10000);
    expect(reads[4].json.transactions.some((tx) => tx.amount === -2500)).toBe(true);

    const settings = await call("PUT", "/api/settings", { language: "en" });
    expect(settings.status).toBe(200);

    const backup = await call("POST", "/api/backup/run");
    expect(backup.status).toBe(200);
    expect(backup.json.ok).toBe(true);
  });
});

function seedPendingWrite(sessionId, sql) {
  db.prepare(
    "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)"
  ).run(
    uid(),
    sessionId,
    "assistant",
    "",
    JSON.stringify([{ id: `call-${uid().slice(0, 8)}`, name: "run_sql", arguments: JSON.stringify({ sql }) }]),
    null,
    sql,
    "测试写入",
    0,
    new Date().toISOString()
  );
}

function accountExists(id) {
  return !!db.prepare("SELECT 1 FROM accounts WHERE id=?").get(id);
}

function lastToolPayload(messages) {
  const tools = messages.filter((message) => message.role === "tool");
  expect(tools.length).toBeGreaterThan(0);
  return JSON.parse(tools[tools.length - 1].content);
}

function stubLlm(firstToolSql = null) {
  const realFetch = globalThis.fetch;
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (!String(url).includes("/chat/completions")) return realFetch(url, init);
      calls += 1;
      if (firstToolSql && calls === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "call-sql",
                      type: "function",
                      function: {
                        name: "run_sql",
                        arguments: JSON.stringify({ sql: firstToolSql, purpose: "测试写入" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: "已处理" } }] }) };
    })
  );
}

describe("AI/IM writes share the currency migration lock", () => {
  beforeAll(() => {
    setSetting("currency_migration_status", "pending");
    setSetting("ai_key", "test-key");
    setSetting("ai_base_url", "http://mock.local/v1");
    setSetting("ai_model", "test-model");
    setSetting("ai_require_confirmation", "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSetting("ai_require_confirmation", "1");
  });

  it("web confirm Interface cannot insert accounts while migration is pending", async () => {
    stubLlm();
    const created = await call("POST", "/api/chat/sessions", { title: "迁移锁" });
    expect(created.status).toBe(200);
    const sessionId = created.json.session.id;
    const sql = "INSERT INTO accounts(id,name,type) VALUES('acc-ai-lock-web','AI锁网页','cash')";
    seedPendingWrite(sessionId, sql);

    const confirmed = await call("POST", `/api/chat/sessions/${sessionId}/confirm`, { approve: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.changed).toBe(false);
    const payload = lastToolPayload(confirmed.json.messages);
    expect(payload.code).toBe("sql_write_not_allowed");
    expect(accountExists("acc-ai-lock-web")).toBe(false);
  });

  it("IM confirmPending rejects leftover pending_sql writes", async () => {
    stubLlm();
    const session = createSession("im-lock");
    appendUserMessage(session.id, "新建账户");
    seedPendingWrite(session.id, "INSERT INTO accounts(id,name,type) VALUES('acc-ai-lock-im','AI锁IM','cash')");

    const result = await confirmPending(session.id, true);
    expect(result.changed).toBe(false);
    const tool = db
      .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(session.id);
    expect(JSON.parse(tool.content).code).toBe("sql_write_not_allowed");
    expect(accountExists("acc-ai-lock-im")).toBe(false);
  });

  it("auto-confirm agent SQL writes are rejected without touching finance data", async () => {
    setSetting("ai_require_confirmation", "0");
    stubLlm("INSERT INTO accounts(id,name,type) VALUES('acc-ai-lock-auto','AI锁免确认','cash')");
    const session = createSession("auto-lock");
    appendUserMessage(session.id, "新建账户");

    const result = await runAgent(session.id);
    expect(result.status).toBe("idle");
    const tool = db
      .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(session.id);
    expect(JSON.parse(tool.content).code).toBe("sql_write_not_allowed");
    expect(accountExists("acc-ai-lock-auto")).toBe(false);
  });

  it("typed writes still hit the currency migration lock", async () => {
    setSetting("ai_require_confirmation", "0");
    const realFetch = globalThis.fetch;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (!String(url).includes("/chat/completions")) return realFetch(url, init);
        calls += 1;
        if (calls === 1) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: "call-typed-lock",
                        type: "function",
                        function: {
                          name: "create_account",
                          arguments: JSON.stringify({
                            name: "AI锁类型化",
                            type: "cash",
                            currencyCode: "CNY",
                            startingBalanceMinor: 0,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: "已处理" } }] }) };
      })
    );
    const session = createSession("typed-lock");
    appendUserMessage(session.id, "新建账户");
    await runAgent(session.id);
    const tool = db
      .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(session.id);
    expect(JSON.parse(tool.content)).toEqual({ ok: false, error: LOCK, code: LOCK });
    expect(db.prepare("SELECT id FROM accounts WHERE name='AI锁类型化'").get()).toBeFalsy();
  });

  it("rejecting a pending write and running SELECT still work", async () => {
    const session = createSession("reject-lock");
    appendUserMessage(session.id, "新建账户");
    seedPendingWrite(session.id, "INSERT INTO accounts(id,name,type) VALUES('acc-ai-lock-reject','AI锁拒绝','cash')");

    const rejected = await confirmPending(session.id, false);
    expect(rejected.changed).toBe(false);
    expect(accountExists("acc-ai-lock-reject")).toBe(false);
    expect(db.prepare("SELECT resolved FROM chat_messages WHERE session_id=? AND pending_sql IS NOT NULL").get(session.id).resolved).toBe(1);

    stubLlm("SELECT id FROM accounts LIMIT 5");
    const readSession = createSession("select-lock");
    appendUserMessage(readSession.id, "查账户");
    const readResult = await runAgent(readSession.id);
    expect(readResult.status).toBe("idle");
    const tool = db
      .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(readSession.id);
    const payload = JSON.parse(tool.content);
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.rows)).toBe(true);
  });
});
