import type {
  Bootstrap,
  BudgetData,
  CashflowDetail,
  CashflowOverview,
  InvestmentAccountView,
  InvestmentList,
  NetWorthReport,
  ReportsData,
  Tx,
  Account,
  ChatSession,
  ChatMsg,
  ChatStatus,
  ImChannel,
  ImChannelInput,
  WechatLoginState,
  CurrencyMigrationAnomaly,
  CurrencyMigrationBackup,
  CurrencyMigrationPreview,
  CurrencyMigrationConfirmResult,
  FxStatus,
} from "./types";
import { getToken } from "./auth";
import type { WriteSnapshot } from "./writeContext";

export class ApiError extends Error {
  status?: number;
  code?: string;
  anomalies?: CurrencyMigrationAnomaly[];
  backup?: CurrencyMigrationBackup;
  budget?: BudgetData;
  ledgerRevisions?: Record<string, number>;
  categoryRevision?: number;
  groups?: Bootstrap["groups"];
  accounts?: Account[];
}

function readBackup(value: unknown): CurrencyMigrationBackup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const backup = value as { fileName?: unknown; filePath?: unknown };
  if (typeof backup.fileName !== "string" || typeof backup.filePath !== "string") return undefined;
  return { fileName: backup.fileName, filePath: backup.filePath };
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    let body: { error?: unknown; code?: unknown; anomalies?: unknown; backup?: unknown; budget?: unknown; ledgerRevisions?: Record<string, number>; categoryRevision?: number; groups?: Bootstrap["groups"]; accounts?: Account[] } | null = null;
    try {
      body = (await res.json()) as { error?: unknown; code?: unknown; anomalies?: unknown; backup?: unknown; budget?: unknown };
      if (typeof body?.error === "string") msg = body.error;
    } catch {}
    const err = new ApiError(msg);
    err.status = res.status;
    if (typeof body?.code === "string") err.code = body.code;
    if (Array.isArray(body?.anomalies)) err.anomalies = body.anomalies as CurrencyMigrationAnomaly[];
    const backup = readBackup(body?.backup);
    if (backup) err.backup = backup;
    if (body?.budget && typeof body.budget === "object") err.budget = body.budget as BudgetData;
    err.ledgerRevisions = body?.ledgerRevisions;
    err.categoryRevision = body?.categoryRevision;
    err.groups = body?.groups;
    err.accounts = body?.accounts;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  authStatus: () => req<{ enabled: boolean }>("/api/auth/status"),
  login: (password: string) => req<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),

  bootstrap: () => req<Bootstrap>("/api/bootstrap"),
  getCurrencyMigration: () => req<CurrencyMigrationPreview>("/api/currency-migration"),
  confirmCurrencyMigration: (currencyCode: string) =>
    req<CurrencyMigrationConfirmResult>("/api/currency-migration/confirm", {
      method: "POST",
      body: JSON.stringify({ currencyCode }),
    }),
  loadDemo: () => req<{ ok: true }>("/api/demo", { method: "POST" }),
  saveSettings: (body: {
    currencySymbol?: string;
    language?: string;
    timezone?: string;
    reportingCurrency?: string;
    enableCurrency?: string;
    disableCurrency?: string;
    aiBaseUrl?: string;
    aiModel?: string;
    aiKey?: string;
    aiExtraPrompt?: string;
    aiRequireConfirmation?: boolean;
    backupEnabled?: boolean;
    backupCronTime?: string;
    backupR2Endpoint?: string;
    backupR2Bucket?: string;
    backupR2Prefix?: string;
    backupR2AccessKeyId?: string;
    backupR2SecretKey?: string;
  }) => req<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  aiTest: () => req<{ ok: true; model?: string }>("/api/ai/test", { method: "POST" }),

  runBackup: () =>
    req<{ ok: true; file: string; bytes: number; uploaded: boolean } | { error: string }>("/api/backup/run", {
      method: "POST",
    }),
  testBackup: () => req<{ ok: true } | { error: string }>("/api/backup/test", { method: "POST" }),

  imChannels: () => req<{ channels: ImChannel[] }>("/api/im/channels"),
  createImChannel: (body: ImChannelInput) =>
    req<{ channel: ImChannel }>("/api/im/channels", { method: "POST", body: JSON.stringify(body) }),
  updateImChannel: (id: string, body: Partial<ImChannelInput>) =>
    req<{ channel: ImChannel }>(`/api/im/channels/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteImChannel: (id: string) => req<{ ok: true }>(`/api/im/channels/${id}`, { method: "DELETE" }),
  testImChannel: (id: string) =>
    req<{ ok: true; username?: string }>(`/api/im/channels/${id}/test`, { method: "POST" }),

  // 个人微信扫码登录
  startWechatLogin: (id: string) =>
    req<WechatLoginState>(`/api/im/channels/${id}/wechat/login`, { method: "POST" }),
  wechatLoginState: (id: string) => req<WechatLoginState>(`/api/im/channels/${id}/wechat/login`),
  submitWechatVerifyCode: (id: string, code: string) =>
    req<{ ok: true }>(`/api/im/channels/${id}/wechat/login/verify`, { method: "POST", body: JSON.stringify({ code }) }),
  cancelWechatLogin: (id: string) =>
    req<{ ok: true }>(`/api/im/channels/${id}/wechat/login`, { method: "DELETE" }),

  chatSessions: () => req<{ sessions: ChatSession[] }>("/api/chat/sessions"),
  createChatSession: (title?: string) =>
    req<{ session: ChatSession }>("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title, untitled: "新会话" }) }),
  renameChatSession: (id: string, title: string) =>
    req<{ ok: true }>(`/api/chat/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteChatSession: (id: string) => req<{ ok: true }>(`/api/chat/sessions/${id}`, { method: "DELETE" }),
  chatSession: (id: string) =>
    req<{ session: ChatSession; messages: ChatMsg[]; status: ChatStatus }>(`/api/chat/sessions/${id}`),
  sendChatMessage: (id: string, content: string, images?: string[]) =>
    req<{ messages: ChatMsg[]; status: ChatStatus }>(`/api/chat/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, images: images || [] }),
    }),
  confirmChat: (id: string, approve: boolean) =>
    req<{ messages: ChatMsg[]; status: ChatStatus; changed?: boolean }>(`/api/chat/sessions/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ approve }),
    }),

  budget: (month: string, currency: string) => req<BudgetData>(`/api/budget/${month}?currency=${encodeURIComponent(currency)}`),
  assign: (month: string, categoryId: string, cents: number, currency: string, expectedRevision?: number) =>
    req<BudgetData>(`/api/budget/${month}/category/${categoryId}/assign?currency=${encodeURIComponent(currency)}`, {
      method: "PUT",
      body: JSON.stringify({ assigned: cents, expectedRevision }),
    }),
  moveMoney: (month: string, fromId: string, toId: string, cents: number, currency: string, expectedRevision?: number) =>
    req<BudgetData>(`/api/budget/${month}/move?currency=${encodeURIComponent(currency)}`, {
      method: "POST",
      body: JSON.stringify({ fromId, toId, amount: cents, expectedRevision }),
    }),
  coverOverspending: (month: string, categoryId: string, fromId: string, currency: string, expectedRevision?: number) =>
    req<BudgetData>(`/api/budget/${month}/cover?currency=${encodeURIComponent(currency)}`, {
      method: "POST",
      body: JSON.stringify({ categoryId, fromId, expectedRevision }),
    }),
  autoAssign: (month: string, currency: string, expectedRevision?: number) =>
    req<BudgetData>(`/api/budget/${month}/auto-assign?currency=${encodeURIComponent(currency)}`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
    }),
  copyLastMonth: (month: string, currency: string, expectedRevision?: number) =>
    req<BudgetData>(`/api/budget/${month}/copy-previous?currency=${encodeURIComponent(currency)}`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
    }),

  accounts: () => req<{ accounts: Account[] }>("/api/accounts"),
  createAccount: (body: {
    name: string;
    type: string;
    currencyCode: string;
    startingBalanceMinor: number;
    startingDate?: string;
    expectedRevision?: Record<string, number>;
  }) => req<{ id: string }>("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: string, body: { name?: string; closed?: boolean; currencyCode?: string; expectedRevision?: Record<string, number> }) =>
    req<{ accounts: Account[] }>(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAccount: (id: string, expectedRevision?: Record<string, number>) => req<{ accounts: Account[] }>(`/api/accounts/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) }),
  accountRegister: (id: string) =>
    req<{ account: Account & { balance: number }; transactions: Tx[] } & WriteSnapshot>(`/api/accounts/${id}/transactions`),
  investmentAccount: (id: string, params: { months: number; asOf: string }) => {
    const q = new URLSearchParams({
      months: String(params.months),
      asOf: params.asOf,
    });
    return req<InvestmentAccountView>(`/api/investments/${encodeURIComponent(id)}?${q.toString()}`);
  },
  reconcile: (accountId: string, body?: { statementBalance?: number; markCleared?: boolean; expectedRevision?: Record<string, number> }) =>
    req<{ ok: true; adjustment: number | null }>(`/api/reconcile/${accountId}`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  transactions: (params: { search?: string; uncategorized?: boolean; accountId?: string; currency?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params.search) q.set("search", params.search);
    if (params.uncategorized) q.set("uncategorized", "1");
    if (params.accountId) q.set("accountId", params.accountId);
    if (params.currency) q.set("currency", params.currency);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return req<{ transactions: Tx[]; total: number } & WriteSnapshot>(`/api/transactions${qs ? `?${qs}` : ""}`);
  },
  createTx: (body: unknown) => req<{ ok: true }>("/api/transactions", { method: "POST", body: JSON.stringify(body) }),
  updateTx: (id: string, body: unknown) =>
    req<{ ok: true }>(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTx: (id: string, expectedRevision?: Record<string, number>) => req<{ ok: true }>(`/api/transactions/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) }),
  setTxStatus: (id: string, cleared: number, expectedRevision?: Record<string, number>) =>
    req<{ ok: true }>(`/api/transactions/${id}/cleared`, { method: "PATCH", body: JSON.stringify({ cleared, expectedRevision }) }),
  setTxCategory: (id: string, categoryId: string | null, expectedRevision?: Record<string, number>) =>
    req<{ ok: true }>(`/api/transactions/${id}/category`, { method: "PATCH", body: JSON.stringify({ categoryId, expectedRevision }) }),
  bulkSetCategory: (ids: string[], categoryId: string | null, expectedRevision?: Record<string, number>) =>
    req<{ ok: true; changed: number }>("/api/transactions/bulk-category", {
      method: "POST",
      body: JSON.stringify({ ids, categoryId, expectedRevision }),
    }),
  bulkDeleteTx: (ids: string[], expectedRevision?: Record<string, number>) =>
    req<{ ok: true; changed: number }>("/api/transactions/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids, expectedRevision }),
    }),

  addGroup: (name: string, expectedCategoryRevision?: number) =>
    req<{ id: string }>("/api/category-groups", { method: "POST", body: JSON.stringify({ name, expectedCategoryRevision }) }),
  renameGroup: (id: string, name: string, expectedCategoryRevision?: number) =>
    req<{ ok: true }>(`/api/category-groups/${id}`, { method: "PUT", body: JSON.stringify({ name, expectedCategoryRevision }) }),
  deleteGroup: (id: string, expectedCategoryRevision?: number) =>
    req<{ ok: true }>(`/api/category-groups/${id}`, { method: "DELETE", body: JSON.stringify({ expectedCategoryRevision }) }),
  addCategory: (groupId: string, name: string, expectedCategoryRevision?: number) =>
    req<{ id: string }>("/api/categories", { method: "POST", body: JSON.stringify({ groupId, name, expectedCategoryRevision }) }),
  renameCategory: (id: string, name: string, expectedCategoryRevision?: number) =>
    req<{ ok: true }>(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify({ name, expectedCategoryRevision }) }),
  updateCategory: (id: string, patch: { name?: string; note?: string; hidden?: boolean }, expectedCategoryRevision?: number) =>
    req<{ ok: true }>(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify({ ...patch, expectedCategoryRevision }) }),
  deleteCategory: (id: string, expectedCategoryRevision?: number) =>
    req<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE", body: JSON.stringify({ expectedCategoryRevision }) }),
  setGoal: (
    categoryId: string,
    body: { type: "monthly" | "targetBalance" | "targetByDate"; target: number; targetMonth?: string | null },
    currency: string,
    expectedRevision?: number,
  ) => req<{ ok: true }>(`/api/goals/${categoryId}?currency=${encodeURIComponent(currency)}`, { method: "PUT", body: JSON.stringify({ ...body, expectedRevision }) }),
  clearGoal: (categoryId: string, currency: string, expectedRevision?: number) =>
    req<{ ok: true }>(`/api/goals/${categoryId}?currency=${encodeURIComponent(currency)}`, {
      method: "PUT",
      body: JSON.stringify({ type: null, expectedRevision }),
    }),

  reports: (months = 12, currency: string) =>
    req<ReportsData>(`/api/reports/overview?months=${months}&currency=${encodeURIComponent(currency)}`),
  nativeReport: (currency: string, months = 12) =>
    req<ReportsData>(`/api/reports/native?currency=${encodeURIComponent(currency)}&months=${months}`),
  cashflowOverview: () => req<CashflowOverview>("/api/reports/cashflow"),
  cashflowDetail: (currency: string, months = 12) =>
    req<CashflowDetail>(`/api/reports/cashflow/${encodeURIComponent(currency)}?months=${months}`),
  investments: (params?: { asOf?: string; months?: number }) => {
    const q = new URLSearchParams();
    if (params?.asOf) q.set("asOf", params.asOf);
    if (params?.months != null) q.set("months", String(params.months));
    const qs = q.toString();
    return req<InvestmentList>(`/api/investments${qs ? `?${qs}` : ""}`);
  },
  netWorthReport: (params: { reportingCurrency: string; months: number; asOf: string }) => {
    const q = new URLSearchParams({
      reportingCurrency: params.reportingCurrency,
      months: String(params.months),
      asOf: params.asOf,
    });
    return req<NetWorthReport>(`/api/reports/net-worth?${q.toString()}`);
  },

  getFxStatus: () => req<FxStatus>("/api/fx/status"),
  syncFxRates: (body?: { fromDate?: string; toDate?: string }) =>
    req<FxStatus>("/api/fx/sync", { method: "POST", body: JSON.stringify(body ?? {}) }),
  putFxRate: (rateDate: string, from: string, to: string, rate: string) =>
    req<{ ok: true }>(`/api/fx/rates/${encodeURIComponent(rateDate)}/${from}/${to}`, {
      method: "PUT",
      body: JSON.stringify({ rate }),
    }),
  deleteFxRate: (rateDate: string, from: string, to: string) =>
    req<{ ok: true }>(`/api/fx/rates/${encodeURIComponent(rateDate)}/${from}/${to}`, { method: "DELETE" }),
};
