export const CURRENCY_SHAPE_SQL = "length(currency_code) = 3 AND currency_code GLOB '[A-Z][A-Z][A-Z]'";

function primaryKeyColumns(database, table) {
  return database
    .pragma(`table_info(${table})`)
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}

function hasNullCurrency(database, table) {
  return !!database.prepare(`SELECT 1 FROM ${table} WHERE currency_code IS NULL LIMIT 1`).get();
}

export function isBudgetCurrencySchemaFinal(database) {
  const assignments = primaryKeyColumns(database, "assignments");
  const goals = primaryKeyColumns(database, "goals");
  return (
    assignments.length === 3 &&
    assignments[0] === "currency_code" &&
    goals.length === 2 &&
    goals[0] === "currency_code"
  );
}

export function rebuildAssignmentsWithCurrency(database) {
  database.exec(`
CREATE TABLE assignments_new (
  currency_code TEXT NOT NULL
    CHECK (${CURRENCY_SHAPE_SQL})
    REFERENCES currency_ledgers(currency_code),
  month TEXT NOT NULL,
  category_id TEXT NOT NULL,
  assigned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (currency_code, month, category_id)
);
INSERT INTO assignments_new(currency_code, month, category_id, assigned)
  SELECT currency_code, month, category_id, assigned FROM assignments;
DROP TABLE assignments;
ALTER TABLE assignments_new RENAME TO assignments;
CREATE INDEX IF NOT EXISTS idx_assignments_currency_code ON assignments(currency_code);
`);
}

export function rebuildGoalsWithCurrency(database) {
  database.exec(`
CREATE TABLE goals_new (
  currency_code TEXT NOT NULL
    CHECK (${CURRENCY_SHAPE_SQL})
    REFERENCES currency_ledgers(currency_code),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  target INTEGER NOT NULL DEFAULT 0,
  target_month TEXT,
  PRIMARY KEY (currency_code, category_id)
);
INSERT INTO goals_new(currency_code, category_id, type, target, target_month)
  SELECT currency_code, category_id, type, target, target_month FROM goals;
DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;
CREATE INDEX IF NOT EXISTS idx_goals_currency_code ON goals(currency_code);
`);
}

export function finalizeBudgetCurrencySchema(database) {
  if (isBudgetCurrencySchemaFinal(database)) return false;
  if (hasNullCurrency(database, "assignments") || hasNullCurrency(database, "goals")) return false;
  const run = database.transaction(() => {
    rebuildAssignmentsWithCurrency(database);
    rebuildGoalsWithCurrency(database);
  });
  run();
  return true;
}
