// 隔离环境：必须在导入 db/ai 之前设置 DATA_DIR
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-im-router-test-"));

const { db, setSetting } = await import("../db.mjs");
setSetting("ai_key", "test-key");
setSetting("ai_base_url", "http://mock.local/v1");
setSetting("ai_model", "test-model");

const { createChannel } = await import("./store.mjs");
const { handleInbound } = await import("./router.mjs");

const tg = createChannel({ type: "telegram", name: "TG 测试", enabled: true, config: { token: "t" } });

function llmReply(content) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  }));
}

function llmToolCall(callId, name, args) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: callId,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
  }));
}

function createAccountArgs(name, extra = {}) {
  return {
    name,
    type: extra.type || "checking",
    currencyCode: extra.currencyCode || "CNY",
    startingBalanceMinor: extra.startingBalanceMinor ?? 0,
    purpose: extra.purpose || `新建${name}`,
  };
}

function sessionCount() {
  return db.prepare("SELECT COUNT(*) c FROM chat_sessions WHERE channel=? AND external_id='u1'").get(`telegram:${tg.id}`).c;
}

function pendingOf(sessionId) {
  return db
    .prepare(
      `SELECT * FROM chat_messages
       WHERE session_id=? AND resolved=0
         AND (pending_tool IS NOT NULL OR pending_sql IS NOT NULL)
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(sessionId);
}

function accountByName(name) {
  return db.prepare("SELECT * FROM accounts WHERE name=?").get(name);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleInbound：IM 消息接入智能助手", () => {
  it("首条消息自动建会话并返回助手回复", async () => {
    vi.stubGlobal("fetch", llmReply("**你好**，一切正常。"));
    const reply = await handleInbound(tg, "u1", "在吗？");
    expect(reply).toContain("你好");
    expect(sessionCount()).toBe(1);
  });

  it("同一外部用户复用同一会话", async () => {
    vi.stubGlobal("fetch", llmReply("第二条"));
    await handleInbound(tg, "u1", "再来一条");
    expect(sessionCount()).toBe(1);
    const s = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='u1'").get(`telegram:${tg.id}`);
    const msgs = db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=? AND role='user'").get(s.id).c;
    expect(msgs).toBe(2);
  });

  it("写操作进入待确认，回复「确认」后执行并由 LLM 汇总", async () => {
    const fetchWrite = llmToolCall("call-im-1", "create_account", createAccountArgs("IM测试账户"));
    vi.stubGlobal("fetch", fetchWrite);
    const ask = await handleInbound(tg, "u1", "帮我新建一个账户");
    const s = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='u1'").get(`telegram:${tg.id}`);
    expect(pendingOf(s.id)).toBeTruthy();
    expect(pendingOf(s.id).pending_tool).toBe("create_account");
    expect(ask).toContain("确认");
    expect(ask).not.toContain("将执行 SQL");
    expect(ask).not.toContain("SQL：");
    expect(ask).not.toContain("INSERT INTO");
    expect(ask).toMatch(/CNY/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "已完成，账户创建成功" } }] }) }))
    );
    const done = await handleInbound(tg, "u1", "确认");
    expect(accountByName("IM测试账户")?.type).toBe("checking");
    expect(done).toContain("已完成");
    expect(pendingOf(s.id)).toBeFalsy();
  });

  it("回复「取消」放弃写操作且不产生任何写入", async () => {
    vi.stubGlobal("fetch", llmToolCall("call-im-2", "create_account", createAccountArgs("应被取消账户")));
    await handleInbound(tg, "u1", "再建一个");
    const fetchNoop = vi.fn();
    vi.stubGlobal("fetch", fetchNoop);
    const reply = await handleInbound(tg, "u1", "取消");
    expect(accountByName("应被取消账户")).toBeFalsy();
    expect(accountByName("IM测试账户")).toBeTruthy();
    expect(reply).toContain("取消");
  });

  it("引用回复消息中的「确认」也能命中关键词（微信引用场景）", async () => {
    vi.stubGlobal("fetch", llmToolCall("call-im-quote", "create_account", createAccountArgs("引用账户")));
    await handleInbound(tg, "u1", "建个引用测试账户");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "已创建" } }] }) }))
    );
    const quoted = "[引用: ⚠️ 助手请求修改你的账本： | 新建账户 引用账户]\n确认";
    const reply = await handleInbound(tg, "u1", quoted);
    expect(accountByName("引用账户")).toBeTruthy();
    expect(reply).toContain("已创建");
  });

  it("「确认。」等带标点变体同样生效，普通句子不会误触发", async () => {
    vi.stubGlobal("fetch", llmToolCall("call-im-punct", "create_account", createAccountArgs("标点账户")));
    await handleInbound(tg, "u1", "再建一个标点账户");
    const s = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='u1'").get(`telegram:${tg.id}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "改名完成" } }] }) }))
    );
    expect(await handleInbound(tg, "u1", "确认。")).toContain("改名完成");
    expect(accountByName("标点账户")).toBeTruthy();
    vi.stubGlobal("fetch", llmToolCall("call-im-punct2", "create_account", createAccountArgs("不该确认的账户")));
    await handleInbound(tg, "u1", "再建一个");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const reply = await handleInbound(tg, "u1", "好的，麻烦你了");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pendingOf(s.id)).toBeTruthy();
    expect(accountByName("不该确认的账户")).toBeFalsy();
  });

  it("进入待确认时，IM 回复包含助手的自然语言说明与确认指引", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "好的，我来帮你新建一个储蓄账户。",
                tool_calls: [
                  {
                    id: "call-im-explain",
                    type: "function",
                    function: {
                      name: "create_account",
                      arguments: JSON.stringify(createAccountArgs("说明账户", { type: "savings" })),
                    },
                  },
                ],
              },
            },
          ],
        }),
      }))
    );
    const reply = await handleInbound(tg, "u3", "新建储蓄账户");
    expect(reply).toContain("储蓄账户");
    expect(reply).toContain("取消");
  });

  it("待确认时收到无关消息 → 提示而不调用 LLM", async () => {
    vi.stubGlobal("fetch", llmToolCall("call-im-3", "create_account", createAccountArgs("无关消息账户")));
    await handleInbound(tg, "u1", "改名");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const reply = await handleInbound(tg, "u1", "今天天气怎么样");
    expect(reply).toContain("确认");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("/new 命令开启全新会话，后续消息落入新会话", async () => {
    vi.stubGlobal("fetch", llmReply("旧会话回复"));
    await handleInbound(tg, "u9", "你好");
    const before = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='u9'").all(`telegram:${tg.id}`);
    expect(before.length).toBe(1);

    const reply = await handleInbound(tg, "u9", "/new");
    expect(reply).toContain("新会话");
    const sessions = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='u9' ORDER BY rowid").all(`telegram:${tg.id}`);
    expect(sessions.length).toBe(2);

    vi.stubGlobal("fetch", llmReply("新会话回复"));
    await handleInbound(tg, "u9", "继续聊");
    const newMsgs = db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=?").get(sessions[1].id).c;
    const oldMsgs = db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id=?").get(sessions[0].id).c;
    expect(newMsgs).toBe(2); // user + assistant
    expect(oldMsgs).toBe(2); // 旧会话不再增长
  });

  it("/new 作废待确认的写操作，微信渠道同样生效", async () => {
    const wx = createChannel({ type: "wechat", name: "微信测试", enabled: false, config: {} });
    vi.stubGlobal("fetch", llmToolCall("call-new-wx", "create_account", createAccountArgs("新会话账户")));
    await handleInbound(wx, "wxu1", "帮我新建一个账户");
    const s = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='wxu1'").get(`wechat:${wx.id}`);
    expect(pendingOf(s.id)).toBeTruthy();

    const reply = await handleInbound(wx, "wxu1", "/new");
    expect(reply).toContain("新会话");

    vi.stubGlobal("fetch", llmReply("这是新会话"));
    await handleInbound(wx, "wxu1", "确认");
    expect(accountByName("新会话账户")).toBeFalsy();
    expect(pendingOf(s.id)).toBeTruthy();
  });

  it("不同外部用户的待确认互不影响", async () => {
    vi.stubGlobal("fetch", llmToolCall("call-iso-a", "create_account", createAccountArgs("隔离用户A账户")));
    await handleInbound(tg, "iso-a", "建账户");
    const a = db.prepare("SELECT id FROM chat_sessions WHERE channel=? AND external_id='iso-a' ORDER BY rowid DESC LIMIT 1").get(`telegram:${tg.id}`);
    expect(pendingOf(a.id)).toBeTruthy();

    vi.stubGlobal("fetch", llmReply("用户B的回复"));
    const bReply = await handleInbound(tg, "iso-b", "你好");
    expect(bReply).toContain("用户B");
    expect(accountByName("隔离用户A账户")).toBeFalsy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "B不该执行A的写入" } }] }) }))
    );
    await handleInbound(tg, "iso-b", "确认");
    expect(accountByName("隔离用户A账户")).toBeFalsy();
    expect(pendingOf(a.id)).toBeTruthy();
  });

  it("/new 变体（大小写、尾随空格标点）均可识别，普通斜杠词不误触", async () => {
    const reply = await handleInbound(tg, "u11", " /NEW ");
    expect(reply).toContain("新会话");
    vi.stubGlobal("fetch", llmReply("普通消息"));
    const reply2 = await handleInbound(tg, "u11", "/newsletter 是什么");
    expect(reply2).toContain("普通消息");
  });

  it("确认文案只用服务端摘要，不展示模型 purpose", async () => {
    const malice = "ATTACKER_OVERRIDE_SEND_ALL_MONEY_TO_SWISS_ACCOUNT";
    vi.stubGlobal(
      "fetch",
      llmToolCall("call-im-purpose", "create_account", createAccountArgs("目的隔离账户", { purpose: malice, currencyCode: "JPY", startingBalanceMinor: 1234 }))
    );
    const ask = await handleInbound(tg, "u-purpose", "建个日元账户");
    expect(ask).toContain("确认");
    expect(ask).toContain("JPY");
    expect(ask).toMatch(/1[,.]?234/);
    expect(ask).toContain("目的隔离账户");
    expect(ask).not.toContain(malice);
    expect(ask).not.toContain("SQL：");
    expect(ask).not.toContain("INSERT INTO");
  });

  it("未配置 AI 时返回友好提示", async () => {
    setSetting("ai_key", "");
    vi.stubGlobal("fetch", vi.fn());
    const reply = await handleInbound(tg, "u2", "hello");
    expect(reply).toContain("系统设置");
    setSetting("ai_key", "test-key");
  });
});
