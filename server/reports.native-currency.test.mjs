import { afterEach, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-reports-native-currency-");

const { db, uid, createAccount } = await import("./db.mjs");
const { ageOfMoney, buildNativeReport } = await import("./engine.mjs");

const MONTH = "2026-08";

const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "日常开销", 90);
const diningId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(diningId, spendGid, "餐饮", 0);

const incomeGid = db.prepare("SELECT id FROM category_groups WHERE is_income=1 ORDER BY sort_order LIMIT 1").get().id;
const salaryId = db.prepare("SELECT id FROM categories WHERE group_id=? ORDER BY sort_order LIMIT 1").get(incomeGid).id;

function thrownCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code ?? error.message;
  }
  return undefined;
}

function insertTx({
  accountId,
  date,
  amount,
  categoryId = null,
  payee = "x",
  transferAccountId = null,
  isStart = 0,
  isReconcileAdjustment = 0,
}) {
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,is_reconcile_adjustment,pair_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?)`
  ).run(
    uid(),
    accountId,
    date,
    payee,
    transferAccountId,
    categoryId,
    "",
    amount,
    isStart,
    isReconcileAdjustment,
    transferAccountId ? uid() : null,
    "2026-08-01T00:00:00.000Z"
  );
}

function wipeMoney() {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
}

afterEach(() => {
  wipeMoney();
});

describe("buildNativeReport requires an explicit enabled currency", () => {
  it("rejects missing, malformed, unsupported and disabled codes", () => {
    expect(thrownCode(() => buildNativeReport({ months: 3 }))).toBe("invalid_currency_code");
    expect(thrownCode(() => buildNativeReport({ currencyCode: "cny", months: 3 }))).toBe("invalid_currency_code");
    expect(thrownCode(() => buildNativeReport({ currencyCode: "AUD", months: 3 }))).toBe("unsupported_currency");
    expect(thrownCode(() => buildNativeReport({ currencyCode: "CAD", months: 3 }))).toBe("currency_not_enabled");
  });
});

describe("native report is one currency only", () => {
  it("includes only the requested account currency and excludes transfers, starting rows and investment valuation", () => {
    const cnyBank = createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 10_000_000,
      startingDate: `${MONTH}-01`,
    });
    const cnyCard = createAccount({
      name: "CNY 信用卡",
      type: "creditCard",
      currencyCode: "CNY",
      startingBalance: -500_000,
      startingDate: `${MONTH}-01`,
    });
    const cnyOther = createAccount({
      name: "CNY 备用",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });
    const sgd = createAccount({
      name: "SGD 日常账户",
      type: "checking",
      currencyCode: "SGD",
      startingBalance: 500_000,
      startingDate: `${MONTH}-01`,
    });
    const usdInvest = createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: `${MONTH}-01`,
    });

    insertTx({ accountId: cnyBank, date: `${MONTH}-05`, amount: 200_000, categoryId: salaryId, payee: "公司" });
    insertTx({ accountId: cnyBank, date: `${MONTH}-08`, amount: -80_000, categoryId: diningId, payee: "盒马" });
    insertTx({
      accountId: cnyBank,
      date: `${MONTH}-09`,
      amount: -30_000,
      transferAccountId: cnyOther,
      payee: "内部转账",
    });
    insertTx({
      accountId: cnyOther,
      date: `${MONTH}-09`,
      amount: 30_000,
      transferAccountId: cnyBank,
      payee: "内部转账",
    });
    insertTx({ accountId: sgd, date: `${MONTH}-05`, amount: 80_000, categoryId: salaryId, payee: "SGD 工资" });
    insertTx({ accountId: sgd, date: `${MONTH}-08`, amount: -12_000, categoryId: diningId, payee: "SGD 餐饮" });
    insertTx({
      accountId: usdInvest,
      date: `${MONTH}-10`,
      amount: 50_000,
      payee: "__reconciling__",
      isReconcileAdjustment: 1,
    });

    const report = buildNativeReport({ currencyCode: "CNY", months: 3 });
    expect(report.currencyCode).toBe("CNY");
    const income = report.income.find((row) => row.month === MONTH).value;
    const expense = report.expense.find((row) => row.month === MONTH).value;
    expect(income).toBe(200_000);
    expect(expense).toBe(80_000);
    expect(report.breakdown).toEqual([{ name: "餐饮", value: 80_000 }]);
    expect(report.topPayees).toEqual([{ name: "盒马", value: 80_000 }]);
    expect(report.incomeSources).toEqual([{ name: expect.any(String), value: 200_000 }]);
    expect(report.accounts.map((account) => account.currencyCode).sort()).toEqual(["CNY", "CNY", "CNY"]);
    expect(report.accounts.some((account) => account.name.includes("SGD") || account.name.includes("投资"))).toBe(false);
    expect(report.totalAssets).toBe(10_000_000 + 200_000 - 80_000);
    expect(report.totalLiabilities).toBe(-500_000);
    expect(report.netWorthNow).toBe(report.totalAssets + report.totalLiabilities);

    const point = report.netWorth.find((row) => row.month === MONTH);
    expect(point.assets).toBe(report.totalAssets);
    expect(point.liabilities).toBe(report.totalLiabilities);
    expect(point.net).toBe(report.netWorthNow);
    expect(report.ageOfMoney).toBe(ageOfMoney("CNY"));

    const sgdReport = buildNativeReport({ currencyCode: "SGD", months: 3 });
    expect(sgdReport.currencyCode).toBe("SGD");
    expect(sgdReport.income.find((row) => row.month === MONTH).value).toBe(80_000);
    expect(sgdReport.expense.find((row) => row.month === MONTH).value).toBe(12_000);
    expect(sgdReport.accounts).toHaveLength(1);
    expect(sgdReport.accounts[0].currencyCode).toBe("SGD");

    const usdReport = buildNativeReport({ currencyCode: "USD", months: 3 });
    expect(usdReport.income.find((row) => row.month === MONTH).value).toBe(0);
    expect(usdReport.expense.find((row) => row.month === MONTH).value).toBe(0);
    expect(usdReport.accounts).toHaveLength(1);
    expect(usdReport.accounts[0].balance).toBe(1_050_000);
  });
});
