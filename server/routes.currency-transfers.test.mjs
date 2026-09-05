import { afterAll, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";
import { snapshotClient } from "./test-support/snapshot-client.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-currency-transfers-routes-");

const { api } = await import("./routes.mjs");
const { db, createAccount, currentMonth } = await import("./db.mjs");
const { CURRENCY_TRANSFER_SYSTEM_KEY } = await import("./currency-ledger.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

// Ordinary scenarios carry a fresh read snapshot; revision-protocol cases use server.call.
const call = snapshotClient(server);
const MONTH = currentMonth();
const DAY = `${MONTH}-15`;

function expectCurrencyError(result, code) {
  expect(result.status).toBe(400);
  expect(result.json).toMatchObject({ error: code, code });
}

function systemCategory() {
  return db.prepare("SELECT * FROM categories WHERE system_key=?").get(CURRENCY_TRANSFER_SYSTEM_KEY);
}

describe("system category over HTTP", () => {
  it("exposes exactly one currency_transfer category on bootstrap and refuses to delete it", async () => {
    const boot = await call("GET", "/api/bootstrap");
    expect(boot.status).toBe(200);
    const found = [];
    for (const group of boot.json.groups) {
      for (const cat of group.categories) {
        if (cat.system_key === "currency_transfer") found.push(cat);
      }
    }
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("换汇转出");

    const del = await call("DELETE", `/api/categories/${found[0].id}`);
    expectCurrencyError(del, "cannot_delete_system_category");
    expect(systemCategory()?.id).toBe(found[0].id);
  });
});

describe("POST /api/transactions original amount", () => {
  it("stores original EUR 20.00 alongside USD -22.00 and rejects unpaired original fields", async () => {
    const usd = createAccount({ name: "USD card", type: "creditCard", currencyCode: "USD", startingBalance: 0 });
    const ok = await call("POST", "/api/transactions", {
      accountId: usd,
      date: DAY,
      payeeName: "Paris cafe",
      amount: -2200,
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2000,
    });
    expect(ok.status).toBe(200);
    const list = await call("GET", `/api/accounts/${usd}/transactions`);
    const row = list.json.transactions.find((tx) => tx.payeeName === "Paris cafe");
    expect(row.amount).toBe(-2200);
    expect(row.currencyCode).toBe("USD");
    expect(row.originalCurrencyCode).toBe("EUR");
    expect(row.originalAmountMinor).toBe(2000);

    const incomplete = await call("POST", "/api/transactions", {
      accountId: usd,
      date: DAY,
      amount: -100,
      originalCurrencyCode: "EUR",
    });
    expectCurrencyError(incomplete, "original_amount_incomplete");
  });

  it("stores original GBP on a USD card without enabling GBP", async () => {
    expect(db.prepare("SELECT 1 FROM currency_ledgers WHERE currency_code='GBP'").get()).toBeUndefined();
    const usd = createAccount({ name: "USD GBP original", type: "creditCard", currencyCode: "USD", startingBalance: 0 });
    const ok = await call("POST", "/api/transactions", {
      accountId: usd,
      date: DAY,
      payeeName: "London shop",
      amount: -1500,
      originalCurrencyCode: "GBP",
      originalAmountMinor: 1200,
    });
    expect(ok.status).toBe(200);
    const list = await call("GET", `/api/accounts/${usd}/transactions`);
    const row = list.json.transactions.find((tx) => tx.payeeName === "London shop");
    expect(row).toMatchObject({
      amount: -1500,
      currencyCode: "USD",
      originalCurrencyCode: "GBP",
      originalAmountMinor: 1200,
    });
    expect(db.prepare("SELECT 1 FROM currency_ledgers WHERE currency_code='GBP'").get()).toBeUndefined();
  });

  it("rejects original currency equal to the account currency", async () => {
    const usd = createAccount({ name: "USD same original", type: "cash", currencyCode: "USD", startingBalance: 0 });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c;
    const result = await call("POST", "/api/transactions", {
      accountId: usd,
      date: DAY,
      amount: -2200,
      originalCurrencyCode: "USD",
      originalAmountMinor: 2200,
    });
    expectCurrencyError(result, "original_currency_matches_account");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c).toBe(before);
  });

  it("does not derive a booked USD amount from a merchant EUR amount", async () => {
    const usd = createAccount({ name: "USD no fx derive", type: "creditCard", currencyCode: "USD", startingBalance: 0 });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c;
    const result = await call("POST", "/api/transactions", {
      accountId: usd,
      date: DAY,
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2000,
    });
    expectCurrencyError(result, "amount_required");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c).toBe(before);
  });
});

describe("POST /api/transactions cross-currency transfers", () => {
  it("rejects a same-currency amount mismatch with a stable 400 code", async () => {
    const a = createAccount({ name: "CNY src", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const b = createAccount({ name: "CNY dst", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c;
    const result = await call("POST", "/api/transactions", {
      accountId: a,
      transferAccountId: b,
      date: DAY,
      amount: -2200,
      toAmountMinor: 2300,
    });
    expectCurrencyError(result, "same_currency_amount_mismatch");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c).toBe(before);
  });

  it("rejects a cross-currency transfer that omits the destination amount", async () => {
    const sgd = createAccount({ name: "SGD src", type: "checking", currencyCode: "SGD", startingBalance: 0 });
    const cny = createAccount({ name: "CNY dst", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const result = await call("POST", "/api/transactions", {
      accountId: sgd,
      transferAccountId: cny,
      date: DAY,
      amount: -10000,
    });
    expectCurrencyError(result, "cross_currency_amount_required");
  });

  it("writes 100.00 SGD and 550.00 CNY through the existing transactions route", async () => {
    const sgd = createAccount({ name: "SGD http", type: "checking", currencyCode: "SGD", startingBalance: 500000 });
    const cny = createAccount({ name: "CNY http", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const result = await call("POST", "/api/transactions", {
      accountId: sgd,
      transferAccountId: cny,
      date: DAY,
      amount: -10000,
      toAmountMinor: 55000,
      memo: "银行换汇",
    });
    expect(result.status).toBe(200);

    const sgdReg = await call("GET", `/api/accounts/${sgd}/transactions`);
    const cnyReg = await call("GET", `/api/accounts/${cny}/transactions`);
    const source = sgdReg.json.transactions.find((tx) => tx.transferAccountId === cny);
    const dest = cnyReg.json.transactions.find((tx) => tx.transferAccountId === sgd);
    expect(source.amount).toBe(-10000);
    expect(source.currencyCode).toBe("SGD");
    expect(source.otherAccountCurrencyCode).toBe("CNY");
    expect(source.otherAmountMinor).toBe(55000);
    expect(source.categoryName).toBe("换汇转出");
    expect(dest.amount).toBe(55000);
    expect(dest.currencyCode).toBe("CNY");
    expect(dest.otherAccountCurrencyCode).toBe("SGD");
    expect(dest.categoryId).toBeNull();
    expect(cnyReg.json.account.balance).toBe(55000);
    expect(sgdReg.json.account.balance).toBe(490000);

    const cnyBudget = await call("GET", `/api/budget/${MONTH}?currency=CNY`);
    expect(cnyBudget.json.readyToAssign).toBeGreaterThanOrEqual(55000);
  });

  it("edits and deletes both legs together", async () => {
    const sgd = createAccount({ name: "SGD pair", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY pair", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    await call("POST", "/api/transactions", {
      accountId: sgd,
      transferAccountId: cny,
      date: DAY,
      amount: -10000,
      toAmountMinor: 55000,
    });
    const sgdReg = await call("GET", `/api/accounts/${sgd}/transactions`);
    const source = sgdReg.json.transactions.find((tx) => tx.transferAccountId === cny);
    const edited = await call("PUT", `/api/transactions/${source.id}`, {
      accountId: sgd,
      transferAccountId: cny,
      date: `${MONTH}-16`,
      amount: -8000,
      toAmountMinor: 44000,
    });
    expect(edited.status).toBe(200);
    const afterEdit = await call("GET", `/api/accounts/${cny}/transactions`);
    const dest = afterEdit.json.transactions.filter((tx) => !tx.isStart);
    expect(dest).toHaveLength(1);
    expect(dest[0].amount).toBe(44000);

    const deleted = await call("DELETE", `/api/transactions/${dest[0].id}`);
    expect(deleted.status).toBe(200);
    expect((await call("GET", `/api/accounts/${sgd}/transactions`)).json.transactions.filter((tx) => !tx.isStart)).toHaveLength(0);
    expect((await call("GET", `/api/accounts/${cny}/transactions`)).json.transactions.filter((tx) => !tx.isStart)).toHaveLength(0);
  });
});

describe("POST /api/transfers", () => {
  it("accepts explicit from/to amounts and returns 400 when the destination amount is missing", async () => {
    const sgd = createAccount({ name: "SGD xfer", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY xfer", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const missing = await call("POST", "/api/transfers", {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
    });
    expectCurrencyError(missing, "cross_currency_amount_required");

    const ok = await call("POST", "/api/transfers", {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.pairId).toBeTruthy();
    const source = db.prepare("SELECT amount FROM transactions WHERE id=?").get(ok.json.sourceId);
    const dest = db.prepare("SELECT amount FROM transactions WHERE id=?").get(ok.json.destId);
    expect(source.amount).toBe(-10000);
    expect(dest.amount).toBe(55000);
  });
});

describe("GET /api/transactions currency fields", () => {
  it("returns each row's account currency and original amount", async () => {
    const usd = createAccount({ name: "USD list", type: "cash", currencyCode: "USD", startingBalance: 0 });
    await call("POST", "/api/transactions", {
      accountId: usd,
      date: DAY,
      payeeName: "EUR dinner",
      amount: -2200,
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2000,
    });
    const list = await call("GET", "/api/transactions");
    const row = list.json.transactions.find((tx) => tx.payeeName === "EUR dinner");
    expect(row.currencyCode).toBe("USD");
    expect(row.originalCurrencyCode).toBe("EUR");
    expect(row.originalAmountMinor).toBe(2000);
  });
});

describe("POST /api/reconcile account currency", () => {
  it("creates a JPY adjustment in whole yen", async () => {
    const jpy = createAccount({
      name: "JPY rec",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 1000,
      startingDate: `${MONTH}-01`,
    });
    const result = await call("POST", `/api/reconcile/${jpy}`, { statementBalance: 1250, markCleared: false });
    expect(result.status).toBe(200);
    expect(result.json.adjustment).toBe(250);
    const adj = db.prepare("SELECT amount FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(jpy);
    expect(adj.amount).toBe(250);
  });

  it("rejects a JPY statementBalance of 123.4 or a numeric string", async () => {
    const jpy = createAccount({
      name: "JPY rec frac",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 1000,
      startingDate: `${MONTH}-01`,
    });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=?").get(jpy).c;
    expectCurrencyError(await call("POST", `/api/reconcile/${jpy}`, { statementBalance: 123.4 }), "invalid_statement_balance");
    expectCurrencyError(await call("POST", `/api/reconcile/${jpy}`, { statementBalance: "1000" }), "invalid_statement_balance");
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=?").get(jpy).c).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(jpy).c).toBe(0);
  });
});

describe("transaction category routes cannot rewrite transfer legs", () => {
  function spendCategoryId() {
    const row = db
      .prepare(
        "SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=0 ORDER BY c.sort_order LIMIT 1"
      )
      .get();
    return row.id;
  }

  it("rejects PATCH category on a cross-currency source or dest leg", async () => {
    const sgd = createAccount({ name: "SGD patch", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY patch", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const created = await call("POST", "/api/transactions", {
      accountId: sgd,
      transferAccountId: cny,
      date: DAY,
      amount: -10000,
      toAmountMinor: 55000,
    });
    expect(created.status).toBe(200);
    const source = db.prepare("SELECT id, category_id FROM transactions WHERE account_id=? AND transfer_account_id=?").get(sgd, cny);
    const dest = db.prepare("SELECT id, category_id FROM transactions WHERE account_id=? AND transfer_account_id=?").get(cny, sgd);
    const fxId = systemCategory().id;
    const cat = spendCategoryId();

    expectCurrencyError(await call("PATCH", `/api/transactions/${source.id}/category`, { categoryId: cat }), "transfer_category_managed");
    expectCurrencyError(await call("PATCH", `/api/transactions/${source.id}/category`, { categoryId: null }), "transfer_category_managed");
    expectCurrencyError(await call("PATCH", `/api/transactions/${dest.id}/category`, { categoryId: cat }), "transfer_category_managed");
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(source.id).category_id).toBe(fxId);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(dest.id).category_id).toBeNull();
  });

  it("fails a mixed bulk-category request atomically and still categorizes ordinary expenses", async () => {
    const sgd = createAccount({ name: "SGD mix", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY mix", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const spend = await call("POST", "/api/transactions", {
      accountId: sgd,
      date: DAY,
      amount: -800,
      payeeName: "普通支出",
    });
    expect(spend.status).toBe(200);
    const spendId = db.prepare("SELECT id FROM transactions WHERE payee_name='普通支出' AND account_id=?").get(sgd).id;
    await call("POST", "/api/transactions", {
      accountId: sgd,
      transferAccountId: cny,
      date: DAY,
      amount: -10000,
      toAmountMinor: 55000,
    });
    const sourceId = db.prepare("SELECT id FROM transactions WHERE account_id=? AND transfer_account_id=?").get(sgd, cny).id;
    const cat = spendCategoryId();
    const sourceCat = db.prepare("SELECT category_id FROM transactions WHERE id=?").get(sourceId).category_id;

    expectCurrencyError(
      await call("POST", "/api/transactions/bulk-category", { ids: [spendId, sourceId], categoryId: cat }),
      "transfer_category_managed"
    );
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(spendId).category_id).toBeNull();
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(sourceId).category_id).toBe(sourceCat);

    const ok = await call("PATCH", `/api/transactions/${spendId}/category`, { categoryId: cat });
    expect(ok.status).toBe(200);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(spendId).category_id).toBe(cat);
  });
});

describe("HTTP amounts must be integer minor units", () => {
  it("rejects JPY 123.4 and a string amount without inserting a transaction", async () => {
    const jpy = createAccount({ name: "JPY http", type: "cash", currencyCode: "JPY", startingBalance: 0 });
    const before = db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=?").get(jpy).c;
    expectCurrencyError(
      await call("POST", "/api/transactions", { accountId: jpy, date: DAY, amount: 123.4, payeeName: "frac" }),
      "invalid_amount"
    );
    expectCurrencyError(
      await call("POST", "/api/transactions", { accountId: jpy, date: DAY, amount: "123", payeeName: "str" }),
      "invalid_amount"
    );
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=?").get(jpy).c).toBe(before);

    const ok = await call("POST", "/api/transactions", { accountId: jpy, date: DAY, amount: 123, payeeName: "yen" });
    expect(ok.status).toBe(200);
    expect(db.prepare("SELECT amount FROM transactions WHERE account_id=? AND payee_name='yen'").get(jpy).amount).toBe(123);
  });
});
