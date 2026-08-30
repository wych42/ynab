// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-confirm-test-"));

const { db, setSetting, uid } = await import("./db.mjs");

setSetting("ai_key", "test-key");
setSetting("ai_base_url", "http://mock.local/v1");
setSetting("ai_model", "test-model");

const { createSession, appendUserMessage, confirmPending, runAgent } = await import("./ai.mjs");

function seedLegacySqlPending(sessionId, sql) {
  db.prepare(
    "INSERT INTO chat_messages(id,session_id,role,content,tool_calls,tool_call_id,pending_sql,pending_purpose,pending_index,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)"
  ).run(
    uid(),
    sessionId,
    "assistant",
    "",
    JSON.stringify([{ id: `call-${Math.random().toString(36).slice(2, 8)}`, name: "run_sql", arguments: JSON.stringify({ sql }) }]),
    null,
    sql,
    "测试写入",
    0,
    new Date().toISOString()
  );
}

function lastPendingRow(sessionId) {
  return db
    .prepare(
      `SELECT * FROM chat_messages
       WHERE session_id=? AND resolved=0
         AND (pending_tool IS NOT NULL OR pending_sql IS NOT NULL)
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(sessionId);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("confirmPending 返回 changed 标记", () => {
  it("批准且写入成功 → changed=true，数据落库，LLM 续跑汇报结果", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "已完成",
              tool_calls: [
                {
                  id: "call-c1",
                  type: "function",
                  function: {
                    name: "create_account",
                    arguments: JSON.stringify({
                      name: "中信银行信用卡",
                      type: "creditCard",
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
    }));
    vi.stubGlobal("fetch", fetchMock);

    const s = createSession("c1");
    appendUserMessage(s.id, "新建信用卡账户");
    const first = await runAgent(s.id);
    expect(first.status).toBe("awaiting_confirmation");
    expect(lastPendingRow(s.id)?.pending_tool).toBe("create_account");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "已完成" } }] }) }))
    );
    const res = await confirmPending(s.id, true);

    expect(res.changed).toBe(true);
    expect(db.prepare("SELECT name, type, currency_code FROM accounts WHERE name='中信银行信用卡'").get()).toEqual({
      name: "中信银行信用卡",
      type: "creditCard",
      currency_code: "CNY",
    });
  });

  it("拒绝 → changed=false，不产生任何写入也不调用 LLM", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call-c2",
                  type: "function",
                  function: {
                    name: "create_account",
                    arguments: JSON.stringify({
                      name: "应被取消的账户",
                      type: "checking",
                      currencyCode: "USD",
                      startingBalanceMinor: 0,
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const s = createSession("c2");
    appendUserMessage(s.id, "帮我新建账户");
    await runAgent(s.id);
    expect(lastPendingRow(s.id)).toBeTruthy();

    const noop = vi.fn();
    vi.stubGlobal("fetch", noop);
    const res = await confirmPending(s.id, false);

    expect(res.changed).toBe(false);
    expect(db.prepare("SELECT id FROM accounts WHERE name='应被取消的账户'").get()).toBeFalsy();
    expect(noop).not.toHaveBeenCalled();
  });

  it("批准但业务校验失败 → changed=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call-c3",
                    type: "function",
                    function: {
                      name: "post_transaction",
                      arguments: JSON.stringify({
                        accountId: "no-such-account",
                        date: "2026-08-26",
                        amountMinor: 100,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      }))
    );

    const s = createSession("c3");
    appendUserMessage(s.id, "记一笔");
    await runAgent(s.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "嗯" } }] }) }))
    );
    const res = await confirmPending(s.id, true);

    expect(res.changed).toBe(false);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id='no-such-account'").get().c).toBe(0);
  });

  it("没有待确认项 → changed=false", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const s = createSession("c4");
    const res = await confirmPending(s.id, true);
    expect(res.changed).toBe(false);
  });

  it("升级前遗留的 pending_sql 写入批准时返回 sql_write_not_allowed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "嗯" } }] }) }))
    );
    const s = createSession("c-legacy");
    appendUserMessage(s.id, "旧 SQL");
    seedLegacySqlPending(s.id, "INSERT INTO accounts(id,name,type) VALUES('acc-c1','中信银行信用卡','creditCard')");
    const res = await confirmPending(s.id, true);
    expect(res.changed).toBe(false);
    const tool = db
      .prepare("SELECT content FROM chat_messages WHERE session_id=? AND role='tool' ORDER BY rowid DESC LIMIT 1")
      .get(s.id);
    expect(JSON.parse(tool.content).code).toBe("sql_write_not_allowed");
    expect(db.prepare("SELECT id FROM accounts WHERE id='acc-c1'").get()).toBeFalsy();
  });

  it("思考模型的 reasoning_content 会被持久化，供续跑回传", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "好的，为你创建一个房贷账户。",
                reasoning_content: "房贷是贷款类负债，应设为预算外账户。",
                tool_calls: [
                  {
                    id: "call-r",
                    type: "function",
                    function: {
                      name: "create_account",
                      arguments: JSON.stringify({
                        name: "房贷",
                        type: "personalLoan",
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
      }))
    );

    const s = createSession("c5");
    appendUserMessage(s.id, "帮我创建一个房贷的账户");

    const res = await runAgent(s.id);
    expect(res.status).toBe("awaiting_confirmation");

    const rows = db
      .prepare("SELECT reasoning_content FROM chat_messages WHERE session_id=? AND role='assistant' ORDER BY rowid")
      .all(s.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.reasoning_content).toBe("房贷是贷款类负债，应设为预算外账户。");
  });
});
