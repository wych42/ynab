import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import {
  applyMigrations,
  budgetDbPath,
  columnInfo,
  columnNames,
  indexList,
  makeTempDataDir,
  openRawSqlite,
  primaryKeyColumns,
  readSetting,
  tableNames,
} from "./test-support/database.mjs";
import {
  insertAccount,
  insertAssignment,
  insertCategory,
  insertCategoryGroup,
  insertGoal,
  insertSetting,
  insertTransaction,
  snapshotFinancialAmounts,
} from "./test-support/finance-fixtures.mjs";
import { migrations } from "./migrations.mjs";
import {
  BUILTIN_CURRENCY_CATALOG,
  MoneyError,
  createMoneyModule,
  listDefaultEnabledCurrencies,
} from "./money.mjs";

const LEGACY_DIR = makeTempDataDir("ynab-currency-schema-legacy-");
process.env.DATA_DIR = LEGACY_DIR;

const LEGACY_IDS = {
  account: "acc-legacy",
  group: "grp-legacy",
  category: "cat-legacy",
  txStart: "tx-legacy-start",
  txSpend: "tx-legacy-spend",
};

const legacyPath = budgetDbPath(LEGACY_DIR);
const legacy = openRawSqlite(legacyPath);
applyMigrations(legacy, { upTo: 9 });
insertSetting(legacy, "initialized", "1");
insertSetting(legacy, "currency_symbol", "$");
insertSetting(legacy, "language", "zh");
insertSetting(legacy, "timezone", "UTC");
insertAccount(legacy, {
  id: LEGACY_IDS.account,
  name: "Family Checking",
  type: "checking",
  startingBalance: 960000,
});
insertCategoryGroup(legacy, { id: LEGACY_IDS.group, name: "日常开销" });
insertCategory(legacy, { id: LEGACY_IDS.category, groupId: LEGACY_IDS.group, name: "食品杂货" });
insertAssignment(legacy, { month: "2026-03", categoryId: LEGACY_IDS.category, assigned: 140000 });
insertGoal(legacy, { categoryId: LEGACY_IDS.category, type: "targetBalance", target: 3000000 });
insertTransaction(legacy, {
  id: LEGACY_IDS.txStart,
  accountId: LEGACY_IDS.account,
  date: "2026-02-25",
  payeeName: "__starting__",
  amount: 960000,
  isStart: 1,
  createdAt: "2026-02-25T08:00:00.000Z",
});
insertTransaction(legacy, {
  id: LEGACY_IDS.txSpend,
  accountId: LEGACY_IDS.account,
  date: "2026-03-01",
  payeeName: "超市",
  categoryId: LEGACY_IDS.category,
  amount: -1234,
});
const amountsBeforeUpgrade = snapshotFinancialAmounts(legacy);
legacy.close();

const {
  db,
  openBudgetDatabase,
  ensureCurrencyMigrationState,
} = await import("./db.mjs");
const { createCurrencyLedger, getCurrencyBootstrapState } = await import("./currency-state.mjs");
const { finalizeBudgetCurrencySchema } = await import("./currency-schema.mjs");

const emptyDir = makeTempDataDir("ynab-currency-schema-empty-");
const emptyDb = openBudgetDatabase(budgetDbPath(emptyDir));

afterAll(() => {
  emptyDb.close();
});

function ledgerCodes(database) {
  return database
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY sort_order, currency_code")
    .all()
    .map((row) => row.currency_code);
}

describe("migration versions", () => {
  it("only appends version 10 and keeps published migration names", () => {
    expect(migrations.map((m) => [m.version, m.name])).toEqual([
      [1, "baseline-schema"],
      [2, "default-created-at"],
      [3, "im-channels"],
      [4, "im-session-history"],
      [5, "income-categories"],
      [6, "reconcile-flag"],
      [7, "category-note"],
      [8, "chat-reasoning-content"],
      [9, "chat-images"],
      [10, "compatible-currency-schema"],
    ]);
  });
});

describe("compatible currency schema", () => {
  it("adds currency_ledgers, fx_rates and compatible columns", () => {
    const tables = tableNames(db);
    expect(tables).toContain("currency_ledgers");
    expect(tables).toContain("fx_rates");
    expect(columnNames(db, "accounts")).toContain("currency_code");
    expect(columnNames(db, "transactions")).toEqual(expect.arrayContaining(["original_currency_code", "original_amount"]));
    expect(columnNames(db, "categories")).toContain("system_key");
    expect(columnNames(db, "assignments")).toContain("currency_code");
    expect(columnNames(db, "goals")).toContain("currency_code");
  });

  it("adds unique system_key and currency lookup indexes", () => {
    const categoryIndexes = indexList(db, "categories");
    expect(categoryIndexes.some((index) => index.unique && index.columns.includes("system_key"))).toBe(true);
    expect(indexList(db, "accounts").some((index) => index.columns.includes("currency_code"))).toBe(true);
    expect(indexList(db, "assignments").some((index) => index.columns.includes("currency_code"))).toBe(true);
    expect(indexList(db, "goals").some((index) => index.columns.includes("currency_code"))).toBe(true);
    expect(indexList(db, "fx_rates").some((index) => index.columns.includes("rate_date"))).toBe(true);
  });

  it("database only checks three uppercase letters for ledger codes", () => {
    expect(() => db.prepare("INSERT INTO currency_ledgers(currency_code, sort_order) VALUES ('AUD', 90)").run()).not.toThrow();
    expect(db.prepare("SELECT currency_code FROM currency_ledgers WHERE currency_code='AUD'").get().currency_code).toBe("AUD");
    expect(() => db.prepare("INSERT INTO currency_ledgers(currency_code) VALUES ('usd')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO currency_ledgers(currency_code) VALUES ('US')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO currency_ledgers(currency_code) VALUES ('USDT')").run()).toThrow();
    db.prepare("DELETE FROM currency_ledgers WHERE currency_code='AUD'").run();
  });

  it("stores original transaction currency fields and unique system_key", () => {
    db.prepare(
      "UPDATE transactions SET original_currency_code='EUR', original_amount=2000 WHERE id=?"
    ).run(LEGACY_IDS.txSpend);
    const tx = db.prepare("SELECT original_currency_code, original_amount, amount FROM transactions WHERE id=?").get(LEGACY_IDS.txSpend);
    expect(tx).toEqual({ original_currency_code: "EUR", original_amount: 2000, amount: -1234 });
    db.prepare("UPDATE transactions SET original_currency_code=NULL, original_amount=NULL WHERE id=?").run(LEGACY_IDS.txSpend);

    db.prepare("UPDATE categories SET system_key='currency_transfer' WHERE id=?").run(LEGACY_IDS.category);
    expect(() =>
      db.prepare("UPDATE categories SET system_key='currency_transfer' WHERE id=?").run(
        db.prepare("SELECT id FROM categories WHERE id!=? LIMIT 1").get(LEGACY_IDS.category).id
      )
    ).toThrow();
    db.prepare("UPDATE categories SET system_key=NULL WHERE id=?").run(LEGACY_IDS.category);
  });

  it("accepts fx_rates rows with three-letter codes", () => {
    db.prepare(
      `INSERT INTO fx_rates(rate_date, base_currency, quote_currency, rate, source, fetched_at)
       VALUES ('2026-08-28','USD','CNY','7.20','frankfurter_ecb','2026-08-30T00:00:00.000Z')`
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO fx_rates(rate_date, base_currency, quote_currency, rate, source, fetched_at)
         VALUES ('2026-08-28','usd','CNY','7.20','frankfurter_ecb','2026-08-30T00:00:00.000Z')`
      ).run()
    ).toThrow();
  });
});

describe("legacy database startup", () => {
  it("keeps every existing amount and does not guess a currency from currency_symbol", () => {
    expect(snapshotFinancialAmounts(db)).toEqual(amountsBeforeUpgrade);
    expect(readSetting(db, "currency_symbol")).toBe("$");
    expect(db.prepare("SELECT currency_code FROM accounts WHERE id=?").get(LEGACY_IDS.account).currency_code).toBeNull();
    expect(db.prepare("SELECT currency_code FROM assignments").all().every((row) => row.currency_code == null)).toBe(true);
    expect(db.prepare("SELECT currency_code FROM goals").all().every((row) => row.currency_code == null)).toBe(true);
    expect(db.prepare("SELECT original_currency_code, original_amount FROM transactions WHERE id=?").get(LEGACY_IDS.txSpend)).toEqual({
      original_currency_code: null,
      original_amount: null,
    });
    expect(ledgerCodes(db)).toEqual([]);
    expect(primaryKeyColumns(db, "assignments")).toEqual(["month", "category_id"]);
    expect(primaryKeyColumns(db, "goals")).toEqual(["category_id"]);
    expect(columnInfo(db, "assignments", "currency_code").notnull).toBe(0);
    expect(columnInfo(db, "goals", "currency_code").notnull).toBe(0);
  });

  it("marks an old database with financial data as migration pending", () => {
    const state = getCurrencyBootstrapState(db);
    expect(state.currencyMigrationRequired).toBe(true);
    expect(state.enabledCurrencies).toEqual([]);
    expect(state.reportingCurrency).toBeNull();
    expect(state.supportedCurrencies.map((currency) => currency.code).sort()).toEqual([
      "CAD",
      "CNY",
      "EUR",
      "GBP",
      "JPY",
      "SGD",
      "USD",
    ]);
    expect(readSetting(db, "currency_migration_status")).toBe("pending");
  });
});

describe("empty database startup", () => {
  it("initializes the five default ledgers and does not require confirmation", () => {
    expect(ledgerCodes(emptyDb)).toEqual(["CNY", "USD", "SGD", "EUR", "JPY"]);
    expect(ledgerCodes(emptyDb)).not.toContain("CAD");
    expect(ledgerCodes(emptyDb)).not.toContain("GBP");
    const state = getCurrencyBootstrapState(emptyDb);
    expect(state.currencyMigrationRequired).toBe(false);
    expect(state.enabledCurrencies).toEqual(["CNY", "USD", "SGD", "EUR", "JPY"]);
    expect(state.reportingCurrency).toBeNull();
    expect(listDefaultEnabledCurrencies().map((currency) => currency.code)).toEqual(state.enabledCurrencies);
  });

  it("gives assignments and goals composite uniqueness by currency on a brand-new empty database", () => {
    expect(primaryKeyColumns(emptyDb, "assignments")).toEqual(["currency_code", "month", "category_id"]);
    expect(primaryKeyColumns(emptyDb, "goals")).toEqual(["currency_code", "category_id"]);
    expect(columnInfo(emptyDb, "assignments", "currency_code").notnull).toBe(1);
    expect(columnInfo(emptyDb, "goals", "currency_code").notnull).toBe(1);

    const categoryId = emptyDb.prepare("SELECT id FROM categories ORDER BY sort_order LIMIT 1").get().id;
    emptyDb
      .prepare("INSERT INTO assignments(currency_code, month, category_id, assigned) VALUES ('CNY','2026-08',?,100)")
      .run(categoryId);
    emptyDb
      .prepare("INSERT INTO assignments(currency_code, month, category_id, assigned) VALUES ('SGD','2026-08',?,200)")
      .run(categoryId);
    expect(() =>
      emptyDb
        .prepare("INSERT INTO assignments(currency_code, month, category_id, assigned) VALUES ('CNY','2026-08',?,300)")
        .run(categoryId)
    ).toThrow(/UNIQUE|constraint/i);

    emptyDb
      .prepare("INSERT INTO goals(currency_code, category_id, type, target) VALUES ('CNY',?,'monthly',100)")
      .run(categoryId);
    emptyDb
      .prepare("INSERT INTO goals(currency_code, category_id, type, target) VALUES ('SGD',?,'monthly',200)")
      .run(categoryId);
    expect(() =>
      emptyDb
        .prepare("INSERT INTO goals(currency_code, category_id, type, target) VALUES ('CNY',?,'monthly',300)")
        .run(categoryId)
    ).toThrow(/UNIQUE|constraint/i);

    emptyDb.prepare("DELETE FROM assignments WHERE category_id=?").run(categoryId);
    emptyDb.prepare("DELETE FROM goals WHERE category_id=?").run(categoryId);
  });

  it("allows credit-card virtual assignment ids and does not FK assignments to categories", () => {
    const fks = emptyDb.pragma("foreign_key_list(assignments)");
    expect(fks.some((fk) => fk.table === "categories")).toBe(false);
    expect(emptyDb.pragma("foreign_key_list(goals)").some((fk) => fk.table === "categories")).toBe(true);

    emptyDb
      .prepare(
        `INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at,currency_code)
         VALUES ('acc-cc-cny','CNY卡','creditCard',1,0,0,'2026-08-01',0,'2026-08-01T00:00:00.000Z','CNY')`
      )
      .run();
    expect(() =>
      emptyDb
        .prepare("INSERT INTO assignments(currency_code, month, category_id, assigned) VALUES ('CNY','2026-08','cc:acc-cc-cny',500)")
        .run()
    ).not.toThrow();
    expect(
      emptyDb.prepare("SELECT assigned FROM assignments WHERE category_id='cc:acc-cc-cny' AND currency_code='CNY'").get().assigned
    ).toBe(500);
    emptyDb.prepare("DELETE FROM assignments WHERE category_id='cc:acc-cc-cny'").run();
    emptyDb.prepare("DELETE FROM accounts WHERE id='acc-cc-cny'").run();
  });
});

describe("product ledger interface vs schema", () => {
  it("rejects catalog-out codes through Money Module while the same schema can store AUD", () => {
    expect(() => createCurrencyLedger(emptyDb, "AUD")).toThrow(MoneyError);
    expect(emptyDb.prepare("SELECT 1 FROM currency_ledgers WHERE currency_code='AUD'").get()).toBeUndefined();

    emptyDb.prepare("INSERT INTO currency_ledgers(currency_code, sort_order) VALUES ('AUD', 80)").run();
    expect(emptyDb.prepare("SELECT currency_code FROM currency_ledgers WHERE currency_code='AUD'").get().currency_code).toBe("AUD");
    emptyDb.prepare("DELETE FROM currency_ledgers WHERE currency_code='AUD'").run();

    const withAud = createMoneyModule([
      ...BUILTIN_CURRENCY_CATALOG,
      { code: "AUD", exponent: 2, enabledByDefault: false },
    ]);
    createCurrencyLedger(emptyDb, "AUD", { money: withAud });
    expect(emptyDb.prepare("SELECT currency_code FROM currency_ledgers WHERE currency_code='AUD'").get().currency_code).toBe("AUD");
  });
});

describe("migration restart is idempotent", () => {
  it("does not rewrite amounts or duplicate ledgers when startup runs again", () => {
    const before = snapshotFinancialAmounts(db);
    const ledgersBefore = ledgerCodes(db);
    const statusBefore = readSetting(db, "currency_migration_status");

    expect(ensureCurrencyMigrationState(db)).toBe("pending");
    const reopened = openBudgetDatabase(legacyPath);
    expect(ensureCurrencyMigrationState(reopened)).toBe("pending");
    expect(snapshotFinancialAmounts(reopened)).toEqual(before);
    expect(ledgerCodes(reopened)).toEqual(ledgersBefore);
    expect(readSetting(reopened, "currency_migration_status")).toBe(statusBefore);
    expect(reopened.prepare("SELECT COUNT(*) c FROM schema_migrations WHERE version=10").get().c).toBe(1);
    reopened.close();

    const emptyBefore = ledgerCodes(emptyDb);
    expect(ensureCurrencyMigrationState(emptyDb)).toBe("complete");
    expect(ledgerCodes(emptyDb)).toEqual(emptyBefore);
    expect(emptyDb.prepare("SELECT COUNT(*) c FROM schema_migrations WHERE version=10").get().c).toBe(1);
  });
});

describe("schema finalization is atomic", () => {
  it("rebuilds assignments and goals in one transaction and leaves pending null-currency tables alone", () => {
    expect(primaryKeyColumns(db, "assignments")).toEqual(["month", "category_id"]);
    expect(primaryKeyColumns(db, "goals")).toEqual(["category_id"]);
    expect(db.prepare("SELECT currency_code FROM assignments").all().every((row) => row.currency_code == null)).toBe(true);

    const dir = makeTempDataDir("ynab-finalize-atomic-");
    const database = openRawSqlite(budgetDbPath(dir));
    applyMigrations(database);
    database.pragma("foreign_keys = OFF");
    insertSetting(database, "initialized", "1");
    insertSetting(database, "currency_migration_status", "complete");
    database.prepare("INSERT INTO currency_ledgers(currency_code, sort_order) VALUES ('CNY', 0)").run();
    insertCategoryGroup(database, { id: "g-atomic", name: "组" });
    insertCategory(database, { id: "c-atomic", groupId: "g-atomic", name: "分类" });
    database
      .prepare("INSERT INTO assignments(currency_code, month, category_id, assigned) VALUES ('CNY','2026-08','c-atomic',1)")
      .run();
    database
      .prepare("INSERT INTO goals(currency_code, category_id, type, target) VALUES ('USD','c-atomic','monthly',1)")
      .run();
    expect(primaryKeyColumns(database, "assignments")).toEqual(["month", "category_id"]);
    expect(primaryKeyColumns(database, "goals")).toEqual(["category_id"]);

    database.pragma("foreign_keys = ON");
    expect(() => finalizeBudgetCurrencySchema(database)).toThrow();
    expect(primaryKeyColumns(database, "assignments")).toEqual(["month", "category_id"]);
    expect(primaryKeyColumns(database, "goals")).toEqual(["category_id"]);
    expect(database.prepare("SELECT assigned FROM assignments WHERE category_id='c-atomic'").get().assigned).toBe(1);
    database.close();
  });
});
