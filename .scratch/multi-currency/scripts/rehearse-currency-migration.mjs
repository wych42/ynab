import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { getExponent } from "../../../server/money.mjs";
import {
  CURRENCY_MIGRATION_BACKUP_DIR_NAME,
  confirmCurrencyMigration,
  openCurrencyMigrationBackup,
  restoreCurrencyMigrationBackup,
} from "../../../server/currency-migration.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function fail(message, extra = {}) {
  const result = { ok: false, error: message, ...extra };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashList(items) {
  return crypto.createHash("sha256").update(items.slice().sort().join("\n")).digest("hex");
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function setting(database, key) {
  return database.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ?? null;
}

function schemaVersion(database) {
  return database.prepare("SELECT MAX(version) v FROM schema_migrations").get().v ?? 0;
}

function tableRowCounts(database) {
  const names = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const counts = {};
  for (const name of names) {
    counts[name] = database.prepare(`SELECT COUNT(*) c FROM ${quoteIdent(name)}`).get().c;
  }
  return counts;
}

function financialKeyHashes(database) {
  return {
    accounts: hashList(database.prepare("SELECT id FROM accounts").all().map((row) => row.id)),
    transactions: hashList(database.prepare("SELECT id FROM transactions").all().map((row) => row.id)),
    assignments: hashList(
      database.prepare("SELECT month, category_id FROM assignments").all().map((row) => `${row.month}|${row.category_id}`)
    ),
    goals: hashList(database.prepare("SELECT category_id FROM goals").all().map((row) => row.category_id)),
  };
}

function accountBalanceSummary(database) {
  const rows = database
    .prepare(
      `SELECT a.starting_balance,
              COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id=a.id AND t.is_start=0), 0) AS tx_sum
       FROM accounts a`
    )
    .all();
  let startingBalanceSum = 0;
  let nonStartTxAmountSum = 0;
  let recomputedBalanceSum = 0;
  for (const row of rows) {
    startingBalanceSum += row.starting_balance;
    nonStartTxAmountSum += row.tx_sum;
    recomputedBalanceSum += row.starting_balance + row.tx_sum;
  }
  const startTransactionAmountSum = database
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE is_start=1")
    .get().s;
  return {
    accountCount: rows.length,
    startingBalanceSum,
    nonStartTxAmountSum,
    recomputedBalanceSum,
    startTransactionAmountSum,
    startingMatchesStartTransactions: startingBalanceSum === startTransactionAmountSum,
  };
}

function assignmentSummary(database) {
  const row = database.prepare("SELECT COUNT(*) c, COALESCE(SUM(assigned),0) s FROM assignments").get();
  return { rowCount: row.c, assignedSum: row.s };
}

function goalSummary(database) {
  const row = database.prepare("SELECT COUNT(*) c, COALESCE(SUM(target),0) s FROM goals").get();
  return { rowCount: row.c, targetSum: row.s };
}

function nullCurrencyCounts(database) {
  return {
    accounts: database.prepare("SELECT COUNT(*) c FROM accounts WHERE currency_code IS NULL").get().c,
    assignments: database.prepare("SELECT COUNT(*) c FROM assignments WHERE currency_code IS NULL").get().c,
    goals: database.prepare("SELECT COUNT(*) c FROM goals WHERE currency_code IS NULL").get().c,
  };
}

function filledCurrencyCodes(database, table) {
  return [
    ...new Set(database.prepare(`SELECT currency_code FROM ${quoteIdent(table)}`).all().map((row) => row.currency_code)),
  ].sort();
}

function enabledCurrencies(database) {
  return database
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY sort_order, currency_code")
    .all()
    .map((row) => row.currency_code);
}

function snapshot(database) {
  const rowCounts = tableRowCounts(database);
  return {
    schemaVersion: schemaVersion(database),
    migrationStatus: setting(database, "currency_migration_status"),
    reportingCurrency: setting(database, "reporting_currency"),
    currencySymbolPresent: Boolean(setting(database, "currency_symbol")),
    rowCounts,
    primaryKeyCounts: {
      accounts: rowCounts.accounts ?? 0,
      transactions: rowCounts.transactions ?? 0,
      assignments: rowCounts.assignments ?? 0,
      goals: rowCounts.goals ?? 0,
    },
    keyHashes: financialKeyHashes(database),
    accountBalanceSummary: accountBalanceSummary(database),
    assignments: assignmentSummary(database),
    goals: goalSummary(database),
    nullCurrencyCounts: nullCurrencyCounts(database),
    enabledCurrencies: enabledCurrencies(database),
  };
}

function listBackupFiles(runDir) {
  const dir = path.join(runDir, CURRENCY_MIGRATION_BACKUP_DIR_NAME);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sqlite") && !name.startsWith(".")).sort();
}

function checkpointAndClose(database) {
  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // file may not be in WAL mode
  }
  database.close();
}

function integrityOk(database) {
  const rows = database.pragma("integrity_check");
  const values = rows.map((row) => row.integrity_check ?? Object.values(row)[0]);
  return values.length === 1 && values[0] === "ok";
}

const args = parseArgs(process.argv.slice(2));
const sourcePath = args.source;
const workDir = args["work-dir"] || args.workDir;
const currency = args.currency;

if (typeof sourcePath !== "string" || typeof workDir !== "string" || typeof currency !== "string") {
  fail("usage: rehearse-currency-migration.mjs --source <sqlite> --work-dir <dir> --currency CNY");
}

if (!fs.existsSync(sourcePath)) {
  fail("source snapshot was not found");
}

const parentWorkDir = path.resolve(workDir);
fs.mkdirSync(parentWorkDir, { recursive: true });
const runDir = fs.mkdtempSync(path.join(parentWorkDir, "run-"));
const workDbPath = path.join(runDir, "working.sqlite");
const restoredPath = path.join(runDir, "restored.sqlite");
const resultPath = path.join(runDir, "rehearsal-result.json");
const backupDir = path.join(runDir, CURRENCY_MIGRATION_BACKUP_DIR_NAME);

const sourceShaBefore = sha256File(sourcePath);
fs.copyFileSync(sourcePath, workDbPath);
const workShaBefore = sha256File(workDbPath);

const working = new Database(workDbPath, { fileMustExist: true });
working.pragma("foreign_keys = ON");
const pre = snapshot(working);
const exponent = getExponent(currency);

let confirm;
try {
  confirm = await confirmCurrencyMigration(working, currency, { dataDir: runDir, now: new Date("2026-08-31T15:30:45.000Z") });
} catch (error) {
  checkpointAndClose(working);
  fail("confirmCurrencyMigration failed", { code: error.code ?? null, runDir });
}

const post = snapshot(working);
const backupsAfterConfirm = listBackupFiles(runDir);
checkpointAndClose(working);

const reopened = new Database(workDbPath, { fileMustExist: true });
reopened.pragma("foreign_keys = ON");
const reopenedSnap = snapshot(reopened);
const workingIntegrity = integrityOk(reopened);
const second = await confirmCurrencyMigration(reopened, currency, { dataDir: runDir });
const backupsAfterSecond = listBackupFiles(runDir);
checkpointAndClose(reopened);

if (!confirm?.backup?.filePath) {
  fail("confirm did not return a backup path");
}

restoreCurrencyMigrationBackup({
  backupPath: confirm.backup.filePath,
  destPath: restoredPath,
  currentDatabasePath: workDbPath,
});

const restored = openCurrencyMigrationBackup(restoredPath);
const restoredSnap = snapshot(restored);
const restoredIntegrity = integrityOk(restored);
restored.close();

const sourceShaAfter = sha256File(sourcePath);
const workShaAfter = sha256File(workDbPath);

const defaultLedgers = ["CNY", "USD", "SGD", "EUR", "JPY"];
const expectedEnabled = defaultLedgers.includes(currency) ? defaultLedgers : [...defaultLedgers, currency];
const amountsUnscaled =
  exponent === 2 &&
  pre.accountBalanceSummary.startingBalanceSum === post.accountBalanceSummary.startingBalanceSum &&
  pre.accountBalanceSummary.nonStartTxAmountSum === post.accountBalanceSummary.nonStartTxAmountSum &&
  pre.accountBalanceSummary.recomputedBalanceSum === post.accountBalanceSummary.recomputedBalanceSum &&
  pre.assignments.assignedSum === post.assignments.assignedSum &&
  pre.goals.targetSum === post.goals.targetSum;

const postReadonly = new Database(workDbPath, { readonly: true, fileMustExist: true });
const filledAccountCurrencies = filledCurrencyCodes(postReadonly, "accounts");
const filledAssignmentCurrencies = filledCurrencyCodes(postReadonly, "assignments");
const filledGoalCurrencies = filledCurrencyCodes(postReadonly, "goals");
postReadonly.close();

const checks = {
  sourceUnchanged: sourceShaBefore === sourceShaAfter,
  workingCopied: workShaBefore === sourceShaBefore,
  preSchemaVersion: pre.schemaVersion === 11,
  prePending: pre.migrationStatus === "pending",
  preLegacyCurrencyEmpty:
    pre.nullCurrencyCounts.accounts === pre.primaryKeyCounts.accounts &&
    pre.nullCurrencyCounts.assignments === pre.primaryKeyCounts.assignments &&
    pre.nullCurrencyCounts.goals === pre.primaryKeyCounts.goals,
  backupCreated: Boolean(confirm.backup?.fileName) && backupsAfterConfirm.length === 1,
  alreadyCompletedFalse: confirm.alreadyCompleted === false,
  postComplete: post.migrationStatus === "complete",
  postReportingCurrency: post.reportingCurrency === currency,
  enabledCurrenciesMatch:
    post.enabledCurrencies.length === expectedEnabled.length &&
    expectedEnabled.every((code) => post.enabledCurrencies.includes(code)),
  noDuplicateLedgers: new Set(post.enabledCurrencies).size === post.enabledCurrencies.length,
  rowCountsUnchanged:
    pre.primaryKeyCounts.accounts === post.primaryKeyCounts.accounts &&
    pre.primaryKeyCounts.transactions === post.primaryKeyCounts.transactions &&
    pre.primaryKeyCounts.assignments === post.primaryKeyCounts.assignments &&
    pre.primaryKeyCounts.goals === post.primaryKeyCounts.goals,
  primaryKeySetsUnchanged:
    pre.keyHashes.accounts === post.keyHashes.accounts &&
    pre.keyHashes.transactions === post.keyHashes.transactions &&
    pre.keyHashes.assignments === post.keyHashes.assignments &&
    pre.keyHashes.goals === post.keyHashes.goals,
  targetExponentIsTwo: exponent === 2,
  amountsUnscaled,
  filledWithChosenCurrency:
    filledAccountCurrencies.length === 1 &&
    filledAccountCurrencies[0] === currency &&
    filledAssignmentCurrencies.length === 1 &&
    filledAssignmentCurrencies[0] === currency &&
    filledGoalCurrencies.length === 1 &&
    filledGoalCurrencies[0] === currency,
  reopenComplete: reopenedSnap.migrationStatus === "complete",
  workingIntegrityOk: workingIntegrity,
  secondAlreadyCompleted: second.alreadyCompleted === true,
  noSecondBackup: backupsAfterSecond.length === backupsAfterConfirm.length,
  restoredPending: restoredSnap.migrationStatus === "pending",
  restoredMatchesPre:
    restoredSnap.schemaVersion === pre.schemaVersion &&
    restoredSnap.migrationStatus === pre.migrationStatus &&
    restoredSnap.reportingCurrency === pre.reportingCurrency &&
    JSON.stringify(restoredSnap.rowCounts) === JSON.stringify(pre.rowCounts) &&
    JSON.stringify(restoredSnap.primaryKeyCounts) === JSON.stringify(pre.primaryKeyCounts) &&
    JSON.stringify(restoredSnap.keyHashes) === JSON.stringify(pre.keyHashes) &&
    JSON.stringify(restoredSnap.accountBalanceSummary) === JSON.stringify(pre.accountBalanceSummary) &&
    JSON.stringify(restoredSnap.assignments) === JSON.stringify(pre.assignments) &&
    JSON.stringify(restoredSnap.goals) === JSON.stringify(pre.goals) &&
    JSON.stringify(restoredSnap.nullCurrencyCounts) === JSON.stringify(pre.nullCurrencyCounts),
  restoredIntegrityOk: restoredIntegrity,
};

const failedChecks = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);

const result = {
  ok: failedChecks.length === 0,
  failedChecks,
  command: {
    source: sourcePath,
    workDir: parentWorkDir,
    runDir,
    workDbPath,
    restoredPath,
    resultPath,
    backupDir,
    currency,
  },
  source: {
    sha256: sourceShaBefore,
    sha256After: sourceShaAfter,
    unchanged: checks.sourceUnchanged,
  },
  working: {
    sha256Before: workShaBefore,
    sha256After: workShaAfter,
    integrityOk: workingIntegrity,
  },
  pre,
  confirm: {
    alreadyCompleted: confirm.alreadyCompleted,
    status: confirm.status,
    currencyCode: confirm.currencyCode ?? null,
    reportingCurrency: confirm.reportingCurrency ?? null,
    enabledCurrencies: confirm.enabledCurrencies ?? null,
    backupFileName: confirm.backup?.fileName ?? null,
  },
  post: {
    ...post,
    filledAccountCurrencies,
    filledAssignmentCurrencies,
    filledGoalCurrencies,
  },
  secondConfirm: {
    alreadyCompleted: second.alreadyCompleted,
    status: second.status,
    backupCount: backupsAfterSecond.length,
  },
  restore: {
    path: restoredPath,
    integrityOk: restoredIntegrity,
    snapshot: restoredSnap,
  },
  integrity: {
    working: workingIntegrity,
    restored: restoredIntegrity,
  },
  checks,
};

fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exit(1);
