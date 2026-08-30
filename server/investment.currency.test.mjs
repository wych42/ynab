import { afterEach, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-investment-currency-");

const { db, uid, createAccount } = await import("./db.mjs");
const { postTransaction, postTransfer, reconcileAccount } = await import("./currency-ledger.mjs");
const { computeBudget, buildNativeReport } = await import("./engine.mjs");
const { createFxModule, createInMemoryFxAdapter } = await import("./fx.mjs");
const { createReportsModule } = await import("./reports.mjs");
const { createInvestmentModule, InvestmentError } = await import("./investment.mjs");

const AS_OF = "2026-08-20";
const RATE_DATE = "2026-07-31";
const NOW = "2026-08-30T00:00:00.000Z";

const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "日常开销", 90);
const diningId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(diningId, spendGid, "餐饮", 0);

const incomeGid = db.prepare("SELECT id FROM category_groups WHERE is_income=1 ORDER BY sort_order LIMIT 1").get().id;
const salaryId = db.prepare("SELECT id FROM categories WHERE group_id=? ORDER BY sort_order LIMIT 1").get(incomeGid).id;

const investment = createInvestmentModule({ db });

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function thrownCode(fn) {
  return thrown(fn)?.code;
}

function viewOf(accountId, { asOf = AS_OF, months = 1 } = {}) {
  return investment.getInvestmentAccount({ accountId, asOf, months });
}

function usdInvest(name = "USD 投资账户", extra = {}) {
  return createAccount({
    name,
    type: "investment",
    currencyCode: "USD",
    startingBalance: extra.startingBalance ?? 1_000_000,
    startingDate: extra.startingDate ?? "2026-01-01",
  });
}

function insertRate() {
  db.prepare(
    `INSERT INTO fx_rates(rate_date, base_currency, quote_currency, rate, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(RATE_DATE, "USD", "CNY", "7.20", "frankfurter_ecb", NOW);
}

function makeReports() {
  const fx = createFxModule({
    db,
    provider: createInMemoryFxAdapter({ source: "frankfurter_ecb" }),
    today: () => "2026-08-30",
    nowIso: () => NOW,
  });
  return createReportsModule({ db, fx });
}

function monthState(currencyCode, month = "2026-08") {
  return computeBudget(month, currencyCode).byMonth.get(month);
}

function nativeMonth(currencyCode, month = "2026-08") {
  const report = buildNativeReport({ currencyCode, months: 12 });
  return {
    income: report.income.find((row) => row.month === month)?.value,
    expense: report.expense.find((row) => row.month === month)?.value,
  };
}

function wipe() {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM fx_rates").run();
  db.prepare("DELETE FROM assignments").run();
}

afterEach(() => {
  wipe();
});

describe("investment account native view after valuation", () => {
  it("raises a USD investment from 10,000.00 to 11,000.00 and records the valuation date", () => {
    const id = usdInvest();
    const before = viewOf(id);
    expect(before.accountId).toBe(id);
    expect(before.name).toBe("USD 投资账户");
    expect(before.currencyCode).toBe("USD");
    expect(before.asOf).toBe(AS_OF);
    expect(before.months).toBe(1);
    expect(before.balanceMinor).toBe(1_000_000);
    expect(before.latestValuationDate).toBeNull();
    expect(before.contributionsMinor).toBe(0);
    expect(before.withdrawalsMinor).toBe(0);
    expect(before.netContributionsMinor).toBe(0);
    expect(before.balanceChangeMinor).toBe(0);

    const result = reconcileAccount(db, {
      accountId: id,
      statementBalance: 1_100_000,
      markCleared: false,
      asOfDate: AS_OF,
    });
    expect(result.adjustment).toBe(100_000);
    const adj = db.prepare("SELECT * FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(id);
    expect(adj.amount).toBe(100_000);
    expect(adj.date).toBe(AS_OF);
    expect(adj.is_reconcile_adjustment).toBe(1);
    expect(adj.transfer_account_id).toBeNull();

    const view = viewOf(id);
    expect(view.balanceMinor).toBe(1_100_000);
    expect(view.balanceChangeMinor).toBe(100_000);
    expect(view.latestValuationDate).toBe(AS_OF);
    expect(view.contributionsMinor).toBe(0);
    expect(view.withdrawalsMinor).toBe(0);
    expect(view.netContributionsMinor).toBe(0);
    expect(view).not.toHaveProperty("returnMinor");
    expect(view).not.toHaveProperty("profitMinor");
    expect(view).not.toHaveProperty("holdings");
    expect(view).not.toHaveProperty("quantity");
    expect(view).not.toHaveProperty("costBasis");
    expect(view).not.toHaveProperty("tax");
    expect(Object.keys(view).sort()).toEqual(
      [
        "accountId",
        "asOf",
        "balanceChangeMinor",
        "balanceMinor",
        "contributionsMinor",
        "currencyCode",
        "history",
        "latestValuationDate",
        "months",
        "name",
        "netContributionsMinor",
        "withdrawalsMinor",
      ].sort()
    );
    expect(view.history).toEqual([{ month: "2026-08", asOf: AS_OF, balanceMinor: 1_100_000 }]);
  });

  it("converts the same valuation into consolidated net worth only on and after the adjustment date", async () => {
    const id = usdInvest();
    insertRate();
    const reports = makeReports();

    reconcileAccount(db, {
      accountId: id,
      statementBalance: 1_100_000,
      markCleared: false,
      asOfDate: AS_OF,
    });

    const before = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: "2026-08-19",
      months: 2,
    });
    expect(before.complete).toBe(true);
    expect(before.netWorthMinor).toBe(7_200_000);
    expect(before.accounts[0]).toMatchObject({
      id,
      currencyCode: "USD",
      nativeBalanceMinor: 1_000_000,
      convertedBalanceMinor: 7_200_000,
    });
    expect(before.history.find((point) => point.month === "2026-07")).toMatchObject({
      asOf: RATE_DATE,
      complete: true,
      netWorthMinor: 7_200_000,
    });

    const after = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 2,
    });
    expect(after.complete).toBe(true);
    expect(after.netWorthMinor).toBe(7_920_000);
    expect(after.accounts[0]).toMatchObject({
      nativeBalanceMinor: 1_100_000,
      convertedBalanceMinor: 7_920_000,
    });
    expect(after.history.find((point) => point.month === "2026-07")).toMatchObject({
      asOf: RATE_DATE,
      netWorthMinor: 7_200_000,
    });
    expect(after.history.find((point) => point.month === "2026-08")).toMatchObject({
      asOf: AS_OF,
      netWorthMinor: 7_920_000,
    });
  });

  it("does not add a valuation adjustment to USD Ready to Assign or native income or expense", () => {
    const checking = createAccount({
      name: "USD 日常",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 0,
      startingDate: "2026-08-01",
    });
    postTransaction(db, {
      accountId: checking,
      date: "2026-08-05",
      amount: 50_000,
      categoryId: salaryId,
      payeeName: "工资",
    });
    const id = usdInvest();
    const rtaBefore = monthState("USD").readyToAssign;
    expect(rtaBefore).toBe(50_000);
    expect(nativeMonth("USD")).toEqual({ income: 50_000, expense: 0 });

    reconcileAccount(db, {
      accountId: id,
      statementBalance: 1_100_000,
      markCleared: false,
      asOfDate: AS_OF,
    });

    expect(monthState("USD").readyToAssign).toBe(50_000);
    expect(nativeMonth("USD")).toEqual({ income: 50_000, expense: 0 });
    expect(viewOf(id).balanceMinor).toBe(1_100_000);
  });

  it("values as of the reconcile date and does not let a later contribution hide the adjustment", () => {
    const bank = createAccount({
      name: "USD 银行",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 200_000,
      startingDate: "2026-08-01",
    });
    const id = usdInvest("USD 投资账户", { startingDate: "2026-08-01" });
    postTransfer(db, {
      fromId: bank,
      toId: id,
      date: "2026-08-25",
      fromAmountMinor: 100_000,
      toAmountMinor: 100_000,
    });

    const result = reconcileAccount(db, {
      accountId: id,
      statementBalance: 1_100_000,
      markCleared: false,
      asOfDate: AS_OF,
    });
    expect(result.adjustment).toBe(100_000);
    const adj = db.prepare("SELECT amount, date FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(id);
    expect(adj).toEqual({ amount: 100_000, date: AS_OF });

    expect(viewOf(id, { asOf: AS_OF, months: 1 })).toMatchObject({
      balanceMinor: 1_100_000,
      contributionsMinor: 0,
      latestValuationDate: AS_OF,
    });
    expect(viewOf(id, { asOf: "2026-08-25", months: 1 })).toMatchObject({
      balanceMinor: 1_200_000,
      contributionsMinor: 100_000,
      latestValuationDate: AS_OF,
    });
  });
});

describe("investment contributions and withdrawals", () => {
  it("counts on-budget transfers as contributions or withdrawals and keeps them out of Income v Expense", () => {
    const bank = createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    const id = usdInvest();
    postTransaction(db, {
      accountId: bank,
      date: "2026-08-04",
      amount: -8_000,
      categoryId: diningId,
      payeeName: "盒马",
    });
    postTransfer(db, {
      fromId: bank,
      toId: id,
      date: "2026-08-10",
      fromAmountMinor: 72_000,
      toAmountMinor: 10_000,
      categoryId: diningId,
    });
    postTransfer(db, {
      fromId: id,
      toId: bank,
      date: "2026-08-12",
      fromAmountMinor: 4_000,
      toAmountMinor: 28_800,
    });
    postTransaction(db, {
      accountId: id,
      date: "2026-08-18",
      amount: 2_500,
      payeeName: "分红伪装",
    });

    const view = viewOf(id);
    expect(view.contributionsMinor).toBe(10_000);
    expect(view.withdrawalsMinor).toBe(4_000);
    expect(view.netContributionsMinor).toBe(6_000);
    expect(view.balanceMinor).toBe(1_000_000 + 10_000 - 4_000 + 2_500);
    expect(view.balanceChangeMinor).toBe(10_000 - 4_000 + 2_500);
    expect(view.latestValuationDate).toBeNull();

    expect(nativeMonth("CNY")).toEqual({ income: 0, expense: 8_000 });
    expect(nativeMonth("USD")).toEqual({ income: 0, expense: 0 });
    expect(monthState("USD").readyToAssign).toBe(0);
  });
});

describe("investment view window, start date and account filters", () => {
  it("uses asOf, ignores future rows, and values past months at month-end", () => {
    const bank = createAccount({
      name: "USD 银行",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 500_000,
      startingDate: "2026-01-01",
    });
    const id = usdInvest("USD 投资账户", { startingDate: "2026-06-01" });
    postTransfer(db, {
      fromId: bank,
      toId: id,
      date: "2026-07-15",
      fromAmountMinor: 50_000,
      toAmountMinor: 50_000,
    });
    reconcileAccount(db, {
      accountId: id,
      statementBalance: 1_150_000,
      markCleared: false,
      asOfDate: "2026-08-10",
    });
    postTransfer(db, {
      fromId: bank,
      toId: id,
      date: "2026-08-25",
      fromAmountMinor: 9_000,
      toAmountMinor: 9_000,
    });

    const view = viewOf(id, { asOf: AS_OF, months: 3 });
    expect(view.asOf).toBe(AS_OF);
    expect(view.months).toBe(3);
    expect(view.balanceMinor).toBe(1_150_000);
    expect(view.contributionsMinor).toBe(50_000);
    expect(view.withdrawalsMinor).toBe(0);
    expect(view.latestValuationDate).toBe("2026-08-10");
    expect(view.history).toEqual([
      { month: "2026-06", asOf: "2026-06-30", balanceMinor: 1_000_000 },
      { month: "2026-07", asOf: "2026-07-31", balanceMinor: 1_050_000 },
      { month: "2026-08", asOf: AS_OF, balanceMinor: 1_150_000 },
    ]);
    expect(viewOf(id, { asOf: "2026-07-31", months: 1 }).balanceMinor).toBe(1_050_000);
    expect(viewOf(id, { asOf: "2026-07-31", months: 1 }).latestValuationDate).toBeNull();
    expect(viewOf(id, { asOf: "2026-08-25", months: 1 }).contributionsMinor).toBe(9_000);
  });

  it("respects starting_balance_date and does not treat a missing valuation as a date", () => {
    const bank = createAccount({
      name: "USD 银行",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 200_000,
      startingDate: "2026-01-01",
    });
    const id = usdInvest("晚开的投资", { startingDate: "2026-08-10" });
    db.prepare(
      `INSERT INTO transactions(id,account_id,date,payee_name,amount,cleared,reconciled,is_start,created_at)
       VALUES(?,?,?,?,?,0,0,0,?)`
    ).run(uid(), id, "2026-08-01", "开始日前异常", 500_000, NOW);
    postTransfer(db, {
      fromId: bank,
      toId: id,
      date: "2026-08-05",
      fromAmountMinor: 20_000,
      toAmountMinor: 20_000,
    });
    postTransfer(db, {
      fromId: bank,
      toId: id,
      date: "2026-08-12",
      fromAmountMinor: 15_000,
      toAmountMinor: 15_000,
    });

    expect(viewOf(id, { asOf: "2026-08-09", months: 3 })).toMatchObject({
      balanceMinor: 0,
      contributionsMinor: 0,
      latestValuationDate: null,
    });
    const view = viewOf(id, { asOf: AS_OF, months: 3 });
    expect(view.balanceMinor).toBe(1_015_000);
    expect(view.contributionsMinor).toBe(15_000);
    expect(view.latestValuationDate).toBeNull();
    expect(view.history).toEqual([
      { month: "2026-06", asOf: "2026-06-30", balanceMinor: 0 },
      { month: "2026-07", asOf: "2026-07-31", balanceMinor: 0 },
      { month: "2026-08", asOf: AS_OF, balanceMinor: 1_015_000 },
    ]);
  });

  it("rejects missing and non-investment accounts with stable codes", () => {
    const missing = thrown(() => viewOf("missing-account"));
    expect(missing).toBeInstanceOf(InvestmentError);
    expect(missing.code).toBe("account_not_found");
    expect(missing.status).toBe(404);

    const cash = createAccount({
      name: "CNY 现金",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10000,
      startingDate: "2026-08-01",
    });
    const cashErr = thrown(() => viewOf(cash));
    expect(cashErr.code).toBe("not_investment_account");
    expect(cashErr.status).toBe(400);

    const asset = createAccount({
      name: "其他资产",
      type: "otherAsset",
      currencyCode: "USD",
      startingBalance: 1,
      startingDate: "2026-08-01",
    });
    expect(thrownCode(() => viewOf(asset))).toBe("not_investment_account");

    const fakeInvest = usdInvest("被改成预算内");
    db.prepare("UPDATE accounts SET on_budget=1 WHERE id=?").run(fakeInvest);
    expect(thrownCode(() => viewOf(fakeInvest))).toBe("not_investment_account");
  });

  it("rejects illegal months and dates", () => {
    const id = usdInvest();
    expect(thrownCode(() => viewOf(id, { months: 0 }))).toBe("invalid_months");
    expect(thrownCode(() => viewOf(id, { months: 25 }))).toBe("invalid_months");
    expect(thrownCode(() => viewOf(id, { months: "abc" }))).toBe("invalid_months");
    expect(thrownCode(() => viewOf(id, { months: 12.5 }))).toBe("invalid_months");
    expect(thrownCode(() => investment.getInvestmentAccount({ accountId: id, asOf: AS_OF }))).toBe("invalid_months");
    expect(thrownCode(() => viewOf(id, { asOf: "2026-02-30" }))).toBe("invalid_date");
    expect(thrownCode(() => viewOf(id, { asOf: "08-20-2026" }))).toBe("invalid_date");
    expect(thrownCode(() => investment.getInvestmentAccount({ accountId: id, months: 1 }))).toBe("invalid_date");
  });
});

describe("existing on-budget reconcile", () => {
  it("keeps CNY and JPY statement adjustments on ordinary accounts", () => {
    const cny = createAccount({
      name: "CNY 现金",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10_000,
      startingDate: "2026-08-01",
    });
    const jpy = createAccount({
      name: "JPY 现金",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 1_000,
      startingDate: "2026-08-01",
    });
    expect(
      reconcileAccount(db, { accountId: cny, statementBalance: 10_500, markCleared: false, asOfDate: AS_OF }).adjustment
    ).toBe(500);
    expect(
      reconcileAccount(db, { accountId: jpy, statementBalance: 1_100, markCleared: false, asOfDate: AS_OF }).adjustment
    ).toBe(100);
    expect(db.prepare("SELECT amount, date FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(cny)).toEqual(
      { amount: 500, date: AS_OF }
    );
    expect(db.prepare("SELECT amount, date FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(jpy)).toEqual(
      { amount: 100, date: AS_OF }
    );
    expect(thrownCode(() => viewOf(cny))).toBe("not_investment_account");
    expect(thrownCode(() => viewOf(jpy))).toBe("not_investment_account");
  });
});
