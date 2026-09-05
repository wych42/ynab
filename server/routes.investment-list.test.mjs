import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-investment-list-");

const { api } = await import("./routes.mjs");
const { db, createAccount, setSetting } = await import("./db.mjs");
const { reconcileAccount, postTransfer } = await import("./currency-ledger.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const AS_OF = "2026-08-20";

function wipe() {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
}

afterEach(() => {
  vi.useRealTimers();
  wipe();
});

function forbiddenKeys(value) {
  const json = JSON.stringify(value);
  return ["return", "yield", "收益", "回报率", "持仓", "成本基础"].filter((word) => json.includes(word));
}

describe("GET /api/investments", () => {
  it("opens without query parameters using today's household date and twelve months", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-04T16:30:00Z"));
    setSetting("timezone", "Asia/Singapore");
    const id = createAccount({ name: "Default entry", type: "investment", currencyCode: "USD", startingBalance: 12345, startingDate: "2026-09-05" });
    const result = await call("GET", "/api/investments");
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ asOf: "2026-09-05", months: 12 });
    expect(result.json.accounts).toEqual([expect.objectContaining({ accountId: id, balanceMinor: 12345 })]);
  });
  it.each([["asOf=", "invalid_date"], ["asOf=2026-02-30", "invalid_date"], ["months=", "invalid_months"], ["months=0", "invalid_months"]])("rejects explicit invalid query %s", async (query, code) => {
    const result = await call("GET", `/api/investments?${query}`);
    expect(result.status).toBe(400);
    expect(result.json.code).toBe(code);
  });
  it("lists investment accounts with the native field whitelist", async () => {
    const usd = createAccount({
      name: "先锋券商",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    reconcileAccount(db, {
      accountId: usd,
      statementBalance: 1_100_000,
      markCleared: false,
      asOfDate: AS_OF,
    });

    const result = await call("GET", `/api/investments?asOf=${AS_OF}&months=1`);
    expect(result.status).toBe(200);
    expect(result.json.accounts).toHaveLength(1);
    expect(result.json.accounts[0]).toMatchObject({
      accountId: usd,
      name: "先锋券商",
      currencyCode: "USD",
      balanceMinor: 1_100_000,
      balanceChangeMinor: 100_000,
      contributionsMinor: 0,
      withdrawalsMinor: 0,
      netContributionsMinor: 0,
      latestValuationDate: AS_OF,
    });
    expect(result.json.accounts[0]).not.toHaveProperty("returnMinor");
    expect(result.json.accounts[0]).not.toHaveProperty("yield");
    expect(forbiddenKeys(result.json)).toEqual([]);
  });

  it("subtotals same-currency accounts and does not add USD to SGD", async () => {
    const usdA = createAccount({
      name: "USD 投资 A",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 1_000_000,
      startingDate: "2026-01-01",
    });
    const usdB = createAccount({
      name: "USD 投资 B",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 200_000,
      startingDate: "2026-01-01",
    });
    const sgd = createAccount({
      name: "SGD 投资",
      type: "investment",
      currencyCode: "SGD",
      startingBalance: 50_000,
      startingDate: "2026-01-01",
    });
    const funding = createAccount({
      name: "USD 支票",
      type: "checking",
      currencyCode: "USD",
      startingBalance: 500_000,
      startingDate: "2026-01-01",
    });
    postTransfer(db, {
      fromId: funding,
      toId: usdA,
      date: "2026-08-02",
      fromAmountMinor: 100_000,
      toAmountMinor: 100_000,
    });

    const result = await call("GET", `/api/investments?asOf=${AS_OF}&months=1`);
    expect(result.status).toBe(200);
    expect(result.json.accounts.map((row) => row.currencyCode).sort()).toEqual(["SGD", "USD", "USD"]);
    const usdSub = result.json.subtotalsByCurrency.find((row) => row.currencyCode === "USD");
    const sgdSub = result.json.subtotalsByCurrency.find((row) => row.currencyCode === "SGD");
    expect(usdSub.balanceMinor).toBe(1_000_000 + 100_000 + 200_000);
    expect(sgdSub.balanceMinor).toBe(50_000);
    expect(result.json).not.toHaveProperty("totalBalanceMinor");
    expect(result.json).not.toHaveProperty("totalNetContributionsMinor");
    expect(forbiddenKeys(result.json)).toEqual([]);
    expect(result.json.accounts.find((row) => row.accountId === usdA).contributionsMinor).toBe(100_000);
    expect(result.json.accounts.find((row) => row.accountId === usdB).balanceMinor).toBe(200_000);
    expect(result.json.accounts.find((row) => row.accountId === sgd).balanceMinor).toBe(50_000);
  });
});
