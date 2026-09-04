import express from "express";
import {
  db,
  DATA_DIR,
  uid,
  nowIso,
  getSetting,
  setSetting,
  isCreditType,
  todayYmd,
  getTimezone,
  isValidTimezone,
} from "./db.mjs";
import {
  applyCurrencySettings,
  changeAccountCurrency,
  createAccountRecord,
  isAccountCurrencyError,
  parseStartingBalanceMinor,
  presentAccount,
  requireEnabledCurrency,
} from "./account-currency.mjs";
import {
  computeBudget,
  accountBalances,
  ageOfMoney,
  goalNeed,
  buildNativeReport,
  reportsOverview,
} from "./engine.mjs";
import { addMonths, currentMonth } from "./db.mjs";
import {
  listSessions,
  createSession,
  deleteSession,
  renameSession,
  getSessionMessages,
  getSessionRow,
  runAgent,
  confirmPending,
  testAiConnection,
  appendUserMessage,
  normalizeImages,
  sessionHasPending,
} from "./ai.mjs";
import {
  CHANNEL_TYPES,
  listChannels,
  getChannel,
  createChannel,
  updateChannel,
  deleteChannel as deleteImChannel,
} from "./im/store.mjs";
import { syncChannels } from "./im/index.mjs";
import {
  startWechatLogin,
  getWechatLoginState,
  submitWechatVerifyCode,
  stopWechatLogin,
} from "./im/wechat.mjs";
import { isAuthEnabled, verifyPassword, signToken, requireAuth } from "./auth.mjs";
import { runBackupNow, s3ConfigFromSettings } from "./backup.mjs";
import { syncBackupScheduler, readBackupSettings } from "./backup.scheduler.mjs";
import { s3ListObjects } from "./s3.mjs";
import {
  currencyMigrationLockPayload,
  getCurrencyBootstrapState,
  isCurrencyMigrationRequired,
} from "./currency-state.mjs";
import { MoneyError } from "./money.mjs";
import {
  CurrencyMigrationError,
  confirmCurrencyMigration,
  getCurrencyMigrationPreview,
} from "./currency-migration.mjs";
import {
  assertCategoryDeletable,
  deleteTransaction,
  deleteTransactions,
  isCurrencyLedgerError,
  postTransaction,
  postTransfer,
  reconcileAccount,
  setTransactionCategory,
  setTransactionCleared,
  setTransactionsCategory,
  transferInputFromHttp,
  updateTransaction,
} from "./currency-ledger.mjs";
import {
  adjustAssignment,
  assertAssignmentTarget,
  assignBudget,
  isFinanceToolError,
  setGoal,
  updateCategoryNote,
} from "./finance-tools.mjs";
import { createFxModule, isFxError, FxProviderError } from "./fx.mjs";
import { createReportsModule, isReportsError } from "./reports.mjs";
import { createInvestmentModule, isInvestmentError } from "./investment.mjs";
import { loadDemoData } from "./demo.mjs";

export const api = express.Router();

const bad = (res, msg) => res.status(400).json({ error: msg });

function sendAccountCurrencyError(res, error) {
  if (isAccountCurrencyError(error) || isFinanceToolError(error)) {
    return res.status(400).json({ error: error.code, code: error.code, message: error.message });
  }
  throw error;
}

function sendLedgerError(res, error) {
  if (isCurrencyLedgerError(error) || isAccountCurrencyError(error)) {
    return res.status(400).json({ error: error.code, code: error.code, message: error.message });
  }
  if (error instanceof Error && error.message) return bad(res, error.message);
  throw error;
}

function requestCurrency(req) {
  const query = req.query?.currency;
  return requireEnabledCurrency(db, typeof query === "string" ? query : undefined);
}

const fxModule = createFxModule({ db, today: todayYmd, nowIso });
const reportsModule = createReportsModule({ db, fx: fxModule });
const investmentModule = createInvestmentModule({ db });

function sendFxError(res, error) {
  if (!isFxError(error)) throw error;
  const provider = error instanceof FxProviderError || String(error.code || "").startsWith("fx_provider_");
  return res.status(provider ? 502 : 400).json({ error: error.code, code: error.code, message: error.message });
}

function sendReportsError(res, error) {
  if (isReportsError(error) || isAccountCurrencyError(error)) {
    return res.status(400).json({ error: error.code, code: error.code, message: error.message });
  }
  throw error;
}

function sendInvestmentError(res, error) {
  if (isInvestmentError(error)) {
    return res.status(error.status || 400).json({ error: error.code, code: error.code, message: error.message });
  }
  throw error;
}

function backupPayload(backup) {
  if (!backup || typeof backup.fileName !== "string" || typeof backup.filePath !== "string") return undefined;
  return { fileName: backup.fileName, filePath: backup.filePath };
}

function sendCurrencyMigrationConfirmError(res, error) {
  if (error instanceof CurrencyMigrationError && error.code === "legacy_scale_not_divisible") {
    return res.status(400).json({ error: error.code, code: error.code, anomalies: error.anomalies });
  }
  if (error instanceof MoneyError) {
    return res.status(400).json({ error: error.code, code: error.code, message: error.message });
  }
  if (error instanceof CurrencyMigrationError && error.code === "currency_migration_failed") {
    const body = {
      error: error.code,
      code: error.code,
      message: error.message,
    };
    const backup = backupPayload(error.backup);
    if (backup) body.backup = backup;
    return res.status(500).json(body);
  }
  if (error instanceof CurrencyMigrationError && error.code === "currency_migration_backup_failed") {
    return res.status(500).json({ error: error.code, code: error.code, message: error.message });
  }
  if (error instanceof CurrencyMigrationError) {
    return res.status(400).json({ error: error.code, code: error.code, message: error.message });
  }
  return res.status(500).json({
    error: "currency_migration_failed",
    code: "currency_migration_failed",
    message: "currency migration failed",
  });
}

const FINANCIAL_WRITE_ROUTES = [
  ["POST", /^\/demo$/],
  ["POST", /^\/accounts$/],
  ["PUT", /^\/accounts\/[^/]+$/],
  ["DELETE", /^\/accounts\/[^/]+$/],
  ["PUT", /^\/budget\/[^/]+\/category\/[^/]+\/assign$/],
  ["POST", /^\/budget\/[^/]+\/move$/],
  ["POST", /^\/budget\/[^/]+\/cover$/],
  ["POST", /^\/budget\/[^/]+\/copy-previous$/],
  ["POST", /^\/budget\/[^/]+\/auto-assign$/],
  ["PATCH", /^\/transactions\/[^/]+\/category$/],
  ["PATCH", /^\/transactions\/[^/]+\/cleared$/],
  ["POST", /^\/transactions$/],
  ["POST", /^\/transfers$/],
  ["POST", /^\/transactions\/bulk-category$/],
  ["POST", /^\/transactions\/bulk-delete$/],
  ["PUT", /^\/transactions\/[^/]+$/],
  ["DELETE", /^\/transactions\/[^/]+$/],
  ["POST", /^\/reconcile\/[^/]+$/],
  ["POST", /^\/category-groups$/],
  ["PUT", /^\/category-groups\/[^/]+$/],
  ["DELETE", /^\/category-groups\/[^/]+$/],
  ["POST", /^\/categories$/],
  ["PUT", /^\/categories\/[^/]+$/],
  ["DELETE", /^\/categories\/[^/]+$/],
  ["PUT", /^\/goals\/[^/]+$/],
  ["POST", /^\/fx\/sync$/],
  ["PUT", /^\/fx\/rates\/[^/]+\/[^/]+\/[^/]+$/],
  ["DELETE", /^\/fx\/rates\/[^/]+\/[^/]+\/[^/]+$/],
];

function isFinancialWrite(req) {
  return FINANCIAL_WRITE_ROUTES.some(([method, pattern]) => req.method === method && pattern.test(req.path));
}

// 额外提示词会被嵌入 LLM 系统提示词（网页 + IM 共用），设一个合理上限防止异常内容撑爆请求体
const MAX_EXTRA_PROMPT_CHARS = 20000;

/* --------------------------- 认证 --------------------------- */

api.get("/auth/status", (req, res) => {
  res.json({ enabled: isAuthEnabled() });
});

api.post("/auth/login", (req, res) => {
  if (!isAuthEnabled()) return bad(res, "auth disabled");
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!verifyPassword(password)) return res.status(401).json({ error: "invalid password" });
  res.json({ token: signToken() });
});

// 之后的所有接口都需要有效 JWT（登录与状态之外），防止绕过
api.use(requireAuth);

api.use((req, res, next) => {
  if (!isFinancialWrite(req) || !isCurrencyMigrationRequired(db)) return next();
  return res.status(409).json(currencyMigrationLockPayload());
});

api.post("/demo", (req, res) => {
  const n = db.prepare("SELECT COUNT(*) c FROM transactions").get().c;
  if (n > 0) return bad(res, "data exists");
  loadDemoData({ database: db });
  res.json({ ok: true });
});

api.get("/bootstrap", (req, res) => {
  const currency = getCurrencyBootstrapState(db);
  res.json({
    settings: {
      currencySymbol: getSetting("currency_symbol", "¥"),
      language: getSetting("language", "zh"),
      timezone: getSetting("timezone", getTimezone()),
      aiBaseUrl: getSetting("ai_base_url", "https://api.openai.com/v1"),
      aiModel: getSetting("ai_model", "gpt-4o-mini"),
      aiKey: getSetting("ai_key", ""),
      aiExtraPrompt: getSetting("ai_extra_prompt", ""),
      aiRequireConfirmation: getSetting("ai_require_confirmation", "1") !== "0",
      reportingCurrency: currency.reportingCurrency,
      ...readBackupSettings(),
    },
    accounts: accountsWithBalances(),
    payees: db
      .prepare(
        "SELECT DISTINCT payee_name AS name FROM transactions WHERE payee_name IS NOT NULL AND payee_name != '' AND payee_name != '__starting__' ORDER BY name LIMIT 500"
      )
      .all()
      .map((r) => r.name),
    groups: groupsWithCategories(),
    currentMonth: currentMonth(),
    currencyMigrationRequired: currency.currencyMigrationRequired,
    supportedCurrencies: currency.supportedCurrencies,
    enabledCurrencies: currency.enabledCurrencies,
  });
});

api.get("/currency-migration", (req, res) => {
  res.json(getCurrencyMigrationPreview(db));
});

api.post("/currency-migration/confirm", async (req, res) => {
  const currencyCode = req.body?.currencyCode;
  if (typeof currencyCode !== "string" || !currencyCode.trim()) {
    return bad(res, "currency_code required");
  }
  try {
    const result = await confirmCurrencyMigration(db, currencyCode.trim(), { dataDir: DATA_DIR });
    res.json(result);
  } catch (e) {
    return sendCurrencyMigrationConfirmError(res, e);
  }
});

api.get("/settings", (req, res) => {
  res.json({
    currencySymbol: getSetting("currency_symbol", "¥"),
    language: getSetting("language", "zh"),
    timezone: getSetting("timezone", getTimezone()),
    aiBaseUrl: getSetting("ai_base_url", "https://api.openai.com/v1"),
    aiModel: getSetting("ai_model", "gpt-4o-mini"),
    aiKey: getSetting("ai_key", ""),
    aiExtraPrompt: getSetting("ai_extra_prompt", ""),
    aiRequireConfirmation: getSetting("ai_require_confirmation", "1") !== "0",
    reportingCurrency: getCurrencyBootstrapState(db).reportingCurrency,
    ...readBackupSettings(),
  });
});

api.put("/settings", (req, res) => {
  const {
    currencySymbol,
    language,
    timezone,
    aiBaseUrl,
    aiModel,
    aiKey,
    aiExtraPrompt,
    aiRequireConfirmation,
    backupEnabled,
    backupCronTime,
    backupR2Endpoint,
    backupR2Bucket,
    backupR2Prefix,
    backupR2AccessKeyId,
    backupR2SecretKey,
    enableCurrency,
    disableCurrency,
    reportingCurrency,
  } = req.body || {};

  // cron 时间先校验后落库，非法值整体拒绝（"24:00" 前后都不允许）
  let cronNormalized;
  if (typeof backupCronTime === "string") {
    const m = /^(\d{1,2}):(\d{2})$/.exec(backupCronTime.trim());
    const h = m ? Number(m[1]) : NaN;
    const min = m ? Number(m[2]) : NaN;
    if (backupCronTime.trim() === "") cronNormalized = "";
    else if (!m || h > 23 || min > 59) return bad(res, "invalid cron time");
    else cronNormalized = `${String(h).padStart(2, "0")}:${m[2]}`;
  }

  try {
    if (typeof enableCurrency === "string" || typeof disableCurrency === "string" || typeof reportingCurrency === "string") {
      const apply = db.transaction(() => applyCurrencySettings(db, { enableCurrency, disableCurrency, reportingCurrency }));
      apply();
    }
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }

  if (typeof currencySymbol === "string" && currencySymbol.length <= 4) setSetting("currency_symbol", currencySymbol);
  if (language === "zh" || language === "en") setSetting("language", language);
  if (typeof timezone === "string" && timezone.trim()) {
    const tz = timezone.trim();
    if (!isValidTimezone(tz)) return bad(res, "invalid timezone");
    setSetting("timezone", tz);
  }
  if (typeof aiBaseUrl === "string" && aiBaseUrl.trim()) setSetting("ai_base_url", aiBaseUrl.trim());
  if (typeof aiModel === "string" && aiModel.trim()) setSetting("ai_model", aiModel.trim());
  if (typeof aiKey === "string") setSetting("ai_key", aiKey.trim());
  if (typeof aiExtraPrompt === "string") {
    if (aiExtraPrompt.trim().length > MAX_EXTRA_PROMPT_CHARS) return bad(res, "ai extra prompt too long");
    setSetting("ai_extra_prompt", aiExtraPrompt.trim());
  }
  if (typeof aiRequireConfirmation === "boolean") setSetting("ai_require_confirmation", aiRequireConfirmation ? "1" : "0");

  if (typeof backupEnabled === "boolean") setSetting("backup_enabled", backupEnabled ? "1" : "0");
  if (cronNormalized !== undefined) setSetting("backup_cron_time", cronNormalized);
  // R2 各字段按提交值覆盖；密钥只在提供非空值时更新（前端不回显、留空即保持不变）
  if (typeof backupR2Endpoint === "string") setSetting("backup_r2_endpoint", backupR2Endpoint.trim().replace(/\/+$/, ""));
  if (typeof backupR2Bucket === "string") setSetting("backup_r2_bucket", backupR2Bucket.trim());
  if (typeof backupR2Prefix === "string") setSetting("backup_r2_prefix", backupR2Prefix.replace(/^\/+|\/+$/g, "").trim());
  if (typeof backupR2AccessKeyId === "string") setSetting("backup_r2_access_key_id", backupR2AccessKeyId.trim());
  if (typeof backupR2SecretKey === "string" && backupR2SecretKey.trim()) setSetting("backup_r2_secret_key", backupR2SecretKey.trim());

  syncBackupScheduler();
  res.json({ ok: true });
});

api.post("/ai/test", async (req, res) => {
  try {
    res.json(await testAiConnection());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ------------------------- 备份 ------------------------- */

// 立即执行一次完整备份（本地 + 已配置的远端），结果同时写入 settings 供 UI 展示
api.post("/backup/run", async (req, res) => {
  try {
    res.json(await runBackupNow());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// R2 连通性测试：要素齐全 + ListObjectsV2 可用
api.post("/backup/test", async (req, res) => {
  const cfg = s3ConfigFromSettings();
  if (!cfg.ready) return bad(res, "R2 not fully configured");
  try {
    await s3ListObjects(cfg, cfg.prefix);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ------------------------- IM 渠道 ------------------------- */

api.get("/im/channels", (req, res) => {
  res.json({ channels: listChannels() });
});

api.post("/im/channels", (req, res) => {
  const { type, name, enabled, config } = req.body || {};
  if (!CHANNEL_TYPES.includes(type)) return bad(res, "invalid channel type");
  try {
    const channel = createChannel({ type, name, enabled: !!enabled, config: config || {} });
    syncChannels();
    res.json({ channel });
  } catch (e) {
    bad(res, e.message);
  }
});

api.put("/im/channels/:id", (req, res) => {
  const { name, enabled, config } = req.body || {};
  try {
    const channel = updateChannel(req.params.id, { name, enabled, config });
    if (!channel) return bad(res, "not found");
    syncChannels();
    res.json({ channel });
  } catch (e) {
    bad(res, e.message);
  }
});

api.delete("/im/channels/:id", (req, res) => {
  deleteImChannel(req.params.id);
  syncChannels();
  res.json({ ok: true });
});

async function testChannel(channel) {
  if (channel.type === "telegram") {
    const { createTelegramAdapter } = await import("./im/telegram.mjs");
    return createTelegramAdapter(channel.config, { log: () => {} }).test();
  }
  if (channel.type === "wechat") {
    const { createWechatPersonalAdapter } = await import("./im/wechat.mjs");
    return createWechatPersonalAdapter(channel.config, { log: () => {} }).test();
  }
  throw new Error("unsupported channel");
}

api.post("/im/channels/:id/test", async (req, res) => {
  const ch = getChannel(req.params.id);
  if (!ch) return bad(res, "not found");
  try {
    res.json(await testChannel(ch));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ------------------------- 个人微信扫码登录 ------------------------- */

function wechatChannelOr400(req, res) {
  const ch = getChannel(req.params.id);
  if (!ch || ch.type !== "wechat") {
    res.status(404).json({ error: "wechat channel not found" });
    return null;
  }
  return ch;
}

// 发起扫码登录：返回二维码内容（qrcodeUrl 为需编码成二维码图片的链接）
api.post("/im/channels/:id/wechat/login", async (req, res) => {
  const ch = wechatChannelOr400(req, res);
  if (!ch) return;
  const localTokenList = listChannels()
    .filter((c) => c.type === "wechat" && c.id !== ch.id && c.config.token)
    .map((c) => c.config.token);
  try {
    const state = await startWechatLogin({
      channelId: ch.id,
      localTokenList,
      pollIntervalMs: Number(process.env.IM_LOGIN_POLL_MS) || undefined,
      onSave: (creds) => {
        // 扫码确认后：落库凭据并自动启用，立即开始收发
        updateChannel(ch.id, {
          enabled: true,
          config: { token: creds.token, baseUrl: creds.baseUrl, userId: creds.userId, botId: creds.botId },
        });
        syncChannels();
        console.log(`[im] wechat login confirmed: ${ch.name} (${ch.id})`);
      },
    });
    // qrcodeUrl 是链接，需编码为二维码图片供手机扫描
    let qrDataUrl = null;
    if (state.qrcodeUrl) {
      const QRCode = (await import("qrcode")).default;
      qrDataUrl = await QRCode.toDataURL(state.qrcodeUrl, { margin: 1, width: 220 });
    }
    res.json({ ...state, qrDataUrl });
  } catch (e) {
    bad(res, e.message);
  }
});

// 轮询登录状态
api.get("/im/channels/:id/wechat/login", (req, res) => {
  const ch = wechatChannelOr400(req, res);
  if (!ch) return;
  const state = getWechatLoginState(ch.id);
  if (!state) return bad(res, "no active login");
  res.json(state);
});

// 提交手机微信上显示的配对数字
api.post("/im/channels/:id/wechat/login/verify", (req, res) => {
  const ch = wechatChannelOr400(req, res);
  if (!ch) return;
  const code = String(req.body?.code || "").trim();
  if (!code) return bad(res, "code required");
  const ok = submitWechatVerifyCode(ch.id, code);
  if (!ok) return bad(res, "no active login");
  res.json({ ok: true });
});

// 取消登录
api.delete("/im/channels/:id/wechat/login", (req, res) => {
  const ch = wechatChannelOr400(req, res);
  if (!ch) return;
  stopWechatLogin(ch.id);
  res.json({ ok: true });
});

function chatStatus(sessionId) {
  return sessionHasPending(sessionId) ? "awaiting_confirmation" : "idle";
}

api.get("/chat/sessions", (req, res) => {
  res.json({ sessions: listSessions() });
});

api.post("/chat/sessions", (req, res) => {
  const title = (req.body?.title || "").trim() || (req.body?.untitled || "新会话");
  res.json({ session: createSession(title.slice(0, 60)) });
});

api.patch("/chat/sessions/:id", (req, res) => {
  const title = (req.body?.title || "").trim();
  if (!title) return bad(res, "title required");
  renameSession(req.params.id, title.slice(0, 60));
  res.json({ ok: true });
});

api.delete("/chat/sessions/:id", (req, res) => {
  deleteSession(req.params.id);
  res.json({ ok: true });
});

api.get("/chat/sessions/:id", (req, res) => {
  const s = getSessionRow(req.params.id);
  if (!s) return bad(res, "not found");
  res.json({ session: s, messages: getSessionMessages(s.id), status: chatStatus(s.id) });
});

api.post("/chat/sessions/:id/messages", async (req, res) => {
  const s = getSessionRow(req.params.id);
  if (!s) return bad(res, "session not found");
  const content = (req.body?.content || "").trim().slice(0, 8000);
  const images = normalizeImages(req.body?.images);
  if (!content && images.length === 0) return bad(res, "empty message");

  // 方案1：图片瞬态不落库，仅当次传给模型，用后即焚
  appendUserMessage(s.id, content);

  try {
    const result = await runAgent(s.id, { images });
    // 为本次响应临时回显图片（前端乐观展示），刷新后不持久化
    const messages = getSessionMessages(s.id);
    if (images.length) {
      // 给刚写入的最后一条 user 消息临时挂上 images，仅用于本次响应
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          messages[i].images = images;
          break;
        }
      }
    }
    res.json({ messages, status: chatStatus(s.id), ...result });
  } catch (e) {
    const notConfigured = e.message === "AI_NOT_CONFIGURED";
    res.status(notConfigured ? 400 : 502).json({
      error: notConfigured ? "AI_NOT_CONFIGURED" : e.message,
      messages: getSessionMessages(s.id),
      status: chatStatus(s.id),
    });
  }
});

api.post("/chat/sessions/:id/confirm", async (req, res) => {
  const s = getSessionRow(req.params.id);
  if (!s) return bad(res, "session not found");
  const approve = !!req.body?.approve;
  try {
    const result = await confirmPending(s.id, approve);
    res.json({ messages: getSessionMessages(s.id), status: chatStatus(s.id), ...result });
  } catch (e) {
    res.status(502).json({
      error: e.message,
      messages: getSessionMessages(s.id),
      status: chatStatus(s.id),
    });
  }
});

function accountsWithBalances() {
  const balances = accountBalances();
  return db
    .prepare("SELECT * FROM accounts ORDER BY sort_order, created_at")
    .all()
    .map((a) => presentAccount(a, { balance: balances.get(a.id) || 0 }));
}

function groupsWithCategories() {
  const groups = db.prepare("SELECT * FROM category_groups ORDER BY sort_order").all();
  const cats = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  return groups.map((g) => ({
    ...g,
    categories: cats.filter((c) => c.group_id === g.id).map((c) => ({ ...c, goal: null })),
  }));
}

function budgetPayload(month, currencyCode) {
  const { months, byMonth } = computeBudget(month, currencyCode);
  const state = byMonth.get(month) || byMonth.get(months[months.length - 1]);
  if (!state) return null;
  const goals = Object.fromEntries(
    db.prepare("SELECT * FROM goals WHERE currency_code=?").all(currencyCode).map((g) => [g.category_id, g])
  );

  let overspentTotal = 0;
  for (const id in state.available) if (state.available[id] < 0) overspentTotal += state.available[id];

  const lastAssignments =
    byMonth.get(addMonths(month, -1))?.assigned ||
    {};
  const avgSpendByCat = {};
  const prev3 = [1, 2, 3].map((i) => byMonth.get(addMonths(month, -i))).filter(Boolean);
  for (const id in state.activity) {
    const vals = prev3.map((s) => Math.abs(s.activity[id] || 0)).filter((v) => v > 0);
    avgSpendByCat[id] = vals.length ? Math.ceil(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }

  const catView = (id, extra = {}) => ({
    id,
    assigned: state.assigned[id] || 0,
    activity: state.activity[id] || 0,
    available: state.available[id] ?? 0,
    goal: goals[id] || null,
    need: goalNeed(goals[id], state.available[id] ?? 0, month, lastAssignments[id] || 0, avgSpendByCat[id] || 0),
    lastAssigned: lastAssignments[id] || 0,
    avgSpend: avgSpendByCat[id] || 0,
    ...extra,
  });

  const groups = groupsWithCategories()
    .filter((g) => !g.hidden && !g.is_income)
    .map((g) => ({
      id: g.id,
      name: g.name,
      virtual: false,
      categories: g.categories.filter((c) => !c.hidden).map((c) => catView(c.id, { name: c.name, note: c.note })),
    }));

  const ccAccounts = db
    .prepare("SELECT id,name,type FROM accounts WHERE type IN ('creditCard','lineOfCredit') AND on_budget=1 AND closed=0 AND currency_code=? ORDER BY sort_order")
    .all(currencyCode);
  if (ccAccounts.length) {
    groups.push({
      id: "__cc__",
      name: "__cc__",
      virtual: true,
      categories: ccAccounts.map((a) => catView(`cc:${a.id}`, { name: a.name, accountId: a.id })),
    });
  }

  const uncategorizedCount = db
    .prepare(
      `SELECT COUNT(*) c FROM transactions t JOIN accounts a ON a.id=t.account_id
       WHERE a.on_budget=1 AND a.currency_code=? AND t.category_id IS NULL AND t.transfer_account_id IS NULL
         AND t.is_start=0 AND t.is_reconcile_adjustment=0 AND substr(t.date,1,7)<=?`
    )
    .get(currencyCode, month).c;

  return {
    month,
    currencyCode,
    months,
    maxMonth: addMonths(currentMonth(), 12),
    readyToAssign: state.readyToAssign,
    incomeThisMonth: state.inflow,
    assignedTotal: state.assignedTotal,
    overspentTotal,
    uncategorizedCount,
    groups,
    ageOfMoney: ageOfMoney(currencyCode),
  };
}

api.get("/budget/:month", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const p = budgetPayload(req.params.month, currencyCode);
    if (!p) return bad(res, "bad month");
    res.json(p);
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.put("/budget/:month/category/:categoryId/assign", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const { month, categoryId } = req.params;
    const cents = Math.round(Number(req.body?.assigned));
    if (!Number.isFinite(cents) || cents < 0) return bad(res, "invalid amount");
    assignBudget(db, { currencyCode, month, categoryId, assignedMinor: cents });
    res.json(budgetPayload(month, currencyCode));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.post("/budget/:month/move", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const { month } = req.params;
    const { fromId, toId, amount } = req.body || {};
    const cents = Math.round(Number(amount));
    if (!fromId || !toId || fromId === toId) return bad(res, "select different categories");
    if (!Number.isFinite(cents) || cents <= 0) return bad(res, "invalid amount");
    const run = db.transaction(() => {
      adjustAssignment(db, month, fromId, -cents, currencyCode);
      adjustAssignment(db, month, toId, cents, currencyCode);
    });
    run();
    res.json(budgetPayload(month, currencyCode));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.post("/budget/:month/cover", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const { month } = req.params;
    const { categoryId, fromId } = req.body || {};
    assertAssignmentTarget(db, categoryId, currencyCode);
    if (fromId && fromId !== "rta") assertAssignmentTarget(db, fromId, currencyCode);
    const p = budgetPayload(month, currencyCode);
    const overspent = -(p.groups.flatMap((g) => g.categories).find((c) => c.id === categoryId)?.available || 0);
    if (overspent <= 0) return bad(res, "no overspending to cover");
    let amount = overspent;
    if (fromId !== "rta") {
      const donor = p.groups.flatMap((g) => g.categories).find((c) => c.id === fromId);
      if (!donor) return bad(res, "donor not found");
      amount = Math.min(overspent, Math.max(donor.available, 0));
      if (amount <= 0) return bad(res, "donor has no available funds");
    }
    const run = db.transaction(() => {
      if (fromId !== "rta") adjustAssignment(db, month, fromId, -amount, currencyCode);
      adjustAssignment(db, month, categoryId, amount, currencyCode);
    });
    run();
    res.json(budgetPayload(month, currencyCode));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.post("/budget/:month/copy-previous", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const { month } = req.params;
    if (!/^\d{4}-\d{2}$/.test(month)) return bad(res, "bad month");
    const prev = addMonths(month, -1);
    const rows = db
      .prepare("SELECT category_id, assigned FROM assignments WHERE month=? AND currency_code=?")
      .all(prev, currencyCode);
    if (rows.length > 0) {
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM assignments WHERE month=? AND currency_code=?").run(month, currencyCode);
        const ins = db.prepare("INSERT INTO assignments(currency_code,month,category_id,assigned) VALUES(?,?,?,?)");
        for (const r of rows) ins.run(currencyCode, month, r.category_id, r.assigned);
      });
      tx();
    }
    res.json(budgetPayload(month, currencyCode));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.post("/budget/:month/auto-assign", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const { month } = req.params;
    const p = budgetPayload(month, currencyCode);
    let rta = p.readyToAssign;

    const flat = p.groups.flatMap((g) => g.categories.map((c) => ({ ...c, groupId: g.id })));
    const ccCats = flat.filter((c) => c.available < 0 && c.id.startsWith("cc:"));
    for (const c of ccCats) {
      if (rta <= 0) break;
      const amt = Math.min(-c.available, rta);
      adjustAssignment(db, month, c.id, amt, currencyCode);
      rta -= amt;
    }
    const withGoals = flat.filter((c) => !c.id.startsWith("cc:") && c.goal && c.need && c.need.need > 0);
    for (const c of withGoals) {
      if (rta <= 0) break;
      const amt = Math.min(c.need.need, rta);
      adjustAssignment(db, month, c.id, amt, currencyCode);
      rta -= amt;
    }
    res.json(budgetPayload(month, currencyCode));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.get("/accounts", (req, res) => {
  res.json({ accounts: accountsWithBalances() });
});

api.post("/accounts", (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) return bad(res, "name required");
  if (!body.type) return bad(res, "type required");
  try {
    const id = createAccountRecord(
      db,
      {
        name: body.name,
        type: body.type,
        currencyCode: body.currencyCode,
        startingBalanceMinor: parseStartingBalanceMinor(body),
        startingDate: body.startingDate || todayYmd(),
      },
      { requireCurrency: true, uid, nowIso, todayYmd: todayYmd() }
    );
    res.json({ id, accounts: accountsWithBalances() });
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.put("/accounts/:id", (req, res) => {
  const acc = db.prepare("SELECT * FROM accounts WHERE id=?").get(req.params.id);
  if (!acc) return bad(res, "not found");
  const { name, closed, currencyCode } = req.body || {};
  try {
    const apply = db.transaction(() => {
      if (typeof currencyCode === "string") changeAccountCurrency(db, acc.id, currencyCode);
      if (typeof name === "string" && name.trim()) db.prepare("UPDATE accounts SET name=? WHERE id=?").run(name.trim(), acc.id);
      if (typeof closed === "boolean") {
        const bal = accountsWithBalances().find((a) => a.id === acc.id)?.balance || 0;
        if (closed && bal !== 0 && isCreditType(acc.type)) throw new Error("balance must be zero");
        db.prepare("UPDATE accounts SET closed=? WHERE id=?").run(closed ? 1 : 0, acc.id);
      }
    });
    apply();
  } catch (e) {
    if (e instanceof Error && e.message === "balance must be zero") return bad(res, e.message);
    return sendAccountCurrencyError(res, e);
  }
  res.json({ accounts: accountsWithBalances() });
});

api.delete("/accounts/:id", (req, res) => {
  const n = db
    .prepare("SELECT COUNT(*) c FROM transactions WHERE (account_id=? OR transfer_account_id=?) AND is_start=0")
    .get(req.params.id, req.params.id).c;
  if (n > 0) return bad(res, "has transactions");
  db.prepare("DELETE FROM accounts WHERE id=?").run(req.params.id);
  res.json({ accounts: accountsWithBalances() });
});

api.get("/accounts/:id/transactions", (req, res) => {
  const acc = db.prepare("SELECT * FROM accounts WHERE id=?").get(req.params.id);
  if (!acc) return bad(res, "not found");
  const rows = db
    .prepare(
      `SELECT t.*, c.name AS category_name, o.name AS other_account_name, o.type AS other_account_type,
              o.currency_code AS other_currency_code,
              (SELECT t2.amount FROM transactions t2
                WHERE t.pair_id IS NOT NULL AND t2.pair_id=t.pair_id AND t2.id!=t.id LIMIT 1) AS other_amount
       FROM transactions t
       LEFT JOIN categories c ON c.id=t.category_id
       LEFT JOIN accounts o ON o.id=t.transfer_account_id
       WHERE t.account_id=? ORDER BY t.date, t.rowid`
    )
    .all(req.params.id);
  let running = acc.starting_balance;
  const out = [];
  for (const r of rows) {
    if (!r.is_start) running += r.amount;
    out.push({ ...transformTx(r, acc.currency_code), balance: running });
  }
  res.json({ account: presentAccount(acc, { balance: running }), transactions: out.reverse() });
});

function transformTx(r, accountCurrencyCode) {
  return {
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    payeeName: r.payee_name === "__starting__" || r.payee_name === "__reconciling__" ? null : r.payee_name,
    isStart: !!r.is_start,
    transferAccountId: r.transfer_account_id,
    otherAccountName: r.other_account_name,
    otherAccountType: r.other_account_type,
    otherAccountCurrencyCode: r.other_currency_code ?? null,
    otherAmountMinor: r.other_amount ?? null,
    categoryId: r.category_id,
    categoryName: r.category_name,
    memo: r.memo,
    amount: r.amount,
    cleared: r.cleared,
    reconciled: r.reconciled,
    account_name: r.account_name,
    currencyCode: accountCurrencyCode ?? r.account_currency_code ?? r.currency_code ?? null,
    originalCurrencyCode: r.original_currency_code ?? null,
    originalAmountMinor: r.original_amount ?? null,
  };
}

api.get("/transactions", (req, res) => {
  const { search, uncategorized, accountId } = req.query;
  let where = `
             FROM transactions t
             LEFT JOIN categories c ON c.id=t.category_id
             JOIN accounts a ON a.id=t.account_id
             LEFT JOIN accounts o ON o.id=t.transfer_account_id
             WHERE t.is_start=0`;
  const args = [];
  if (search) {
    where += " AND (t.payee_name LIKE ? OR t.memo LIKE ? OR c.name LIKE ?)";
    const like = `%${search}%`;
    args.push(like, like, like);
  }
  if (uncategorized === "1") where += " AND t.category_id IS NULL AND t.transfer_account_id IS NULL AND t.is_reconcile_adjustment=0";
  if (accountId) {
    where += " AND t.account_id=?";
    args.push(String(accountId));
  }
  where +=
    " AND NOT (t.amount > 0 AND t.transfer_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM accounts o2 WHERE o2.id=t.transfer_account_id AND o2.on_budget=1))";
  const total = db.prepare("SELECT COUNT(*) c " + where).get(...args).c;
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 500, 1), 2000);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const rows = db
    .prepare(
      `SELECT t.*, c.name AS category_name, a.name AS account_name, a.type AS account_type,
              a.currency_code AS account_currency_code,
              o.name AS other_account_name, o.type AS other_account_type,
              o.currency_code AS other_currency_code,
              (SELECT t2.amount FROM transactions t2
                WHERE t.pair_id IS NOT NULL AND t2.pair_id=t.pair_id AND t2.id!=t.id LIMIT 1) AS other_amount
       ${where}
       ORDER BY t.date DESC, t.rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset);
  res.json({ total, transactions: rows.map((row) => transformTx(row, row.account_currency_code)) });
});

api.patch("/transactions/:id/category", (req, res) => {
  try {
    setTransactionCategory(db, req.params.id, req.body?.categoryId || null);
    res.json({ ok: true });
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.post("/transactions/bulk-category", (req, res) => {
  try {
    const result = setTransactionsCategory(db, req.body?.ids, req.body?.categoryId || null);
    res.json(result);
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.post("/transactions/bulk-delete", (req, res) => {
  try {
    const result = deleteTransactions(db, req.body?.ids);
    res.json(result);
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.post("/transactions", (req, res) => {
  const body = req.body || {};
  try {
    const transfer = transferInputFromHttp(body);
    if (transfer) postTransfer(db, transfer);
    else postTransaction(db, body);
    res.json({ ok: true });
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.post("/transfers", (req, res) => {
  try {
    const posted = postTransfer(db, req.body || {});
    res.json({ ok: true, ...posted });
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.put("/transactions/:id", (req, res) => {
  try {
    updateTransaction(db, req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.delete("/transactions/:id", (req, res) => {
  try {
    deleteTransaction(db, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.patch("/transactions/:id/cleared", (req, res) => {
  try {
    const v = Number(req.body?.cleared);
    setTransactionCleared(db, req.params.id, v);
    res.json({ ok: true });
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

// 对账完成：以银行/现实的「实际余额」与当前计算余额比对；
// 不一致时自动创建一条差额流水兜底抹平 —— category_id 留空使其影响未分配（Ready to Assign），
// is_reconcile_adjustment=1 使其不计入「未分类」提醒；随后把已清算流水锁定为已对账。
api.post("/reconcile/:accountId", (req, res) => {
  try {
    const body = req.body || {};
    const result = reconcileAccount(db, {
      accountId: req.params.accountId,
      statementBalance: body.statementBalance,
      markCleared: body.markCleared,
      asOfDate: todayYmd(),
    });
    res.json(result);
  } catch (e) {
    return sendLedgerError(res, e);
  }
});

api.get("/categories", (req, res) => {
  res.json({ groups: groupsWithCategories() });
});

api.post("/category-groups", (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return bad(res, "name required");
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM category_groups").get().m;
  const id = uid();
  db.prepare("INSERT INTO category_groups(id,name,sort_order) VALUES(?,?,?)").run(id, name, maxOrder + 1);
  res.json({ id });
});

api.put("/category-groups/:id", (req, res) => {
  const g = db.prepare("SELECT * FROM category_groups WHERE id=?").get(req.params.id);
  if (!g) return bad(res, "not found");
  const name = (req.body?.name ?? g.name).trim();
  const hidden = typeof req.body?.hidden === "boolean" ? (req.body.hidden ? 1 : 0) : g.hidden;
  if (hidden && g.is_income) return bad(res, "cannot hide income group");
  db.prepare("UPDATE category_groups SET name=?, hidden=? WHERE id=?").run(name || g.name, hidden, g.id);
  res.json({ ok: true });
});

api.delete("/category-groups/:id", (req, res) => {
  const n = db.prepare("SELECT COUNT(*) c FROM categories WHERE group_id=?").get(req.params.id).c;
  if (n > 0) return bad(res, "group not empty");
  db.prepare("DELETE FROM category_groups WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

api.post("/categories", (req, res) => {
  const { groupId, name } = req.body || {};
  if (!groupId || !(name || "").trim()) return bad(res, "groupId and name required");
  const g = db.prepare("SELECT * FROM category_groups WHERE id=?").get(groupId);
  if (!g) return bad(res, "group not found");
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM categories WHERE group_id=?").get(groupId).m;
  const id = uid();
  db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(id, groupId, name.trim(), maxOrder + 1);
  res.json({ id });
});

api.put("/categories/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM categories WHERE id=?").get(req.params.id);
  if (!c) return bad(res, "not found");
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "note")) {
      updateCategoryNote(db, { categoryId: c.id, note: req.body.note });
    }
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      db.prepare("UPDATE categories SET name=? WHERE id=?").run(name || c.name, c.id);
    }
    res.json({ ok: true });
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.delete("/categories/:id", (req, res) => {
  try {
    assertCategoryDeletable(db, req.params.id);
  } catch (e) {
    return sendLedgerError(res, e);
  }
  const usedTx = db.prepare("SELECT COUNT(*) c FROM transactions WHERE category_id=?").get(req.params.id).c;
  const usedAs = db.prepare("SELECT COUNT(*) c FROM assignments WHERE category_id=?").get(req.params.id).c;
  if (usedTx > 0 || usedAs > 0) return bad(res, "in use");
  db.prepare("DELETE FROM goals WHERE category_id=?").run(req.params.id);
  db.prepare("DELETE FROM categories WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

api.put("/goals/:categoryId", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const c = db.prepare("SELECT * FROM categories WHERE id=?").get(req.params.categoryId);
    if (!c) return bad(res, "not found");
    const { type, target, targetMonth } = req.body || {};
    if (type == null) {
      setGoal(db, { currencyCode, categoryId: c.id, type: null });
      return res.json({ ok: true, currencyCode });
    }
    if (!["monthly", "targetBalance", "targetByDate"].includes(type)) return bad(res, "invalid type");
    const cents = Math.max(Math.round(Number(target) || 0), 0);
    setGoal(db, {
      currencyCode,
      categoryId: c.id,
      type,
      targetMinor: cents,
      targetMonth: type === "targetByDate" ? targetMonth || null : null,
    });
    res.json({ ok: true, currencyCode });
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.get("/reports/cashflow/:code", (req, res) => {
  try {
    const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
    res.json(reportsModule.buildCashflowDetail({ currencyCode: req.params.code, months }));
  } catch (e) {
    return sendReportsError(res, e);
  }
});

api.get("/reports/cashflow", (req, res) => {
  try {
    if (typeof req.query.currency === "string" && req.query.currency) {
      const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
      res.json(reportsModule.buildCashflowDetail({ currencyCode: req.query.currency, months }));
      return;
    }
    res.json(reportsModule.buildCashflowOverview());
  } catch (e) {
    return sendReportsError(res, e);
  }
});

api.get("/reports/overview", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const n = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
    res.json(reportsOverview(n, currencyCode));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.get("/reports/native", (req, res) => {
  try {
    const currencyCode = requestCurrency(req);
    const n = Math.min(Math.max(Number(req.query.months) || 12, 3), 24);
    res.json(buildNativeReport({ currencyCode, months: n }));
  } catch (e) {
    return sendAccountCurrencyError(res, e);
  }
});

api.get("/reports/net-worth", async (req, res) => {
  try {
    const report = await reportsModule.buildNetWorthReport({
      reportingCurrency: req.query.reportingCurrency,
      asOf: req.query.asOf,
      months: req.query.months,
    });
    res.json(report);
  } catch (e) {
    return sendReportsError(res, e);
  }
});

api.get("/investments", (req, res) => {
  try {
    res.json(
      investmentModule.listInvestmentAccounts({
        asOf: req.query.asOf,
        months: req.query.months,
      })
    );
  } catch (e) {
    return sendInvestmentError(res, e);
  }
});

api.get("/investments/:id", (req, res) => {
  try {
    const view = investmentModule.getInvestmentAccount({
      accountId: req.params.id,
      asOf: req.query.asOf,
      months: req.query.months,
    });
    res.json(view);
  } catch (e) {
    return sendInvestmentError(res, e);
  }
});

api.get("/fx/status", (req, res) => {
  res.json(fxModule.getStatus());
});

api.post("/fx/sync", async (req, res) => {
  try {
    const status = await fxModule.syncRates({
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
    });
    res.json(status);
  } catch (e) {
    return sendFxError(res, e);
  }
});

api.put("/fx/rates/:date/:from/:to", (req, res) => {
  try {
    fxModule.putManualRate({
      rateDate: req.params.date,
      baseCurrency: req.params.from,
      quoteCurrency: req.params.to,
      rate: req.body?.rate,
    });
    res.json({ ok: true });
  } catch (e) {
    return sendFxError(res, e);
  }
});

api.delete("/fx/rates/:date/:from/:to", (req, res) => {
  try {
    fxModule.deleteManualRate({
      rateDate: req.params.date,
      baseCurrency: req.params.from,
      quoteCurrency: req.params.to,
    });
    res.json({ ok: true });
  } catch (e) {
    return sendFxError(res, e);
  }
});
