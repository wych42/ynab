import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  applyMigrations,
  budgetDbPath,
  columnInfo,
  makeTempDataDir,
  openRawSqlite,
  primaryKeyColumns,
  readSetting,
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
import { startTestApi } from "./test-support/http.mjs";
import { MoneyError } from "./money.mjs";
import { migrations } from "./migrations.mjs";

const SCHEMA_VERSION = Math.max(...migrations.map((m) => m.version));

process.env.DATA_DIR = makeTempDataDir("ynab-currency-migration-http-");

const { db, openBudgetDatabase, DATA_DIR, setSetting } = await import("./db.mjs");
const { api } = await import("./routes.mjs");
const {
  CURRENCY_MIGRATION_BACKUP_DIR_NAME,
  CurrencyMigrationError,
  confirmCurrencyMigration,
  getCurrencyMigrationPreview,
  openCurrencyMigrationBackup,
  restoreCurrencyMigrationBackup,
} = await import("./currency-migration.mjs");

const http = await startTestApi(api);
afterAll(() => http.close());

const LEGACY_IDS = {
  account: "acc-legacy",
  group: "grp-legacy",
  category: "cat-legacy",
  txStart: "tx-legacy-start",
  txSpend: "tx-legacy-spend",
};

const TWO_DECIMAL_CODES = ["CNY", "USD", "SGD", "CAD", "EUR", "GBP"];
const DEFAULT_LEDGERS = ["CNY", "USD", "SGD", "EUR", "JPY"];
const FIXED_NOW = new Date("2026-08-31T15:30:45.000Z");

const TWO_DECIMAL_AMOUNTS = {
  startingBalance: 960000,
  startTx: 960000,
  spend: -1234,
  assignedFeb: 50000,
  assignedMar: 140000,
  goal: 3000000,
};

const JPY_OK_AMOUNTS = {
  startingBalance: 1000000,
  startTx: 1000000,
  spend: -20000,
  assignedFeb: 50000,
  assignedMar: 140000,
  goal: 800000,
};

const JPY_BAD_AMOUNTS = {
  startingBalance: 1000000,
  startTx: 1000000,
  spend: -1234,
  assignedFeb: 100001,
  assignedMar: 140000,
  goal: 3000001,
};

function seedLegacyFinance(database, { symbol = "$", amounts = TWO_DECIMAL_AMOUNTS } = {}) {
  insertSetting(database, "initialized", "1");
  insertSetting(database, "currency_symbol", symbol);
  insertSetting(database, "language", "zh");
  insertSetting(database, "timezone", "UTC");
  insertAccount(database, {
    id: LEGACY_IDS.account,
    name: "Family Checking",
    type: "checking",
    startingBalance: amounts.startingBalance,
  });
  insertCategoryGroup(database, { id: LEGACY_IDS.group, name: "日常开销" });
  insertCategory(database, { id: LEGACY_IDS.category, groupId: LEGACY_IDS.group, name: "食品杂货" });
  insertAssignment(database, { month: "2026-02", categoryId: LEGACY_IDS.category, assigned: amounts.assignedFeb });
  insertAssignment(database, { month: "2026-03", categoryId: LEGACY_IDS.category, assigned: amounts.assignedMar });
  insertGoal(database, { categoryId: LEGACY_IDS.category, type: "targetBalance", target: amounts.goal });
  insertTransaction(database, {
    id: LEGACY_IDS.txStart,
    accountId: LEGACY_IDS.account,
    date: "2026-02-25",
    payeeName: "__starting__",
    amount: amounts.startTx,
    isStart: 1,
    createdAt: "2026-02-25T08:00:00.000Z",
  });
  insertTransaction(database, {
    id: LEGACY_IDS.txSpend,
    accountId: LEGACY_IDS.account,
    date: "2026-03-01",
    payeeName: "超市",
    categoryId: LEGACY_IDS.category,
    amount: amounts.spend,
  });
}

function createLegacyPendingDatabase({ symbol = "$", amounts = TWO_DECIMAL_AMOUNTS } = {}) {
  const dataDir = makeTempDataDir("ynab-legacy-mig-");
  const filePath = budgetDbPath(dataDir);
  const legacy = openRawSqlite(filePath);
  applyMigrations(legacy, { upTo: 9 });
  seedLegacyFinance(legacy, { symbol, amounts });
  legacy.close();
  const database = openBudgetDatabase(filePath);
  return { dataDir, filePath, database };
}

function ledgerCodes(database) {
  return database
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY sort_order, currency_code")
    .all()
    .map((row) => row.currency_code);
}

function migrationBackups(dataDir) {
  const dir = path.join(dataDir, CURRENCY_MIGRATION_BACKUP_DIR_NAME);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sqlite") && !name.startsWith("."));
}

function schemaVersions(database) {
  return database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
}

function accountBalance(database, id) {
  return database
    .prepare(
      `SELECT a.starting_balance
              + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id=a.id AND t.is_start=0), 0)
              AS balance
       FROM accounts a WHERE a.id=?`
    )
    .get(id).balance;
}

function budgetView(database) {
  const assigned = database
    .prepare("SELECT month, category_id, assigned FROM assignments ORDER BY month, category_id")
    .all();
  const activity = database
    .prepare(
      `SELECT category_id, COALESCE(SUM(amount), 0) AS activity
       FROM transactions
       WHERE is_start=0 AND category_id IS NOT NULL
       GROUP BY category_id
       ORDER BY category_id`
    )
    .all();
  const available = assigned.map((row) => {
    const act = activity.find((item) => item.category_id === row.category_id);
    const monthActivity = row.month === "2026-03" ? act?.activity ?? 0 : 0;
    return {
      month: row.month,
      category_id: row.category_id,
      available: row.assigned + monthActivity,
    };
  });
  return {
    balances: database.prepare("SELECT id FROM accounts ORDER BY id").all().map((row) => ({
      id: row.id,
      balance: accountBalance(database, row.id),
    })),
    assigned,
    activity,
    available,
    goals: database.prepare("SELECT category_id, target FROM goals ORDER BY category_id").all(),
  };
}

function scaleBudgetView(view, factor) {
  return {
    balances: view.balances.map((row) => ({ ...row, balance: row.balance / factor })),
    assigned: view.assigned.map((row) => ({ ...row, assigned: row.assigned / factor })),
    activity: view.activity.map((row) => ({ ...row, activity: row.activity / factor })),
    available: view.available.map((row) => ({ ...row, available: row.available / factor })),
    goals: view.goals.map((row) => ({ ...row, target: row.target / factor })),
  };
}

function scaleAmounts(snapshot, factor) {
  return {
    accounts: snapshot.accounts.map((row) => ({ ...row, starting_balance: row.starting_balance / factor })),
    transactions: snapshot.transactions.map((row) => ({ ...row, amount: row.amount / factor })),
    assignments: snapshot.assignments.map((row) => ({ ...row, assigned: row.assigned / factor })),
    goals: snapshot.goals.map((row) => ({ ...row, target: row.target / factor })),
  };
}

function assignmentKeys(database) {
  return database.prepare("SELECT month, category_id FROM assignments ORDER BY month, category_id").all();
}

function goalKeys(database) {
  return database.prepare("SELECT category_id FROM goals ORDER BY category_id").all();
}

function filledCurrency(database, table) {
  return database.prepare(`SELECT currency_code FROM ${table}`).all().map((row) => row.currency_code);
}

function expectPendingUnchanged(database, amountsBefore) {
  expect(readSetting(database, "currency_migration_status")).toBe("pending");
  expect(readSetting(database, "reporting_currency")).toBeNull();
  expect(snapshotFinancialAmounts(database)).toEqual(amountsBefore);
  expect(primaryKeyColumns(database, "assignments")).toEqual(["month", "category_id"]);
  expect(primaryKeyColumns(database, "goals")).toEqual(["category_id"]);
  expect(ledgerCodes(database)).toEqual([]);
  expect(filledCurrency(database, "accounts").every((code) => code == null)).toBe(true);
  expect(filledCurrency(database, "assignments").every((code) => code == null)).toBe(true);
  expect(filledCurrency(database, "goals").every((code) => code == null)).toBe(true);
  expect(readSetting(database, "currency_symbol")).toBeTruthy();
}

function expectMigratedShape(database, currencyCode, expectedLedgers) {
  expect(readSetting(database, "currency_migration_status")).toBe("complete");
  expect(readSetting(database, "reporting_currency")).toBe(currencyCode);
  expect(new Set(ledgerCodes(database))).toEqual(new Set(expectedLedgers));
  expect(ledgerCodes(database)).toHaveLength(expectedLedgers.length);
  expect(filledCurrency(database, "accounts").every((code) => code === currencyCode)).toBe(true);
  expect(filledCurrency(database, "assignments").every((code) => code === currencyCode)).toBe(true);
  expect(filledCurrency(database, "goals").every((code) => code === currencyCode)).toBe(true);
  expect(primaryKeyColumns(database, "assignments")).toEqual(["currency_code", "month", "category_id"]);
  expect(primaryKeyColumns(database, "goals")).toEqual(["currency_code", "category_id"]);
  expect(columnInfo(database, "assignments", "currency_code").notnull).toBe(1);
  expect(columnInfo(database, "goals", "currency_code").notnull).toBe(1);
  expect(schemaVersions(database)).toEqual(migrations.map((migration) => migration.version));
}

describe("GET /api/currency-migration and POST /api/currency-migration/confirm", () => {
  it("returns preview for an empty complete database without requiring confirmation", async () => {
    const r = await http.call("GET", "/api/currency-migration");
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("complete");
    expect(r.json.currencyMigrationRequired).toBe(false);
    expect(r.json.supportedCurrencies.map((currency) => currency.code).sort()).toEqual([
      "CAD",
      "CNY",
      "EUR",
      "GBP",
      "JPY",
      "SGD",
      "USD",
    ]);
    expect(r.json.currencySymbol).toBe("¥");
    expect(r.json.suggestedCurrency).toBe("CNY");
  });

  it("returns already completed on confirm and does not write a migration backup", async () => {
    const before = migrationBackups(DATA_DIR);
    const r = await http.call("POST", "/api/currency-migration/confirm", { currencyCode: "CNY" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "complete", alreadyCompleted: true });
    expect(migrationBackups(DATA_DIR)).toEqual(before);
  });

  it("rejects a catalog-out code on the confirm route", async () => {
    const r = await http.call("POST", "/api/currency-migration/confirm", { currencyCode: "AUD" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("unsupported_currency");
    expect(r.json.error).toBe("unsupported_currency");
    expect(readSetting(db, "currency_migration_status")).toBe("complete");
  });

  it("rejects a missing currency code", async () => {
    const r = await http.call("POST", "/api/currency-migration/confirm", {});
    expect(r.status).toBe(400);
    expect(r.json.error).toBeTruthy();
  });
});

describe("confirm route failure contracts", () => {
  const httpIds = { account: "acc-http-mig-fail", tx: "tx-http-mig-fail" };

  beforeAll(() => {
    insertAccount(db, {
      id: httpIds.account,
      name: "HTTP Fail",
      type: "checking",
      startingBalance: 1000000,
    });
    insertTransaction(db, {
      id: httpIds.tx,
      accountId: httpIds.account,
      date: "2026-03-01",
      payeeName: "咖啡",
      amount: -1234,
    });
    setSetting("currency_migration_status", "pending");
  });

  it("returns 400 anomalies for JPY without a restore backup", async () => {
    const before = migrationBackups(DATA_DIR);
    const r = await http.call("POST", "/api/currency-migration/confirm", { currencyCode: "JPY" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("legacy_scale_not_divisible");
    expect(r.json.error).toBe("legacy_scale_not_divisible");
    expect(r.json.backup).toBeUndefined();
    expect(r.json.anomalies).toEqual(
      expect.arrayContaining([{ table: "transactions", id: httpIds.tx, field: "amount", value: -1234 }])
    );
    expect(readSetting(db, "currency_migration_status")).toBe("pending");
    expect(migrationBackups(DATA_DIR)).toEqual(before);
  });

  it("returns 500 with backup metadata when the transform fails", async () => {
    db.exec(`
      CREATE TRIGGER test_fail_http_migration
      AFTER UPDATE OF currency_code ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'controlled mid-migration failure');
      END;
    `);
    try {
      const r = await http.call("POST", "/api/currency-migration/confirm", { currencyCode: "CNY" });
      expect(r.status).toBe(500);
      expect(r.json.code).toBe("currency_migration_failed");
      expect(r.json.error).toBe("currency_migration_failed");
      expect(r.json.message).toBe("currency migration failed after backup");
      expect(JSON.stringify(r.json)).not.toMatch(/controlled mid-migration failure/);
      expect(r.json.backup.fileName).toMatch(new RegExp(`^budget-pre-currency-v${SCHEMA_VERSION}-`));
      expect(r.json.backup.filePath).toBe(
        path.join(DATA_DIR, CURRENCY_MIGRATION_BACKUP_DIR_NAME, r.json.backup.fileName)
      );
      expect(fs.existsSync(r.json.backup.filePath)).toBe(true);
      expect(readSetting(db, "currency_migration_status")).toBe("pending");
      expect(db.prepare("SELECT amount FROM transactions WHERE id=?").get(httpIds.tx).amount).toBe(-1234);
    } finally {
      db.exec("DROP TRIGGER IF EXISTS test_fail_http_migration");
    }
  });
});

describe("empty database does not need confirmation", () => {
  it("already has the five default ledgers and confirm is a no-op", async () => {
    const emptyDir = makeTempDataDir("ynab-legacy-empty-");
    const emptyDb = openBudgetDatabase(budgetDbPath(emptyDir));
    try {
      expect(ledgerCodes(emptyDb)).toEqual(DEFAULT_LEDGERS);
      expect(readSetting(emptyDb, "currency_migration_status")).toBe("complete");
      const preview = getCurrencyMigrationPreview(emptyDb);
      expect(preview.currencyMigrationRequired).toBe(false);
      expect(preview.status).toBe("complete");
      const result = await confirmCurrencyMigration(emptyDb, "CAD", { dataDir: emptyDir, now: FIXED_NOW });
      expect(result.alreadyCompleted).toBe(true);
      expect(ledgerCodes(emptyDb)).toEqual(DEFAULT_LEDGERS);
      expect(ledgerCodes(emptyDb)).not.toContain("CAD");
      expect(migrationBackups(emptyDir)).toEqual([]);
    } finally {
      emptyDb.close();
    }
  });
});

describe("migration preview does not guess or write", () => {
  it("does not treat $ as a unique currency and does not create ledgers", () => {
    const { dataDir, database } = createLegacyPendingDatabase({ symbol: "$" });
    try {
      const before = snapshotFinancialAmounts(database);
      const preview = getCurrencyMigrationPreview(database);
      expect(preview.status).toBe("pending");
      expect(preview.currencyMigrationRequired).toBe(true);
      expect(preview.currencySymbol).toBe("$");
      expect(preview.suggestedCurrency).toBeNull();
      expect(preview.suggestedCurrency).not.toBe("USD");
      expectPendingUnchanged(database, before);
      expect(migrationBackups(dataDir)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("can suggest CNY from ¥ without applying it", () => {
    const { database } = createLegacyPendingDatabase({ symbol: "¥" });
    try {
      const before = snapshotFinancialAmounts(database);
      const preview = getCurrencyMigrationPreview(database);
      expect(preview.suggestedCurrency).toBe("CNY");
      expectPendingUnchanged(database, before);
      expect(filledCurrency(database, "accounts").every((code) => code == null)).toBe(true);
    } finally {
      database.close();
    }
  });
});

describe("legacy two-decimal confirm matrix", () => {
  it.each(TWO_DECIMAL_CODES)("keeps integer amounts unchanged when confirming %s", async (currencyCode) => {
    const { dataDir, filePath, database } = createLegacyPendingDatabase({ symbol: "$" });
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      const keysBefore = { assignments: assignmentKeys(database), goals: goalKeys(database) };
      const countsBefore = {
        accounts: database.prepare("SELECT COUNT(*) c FROM accounts").get().c,
        transactions: database.prepare("SELECT COUNT(*) c FROM transactions").get().c,
        assignments: database.prepare("SELECT COUNT(*) c FROM assignments").get().c,
        goals: database.prepare("SELECT COUNT(*) c FROM goals").get().c,
      };
      const budgetBefore = budgetView(database);
      const expectedLedgers = DEFAULT_LEDGERS.includes(currencyCode)
        ? DEFAULT_LEDGERS
        : [...DEFAULT_LEDGERS, currencyCode];

      const result = await confirmCurrencyMigration(database, currencyCode, { dataDir, now: FIXED_NOW });

      expect(result.status).toBe("complete");
      expect(result.alreadyCompleted).toBe(false);
      expect(result.currencyCode).toBe(currencyCode);
      expect(result.reportingCurrency).toBe(currencyCode);
      expect(result.backup.fileName).toMatch(new RegExp(`^budget-pre-currency-v${SCHEMA_VERSION}-20260831-153045\\.sqlite$`));
      expect(result.backup.filePath).toBe(
        path.join(dataDir, CURRENCY_MIGRATION_BACKUP_DIR_NAME, result.backup.fileName)
      );
      expect(result.backup.filePath).not.toBe(filePath);
      expect(snapshotFinancialAmounts(database)).toEqual(amountsBefore);
      expect(budgetView(database)).toEqual(budgetBefore);
      expect(accountBalance(database, LEGACY_IDS.account)).toBe(
        TWO_DECIMAL_AMOUNTS.startingBalance + TWO_DECIMAL_AMOUNTS.spend
      );
      expect(assignmentKeys(database)).toEqual(keysBefore.assignments);
      expect(goalKeys(database)).toEqual(keysBefore.goals);
      expect(database.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(countsBefore.accounts);
      expect(database.prepare("SELECT COUNT(*) c FROM transactions").get().c).toBe(countsBefore.transactions);
      expect(database.prepare("SELECT COUNT(*) c FROM assignments").get().c).toBe(countsBefore.assignments);
      expect(database.prepare("SELECT COUNT(*) c FROM goals").get().c).toBe(countsBefore.goals);
      expectMigratedShape(database, currencyCode, expectedLedgers);
      expect(readSetting(database, "currency_symbol")).toBe("$");
      expect(migrationBackups(dataDir)).toEqual([result.backup.fileName]);
    } finally {
      database.close();
    }
  });

  it("creates SGD only once when the user confirms SGD", async () => {
    const { dataDir, database } = createLegacyPendingDatabase();
    try {
      await confirmCurrencyMigration(database, "SGD", { dataDir, now: FIXED_NOW });
      expect(ledgerCodes(database).filter((code) => code === "SGD")).toHaveLength(1);
      expect(ledgerCodes(database)).toEqual(DEFAULT_LEDGERS);
    } finally {
      database.close();
    }
  });

  it("adds CAD to the five default ledgers", async () => {
    const { dataDir, database } = createLegacyPendingDatabase();
    try {
      await confirmCurrencyMigration(database, "CAD", { dataDir, now: FIXED_NOW });
      expect(ledgerCodes(database)).toHaveLength(6);
      expect(ledgerCodes(database)).toContain("CAD");
      expect(DEFAULT_LEDGERS.every((code) => ledgerCodes(database).includes(code))).toBe(true);
    } finally {
      database.close();
    }
  });
});

describe("JPY scaling", () => {
  it("divides every legacy amount by 100 when all values are divisible", async () => {
    const { dataDir, database } = createLegacyPendingDatabase({ amounts: JPY_OK_AMOUNTS });
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      const budgetBefore = budgetView(database);
      const result = await confirmCurrencyMigration(database, "JPY", { dataDir, now: FIXED_NOW });
      expect(result.alreadyCompleted).toBe(false);
      expect(snapshotFinancialAmounts(database)).toEqual(scaleAmounts(amountsBefore, 100));
      expect(budgetView(database)).toEqual(scaleBudgetView(budgetBefore, 100));
      expect(accountBalance(database, LEGACY_IDS.account)).toBe(
        JPY_OK_AMOUNTS.startingBalance / 100 + JPY_OK_AMOUNTS.spend / 100
      );
      expectMigratedShape(database, "JPY", DEFAULT_LEDGERS);
    } finally {
      database.close();
    }
  });

  it("returns every indivisible amount before creating a backup or writing data", async () => {
    const { dataDir, database } = createLegacyPendingDatabase({ amounts: JPY_BAD_AMOUNTS });
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      let thrown;
      try {
        await confirmCurrencyMigration(database, "JPY", { dataDir, now: FIXED_NOW });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CurrencyMigrationError);
      expect(thrown.code).toBe("legacy_scale_not_divisible");
      expect(thrown.backup).toBeUndefined();
      expect(thrown.anomalies).toEqual([
        { table: "transactions", id: LEGACY_IDS.txSpend, field: "amount", value: -1234 },
        {
          table: "assignments",
          id: `2026-02:${LEGACY_IDS.category}`,
          field: "assigned",
          value: 100001,
        },
        { table: "goals", id: LEGACY_IDS.category, field: "target", value: 3000001 },
      ]);
      expectPendingUnchanged(database, amountsBefore);
      expect(migrationBackups(dataDir)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("catalog-out confirm is rejected", () => {
  it("rejects AUD without ledgers, completion, or a backup", async () => {
    const { dataDir, database } = createLegacyPendingDatabase();
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      await expect(confirmCurrencyMigration(database, "AUD", { dataDir, now: FIXED_NOW })).rejects.toBeInstanceOf(
        MoneyError
      );
      expectPendingUnchanged(database, amountsBefore);
      expect(migrationBackups(dataDir)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("atomicity and retry", () => {
  it("rolls back a mid-transform failure and stays retryable, keeping the pre-transform backup", async () => {
    const { dataDir, database } = createLegacyPendingDatabase();
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      database.exec(`
        CREATE TRIGGER test_fail_mid_migration
        AFTER UPDATE OF currency_code ON accounts
        BEGIN
          SELECT RAISE(ABORT, 'controlled mid-migration failure');
        END;
      `);

      let thrown;
      try {
        await confirmCurrencyMigration(database, "CNY", { dataDir, now: FIXED_NOW });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CurrencyMigrationError);
      expect(thrown.code).toBe("currency_migration_failed");
      expect(thrown.message).toBe("currency migration failed after backup");
      expect(thrown.message).not.toMatch(/controlled mid-migration failure/);
      expect(thrown.backup.fileName).toMatch(new RegExp(`^budget-pre-currency-v${SCHEMA_VERSION}-20260831-153045\\.sqlite$`));
      expect(thrown.backup.filePath).toBe(
        path.join(dataDir, CURRENCY_MIGRATION_BACKUP_DIR_NAME, thrown.backup.fileName)
      );
      expect(fs.existsSync(thrown.backup.filePath)).toBe(true);

      const snapshot = openCurrencyMigrationBackup(thrown.backup.filePath);
      try {
        expect(readSetting(snapshot, "currency_migration_status")).toBe("pending");
        expect(snapshotFinancialAmounts(snapshot)).toEqual(amountsBefore);
      } finally {
        snapshot.close();
      }

      expectPendingUnchanged(database, amountsBefore);
      expect(migrationBackups(dataDir)).toEqual([thrown.backup.fileName]);

      database.exec("DROP TRIGGER test_fail_mid_migration");
      const retry = await confirmCurrencyMigration(database, "CNY", {
        dataDir,
        now: new Date("2026-08-31T15:31:00.000Z"),
      });
      expect(retry.alreadyCompleted).toBe(false);
      expectMigratedShape(database, "CNY", DEFAULT_LEDGERS);
      expect(snapshotFinancialAmounts(database)).toEqual(amountsBefore);
    } finally {
      database.close();
    }
  });
});

describe("backup creation failure", () => {
  it("returns currency_migration_backup_failed without a fake path or data changes", async () => {
    const { dataDir, database } = createLegacyPendingDatabase();
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      const blocked = path.join(dataDir, "blocked-data-dir");
      fs.writeFileSync(blocked, "not-a-directory");

      let thrown;
      try {
        await confirmCurrencyMigration(database, "CNY", { dataDir: blocked, now: FIXED_NOW });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CurrencyMigrationError);
      expect(thrown.code).toBe("currency_migration_backup_failed");
      expect(thrown.message).toBe("currency migration backup failed");
      expect(thrown.backup).toBeUndefined();
      expectPendingUnchanged(database, amountsBefore);
      expect(migrationBackups(dataDir)).toEqual([]);
      expect(migrationBackups(blocked)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("confirm is idempotent after success", () => {
  it("does not rescale, recreate ledgers, or write a second backup", async () => {
    const { dataDir, database } = createLegacyPendingDatabase({ amounts: JPY_OK_AMOUNTS });
    try {
      const first = await confirmCurrencyMigration(database, "JPY", { dataDir, now: FIXED_NOW });
      const amountsAfterFirst = snapshotFinancialAmounts(database);
      const ledgersAfterFirst = ledgerCodes(database);
      const backupsAfterFirst = migrationBackups(dataDir);
      expect(backupsAfterFirst).toHaveLength(1);

      const second = await confirmCurrencyMigration(database, "JPY", {
        dataDir,
        now: new Date("2026-08-31T16:00:00.000Z"),
      });
      expect(second).toEqual({ status: "complete", alreadyCompleted: true });
      expect(snapshotFinancialAmounts(database)).toEqual(amountsAfterFirst);
      expect(ledgerCodes(database)).toEqual(ledgersAfterFirst);
      expect(migrationBackups(dataDir)).toEqual(backupsAfterFirst);
      expect(first.backup.fileName).toBe(backupsAfterFirst[0]);
    } finally {
      database.close();
    }
  });
});

describe("backup and restore", () => {
  it("writes a reopenable SQLite snapshot of the pre-transform database", async () => {
    const { dataDir, filePath, database } = createLegacyPendingDatabase({ symbol: "$" });
    try {
      const amountsBefore = snapshotFinancialAmounts(database);
      const result = await confirmCurrencyMigration(database, "CNY", { dataDir, now: FIXED_NOW });

      const direct = openCurrencyMigrationBackup(result.backup.filePath);
      try {
        expect(direct.pragma("integrity_check", { simple: true })).toBe("ok");
        expect(readSetting(direct, "currency_migration_status")).toBe("pending");
        expect(snapshotFinancialAmounts(direct)).toEqual(amountsBefore);
        expect(primaryKeyColumns(direct, "assignments")).toEqual(["month", "category_id"]);
        expect(primaryKeyColumns(direct, "goals")).toEqual(["category_id"]);
        expect(filledCurrency(direct, "accounts").every((code) => code == null)).toBe(true);
        expect(ledgerCodes(direct)).toEqual([]);
      } finally {
        direct.close();
      }

      const destPath = path.join(dataDir, "restored-pre-currency.sqlite");
      restoreCurrencyMigrationBackup({
        backupPath: result.backup.filePath,
        destPath,
        currentDatabasePath: filePath,
      });
      const copied = new Database(destPath, { readonly: true, fileMustExist: true });
      try {
        expect(readSetting(copied, "currency_migration_status")).toBe("pending");
        expect(snapshotFinancialAmounts(copied)).toEqual(amountsBefore);
        expect(primaryKeyColumns(copied, "assignments")).toEqual(["month", "category_id"]);
      } finally {
        copied.close();
      }

      expect(() =>
        restoreCurrencyMigrationBackup({
          backupPath: result.backup.filePath,
          destPath: filePath,
          currentDatabasePath: filePath,
        })
      ).toThrow(CurrencyMigrationError);
      expect(readSetting(database, "currency_migration_status")).toBe("complete");
      expect(snapshotFinancialAmounts(database)).toEqual(amountsBefore);
    } finally {
      database.close();
    }
  });
});
