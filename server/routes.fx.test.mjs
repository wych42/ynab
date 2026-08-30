import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-fx-routes-");

const fxApi = await import("./fx.mjs");
const adapter = fxApi.createInMemoryFxAdapter({ source: "frankfurter_ecb" });
fxApi.registerFxProvider("frankfurter_ecb", () => adapter);

const { api } = await import("./routes.mjs");
const { db, setSetting } = await import("./db.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const WORKDAY = "2026-08-28";
const LOCK = "currency_migration_required";

function expectCode(result, status, code) {
  expect({ status: result.status, error: result.json.error, code: result.json.code }).toEqual({
    status,
    error: code,
    code,
  });
}

function rateRows() {
  return db
    .prepare(
      "SELECT rate_date, base_currency, quote_currency, rate, source FROM fx_rates ORDER BY source, quote_currency"
    )
    .all();
}

describe("FX HTTP interface", () => {
  beforeAll(() => {
    db.prepare("DELETE FROM fx_rates").run();
    adapter.setRecords([
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
      },
    ]);
  });

  it("reports empty cache status and the default provider", async () => {
    const result = await call("GET", "/api/fx/status");
    expect(result.status).toBe(200);
    expect(result.json.defaultProvider).toBe("frankfurter_ecb");
    expect(result.json.latestRateDate).toBeNull();
    expect(result.json.latestSource).toBeNull();
    expect(result.json.rates).toEqual([]);
    expect(result.json.lastSyncError).toBeNull();
  });

  it("adds and overwrites a manual rate", async () => {
    const created = await call("PUT", `/api/fx/rates/${WORKDAY}/USD/CNY`, { rate: "7.10" });
    expect(created.status).toBe(200);
    expect(created.json.ok).toBe(true);

    const overwritten = await call("PUT", `/api/fx/rates/${WORKDAY}/USD/CNY`, { rate: "7.15" });
    expect(overwritten.status).toBe(200);

    const status = await call("GET", "/api/fx/status");
    expect(status.json.latestRateDate).toBe(WORKDAY);
    expect(status.json.latestSource).toBe("manual");
    expect(status.json.rates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rateDate: WORKDAY,
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "7.15",
          source: "manual",
        }),
      ]),
    );
    expect(rateRows().filter((row) => row.source === "manual")).toHaveLength(1);
  });

  it("refreshes automatic rates into the cache", async () => {
    const result = await call("POST", "/api/fx/sync", { fromDate: "2026-08-24", toDate: WORKDAY });
    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(rateRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rate_date: WORKDAY,
          base_currency: "USD",
          quote_currency: "CNY",
          rate: "7.20",
          source: "frankfurter_ecb",
        }),
        expect.objectContaining({
          rate_date: WORKDAY,
          base_currency: "USD",
          quote_currency: "CNY",
          rate: "7.15",
          source: "manual",
        }),
      ]),
    );
  });

  it("deletes only the manual override", async () => {
    const result = await call("DELETE", `/api/fx/rates/${WORKDAY}/USD/CNY`);
    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    const rows = rateRows();
    expect(rows.some((row) => row.source === "manual")).toBe(false);
    expect(rows.some((row) => row.source === "frankfurter_ecb" && row.rate === "7.20")).toBe(true);
  });

  it("keeps cached rates when refresh fails and returns a stable code", async () => {
    adapter.setFailure({ code: "fx_provider_timeout", message: "offline" });
    const failed = await call("POST", "/api/fx/sync", { fromDate: "2026-08-24", toDate: WORKDAY });
    expectCode(failed, 502, "fx_provider_timeout");
    const status = await call("GET", "/api/fx/status");
    expect(status.status).toBe(200);
    expect(status.json.lastSyncError).toEqual(
      expect.objectContaining({ code: "fx_provider_timeout" }),
    );
    expect(status.json.rates.some((row) => row.source === "frankfurter_ecb" && row.rate === "7.20")).toBe(true);
    adapter.setFailure(null);
  });

  it("returns 502 fx_provider_network_error for transport failures and keeps the cache", async () => {
    adapter.setFailure(new Error("connect ECONNREFUSED 127.0.0.1:443"));
    const before = rateRows();
    try {
      const failed = await call("POST", "/api/fx/sync", { fromDate: "2026-08-24", toDate: WORKDAY });
      expectCode(failed, 502, "fx_provider_network_error");
      expect(rateRows()).toEqual(before);
    } finally {
      adapter.setFailure(null);
    }
  });

  it("returns 502 fx_provider_empty_result when refresh finds no rates and keeps the cache", async () => {
    adapter.setFailure(null);
    adapter.setRecords([]);
    const before = rateRows();
    const failed = await call("POST", "/api/fx/sync", { fromDate: "2026-08-24", toDate: WORKDAY });
    expectCode(failed, 502, "fx_provider_empty_result");
    expect(rateRows()).toEqual(before);
    adapter.setRecords([
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
      },
    ]);
  });

  it("rejects invalid FX writes with stable codes", async () => {
    const cases = [
      ["PUT", `/api/fx/rates/${WORKDAY}/usd/CNY`, { rate: "7.10" }, "invalid_currency_code"],
      ["PUT", `/api/fx/rates/${WORKDAY}/AUD/CNY`, { rate: "7.10" }, "unsupported_currency"],
      ["PUT", `/api/fx/rates/${WORKDAY}/CAD/CNY`, { rate: "7.10" }, "currency_not_enabled"],
      ["PUT", `/api/fx/rates/2026-13-40/USD/CNY`, { rate: "7.10" }, "invalid_date"],
      ["PUT", `/api/fx/rates/2099-01-01/USD/CNY`, { rate: "7.10" }, "future_rate_date"],
      ["PUT", `/api/fx/rates/${WORKDAY}/USD/CNY`, { rate: "0" }, "invalid_rate"],
      ["PUT", `/api/fx/rates/${WORKDAY}/USD/CNY`, { rate: "-1.2" }, "invalid_rate"],
      ["PUT", `/api/fx/rates/${WORKDAY}/USD/USD`, { rate: "1" }, "same_currency_pair"],
      ["DELETE", `/api/fx/rates/${WORKDAY}/CAD/CNY`, undefined, "currency_not_enabled"],
      ["DELETE", `/api/fx/rates/2099-01-01/USD/CNY`, undefined, "future_rate_date"],
    ];
    const before = rateRows();
    for (const [method, url, body, code] of cases) {
      expectCode(await call(method, url, body), 400, code);
    }
    expect(rateRows()).toEqual(before);
  });
});

describe("FX writes during currency migration lock", () => {
  let previous;

  beforeAll(() => {
    previous = db.prepare("SELECT value FROM settings WHERE key='currency_migration_status'").get()?.value;
    setSetting("currency_migration_status", "pending");
  });

  afterAll(() => {
    if (previous == null) db.prepare("DELETE FROM settings WHERE key='currency_migration_status'").run();
    else setSetting("currency_migration_status", previous);
  });

  it("blocks FX writes and keeps reads available", async () => {
    const writes = [
      await call("POST", "/api/fx/sync", { fromDate: "2026-08-24", toDate: WORKDAY }),
      await call("PUT", `/api/fx/rates/${WORKDAY}/USD/SGD`, { rate: "1.35" }),
      await call("DELETE", `/api/fx/rates/${WORKDAY}/USD/CNY`),
    ];
    for (const result of writes) {
      expectCode(result, 409, LOCK);
    }
    const status = await call("GET", "/api/fx/status");
    expect(status.status).toBe(200);
    expect(status.json.defaultProvider).toBe("frankfurter_ecb");
    expect(rateRows().some((row) => row.base_currency === "USD" && row.quote_currency === "SGD")).toBe(false);
  });
});
