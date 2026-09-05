import { describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-ledger-revision-completion-");

const { db, createAccount, currentMonth, uid } = await import("./db.mjs");
const {
  deleteTransaction,
  deleteTransactions,
  postTransaction,
  postTransfer,
  setTransactionCategory,
  setTransactionsCategory,
  updateTransaction,
} = await import("./currency-ledger.mjs");
const { readLedgerRevision } = await import("./budget-revision.mjs");

const DAY = `${currentMonth()}-15`;

function account(name, currencyCode, type = "checking") {
  return createAccount({ name, type, currencyCode, startingBalance: 0, startingDate: DAY });
}

function revisionMap(...codes) {
  return Object.fromEntries(codes.map((code) => [code, readLedgerRevision(db, code)]));
}

function expectRevisionDelta(before, expectedDeltas) {
  for (const [code, delta] of Object.entries(expectedDeltas)) {
    expect(readLedgerRevision(db, code)).toBe(before[code] + delta);
  }
}

function category() {
  const groupId = uid();
  const categoryId = uid();
  db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(
    groupId,
    `Revision group ${groupId}`,
    900
  );
  db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(
    categoryId,
    groupId,
    `Revision category ${categoryId}`
  );
  return categoryId;
}

describe("currency-ledger budget revision completion", () => {
  it("deletes a cross-currency pair and bumps both on-budget ledgers exactly once", () => {
    const cny = account("delete CNY", "CNY");
    const sgd = account("delete SGD", "SGD");
    const posted = postTransfer(db, {
      fromId: cny,
      toId: sgd,
      date: DAY,
      fromAmountMinor: 1000,
      toAmountMinor: 190,
    });
    const before = revisionMap("CNY", "SGD");

    deleteTransaction(db, posted.sourceId, before);

    expect(db.prepare("SELECT COUNT(*) count FROM transactions WHERE pair_id=?").get(posted.pairId).count).toBe(0);
    expectRevisionDelta(before, { CNY: 1, SGD: 1 });
  });

  it("rejects an incomplete delete revision map without deleting either transfer leg", () => {
    const cny = account("guard delete CNY", "CNY");
    const sgd = account("guard delete SGD", "SGD");
    const posted = postTransfer(db, {
      fromId: cny,
      toId: sgd,
      date: DAY,
      fromAmountMinor: 2000,
      toAmountMinor: 380,
    });
    const before = revisionMap("CNY", "SGD");

    expect(() => deleteTransaction(db, posted.sourceId, { CNY: before.CNY })).toThrowError(
      expect.objectContaining({ code: "expected_revision_required" })
    );

    expect(db.prepare("SELECT COUNT(*) count FROM transactions WHERE pair_id=?").get(posted.pairId).count).toBe(2);
    expectRevisionDelta(before, { CNY: 0, SGD: 0 });
  });

  it("atomically categorizes transactions across currencies and does not bump for a no-op", () => {
    const categoryId = category();
    const cny = account("category CNY", "CNY");
    const sgd = account("category SGD", "SGD");
    const cnyTx = postTransaction(db, { accountId: cny, date: DAY, amount: -100 });
    const sgdTx = postTransaction(db, { accountId: sgd, date: DAY, amount: -200 });
    const before = revisionMap("CNY", "SGD");

    expect(setTransactionsCategory(db, [cnyTx.id, sgdTx.id], categoryId, before)).toEqual({ ok: true, changed: 2 });
    expectRevisionDelta(before, { CNY: 1, SGD: 1 });

    const afterChange = revisionMap("CNY", "SGD");
    expect(setTransactionsCategory(db, [cnyTx.id, sgdTx.id], categoryId, afterChange)).toEqual({
      ok: true,
      changed: 0,
    });
    expectRevisionDelta(afterChange, { CNY: 0, SGD: 0 });
  });

  it("keeps a mixed-currency category batch unchanged when one revision is stale", () => {
    const categoryId = category();
    const cny = account("stale category CNY", "CNY");
    const sgd = account("stale category SGD", "SGD");
    const cnyTx = postTransaction(db, { accountId: cny, date: DAY, amount: -300 });
    const sgdTx = postTransaction(db, { accountId: sgd, date: DAY, amount: -400 });
    const before = revisionMap("CNY", "SGD");

    expect(() =>
      setTransactionsCategory(db, [cnyTx.id, sgdTx.id], categoryId, { CNY: before.CNY, SGD: before.SGD - 1 })
    ).toThrowError(expect.objectContaining({ code: "budget_revision_conflict" }));

    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(cnyTx.id).category_id).toBeNull();
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(sgdTx.id).category_id).toBeNull();
    expectRevisionDelta(before, { CNY: 0, SGD: 0 });
  });

  it("bumps only the affected on-budget ledger for a single category change", () => {
    const categoryId = category();
    const cny = account("single category CNY", "CNY");
    const posted = postTransaction(db, { accountId: cny, date: DAY, amount: -500 });
    const before = revisionMap("CNY");

    setTransactionCategory(db, posted.id, categoryId, before.CNY);

    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.id).category_id).toBe(categoryId);
    expectRevisionDelta(before, { CNY: 1 });
  });

  it("deletes a mixed batch atomically and ignores tracking-account currencies", () => {
    const cny = account("bulk delete CNY", "CNY");
    const sgd = account("bulk delete SGD", "SGD");
    const usdTracking = account("bulk delete USD tracking", "USD", "investment");
    const cnyTx = postTransaction(db, { accountId: cny, date: DAY, amount: -600 });
    const sgdTx = postTransaction(db, { accountId: sgd, date: DAY, amount: -700 });
    const usdTx = postTransaction(db, { accountId: usdTracking, date: DAY, amount: 800 });
    const before = revisionMap("CNY", "SGD", "USD");

    expect(deleteTransactions(db, [cnyTx.id, sgdTx.id, usdTx.id], { CNY: before.CNY, SGD: before.SGD })).toEqual({
      ok: true,
      changed: 3,
    });

    expect(db.prepare("SELECT COUNT(*) count FROM transactions WHERE id IN (?,?,?)").get(cnyTx.id, sgdTx.id, usdTx.id).count).toBe(0);
    expectRevisionDelta(before, { CNY: 1, SGD: 1, USD: 0 });
  });

  it("keeps every transaction in a mixed delete batch when one ledger revision is stale", () => {
    const cny = account("stale bulk delete CNY", "CNY");
    const sgd = account("stale bulk delete SGD", "SGD");
    const cnyTx = postTransaction(db, { accountId: cny, date: DAY, amount: -610 });
    const sgdTx = postTransaction(db, { accountId: sgd, date: DAY, amount: -710 });
    const before = revisionMap("CNY", "SGD");

    expect(() =>
      deleteTransactions(db, [cnyTx.id, sgdTx.id], { CNY: before.CNY, SGD: before.SGD - 1 })
    ).toThrowError(expect.objectContaining({ code: "budget_revision_conflict" }));

    expect(db.prepare("SELECT COUNT(*) count FROM transactions WHERE id IN (?,?)").get(cnyTx.id, sgdTx.id).count).toBe(2);
    expectRevisionDelta(before, { CNY: 0, SGD: 0 });
  });

  it("does not bump budget revisions for a tracking-to-tracking transfer", () => {
    const usd = account("tracking transfer USD", "USD", "investment");
    const sgd = account("tracking transfer SGD", "SGD", "otherAsset");
    const before = revisionMap("USD", "SGD");

    postTransfer(db, {
      fromId: usd,
      toId: sgd,
      date: DAY,
      fromAmountMinor: 1000,
      toAmountMinor: 1300,
    });

    expectRevisionDelta(before, { USD: 0, SGD: 0 });
  });

  it("bumps both old and new ledgers when an edit moves a transaction across currencies", () => {
    const cny = account("edit old CNY", "CNY");
    const sgd = account("edit new SGD", "SGD");
    const posted = postTransaction(db, { accountId: cny, date: DAY, amount: -900, payeeName: "before" });
    const before = revisionMap("CNY", "SGD");

    updateTransaction(db, posted.id, {
      accountId: sgd,
      date: DAY,
      amount: -171,
      payeeName: "after",
      expectedRevision: before,
    });

    expect(db.prepare("SELECT account_id, amount, payee_name FROM transactions WHERE id=?").get(posted.id)).toEqual({
      account_id: sgd,
      amount: -171,
      payee_name: "after",
    });
    expectRevisionDelta(before, { CNY: 1, SGD: 1 });
  });

  it("does not mutate the old transaction when an edit omits a newly affected ledger revision", () => {
    const cny = account("guard edit old CNY", "CNY");
    const sgd = account("guard edit new SGD", "SGD");
    const posted = postTransaction(db, { accountId: cny, date: DAY, amount: -1000, payeeName: "keep" });
    const before = revisionMap("CNY", "SGD");

    expect(() =>
      updateTransaction(db, posted.id, {
        accountId: sgd,
        date: DAY,
        amount: -190,
        payeeName: "discard",
        expectedRevision: { CNY: before.CNY },
      })
    ).toThrowError(expect.objectContaining({ code: "expected_revision_required" }));

    expect(db.prepare("SELECT account_id, amount, payee_name FROM transactions WHERE id=?").get(posted.id)).toEqual({
      account_id: cny,
      amount: -1000,
      payee_name: "keep",
    });
    expectRevisionDelta(before, { CNY: 0, SGD: 0 });
  });
});
