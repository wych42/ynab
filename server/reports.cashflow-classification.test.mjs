import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("cashflow-classification-");
const { db, createAccount, currentMonth, uid } = await import("./db.mjs");
const { createReportsModule } = await import("./reports.mjs");
const fx = { getRate: vi.fn(() => { throw new Error("Native cashflow must not convert currency"); }) };
const reports = createReportsModule({ db, fx });
const month = currentMonth();
const accountId = createAccount({ name: "USD card", type: "creditCard", currencyCode: "USD", startingBalance: 0 });
const category = income => db.prepare("SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE COALESCE(g.is_income,0)=? ORDER BY c.id LIMIT 1").get(income).id;
const expenseCategory = category(0);
const incomeCategory = category(1);
beforeEach(() => { db.prepare("DELETE FROM transactions").run(); fx.getRate.mockClear(); });
afterAll(() => db.close());
function transaction(amount, categoryId = null) {
  // Direct insertion also represents historical negative income-category records,
  // which the current public write API no longer accepts.
  db.prepare("INSERT INTO transactions(id,account_id,date,payee_name,category_id,amount,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(uid(), accountId, `${month}-03`, "Shop", categoryId, amount, new Date().toISOString());
}
function amounts(view) {
  if (view === "overview") {
    const row = reports.buildCashflowOverview({ month }).currencies.find(row => row.currencyCode === "USD");
    return { income: row.incomeMinor, expense: row.expenseMinor, net: row.netInflowMinor };
  }
  const detail = reports.buildCashflowDetail({ currencyCode: "USD", months: 1 });
  const income = detail.income.find(row => row.month === month).value;
  const expense = detail.expense.find(row => row.month === month).value;
  return { income, expense, net: income - expense };
}
it.each(["overview", "detail"])("%s counts categorized $22 and uncategorized $15 as $37 expense", view => {
  transaction(-2200, expenseCategory);
  transaction(-1500);
  expect(amounts(view)).toEqual({ income: 0, expense: 3700, net: -3700 });
  expect(fx.getRate).not.toHaveBeenCalled();
});
it.each(["overview", "detail"])("%s keeps uncategorized positive money as income", view => {
  transaction(5000);
  transaction(-1500);
  expect(amounts(view)).toEqual({ income: 5000, expense: 1500, net: 3500 });
});
it.each(["overview", "detail"])("%s preserves explicitly categorized historical income reversals", view => {
  transaction(10000, incomeCategory);
  transaction(-1500, incomeCategory);
  expect(amounts(view)).toEqual({ income: 8500, expense: 0, net: 8500 });
});
it("includes uncategorized spending in detail breakdown and payees", () => {
  transaction(-2200, expenseCategory);
  transaction(-1500);
  const detail = reports.buildCashflowDetail({ currencyCode: "USD", months: 1 });
  expect(detail.breakdown).toContainEqual({ name: "未分类", kind: "uncategorized", value: 1500 });
  expect(detail.breakdown.reduce((sum, row) => sum + row.value, 0)).toBe(3700);
  expect(detail.topPayees).toContainEqual({ name: "Shop", value: 3700 });
});
it("does not mark a user category named 未分类 as a system category", () => {
  db.prepare("UPDATE categories SET name='未分类' WHERE id=?").run(expenseCategory);
  transaction(-2200, expenseCategory);
  const detail = reports.buildCashflowDetail({ currencyCode: "USD", months: 1 });
  expect(detail.breakdown).toContainEqual({ name: "未分类", value: 2200 });
});
it("does not put a historical income reversal in the expense breakdown", () => {
  transaction(-1500, incomeCategory);
  const detail = reports.buildCashflowDetail({ currencyCode: "USD", months: 1 });
  expect(detail.breakdown).toEqual([]);
  expect(detail.topPayees).toEqual([]);
});
