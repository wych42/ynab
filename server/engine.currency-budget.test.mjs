import { afterEach, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-engine-currency-budget-");

const { db, uid, createAccount } = await import("./db.mjs");
const { ageOfMoney, computeBudget, earliestMonth, listMonths } = await import("./engine.mjs");

const MONTH = "2026-08";
const PREV = "2026-07";

const spendGid = uid();
db.prepare("INSERT INTO category_groups(id,name,sort_order,is_income) VALUES(?,?,?,0)").run(spendGid, "日常开销", 80);
const diningId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(diningId, spendGid, "餐饮", 0);
const rentId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,?)").run(rentId, spendGid, "房租", 1);

const incomeGid = db.prepare("SELECT id FROM category_groups WHERE is_income=1 ORDER BY sort_order LIMIT 1").get()?.id;
const salaryId = incomeGid
  ? db.prepare("SELECT id FROM categories WHERE group_id=? ORDER BY sort_order LIMIT 1").get(incomeGid).id
  : null;

function thrownCode(fn) {
  try {
    fn();
  } catch (error) {
    return error.code ?? error.message;
  }
  return undefined;
}

function insertTx({
  accountId,
  date,
  amount,
  categoryId = null,
  payee = "x",
  transferAccountId = null,
  isStart = 0,
  isReconcileAdjustment = 0,
}) {
  db.prepare(
    `INSERT INTO transactions(id,account_id,date,payee_name,transfer_account_id,category_id,memo,amount,cleared,reconciled,is_start,is_reconcile_adjustment,pair_id,created_at)
     VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?)`
  ).run(
    uid(),
    accountId,
    date,
    payee,
    transferAccountId,
    categoryId,
    "",
    amount,
    isStart,
    isReconcileAdjustment,
    transferAccountId ? uid() : null,
    "2026-08-01T00:00:00.000Z"
  );
}

function insertAssignment(currencyCode, month, categoryId, assigned) {
  db.prepare("INSERT INTO assignments(currency_code, month, category_id, assigned) VALUES (?,?,?,?)").run(
    currencyCode,
    month,
    categoryId,
    assigned
  );
}

function insertGoal(currencyCode, categoryId, type, target) {
  db.prepare("INSERT INTO goals(currency_code, category_id, type, target, target_month) VALUES (?,?,?,?,NULL)").run(
    currencyCode,
    categoryId,
    type,
    target
  );
}

function state(currencyCode, month = MONTH) {
  return computeBudget(month, currencyCode).byMonth.get(month);
}

function wipeMoney() {
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM assignments").run();
  db.prepare("DELETE FROM goals").run();
  db.prepare("DELETE FROM accounts").run();
}

afterEach(() => {
  wipeMoney();
});

describe("computeBudget requires an explicit enabled currency", () => {
  it("rejects missing, symbol, lowercase, unsupported and disabled codes without inferring a ledger", () => {
    db.prepare("INSERT INTO settings(key,value) VALUES('currency_symbol','¥') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    createAccount({ name: "现金", type: "cash", currencyCode: "CNY", startingBalance: 1000, startingDate: `${MONTH}-01` });

    expect(thrownCode(() => computeBudget(MONTH))).toBe("invalid_currency_code");
    expect(thrownCode(() => computeBudget(MONTH, null))).toBe("invalid_currency_code");
    expect(thrownCode(() => computeBudget(MONTH, ""))).toBe("invalid_currency_code");
    expect(thrownCode(() => computeBudget(MONTH, "¥"))).toBe("invalid_currency_code");
    expect(thrownCode(() => computeBudget(MONTH, "cny"))).toBe("invalid_currency_code");
    expect(thrownCode(() => computeBudget(MONTH, "AUD"))).toBe("unsupported_currency");
    expect(thrownCode(() => computeBudget(MONTH, "CAD"))).toBe("currency_not_enabled");
    expect(thrownCode(() => earliestMonth())).toBe("invalid_currency_code");
    expect(thrownCode(() => listMonths(MONTH))).toBe("invalid_currency_code");
    expect(thrownCode(() => ageOfMoney())).toBe("invalid_currency_code");
    expect(db.prepare("SELECT value FROM settings WHERE key='currency_symbol'").get().value).toBe("¥");
  });
});

describe("CNY and SGD budgets are isolated", () => {
  it("CNY income raises only CNY Ready to Assign, including two household CNY accounts", () => {
    const chi = createAccount({
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });
    const partner = createAccount({
      name: "配偶钱包",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });
    const sgdNamedCny = createAccount({
      name: "CNY travel SGD",
      type: "checking",
      currencyCode: "SGD",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });

    insertTx({ accountId: chi, date: `${MONTH}-05`, amount: 10_000_000, categoryId: salaryId, payee: "工资-chi" });
    insertTx({ accountId: partner, date: `${MONTH}-06`, amount: 5_000_000, categoryId: salaryId, payee: "工资-partner" });
    insertTx({ accountId: sgdNamedCny, date: `${MONTH}-05`, amount: 500_000, categoryId: salaryId, payee: "SGD salary" });

    const cny = state("CNY");
    const sgd = state("SGD");
    expect(cny.inflow).toBe(15_000_000);
    expect(cny.readyToAssign).toBe(15_000_000);
    expect(sgd.inflow).toBe(500_000);
    expect(sgd.readyToAssign).toBe(500_000);
  });

  it("keeps assignments, activity, available and goals independent for the shared dining category", () => {
    const cnyAcc = createAccount({ name: "CNY", type: "cash", currencyCode: "CNY", startingBalance: 0, startingDate: `${MONTH}-01` });
    const sgdAcc = createAccount({ name: "SGD", type: "cash", currencyCode: "SGD", startingBalance: 0, startingDate: `${MONTH}-01` });
    insertTx({ accountId: cnyAcc, date: `${MONTH}-03`, amount: 1_000_000, payee: "CNY in" });
    insertTx({ accountId: sgdAcc, date: `${MONTH}-03`, amount: 800_000, payee: "SGD in" });
    insertTx({ accountId: cnyAcc, date: `${MONTH}-10`, amount: -80_000, categoryId: diningId, payee: "CNY dinner" });
    insertTx({ accountId: sgdAcc, date: `${MONTH}-10`, amount: -50_000, categoryId: diningId, payee: "SGD dinner" });
    insertAssignment("CNY", MONTH, diningId, 200_000);
    insertAssignment("SGD", MONTH, diningId, 300_000);
    insertGoal("CNY", diningId, "monthly", 200_000);
    insertGoal("SGD", diningId, "monthly", 80_000);

    const cny = state("CNY");
    const sgd = state("SGD");
    expect(cny.assigned[diningId]).toBe(200_000);
    expect(cny.activity[diningId]).toBe(-80_000);
    expect(cny.available[diningId]).toBe(120_000);
    expect(cny.readyToAssign).toBe(1_000_000 - 200_000);
    expect(sgd.assigned[diningId]).toBe(300_000);
    expect(sgd.activity[diningId]).toBe(-50_000);
    expect(sgd.available[diningId]).toBe(250_000);
    expect(sgd.readyToAssign).toBe(800_000 - 300_000);

    const goals = db.prepare("SELECT currency_code, target FROM goals WHERE category_id=? ORDER BY currency_code").all(diningId);
    expect(goals).toEqual([
      { currency_code: "CNY", target: 200_000 },
      { currency_code: "SGD", target: 80_000 },
    ]);
  });

  it("does not let SGD spend consume CNY age of money", () => {
    const cnyAcc = createAccount({ name: "CNY", type: "cash", currencyCode: "CNY", startingBalance: 0, startingDate: `${MONTH}-01` });
    const sgdAcc = createAccount({ name: "SGD", type: "cash", currencyCode: "SGD", startingBalance: 0, startingDate: `${MONTH}-01` });
    insertTx({ accountId: cnyAcc, date: `${MONTH}-01`, amount: 10_000, payee: "CNY inflow" });
    insertTx({ accountId: sgdAcc, date: `${MONTH}-15`, amount: -10_000, categoryId: diningId, payee: "SGD spend" });

    expect(ageOfMoney("CNY")).toBeGreaterThan(0);
    expect(ageOfMoney("SGD")).toBe(0);
  });

  it("builds month ranges from the requested currency only", () => {
    createAccount({
      name: "CNY old",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 100,
      startingDate: "2026-01-01",
    });
    createAccount({
      name: "SGD now",
      type: "checking",
      currencyCode: "SGD",
      startingBalance: 100,
      startingDate: `${MONTH}-01`,
    });

    expect(earliestMonth("CNY")).toBe("2026-01");
    expect(listMonths(MONTH, "CNY")[0]).toBe("2026-01");
    expect(earliestMonth("SGD")).toBe(MONTH);
    expect(listMonths(MONTH, "SGD")[0]).toBe(MONTH);
    expect(listMonths(MONTH, "SGD")).not.toContain("2026-01");
  });
});

describe("YNAB rules stay intact inside one currency while the other currency is a decoy", () => {
  it("counts on-budget starting balances, income, uncategorized outflow, activity, carry and overspending only for CNY", () => {
    const cny = createAccount({
      name: "CNY cash",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 50_000,
      startingDate: `${PREV}-01`,
    });
    const sgd = createAccount({
      name: "SGD decoy",
      type: "cash",
      currencyCode: "SGD",
      startingBalance: 9_999,
      startingDate: `${PREV}-01`,
    });
    insertTx({ accountId: cny, date: `${PREV}-10`, amount: 20_000, payee: "CNY extra" });
    insertTx({ accountId: sgd, date: `${PREV}-10`, amount: 80_000, payee: "SGD extra" });
    insertAssignment("CNY", PREV, diningId, 10_000);
    insertAssignment("SGD", PREV, diningId, 8_000);
    insertTx({ accountId: cny, date: `${MONTH}-04`, amount: -4_000, categoryId: diningId, payee: "CNY food" });
    insertTx({ accountId: cny, date: `${MONTH}-05`, amount: -7_000, payee: "CNY uncat" });
    insertTx({ accountId: sgd, date: `${MONTH}-04`, amount: -3_000, categoryId: diningId, payee: "SGD food" });
    insertTx({ accountId: cny, date: `${MONTH}-06`, amount: -12_000, categoryId: rentId, payee: "CNY rent overspend" });

    const prev = computeBudget(MONTH, "CNY").byMonth.get(PREV);
    const cur = state("CNY");
    const sgdCur = state("SGD");

    expect(prev.inflow).toBe(50_000 + 20_000);
    expect(prev.assigned[diningId]).toBe(10_000);
    expect(prev.readyToAssign).toBe(50_000 + 20_000 - 10_000);
    expect(cur.activity[diningId]).toBe(-4_000);
    expect(cur.available[diningId]).toBe(10_000 - 4_000);
    expect(cur.available[rentId]).toBe(-12_000);
    expect(cur.readyToAssign).toBe(prev.readyToAssign - 7_000 - 12_000);
    expect(sgdCur.inflow).toBe(0);
    expect(sgdCur.assigned[diningId]).toBe(0);
    expect(sgdCur.activity[diningId]).toBe(-3_000);
  });

  it("keeps same-currency on-budget transfers budget-neutral and isolates credit-card payment categories", () => {
    const cnyBank = createAccount({
      name: "CNY bank",
      type: "checking",
      currencyCode: "CNY",
      startingBalance: 100_000,
      startingDate: `${MONTH}-01`,
    });
    const cnyOther = createAccount({
      name: "CNY other",
      type: "cash",
      currencyCode: "CNY",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });
    const cnyCc = createAccount({
      name: "CNY card",
      type: "creditCard",
      currencyCode: "CNY",
      startingBalance: 0,
      startingDate: `${MONTH}-01`,
    });
    const sgdCc = createAccount({
      name: "SGD card",
      type: "creditCard",
      currencyCode: "SGD",
      startingBalance: -2_000,
      startingDate: `${MONTH}-01`,
    });

    insertAssignment("CNY", MONTH, diningId, 6_000);
    const before = state("CNY").readyToAssign;
    insertTx({
      accountId: cnyBank,
      date: `${MONTH}-08`,
      amount: -15_000,
      transferAccountId: cnyOther,
      payee: "move",
    });
    insertTx({
      accountId: cnyOther,
      date: `${MONTH}-08`,
      amount: 15_000,
      transferAccountId: cnyBank,
      payee: "move",
    });
    insertTx({ accountId: cnyCc, date: `${MONTH}-09`, amount: -6_000, categoryId: diningId, payee: "card spend" });

    const cny = state("CNY");
    const sgd = state("SGD");
    expect(cny.readyToAssign).toBe(before);
    expect(cny.activity[diningId]).toBe(-6_000);
    expect(cny.activity[`cc:${cnyCc}`]).toBe(6_000);
    expect(cny.available[`cc:${cnyCc}`]).toBe(6_000);
    expect(cny.available[`cc:${sgdCc}`]).toBeUndefined();
    expect(sgd.available[`cc:${sgdCc}`]).toBeDefined();
    expect(sgd.available[`cc:${cnyCc}`]).toBeUndefined();
    expect(sgd.inflow).toBe(-2_000);
  });
});
