import { addMonths, currentMonth, endOfMonth } from "./db.mjs";
import { requireEnabledCurrency } from "./account-currency.mjs";
import { listEnabledCurrencyCodes } from "./currency-state.mjs";
import { MoneyError, convertAmount } from "./money.mjs";
import { parseYmd } from "./fx-providers.mjs";
import { buildNativeReport } from "./engine.mjs";

export class ReportsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReportsError";
    this.code = code;
  }
}

export function isReportsError(error) {
  return error instanceof ReportsError || error instanceof MoneyError;
}

function parseMonths(value) {
  let n = value;
  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) {
      throw new ReportsError("invalid_months", "months must be an integer from 1 to 24");
    }
    n = Number(value);
  }
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 24) {
    throw new ReportsError("invalid_months", "months must be an integer from 1 to 24");
  }
  return n;
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

function nativeBalanceAsOf(account, txByAccount, asOf) {
  if (account.starting_balance_date && account.starting_balance_date > asOf) return null;
  let balance = account.starting_balance;
  const start = account.starting_balance_date;
  const rows = txByAccount.get(account.id) ?? [];
  for (const tx of rows) {
    if (tx.is_start) continue;
    if (tx.date > asOf) continue;
    if (start && tx.date < start) continue;
    balance += tx.amount;
  }
  return balance;
}

function sumConverted(amounts) {
  let assets = 0;
  let liabilities = 0;
  for (const amount of amounts) {
    if (amount > 0) assets += amount;
    else if (amount < 0) liabilities += -amount;
  }
  if (!Number.isSafeInteger(assets) || !Number.isSafeInteger(liabilities)) {
    throw new MoneyError("unsafe_integer", "net worth totals exceed Number.MAX_SAFE_INTEGER");
  }
  const net = assets - liabilities;
  if (!Number.isSafeInteger(net)) {
    throw new MoneyError("unsafe_integer", "net worth totals exceed Number.MAX_SAFE_INTEGER");
  }
  return { totalAssetsMinor: assets, totalLiabilitiesMinor: liabilities, netWorthMinor: net };
}

function missingKey(missing) {
  return `${missing.base}|${missing.quote}|${missing.requestedDate}`;
}

function presentMissing(map) {
  return [...map.values()].sort((a, b) => {
    if (a.base !== b.base) return a.base.localeCompare(b.base);
    if (a.quote !== b.quote) return a.quote.localeCompare(b.quote);
    return a.requestedDate.localeCompare(b.requestedDate);
  });
}

function presentRates(map) {
  return [...map.values()].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.asOfDate.localeCompare(b.asOfDate);
  });
}

function rateKey(quoted) {
  return `${quoted.from}|${quoted.to}|${quoted.asOfDate}`;
}

function presentFx(quoted) {
  return {
    from: quoted.from,
    to: quoted.to,
    asOfDate: quoted.asOfDate,
    rateDate: quoted.rateDate,
    source: quoted.source,
    path: quoted.path,
    rate: quoted.rate,
  };
}

export function createReportsModule({ db, fx } = {}) {
  if (!db) throw new ReportsError("invalid_request", "reports module requires a database");
  if (!fx || (typeof fx.getRate !== "function" && typeof fx.convert !== "function")) {
    throw new ReportsError("invalid_request", "reports module requires an fx module");
  }

  async function quoteRate(cache, from, to, asOf) {
    const key = `${from}|${to}|${asOf}`;
    if (cache.has(key)) return cache.get(key);
    const quoted =
      typeof fx.getRate === "function"
        ? await fx.getRate({ from, to, asOf })
        : await fx.convert({ amountMinor: 0, from, to, asOf });
    cache.set(key, quoted);
    return quoted;
  }

  function loadLedger() {
    const accounts = db.prepare("SELECT * FROM accounts ORDER BY sort_order, created_at").all();
    const txRows = db.prepare("SELECT account_id, date, amount, is_start FROM transactions").all();
    const txByAccount = new Map();
    for (const tx of txRows) {
      const list = txByAccount.get(tx.account_id);
      if (list) list.push(tx);
      else txByAccount.set(tx.account_id, [tx]);
    }
    return { accounts, txByAccount };
  }

  async function snapshotAt({ reportingCurrency, asOf, accounts, txByAccount, rateCache, includeAccountRows }) {
    const missingMap = new Map();
    const usedRates = new Map();
    const accountsOut = [];
    const converted = [];
    let complete = true;

    for (const account of accounts) {
      const nativeBalanceMinor = nativeBalanceAsOf(account, txByAccount, asOf);
      if (nativeBalanceMinor == null) continue;

      const row = {
        id: account.id,
        name: account.name,
        type: account.type,
        currencyCode: account.currency_code,
        nativeBalanceMinor,
        convertedBalanceMinor: null,
        fx: null,
      };

      if (nativeBalanceMinor === 0) {
        row.convertedBalanceMinor = 0;
        converted.push(0);
        if (includeAccountRows) accountsOut.push(row);
        continue;
      }

      const quoted = await quoteRate(rateCache, account.currency_code, reportingCurrency, asOf);
      if (!quoted.ok) {
        complete = false;
        missingMap.set(missingKey(quoted.missing), quoted.missing);
        if (includeAccountRows) accountsOut.push(row);
        continue;
      }

      const fxMeta = presentFx(quoted);
      usedRates.set(rateKey(fxMeta), fxMeta);
      const convertedBalanceMinor = convertAmount({
        amountMinor: nativeBalanceMinor,
        from: account.currency_code,
        to: reportingCurrency,
        rate: quoted.rate,
      });
      converted.push(convertedBalanceMinor);
      row.convertedBalanceMinor = convertedBalanceMinor;
      row.fx = fxMeta;
      if (includeAccountRows) accountsOut.push(row);
    }

    const missing = presentMissing(missingMap);
    const rates = presentRates(usedRates);
    if (!complete) {
      return {
        complete: false,
        totalAssetsMinor: null,
        totalLiabilitiesMinor: null,
        netWorthMinor: null,
        accounts: accountsOut,
        missing,
        rates,
      };
    }
    return {
      complete: true,
      ...sumConverted(converted),
      accounts: accountsOut,
      missing: [],
      rates,
    };
  }

  async function buildNetWorthReport({ reportingCurrency, asOf, months } = {}) {
    const code = requireEnabledCurrency(db, reportingCurrency);
    const asOfDate = parseYmd(asOf, ReportsError, "invalid_date");
    const monthCount = parseMonths(months);
    const { accounts, txByAccount } = loadLedger();
    const rateCache = new Map();
    const history = [];
    let current = null;

    for (const month of monthKeys(asOfDate, monthCount)) {
      const pointAsOf = valuationDate(month, asOfDate);
      const isCurrent = pointAsOf === asOfDate;
      const snap = await snapshotAt({
        reportingCurrency: code,
        asOf: pointAsOf,
        accounts,
        txByAccount,
        rateCache,
        includeAccountRows: isCurrent,
      });
      const point = {
        month,
        asOf: pointAsOf,
        complete: snap.complete,
        totalAssetsMinor: snap.totalAssetsMinor,
        totalLiabilitiesMinor: snap.totalLiabilitiesMinor,
        netWorthMinor: snap.netWorthMinor,
        missing: snap.missing,
        rates: snap.rates,
      };
      history.push(point);
      if (isCurrent) current = snap;
    }

    if (!current) {
      throw new ReportsError("invalid_date", "asOf month is missing from the history window");
    }

    return {
      reportingCurrency: code,
      asOf: asOfDate,
      months: monthCount,
      complete: current.complete,
      totalAssetsMinor: current.totalAssetsMinor,
      totalLiabilitiesMinor: current.totalLiabilitiesMinor,
      netWorthMinor: current.netWorthMinor,
      accounts: current.accounts,
      history,
      missing: current.missing,
    };
  }

  function buildCashflowOverview({ month } = {}) {
    const current = typeof month === "string" && month ? month : currentMonth();
    const enabled = listEnabledCurrencyCodes(db);
    const incomeCatIds = new Set(
      db
        .prepare("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=1")
        .all()
        .map((row) => row.id)
    );
    const isIncome = (categoryId, amount) => (categoryId ? incomeCatIds.has(categoryId) : amount > 0);
    const byCode = new Map(
      enabled.map((code) => [
        code,
        { currencyCode: code, incomeMinor: 0, expenseMinor: 0, netInflowMinor: 0, active: false },
      ])
    );
    const rows = db
      .prepare(
        `SELECT t.amount, t.category_id, t.transfer_account_id, t.is_start, t.is_reconcile_adjustment,
                a.currency_code, a.on_budget
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE substr(t.date, 1, 7) = ?`
      )
      .all(current);
    for (const tx of rows) {
      if (!tx.on_budget || tx.is_start || tx.is_reconcile_adjustment || tx.transfer_account_id) continue;
      const entry = byCode.get(tx.currency_code);
      if (!entry) continue;
      entry.active = true;
      if (isIncome(tx.category_id, tx.amount)) entry.incomeMinor += tx.amount;
      else if (tx.amount < 0) entry.expenseMinor += -tx.amount;
    }
    for (const entry of byCode.values()) {
      entry.netInflowMinor = entry.incomeMinor - entry.expenseMinor;
    }
    return { month: current, currencies: [...byCode.values()] };
  }

  function buildCashflowDetail({ currencyCode, months } = {}) {
    const report = buildNativeReport({ currencyCode, months });
    return {
      currencyCode: report.currencyCode,
      months: report.months,
      income: report.income,
      expense: report.expense,
      breakdown: report.breakdown,
      topPayees: report.topPayees,
      incomeSources: report.incomeSources,
      ageOfMoney: report.ageOfMoney,
    };
  }

  return { buildNetWorthReport, buildCashflowOverview, buildCashflowDetail };
}
