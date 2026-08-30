export function insertSetting(database, key, value) {
  database
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}

export function insertAccount(database, account) {
  database
    .prepare(
      `INSERT INTO accounts(id,name,type,on_budget,closed,starting_balance,starting_balance_date,sort_order,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      account.id,
      account.name,
      account.type ?? "checking",
      account.onBudget ?? 1,
      account.closed ?? 0,
      account.startingBalance,
      account.startingBalanceDate ?? "2026-02-25",
      account.sortOrder ?? 0,
      account.createdAt ?? "2026-02-25T08:00:00.000Z"
    );
}

export function insertCategoryGroup(database, group) {
  database
    .prepare("INSERT INTO category_groups(id,name,sort_order,hidden,is_income) VALUES(?,?,?,?,?)")
    .run(group.id, group.name, group.sortOrder ?? 0, group.hidden ?? 0, group.isIncome ?? 0);
}

export function insertCategory(database, category) {
  database
    .prepare("INSERT INTO categories(id,group_id,name,sort_order,hidden) VALUES(?,?,?,?,?)")
    .run(category.id, category.groupId, category.name, category.sortOrder ?? 0, category.hidden ?? 0);
}

export function insertAssignment(database, assignment) {
  database
    .prepare("INSERT INTO assignments(month,category_id,assigned) VALUES(?,?,?)")
    .run(assignment.month, assignment.categoryId, assignment.assigned);
}

export function insertGoal(database, goal) {
  database
    .prepare("INSERT INTO goals(category_id,type,target,target_month) VALUES(?,?,?,?)")
    .run(goal.categoryId, goal.type ?? "targetBalance", goal.target, goal.targetMonth ?? null);
}

export function insertTransaction(database, tx) {
  database
    .prepare(
      `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,pair_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      tx.id,
      tx.accountId,
      tx.date,
      tx.payeeName ?? null,
      tx.transferAccountId ?? null,
      tx.categoryId ?? null,
      tx.memo ?? null,
      tx.amount,
      tx.cleared ?? 0,
      tx.reconciled ?? 0,
      tx.isStart ?? 0,
      tx.pairId ?? null,
      tx.createdAt ?? "2026-03-01T09:30:00.000Z"
    );
}

export function snapshotFinancialAmounts(database) {
  return {
    accounts: database.prepare("SELECT id, starting_balance FROM accounts ORDER BY id").all(),
    transactions: database.prepare("SELECT id, amount FROM transactions ORDER BY id").all(),
    assignments: database.prepare("SELECT month, category_id, assigned FROM assignments ORDER BY month, category_id").all(),
    goals: database.prepare("SELECT category_id, target FROM goals ORDER BY category_id").all(),
  };
}
