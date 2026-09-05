import { afterAll, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
process.env.DATA_DIR = makeTempDataDir("fx-coverage-");
const { db, setSetting } = await import("./db.mjs");
const { createFxModule, createInMemoryFxAdapter } = await import("./fx.mjs");
const adapter = createInMemoryFxAdapter({ source: "frankfurter_ecb" });
const fx = createFxModule({ db, provider: adapter, today: () => "2026-09-05" });
afterAll(() => db.close());
it("reports only usable local rates, including inverses and EUR cross rates, without fetching", () => {
  setSetting("reporting_currency", "CNY");
  const insert = db.prepare("INSERT INTO fx_rates(rate_date,base_currency,quote_currency,rate,source,fetched_at) VALUES(?,?,?,?,?,?)");
  for (const [date, from, to, rate] of [["2026-09-04", "CNY", "USD", "0.14"], ["2026-09-04", "EUR", "CNY", "8"], ["2026-09-04", "JPY", "EUR", "0.006"], ["2026-09-06", "SGD", "CNY", "5.5"]]) {
    insert.run(date, from, to, rate, "manual", "2026-09-05T00:00:00Z");
  }
  const before = db.prepare("SELECT * FROM fx_rates ORDER BY base_currency").all();
  expect(fx.getStatus().coverage).toEqual({
    reportingCurrency: "CNY", asOf: "2026-09-05", currencies: [
      { currencyCode: "CNY", status: "identity", rateDate: null },
      { currencyCode: "USD", status: "available", rateDate: "2026-09-04" },
      { currencyCode: "SGD", status: "missing", rateDate: null },
      { currencyCode: "EUR", status: "available", rateDate: "2026-09-04" },
      { currencyCode: "JPY", status: "available", rateDate: "2026-09-04" },
    ],
  });
  expect(adapter.calls).toHaveLength(0);
  expect(db.prepare("SELECT * FROM fx_rates ORDER BY base_currency").all()).toEqual(before);
});
it("requires a configured default currency instead of guessing a coverage target", () => {
  setSetting("reporting_currency", "");
  expect(fx.getStatus().coverage).toEqual({ reportingCurrency: null, asOf: "2026-09-05", currencies: [] });
  expect(adapter.calls).toHaveLength(0);
});
