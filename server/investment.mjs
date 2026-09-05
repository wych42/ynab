import { addMonths, endOfMonth, todayYmd } from "./db.mjs";
import { parseYmd } from "./fx-providers.mjs";

export class InvestmentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "InvestmentError";
    this.code = code;
    this.status = status;
  }
}

export function isInvestmentError(error) {
  return error instanceof InvestmentError;
}

function parseMonths(value) {
  let n = value;
  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) {
      throw new InvestmentError("invalid_months", "months must be an integer from 1 to 24");
    }
    n = Number(value);
  }
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 24) {
    throw new InvestmentError("invalid_months", "months must be an integer from 1 to 24");
  }
  return n;
}

function parseAccountId(value) {
  if (typeof value !== "string" || !value) {
    throw new InvestmentError("account_not_found", "account not found", 404);
  }
  return value;
}

function monthKeys(asOf, count) {
  const end = asOf.slice(0, 7);
  const months = [];
  for (let i = count - 1; i >= 0; i--) months.push(addMonths(end, -i));
  return months;
}

function valuationDate(month, asOf) {
  if (month === asOf.slice(0, 7)) return asOf;
  return endOfMonth(month);
}

function balanceAsOf(account, txs, asOf) {
  if (account.starting_balance_date && account.starting_balance_date > asOf) return 0;
  let balance = account.starting_balance;
  const start = account.starting_balance_date;
  for (const tx of txs) {
    if (tx.is_start) continue;
    if (tx.date > asOf) continue;
    if (start && tx.date < start) continue;
    balance += tx.amount;
  }
  return balance;
}

export function createInvestmentModule({ db } = {}) {
  if (!db) throw new InvestmentError("invalid_request", "investment module requires a database");

  function getInvestmentAccount({ accountId, asOf, months } = {}) {
    const id = parseAccountId(accountId);
    const asOfDate = parseYmd(asOf, InvestmentError, "invalid_date");
    const monthCount = parseMonths(months);
    const account = db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
    if (!account) throw new InvestmentError("account_not_found", "account not found", 404);
    if (account.type !== "investment" || account.on_budget) {
      throw new InvestmentError("not_investment_account", "account is not an off-budget investment account");
    }

    const txs = db
      .prepare(
        `SELECT date, amount, is_start, is_reconcile_adjustment, transfer_account_id
         FROM transactions WHERE account_id=?`
      )
      .all(account.id);

    const keys = monthKeys(asOfDate, monthCount);
    const windowStart = `${keys[0]}-01`;
    const openingDate = endOfMonth(addMonths(keys[0], -1));
    const opening = balanceAsOf(account, txs, openingDate);
    const balanceMinor = balanceAsOf(account, txs, asOfDate);

    let contributionsMinor = 0;
    let withdrawalsMinor = 0;
    let latestValuationDate = null;
    for (const tx of txs) {
      if (tx.is_start) continue;
      if (account.starting_balance_date && tx.date < account.starting_balance_date) continue;
      if (tx.date > asOfDate) continue;
      if (tx.is_reconcile_adjustment) {
        if (!latestValuationDate || tx.date > latestValuationDate) latestValuationDate = tx.date;
        continue;
      }
      if (tx.date < windowStart) continue;
      if (!tx.transfer_account_id) continue;
      if (tx.amount > 0) contributionsMinor += tx.amount;
      else if (tx.amount < 0) withdrawalsMinor += -tx.amount;
    }

    return {
      accountId: account.id,
      name: account.name,
      currencyCode: account.currency_code,
      asOf: asOfDate,
      months: monthCount,
      balanceMinor,
      contributionsMinor,
      withdrawalsMinor,
      netContributionsMinor: contributionsMinor - withdrawalsMinor,
      balanceChangeMinor: balanceMinor - opening,
      latestValuationDate,
      history: keys.map((month) => {
        const pointAsOf = valuationDate(month, asOfDate);
        return { month, asOf: pointAsOf, balanceMinor: balanceAsOf(account, txs, pointAsOf) };
      }),
    };
  }

  function listInvestmentAccounts({ asOf = todayYmd(), months = 12 } = {}) {
    const asOfDate = parseYmd(asOf, InvestmentError, "invalid_date");
    const monthCount = parseMonths(months);
    const accounts = db
      .prepare(
        "SELECT id FROM accounts WHERE type='investment' AND COALESCE(on_budget,0)=0 ORDER BY sort_order, created_at, name"
      )
      .all();
    const views = accounts.map((row) => getInvestmentAccount({ accountId: row.id, asOf: asOfDate, months: monthCount }));
    const byCurrency = new Map();
    for (const view of views) {
      const current = byCurrency.get(view.currencyCode) || {
        currencyCode: view.currencyCode,
        balanceMinor: 0,
        balanceChangeMinor: 0,
        contributionsMinor: 0,
        withdrawalsMinor: 0,
        netContributionsMinor: 0,
      };
      current.balanceMinor += view.balanceMinor;
      current.balanceChangeMinor += view.balanceChangeMinor;
      current.contributionsMinor += view.contributionsMinor;
      current.withdrawalsMinor += view.withdrawalsMinor;
      current.netContributionsMinor += view.netContributionsMinor;
      byCurrency.set(view.currencyCode, current);
    }
    return {
      asOf: asOfDate,
      months: monthCount,
      accounts: views.map((view) => ({
        accountId: view.accountId,
        name: view.name,
        currencyCode: view.currencyCode,
        balanceMinor: view.balanceMinor,
        balanceChangeMinor: view.balanceChangeMinor,
        contributionsMinor: view.contributionsMinor,
        withdrawalsMinor: view.withdrawalsMinor,
        netContributionsMinor: view.netContributionsMinor,
        latestValuationDate: view.latestValuationDate,
      })),
      subtotalsByCurrency: [...byCurrency.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    };
  }

  return { getInvestmentAccount, listInvestmentAccounts };
}
