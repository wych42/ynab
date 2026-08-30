import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrations } from "./migrations.mjs";
import { ensureCurrencyMigrationState, isCurrencyMigrationRequired } from "./currency-state.mjs";
import { createAccountRecord } from "./account-currency.mjs";
import { ensureSystemCategories } from "./currency-ledger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function isValidTimezone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function readSetting(database, key, fallback = null) {
  const row = database.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : fallback;
}

function writeSetting(database, key, value) {
  database
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}

export function runMigrations(database) {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
  const appliedVersions = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
  const record = database.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)");
  // 表重建类迁移需要 DROP/RENAME 被引用的父表，外键必须在事务外关闭，结束后恢复
  const fkEnabled = !!database.pragma("foreign_keys", { simple: true });
  if (fkEnabled) database.pragma("foreign_keys = OFF");
  try {
    for (const m of migrations) {
      if (appliedVersions.has(m.version)) continue;
      if (m.version <= Math.max(0, ...appliedVersions)) {
        throw new Error(`[db] migration version ${m.version} is older than an already applied migration; versions must only grow`);
      }
      const run = database.transaction(() => {
        m.up(database);
        record.run(m.version, m.name, nowIso());
      });
      try {
        run();
        console.log(`[db] applied migration ${m.version}: ${m.name}`);
      } catch (e) {
        console.error(`[db] migration ${m.version} (${m.name}) failed:`, e.message);
        throw e;
      }
    }
  } finally {
    if (fkEnabled) database.pragma("foreign_keys = ON");
  }
}

function seedDefaultCategories(database) {
  const groups = [
    ["日常开销", ["食品杂货", "餐饮外出", "交通出行", "日用百货", "话费网费"]],
    ["账单", ["房租房贷", "水电燃气", "订阅服务", "医疗保险"]],
    ["储蓄目标", ["应急基金", "旅行基金", "大额购物", "投资理财"]],
    ["其他支出", ["医疗健康", "学习提升", "人情往来", "宠物花费", "其他"]],
  ];
  const insG = database.prepare("INSERT INTO category_groups(id,name,sort_order) VALUES(?,?,?)");
  const insC = database.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)");
  const tx = database.transaction(() => {
    groups.forEach(([gname, cats], gi) => {
      const gid = uid();
      insG.run(gid, gname, gi);
      cats.forEach((cname, ci) => insC.run(uid(), gid, cname, ci));
    });
  });
  tx();
}

function defaultTimezone() {
  try {
    const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sysTz && isValidTimezone(sysTz)) return sysTz;
  } catch {}
  return "UTC";
}

function ensureAppInitialized(database) {
  if (!readSetting(database, "initialized")) {
    writeSetting(database, "currency_symbol", "¥");
    writeSetting(database, "language", "zh");
    writeSetting(database, "ai_base_url", "https://api.openai.com/v1");
    writeSetting(database, "ai_model", "gpt-4o-mini");
    writeSetting(database, "ai_key", "");
    writeSetting(database, "ai_require_confirmation", "1");
    writeSetting(database, "timezone", defaultTimezone());
    seedDefaultCategories(database);
    writeSetting(database, "initialized", "1");
  }
  if (!readSetting(database, "ai_require_confirmation")) {
    writeSetting(database, "ai_require_confirmation", "1");
  }
  if (!readSetting(database, "timezone")) {
    writeSetting(database, "timezone", defaultTimezone());
  }
}

export function openBudgetDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new Database(filePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  runMigrations(database);
  ensureAppInitialized(database);
  ensureCurrencyMigrationState(database);
  if (!isCurrencyMigrationRequired(database)) ensureSystemCategories(database);
  return database;
}

export const db = openBudgetDatabase(path.join(DATA_DIR, "budget.db"));

export function getSetting(key, fallback = null) {
  return readSetting(db, key, fallback);
}

export function setSetting(key, value) {
  writeSetting(db, key, value);
}

export { ensureCurrencyMigrationState };

const CREDIT_TYPES = new Set(["creditCard", "lineOfCredit", "studentLoan", "personalLoan", "otherLiability"]);
const ACCOUNT_TYPES = [
  { type: "checking", onBudget: 1 },
  { type: "savings", onBudget: 1 },
  { type: "cash", onBudget: 1 },
  { type: "creditCard", onBudget: 1 },
  { type: "lineOfCredit", onBudget: 0 },
  { type: "investment", onBudget: 0 },
  { type: "property", onBudget: 0 },
  { type: "vehicle", onBudget: 0 },
  { type: "otherAsset", onBudget: 0 },
  { type: "studentLoan", onBudget: 0 },
  { type: "personalLoan", onBudget: 0 },
  { type: "otherLiability", onBudget: 0 },
];
export const isCreditType = (t) => CREDIT_TYPES.has(t);

export function createAccount({ name, type, startingBalance = 0, startingDate = null, currencyCode, startingBalanceMinor }) {
  return createAccountRecord(
    db,
    {
      name,
      type,
      currencyCode,
      startingBalanceMinor: startingBalanceMinor ?? Math.round(Number(startingBalance) || 0),
      startingDate: startingDate || todayYmd(),
    },
    { requireCurrency: false, uid, nowIso, todayYmd: todayYmd() }
  );
}

export function getTimezone() {
  const v = getSetting("timezone", "");
  if (v && isValidTimezone(v)) return v;
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sys && isValidTimezone(sys)) return sys;
  } catch {}
  return "UTC";
}

export function ymd(d, timeZone) {
  const tz = timeZone || getTimezone();
  // en-CA locale formats as YYYY-MM-DD, respected timeZone
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

export function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function endOfMonth(ymStr) {
  const [y, m] = ymStr.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
}

export function todayYmd(timeZone) {
  return ymd(new Date(), timeZone || getTimezone());
}

export function currentMonth(timeZone) {
  return todayYmd(timeZone).slice(0, 7);
}

export { CREDIT_TYPES, ACCOUNT_TYPES };
