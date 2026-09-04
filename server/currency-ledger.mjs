import crypto from "node:crypto";
import { MoneyError, assertSupportedCurrency } from "./money.mjs";

export const CURRENCY_TRANSFER_SYSTEM_KEY = "currency_transfer";
export const CURRENCY_TRANSFER_NAME = "换汇转出";

export class CurrencyLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CurrencyLedgerError";
    this.code = code;
  }
}

export function isCurrencyLedgerError(error) {
  return error instanceof CurrencyLedgerError || error instanceof MoneyError;
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function isIncomeCategory(database, categoryId) {
  if (!categoryId) return false;
  return !!database
    .prepare("SELECT 1 FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE c.id=? AND g.is_income=1")
    .get(categoryId);
}

function assertSafeInteger(value, label, code = "invalid_amount") {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new CurrencyLedgerError(code, `${label} must be a safe integer`);
  }
}

function parseDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new CurrencyLedgerError("invalid_account_or_date", "invalid account or date");
  }
  return date;
}

function parseBookedAmount(value) {
  if (value === undefined || value === null || value === "") {
    throw new CurrencyLedgerError("amount_required", "amount required");
  }
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new CurrencyLedgerError("invalid_amount", "amount must be a safe integer");
  }
  if (value === 0) {
    throw new CurrencyLedgerError("amount_required", "amount required");
  }
  return value;
}

function parseStatementBalance(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new CurrencyLedgerError("invalid_statement_balance", "invalid statement balance");
  }
  return value;
}

function parseOptionalPositiveMinor(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new CurrencyLedgerError("invalid_amount", "amount must be a positive safe integer");
  }
  return value;
}

function getAccount(database, id, { notFoundCode = "account_not_found", notFoundMessage = "account not found" } = {}) {
  const acc = database.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  if (!acc) throw new CurrencyLedgerError(notFoundCode, notFoundMessage);
  return acc;
}

function parseOriginal(input, accountCurrencyCode) {
  const hasCode = input.originalCurrencyCode != null && input.originalCurrencyCode !== "";
  const hasAmount = input.originalAmountMinor != null && input.originalAmountMinor !== "";
  if (hasCode !== hasAmount) {
    throw new CurrencyLedgerError(
      "original_amount_incomplete",
      "originalCurrencyCode and originalAmountMinor must both be provided"
    );
  }
  if (!hasCode) return { originalCurrencyCode: null, originalAmountMinor: null };
  assertSupportedCurrency(input.originalCurrencyCode);
  if (input.originalCurrencyCode === accountCurrencyCode) {
    throw new CurrencyLedgerError(
      "original_currency_matches_account",
      "original currency must differ from the account currency"
    );
  }
  assertSafeInteger(input.originalAmountMinor, "originalAmountMinor");
  return {
    originalCurrencyCode: input.originalCurrencyCode,
    originalAmountMinor: input.originalAmountMinor,
  };
}

function resolveCategoryId(database, categoryId, amount) {
  if (!categoryId) return null;
  if (!database.prepare("SELECT 1 FROM categories WHERE id=?").get(categoryId)) return null;
  if (amount < 0 && isIncomeCategory(database, categoryId)) {
    throw new CurrencyLedgerError("income_category_requires_positive_amount", "income category requires positive amount");
  }
  return categoryId;
}

export function ensureSystemCategories(database) {
  const existing = database.prepare("SELECT id FROM categories WHERE system_key=?").get(CURRENCY_TRANSFER_SYSTEM_KEY);
  if (existing) return existing.id;

  const run = database.transaction(() => {
    const again = database.prepare("SELECT id FROM categories WHERE system_key=?").get(CURRENCY_TRANSFER_SYSTEM_KEY);
    if (again) return again.id;

    let group = database
      .prepare("SELECT id FROM category_groups WHERE COALESCE(is_income,0)=0 ORDER BY sort_order DESC, name LIMIT 1")
      .get();
    if (!group) {
      const groupId = uid();
      const minOrder = database.prepare("SELECT COALESCE(MIN(sort_order),0) m FROM category_groups").get().m;
      database
        .prepare("INSERT INTO category_groups(id,name,sort_order,hidden,is_income) VALUES(?,?,?,0,0)")
        .run(groupId, "其他支出", minOrder - 1);
      group = { id: groupId };
    }
    const maxOrder = database.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM categories WHERE group_id=?").get(group.id).m;
    const id = uid();
    database
      .prepare("INSERT INTO categories(id,group_id,name,sort_order,hidden,system_key) VALUES(?,?,?,?,0,?)")
      .run(id, group.id, CURRENCY_TRANSFER_NAME, maxOrder + 1, CURRENCY_TRANSFER_SYSTEM_KEY);
    return id;
  });
  return run();
}

export function assertCategoryDeletable(database, categoryId) {
  const row = database.prepare("SELECT system_key FROM categories WHERE id=?").get(categoryId);
  if (row?.system_key) {
    throw new CurrencyLedgerError("cannot_delete_system_category", "cannot delete system category");
  }
}

function insertLeg(database, { id, accountId, date, payeeName, categoryId, memo, amount, transferAccountId, cleared, pairId, originalCurrencyCode, originalAmountMinor }) {
  const resolvedCategory = resolveCategoryId(database, categoryId, amount);
  database
    .prepare(
      `INSERT INTO transactions(
         id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,
         cleared,reconciled,is_start,pair_id,original_currency_code,original_amount,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,0,0,?,?,?,?)`
    )
    .run(
      id || uid(),
      accountId,
      date,
      payeeName ?? "",
      transferAccountId ?? null,
      resolvedCategory,
      memo || "",
      amount,
      cleared ? 1 : 0,
      pairId ?? null,
      originalCurrencyCode ?? null,
      originalAmountMinor ?? null,
      nowIso()
    );
}

export function postTransaction(database, input = {}, options = {}) {
  if (input.transferAccountId) {
    throw new CurrencyLedgerError("use_post_transfer", "transfers must use postTransfer");
  }
  const accountId = input.accountId;
  const date = parseDate(input.date);
  if (!accountId) throw new CurrencyLedgerError("invalid_account_or_date", "invalid account or date");
  const amount = parseBookedAmount(input.amount);
  const acc = getAccount(database, accountId);
  if (input.currencyCode != null && input.currencyCode !== "") {
    assertSupportedCurrency(input.currencyCode);
    if (input.currencyCode !== acc.currency_code) {
      throw new CurrencyLedgerError("account_currency_mismatch", "booked currency must match the account currency");
    }
  }
  const original = parseOriginal(input, acc.currency_code);
  const id = options.keepId || input.id || uid();
  const run = database.transaction(() => {
    insertLeg(database, {
      id,
      accountId: acc.id,
      date,
      payeeName: (input.payeeName || "").trim(),
      categoryId: input.categoryId || null,
      memo: input.memo,
      amount,
      transferAccountId: null,
      cleared: input.cleared,
      pairId: null,
      originalCurrencyCode: original.originalCurrencyCode,
      originalAmountMinor: original.originalAmountMinor,
    });
  });
  run();
  return { id };
}

function transferCategories(database, fromAcc, toAcc, userCategoryId) {
  const fromOn = !!fromAcc.on_budget;
  const toOn = !!toAcc.on_budget;
  const sameCurrency = fromAcc.currency_code === toAcc.currency_code;
  if (fromOn && toOn) {
    if (sameCurrency) return { source: null, dest: null };
    return { source: ensureSystemCategories(database), dest: null };
  }
  if (fromOn && !toOn) return { source: userCategoryId || null, dest: null };
  return { source: null, dest: null };
}

export function postTransfer(database, input = {}, options = {}) {
  const fromId = input.fromId;
  const toId = input.toId;
  if (!fromId || !toId || fromId === toId) {
    throw new CurrencyLedgerError("invalid_account_or_date", "invalid account or date");
  }
  const date = parseDate(input.date);
  const fromAcc = getAccount(database, fromId);
  const toAcc = getAccount(database, toId, {
    notFoundCode: "transfer_target_not_found",
    notFoundMessage: "transfer target not found",
  });

  let fromAmountMinor = parseOptionalPositiveMinor(input.fromAmountMinor);
  let toAmountMinor = parseOptionalPositiveMinor(input.toAmountMinor);
  const sameCurrency = fromAcc.currency_code === toAcc.currency_code;
  if (sameCurrency) {
    if (fromAmountMinor == null && toAmountMinor == null) {
      throw new CurrencyLedgerError("amount_required", "amount required");
    }
    if (fromAmountMinor == null) fromAmountMinor = toAmountMinor;
    if (toAmountMinor == null) toAmountMinor = fromAmountMinor;
    if (fromAmountMinor !== toAmountMinor) {
      throw new CurrencyLedgerError("same_currency_amount_mismatch", "same-currency transfer amounts must match");
    }
  } else if (fromAmountMinor == null || toAmountMinor == null) {
    throw new CurrencyLedgerError("cross_currency_amount_required", "cross-currency transfers require both amounts");
  }

  const pairId = options.keepPair || uid();
  const keepAccountId = options.keepAccountId;
  const keepId = options.keepId;
  const sourceId = keepId && keepAccountId === fromAcc.id ? keepId : uid();
  const destId = keepId && keepAccountId === toAcc.id ? keepId : uid();
  const cats = transferCategories(database, fromAcc, toAcc, input.categoryId || null);
  const memo = input.memo || "";
  const payeeName = (input.payeeName || "").trim();
  const cleared = input.cleared;

  const run = database.transaction(() => {
    insertLeg(database, {
      id: sourceId,
      accountId: fromAcc.id,
      date,
      payeeName,
      categoryId: cats.source,
      memo,
      amount: -fromAmountMinor,
      transferAccountId: toAcc.id,
      cleared,
      pairId,
    });
    insertLeg(database, {
      id: destId,
      accountId: toAcc.id,
      date,
      payeeName: "",
      categoryId: cats.dest,
      memo,
      amount: toAmountMinor,
      transferAccountId: fromAcc.id,
      cleared,
      pairId,
    });
  });
  run();
  return { pairId, sourceId, destId };
}

export function transferInputFromHttp(body = {}) {
  const accountId = body.accountId;
  const transferAccountId = body.transferAccountId && body.transferAccountId !== accountId ? body.transferAccountId : null;
  if (!transferAccountId) return null;
  const amount = parseBookedAmount(body.amount);
  const shared = {
    date: body.date,
    memo: body.memo,
    categoryId: body.categoryId,
    cleared: body.cleared,
    payeeName: body.payeeName,
  };
  if (amount < 0) {
    return {
      ...shared,
      fromId: accountId,
      toId: transferAccountId,
      fromAmountMinor: -amount,
      toAmountMinor: body.toAmountMinor,
    };
  }
  return {
    ...shared,
    fromId: transferAccountId,
    toId: accountId,
    fromAmountMinor: body.fromAmountMinor,
    toAmountMinor: amount,
  };
}

export function deletePair(database, tx) {
  database.prepare("DELETE FROM transactions WHERE id=?").run(tx.id);
  if (tx.pair_id) {
    database.prepare("DELETE FROM transactions WHERE pair_id=? AND id!=?").run(tx.pair_id, tx.id);
  } else if (tx.transfer_account_id) {
    database
      .prepare(
        `DELETE FROM transactions WHERE id IN (
           SELECT id FROM transactions
            WHERE account_id = ? AND transfer_account_id = ? AND date = ? AND amount = ? AND is_start = 0
            LIMIT 1)`
      )
      .run(tx.transfer_account_id, tx.account_id, tx.date, -tx.amount);
  }
}

export function deleteTransaction(database, id) {
  const existing = database.prepare("SELECT * FROM transactions WHERE id=?").get(id);
  if (!existing) throw new CurrencyLedgerError("not_found", "not found");
  if (existing.is_start) throw new CurrencyLedgerError("cannot_delete_starting_balance", "cannot delete starting balance");
  const run = database.transaction(() => deletePair(database, existing));
  run();
  return { ok: true };
}

export function updateTransaction(database, id, body = {}) {
  const existing = database.prepare("SELECT * FROM transactions WHERE id=?").get(id);
  if (!existing) throw new CurrencyLedgerError("not_found", "not found");
  if (existing.is_start) throw new CurrencyLedgerError("cannot_edit_starting_balance", "cannot edit starting balance");
  const keepId = existing.id;
  const keepPair = existing.pair_id;
  const cleared = body.cleared ?? !!existing.cleared;
  let result = { ok: true, id: keepId };
  const run = database.transaction(() => {
    deletePair(database, existing);
    const input = { ...body, cleared };
    const transfer = transferInputFromHttp(input);
    if (transfer) {
      result = {
        ok: true,
        ...postTransfer(database, transfer, { keepId, keepPair, keepAccountId: existing.account_id }),
      };
    } else {
      postTransaction(database, { ...input, id: keepId }, { keepId });
    }
  });
  run();
  return result;
}

export function setTransactionCategory(database, id, categoryId) {
  const existing = database.prepare("SELECT * FROM transactions WHERE id=?").get(id);
  if (!existing) throw new CurrencyLedgerError("not_found", "not found");
  if (existing.is_start) {
    throw new CurrencyLedgerError("cannot_categorize_starting_balance", "cannot categorize starting balance");
  }
  if (existing.transfer_account_id) {
    throw new CurrencyLedgerError("transfer_category_managed", "transfer category is managed by postTransfer");
  }
  const requested = categoryId || null;
  if (requested && !database.prepare("SELECT 1 FROM categories WHERE id=?").get(requested)) {
    throw new CurrencyLedgerError("unknown_category", "unknown category");
  }
  const resolved = resolveCategoryId(database, requested, existing.amount);
  database.prepare("UPDATE transactions SET category_id=? WHERE id=?").run(resolved, existing.id);
  return { ok: true };
}

export function setTransactionsCategory(database, ids, categoryId) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new CurrencyLedgerError("ids_required", "ids required");
  }
  const requested = categoryId || null;
  if (requested && !database.prepare("SELECT 1 FROM categories WHERE id=?").get(requested)) {
    throw new CurrencyLedgerError("unknown_category", "unknown category");
  }
  let changed = 0;
  const setStmt = database.prepare(
    "UPDATE transactions SET category_id=? WHERE id=? AND is_start=0 AND category_id IS NOT ?"
  );
  const run = database.transaction(() => {
    for (const id of ids) {
      const existing = database.prepare("SELECT * FROM transactions WHERE id=?").get(id);
      if (!existing || existing.is_start) continue;
      if (existing.transfer_account_id) {
        throw new CurrencyLedgerError("transfer_category_managed", "transfer category is managed by postTransfer");
      }
      if (requested && existing.amount < 0 && isIncomeCategory(database, requested)) {
        throw new CurrencyLedgerError("income_category_requires_positive_amount", "income category requires positive amount");
      }
      changed += setStmt.run(requested, id, requested).changes;
    }
  });
  run();
  return { ok: true, changed };
}

export function deleteTransactions(database, ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new CurrencyLedgerError("ids_required", "ids required");
  }
  let changed = 0;
  const run = database.transaction(() => {
    for (const id of ids) {
      const existing = database.prepare("SELECT * FROM transactions WHERE id=?").get(id);
      if (!existing || existing.is_start) continue;
      deletePair(database, existing);
      changed++;
    }
  });
  run();
  return { ok: true, changed };
}

export function setTransactionCleared(database, id, cleared) {
  if (cleared !== 0 && cleared !== 1) {
    throw new CurrencyLedgerError("invalid_value", "invalid value");
  }
  const existing = database.prepare("SELECT * FROM transactions WHERE id=?").get(id);
  if (!existing) throw new CurrencyLedgerError("not_found", "not found");
  const run = database.transaction(() => {
    database
      .prepare("UPDATE transactions SET cleared=?, reconciled=? WHERE id=?")
      .run(cleared, cleared === 1 ? 0 : existing.reconciled, existing.id);
    if (existing.pair_id) {
      database
        .prepare("UPDATE transactions SET cleared=?, reconciled=? WHERE pair_id=? AND id!=?")
        .run(cleared, cleared === 1 ? 0 : existing.reconciled, existing.pair_id, existing.id);
    }
  });
  run();
  return { ok: true };
}

export function reconcileAccount(database, input = {}) {
  const acc = getAccount(database, input.accountId, { notFoundCode: "not_found", notFoundMessage: "not found" });
  const statement = parseStatementBalance(input.statementBalance);
  const markCleared = !!input.markCleared;
  const asOfDate = parseDate(input.asOfDate || utcToday());
  let adjustment = null;
  const run = database.transaction(() => {
    if (statement !== undefined) {
      const start = acc.starting_balance_date || null;
      const calc =
        acc.starting_balance +
        database
          .prepare(
            `SELECT COALESCE(SUM(amount),0) s FROM transactions
             WHERE account_id=? AND is_start=0 AND date<=?
               AND (? IS NULL OR date>=?)`
          )
          .get(acc.id, asOfDate, start, start).s;
      if (statement !== calc) {
        adjustment = statement - calc;
        database
          .prepare(
            `INSERT INTO transactions(id,account_id,date,payee_name,memo,amount,cleared,reconciled,is_start,is_reconcile_adjustment,created_at)
             VALUES(?,?,?,?,?,?,1,1,0,1,?)`
          )
          .run(uid(), acc.id, asOfDate, "__reconciling__", "", adjustment, nowIso());
      }
    }
    if (markCleared) {
      database
        .prepare("UPDATE transactions SET cleared=1 WHERE account_id=? AND cleared=0 AND is_start=0 AND transfer_account_id IS NULL")
        .run(acc.id);
    }
    database.prepare("UPDATE transactions SET reconciled=1 WHERE account_id=? AND cleared=1").run(acc.id);
  });
  run();
  return { ok: true, adjustment };
}
