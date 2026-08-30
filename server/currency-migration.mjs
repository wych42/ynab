import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { assertSupportedCurrency, getExponent, isSupportedCurrency, listCurrencies } from "./money.mjs";
import {
  CURRENCY_MIGRATION_COMPLETE,
  CURRENCY_MIGRATION_PENDING,
  CURRENCY_MIGRATION_STATUS_KEY,
  REPORTING_CURRENCY_KEY,
  createCurrencyLedger,
  ensureCurrencyMigrationState,
  isCurrencyMigrationRequired,
  listEnabledCurrencyCodes,
  seedDefaultCurrencyLedgers,
} from "./currency-state.mjs";
import { rebuildAssignmentsWithCurrency, rebuildGoalsWithCurrency } from "./currency-schema.mjs";

export const CURRENCY_MIGRATION_BACKUP_DIR_NAME = "currency-migration-backups";

const SYMBOL_SUGGESTIONS = {
  "¥": "CNY",
  "￥": "CNY",
  "S$": "SGD",
  "SG$": "SGD",
  "C$": "CAD",
  "CA$": "CAD",
  "€": "EUR",
  "£": "GBP",
};

export class CurrencyMigrationError extends Error {
  constructor(code, message, extra = {}) {
    super(message, extra.cause ? { cause: extra.cause } : undefined);
    this.name = "CurrencyMigrationError";
    this.code = code;
    if (extra.anomalies) this.anomalies = extra.anomalies;
    if (extra.backup) this.backup = extra.backup;
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function utcStamp(date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}-${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`;
}

function schemaVersion(database) {
  return database.prepare("SELECT MAX(version) v FROM schema_migrations").get().v ?? 0;
}

function resolveDataDir(dataDir) {
  if (typeof dataDir === "string" && dataDir.trim()) return dataDir.trim();
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  throw new CurrencyMigrationError("data_dir_required", "dataDir is required for currency migration backup");
}

export function suggestCurrencyFromSymbol(symbol) {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed || trimmed === "$") return null;
  const code = SYMBOL_SUGGESTIONS[trimmed];
  if (!code || !isSupportedCurrency(code)) return null;
  return code;
}

export function getCurrencyMigrationPreview(database) {
  const symbol = readSetting(database, "currency_symbol", "") ?? "";
  const required = isCurrencyMigrationRequired(database);
  return {
    status: required ? CURRENCY_MIGRATION_PENDING : CURRENCY_MIGRATION_COMPLETE,
    currencyMigrationRequired: required,
    currencySymbol: symbol,
    suggestedCurrency: suggestCurrencyFromSymbol(symbol),
    supportedCurrencies: listCurrencies(),
  };
}

function legacyAmountScaleFactor(currencyCode, getExp) {
  const exponent = getExp(currencyCode);
  if (exponent === 2) return 1;
  if (exponent === 0) return 100;
  throw new CurrencyMigrationError(
    "unsupported_legacy_scale",
    `cannot convert legacy two-decimal amounts to ${currencyCode}`
  );
}

function collectScaleAnomalies(database, scale) {
  if (scale === 1) return [];
  const anomalies = [];
  for (const row of database.prepare("SELECT id, starting_balance AS value FROM accounts ORDER BY id").all()) {
    if (row.value % scale !== 0) {
      anomalies.push({ table: "accounts", id: row.id, field: "starting_balance", value: row.value });
    }
  }
  for (const row of database.prepare("SELECT id, amount AS value FROM transactions ORDER BY id").all()) {
    if (row.value % scale !== 0) {
      anomalies.push({ table: "transactions", id: row.id, field: "amount", value: row.value });
    }
  }
  for (const row of database
    .prepare("SELECT month, category_id, assigned AS value FROM assignments ORDER BY month, category_id")
    .all()) {
    if (row.value % scale !== 0) {
      anomalies.push({
        table: "assignments",
        id: `${row.month}:${row.category_id}`,
        field: "assigned",
        value: row.value,
      });
    }
  }
  for (const row of database.prepare("SELECT category_id, target AS value FROM goals ORDER BY category_id").all()) {
    if (row.value % scale !== 0) {
      anomalies.push({ table: "goals", id: row.category_id, field: "target", value: row.value });
    }
  }
  return anomalies;
}

async function createPreTransformBackup(database, dataDir, now) {
  const dir = path.join(dataDir, CURRENCY_MIGRATION_BACKUP_DIR_NAME);
  await fs.promises.mkdir(dir, { recursive: true });
  const base = `budget-pre-currency-v${schemaVersion(database)}-${utcStamp(now)}`;
  let fileName = `${base}.sqlite`;
  while (fs.existsSync(path.join(dir, fileName))) {
    fileName = `${base}-${crypto.randomBytes(2).toString("hex")}.sqlite`;
  }
  const filePath = path.join(dir, fileName);
  const tmp = path.join(dir, `.tmp-pre-currency-${process.pid}-${Date.now()}.sqlite`);
  try {
    await database.backup(tmp);
    fs.renameSync(tmp, filePath);
    return { fileName, filePath };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // renamed away or never created
    }
  }
}

function applyLegacyCurrencyTransform(database, currencyCode, scale, money) {
  seedDefaultCurrencyLedgers(database);
  createCurrencyLedger(database, currencyCode, { money, sortOrder: 80 });

  if (scale !== 1) {
    database.prepare("UPDATE accounts SET starting_balance = starting_balance / ?").run(scale);
    database.prepare("UPDATE transactions SET amount = amount / ?").run(scale);
    database.prepare("UPDATE assignments SET assigned = assigned / ?").run(scale);
    database.prepare("UPDATE goals SET target = target / ?").run(scale);
  }

  database.prepare("UPDATE accounts SET currency_code = ?").run(currencyCode);
  database.prepare("UPDATE assignments SET currency_code = ?").run(currencyCode);
  database.prepare("UPDATE goals SET currency_code = ?").run(currencyCode);

  rebuildAssignmentsWithCurrency(database);
  rebuildGoalsWithCurrency(database);

  writeSetting(database, REPORTING_CURRENCY_KEY, currencyCode);
  writeSetting(database, CURRENCY_MIGRATION_STATUS_KEY, CURRENCY_MIGRATION_COMPLETE);
}

export async function confirmCurrencyMigration(database, currencyCode, options = {}) {
  if (typeof currencyCode !== "string" || !currencyCode.trim()) {
    throw new CurrencyMigrationError("currency_code_required", "currency code is required");
  }
  const code = currencyCode.trim();
  const money = options.money;
  const assertCode = money?.assertSupportedCurrency ?? assertSupportedCurrency;
  const exponentOf = money?.getExponent ?? getExponent;
  assertCode(code);

  const status = ensureCurrencyMigrationState(database);
  if (status === CURRENCY_MIGRATION_COMPLETE) {
    return { status: CURRENCY_MIGRATION_COMPLETE, alreadyCompleted: true };
  }

  const scale = legacyAmountScaleFactor(code, exponentOf);
  const anomalies = collectScaleAnomalies(database, scale);
  if (anomalies.length) {
    throw new CurrencyMigrationError(
      "legacy_scale_not_divisible",
      "legacy amounts are not divisible for the target currency",
      { anomalies }
    );
  }

  const dataDir = resolveDataDir(options.dataDir);
  let backup;
  try {
    backup = await createPreTransformBackup(database, dataDir, options.now ?? new Date());
  } catch (error) {
    if (error instanceof CurrencyMigrationError) throw error;
    throw new CurrencyMigrationError("currency_migration_backup_failed", "currency migration backup failed", {
      cause: error,
    });
  }

  try {
    const transform = database.transaction(() => {
      applyLegacyCurrencyTransform(database, code, scale, money);
    });
    transform();
  } catch (error) {
    throw new CurrencyMigrationError("currency_migration_failed", "currency migration failed after backup", {
      backup,
      cause: error,
    });
  }

  return {
    status: CURRENCY_MIGRATION_COMPLETE,
    alreadyCompleted: false,
    currencyCode: code,
    reportingCurrency: code,
    enabledCurrencies: listEnabledCurrencyCodes(database),
    backup,
  };
}

export function restoreCurrencyMigrationBackup({ backupPath, destPath, currentDatabasePath } = {}) {
  if (!backupPath || !destPath) {
    throw new CurrencyMigrationError("restore_path_required", "backupPath and destPath are required");
  }
  const resolvedDest = path.resolve(destPath);
  if (currentDatabasePath && resolvedDest === path.resolve(currentDatabasePath)) {
    throw new CurrencyMigrationError(
      "restore_would_overwrite_open_db",
      "refusing to overwrite the currently open database"
    );
  }
  if (!fs.existsSync(backupPath)) {
    throw new CurrencyMigrationError("backup_not_found", "currency migration backup was not found");
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(backupPath, destPath);
  return destPath;
}

export function openCurrencyMigrationBackup(filePath) {
  return new Database(filePath, { readonly: true, fileMustExist: true });
}
