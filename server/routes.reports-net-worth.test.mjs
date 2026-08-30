import { afterAll, afterEach, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-routes-net-worth-");

const fxApi = await import("./fx.mjs");
const adapter = fxApi.createInMemoryFxAdapter({ source: "frankfurter_ecb" });
fxApi.registerFxProvider("frankfurter_ecb", () => adapter);

const { api } = await import("./routes.mjs");
const { db, createAccount } = await import("./db.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const AS_OF = "2026-08-30";
const WORKDAY = "2026-08-28";

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
  db.prepare("DELETE FROM fx_rates").run();
  adapter.setRecords([]);
  adapter.setFailure(null);
}

afterEach(() => {
  wipe();
});

describe("GET /api/reports/net-worth", () => {
  it("returns a complete consolidated report for the household fixture", async () => {
    createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 10_000_000,
      startingDate: "2026-01-01",
    });
    createAccount({
      name: "CNY 信用卡",
      type: "creditCard",
      currencyCode: "CNY",
      startingBalance: -500_000,
      startingDate: "2026-01-01",
    });
    createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    createAccount({
      name: "SGD 日常账户",
      type: "checking",
      currencyCode: "SGD",
      startingBalance: 500_000,
      startingDate: "2026-01-01",
    });
    createAccount({
      name: "JPY 现金",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 100_000,
      startingDate: "2026-01-01",
    });
    createAccount({
      name: "EUR 备用账户",
      type: "checking",
      currencyCode: "EUR",
      startingBalance: 0,
      startingDate: "2026-01-01",
    });

    expect((await call("PUT", `/api/fx/rates/${WORKDAY}/USD/CNY`, { rate: "7.20" })).status).toBe(200);
    expect((await call("PUT", `/api/fx/rates/${WORKDAY}/SGD/CNY`, { rate: "5.40" })).status).toBe(200);
    expect((await call("PUT", `/api/fx/rates/${WORKDAY}/JPY/CNY`, { rate: "0.050" })).status).toBe(200);

    const result = await call(
      "GET",
      `/api/reports/net-worth?reportingCurrency=CNY&months=12&asOf=${AS_OF}`,
    );
    expect(result.status).toBe(200);
    expect(result.json.complete).toBe(true);
    expect(result.json.reportingCurrency).toBe("CNY");
    expect(result.json.asOf).toBe(AS_OF);
    expect(result.json.months).toBe(12);
    expect(result.json.totalAssetsMinor).toBe(20_400_000);
    expect(result.json.totalLiabilitiesMinor).toBe(500_000);
    expect(result.json.netWorthMinor).toBe(19_900_000);
    expect(result.json.accounts).toHaveLength(6);
    expect(result.json.history).toHaveLength(12);
    expect(result.json.history.at(-1)).toMatchObject({
      month: "2026-08",
      asOf: AS_OF,
      complete: true,
      netWorthMinor: 19_900_000,
    });
  });

  it("returns 200 with null totals when a non-zero rate is missing", async () => {
    createAccount({
      name: "SGD 日常账户",
      type: "checking",
      currencyCode: "SGD",
      startingBalance: 500_000,
      startingDate: "2026-08-01",
    });
    createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 10_000_000,
      startingDate: "2026-08-01",
    });

    const result = await call(
      "GET",
      `/api/reports/net-worth?reportingCurrency=CNY&months=1&asOf=${AS_OF}`,
    );
    expect(result.status).toBe(200);
    expect(result.json.complete).toBe(false);
    expect(result.json.totalAssetsMinor).toBeNull();
    expect(result.json.totalLiabilitiesMinor).toBeNull();
    expect(result.json.netWorthMinor).toBeNull();
    expect(result.json.missing).toEqual([
      expect.objectContaining({ base: "SGD", quote: "CNY", requestedDate: AS_OF }),
    ]);
    const sgd = result.json.accounts.find((row) => row.currencyCode === "SGD");
    expect(sgd.nativeBalanceMinor).toBe(500_000);
    expect(sgd.convertedBalanceMinor).toBeNull();
  });

  it("returns stable 400 codes for missing and illegal query values", async () => {
    expectCode(await call("GET", "/api/reports/net-worth"), 400, "invalid_currency_code");
    expectCode(
      await call("GET", `/api/reports/net-worth?months=12&asOf=${AS_OF}`),
      400,
      "invalid_currency_code",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=cny&months=12&asOf=${AS_OF}`),
      400,
      "invalid_currency_code",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=AUD&months=12&asOf=${AS_OF}`),
      400,
      "unsupported_currency",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=CAD&months=12&asOf=${AS_OF}`),
      400,
      "currency_not_enabled",
    );
    expectCode(
      await call("GET", "/api/reports/net-worth?reportingCurrency=CNY&months=12"),
      400,
      "invalid_date",
    );
    expectCode(
      await call("GET", "/api/reports/net-worth?reportingCurrency=CNY&months=12&asOf=2026-02-30"),
      400,
      "invalid_date",
    );
    expectCode(
      await call("GET", "/api/reports/net-worth?reportingCurrency=CNY&months=12&asOf=08-30-2026"),
      400,
      "invalid_date",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=CNY&asOf=${AS_OF}`),
      400,
      "invalid_months",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=CNY&months=0&asOf=${AS_OF}`),
      400,
      "invalid_months",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=CNY&months=25&asOf=${AS_OF}`),
      400,
      "invalid_months",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=CNY&months=abc&asOf=${AS_OF}`),
      400,
      "invalid_months",
    );
    expectCode(
      await call("GET", `/api/reports/net-worth?reportingCurrency=CNY&months=12.5&asOf=${AS_OF}`),
      400,
      "invalid_months",
    );
  });
});
