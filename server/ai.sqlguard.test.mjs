// 隔离环境：必须在导入 ai.mjs 之前设置 DATA_DIR
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-ai-test-"));

const { classifySql } = await import("./ai.mjs");
const { db } = await import("./db.mjs");

describe("classifySql", () => {
  it("classifies plain reads as read", () => {
    expect(classifySql("SELECT * FROM accounts").kind).toBe("read");
    expect(classifySql("  select id from categories limit 5").kind).toBe("read");
    expect(classifySql("WITH t AS (SELECT 1) SELECT * FROM t").kind).toBe("read");
    expect(classifySql("SELECT currency_code FROM currency_ledgers").kind).toBe("read");
  });

  it("rejects writes instead of classifying them as executable SQL", () => {
    expect(classifySql("INSERT INTO accounts(id,name,type) VALUES('a','b','cash')").error).toBe("sql_write_not_allowed");
    expect(classifySql("UPDATE accounts SET name='x' WHERE id='a'").error).toBe("sql_write_not_allowed");
    expect(classifySql("DELETE FROM assignments WHERE month='2026-01'").error).toBe("sql_write_not_allowed");
    expect(classifySql("REPLACE INTO accounts(id,name,type) VALUES('a','b','cash')").error).toBe("sql_write_not_allowed");
  });

  it("rejects writing CTEs even when the statement starts with WITH", () => {
    const del = classifySql(
      "WITH doomed AS (SELECT id FROM accounts) DELETE FROM accounts WHERE id IN (SELECT id FROM doomed) RETURNING id"
    );
    expect(del.error).toBe("sql_write_not_allowed");
    expect(del.kind).not.toBe("read");
    const upd = classifySql(
      "WITH doomed AS (SELECT category_id FROM assignments) UPDATE assignments SET assigned=0 WHERE category_id IN (SELECT category_id FROM doomed)"
    );
    expect(upd.error).toBe("sql_write_not_allowed");
  });

  it("rejects multiple statements", () => {
    expect(classifySql("SELECT 1; SELECT 2").error).toBeTruthy();
    expect(classifySql("DELETE FROM accounts; DROP TABLE accounts").error).toBeTruthy();
  });

  it("rejects forbidden commands", () => {
    expect(classifySql("PRAGMA table_info(accounts)").error).toBeTruthy();
    expect(classifySql("ATTACH DATABASE 'x' AS y").error).toBeTruthy();
    expect(classifySql("VACUUM").error).toBeTruthy();
  });

  it("rejects writes against protected tables", () => {
    expect(classifySql("UPDATE settings SET value='x'").error).toBeTruthy();
    expect(classifySql("INSERT INTO chat_sessions(id,title) VALUES('a','b')").error).toBeTruthy();
    expect(classifySql("DELETE FROM chat_messages").error).toBeTruthy();
  });

  it("rejects READS against protected tables (settings holds the AI key)", () => {
    expect(classifySql("SELECT value FROM settings WHERE key='ai_key'").error).toBeTruthy();
    expect(classifySql("select * from settings").error).toBeTruthy();
    expect(classifySql("SELECT * FROM chat_messages LIMIT 10").error).toBeTruthy();
    expect(classifySql("WITH s AS (SELECT * FROM settings) SELECT * FROM s").error).toBeTruthy();
    expect(classifySql("SELECT * FROM schema_migrations").error).toBeTruthy();
    expect(classifySql("SELECT * FROM fx_rates").error).toBeTruthy();
    expect(classifySql("SELECT * FROM im_channels").error).toBeTruthy();
  });

  it("does not mutate the database when classifying a write CTE", () => {
    const before = db.prepare("SELECT COUNT(*) c FROM accounts").get().c;
    classifySql("WITH doomed AS (SELECT id FROM accounts) DELETE FROM accounts WHERE id IN (SELECT id FROM doomed)");
    expect(db.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(before);
  });

  it("rejects non-SQL statements", () => {
    expect(classifySql("").error).toBeTruthy();
    expect(classifySql("EXPLAIN SELECT 1").error).toBeTruthy();
  });
});
