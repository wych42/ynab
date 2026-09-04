import { describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-budget-revision-unit-");

const { db, createAccount } = await import("./db.mjs");
const {
  applyLedgerRevisionGuard,
  bumpLedgerRevision,
  isBudgetRevisionError,
  readLedgerRevision,
} = await import("./budget-revision.mjs");

createAccount({ name: "CNY 日常", type: "checking", currencyCode: "CNY", startingBalance: 0 });
createAccount({ name: "SGD 日常", type: "checking", currencyCode: "SGD", startingBalance: 0 });

describe("applyLedgerRevisionGuard", () => {
  it("checks a single number against every ledger in a cross-currency write", () => {
    bumpLedgerRevision(db, "CNY");
    const cny = readLedgerRevision(db, "CNY");
    const sgd = readLedgerRevision(db, "SGD");
    expect(cny).not.toBe(sgd);
    let error = null;
    try {
      applyLedgerRevisionGuard(db, ["CNY", "SGD"], cny);
    } catch (caught) {
      error = caught;
    }
    expect(isBudgetRevisionError(error)).toBe(true);
    expect(error.code).toBe("budget_revision_conflict");
    expect(error.extra.currencyCode).toBe("SGD");
  });

  it("still skips when expectedRevision is omitted", () => {
    expect(() => applyLedgerRevisionGuard(db, ["CNY", "SGD"], undefined)).not.toThrow();
  });

  it("uses per-currency values from a map", () => {
    const cny = readLedgerRevision(db, "CNY");
    const sgd = readLedgerRevision(db, "SGD");
    expect(() => applyLedgerRevisionGuard(db, ["CNY", "SGD"], { CNY: cny, SGD: sgd })).not.toThrow();
    let error = null;
    try {
      applyLedgerRevisionGuard(db, ["CNY", "SGD"], { CNY: cny, SGD: sgd + 1 });
    } catch (caught) {
      error = caught;
    }
    expect(isBudgetRevisionError(error)).toBe(true);
    expect(error.extra.currencyCode).toBe("SGD");
  });
});
