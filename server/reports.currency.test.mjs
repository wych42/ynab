import { afterEach, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-reports-currency-");

const { db, uid, createAccount } = await import("./db.mjs");
const { createFxModule, createInMemoryFxAdapter } = await import("./fx.mjs");
const { createReportsModule } = await import("./reports.mjs");

const AS_OF = "2026-08-30";
const WORKDAY = "2026-08-28";
const NOW = "2026-08-30T00:00:00.000Z";

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

function insertTx({ accountId, date, amount, isStart = 0 }) {
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,amount,cleared,reconciled,is_start,created_at)
     VALUES(?,?,?,?,?,0,0,?,?)`
  ).run(uid(), accountId, date, "tx", amount, isStart, NOW);
}

function fixtureRates(rateDate = WORKDAY, source = "frankfurter_ecb") {
  insertRate({ rateDate, baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.20", source });
  insertRate({ rateDate, baseCurrency: "SGD", quoteCurrency: "CNY", rate: "5.40", source });
  insertRate({ rateDate, baseCurrency: "JPY", quoteCurrency: "CNY", rate: "0.050", source });
}

function seedFamilyAccounts({ startingDate = "2026-01-01" } = {}) {
  return {
    cnyBank: createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 10_000_000,
      startingDate,
    }),
    cnyCard: createAccount({
      name: "CNY 信用卡",
      type: "creditCard",
      currencyCode: "CNY",
      startingBalance: -500_000,
      startingDate,
    }),
    usdInvest: createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate,
    }),
    sgd: createAccount({
      name: "SGD 日常账户",
      type: "checking",
      currencyCode: "SGD",
      startingBalance: 500_000,
      startingDate,
    }),
    jpy: createAccount({
      name: "JPY 现金",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 100_000,
      startingDate,
    }),
    eur: createAccount({
      name: "EUR 备用账户",
      type: "checking",
      currencyCode: "EUR",
      startingBalance: 0,
      startingDate,
    }),
  };
}

function instrumentFx(inner) {
  const lookups = [];
  const fx = {
    getRate: async (query) => {
      lookups.push({ op: "getRate", from: query.from, to: query.to, asOf: query.asOf });
      return inner.getRate(query);
    },
    convert: async (query) => {
      lookups.push({ op: "convert", from: query.from, to: query.to, asOf: query.asOf });
      return inner.convert(query);
    },
  };
  return { fx, lookups };
}

function makeReports() {
  const inner = createFxModule({
    db,
    provider: createInMemoryFxAdapter({ source: "frankfurter_ecb" }),
    today: () => AS_OF,
    nowIso: () => NOW,
  });
  const { fx, lookups } = instrumentFx(inner);
  return { reports: createReportsModule({ db, fx }), fx, lookups, inner };
}

function wipe() {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM fx_rates").run();
}

afterEach(() => {
  wipe();
});

describe("buildNetWorthReport current household fixture", () => {
  it("converts every account, classifies by sign, and matches the hand-computed CNY totals", async () => {
    seedFamilyAccounts();
    fixtureRates();
    const { reports, lookups } = makeReports();

    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });

    expect(report.reportingCurrency).toBe("CNY");
    expect(report.asOf).toBe(AS_OF);
    expect(report.complete).toBe(true);
    expect(report.totalAssetsMinor).toBe(20_400_000);
    expect(report.totalLiabilitiesMinor).toBe(500_000);
    expect(report.netWorthMinor).toBe(19_900_000);
    expect(report.missing).toEqual([]);

    const byName = Object.fromEntries(report.accounts.map((row) => [row.name, row]));
    expect(byName["家庭 CNY 日常账户"]).toMatchObject({
      currencyCode: "CNY",
      nativeBalanceMinor: 10_000_000,
      convertedBalanceMinor: 10_000_000,
    });
    expect(byName["CNY 信用卡"]).toMatchObject({
      currencyCode: "CNY",
      nativeBalanceMinor: -500_000,
      convertedBalanceMinor: -500_000,
    });
    expect(byName["USD 投资账户"]).toMatchObject({
      currencyCode: "USD",
      nativeBalanceMinor: 1_000_000,
      convertedBalanceMinor: 7_200_000,
      fx: expect.objectContaining({
        from: "USD",
        to: "CNY",
        asOfDate: AS_OF,
        rateDate: WORKDAY,
        source: "frankfurter_ecb",
        path: "direct",
        rate: "7.20",
      }),
    });
    expect(byName["SGD 日常账户"].convertedBalanceMinor).toBe(2_700_000);
    expect(byName["JPY 现金"].convertedBalanceMinor).toBe(500_000);
    expect(byName["EUR 备用账户"]).toMatchObject({
      nativeBalanceMinor: 0,
      convertedBalanceMinor: 0,
    });
    expect(lookups.some((row) => row.from === "EUR" && row.to === "CNY")).toBe(false);

    const converted = report.accounts
      .map((row) => row.convertedBalanceMinor)
      .filter((value) => value != null);
    const assets = converted.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const liabilities = converted.filter((value) => value < 0).reduce((sum, value) => sum + -value, 0);
    expect(assets).toBe(report.totalAssetsMinor);
    expect(liabilities).toBe(report.totalLiabilitiesMinor);
    expect(assets - liabilities).toBe(report.netWorthMinor);

    const current = report.history.at(-1);
    expect(current).toMatchObject({
      month: "2026-08",
      asOf: AS_OF,
      complete: true,
      totalAssetsMinor: 20_400_000,
      totalLiabilitiesMinor: 500_000,
      netWorthMinor: 19_900_000,
    });
    expect(current.rates.map((row) => row.from).sort()).toEqual(["CNY", "JPY", "SGD", "USD"]);
    expect(current.rates.some((row) => row.from === "EUR")).toBe(false);
    expect(current.rates.filter((row) => row.from === "CNY")).toEqual([
      expect.objectContaining({
        from: "CNY",
        to: "CNY",
        asOfDate: AS_OF,
        source: "identity",
        path: "identity",
        rate: "1",
      }),
    ]);
  });

  it("rounds each account before summing so 0.01 USD at 7.5 becomes CNY 0.16", async () => {
    createAccount({
      name: "USD A",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 1,
      startingDate: "2026-08-01",
    });
    createAccount({
      name: "USD B",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 1,
      startingDate: "2026-08-01",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.5",
      source: "frankfurter_ecb",
    });
    const { reports } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });
    expect(report.complete).toBe(true);
    expect(report.accounts.map((row) => row.convertedBalanceMinor).sort()).toEqual([8, 8]);
    expect(report.totalAssetsMinor).toBe(16);
    expect(report.totalLiabilitiesMinor).toBe(0);
    expect(report.netWorthMinor).toBe(16);
    expect(report.netWorthMinor).not.toBe(15);
  });

  it("treats a credit-card credit as an asset by converted sign, not account type", async () => {
    createAccount({
      name: "卡内溢缴",
      type: "creditCard",
      currencyCode: "CNY",
      startingBalance: 12_345,
      startingDate: "2026-08-01",
    });
    const { reports } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });
    expect(report.complete).toBe(true);
    expect(report.totalAssetsMinor).toBe(12_345);
    expect(report.totalLiabilitiesMinor).toBe(0);
    expect(report.netWorthMinor).toBe(12_345);
    expect(report.accounts[0].convertedBalanceMinor).toBe(12_345);
  });
});

describe("buildNetWorthReport missing rates", () => {
  it("stays complete when a zero-balance foreign account has no rate", async () => {
    createAccount({
      name: "EUR 备用账户",
      type: "checking",
      currencyCode: "EUR",
      startingBalance: 0,
      startingDate: "2026-08-01",
    });
    createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 100,
      startingDate: "2026-08-01",
    });
    const { reports, lookups } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });
    expect(report.complete).toBe(true);
    expect(report.totalAssetsMinor).toBe(100);
    expect(report.netWorthMinor).toBe(100);
    expect(report.missing).toEqual([]);
    expect(lookups.some((row) => row.from === "EUR")).toBe(false);
  });

  it("marks the point incomplete and returns null totals when a non-zero account lacks a rate", async () => {
    seedFamilyAccounts();
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "JPY",
      quoteCurrency: "CNY",
      rate: "0.050",
      source: "frankfurter_ecb",
    });
    const { reports } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });

    expect(report.complete).toBe(false);
    expect(report.totalAssetsMinor).toBeNull();
    expect(report.totalLiabilitiesMinor).toBeNull();
    expect(report.netWorthMinor).toBeNull();
    expect(report).not.toHaveProperty("totalAssets");
    expect(report.missing).toEqual([
      expect.objectContaining({
        base: "SGD",
        quote: "CNY",
        requestedDate: AS_OF,
      }),
    ]);

    const sgd = report.accounts.find((row) => row.currencyCode === "SGD");
    expect(sgd.nativeBalanceMinor).toBe(500_000);
    expect(sgd.convertedBalanceMinor).toBeNull();
    expect(sgd.fx).toBeNull();

    const usd = report.accounts.find((row) => row.currencyCode === "USD");
    expect(usd.convertedBalanceMinor).toBe(7_200_000);
    expect(usd.fx.rateDate).toBe(WORKDAY);

    const convertedSum = report.accounts
      .map((row) => row.convertedBalanceMinor)
      .filter((value) => typeof value === "number" && value > 0)
      .reduce((sum, value) => sum + value, 0);
    expect(convertedSum).toBe(10_000_000 + 7_200_000 + 500_000);
    expect(report.totalAssetsMinor).not.toBe(convertedSum);
    expect(report.totalAssetsMinor).not.toBe(0);
  });
});

describe("buildNetWorthReport history, start dates and memoization", () => {
  it("values prior months at month-end and ignores a later manual rate", async () => {
    const usd = createAccount({
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-06-01",
    });
    insertTx({ accountId: usd, date: "2026-07-15", amount: 100_000 });
    insertRate({
      rateDate: "2026-06-30",
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "6.00",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: "2026-07-31",
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.00",
      source: "manual",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    insertRate({
      rateDate: AS_OF,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "9.00",
      source: "manual",
    });

    const { reports, lookups } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 3,
    });

    expect(report.history.map((point) => ({ month: point.month, asOf: point.asOf }))).toEqual([
      { month: "2026-06", asOf: "2026-06-30" },
      { month: "2026-07", asOf: "2026-07-31" },
      { month: "2026-08", asOf: AS_OF },
    ]);
    expect(report.history[0]).toMatchObject({
      complete: true,
      totalAssetsMinor: 6_000_000,
      netWorthMinor: 6_000_000,
    });
    expect(report.history[1]).toMatchObject({
      complete: true,
      totalAssetsMinor: 7_700_000,
      netWorthMinor: 7_700_000,
    });
    expect(report.history[1].missing).toEqual([]);
    expect(report.history[1].rates).toEqual([
      expect.objectContaining({
        from: "USD",
        to: "CNY",
        asOfDate: "2026-07-31",
        rateDate: "2026-07-31",
        source: "manual",
        path: "direct",
        rate: "7.00",
      }),
    ]);
    expect(report.history[2]).toMatchObject({
      complete: true,
      totalAssetsMinor: 9_900_000,
      netWorthMinor: 9_900_000,
    });
    expect(report.history[2].rates).toEqual([
      expect.objectContaining({
        from: "USD",
        to: "CNY",
        asOfDate: AS_OF,
        rateDate: AS_OF,
        source: "manual",
        path: "direct",
        rate: "9.00",
      }),
    ]);
    expect(report.netWorthMinor).toBe(9_900_000);
    expect(report.history.at(-1).netWorthMinor).toBe(report.netWorthMinor);
    expect(report.history.at(-1).asOf).toBe(report.asOf);

    const julyLookups = lookups.filter((row) => row.from === "USD" && row.to === "CNY" && row.asOf === "2026-07-31");
    const augustLookups = lookups.filter((row) => row.from === "USD" && row.to === "CNY" && row.asOf === AS_OF);
    expect(julyLookups).toHaveLength(1);
    expect(augustLookups).toHaveLength(1);
  });

  it("omits an account before starting_balance_date and ignores later transactions", async () => {
    const late = createAccount({
      name: "八月才开的账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 4_000_000,
      startingDate: "2026-08-15",
    });
    insertTx({ accountId: late, date: "2026-08-20", amount: 250_000 });
    insertTx({ accountId: late, date: "2026-08-31", amount: 800_000 });
    createAccount({
      name: "一直存在的账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 100_000,
      startingDate: "2026-06-01",
    });

    const { reports } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 3,
    });

    const july = report.history.find((point) => point.month === "2026-07");
    expect(july.complete).toBe(true);
    expect(july.totalAssetsMinor).toBe(100_000);
    expect(july.netWorthMinor).toBe(100_000);

    expect(report.accounts.map((row) => row.name).sort()).toEqual(["一直存在的账户", "八月才开的账户"]);
    const opened = report.accounts.find((row) => row.name === "八月才开的账户");
    expect(opened.nativeBalanceMinor).toBe(4_250_000);
    expect(report.netWorthMinor).toBe(4_350_000);
  });

  it("ignores transactions dated before starting_balance_date in both history and current", async () => {
    const account = createAccount({
      name: "八月才开的账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 4_000_000,
      startingDate: "2026-08-15",
    });
    insertTx({ accountId: account, date: "2026-08-01", amount: 999_000 });
    insertTx({ accountId: account, date: "2026-08-20", amount: 250_000 });

    const { reports } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 3,
    });

    const july = report.history.find((point) => point.month === "2026-07");
    expect(july.totalAssetsMinor).toBe(0);
    expect(july.netWorthMinor).toBe(0);
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0].nativeBalanceMinor).toBe(4_250_000);
    expect(report.netWorthMinor).toBe(4_250_000);
  });

  it("memoizes the same from/to/asOf pair instead of converting each account separately", async () => {
    createAccount({
      name: "USD A",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 100,
      startingDate: "2026-08-01",
    });
    createAccount({
      name: "USD B",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 200,
      startingDate: "2026-08-01",
    });
    insertRate({
      rateDate: WORKDAY,
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.20",
      source: "frankfurter_ecb",
    });
    const { reports, lookups } = makeReports();
    const report = await reports.buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });
    const pair = lookups.filter((row) => row.from === "USD" && row.to === "CNY" && row.asOf === AS_OF);
    expect(pair).toHaveLength(1);
    expect(report.history[0].rates).toHaveLength(1);
  });
});
