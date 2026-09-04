import { afterAll, describe, expect, it } from "vitest";
import { budgetDbPath, makeTempDataDir } from "./test-support/database.mjs";
import { snapshotFinancialAmounts } from "./test-support/finance-fixtures.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-currency-accounts-");

const { api } = await import("./routes.mjs");
const { db, openBudgetDatabase } = await import("./db.mjs");
const { createAccountRecord } = await import("./account-currency.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);

function expectCurrencyError(result, code) {
  expect(result.status).toBe(400);
  expect(result.json).toMatchObject({ error: code, code });
}

function ledgerCodes() {
  return db
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY currency_code")
    .all()
    .map((row) => row.currency_code);
}

function accountRow(id) {
  return db.prepare("SELECT id, name, currency_code, starting_balance FROM accounts WHERE id=?").get(id);
}

async function createAccount(body) {
  const result = await call("POST", "/api/accounts", {
    name: "现金",
    type: "cash",
    currencyCode: "CNY",
    startingBalanceMinor: 0,
    ...body,
  });
  expect(result.status).toBe(200);
  return result;
}

describe("POST /api/accounts requires an explicit catalog currency", () => {
  it("rejects missing, lowercase, wrong-length and catalog-external codes with stable JSON errors", async () => {
    const ledgersBefore = ledgerCodes();
    const countBefore = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;

    const missing = await call("POST", "/api/accounts", {
      name: "无币种",
      type: "cash",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(missing, "invalid_currency_code");

    const fromSymbol = await call("POST", "/api/accounts", {
      name: "符号推断",
      type: "cash",
      currencySymbol: "$",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(fromSymbol, "invalid_currency_code");

    const lowercase = await call("POST", "/api/accounts", {
      name: "小写",
      type: "cash",
      currencyCode: "usd",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(lowercase, "invalid_currency_code");

    const shortCode = await call("POST", "/api/accounts", {
      name: "过短",
      type: "cash",
      currencyCode: "US",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(shortCode, "invalid_currency_code");

    const longCode = await call("POST", "/api/accounts", {
      name: "过长",
      type: "cash",
      currencyCode: "USDT",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(longCode, "invalid_currency_code");

    const external = await call("POST", "/api/accounts", {
      name: "目录外",
      type: "cash",
      currencyCode: "AUD",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(external, "unsupported_currency");

    expect(ledgerCodes()).toEqual(ledgersBefore);
    expect(db.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(countBefore);
  });

  it("rejects the legacy startingBalance field even when the value is an integer", async () => {
    const countBefore = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;
    const integerLegacy = await call("POST", "/api/accounts", {
      name: "整数旧字段",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10000,
    });
    expectCurrencyError(integerLegacy, "invalid_amount");

    const fractionalLegacy = await call("POST", "/api/accounts", {
      name: "小数旧字段",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 12.34,
    });
    expectCurrencyError(fractionalLegacy, "invalid_amount");

    const bothFields = await call("POST", "/api/accounts", {
      name: "两个字段",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10000,
      startingBalanceMinor: 10000,
    });
    expectCurrencyError(bothFields, "invalid_amount");

    expect(db.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(countBefore);
  });

  it("treats an omitted startingBalanceMinor as zero", async () => {
    const created = await call("POST", "/api/accounts", {
      name: "零余额默认",
      type: "cash",
      currencyCode: "CNY",
    });
    expect(created.status).toBe(200);
    expect(accountRow(created.json.id).starting_balance).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_start=1").get(created.json.id).c
    ).toBe(0);
  });

  it("does not infer a currency from the legacy symbol", async () => {
    const symbol = await call("PUT", "/api/settings", { currencySymbol: "$" });
    expect(symbol.status).toBe(200);

    const missing = await call("POST", "/api/accounts", {
      name: "美元符号",
      type: "checking",
      startingBalanceMinor: 100,
    });
    expectCurrencyError(missing, "invalid_currency_code");
  });
});

describe("reporting currency must already be enabled", () => {
  it("rejects CAD as reporting currency before that ledger exists and leaves amounts unchanged", async () => {
    expect(ledgerCodes()).not.toContain("CAD");
    const amountsBefore = snapshotFinancialAmounts(db);
    expectCurrencyError(await call("PUT", "/api/settings", { reportingCurrency: "CAD" }), "reporting_currency_not_enabled");
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);
    expect(ledgerCodes()).not.toContain("CAD");
  });
});

describe("createAccountRecord does not enable a disabled catalog currency", () => {
  it("rejects CAD before any insert and leaves ledgers unchanged", () => {
    const dataDir = makeTempDataDir("ynab-account-no-implicit-enable-");
    const database = openBudgetDatabase(budgetDbPath(dataDir));
    try {
      expect(database.prepare("SELECT 1 FROM currency_ledgers WHERE currency_code='CAD'").get()).toBeUndefined();
      const accountsBefore = database.prepare("SELECT COUNT(*) c FROM accounts").get().c;
      const txsBefore = database.prepare("SELECT COUNT(*) c FROM transactions").get().c;
      const ledgersBefore = database
        .prepare("SELECT currency_code FROM currency_ledgers ORDER BY currency_code")
        .all()
        .map((row) => row.currency_code);

      let thrown;
      try {
        createAccountRecord(
          database,
          {
            name: "加元失败",
            type: "cash",
            currencyCode: "CAD",
            startingBalanceMinor: 2500,
            startingDate: "2026-08-01",
          },
          { requireCurrency: true }
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown?.code).toBe("currency_not_enabled");
      expect(database.prepare("SELECT 1 FROM currency_ledgers WHERE currency_code='CAD'").get()).toBeUndefined();
      expect(
        database.prepare("SELECT currency_code FROM currency_ledgers ORDER BY currency_code").all().map((row) => row.currency_code)
      ).toEqual(ledgersBefore);
      expect(database.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(accountsBefore);
      expect(database.prepare("SELECT COUNT(*) c FROM transactions").get().c).toBe(txsBefore);
      expect(database.prepare("SELECT 1 FROM accounts WHERE name='加元失败'").get()).toBeUndefined();
    } finally {
      database.close();
    }
  });
});

describe("creating an account cannot enable a built-in ledger", () => {
  it("rejects CAD with currency_not_enabled and does not write a CAD ledger", async () => {
    expect(ledgerCodes()).not.toContain("CAD");
    const countBefore = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;
    const created = await call("POST", "/api/accounts", {
      name: "加元账户",
      type: "checking",
      currencyCode: "CAD",
      startingBalanceMinor: 2500,
      startingDate: "2026-08-01",
    });
    expectCurrencyError(created, "currency_not_enabled");
    expect(ledgerCodes()).not.toContain("CAD");
    expect(db.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(countBefore);
    expect(db.prepare("SELECT 1 FROM accounts WHERE name='加元账户'").get()).toBeUndefined();
  });

  it("rejects a second CAD create the same way", async () => {
    const created = await call("POST", "/api/accounts", {
      name: "加元二",
      type: "cash",
      currencyCode: "CAD",
      startingBalanceMinor: 0,
    });
    expectCurrencyError(created, "currency_not_enabled");
    expect(ledgerCodes()).not.toContain("CAD");
  });
});

describe("account responses expose camelCase currencyCode", () => {
  it("returns a non-null currency on bootstrap, list and register after create", async () => {
    const created = await createAccount({
      name: "日元现金",
      type: "cash",
      currencyCode: "JPY",
      startingBalanceMinor: 123,
    });
    const id = created.json.id;

    const boot = await call("GET", "/api/bootstrap");
    expect(boot.status).toBe(200);
    const bootAccount = boot.json.accounts.find((account) => account.id === id);
    expect(bootAccount.currencyCode).toBe("JPY");
    expect(bootAccount.currencyCode).not.toBeNull();
    expect(bootAccount.currency_code).toBeUndefined();

    const list = await call("GET", "/api/accounts");
    expect(list.status).toBe(200);
    const listed = list.json.accounts.find((account) => account.id === id);
    expect(listed.currencyCode).toBe("JPY");
    expect(listed.currency_code).toBeUndefined();

    const register = await call("GET", `/api/accounts/${id}/transactions`);
    expect(register.status).toBe(200);
    expect(register.json.account.currencyCode).toBe("JPY");
    expect(register.json.account.currency_code).toBeUndefined();
    expect(register.json.account.balance).toBe(123);
  });
});

describe("empty accounts can change currency; used accounts cannot", () => {
  it("changes an empty account only to an already enabled currency", async () => {
    const created = await createAccount({ name: "空账户", currencyCode: "CNY" });
    const id = created.json.id;
    expect(ledgerCodes()).not.toContain("GBP");

    const changed = await call("PUT", `/api/accounts/${id}`, { currencyCode: "EUR" });
    expect(changed.status).toBe(200);
    expect(changed.json.accounts.find((account) => account.id === id).currencyCode).toBe("EUR");
    expect(accountRow(id).currency_code).toBe("EUR");

    const toDisabled = await call("PUT", `/api/accounts/${id}`, { currencyCode: "GBP" });
    expectCurrencyError(toDisabled, "currency_not_enabled");
    expect(accountRow(id).currency_code).toBe("EUR");
    expect(ledgerCodes()).not.toContain("GBP");
  });

  it("rejects a change when the balance is non-zero and leaves the row unchanged", async () => {
    const created = await createAccount({
      name: "有余额",
      currencyCode: "CNY",
      startingBalanceMinor: 8800,
    });
    const id = created.json.id;
    const before = accountRow(id);
    const amountsBefore = snapshotFinancialAmounts(db);

    const result = await call("PUT", `/api/accounts/${id}`, { currencyCode: "USD", name: "不该改名" });
    expectCurrencyError(result, "account_currency_locked");
    expect(accountRow(id)).toEqual(before);
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);
  });

  it("rejects a change once any non-start transaction exists, even if the balance is zero", async () => {
    const created = await createAccount({ name: "有流水", currencyCode: "CNY", startingBalanceMinor: 0 });
    const id = created.json.id;
    const posted = await call("POST", "/api/transactions", {
      accountId: id,
      date: "2026-08-02",
      amount: 500,
      payeeName: "退款",
    });
    expect(posted.status).toBe(200);
    const reversed = await call("POST", "/api/transactions", {
      accountId: id,
      date: "2026-08-03",
      amount: -500,
      payeeName: "冲销",
    });
    expect(reversed.status).toBe(200);

    const list = await call("GET", "/api/accounts");
    expect(list.json.accounts.find((account) => account.id === id).balance).toBe(0);

    const before = accountRow(id);
    const amountsBefore = snapshotFinancialAmounts(db);
    const result = await call("PUT", `/api/accounts/${id}`, { currencyCode: "USD" });
    expectCurrencyError(result, "account_currency_locked");
    expect(accountRow(id)).toEqual(before);
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);
  });
});

describe("currency settings enable built-in ledgers and set reporting currency", () => {
  it("enables catalog currencies idempotently", async () => {
    const first = await call("PUT", "/api/settings", { enableCurrency: "CAD" });
    expect(first.status).toBe(200);
    const second = await call("PUT", "/api/settings", { enableCurrency: "CAD" });
    expect(second.status).toBe(200);
    expect(ledgerCodes().filter((code) => code === "CAD")).toEqual(["CAD"]);

    const gbp = await call("PUT", "/api/settings", { enableCurrency: "GBP" });
    expect(gbp.status).toBe(200);
    const gbpAgain = await call("PUT", "/api/settings", { enableCurrency: "GBP" });
    expect(gbpAgain.status).toBe(200);
    expect(ledgerCodes().filter((code) => code === "GBP")).toEqual(["GBP"]);

    const boot = await call("GET", "/api/bootstrap");
    expect(boot.json.enabledCurrencies).toEqual(expect.arrayContaining(["CAD", "GBP"]));
  });

  it("rejects enabling or selecting codes that are not in the built-in catalog", async () => {
    expectCurrencyError(await call("PUT", "/api/settings", { enableCurrency: "usd" }), "invalid_currency_code");
    expectCurrencyError(await call("PUT", "/api/settings", { enableCurrency: "AUD" }), "unsupported_currency");
    expectCurrencyError(await call("PUT", "/api/settings", { reportingCurrency: "AUD" }), "unsupported_currency");
    expectCurrencyError(await call("PUT", "/api/settings", { reportingCurrency: "gbp" }), "invalid_currency_code");
  });

  it("sets reportingCurrency to an enabled currency and does not rewrite amounts", async () => {
    const boot = await call("GET", "/api/bootstrap");
    const spendGroup = boot.json.groups.find((group) => !group.is_income);
    const categoryId = spendGroup.categories[0].id;
    const created = await createAccount({
      name: "列报对照",
      currencyCode: "CNY",
      startingBalanceMinor: 4200,
    });
    const posted = await call("POST", "/api/transactions", {
      accountId: created.json.id,
      date: "2026-08-04",
      amount: -700,
      payeeName: "午餐",
      categoryId,
    });
    expect(posted.status).toBe(200);
    const budget = await call("GET", `/api/budget/${boot.json.currentMonth}?currency=CNY`);
    const assigned = await call("PUT", `/api/budget/${boot.json.currentMonth}/category/${categoryId}/assign?currency=CNY`, {
      assigned: 1500,
      expectedRevision: budget.json.revision,
    });
    expect(assigned.status).toBe(200);
    const goal = await call("PUT", `/api/goals/${categoryId}?currency=CNY`, {
      type: "monthly",
      target: 2600,
      expectedRevision: assigned.json.revision,
    });
    expect(goal.status).toBe(200);

    const amountsBefore = snapshotFinancialAmounts(db);
    const accountBefore = accountRow(created.json.id);

    const updated = await call("PUT", "/api/settings", { reportingCurrency: "USD" });
    expect(updated.status).toBe(200);

    const settings = await call("GET", "/api/settings");
    expect(settings.json.reportingCurrency).toBe("USD");
    const afterBoot = await call("GET", "/api/bootstrap");
    expect(afterBoot.json.settings.reportingCurrency).toBe("USD");
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBefore);
    expect(accountRow(created.json.id)).toEqual(accountBefore);
  });
});
