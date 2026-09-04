export const CATEGORY_REVISION_KEY = "category_revision";
export const BUDGET_REVISION_CONFLICT = "budget_revision_conflict";
export const CATEGORY_REVISION_CONFLICT = "category_revision_conflict";
export const EXPECTED_REVISION_REQUIRED = "expected_revision_required";

export class BudgetRevisionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "BudgetRevisionError";
    this.code = code;
    this.status = 409;
    this.extra = extra;
  }
}

export function isBudgetRevisionError(error) {
  return error instanceof BudgetRevisionError;
}

function uniqueCodes(currencyCodes) {
  return [...new Set((currencyCodes || []).filter(Boolean))];
}

export function readLedgerRevision(database, currencyCode) {
  const row = database.prepare("SELECT revision FROM currency_ledgers WHERE currency_code=?").get(currencyCode);
  return row ? row.revision : 0;
}

export function bumpLedgerRevision(database, currencyCode) {
  database.prepare("UPDATE currency_ledgers SET revision = revision + 1 WHERE currency_code=?").run(currencyCode);
  return readLedgerRevision(database, currencyCode);
}

export function readCategoryRevision(database) {
  const row = database.prepare("SELECT value FROM settings WHERE key=?").get(CATEGORY_REVISION_KEY);
  if (!row) return 0;
  const value = Number(row.value);
  return Number.isInteger(value) ? value : 0;
}

export function bumpCategoryRevision(database) {
  const next = readCategoryRevision(database) + 1;
  database
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(CATEGORY_REVISION_KEY, String(next));
  return next;
}

export function parsePageExpectedRevision(expectedRevision) {
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    const error = new Error("expectedRevision is required");
    error.code = EXPECTED_REVISION_REQUIRED;
    error.status = 400;
    throw error;
  }
  return expectedRevision;
}

export function isExpectedRevisionRequiredError(error) {
  return error?.code === EXPECTED_REVISION_REQUIRED;
}

export function assertLedgerRevision(database, currencyCode, expectedRevision) {
  const current = readLedgerRevision(database, currencyCode);
  if (expectedRevision == null) return current;
  if (expectedRevision !== current) {
    throw new BudgetRevisionError(BUDGET_REVISION_CONFLICT, "budget was updated on another device", {
      currencyCode,
      revision: current,
    });
  }
  return current;
}

export function assertCategoryRevision(database, expectedCategoryRevision) {
  const current = readCategoryRevision(database);
  if (expectedCategoryRevision == null) return current;
  if (expectedCategoryRevision !== current) {
    throw new BudgetRevisionError(CATEGORY_REVISION_CONFLICT, "categories were updated on another device", {
      categoryRevision: current,
    });
  }
  return current;
}

export function bumpLedgerRevisions(database, currencyCodes) {
  for (const code of uniqueCodes(currencyCodes)) bumpLedgerRevision(database, code);
}

export function applyLedgerRevisionGuard(database, currencyCodes, expectedRevision) {
  const codes = uniqueCodes(currencyCodes);
  const isMap = expectedRevision && typeof expectedRevision === "object" && !Array.isArray(expectedRevision);
  for (const code of codes) {
    const expected = isMap ? expectedRevision[code] : expectedRevision;
    assertLedgerRevision(database, code, expected);
  }
}

export function runBudgetWrite(database, currencyCodes, expectedRevision, fn) {
  const run = database.transaction(() => {
    applyLedgerRevisionGuard(database, currencyCodes, expectedRevision);
    const result = fn();
    bumpLedgerRevisions(database, currencyCodes);
    return result;
  });
  return run();
}

export function runCategoryWrite(database, expectedCategoryRevision, fn) {
  const run = database.transaction(() => {
    assertCategoryRevision(database, expectedCategoryRevision);
    const result = fn();
    bumpCategoryRevision(database);
    return result;
  });
  return run();
}
