// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const MALICE = "ATTACKER_OVERRIDE_SEND_ALL_MONEY_TO_SWISS_ACCOUNT";

const h = vi.hoisted(() => ({
  confirmChat: vi.fn(),
  refreshBoot: vi.fn(),
  pendingMessage: {
    id: "m1",
    role: "assistant" as const,
    content: "",
    toolCalls: null,
    toolCallId: null,
    pending: {
      sql: null as string | null,
      purpose: "ATTACKER_OVERRIDE_SEND_ALL_MONEY_TO_SWISS_ACCOUNT",
      index: 0,
      tool: "create_account" as string | null,
      args: { name: "中信银行信用卡", type: "creditCard", currencyCode: "CNY", startingBalanceMinor: 0 } as Record<string, unknown> | null,
      summary: "新建账户：中信银行信用卡（CNY）期初 ¥0.00" as string | null,
    },
    proposedSql: null as string | null,
    resolved: false,
    createdAt: "2026-08-26T00:00:00Z",
  },
}));

vi.mock("../api", () => ({
  api: {
    chatSessions: vi.fn().mockResolvedValue({
      sessions: [{ id: "s1", title: "测试会话", createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z" }],
    }),
    chatSession: vi.fn().mockImplementation(async () => ({
      session: { id: "s1", title: "测试会话", createdAt: "2026-08-26T00:00:00Z", updatedAt: "2026-08-26T00:00:00Z" },
      status: "awaiting_confirmation",
      messages: [{ ...h.pendingMessage, pending: { ...h.pendingMessage.pending } }],
    })),
    confirmChat: (...args: unknown[]) => h.confirmChat(...args),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: { settings: { currencySymbol: "¥", language: "zh", aiBaseUrl: "", aiModel: "", aiKey: "k" }, accounts: [] },
    loading: false,
    lang: "zh",
    t: (k: string) => k,
    refreshBoot: h.refreshBoot,
    toast: vi.fn(),
  }),
}));

import { ChatPage } from "./ChatPage";

describe("ChatPage 确认执行后刷新全局数据", () => {
  afterEach(cleanup);
  beforeEach(() => {
    h.refreshBoot.mockReset().mockResolvedValue({});
    h.confirmChat.mockReset().mockResolvedValue({ messages: [], status: "idle", changed: false });
    h.pendingMessage.pending = {
      sql: null,
      purpose: MALICE,
      index: 0,
      tool: "create_account",
      args: { name: "中信银行信用卡", type: "creditCard", currencyCode: "CNY", startingBalanceMinor: 0 },
      summary: "新建账户：中信银行信用卡（CNY）期初 ¥0.00",
    };
    h.pendingMessage.proposedSql = null;
  });

  const openPendingCard = async () => {
    render(<ChatPage />);
    fireEvent.click(await screen.findByText("测试会话"));
    return await screen.findByText("chat_confirmBtn");
  };

  it("changed=true 时调用 refreshBoot 让侧边栏/账户页立即更新", async () => {
    h.confirmChat.mockResolvedValue({ messages: [], status: "idle", changed: true });
    const btn = await openPendingCard();
    fireEvent.click(btn);
    await waitFor(() => expect(h.confirmChat).toHaveBeenCalledWith("s1", true));
    await waitFor(() => expect(h.refreshBoot).toHaveBeenCalled());
  });

  it("changed=false（拒绝或执行失败）时不触发 refreshBoot", async () => {
    h.confirmChat.mockResolvedValue({ messages: [], status: "idle", changed: false });
    const btn = await openPendingCard();
    fireEvent.click(btn);
    await waitFor(() => expect(h.confirmChat).toHaveBeenCalledWith("s1", true));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.refreshBoot).not.toHaveBeenCalled();
  });

  it("待确认卡片显示币种摘要，不展示 SQL、原始 JSON 或模型 purpose", async () => {
    render(<ChatPage />);
    fireEvent.click(await screen.findByText("测试会话"));
    expect(await screen.findByText(/中信银行信用卡（CNY）/)).toBeTruthy();
    expect(screen.queryByText(/INSERT INTO/)).toBeNull();
    expect(screen.queryByText(/将执行 SQL/)).toBeNull();
    expect(screen.queryByText(/startingBalanceMinor/)).toBeNull();
    expect(screen.queryByText(MALICE)).toBeNull();
  });

  it("旧 pending_sql 卡片仍可用 purpose 说明历史操作", async () => {
    h.pendingMessage.pending = {
      sql: "INSERT INTO accounts(name) VALUES('旧卡')",
      purpose: "历史 SQL 新建账户",
      index: 0,
      tool: null,
      args: null,
      summary: null,
    };
    h.pendingMessage.proposedSql = "INSERT INTO accounts(name) VALUES('旧卡')";
    render(<ChatPage />);
    fireEvent.click(await screen.findByText("测试会话"));
    expect(await screen.findByText("历史 SQL 新建账户")).toBeTruthy();
    expect(screen.getByText("INSERT INTO accounts(name) VALUES('旧卡')")).toBeTruthy();
  });
});
