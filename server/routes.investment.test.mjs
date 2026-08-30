import { afterAll, afterEach, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-routes-investment-");

const { api } = await import("./routes.mjs");
const { db, createAccount } = await import("./db.mjs");
const { reconcileAccount } = await import("./currency-ledger.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const AS_OF = "2026-08-20";

function expectCode(result, status, code) {
  expect({ status: result.status, error: result.json.error, code: result.json.code }).toEqual({
    status,
    error: code,
    code,
  });
}

function wipe() {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
}

afterEach(() => {
  wipe();
});

describe("GET /api/investments/:id", () => {
  it("returns the native-currency investment view", async () => {
    const id = createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    reconcileAccount(db, {
      accountId: id,
      statementBalance: 1_100_000,
      markCleared: false,
      asOfDate: AS_OF,
    });

    const result = await call("GET", `/api/investments/${id}?months=1&asOf=${AS_OF}`);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      accountId: id,
      name: "USD 投资账户",
      currencyCode: "USD",
      asOf: AS_OF,
      months: 1,
      balanceMinor: 1_100_000,
      balanceChangeMinor: 100_000,
      contributionsMinor: 0,
      withdrawalsMinor: 0,
      netContributionsMinor: 0,
      latestValuationDate: AS_OF,
    });
    expect(result.json.history).toEqual([{ month: "2026-08", asOf: AS_OF, balanceMinor: 1_100_000 }]);
    expect(result.json).not.toHaveProperty("convertedBalanceMinor");
    expect(result.json).not.toHaveProperty("returnMinor");
  });

  it("still updates market value through the existing reconcile route", async () => {
    const id = createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    const posted = await call("POST", `/api/reconcile/${id}`, { statementBalance: 1_100_000, markCleared: false });
    expect(posted.status).toBe(200);
    expect(posted.json.adjustment).toBe(100_000);
    const adj = db.prepare("SELECT is_reconcile_adjustment FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(id);
    expect(adj.is_reconcile_adjustment).toBe(1);
  });

  it("returns stable 404/400 codes for missing, non-investment and illegal query values", async () => {
    expectCode(await call("GET", `/api/investments/missing-id?months=1&asOf=${AS_OF}`), 404, "account_not_found");

    const cash = createAccount({
      name: "CNY 现金",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10000,
      startingDate: "2026-08-01",
    });
    expectCode(await call("GET", `/api/investments/${cash}?months=1&asOf=${AS_OF}`), 400, "not_investment_account");

    const id = createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    expectCode(await call("GET", `/api/investments/${id}?asOf=${AS_OF}`), 400, "invalid_months");
    expectCode(await call("GET", `/api/investments/${id}?months=0&asOf=${AS_OF}`), 400, "invalid_months");
    expectCode(await call("GET", `/api/investments/${id}?months=25&asOf=${AS_OF}`), 400, "invalid_months");
    expectCode(await call("GET", `/api/investments/${id}?months=abc&asOf=${AS_OF}`), 400, "invalid_months");
    expectCode(await call("GET", `/api/investments/${id}?months=12.5&asOf=${AS_OF}`), 400, "invalid_months");
    expectCode(await call("GET", `/api/investments/${id}?months=1`), 400, "invalid_date");
    expectCode(await call("GET", `/api/investments/${id}?months=1&asOf=2026-02-30`), 400, "invalid_date");
    expectCode(await call("GET", `/api/investments/${id}?months=1&asOf=08-20-2026`), 400, "invalid_date");
  });
});
