import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-valuation-date-");
const { db, createAccount, ymd, todayYmd, getSetting, setSetting } = await import("./db.mjs");
const { createReportsModule } = await import("./reports.mjs");
const fxApi = await import("./fx.mjs");
const adapter = fxApi.createInMemoryFxAdapter({ source: "frankfurter_ecb" });
fxApi.registerFxProvider("frankfurter_ecb", () => adapter);
const fetchRates = vi.spyOn(adapter, "fetchRates");
const { api } = await import("./routes.mjs");
const server = await startTestApi(api);
afterAll(() => server.close());
afterEach(() => {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM fx_rates").run();
  vi.clearAllMocks();
});

describe("net-worth valuation date boundary", () => {
  it.each([
    ["bad", "invalid_date"],
    ["", "invalid_date"],
    ["2026-02-30", "invalid_date"],
    ["2026-2-03", "invalid_date"],
    ["2099-01-01", "future_valuation_date"],
  ])("rejects HTTP asOf=%s before requesting FX", async (asOf, code) => {
    createAccount({ name: "USD", type: "checking", currencyCode: "USD", startingBalance: 100, startingDate: "2020-01-01" });
    const result = await server.call("GET", `/api/reports/net-worth?reportingCurrency=CNY&months=1&asOf=${asOf}`);
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ error: code, code });
    expect(fetchRates).not.toHaveBeenCalled();
  });

  it("keeps the required asOf API contract", async () => {
    const result = await server.call("GET", "/api/reports/net-worth?reportingCurrency=CNY&months=1");
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: "invalid_date" });
  });

  it("accepts today and historical HTTP dates", async () => {
    for (const asOf of [todayYmd(), "2024-02-29"]) {
      const result = await server.call("GET", `/api/reports/net-worth?reportingCurrency=CNY&months=1&asOf=${asOf}`);
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ asOf, complete: true, netWorthMinor: 0 });
    }
  });

  it("uses the household calendar day across a UTC date boundary and reads timezone changes", async () => {
    const previous = getSetting("timezone", "");
    const instant = new Date("2026-09-04T16:30:00.000Z");
    const getRate = vi.fn();
    const reports = createReportsModule({ db, fx: { getRate }, today: () => ymd(instant) });
    const request = { reportingCurrency: "CNY", months: 1, asOf: "2026-09-05" };
    try {
      setSetting("timezone", "Asia/Singapore");
      await expect(reports.buildNetWorthReport(request)).resolves.toMatchObject({ asOf: "2026-09-05", complete: true });
      await expect(reports.buildNetWorthReport({ ...request, asOf: "2026-09-06" })).rejects.toMatchObject({ code: "future_valuation_date" });
      setSetting("timezone", "UTC");
      await expect(reports.buildNetWorthReport(request)).rejects.toMatchObject({ code: "future_valuation_date" });
      await expect(reports.buildNetWorthReport({ ...request, asOf: "2026-09-04" })).resolves.toMatchObject({ asOf: "2026-09-04" });
      expect(getRate).not.toHaveBeenCalled();
    } finally {
      setSetting("timezone", previous);
    }
  });
});
