import { todayYmd } from "./db.mjs";
import { formatMoney } from "./money.mjs";
import {
  AccountCurrencyError,
  createAccountRecord,
  isAccountCurrencyError,
  requireEnabledCurrency,
} from "./account-currency.mjs";
import {
  isCurrencyLedgerError,
  postTransaction,
  postTransfer,
  reconcileAccount,
} from "./currency-ledger.mjs";
import { CURRENCY_MIGRATION_LOCK_ERROR, isCurrencyMigrationRequired } from "./currency-state.mjs";

export const SQL_WRITE_NOT_ALLOWED = "sql_write_not_allowed";
export const PROTECTED_TABLE_ERROR = "this table is protected";
export const INVALID_TOOL_ARGUMENTS = "invalid_tool_arguments";
export const WRITE_TOOL_NAMES = [
  "post_transaction",
  "post_transfer",
  "create_account",
  "assign_budget",
  "set_goal",
  "reconcile_account",
  "update_category_note",
];

const WRITE_TOOL_SET = new Set(WRITE_TOOL_NAMES);
const PROTECTED_TABLES = new Set([
  "settings",
  "schema_migrations",
  "chat_sessions",
  "chat_messages",
  "im_channels",
  "fx_rates",
]);
const FORBIDDEN_SQL = /\b(attach|detach|pragma|vacuum|reindex)\b/i;
const GOAL_TYPES = new Set(["monthly", "targetBalance", "targetByDate"]);

export class FinanceToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FinanceToolError";
    this.code = code;
  }
}

export function isFinanceToolError(error) {
  return error instanceof FinanceToolError || isAccountCurrencyError(error) || isCurrencyLedgerError(error);
}

function fail(code, message = code) {
  const payload = { ok: false, error: code, code };
  if (message && message !== code) payload.message = message;
  return payload;
}

function failFromError(error) {
  if (!error) return fail("tool_error", "tool error");
  if (error.code) return { ok: false, error: error.code, code: error.code, message: error.message || error.code };
  const message = String(error.message || error);
  const mapped = {
    "name required": "name_required",
    "invalid account type": "invalid_account_type",
    "not found": "not_found",
  }[message];
  if (mapped) return fail(mapped, message);
  return { ok: false, error: message, code: "tool_error", message };
}

function isPlainArgsObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(raw) {
  try {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const args = JSON.parse(text);
    if (!isPlainArgsObject(args)) {
      return { error: INVALID_TOOL_ARGUMENTS, code: INVALID_TOOL_ARGUMENTS };
    }
    return { args };
  } catch {
    return { error: INVALID_TOOL_ARGUMENTS, code: INVALID_TOOL_ARGUMENTS };
  }
}

function accountRow(database, id) {
  if (!id) return null;
  return database.prepare("SELECT * FROM accounts WHERE id=?").get(id) || null;
}

function categoryRow(database, id) {
  if (!id) return null;
  return database.prepare("SELECT * FROM categories WHERE id=?").get(id) || null;
}

function formatMinor(amountMinor, currencyCode) {
  if (typeof amountMinor !== "number") return String(amountMinor ?? "");
  try {
    if (currencyCode) return `${formatMoney(amountMinor, currencyCode, { locale: "zh-CN" })} (${currencyCode})`;
  } catch {
    /* fall through */
  }
  return `${amountMinor}${currencyCode ? ` ${currencyCode}` : ""}`;
}

export function assertAssignmentTarget(database, categoryId, currencyCode) {
  if (typeof categoryId !== "string" || !categoryId) {
    throw new AccountCurrencyError("invalid_assignment_target", "invalid assignment target");
  }
  if (categoryId.startsWith("cc:")) {
    const accountId = categoryId.slice(3);
    const acc = database
      .prepare(
        `SELECT id FROM accounts
         WHERE id=? AND type IN ('creditCard','lineOfCredit') AND on_budget=1 AND closed=0 AND currency_code=?`
      )
      .get(accountId, currencyCode);
    if (!acc) throw new AccountCurrencyError("invalid_assignment_target", "invalid assignment target");
    return;
  }
  if (!database.prepare("SELECT 1 FROM categories WHERE id=?").get(categoryId)) {
    throw new AccountCurrencyError("invalid_assignment_target", "invalid assignment target");
  }
}

export function upsertAssignment(database, month, categoryId, assignedMinor, currencyCode) {
  assertAssignmentTarget(database, categoryId, currencyCode);
  database
    .prepare(
      "INSERT INTO assignments(currency_code,month,category_id,assigned) VALUES(?,?,?,?) ON CONFLICT(currency_code,month,category_id) DO UPDATE SET assigned=excluded.assigned"
    )
    .run(currencyCode, month, categoryId, assignedMinor);
}

export function adjustAssignment(database, month, categoryId, delta, currencyCode) {
  assertAssignmentTarget(database, categoryId, currencyCode);
  const row = database
    .prepare("SELECT assigned FROM assignments WHERE month=? AND category_id=? AND currency_code=?")
    .get(month, categoryId, currencyCode);
  upsertAssignment(database, month, categoryId, (row?.assigned || 0) + delta, currencyCode);
}

export function assignBudget(database, input = {}) {
  const currencyCode = requireEnabledCurrency(database, input.currencyCode);
  const month = typeof input.month === "string" ? input.month : "";
  if (!month) throw new FinanceToolError("invalid_month", "invalid month");
  const assignedMinor = input.assignedMinor;
  if (typeof assignedMinor !== "number" || !Number.isInteger(assignedMinor) || !Number.isSafeInteger(assignedMinor) || assignedMinor < 0) {
    throw new FinanceToolError("invalid_amount", "invalid amount");
  }
  upsertAssignment(database, month, input.categoryId, assignedMinor, currencyCode);
  return { currencyCode, month, categoryId: input.categoryId, assignedMinor };
}

export function setGoal(database, input = {}) {
  const currencyCode = requireEnabledCurrency(database, input.currencyCode);
  const cat = categoryRow(database, input.categoryId);
  if (!cat) throw new FinanceToolError("not_found", "not found");
  const type = input.type;
  if (type == null || type === "clear" || type === "none") {
    database.prepare("DELETE FROM goals WHERE category_id=? AND currency_code=?").run(cat.id, currencyCode);
    return { currencyCode, categoryId: cat.id, cleared: true };
  }
  if (!GOAL_TYPES.has(type)) throw new FinanceToolError("invalid_goal_type", "invalid type");
  let targetMinor = input.targetMinor;
  if (targetMinor == null) targetMinor = 0;
  if (typeof targetMinor !== "number" || !Number.isInteger(targetMinor) || !Number.isSafeInteger(targetMinor) || targetMinor < 0) {
    throw new FinanceToolError("invalid_amount", "invalid amount");
  }
  const targetMonth = type === "targetByDate" ? input.targetMonth || null : null;
  database
    .prepare(
      "INSERT INTO goals(currency_code,category_id,type,target,target_month) VALUES(?,?,?,?,?) ON CONFLICT(currency_code,category_id) DO UPDATE SET type=excluded.type,target=excluded.target,target_month=excluded.target_month"
    )
    .run(currencyCode, cat.id, type, targetMinor, targetMonth);
  return { currencyCode, categoryId: cat.id, type, targetMinor, targetMonth };
}

export function updateCategoryNote(database, input = {}) {
  const cat = categoryRow(database, input.categoryId);
  if (!cat) throw new FinanceToolError("not_found", "not found");
  if (!Object.prototype.hasOwnProperty.call(input, "note")) {
    throw new FinanceToolError("note_required", "note required");
  }
  const note = String(input.note ?? "");
  database.prepare("UPDATE categories SET note=? WHERE id=?").run(note, cat.id);
  return { categoryId: cat.id, note };
}

function handlePostTransaction(database, args) {
  const posted = postTransaction(database, {
    accountId: args.accountId,
    date: args.date,
    amount: args.amountMinor,
    categoryId: args.categoryId,
    payeeName: args.payeeName,
    memo: args.memo,
    cleared: args.cleared,
    originalCurrencyCode: args.originalCurrencyCode,
    originalAmountMinor: args.originalAmountMinor,
  });
  const acc = accountRow(database, args.accountId);
  return {
    id: posted.id,
    accountId: args.accountId,
    currencyCode: acc?.currency_code ?? null,
    amountMinor: args.amountMinor,
  };
}

function handlePostTransfer(database, args) {
  const posted = postTransfer(database, {
    fromId: args.fromId,
    toId: args.toId,
    date: args.date,
    fromAmountMinor: args.fromAmountMinor,
    toAmountMinor: args.toAmountMinor,
    categoryId: args.categoryId,
    memo: args.memo,
  });
  const fromAcc = accountRow(database, args.fromId);
  const toAcc = accountRow(database, args.toId);
  return {
    ...posted,
    fromCurrencyCode: fromAcc?.currency_code ?? null,
    toCurrencyCode: toAcc?.currency_code ?? null,
    fromAmountMinor: args.fromAmountMinor,
    toAmountMinor: args.toAmountMinor ?? args.fromAmountMinor,
  };
}

function handleCreateAccount(database, args) {
  const startingBalanceMinor = args.startingBalanceMinor ?? 0;
  const id = createAccountRecord(
    database,
    {
      name: args.name,
      type: args.type,
      currencyCode: args.currencyCode,
      startingBalanceMinor,
      startingDate: args.startingDate,
    },
    { requireCurrency: true, todayYmd: todayYmd() }
  );
  const acc = accountRow(database, id);
  return {
    id,
    currencyCode: acc?.currency_code ?? args.currencyCode,
    startingBalanceMinor,
    type: acc?.type ?? args.type,
    name: acc?.name ?? args.name,
  };
}

function handleReconcile(database, args) {
  const asOfDate = args.asOfDate || todayYmd();
  const result = reconcileAccount(database, {
    accountId: args.accountId,
    statementBalance: args.statementBalanceMinor,
    markCleared: args.markCleared,
    asOfDate,
  });
  const acc = accountRow(database, args.accountId);
  return {
    ...result,
    accountId: args.accountId,
    currencyCode: acc?.currency_code ?? null,
    statementBalanceMinor: args.statementBalanceMinor,
    asOfDate,
  };
}

const HANDLERS = {
  post_transaction: handlePostTransaction,
  post_transfer: handlePostTransfer,
  create_account: handleCreateAccount,
  assign_budget: assignBudget,
  set_goal: setGoal,
  reconcile_account: handleReconcile,
  update_category_note: updateCategoryNote,
};

export function dispatchFinanceTool(database, name, args = {}) {
  try {
    if (isCurrencyMigrationRequired(database)) {
      return fail(CURRENCY_MIGRATION_LOCK_ERROR, CURRENCY_MIGRATION_LOCK_ERROR);
    }
    const handler = HANDLERS[name];
    if (!handler) return fail("unknown_tool", `unknown tool: ${name}`);
    const result = handler(database, args || {});
    return { ok: true, ...result };
  } catch (error) {
    return failFromError(error);
  }
}

export function summarizeFinanceTool(database, name, args = {}) {
  const bits = [];
  if (name === "post_transaction") {
    const acc = accountRow(database, args.accountId);
    const code = acc?.currency_code;
    bits.push(`记一笔交易：${acc?.name || args.accountId || "账户"}（${code || "?"}） ${formatMinor(args.amountMinor, code)}`);
    if (args.payeeName) bits.push(`商户 ${args.payeeName}`);
    const cat = categoryRow(database, args.categoryId);
    if (cat) bits.push(`分类 ${cat.name}`);
    if (args.originalCurrencyCode != null && args.originalAmountMinor != null) {
      bits.push(`原始金额 ${formatMinor(args.originalAmountMinor, args.originalCurrencyCode)}`);
    }
  } else if (name === "post_transfer") {
    const fromAcc = accountRow(database, args.fromId);
    const toAcc = accountRow(database, args.toId);
    bits.push(
      `转账：从 ${fromAcc?.name || args.fromId || "转出账户"}（${fromAcc?.currency_code || "?"}） ${formatMinor(args.fromAmountMinor, fromAcc?.currency_code)} 到 ${toAcc?.name || args.toId || "转入账户"}（${toAcc?.currency_code || "?"}） ${formatMinor(args.toAmountMinor, toAcc?.currency_code)}`
    );
  } else if (name === "create_account") {
    bits.push(
      `新建账户：${args.name || "未命名"}（${args.currencyCode || "?"}）期初 ${formatMinor(args.startingBalanceMinor ?? 0, args.currencyCode)}`
    );
  } else if (name === "assign_budget") {
    const cat = categoryRow(database, args.categoryId);
    bits.push(
      `分配预算：${args.month || "?"} ${args.currencyCode || "?"} ${cat?.name || args.categoryId || "分类"} ${formatMinor(args.assignedMinor, args.currencyCode)}`
    );
  } else if (name === "set_goal") {
    const cat = categoryRow(database, args.categoryId);
    if (args.type == null || args.type === "clear" || args.type === "none") {
      bits.push(`清除目标：${args.currencyCode || "?"} ${cat?.name || args.categoryId || "分类"}`);
    } else {
      bits.push(
        `设置目标：${args.currencyCode || "?"} ${cat?.name || args.categoryId || "分类"} ${args.type} ${formatMinor(args.targetMinor, args.currencyCode)}`
      );
    }
  } else if (name === "reconcile_account") {
    const acc = accountRow(database, args.accountId);
    bits.push(
      `对账：${acc?.name || args.accountId || "账户"}（${acc?.currency_code || "?"}）账单余额 ${formatMinor(args.statementBalanceMinor, acc?.currency_code)}${args.asOfDate ? ` 截止 ${args.asOfDate}` : ""}`
    );
  } else if (name === "update_category_note") {
    const cat = categoryRow(database, args.categoryId);
    bits.push(`更新分类备注：${cat?.name || args.categoryId || "分类"}`);
  } else {
    bits.push(name);
  }
  return bits.filter(Boolean).join(" · ");
}

function leadingKeyword(sql) {
  const stripped = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  const match = stripped.match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : "";
}

function tablesOpened(database, sql) {
  const names = new Set();
  try {
    const rows = database.prepare(`EXPLAIN ${sql}`).all();
    for (const row of rows) {
      const p4 = row.p4;
      if (typeof p4 !== "string" || !p4) continue;
      const master = database.prepare("SELECT tbl_name FROM sqlite_master WHERE name=?").get(p4);
      names.add(String(master?.tbl_name || p4).toLowerCase());
    }
  } catch {
    /* EXPLAIN may fail for some statements; fall back to identifier scan */
  }
  return names;
}

function mentionsProtectedIdentifier(sql) {
  const stripped = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  for (const table of PROTECTED_TABLES) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:main\\.)?(?:${table}|"${table}")(?:[^A-Za-z0-9_]|$)`, "i");
    if (re.test(stripped)) return true;
  }
  return false;
}

function referencesProtectedTable(database, sql) {
  for (const name of tablesOpened(database, sql)) {
    if (PROTECTED_TABLES.has(name)) return true;
  }
  return mentionsProtectedIdentifier(sql);
}

export function classifyReadSql(database, rawSql) {
  const sql = String(rawSql || "").trim().replace(/;+\s*$/, "");
  if (!sql) return { error: "empty sql" };
  if (/;/.test(sql)) return { error: "only one statement allowed" };
  if (FORBIDDEN_SQL.test(sql)) return { error: "command not allowed" };
  const keyword = leadingKeyword(sql);
  if (keyword && keyword !== "select" && keyword !== "with") {
    if (["insert", "update", "delete", "replace", "create", "drop", "alter"].includes(keyword)) {
      return { error: SQL_WRITE_NOT_ALLOWED, code: SQL_WRITE_NOT_ALLOWED };
    }
    return { error: "only SELECT is supported" };
  }
  let stmt;
  try {
    stmt = database.prepare(sql);
  } catch (error) {
    return { error: String(error.message || error) };
  }
  if (!stmt.readonly) return { error: SQL_WRITE_NOT_ALLOWED, code: SQL_WRITE_NOT_ALLOWED };
  if (referencesProtectedTable(database, sql)) return { error: PROTECTED_TABLE_ERROR };
  return { kind: "read", sql };
}

export function executeReadSql(database, sql) {
  try {
    let rows = database.prepare(sql).all();
    const total = rows.length;
    const truncated = total > 40;
    if (truncated) rows = rows.slice(0, 40);
    return { ok: true, rowCount: total, truncated, rows };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

export function classifyToolCall(database, call) {
  const name = call.name;
  if (name !== "run_sql" && !WRITE_TOOL_SET.has(name)) {
    return { call, name, args: {}, purpose: null, cls: { error: "unknown_tool", code: "unknown_tool" } };
  }
  const parsed = parseArgs(call.arguments);
  if (parsed.error) {
    return { call, name, args: {}, purpose: null, cls: { error: parsed.error, code: parsed.code } };
  }
  const args = parsed.args;
  const purpose = args.purpose ? String(args.purpose) : null;
  if (name === "run_sql") {
    return { call, name, args, purpose, cls: classifyReadSql(database, args.sql) };
  }
  return { call, name, args, purpose, cls: { kind: "write" } };
}

function confirmationHint(requireConfirmation) {
  return requireConfirmation
    ? "This change is queued until the user confirms. Do not assume it has been written."
    : "This change executes immediately through the same business Interface as the web app.";
}

function objectSchema(properties, required) {
  return { type: "object", properties, required };
}

export function getFinanceToolDefinitions({ requireConfirmation = true } = {}) {
  const writeHint = confirmationHint(requireConfirmation);
  const minor = "Integer minor units of the relevant account or ledger currency. Do not assume every currency divides by 100.";
  return [
    {
      type: "function",
      function: {
        name: "run_sql",
        description:
          "Execute one read-only SQLite SELECT (including read-only WITH ... SELECT) against ordinary finance tables. Returns at most 40 rows. Writes, DDL, ATTACH/PRAGMA/VACUUM, and reads of settings, schema_migrations, chat_*, im_channels, or fx_rates are rejected.",
        parameters: objectSchema(
          {
            sql: { type: "string", description: "A single read-only SELECT. Amounts are integer minor units of each account currency." },
            purpose: { type: "string", description: "Short reason for the query." },
          },
          ["sql"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "post_transaction",
        description: `Record a non-transfer transaction in the account currency. ${writeHint} Use originalCurrencyCode and originalAmountMinor together when the receipt currency differs from the account. Never invent the booked amount from a reference FX rate.`,
        parameters: objectSchema(
          {
            accountId: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD in the budget calendar." },
            amountMinor: { type: "integer", description: minor },
            categoryId: { type: "string" },
            payeeName: { type: "string" },
            memo: { type: "string" },
            cleared: { type: "boolean" },
            originalCurrencyCode: { type: "string", description: "Must be paired with originalAmountMinor." },
            originalAmountMinor: { type: "integer", description: "Minor units of originalCurrencyCode. Must be paired with originalCurrencyCode." },
            purpose: { type: "string" },
          },
          ["accountId", "date", "amountMinor"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "post_transfer",
        description: `Record a transfer as two atomic legs. Same-currency transfers may omit toAmountMinor. Cross-currency transfers MUST include both bank-real amounts; never fill toAmountMinor from reference FX. ${writeHint}`,
        parameters: objectSchema(
          {
            fromId: { type: "string" },
            toId: { type: "string" },
            date: { type: "string" },
            fromAmountMinor: { type: "integer", description: "Positive minor units leaving the source account." },
            toAmountMinor: { type: "integer", description: "Required when the two accounts have different currencies." },
            categoryId: { type: "string" },
            memo: { type: "string" },
            purpose: { type: "string" },
          },
          ["fromId", "toId", "date", "fromAmountMinor"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "create_account",
        description: `Create an account in an enabled/catalog currency with startingBalanceMinor in that currency's minor units. ${writeHint}`,
        parameters: objectSchema(
          {
            name: { type: "string" },
            type: { type: "string", description: "checking/savings/cash/creditCard/lineOfCredit/investment/property/vehicle/otherAsset/studentLoan/personalLoan/otherLiability" },
            currencyCode: { type: "string" },
            startingBalanceMinor: { type: "integer", description: minor },
            startingDate: { type: "string" },
            purpose: { type: "string" },
          },
          ["name", "type", "currencyCode", "startingBalanceMinor"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "assign_budget",
        description: `Assign budget in one currency ledger. ${writeHint}`,
        parameters: objectSchema(
          {
            currencyCode: { type: "string" },
            month: { type: "string", description: "YYYY-MM" },
            categoryId: { type: "string" },
            assignedMinor: { type: "integer", description: minor },
            purpose: { type: "string" },
          },
          ["currencyCode", "month", "categoryId", "assignedMinor"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "set_goal",
        description: `Set or clear a category goal in one currency ledger. Use type "clear" to remove the goal. ${writeHint}`,
        parameters: objectSchema(
          {
            currencyCode: { type: "string" },
            categoryId: { type: "string" },
            type: { type: "string", description: "monthly | targetBalance | targetByDate | clear" },
            targetMinor: { type: "integer", description: minor },
            targetMonth: { type: "string" },
            purpose: { type: "string" },
          },
          ["currencyCode", "categoryId", "type"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "reconcile_account",
        description: `Reconcile an account to statementBalanceMinor in the account currency as of asOfDate. ${writeHint}`,
        parameters: objectSchema(
          {
            accountId: { type: "string" },
            statementBalanceMinor: { type: "integer", description: minor },
            markCleared: { type: "boolean" },
            asOfDate: { type: "string", description: "YYYY-MM-DD; later transactions are ignored." },
            purpose: { type: "string" },
          },
          ["accountId", "statementBalanceMinor"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "update_category_note",
        description: `Replace a category note. ${writeHint}`,
        parameters: objectSchema(
          {
            categoryId: { type: "string" },
            note: { type: "string" },
            purpose: { type: "string" },
          },
          ["categoryId", "note"]
        ),
      },
    },
  ];
}
