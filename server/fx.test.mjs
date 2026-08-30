import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-fx-module-");

const { db } = await import("./db.mjs");
const {
  FxProviderError,
  createFxModule,
  createInMemoryFxAdapter,
  getDefaultFxProviderId,
  registerFxProvider,
  setDefaultFxProviderId,
} = await import("./fx.mjs");
const { convertAmount } = await import("./money.mjs");

const TODAY = "2026-08-30";
const NOW = "2026-08-30T00:00:00.000Z";
const WORKDAY = "2026-08-28";

function insertRate(row) {
  db.prepare(
    `INSERT INTO fx_rates(rate_date, base_currency, quote_currency, rate, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.rateDate,
    row.baseCurrency,
    row.quoteCurrency,
    row.rate,
    row.source,
    row.fetchedAt ?? NOW,
  );
}

function rateCount() {
  return db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c;
}

function allRates() {
  return db
    .prepare(
      "SELECT rate_date, base_currency, quote_currency, rate, source FROM fx_rates ORDER BY rate_date, base_currency, quote_currency, source"
    )
    .all();
}

describe("FX module", () => {
  let adapter;
  let fx;

  beforeEach(() => {
    db.prepare("DELETE FROM fx_rates").run();
    adapter = createInMemoryFxAdapter({ source: "frankfurter_ecb" });
    fx = createFxModule({
      db,
      provider: adapter,
      today: () => TODAY,
      nowIso: () => NOW,
    });
  });

  afterEach(() => {
    db.exec("DROP TRIGGER IF EXISTS fx_rates_test_fail");
    db.prepare("DELETE FROM fx_rates").run();
  });

  it("returns an identity rate without calling the provider", async () => {
    adapter.setFailure({ code: "fx_provider_timeout", message: "should not run" });
    const result = await fx.getRate({ from: "USD", to: "USD", asOf: TODAY });
    expect(result).toEqual({
      ok: true,
      from: "USD",
      to: "USD",
      asOfDate: TODAY,
      rate: "1",
      rateDate: TODAY,
      source: "identity",
      path: "identity",
    });
    expect(adapter.calls).toHaveLength(0);
    expect(rateCount()).toBe(0);
  });

  it("uses a direct cached rate", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result).toMatchObject({
      ok: true,
      from: "USD",
      to: "CNY",
      asOfDate: TODAY,
      rate: "7.20",
      rateDate: WORKDAY,
      source: "frankfurter_ecb",
      path: "direct",
    });
    expect(adapter.calls).toHaveLength(0);
  });

  it("uses an exact inverse when only the reverse pair exists", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    const result = await fx.getRate({ from: "CNY", to: "USD", asOf: TODAY });
    expect(result.ok).toBe(true);
    expect(result.path).toBe("inverse");
    expect(result.rateDate).toBe(WORKDAY);
    expect(result.source).toBe("frankfurter_ecb");
    expect(new Decimal(result.rate).mul("7.20").eq(1)).toBe(true);

    const converted = await fx.convert({ amountMinor: 72000, from: "CNY", to: "USD", asOf: TODAY });
    expect(converted.ok).toBe(true);
    expect(converted.amountMinor).toBe(10000);
    expect(converted.path).toBe("inverse");
  });

  it("computes a same-day EUR cross when no direct pair exists", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      rate: "1.10",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "EUR",
      quoteCurrency: "CNY",
      rate: "7.92",
      source: "frankfurter_ecb",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(true);
    expect(result.path).toBe("eur_cross");
    expect(result.rateDate).toBe(WORKDAY);
    expect(result.source).toBe("frankfurter_ecb");
    expect(new Decimal(result.rate).eq("7.2")).toBe(true);

    const converted = await fx.convert({ amountMinor: 10000, from: "USD", to: "CNY", asOf: TODAY });
    expect(converted.amountMinor).toBe(72000);
  });

  it("does not mix EUR legs from different dates", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      rate: "1.10",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: "2026-08-27",
      baseCurrency: "EUR",
      quoteCurrency: "CNY",
      rate: "7.92",
      source: "frankfurter_ecb",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual({
      base: "USD",
      quote: "CNY",
      requestedDate: TODAY,
      reason: "missing_rate",
    });
    expect(result).not.toHaveProperty("rate");
  });

  it("falls back to the latest weekday and returns that actual date", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.rateDate).toBe(WORKDAY);
    expect(result.asOfDate).toBe(TODAY);
    expect(result.rate).toBe("7.20");
  });

  it("prefers a same-day manual rate over the automatic source", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.10",
      source: "manual",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result).toMatchObject({
      rate: "7.10",
      source: "manual",
      path: "direct",
      rateDate: WORKDAY,
    });
  });

  it("prefers a newer automatic rate over an older manual rate", async () => {
    insertRate({
      rateDate: "2026-08-01",
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "9.00",
      source: "manual",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result).toMatchObject({
      rate: "7.20",
      source: "frankfurter_ecb",
      path: "direct",
      rateDate: WORKDAY,
    });
  });

  it("uses direct automatic over inverse manual on the same day", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "CNY",
      quoteCurrency: "USD",
      rate: "0.2",
      source: "manual",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.path).toBe("direct");
    expect(result.source).toBe("frankfurter_ecb");
    expect(result.rate).toBe("7.20");
  });

  it("never uses a rate dated after the valuation date", async () => {
    insertRate({
      rateDate: "2026-08-31",
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "8.00",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: "2026-08-31",
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "8.50",
      source: "manual",
    });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(false);
    expect(result.missing.reason).toBe("missing_rate");
    expect(result).not.toHaveProperty("rate");
  });

  it("syncs on the first miss then hits cache for the same request", async () => {
    adapter.setRecords([
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
      },
    ]);
    const first = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(first.ok).toBe(true);
    expect(first.rate).toBe("7.20");
    expect(adapter.calls.length).toBeGreaterThan(0);
    const n = adapter.calls.length;
    expect(rateCount()).toBeGreaterThan(0);

    const second = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(second.ok).toBe(true);
    expect(second.rate).toBe("7.20");
    expect(adapter.calls.length).toBe(n);
  });

  it("uses cached rates while the provider is offline", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    adapter.setFailure({ code: "fx_provider_timeout", message: "offline" });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(true);
    expect(result.rate).toBe("7.20");
    expect(result.rateDate).toBe(WORKDAY);
    expect(adapter.calls).toHaveLength(0);
  });

  it("returns structured missing when the provider fails and cache is empty", async () => {
    adapter.setFailure({ code: "fx_provider_timeout", message: "offline" });
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual({
      base: "USD",
      quote: "CNY",
      requestedDate: TODAY,
      reason: "provider_failed",
    });
    expect(result).not.toHaveProperty("rate");
    expect(rateCount()).toBe(0);
  });

  it("returns structured missing when a provider throws a raw network Error", async () => {
    const broken = {
      source: "broken_feed",
      async fetchRates() {
        throw new Error("connect ECONNREFUSED 127.0.0.1:443");
      },
    };
    const offline = createFxModule({
      db,
      provider: broken,
      today: () => TODAY,
      nowIso: () => NOW,
    });
    const result = await offline.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual({
      base: "USD",
      quote: "CNY",
      requestedDate: TODAY,
      reason: "provider_failed",
    });
    expect(result).not.toHaveProperty("rate");
    expect(rateCount()).toBe(0);
  });

  it("keeps cache and fails explicit sync when every provider request is empty", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    adapter.setRecords([]);
    let error;
    try {
      await fx.syncRates({ currencies: ["USD", "CNY"], fromDate: "2026-08-24", toDate: WORKDAY });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FxProviderError);
    expect(error.code).toBe("fx_provider_empty_result");
    expect(allRates()).toEqual([
      {
        rate_date: WORKDAY,
        base_currency: "USD",
        quote_currency: "CNY",
        rate: "7.20",
        source: "frankfurter_ecb",
      },
    ]);
  });

  it("still succeeds when some bases are empty if another base returns rates", async () => {
    adapter.setRecords([
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
      },
    ]);
    const status = await fx.syncRates({
      currencies: ["USD", "CNY", "EUR"],
      fromDate: "2026-08-24",
      toDate: WORKDAY,
    });
    expect(status.ok).toBe(true);
    expect(allRates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rate_date: WORKDAY,
          base_currency: "USD",
          quote_currency: "CNY",
          rate: "7.20",
          source: "frankfurter_ecb",
        }),
      ]),
    );
  });

  it("returns structured missing from getRate when the provider is empty", async () => {
    adapter.setRecords([]);
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual({
      base: "USD",
      quote: "CNY",
      requestedDate: TODAY,
      reason: "missing_rate",
    });
    expect(result).not.toHaveProperty("rate");
    expect(rateCount()).toBe(0);
  });

  it("rejects an illegal custom-provider batch and rolls back the whole write", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "SGD",
      quoteCurrency: "CNY",
      rate: "5.40",
      source: "frankfurter_ecb",
    });
    const evil = {
      source: "evil_feed",
      async fetchRates() {
        return [
          {
            rateDate: WORKDAY,
            baseCurrency: "USD",
            quoteCurrency: "CNY",
            rate: "7.20",
            source: "evil_feed",
          },
          {
            rateDate: WORKDAY,
            baseCurrency: "USD",
            quoteCurrency: "USD",
            rate: "1",
            source: "evil_feed",
          },
        ];
      },
    };
    const poisoned = createFxModule({
      db,
      provider: evil,
      today: () => TODAY,
      nowIso: () => NOW,
    });
    await expect(
      poisoned.syncRates({ currencies: ["USD", "CNY"], fromDate: "2026-08-24", toDate: WORKDAY }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^fx_provider_/) });
    expect(allRates()).toEqual([
      {
        rate_date: WORKDAY,
        base_currency: "SGD",
        quote_currency: "CNY",
        rate: "5.40",
        source: "frankfurter_ecb",
      },
    ]);
  });

  it("rejects custom-provider records that are not fully normalized", async () => {
    const cases = [
      {
        rateDate: "2026-02-31",
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
        source: "evil_feed",
      },
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "0",
        source: "evil_feed",
      },
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
        source: "manual",
      },
      {
        rateDate: "2026-08-31",
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
        source: "evil_feed",
      },
      {
        rateDate: WORKDAY,
        baseCurrency: "AUD",
        quoteCurrency: "CNY",
        rate: "7.20",
        source: "evil_feed",
      },
    ];
    for (const bad of cases) {
      db.prepare("DELETE FROM fx_rates").run();
      const evil = {
        source: "evil_feed",
        async fetchRates() {
          return [
            {
              rateDate: WORKDAY,
              baseCurrency: "USD",
              quoteCurrency: "EUR",
              rate: "0.87",
              source: "evil_feed",
            },
            bad,
          ];
        },
      };
      const poisoned = createFxModule({
        db,
        provider: evil,
        today: () => TODAY,
        nowIso: () => NOW,
      });
      await expect(
        poisoned.syncRates({ currencies: ["USD", "CNY", "EUR"], fromDate: "2026-08-24", toDate: WORKDAY }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^fx_provider_/) });
      expect(allRates()).toEqual([]);
    }
  });

  it("keeps using the same getRate shape after the default provider is replaced", async () => {
    const alt = createInMemoryFxAdapter({
      source: "alt_feed",
      records: [
        {
          rateDate: WORKDAY,
          baseCurrency: "USD",
          quoteCurrency: "CNY",
          rate: "6.50",
        },
      ],
    });
    registerFxProvider("alt_feed", () => alt);
    const previous = getDefaultFxProviderId();
    setDefaultFxProviderId("alt_feed");
    try {
      const swapped = createFxModule({
        db,
        today: () => TODAY,
        nowIso: () => NOW,
      });
      const result = await swapped.getRate({ from: "USD", to: "CNY", asOf: TODAY });
      expect(result).toMatchObject({
        ok: true,
        rate: "6.50",
        source: "alt_feed",
        path: "direct",
      });
      swapped.putManualRate({
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "6.10",
      });
      const manual = await swapped.getRate({ from: "USD", to: "CNY", asOf: TODAY });
      expect(manual.source).toBe("manual");
      expect(manual.rate).toBe("6.10");
    } finally {
      setDefaultFxProviderId(previous);
    }
  });

  it("rolls back cached writes when the insert transaction fails", async () => {
    db.exec(`
      CREATE TRIGGER fx_rates_test_fail AFTER INSERT ON fx_rates
      BEGIN
        SELECT RAISE(ABORT, 'fx cache write failed');
      END;
    `);
    adapter.setRecords([
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.20",
      },
      {
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "EUR",
        rate: "0.87",
      },
    ]);
    await expect(
      fx.syncRates({ currencies: ["USD", "CNY", "EUR"], fromDate: "2026-08-24", toDate: WORKDAY }),
    ).rejects.toThrow();
    expect(rateCount()).toBe(0);
    expect(allRates()).toEqual([]);
  });

  it("converts positive and negative half-units with Money Module rounding", async () => {
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.5",
      source: "frankfurter_ecb",
    });
    const pos = await fx.convert({ amountMinor: 1, from: "USD", to: "CNY", asOf: TODAY });
    const neg = await fx.convert({ amountMinor: -1, from: "USD", to: "CNY", asOf: TODAY });
    expect(pos.ok).toBe(true);
    expect(pos.amountMinor).toBe(8);
    expect(neg.ok).toBe(true);
    expect(neg.amountMinor).toBe(-8);
    expect(pos.amountMinor).toBe(convertAmount({ amountMinor: 1, from: "USD", to: "CNY", rate: "7.5" }));
    expect(neg.amountMinor).toBe(convertAmount({ amountMinor: -1, from: "USD", to: "CNY", rate: "7.5" }));
  });

  it("propagates structured missing from convert", async () => {
    const result = await fx.convert({ amountMinor: 10000, from: "USD", to: "JPY", asOf: TODAY });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual({
      base: "USD",
      quote: "JPY",
      requestedDate: TODAY,
      reason: "missing_rate",
    });
    expect(result).not.toHaveProperty("amountMinor");
  });

  it("writes, overwrites and deletes manual rates without spoofing them as automatic", async () => {
    fx.putManualRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.10",
    });
    fx.putManualRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.15",
    });
    const rows = allRates();
    expect(rows).toEqual([
      {
        rate_date: WORKDAY,
        base_currency: "USD",
        quote_currency: "CNY",
        rate: "7.15",
        source: "manual",
      },
    ]);
    fx.deleteManualRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
    });
    expect(rateCount()).toBe(0);
  });

  it("rejects a future manual rate and a same-currency pair", () => {
    expect(() =>
      fx.putManualRate({
        rateDate: "2026-08-31",
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.00",
      }),
    ).toThrow(
      expect.objectContaining({ code: "future_rate_date" }),
    );
    expect(() =>
      fx.putManualRate({
        rateDate: WORKDAY,
        baseCurrency: "USD",
        quoteCurrency: "USD",
        rate: "1",
      }),
    ).toThrow(
      expect.objectContaining({ code: "same_currency_pair" }),
    );
    expect(rateCount()).toBe(0);
  });

  it("rejects deleting a manual rate for a disabled currency or a future date", () => {
    fx.putManualRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.10",
    });
    expect(() =>
      fx.deleteManualRate({
        rateDate: WORKDAY,
        baseCurrency: "CAD",
        quoteCurrency: "CNY",
      }),
    ).toThrow(expect.objectContaining({ code: "currency_not_enabled" }));
    expect(() =>
      fx.deleteManualRate({
        rateDate: "2026-08-31",
        baseCurrency: "USD",
        quoteCurrency: "CNY",
      }),
    ).toThrow(expect.objectContaining({ code: "future_rate_date" }));
    expect(allRates()).toEqual([
      {
        rate_date: WORKDAY,
        base_currency: "USD",
        quote_currency: "CNY",
        rate: "7.10",
        source: "manual",
      },
    ]);
  });

  it("refuses to persist an automatic record that claims to be manual", async () => {
    adapter.setRawResult([
      { date: WORKDAY, base: "USD", quote: "CNY", rate: "7.20", source: "manual" },
    ]);
    const result = await fx.getRate({ from: "USD", to: "CNY", asOf: TODAY });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("frankfurter_ecb");
    expect(allRates().every((row) => row.source !== "manual")).toBe(true);
  });
});
