import { afterAll, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-routes-currency-budget-");

const { api } = await import("./routes.mjs");
const { db, uid, createAccount, currentMonth, addMonths } = await import("./db.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const month = currentMonth();

async function revisionOf(currency, m = month) {
  const result = await call("GET", `/api/budget/${m}?currency=${currency}`);
  if (result.status !== 200 || typeof result.json?.revision !== "number") {
    throw new Error(`revisionOf ${currency} ${m}: ${result.status} ${JSON.stringify(result.json)}`);
  }
  return result.json.revision;
}

function expectCurrencyError(result, code) {
  expect(result.status).toBe(400);
  expect(result.json).toMatchObject({ error: code, code });
}

const spendGroup = db.prepare("SELECT id FROM category_groups WHERE is_income=0 ORDER BY sort_order LIMIT 1").get();
const categoryId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,0)").run(categoryId, spendGroup.id, "隔离分类");
const otherId = uid();
db.prepare("INSERT INTO categories(id,group_id,name,sort_order) VALUES(?,?,?,1)").run(otherId, spendGroup.id, "隔离分类二");

const cnyAcc = createAccount({ name: "家庭 CNY 日常账户", type: "checking", currencyCode: "CNY", startingBalance: 0 });
const sgdAcc = createAccount({ name: "SGD 日常账户", type: "checking", currencyCode: "SGD", startingBalance: 0 });

describe("budget and goal routes require query currency", () => {
  it("returns stable 400 JSON when currency is missing, malformed, unsupported or not enabled", async () => {
    const readsAndWrites = [
      ["GET", `/api/budget/${month}`],
      ["PUT", `/api/budget/${month}/category/${categoryId}/assign`, { assigned: 100 }],
      ["POST", `/api/budget/${month}/move`, { fromId: categoryId, toId: otherId, amount: 1 }],
      ["POST", `/api/budget/${month}/cover`, { categoryId, fromId: "rta" }],
      ["POST", `/api/budget/${month}/copy-previous`],
      ["POST", `/api/budget/${month}/auto-assign`],
      ["PUT", `/api/goals/${categoryId}`, { type: "monthly", target: 100 }],
      ["GET", "/api/reports/native"],
      ["GET", "/api/reports/overview"],
    ];
    for (const [method, url, body] of readsAndWrites) {
      expectCurrencyError(await call(method, url, body), "invalid_currency_code");
    }

    const bodyOnly = [
      ["PUT", `/api/budget/${month}/category/${categoryId}/assign`, { assigned: 100, currency: "CNY" }],
      ["POST", `/api/budget/${month}/move`, { fromId: categoryId, toId: otherId, amount: 1, currency: "CNY" }],
      ["POST", `/api/budget/${month}/cover`, { categoryId, fromId: "rta", currency: "CNY" }],
      ["POST", `/api/budget/${month}/copy-previous`, { currency: "CNY" }],
      ["POST", `/api/budget/${month}/auto-assign`, { currency: "CNY" }],
      ["PUT", `/api/goals/${categoryId}`, { type: "monthly", target: 100, currency: "CNY" }],
    ];
    for (const [method, url, body] of bodyOnly) {
      expectCurrencyError(await call(method, url, body), "invalid_currency_code");
    }

    expectCurrencyError(await call("GET", `/api/budget/${month}?currency=cny`), "invalid_currency_code");
    expectCurrencyError(await call("GET", `/api/budget/${month}?currency=AUD`), "unsupported_currency");
    expectCurrencyError(await call("GET", `/api/budget/${month}?currency=CAD`), "currency_not_enabled");
    expectCurrencyError(await call("GET", "/api/reports/native?currency=CAD"), "currency_not_enabled");
    expectCurrencyError(await call("PUT", `/api/goals/${categoryId}?currency=¥`, { type: "monthly", target: 1 }), "invalid_currency_code");
  });

  it("isolates assignments and goals by currency and returns top-level currencyCode", async () => {
    const income = await call("POST", "/api/transactions", {
      accountId: cnyAcc,
      date: `${month}-04`,
      amount: 50_000,
      payeeName: "CNY 收入",
    });
    expect(income.status).toBe(200);
    const sgdIncome = await call("POST", "/api/transactions", {
      accountId: sgdAcc,
      date: `${month}-04`,
      amount: 8_000,
      payeeName: "SGD 收入",
    });
    expect(sgdIncome.status).toBe(200);

    const cnyAssign = await call("PUT", `/api/budget/${month}/category/${categoryId}/assign?currency=CNY`, {
      assigned: 12_000,
      expectedRevision: await revisionOf("CNY"),
    });
    expect(cnyAssign.status).toBe(200);
    expect(cnyAssign.json.currencyCode).toBe("CNY");
    const cnyCat = cnyAssign.json.groups.flatMap((group) => group.categories).find((cat) => cat.id === categoryId);
    expect(cnyCat.assigned).toBe(12_000);

    const sgdAssign = await call("PUT", `/api/budget/${month}/category/${categoryId}/assign?currency=SGD`, {
      assigned: 3_000,
      expectedRevision: await revisionOf("SGD"),
    });
    expect(sgdAssign.status).toBe(200);
    expect(sgdAssign.json.currencyCode).toBe("SGD");
    const sgdCat = sgdAssign.json.groups.flatMap((group) => group.categories).find((cat) => cat.id === categoryId);
    expect(sgdCat.assigned).toBe(3_000);

    const cnyAgain = await call("GET", `/api/budget/${month}?currency=CNY`);
    expect(cnyAgain.json.groups.flatMap((group) => group.categories).find((cat) => cat.id === categoryId).assigned).toBe(12_000);
    expect(cnyAgain.json.readyToAssign).toBe(50_000 - 12_000);

    const cnyGoal = await call("PUT", `/api/goals/${categoryId}?currency=CNY`, {
      type: "monthly",
      target: 12_000,
      expectedRevision: await revisionOf("CNY"),
    });
    const sgdGoal = await call("PUT", `/api/goals/${categoryId}?currency=SGD`, {
      type: "monthly",
      target: 4_000,
      expectedRevision: await revisionOf("SGD"),
    });
    expect(cnyGoal.status).toBe(200);
    expect(sgdGoal.status).toBe(200);

    const cnyNeed = await call("GET", `/api/budget/${month}?currency=CNY`);
    const sgdNeed = await call("GET", `/api/budget/${month}?currency=SGD`);
    expect(cnyNeed.json.groups.flatMap((g) => g.categories).find((c) => c.id === categoryId).goal.target).toBe(12_000);
    expect(sgdNeed.json.groups.flatMap((g) => g.categories).find((c) => c.id === categoryId).goal.target).toBe(4_000);

    const boot = await call("GET", "/api/bootstrap");
    const bootCat = boot.json.groups.flatMap((group) => group.categories).find((cat) => cat.id === categoryId);
    expect(bootCat.goal).toBeNull();
    expect(bootCat.name).toBe("隔离分类");
  });

  it("copy-previous and move stay inside the requested currency", async () => {
    const prev = addMonths(month, -1);
    const prevCny = await call("PUT", `/api/budget/${prev}/category/${categoryId}/assign?currency=CNY`, {
      assigned: 2_200,
      expectedRevision: await revisionOf("CNY"),
    });
    expect(prevCny.status).toBe(200);
    const prevSgd = await call("PUT", `/api/budget/${prev}/category/${categoryId}/assign?currency=SGD`, {
      assigned: 900,
      expectedRevision: await revisionOf("SGD"),
    });
    expect(prevSgd.status).toBe(200);
    const copied = await call("POST", `/api/budget/${month}/copy-previous?currency=CNY`, {
      expectedRevision: await revisionOf("CNY"),
    });
    expect(copied.status).toBe(200);
    expect(copied.json.groups.flatMap((g) => g.categories).find((c) => c.id === categoryId).assigned).toBe(2_200);
    const sgd = await call("GET", `/api/budget/${month}?currency=SGD`);
    expect(sgd.json.groups.flatMap((g) => g.categories).find((c) => c.id === categoryId).assigned).toBe(3_000);

    await call("PUT", `/api/budget/${month}/category/${otherId}/assign?currency=CNY`, {
      assigned: 500,
      expectedRevision: await revisionOf("CNY"),
    });
    const moved = await call("POST", `/api/budget/${month}/move?currency=CNY`, {
      fromId: categoryId,
      toId: otherId,
      amount: 200,
      expectedRevision: await revisionOf("CNY"),
    });
    expect(moved.status).toBe(200);
    const cats = moved.json.groups.flatMap((g) => g.categories);
    expect(cats.find((c) => c.id === categoryId).assigned).toBe(2_000);
    expect(cats.find((c) => c.id === otherId).assigned).toBe(700);
  });

  it("serves native reports with query currency and top-level currencyCode", async () => {
    const native = await call("GET", "/api/reports/native?currency=CNY&months=12");
    expect(native.status).toBe(200);
    expect(native.json.currencyCode).toBe("CNY");
    expect(native.json.accounts.every((account) => account.currencyCode === "CNY")).toBe(true);
    const sgd = await call("GET", "/api/reports/native?currency=SGD&months=12");
    expect(sgd.json.currencyCode).toBe("SGD");
    expect(sgd.json.accounts.every((account) => account.currencyCode === "SGD")).toBe(true);
  });
});

describe("credit-card virtual assignment targets", () => {
  const cnyCc = createAccount({
    name: "CNY 信用卡",
    type: "creditCard",
    currencyCode: "CNY",
    startingBalance: 0,
  });
  const sgdCc = createAccount({
    name: "SGD 信用卡",
    type: "creditCard",
    currencyCode: "SGD",
    startingBalance: 0,
  });

  it("stores a same-currency credit-card payment assignment", async () => {
    const assigned = await call(
      "PUT",
      `/api/budget/${month}/category/${encodeURIComponent(`cc:${cnyCc}`)}/assign?currency=CNY`,
      { assigned: 800, expectedRevision: await revisionOf("CNY") },
    );
    expect(assigned.status).toBe(200);
    expect(assigned.json.currencyCode).toBe("CNY");
    const row = db
      .prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?")
      .get(month, `cc:${cnyCc}`);
    expect(row.assigned).toBe(800);
    const virtual = assigned.json.groups
      .flatMap((group) => group.categories)
      .find((cat) => cat.id === `cc:${cnyCc}`);
    expect(virtual.assigned).toBe(800);
  });

  it("rejects a cross-currency card target and leaves no CNY assignment behind", async () => {
    const rejected = await call(
      "PUT",
      `/api/budget/${month}/category/${encodeURIComponent(`cc:${sgdCc}`)}/assign?currency=CNY`,
      { assigned: 900, expectedRevision: await revisionOf("CNY") },
    );
    expect(rejected.status).toBe(400);
    expect(rejected.json).toMatchObject({ error: "invalid_assignment_target", code: "invalid_assignment_target" });
    expect(
      db.prepare("SELECT 1 FROM assignments WHERE currency_code='CNY' AND category_id=?").get(`cc:${sgdCc}`)
    ).toBeUndefined();
  });

  it("does not partially debit the source when move or cover targets a foreign-currency card", async () => {
    const sourceBefore = db
      .prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?")
      .get(month, categoryId).assigned;

    const moved = await call("POST", `/api/budget/${month}/move?currency=CNY`, {
      fromId: categoryId,
      toId: `cc:${sgdCc}`,
      amount: 150,
      expectedRevision: await revisionOf("CNY"),
    });
    expect(moved.status).toBe(400);
    expect(moved.json.code).toBe("invalid_assignment_target");
    expect(
      db.prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?").get(month, categoryId)
        .assigned
    ).toBe(sourceBefore);
    expect(
      db.prepare("SELECT 1 FROM assignments WHERE currency_code='CNY' AND category_id=?").get(`cc:${sgdCc}`)
    ).toBeUndefined();

    const covered = await call("POST", `/api/budget/${month}/cover?currency=CNY`, {
      categoryId: `cc:${sgdCc}`,
      fromId: categoryId,
      expectedRevision: await revisionOf("CNY"),
    });
    expect(covered.status).toBe(400);
    expect(covered.json.code).toBe("invalid_assignment_target");
    expect(
      db.prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?").get(month, categoryId)
        .assigned
    ).toBe(sourceBefore);
  });
});
