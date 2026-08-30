import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrations as allMigrations } from "../migrations.mjs";

export function makeTempDataDir(prefix = "ynab-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function budgetDbPath(dataDir) {
  return path.join(dataDir, "budget.db");
}

export function openRawSqlite(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new Database(filePath);
  database.pragma("journal_mode = WAL");
  return database;
}

export function applyMigrations(database, { upTo = Infinity, migrations = allMigrations } = {}) {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  const record = database.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)");
  const fkEnabled = !!database.pragma("foreign_keys", { simple: true });
  if (fkEnabled) database.pragma("foreign_keys = OFF");
  try {
    for (const migration of migrations) {
      if (migration.version > upTo || applied.has(migration.version)) continue;
      migration.up(database);
      record.run(migration.version, migration.name, "2026-01-01T00:00:00.000Z");
    }
  } finally {
    if (fkEnabled) database.pragma("foreign_keys = ON");
  }
}

export function tableNames(database) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

export function columnNames(database, table) {
  return database.pragma(`table_info(${table})`).map((column) => column.name);
}

export function indexList(database, table) {
  return database.pragma(`index_list(${table})`).map((index) => ({
    name: index.name,
    unique: index.unique === 1,
    columns: database
      .pragma(`index_info(${index.name})`)
      .sort((a, b) => a.seqno - b.seqno)
      .map((column) => column.name),
  }));
}

export function readSetting(database, key) {
  const row = database.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : null;
}
