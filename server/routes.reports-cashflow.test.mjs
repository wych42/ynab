import { afterAll, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-reports-cashflow-");

const { api } = await import("./routes.mjs");
const { db, uid, createAccount, currentMonth } = await import("./db.mjs");
const { postTransaction, postTransfer, reconcileAccount } = await import("./currency-ledger.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const MONTH = currentMonth();
const DAY = `${MONTH}-05`;

const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "日常开销", 90);
const diningId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(diningId, spendGid, "餐饮", 0);
const incomeGid = db.prepare("SELECT id FROM category_groups WHERE is_income=1 ORDER BY sort_order LIMIT 1").get().id;
const salaryId = db.prepare("SELECT id FROM categories WHERE group_id=? ORDER BY sort_order LIMIT 1").get(incomeGid).id;

const cny = createAccount({ name: "家庭日常", type: "checking", currencyCode: "CNY", startingBalance: 0, startingDate: `${MONTH}-01` });
const sgd = createAccount({ name: "星展日常", type: "checking", currencyCode: "SGD", startingBalance: 0, startingDate: `${MONTH}-01` });
const usdCard = createAccount({ name: "美元卡", type: "creditCard", currencyCode: "USD", startingBalance: 0, startingDate: `${MONTH}-01` });
const jpy = createAccount({ name: "日元现金", type: "cash", currencyCode: "JPY", startingBalance: 0, startingDate: `${MONTH}-01` });
createAccount({ name: "欧元备用", type: "checking", currencyCode: "EUR", startingBalance: 0, startingDate: `${MONTH}-01` });
const usdInvest = createAccount({
  name: "先锋券商",
  type: "investment",
  currencyCode: "USD",
  startingBalance: 1_000_000,
  startingDate: `${MONTH}-01`,
});

postTransaction(db, { accountId: cny, date: DAY, amount: 200_000, categoryId: salaryId, payeeName: "公司" });
postTransaction(db, { accountId: cny, date: DAY, amount: -80_000, categoryId: diningId, payeeName: "盒马" });
postTransaction(db, { accountId: sgd, date: DAY, amount: 80_000, categoryId: salaryId, payeeName: "SGD 工资" });
postTransaction(db, { accountId: sgd, date: DAY, amount: -12_000, categoryId: diningId, payeeName: "SGD 餐饮" });
postTransaction(db, {
  accountId: usdCard,
  date: DAY,
  amount: -2200,
  categoryId: diningId,
  payeeName: "Paris cafe",
  originalCurrencyCode: "EUR",
  originalAmountMinor: 2000,
});
postTransaction(db, { accountId: jpy, date: DAY, amount: -1234, categoryId: diningId, payeeName: "便利店" });
postTransfer(db, { fromId: sgd, toId: cny, date: DAY, fromAmountMinor: 10_000, toAmountMinor: 55_000 });
reconcileAccount(db, { accountId: usdInvest, statementBalance: 1_100_000, markCleared: false, asOfDate: DAY });

function byCode(currencies) {
  return Object.fromEntries(currencies.map((row) => [row.currencyCode, row]));
}

const CROSS_TOTAL_KEYS = [
  "totalIncome",
  "totalExpense",
  "totalNetInflow",
  "grandTotal",
  "incomeMinor",
  "expenseMinor",
  "netInflowMinor",
  "netWorthNow",
];

describe("GET /api/reports/cashflow overview", () => {
  it("partitions this month by account currency without cross-currency totals", async () => {
    const result = await call("GET", "/api/reports/cashflow");
    expect(result.status).toBe(200);
    expect(result.json.month).toBe(MONTH);
    expect(result.json).not.toHaveProperty("totalIncome");
    expect(result.json).not.toHaveProperty("totalExpense");
    expect(result.json).not.toHaveProperty("totalNetInflow");
    expect(result.json).not.toHaveProperty("grandTotal");
    expect(result.json).not.toHaveProperty("netWorthNow");
    for (const key of CROSS_TOTAL_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(result.json, key)).toBe(false);
    }

    const map = byCode(result.json.currencies);
    expect(map.CNY).toMatchObject({
      currencyCode: "CNY",
      incomeMinor: 200_000,
      expenseMinor: 80_000,
      netInflowMinor: 120_000,
      active: true,
    });
    expect(map.SGD).toMatchObject({
      currencyCode: "SGD",
      incomeMinor: 80_000,
      expenseMinor: 12_000,
      netInflowMinor: 68_000,
      active: true,
    });
    expect(map.USD).toMatchObject({
      currencyCode: "USD",
      incomeMinor: 0,
      expenseMinor: 2200,
      netInflowMinor: -2200,
      active: true,
    });
    expect(map.JPY).toMatchObject({
      currencyCode: "JPY",
      incomeMinor: 0,
      expenseMinor: 1234,
      netInflowMinor: -1234,
      active: true,
    });
    expect(map.EUR).toMatchObject({
      currencyCode: "EUR",
      incomeMinor: 0,
      expenseMinor: 0,
      netInflowMinor: 0,
      active: false,
    });
  });

  it("does not treat FX transfers or investment valuations as ordinary cashflow", async () => {
    const result = await call("GET", "/api/reports/cashflow");
    const map = byCode(result.json.currencies);
    expect(map.CNY.incomeMinor).toBe(200_000);
    expect(map.CNY.expenseMinor).toBe(80_000);
    expect(map.SGD.incomeMinor).toBe(80_000);
    expect(map.SGD.expenseMinor).toBe(12_000);
    expect(map.USD.incomeMinor).toBe(0);
  });
});

describe("GET /api/reports/cashflow detail", () => {
  it("returns a single-currency cashflow view without household net worth fields", async () => {
    const byPath = await call("GET", "/api/reports/cashflow/CNY");
    expect(byPath.status).toBe(200);
    expect(byPath.json.currencyCode).toBe("CNY");
    expect(byPath.json.income.find((row) => row.month === MONTH).value).toBe(200_000);
    expect(byPath.json.expense.find((row) => row.month === MONTH).value).toBe(80_000);
    expect(byPath.json.breakdown.some((row) => row.name === "餐饮" && row.value === 80_000)).toBe(true);
    expect(byPath.json.topPayees.some((row) => row.name === "盒马")).toBe(true);
    expect(byPath.json.incomeSources.length).toBeGreaterThan(0);
    expect(byPath.json).not.toHaveProperty("netWorthNow");
    expect(byPath.json).not.toHaveProperty("netWorth");
    expect(byPath.json).not.toHaveProperty("totalAssets");
    expect(byPath.json).not.toHaveProperty("totalLiabilities");

    const byQuery = await call("GET", "/api/reports/cashflow?currency=CNY");
    expect(byQuery.status).toBe(200);
    expect(byQuery.json.currencyCode).toBe("CNY");
    expect(byQuery.json).not.toHaveProperty("netWorthNow");
  });
});
