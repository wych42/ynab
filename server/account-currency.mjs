import crypto from "node:crypto";
import { MoneyError, assertSupportedCurrency } from "./money.mjs";
import {
  REPORTING_CURRENCY_KEY,
  createCurrencyLedger,
  listEnabledCurrencyCodes,
} from "./currency-state.mjs";

export class AccountCurrencyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccountCurrencyError";
    this.code = code;
  }
}

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

const USER_LEDGER_SORT_ORDER = 80;

function readSetting(database, key) {
  const row = database.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : null;
}

function writeSetting(database, key, value) {
  database
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}

function defaultUid() {
  return crypto.randomUUID();
}

function defaultNowIso() {
  return new Date().toISOString();
}

export function presentAccount(row, extra = {}) {
  if (!row) return row;
  const { currency_code: _currencyCode, ...rest } = row;
  return { ...rest, currencyCode: row.currency_code ?? null, ...extra };
}

export function isAccountCurrencyError(error) {
  return error instanceof MoneyError || error instanceof AccountCurrencyError;
}

export function parsePublicCurrencyCode(value) {
  if (typeof value !== "string") {
    throw new MoneyError("invalid_currency_code", "currency code must be 3 uppercase letters");
  }
  assertSupportedCurrency(value);
  return value;
}

export function requireEnabledCurrency(database, currencyCode) {
  const code = parsePublicCurrencyCode(currencyCode);
  if (!listEnabledCurrencyCodes(database).includes(code)) {
    throw new AccountCurrencyError("currency_not_enabled", `${code} is not an enabled currency`);
  }
  return code;
}

export function parseStartingBalanceMinor(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, "startingBalance")) {
    throw new MoneyError("invalid_amount", "startingBalance is not accepted; use startingBalanceMinor");
  }
  if (!Object.prototype.hasOwnProperty.call(body, "startingBalanceMinor")) {
    return 0;
  }
  const raw = body.startingBalanceMinor;
  if (typeof raw !== "number" || !Number.isInteger(raw) || !Number.isSafeInteger(raw)) {
    throw new MoneyError("invalid_amount", "startingBalanceMinor must be a safe integer");
  }
  return raw;
}

export function resolveInternalAccountCurrency(database) {
  const reporting = readSetting(database, REPORTING_CURRENCY_KEY);
  if (typeof reporting === "string" && reporting) {
    assertSupportedCurrency(reporting);
    return reporting;
  }
  const enabled = listEnabledCurrencyCodes(database);
  if (enabled.length > 0) return enabled[0];
  return null;
}

export function enableBuiltInCurrency(database, currencyCode) {
  const code = parsePublicCurrencyCode(currencyCode);
  createCurrencyLedger(database, code, { sortOrder: USER_LEDGER_SORT_ORDER });
  return code;
}

export function setReportingCurrency(database, currencyCode) {
  const code = parsePublicCurrencyCode(currencyCode);
  const enabled = listEnabledCurrencyCodes(database);
  if (!enabled.includes(code)) {
    throw new AccountCurrencyError("reporting_currency_not_enabled", `${code} is not an enabled currency`);
  }
  writeSetting(database, REPORTING_CURRENCY_KEY, code);
  return code;
}

export function currencyInUseReason(database, currencyCode) {
  const code = parsePublicCurrencyCode(currencyCode);
  const reporting = readSetting(database, REPORTING_CURRENCY_KEY);
  if (reporting === code) return "cannot_disable_reporting_currency";
  const hasAccount = database.prepare("SELECT 1 FROM accounts WHERE currency_code=? LIMIT 1").get(code);
  const hasAssignment = database.prepare("SELECT 1 FROM assignments WHERE currency_code=? LIMIT 1").get(code);
  const hasGoal = database.prepare("SELECT 1 FROM goals WHERE currency_code=? LIMIT 1").get(code);
  if (hasAccount || hasAssignment || hasGoal) return "currency_in_use";
  return null;
}

export function disableCurrency(database, currencyCode) {
  const code = parsePublicCurrencyCode(currencyCode);
  const reason = currencyInUseReason(database, code);
  if (reason) {
    throw new AccountCurrencyError(reason, `${code} cannot be disabled`);
  }
  database.prepare("DELETE FROM currency_ledgers WHERE currency_code=?").run(code);
  return code;
}

export function applyCurrencySettings(database, body = {}) {
  if (typeof body.enableCurrency === "string") {
    enableBuiltInCurrency(database, body.enableCurrency);
  }
  if (typeof body.disableCurrency === "string") {
    disableCurrency(database, body.disableCurrency);
  }
  if (typeof body.reportingCurrency === "string") {
    setReportingCurrency(database, body.reportingCurrency);
  }
}

function accountBalance(database, accountId) {
  return database
    .prepare(
      `SELECT a.starting_balance
              + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id=a.id AND t.is_start=0), 0)
              AS balance
       FROM accounts a WHERE a.id=?`
    )
    .get(accountId).balance;
}

function businessTransactionCount(database, accountId) {
  return database
    .prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_start=0")
    .get(accountId).c;
}

export function createAccountRecord(database, input, options = {}) {
  const requireCurrency = options.requireCurrency !== false;
  const uid = options.uid ?? defaultUid;
  const nowIso = options.nowIso ?? defaultNowIso;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("name required");
  const meta = ACCOUNT_TYPES.find((entry) => entry.type === input.type);
  if (!meta) throw new Error("invalid account type");

  let currencyCode = input.currencyCode;
  if (requireCurrency) {
    currencyCode = requireEnabledCurrency(database, currencyCode);
  } else if (currencyCode == null || currencyCode === "") {
    currencyCode = resolveInternalAccountCurrency(database);
  } else {
    currencyCode = requireEnabledCurrency(database, currencyCode);
  }

  const startingBalanceMinor = input.startingBalanceMinor ?? 0;
  if (typeof startingBalanceMinor !== "number" || !Number.isInteger(startingBalanceMinor) || !Number.isSafeInteger(startingBalanceMinor)) {
    throw new MoneyError("invalid_amount", "startingBalanceMinor must be a safe integer");
  }

  const startingDate = input.startingDate || options.todayYmd || new Date().toISOString().slice(0, 10);
  const id = uid();
  const createdAt = nowIso();

  const run = database.transaction(() => {
    database
      .prepare(
        "INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at,currency_code) VALUES(?,?,?,?,0,?,?,?,?,?)"
      )
      .run(id, name, input.type, meta.onBudget, startingBalanceMinor, startingDate, Date.now(), createdAt, currencyCode);
    if (startingBalanceMinor !== 0) {
      database
        .prepare(
          "INSERT INTO transactions(id,account_id,date,payee_name,amount,cleared,reconciled,is_start,created_at) VALUES(?,?,?,?,?,1,0,1,?)"
        )
        .run(uid(), id, startingDate, "__starting__", startingBalanceMinor, createdAt);
    }
  });
  run();
  return id;
}

export function changeAccountCurrency(database, accountId, currencyCode) {
  const code = requireEnabledCurrency(database, currencyCode);
  const acc = database.prepare("SELECT id FROM accounts WHERE id=?").get(accountId);
  if (!acc) throw new Error("not found");
  if (businessTransactionCount(database, accountId) > 0 || accountBalance(database, accountId) !== 0) {
    throw new AccountCurrencyError(
      "account_currency_locked",
      "account currency cannot change once it has a non-zero balance or non-start transactions"
    );
  }
  database.prepare("UPDATE accounts SET currency_code=? WHERE id=?").run(code, accountId);
  return code;
}
