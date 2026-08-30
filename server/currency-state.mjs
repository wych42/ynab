import { assertSupportedCurrency, listCurrencies, listDefaultEnabledCurrencies } from "./money.mjs";

export const CURRENCY_MIGRATION_STATUS_KEY = "currency_migration_status";
export const REPORTING_CURRENCY_KEY = "reporting_currency";
export const CURRENCY_MIGRATION_PENDING = "pending";
export const CURRENCY_MIGRATION_COMPLETE = "complete";
export const CURRENCY_MIGRATION_LOCK_ERROR = "currency_migration_required";

function readSetting(database, key, fallback = null) {
  const row = database.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : fallback;
}

function writeSetting(database, key, value) {
  database
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}

function hasUnassignedFinancialData(database) {
  const count = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM accounts) +
         (SELECT COUNT(*) FROM transactions) +
         (SELECT COUNT(*) FROM assignments) +
         (SELECT COUNT(*) FROM goals)
       AS c`
    )
    .get().c;
  return count > 0;
}

export function listEnabledCurrencyCodes(database) {
  return database
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY sort_order, currency_code")
    .all()
    .map((row) => row.currency_code);
}

export function createCurrencyLedger(database, currencyCode, { money, sortOrder = 0 } = {}) {
  const assertCode = money?.assertSupportedCurrency ?? assertSupportedCurrency;
  assertCode(currencyCode);
  database
    .prepare(
      "INSERT INTO currency_ledgers(currency_code, sort_order) VALUES (?, ?) ON CONFLICT(currency_code) DO NOTHING"
    )
    .run(currencyCode, sortOrder);
}

export function seedDefaultCurrencyLedgers(database) {
  listDefaultEnabledCurrencies().forEach((currency, index) => {
    createCurrencyLedger(database, currency.code, { sortOrder: index });
  });
}

export function ensureCurrencyMigrationState(database) {
  const existing = readSetting(database, CURRENCY_MIGRATION_STATUS_KEY);
  if (existing === CURRENCY_MIGRATION_PENDING || existing === CURRENCY_MIGRATION_COMPLETE) {
    return existing;
  }
  // 存量账户/金额只进入 pending，不读取 currency_symbol，也不回填币种。
  if (hasUnassignedFinancialData(database)) {
    writeSetting(database, CURRENCY_MIGRATION_STATUS_KEY, CURRENCY_MIGRATION_PENDING);
    return CURRENCY_MIGRATION_PENDING;
  }
  seedDefaultCurrencyLedgers(database);
  writeSetting(database, CURRENCY_MIGRATION_STATUS_KEY, CURRENCY_MIGRATION_COMPLETE);
  return CURRENCY_MIGRATION_COMPLETE;
}

export function isCurrencyMigrationRequired(database) {
  return readSetting(database, CURRENCY_MIGRATION_STATUS_KEY) === CURRENCY_MIGRATION_PENDING;
}

export function getCurrencyBootstrapState(database) {
  const reporting = readSetting(database, REPORTING_CURRENCY_KEY);
  return {
    currencyMigrationRequired: isCurrencyMigrationRequired(database),
    supportedCurrencies: listCurrencies(),
    enabledCurrencies: listEnabledCurrencyCodes(database),
    reportingCurrency: reporting == null || reporting === "" ? null : reporting,
  };
}

export function currencyMigrationLockPayload() {
  return { error: CURRENCY_MIGRATION_LOCK_ERROR, code: CURRENCY_MIGRATION_LOCK_ERROR };
}
