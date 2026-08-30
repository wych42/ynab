import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { budgetDbPath, makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";
import { convertAmount, formatMoney } from "./money.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-demo-currency-");

const { db, openBudgetDatabase } = await import("./db.mjs");
const { loadDemoData } = await import("./demo.mjs");
const { createFxModule, createInMemoryFxAdapter } = await import("./fx.mjs");
const { createReportsModule } = await import("./reports.mjs");
const { createInvestmentModule } = await import("./investment.mjs");
const { api } = await import("./routes.mjs");
const http = await startTestApi(api);

const FIXED_NOW = new Date("2026-08-31T12:00:00.000Z");
const AS_OF = "2026-08-31";
const RATE_DATE = "2026-08-28";
const MONTH = "2026-08";

const REQUIRED_ACCOUNTS = [
  { name: "家庭 CNY 日常账户", type: "checking", currency: "CNY", onBudget: 1 },
  { name: "CNY 信用卡", type: "creditCard", currency: "CNY", onBudget: 1 },
  { name: "USD 投资账户", type: "investment", currency: "USD", onBudget: 0 },
  { name: "SGD 日常账户", type: "checking", currency: "SGD", onBudget: 1 },
  { name: "JPY 现金", type: "cash", currency: "JPY", onBudget: 1 },
  { name: "EUR 备用账户", type: "checking", currency: "EUR", onBudget: 1 },
];

const DEFAULT_LEDGERS = ["CNY", "USD", "SGD", "EUR", "JPY"];

const opened = [];

function openIsolatedDatabase() {
  const dir = makeTempDataDir("ynab-demo-isolated-");
  const file = budgetDbPath(dir);
  const database = openBudgetDatabase(file);
  database.prepare("UPDATE settings SET value='UTC' WHERE key='timezone'").run();
  opened.push(database);
  return database;
}

function loadFixture() {
  const database = openIsolatedDatabase();
  loadDemoData({ database, now: FIXED_NOW });
  return database;
}

function setting(database, key) {
  return database.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ?? null;
}

function accountByName(database, name) {
  return database.prepare("SELECT * FROM accounts WHERE name=?").get(name);
}

function balanceOf(database, id) {
  return database
    .prepare(
      `SELECT a.starting_balance
              + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id=a.id AND t.is_start=0), 0)
              AS balance
       FROM accounts a WHERE a.id=?`
    )
    .get(id).balance;
}

function categoryId(database, name) {
  return database.prepare("SELECT id FROM categories WHERE name=?").get(name)?.id;
}

function enabledLedgers(database) {
  return database
    .prepare("SELECT currency_code FROM currency_ledgers ORDER BY sort_order, currency_code")
    .all()
    .map((row) => row.currency_code);
}

afterEach(() => {
  while (opened.length) {
    const database = opened.pop();
    try {
      database.close();
    } catch {
      // already closed
    }
  }
});

describe("loadDemoData multi-currency fixture", () => {
  it("loads the household accounts in CNY, USD, SGD, JPY and EUR on an empty database", () => {
    const database = loadFixture();
    for (const spec of REQUIRED_ACCOUNTS) {
      const row = accountByName(database, spec.name);
      expect(row, spec.name).toBeTruthy();
      expect(row.type).toBe(spec.type);
      expect(row.currency_code).toBe(spec.currency);
      expect(row.on_budget).toBe(spec.onBudget);
    }
    expect(accountByName(database, "USD 信用卡")).toMatchObject({
      type: "creditCard",
      currency_code: "USD",
      on_budget: 1,
    });
    expect(balanceOf(database, accountByName(database, "EUR 备用账户").id)).toBe(0);
    expect(balanceOf(database, accountByName(database, "JPY 现金").id)).toBe(98_800);
  });

  it("sets reporting currency to CNY, keeps the five default ledgers, and does not enable CAD or GBP", () => {
    const database = loadFixture();
    expect(setting(database, "reporting_currency")).toBe("CNY");
    expect(setting(database, "currency_migration_status")).toBe("complete");
    expect(enabledLedgers(database)).toEqual(DEFAULT_LEDGERS);
    expect(enabledLedgers(database)).not.toContain("CAD");
    expect(enabledLedgers(database)).not.toContain("GBP");
  });

  it("keeps CNY and SGD assignments and goals on separate ledgers", () => {
    const database = loadFixture();
    const dining = categoryId(database, "餐饮外出");
    const emergency = categoryId(database, "应急基金");
    const cnyDining = database
      .prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?")
      .get(MONTH, dining);
    const sgdDining = database
      .prepare("SELECT assigned FROM assignments WHERE currency_code='SGD' AND month=? AND category_id=?")
      .get(MONTH, dining);
    expect(cnyDining.assigned).toBe(90_000);
    expect(sgdDining.assigned).toBe(20_000);

    const cnyGoal = database
      .prepare("SELECT target FROM goals WHERE currency_code='CNY' AND category_id=?")
      .get(emergency);
    const sgdGoal = database
      .prepare("SELECT target FROM goals WHERE currency_code='SGD' AND category_id=?")
      .get(emergency);
    expect(cnyGoal.target).toBe(3_000_000);
    expect(sgdGoal.target).toBe(800_000);
  });

  it("posts 100.00 SGD -> 550.00 CNY as a paired cross-currency transfer with bank amounts", () => {
    const database = loadFixture();
    const sgd = accountByName(database, "SGD 日常账户");
    const cny = accountByName(database, "家庭 CNY 日常账户");
    const legs = database
      .prepare(
        `SELECT t.amount, t.pair_id, t.account_id, t.transfer_account_id, a.currency_code
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.pair_id IS NOT NULL AND t.is_start=0 AND a.currency_code IN ('SGD','CNY')
           AND abs(t.amount) IN (10000, 55000)
         ORDER BY a.currency_code`
      )
      .all();
    expect(legs).toHaveLength(2);
    expect(legs[0].pair_id).toBe(legs[1].pair_id);
    expect(legs[0].pair_id).toBeTruthy();
    const byCode = Object.fromEntries(legs.map((row) => [row.currency_code, row]));
    expect(byCode.SGD).toMatchObject({
      amount: -10_000,
      account_id: sgd.id,
      transfer_account_id: cny.id,
    });
    expect(byCode.CNY).toMatchObject({
      amount: 55_000,
      account_id: cny.id,
      transfer_account_id: sgd.id,
    });
  });

  it("keeps a USD booked spend with a visible EUR original amount", () => {
    const database = loadFixture();
    const usdCard = accountByName(database, "USD 信用卡");
    const row = database
      .prepare(
        `SELECT amount, original_currency_code, original_amount, category_id, account_id
         FROM transactions WHERE original_currency_code='EUR' AND is_start=0`
      )
      .get();
    expect(row).toMatchObject({
      account_id: usdCard.id,
      amount: -2_200,
      original_currency_code: "EUR",
      original_amount: 2_000,
    });
    expect(row.category_id).toBe(categoryId(database, "餐饮外出"));
    expect(balanceOf(database, usdCard.id)).toBe(-2_200);
  });

  it("records USD investment contributions and a valuation adjustment without treating the adjustment as income", async () => {
    const database = loadFixture();
    const invest = accountByName(database, "USD 投资账户");
    const cnyBank = accountByName(database, "家庭 CNY 日常账户");
    expect(balanceOf(database, invest.id)).toBe(1_050_000);

    const contribution = database
      .prepare(
        `SELECT amount, pair_id, transfer_account_id FROM transactions
         WHERE account_id=? AND is_start=0 AND is_reconcile_adjustment=0 AND transfer_account_id IS NOT NULL`
      )
      .get(invest.id);
    expect(contribution.amount).toBe(200_000);
    expect(contribution.pair_id).toBeTruthy();
    expect(contribution.transfer_account_id).toBe(cnyBank.id);

    const adjustment = database
      .prepare(
        `SELECT amount, is_reconcile_adjustment FROM transactions
         WHERE account_id=? AND is_reconcile_adjustment=1`
      )
      .get(invest.id);
    expect(adjustment.amount).toBe(50_000);

    const investment = createInvestmentModule({ db: database }).getInvestmentAccount({
      accountId: invest.id,
      asOf: AS_OF,
      months: 12,
    });
    expect(investment).toMatchObject({
      currencyCode: "USD",
      balanceMinor: 1_050_000,
      contributionsMinor: 200_000,
      withdrawalsMinor: 0,
      netContributionsMinor: 200_000,
      latestValuationDate: AS_OF,
    });
  });

  it("stores controlled manual FX rates and never touches the network", () => {
    const database = openIsolatedDatabase();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("demo data must not access the network");
    };
    try {
      loadDemoData({ database, now: FIXED_NOW });
    } finally {
      globalThis.fetch = previousFetch;
    }

    const rates = database
      .prepare("SELECT rate_date, base_currency, quote_currency, rate, source FROM fx_rates ORDER BY base_currency")
      .all();
    expect(rates).toEqual([
      { rate_date: RATE_DATE, base_currency: "JPY", quote_currency: "CNY", rate: "0.050", source: "manual" },
      { rate_date: RATE_DATE, base_currency: "SGD", quote_currency: "CNY", rate: "5.40", source: "manual" },
      { rate_date: RATE_DATE, base_currency: "USD", quote_currency: "CNY", rate: "7.20", source: "manual" },
    ]);
  });

  it("formats the JPY cash balance without fake two-decimal places", () => {
    const database = loadFixture();
    const jpy = accountByName(database, "JPY 现金");
    const balance = balanceOf(database, jpy.id);
    expect(balance).toBe(98_800);
    for (const locale of ["zh-CN", "en-US"]) {
      const formatted = formatMoney(balance, "JPY", { locale });
      expect(formatted).not.toMatch(/[.,]00(?:[^\d]|$)/);
      expect(formatted).toMatch(/98[,.]?800/);
    }
  });

  it("computes a hand-checkable CNY net worth from the demo balances and manual rates", async () => {
    const database = loadFixture();
    const fx = createFxModule({
      db: database,
      provider: createInMemoryFxAdapter({ source: "frankfurter_ecb" }),
      today: () => AS_OF,
      nowIso: () => "2026-08-31T12:00:00.000Z",
    });
    const report = await createReportsModule({ db: database, fx }).buildNetWorthReport({
      reportingCurrency: "CNY",
      asOf: AS_OF,
      months: 1,
    });

    const expectedNative = {
      "家庭 CNY 日常账户": 811_600,
      支付宝: 1_028_000,
      微信钱包: 474_000,
      定期储蓄账户: 2_700_000,
      "CNY 信用卡": 64_000,
      "USD 信用卡": -2_200,
      "USD 投资账户": 1_050_000,
      "SGD 日常账户": 790_000,
      "JPY 现金": 98_800,
      "EUR 备用账户": 0,
    };
    const byName = Object.fromEntries(report.accounts.map((row) => [row.name, row]));
    for (const [name, native] of Object.entries(expectedNative)) {
      expect(byName[name]?.nativeBalanceMinor, name).toBe(native);
    }

    expect(report.complete).toBe(true);
    expect(report.totalAssetsMinor).toBe(17_397_600);
    expect(report.totalLiabilitiesMinor).toBe(15_840);
    expect(report.netWorthMinor).toBe(17_381_760);
    expect(byName["USD 投资账户"].fx).toMatchObject({
      rateDate: RATE_DATE,
      source: "manual",
      rate: "7.20",
    });
    expect(byName["EUR 备用账户"].convertedBalanceMinor).toBe(0);
  });

  it("rolls back the whole load when a later write fails", () => {
    const database = openIsolatedDatabase();
    database.exec(`
      CREATE TRIGGER demo_fail_after_three_accounts
      AFTER INSERT ON accounts
      WHEN (SELECT COUNT(*) FROM accounts) >= 3
      BEGIN
        SELECT RAISE(ABORT, 'forced demo failure');
      END;
    `);

    expect(() => loadDemoData({ database, now: FIXED_NOW })).toThrow(/forced demo failure/);
    expect(database.prepare("SELECT COUNT(*) c FROM accounts").get().c).toBe(0);
    expect(database.prepare("SELECT COUNT(*) c FROM transactions").get().c).toBe(0);
    expect(database.prepare("SELECT COUNT(*) c FROM fx_rates").get().c).toBe(0);
    expect(database.prepare("SELECT COUNT(*) c FROM assignments").get().c).toBe(0);
    expect(setting(database, "reporting_currency")).toBeNull();
  });
});

describe("POST /api/demo and module routes smoke", () => {
  afterAll(() => http.close());

  function wipeSingleton() {
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM accounts").run();
    db.prepare("DELETE FROM fx_rates").run();
    db.prepare("DELETE FROM assignments").run();
    db.prepare("DELETE FROM goals").run();
    db.prepare("DELETE FROM settings WHERE key='reporting_currency'").run();
  }

  beforeAll(() => {
    wipeSingleton();
  });

  it("rejects loading demo data when the database already has transactions", async () => {
    wipeSingleton();
    const first = await http.call("POST", "/api/demo");
    expect(first.status).toBe(200);
    expect(first.json.ok).toBe(true);
    const second = await http.call("POST", "/api/demo");
    expect(second.status).toBe(400);
    expect(second.json.error).toBe("data exists");
  });

  it("exposes demo data through bootstrap, budgets, reports, investment and transaction routes", async () => {
    wipeSingleton();
    loadDemoData({ database: db, now: FIXED_NOW });

    const boot = await http.call("GET", "/api/bootstrap");
    expect(boot.status).toBe(200);
    expect(boot.json.settings.reportingCurrency).toBe("CNY");
    expect(boot.json.enabledCurrencies).toEqual(DEFAULT_LEDGERS);
    expect(boot.json.enabledCurrencies).not.toContain("CAD");
    const names = boot.json.accounts.map((row) => row.name);
    for (const spec of REQUIRED_ACCOUNTS) {
      expect(names).toContain(spec.name);
      const acc = boot.json.accounts.find((row) => row.name === spec.name);
      expect(acc.currencyCode).toBe(spec.currency);
    }
    const jpy = boot.json.accounts.find((row) => row.name === "JPY 现金");
    expect(jpy.balance).toBe(98_800);
    expect(formatMoney(jpy.balance, "JPY", { locale: "en-US" })).not.toMatch(/[.,]00(?:[^\d]|$)/);

    const cnyBudget = await http.call("GET", `/api/budget/${MONTH}?currency=CNY`);
    const sgdBudget = await http.call("GET", `/api/budget/${MONTH}?currency=SGD`);
    expect(cnyBudget.status).toBe(200);
    expect(sgdBudget.status).toBe(200);
    const diningCny = cnyBudget.json.groups.flatMap((group) => group.categories).find((cat) => cat.name === "餐饮外出");
    const diningSgd = sgdBudget.json.groups.flatMap((group) => group.categories).find((cat) => cat.name === "餐饮外出");
    expect(diningCny.assigned).toBe(90_000);
    expect(diningSgd.assigned).toBe(20_000);
    expect(cnyBudget.json.readyToAssign).not.toBe(sgdBudget.json.readyToAssign);

    const nativeCny = await http.call("GET", "/api/reports/native?currency=CNY&months=12");
    const nativeUsd = await http.call("GET", "/api/reports/native?currency=USD&months=12");
    expect(nativeCny.status).toBe(200);
    expect(nativeUsd.status).toBe(200);
    expect(nativeCny.json.currencyCode).toBe("CNY");
    const usdIncome = nativeUsd.json.income.find((row) => row.month === MONTH)?.value ?? 0;
    const usdExpense = nativeUsd.json.expense.find((row) => row.month === MONTH)?.value ?? 0;
    expect(usdIncome).toBe(0);
    expect(usdExpense).toBe(2_200);

    const netWorth = await http.call(
      "GET",
      `/api/reports/net-worth?reportingCurrency=CNY&asOf=${AS_OF}&months=1`
    );
    expect(netWorth.status).toBe(200);
    expect(netWorth.json.complete).toBe(true);
    expect(netWorth.json.netWorthMinor).toBe(17_381_760);
    expect(netWorth.json.accounts.some((row) => row.fx?.source === "manual" && row.fx?.rateDate === RATE_DATE)).toBe(
      true
    );
    let assets = 0;
    let liabilities = 0;
    for (const row of netWorth.json.accounts) {
      const converted =
        row.nativeBalanceMinor === 0 || row.currencyCode === "CNY"
          ? row.nativeBalanceMinor
          : convertAmount({
              amountMinor: row.nativeBalanceMinor,
              from: row.currencyCode,
              to: "CNY",
              rate: row.fx.rate,
            });
      expect(row.convertedBalanceMinor).toBe(converted);
      if (converted > 0) assets += converted;
      else if (converted < 0) liabilities += -converted;
    }
    expect(assets).toBe(netWorth.json.totalAssetsMinor);
    expect(liabilities).toBe(netWorth.json.totalLiabilitiesMinor);

    const invest = boot.json.accounts.find((row) => row.name === "USD 投资账户");
    const investment = await http.call("GET", `/api/investments/${invest.id}?asOf=${AS_OF}&months=12`);
    expect(investment.status).toBe(200);
    expect(investment.json).toMatchObject({
      currencyCode: "USD",
      balanceMinor: 1_050_000,
      contributionsMinor: 200_000,
      netContributionsMinor: 200_000,
      latestValuationDate: AS_OF,
    });

    const txs = await http.call("GET", "/api/transactions?limit=2000");
    expect(txs.status).toBe(200);
    const fxLeg = txs.json.transactions.find(
      (row) => row.currencyCode === "SGD" && row.amount === -10_000 && row.otherAmountMinor === 55_000
    );
    expect(fxLeg).toBeTruthy();
    expect(fxLeg.otherAccountCurrencyCode).toBe("CNY");
    const original = txs.json.transactions.find((row) => row.originalCurrencyCode === "EUR");
    expect(original).toMatchObject({
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2_000,
      amount: -2_200,
      currencyCode: "USD",
    });
  });
});
