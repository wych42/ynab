import { afterAll, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { snapshotFinancialAmounts } from "./test-support/finance-fixtures.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-currency-disable-");

const { api } = await import("./routes.mjs");
const { db } = await import("./db.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);

function expectCurrencyError(result, code) {
  expect(result.status).toBe(400);
  expect(result.json).toMatchObject({ error: code, code });
}

function ledgerCodes() {
  return db
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY currency_code")
    .all()
    .map((row) => row.currency_code);
}

function spendCategoryId() {
  return db
    .prepare(
      `SELECT c.id FROM categories c
       JOIN category_groups g ON g.id=c.group_id
       WHERE COALESCE(g.is_income,0)=0
       ORDER BY c.sort_order, c.name
       LIMIT 1`
    )
    .get().id;
}

describe("PUT /api/settings disableCurrency", () => {
  it("deletes an empty unused CAD ledger and does not create accounts or amounts", async () => {
    expect(ledgerCodes()).not.toContain("CAD");
    const enabled = await call("PUT", "/api/settings", { enableCurrency: "CAD" });
    expect(enabled.status).toBe(200);
    expect(ledgerCodes()).toContain("CAD");
    const amountsBefore = snapshotFinancialAmounts(db);

    const disabled = await call("PUT", "/api/settings", { disableCurrency: "CAD" });
    expect(disabled.status).toBe(200);
    expect(ledgerCodes()).not.toContain("CAD");
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);
    expect(db.prepare("SELECT COUNT(*) c FROM accounts WHERE currency_code='CAD'").get().c).toBe(0);
  });

  it("rejects disabling the current reporting currency", async () => {
    const reporting = await call("PUT", "/api/settings", { reportingCurrency: "CNY" });
    expect(reporting.status).toBe(200);
    const amountsBefore = snapshotFinancialAmounts(db);
    const ledgersBefore = ledgerCodes();

    expectCurrencyError(await call("PUT", "/api/settings", { disableCurrency: "CNY" }), "cannot_disable_reporting_currency");
    expect(ledgerCodes()).toEqual(ledgersBefore);
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);

    const settings = await call("GET", "/api/settings");
    expect(settings.json.reportingCurrency).toBe("CNY");
  });

  it("rejects disabling a currency that has an account", async () => {
    const enable = await call("PUT", "/api/settings", { enableCurrency: "CAD" });
    expect(enable.status).toBe(200);
    const created = await call("POST", "/api/accounts", {
      name: "加元现金",
      type: "cash",
      currencyCode: "CAD",
      startingBalanceMinor: 0,
    });
    expect(created.status).toBe(200);
    const amountsBefore = snapshotFinancialAmounts(db);

    expectCurrencyError(await call("PUT", "/api/settings", { disableCurrency: "CAD" }), "currency_in_use");
    expect(ledgerCodes()).toContain("CAD");
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);
  });

  it("rejects disabling a currency that has an assignment or a goal", async () => {
    const enable = await call("PUT", "/api/settings", { enableCurrency: "GBP" });
    expect(enable.status).toBe(200);
    const categoryId = spendCategoryId();
    const assigned = await call("PUT", `/api/budget/2026-09/category/${categoryId}/assign?currency=GBP`, {
      assigned: 1500,
    });
    expect(assigned.status).toBe(200);

    expectCurrencyError(await call("PUT", "/api/settings", { disableCurrency: "GBP" }), "currency_in_use");
    expect(ledgerCodes()).toContain("GBP");

    db.prepare("DELETE FROM assignments WHERE currency_code='GBP'").run();
    const goal = await call("PUT", `/api/goals/${categoryId}?currency=GBP`, { type: "monthly", target: 2600 });
    expect(goal.status).toBe(200);

    expectCurrencyError(await call("PUT", "/api/settings", { disableCurrency: "GBP" }), "currency_in_use");
    expect(ledgerCodes()).toContain("GBP");
  });
});
