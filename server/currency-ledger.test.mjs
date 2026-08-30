import { describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-currency-ledger-");

const { db, uid, createAccount, currentMonth } = await import("./db.mjs");
const { changeAccountCurrency } = await import("./account-currency.mjs");
const { computeBudget } = await import("./engine.mjs");
const ledger = await import("./currency-ledger.mjs");
const {
  CURRENCY_TRANSFER_SYSTEM_KEY,
  CurrencyLedgerError,
  deleteTransaction,
  ensureSystemCategories,
  postTransaction,
  postTransfer,
  reconcileAccount,
  updateTransaction,
} = ledger;

const MONTH = currentMonth();
const DAY = `${MONTH}-15`;

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function thrownCode(fn) {
  return thrown(fn)?.code ?? thrown(fn)?.message;
}

function currencyTransfer() {
  return db.prepare("SELECT * FROM categories WHERE system_key=?").get(CURRENCY_TRANSFER_SYSTEM_KEY);
}

function txCount() {
  return db.prepare("SELECT COUNT(*) c FROM transactions WHERE is_start=0").get().c;
}

function legsByPair(pairId) {
  return db
    .prepare("SELECT * FROM transactions WHERE pair_id=? ORDER BY amount ASC, id")
    .all(pairId);
}

function accountTxs(accountId) {
  return db
    .prepare("SELECT * FROM transactions WHERE account_id=? AND is_start=0 ORDER BY date, rowid")
    .all(accountId);
}

function budgetState(currencyCode, month = MONTH) {
  return computeBudget(month, currencyCode).byMonth.get(month);
}

function insertSpendGroup() {
  const groupId = uid();
  db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(groupId, "日常开销", 50);
  const diningId = uid();
  db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(diningId, groupId, "餐饮", 0);
  return { groupId, diningId };
}

function incomeCategoryId() {
  const row = db
    .prepare(
      "SELECT c.id FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=1 ORDER BY c.sort_order LIMIT 1"
    )
    .get();
  return row?.id ?? null;
}

function assign(currencyCode, categoryId, amount, month = MONTH) {
  db.prepare(
    "INSERT INTO assignments(currency_code,month,category_id,assigned) VALUES(?,?,?,?) ON CONFLICT(currency_code,month,category_id) DO UPDATE SET assigned=excluded.assigned"
  ).run(currencyCode, month, categoryId, amount);
}

const { diningId } = insertSpendGroup();

describe("system category currency_transfer", () => {
  it("initializes exactly one currency_transfer category by system_key, not by name", () => {
    const first = ensureSystemCategories(db);
    const renamed = currencyTransfer();
    expect(renamed.id).toBe(first);
    expect(renamed.system_key).toBe("currency_transfer");
    expect(renamed.name).toBe("换汇转出");

    db.prepare("UPDATE categories SET name=? WHERE id=?").run("外汇转出（已改名）", first);
    const again = ensureSystemCategories(db);
    expect(again).toBe(first);
    const rows = db.prepare("SELECT id, name, system_key FROM categories WHERE system_key=?").all("currency_transfer");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first, system_key: "currency_transfer", name: "外汇转出（已改名）" });
    db.prepare("UPDATE categories SET name=? WHERE id=?").run("换汇转出", first);
  });

  it("does not create a second row when a display-name match already exists", () => {
    const groupId = uid();
    db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(groupId, "临时", 90);
    db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(uid(), groupId, "换汇转出", 0);
    const before = db.prepare("SELECT COUNT(*) c FROM categories WHERE name='换汇转出'").get().c;
    ensureSystemCategories(db);
    expect(db.prepare("SELECT COUNT(*) c FROM categories WHERE system_key='currency_transfer'").get().c).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM categories WHERE name='换汇转出'").get().c).toBeGreaterThanOrEqual(before);
  });
});

describe("postTransaction", () => {
  it("books amount in the account currency and keeps original amount display-only", () => {
    const usd = createAccount({
      name: "USD card",
      type: "creditCard",
      currencyCode: "USD",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });
    const posted = postTransaction(db, {
      accountId: usd,
      date: DAY,
      payeeName: "Paris cafe",
      amount: -2200,
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2000,
      categoryId: diningId,
    });
    const row = db.prepare("SELECT * FROM transactions WHERE id=?").get(posted.id);
    expect(row.amount).toBe(-2200);
    expect(row.original_currency_code).toBe("EUR");
    expect(row.original_amount).toBe(2000);
    expect(row.category_id).toBe(diningId);

    const usdBudget = budgetState("USD");
    expect(usdBudget.activity[diningId]).toBe(-2200);
    const eurEnabled = db.prepare("SELECT 1 FROM currency_ledgers WHERE currency_code='EUR'").get();
    if (eurEnabled) {
      const eurBudget = budgetState("EUR");
      expect(eurBudget.activity[diningId] ?? 0).toBe(0);
    }
    const balance = db
      .prepare(
        `SELECT a.starting_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id=a.id AND t.is_start=0),0) AS balance
         FROM accounts a WHERE a.id=?`
      )
      .get(usd).balance;
    expect(balance).toBe(-2200);
  });

  it("rejects original fields unless they are both present or both absent", () => {
    const usd = createAccount({ name: "USD cash", type: "cash", currencyCode: "USD", startingBalance: 0 });
    const before = txCount();
    expect(thrownCode(() =>
      postTransaction(db, {
        accountId: usd,
        date: DAY,
        amount: -100,
        originalCurrencyCode: "EUR",
      })
    )).toBe("original_amount_incomplete");
    expect(thrownCode(() =>
      postTransaction(db, {
        accountId: usd,
        date: DAY,
        amount: -100,
        originalAmountMinor: 80,
      })
    )).toBe("original_amount_incomplete");
    expect(txCount()).toBe(before);
  });

  it("validates original currency through the money catalog and keeps income-direction rules", () => {
    const usd = createAccount({ name: "USD checking", type: "checking", currencyCode: "USD", startingBalance: 0 });
    expect(thrownCode(() =>
      postTransaction(db, {
        accountId: usd,
        date: DAY,
        amount: -100,
        originalCurrencyCode: "AUD",
        originalAmountMinor: 80,
      })
    )).toBe("unsupported_currency");

    const salary = incomeCategoryId();
    expect(salary).toBeTruthy();
    expect(thrownCode(() =>
      postTransaction(db, {
        accountId: usd,
        date: DAY,
        amount: -500,
        categoryId: salary,
      })
    )).toBe("income_category_requires_positive_amount");

    const income = postTransaction(db, {
      accountId: usd,
      date: DAY,
      amount: 1280000,
      categoryId: salary,
      payeeName: "Payroll",
    });
    expect(db.prepare("SELECT category_id, amount FROM transactions WHERE id=?").get(income.id)).toEqual({
      category_id: salary,
      amount: 1280000,
    });
  });

  it("rejects a booked currency that conflicts with the account", () => {
    const usd = createAccount({ name: "USD only", type: "cash", currencyCode: "USD", startingBalance: 0 });
    expect(thrownCode(() =>
      postTransaction(db, {
        accountId: usd,
        date: DAY,
        amount: -100,
        currencyCode: "CNY",
      })
    )).toBe("account_currency_mismatch");
  });
});

describe("postTransfer same-currency", () => {
  it("defaults the destination amount to the source absolute amount", () => {
    const a = createAccount({ name: "CNY A", type: "checking", currencyCode: "CNY", startingBalance: 100000 });
    const b = createAccount({ name: "CNY B", type: "cash", currencyCode: "CNY", startingBalance: 0 });
    const before = budgetState("CNY").readyToAssign;
    const posted = postTransfer(db, {
      fromId: a,
      toId: b,
      date: DAY,
      fromAmountMinor: 2200,
    });
    const legs = legsByPair(posted.pairId);
    expect(legs).toHaveLength(2);
    expect(legs.map((leg) => leg.amount).sort((x, y) => x - y)).toEqual([-2200, 2200]);
    expect(new Set(legs.map((leg) => leg.pair_id))).toEqual(new Set([posted.pairId]));
    expect(legs.every((leg) => leg.category_id == null)).toBe(true);
    expect(budgetState("CNY").readyToAssign).toBe(before);
  });

  it("rejects an explicit same-currency amount mismatch and writes nothing", () => {
    const a = createAccount({ name: "CNY src", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const b = createAccount({ name: "CNY dst", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const before = txCount();
    expect(thrownCode(() =>
      postTransfer(db, {
        fromId: a,
        toId: b,
        date: DAY,
        fromAmountMinor: 2200,
        toAmountMinor: 2300,
      })
    )).toBe("same_currency_amount_mismatch");
    expect(txCount()).toBe(before);
    expect(accountTxs(a)).toHaveLength(0);
    expect(accountTxs(b)).toHaveLength(0);
  });

  it("keeps JPY zero-decimal same-currency transfers exact", () => {
    const a = createAccount({ name: "JPY A", type: "cash", currencyCode: "JPY", startingBalance: 100000 });
    const b = createAccount({ name: "JPY B", type: "cash", currencyCode: "JPY", startingBalance: 0 });
    const posted = postTransfer(db, {
      fromId: a,
      toId: b,
      date: DAY,
      fromAmountMinor: 1234,
    });
    const legs = legsByPair(posted.pairId);
    expect(legs.map((leg) => Math.abs(leg.amount))).toEqual([1234, 1234]);
  });
});

describe("postTransfer cross-currency", () => {
  it("requires both actual amounts and never fills from a reference rate", () => {
    const sgd = createAccount({ name: "SGD 日常", type: "checking", currencyCode: "SGD", startingBalance: 500000 });
    const cny = createAccount({ name: "家庭 CNY", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const before = txCount();
    const fxBefore = db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c;
    expect(thrownCode(() =>
      postTransfer(db, {
        fromId: sgd,
        toId: cny,
        date: DAY,
        fromAmountMinor: 10000,
      })
    )).toBe("cross_currency_amount_required");
    expect(txCount()).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c).toBe(fxBefore);
  });

  it("stores 100.00 SGD out and 550.00 CNY in exactly and derives 5.5 CNY/SGD", () => {
    const sgd = createAccount({ name: "SGD wallet", type: "checking", currencyCode: "SGD", startingBalance: 500000 });
    const cny = createAccount({ name: "CNY wallet", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const fxCat = currencyTransfer();
    assign("SGD", fxCat.id, 10000);
    const sgdBefore = budgetState("SGD");
    const cnyBefore = budgetState("CNY");

    const posted = postTransfer(db, {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
      memo: "换汇",
    });

    const source = db.prepare("SELECT * FROM transactions WHERE id=?").get(posted.sourceId);
    const dest = db.prepare("SELECT * FROM transactions WHERE id=?").get(posted.destId);
    expect(source).toMatchObject({
      account_id: sgd,
      amount: -10000,
      pair_id: posted.pairId,
      category_id: fxCat.id,
      memo: "换汇",
    });
    expect(dest).toMatchObject({
      account_id: cny,
      amount: 55000,
      pair_id: posted.pairId,
      category_id: null,
      memo: "换汇",
    });
    expect(Math.abs(dest.amount) / Math.abs(source.amount)).toBe(5.5);
    expect(db.prepare("SELECT COUNT(*) c FROM fx_rates").get().c).toBe(0);

    const sgdAfter = budgetState("SGD");
    const cnyAfter = budgetState("CNY");
    expect(sgdAfter.activity[fxCat.id]).toBe((sgdBefore.activity[fxCat.id] ?? 0) - 10000);
    expect(sgdAfter.available[fxCat.id]).toBe(0);
    expect(cnyAfter.readyToAssign - cnyBefore.readyToAssign).toBe(55000);
    expect(sgdAfter.readyToAssign).toBe(sgdBefore.readyToAssign);
  });

  it("rolls back both legs and budget side effects when the second leg fails", () => {
    const sgd = createAccount({ name: "SGD atomic", type: "checking", currencyCode: "SGD", startingBalance: 100000 });
    const cny = createAccount({ name: "CNY atomic", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const beforeCount = txCount();
    const beforeIds = new Set(db.prepare("SELECT id FROM transactions").all().map((row) => row.id));
    const sgdRta = budgetState("SGD").readyToAssign;
    const cnyRta = budgetState("CNY").readyToAssign;

    db.exec(`
      CREATE TRIGGER fail_second_transfer_leg
      BEFORE INSERT ON transactions
      WHEN NEW.pair_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced second-leg failure')
        WHERE (SELECT COUNT(*) FROM transactions WHERE pair_id = NEW.pair_id) >= 1;
      END;
    `);

    const error = thrown(() =>
      postTransfer(db, {
        fromId: sgd,
        toId: cny,
        date: DAY,
        fromAmountMinor: 10000,
        toAmountMinor: 55000,
      })
    );
    expect(error).toBeTruthy();

    db.exec("DROP TRIGGER fail_second_transfer_leg");

    expect(txCount()).toBe(beforeCount);
    const afterIds = db.prepare("SELECT id FROM transactions").all().map((row) => row.id);
    expect(afterIds.every((id) => beforeIds.has(id))).toBe(true);
    expect(accountTxs(sgd)).toHaveLength(0);
    expect(accountTxs(cny)).toHaveLength(0);
    expect(budgetState("SGD").readyToAssign).toBe(sgdRta);
    expect(budgetState("CNY").readyToAssign).toBe(cnyRta);
  });

  it("uses the user category when sending on-budget funds to a tracking account", () => {
    const sgd = createAccount({ name: "SGD budget", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const usdInvest = createAccount({
      name: "USD invest",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 0,
    });
    assign("SGD", diningId, 10000);
    const usdRta = budgetState("USD").readyToAssign;
    const posted = postTransfer(db, {
      fromId: sgd,
      toId: usdInvest,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 7500,
      categoryId: diningId,
    });
    const source = db.prepare("SELECT * FROM transactions WHERE id=?").get(posted.sourceId);
    const dest = db.prepare("SELECT * FROM transactions WHERE id=?").get(posted.destId);
    expect(source.category_id).toBe(diningId);
    expect(dest.category_id).toBeNull();
    expect(budgetState("SGD").activity[diningId]).toBe(-10000);
    expect(budgetState("USD").readyToAssign).toBe(usdRta);
  });

  it("sends tracking-to-on-budget inflows into destination Ready to Assign", () => {
    const usdInvest = createAccount({
      name: "USD broker",
      type: "investment",
      currencyCode: "USD",
      startingBalance: 100000,
    });
    const cny = createAccount({ name: "CNY inflow", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const before = budgetState("CNY").readyToAssign;
    postTransfer(db, {
      fromId: usdInvest,
      toId: cny,
      date: DAY,
      fromAmountMinor: 1000,
      toAmountMinor: 7200,
    });
    expect(budgetState("CNY").readyToAssign - before).toBe(7200);
  });

  it("does not change budgets for tracking-to-tracking transfers", () => {
    const usd = createAccount({ name: "USD track", type: "investment", currencyCode: "USD", startingBalance: 5000 });
    const sgd = createAccount({ name: "SGD track", type: "otherAsset", currencyCode: "SGD", startingBalance: 0 });
    const usdRta = budgetState("USD").readyToAssign;
    const sgdRta = budgetState("SGD").readyToAssign;
    postTransfer(db, {
      fromId: usd,
      toId: sgd,
      date: DAY,
      fromAmountMinor: 1000,
      toAmountMinor: 1300,
    });
    expect(budgetState("USD").readyToAssign).toBe(usdRta);
    expect(budgetState("SGD").readyToAssign).toBe(sgdRta);
  });
});

describe("paired edit and delete", () => {
  it("updates both legs together and keeps a shared pair_id", () => {
    const sgd = createAccount({ name: "SGD edit", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY edit", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const posted = postTransfer(db, {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
    });
    const updated = updateTransaction(db, posted.sourceId, {
      accountId: sgd,
      transferAccountId: cny,
      date: `${MONTH}-16`,
      amount: -8000,
      toAmountMinor: 44000,
      memo: "改后",
    });
    const legs = legsByPair(updated.pairId ?? posted.pairId);
    expect(legs).toHaveLength(2);
    expect(legs.map((leg) => leg.amount).sort((x, y) => x - y)).toEqual([-8000, 44000]);
    expect(legs.every((leg) => leg.date === `${MONTH}-16`)).toBe(true);
    expect(legs.every((leg) => leg.memo === "改后")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE pair_id=?").get(posted.pairId).c).toBe(2);
  });

  it("deletes both legs of a pair", () => {
    const sgd = createAccount({ name: "SGD del", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY del", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const posted = postTransfer(db, {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
    });
    deleteTransaction(db, posted.destId);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE pair_id=?").get(posted.pairId).c).toBe(0);
    expect(accountTxs(sgd)).toHaveLength(0);
    expect(accountTxs(cny)).toHaveLength(0);
  });

  it("still deletes a historical transfer that has no pair_id", () => {
    const a = createAccount({ name: "legacy A", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const b = createAccount({ name: "legacy B", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const idA = uid();
    const idB = uid();
    const ins = db.prepare(
      `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,amount,is_start,pair_id,created_at)
       VALUES(?,?,?,?,?,?,0,NULL,?)`
    );
    ins.run(idA, a, DAY, "转账", b, -500, "2026-08-01T00:00:00.000Z");
    ins.run(idB, b, DAY, "", a, 500, "2026-08-01T00:00:00.000Z");
    deleteTransaction(db, idA);
    expect(db.prepare("SELECT id FROM transactions WHERE id=?").get(idA)).toBeFalsy();
    expect(db.prepare("SELECT id FROM transactions WHERE id=?").get(idB)).toBeFalsy();
  });
});

describe("reconcileAccount", () => {
  it("interprets the statement balance in the account currency and keeps transfer uncleared", () => {
    const jpy = createAccount({
      name: "JPY cash",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 1000,
      startingDate: `${MONTH}-01`,
    });
    const other = createAccount({ name: "JPY other", type: "cash", currencyCode: "JPY", startingBalance: 0 });
    postTransaction(db, { accountId: jpy, date: `${MONTH}-10`, amount: -200, payeeName: "uncleared", cleared: false });
    postTransfer(db, { fromId: jpy, toId: other, date: `${MONTH}-11`, fromAmountMinor: 50, cleared: false });

    const result = reconcileAccount(db, {
      accountId: jpy,
      statementBalance: 900,
      markCleared: true,
      asOfDate: `${MONTH}-20`,
    });
    expect(result.adjustment).toBe(150);
    const adj = db
      .prepare("SELECT * FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1")
      .get(jpy);
    expect(adj.amount).toBe(150);
    expect(adj.date).toBe(`${MONTH}-20`);
    const unclearedSpend = db.prepare("SELECT cleared, reconciled FROM transactions WHERE payee_name='uncleared'").get();
    expect(unclearedSpend).toEqual({ cleared: 1, reconciled: 1 });
    const transferLeg = db
      .prepare("SELECT cleared FROM transactions WHERE account_id=? AND transfer_account_id=?")
      .get(jpy, other);
    expect(transferLeg.cleared).toBe(0);
  });

  it("does not create an adjustment when the statement matches, and does not unlock account currency rules", () => {
    const cny = createAccount({
      name: "CNY rec",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 10000,
      startingDate: `${MONTH}-01`,
    });
    const result = reconcileAccount(db, { accountId: cny, statementBalance: 10000, markCleared: false });
    expect(result.adjustment).toBeNull();
    expect(thrown(() => changeAccountCurrency(db, cny, "USD"))).toBeTruthy();
  });
});

describe("CurrencyLedgerError shape", () => {
  it("is a typed error with a stable code", () => {
    const error = thrown(() =>
      postTransaction(db, { accountId: "missing", date: DAY, amount: -1 })
    );
    expect(error).toBeInstanceOf(CurrencyLedgerError);
    expect(typeof error.code).toBe("string");
  });
});

describe("transfer category is owned by postTransfer", () => {
  it("rejects recategorizing either leg of a cross-currency on-budget transfer", () => {
    const sgd = createAccount({ name: "SGD cat", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY cat", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const posted = postTransfer(db, {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
      categoryId: diningId,
    });
    const fxId = currencyTransfer().id;
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.sourceId).category_id).toBe(fxId);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.destId).category_id).toBeNull();

    expect(typeof ledger.setTransactionCategory).toBe("function");
    expect(thrownCode(() => ledger.setTransactionCategory(db, posted.sourceId, diningId))).toBe("transfer_category_managed");
    expect(thrownCode(() => ledger.setTransactionCategory(db, posted.sourceId, null))).toBe("transfer_category_managed");
    expect(thrownCode(() => ledger.setTransactionCategory(db, posted.destId, diningId))).toBe("transfer_category_managed");
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.sourceId).category_id).toBe(fxId);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.destId).category_id).toBeNull();
  });

  it("rejects recategorizing a same-currency transfer and still allows a normal expense", () => {
    const a = createAccount({ name: "CNY same src", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const b = createAccount({ name: "CNY same dst", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const posted = postTransfer(db, { fromId: a, toId: b, date: DAY, fromAmountMinor: 2200 });
    expect(thrownCode(() => ledger.setTransactionCategory(db, posted.sourceId, diningId))).toBe("transfer_category_managed");
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.sourceId).category_id).toBeNull();

    const spend = postTransaction(db, { accountId: a, date: DAY, amount: -300, payeeName: "咖啡" });
    ledger.setTransactionCategory(db, spend.id, diningId);
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(spend.id).category_id).toBe(diningId);
  });

  it("fails a mixed bulk category update atomically", () => {
    const sgd = createAccount({ name: "SGD bulk", type: "checking", currencyCode: "SGD", startingBalance: 20000 });
    const cny = createAccount({ name: "CNY bulk", type: "checking", currencyCode: "CNY", startingBalance: 0 });
    const spend = postTransaction(db, { accountId: sgd, date: DAY, amount: -500, payeeName: "普通" });
    const posted = postTransfer(db, {
      fromId: sgd,
      toId: cny,
      date: DAY,
      fromAmountMinor: 10000,
      toAmountMinor: 55000,
    });
    expect(typeof ledger.setTransactionsCategory).toBe("function");
    expect(thrownCode(() => ledger.setTransactionsCategory(db, [spend.id, posted.sourceId], diningId))).toBe(
      "transfer_category_managed"
    );
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(spend.id).category_id).toBeNull();
    expect(db.prepare("SELECT category_id FROM transactions WHERE id=?").get(posted.sourceId).category_id).toBe(
      currencyTransfer().id
    );
  });
});

describe("minor-unit amounts must be safe integers", () => {
  it("rejects a JPY transaction of 123.4 and a string amount, without writing a row", () => {
    const jpy = createAccount({ name: "JPY int", type: "cash", currencyCode: "JPY", startingBalance: 0 });
    const before = txCount();
    expect(thrownCode(() => postTransaction(db, { accountId: jpy, date: DAY, amount: 123.4, payeeName: "rounded" }))).toBe(
      "invalid_amount"
    );
    expect(thrownCode(() => postTransaction(db, { accountId: jpy, date: DAY, amount: "123", payeeName: "string" }))).toBe(
      "invalid_amount"
    );
    expect(txCount()).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE payee_name IN ('rounded','string')").get().c).toBe(0);

    const ok = postTransaction(db, { accountId: jpy, date: DAY, amount: 123, payeeName: "yen" });
    expect(db.prepare("SELECT amount FROM transactions WHERE id=?").get(ok.id).amount).toBe(123);
  });

  it("rejects a non-integer or string statement balance and does not insert an adjustment", () => {
    const jpy = createAccount({
      name: "JPY rec int",
      type: "cash",
      currencyCode: "JPY",
      startingBalance: 1000,
      startingDate: `${MONTH}-01`,
    });
    const before = txCount();
    expect(thrownCode(() => reconcileAccount(db, { accountId: jpy, statementBalance: 123.4 }))).toBe(
      "invalid_statement_balance"
    );
    expect(thrownCode(() => reconcileAccount(db, { accountId: jpy, statementBalance: "1000" }))).toBe(
      "invalid_statement_balance"
    );
    expect(txCount()).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE account_id=? AND is_reconcile_adjustment=1").get(jpy).c).toBe(0);

    const ok = reconcileAccount(db, { accountId: jpy, statementBalance: 1100, markCleared: false });
    expect(ok.adjustment).toBe(100);
  });

  it("still accepts two-decimal currency amounts that are already integer minor units", () => {
    const usd = createAccount({ name: "USD int", type: "cash", currencyCode: "USD", startingBalance: 0 });
    const posted = postTransaction(db, { accountId: usd, date: DAY, amount: -2200, payeeName: "ok" });
    expect(db.prepare("SELECT amount FROM transactions WHERE id=?").get(posted.id).amount).toBe(-2200);
  });
});
