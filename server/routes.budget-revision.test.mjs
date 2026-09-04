import { afterAll, describe, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";

process.env.DATA_DIR = makeTempDataDir("ynab-budget-revision-");

const { api } = await import("./routes.mjs");
const { db, createAccount, currentMonth } = await import("./db.mjs");

const server = await startTestApi(api);
afterAll(() => server.close());

const call = (method, url, body) => server.call(method, url, body);
const MONTH = currentMonth();

function ledgerRevision(code) {
  return db.prepare("SELECT revision FROM currency_ledgers WHERE currency_code=?").get(code).revision;
}

function assignedOf(budget, categoryId) {
  return budget.groups.flatMap((group) => group.categories).find((category) => category.id === categoryId)?.assigned;
}

const spend = db
  .prepare(
    `SELECT c.id FROM categories c
     JOIN category_groups g ON g.id=c.group_id
     WHERE COALESCE(g.is_income,0)=0
     ORDER BY c.sort_order, c.name
     LIMIT 1`
  )
  .get();
const categoryId = spend.id;
const cny = createAccount({ name: "家庭日常", type: "checking", currencyCode: "CNY", startingBalance: 0 });
const sgd = createAccount({ name: "星展日常", type: "checking", currencyCode: "SGD", startingBalance: 500_000 });

describe("GET /api/budget includes ledger and category revisions", () => {
  it("returns revision 0 and categoryRevision 0 on an untouched ledger", async () => {
    const result = await call("GET", `/api/budget/${MONTH}?currency=EUR`);
    expect(result.status).toBe(200);
    expect(result.json.revision).toBe(0);
    expect(typeof result.json.categoryRevision).toBe("number");
    expect(result.json.categoryRevision).toBe(0);
  });
});

describe("budget writes use expectedRevision", () => {
  it("rejects a stale assign with 409 and keeps the first write", async () => {
    const boot = await call("GET", `/api/budget/${MONTH}?currency=CNY`);
    expect(boot.status).toBe(200);
    const expectedRevision = boot.json.revision;
    const first = await call("PUT", `/api/budget/${MONTH}/category/${categoryId}/assign?currency=CNY`, {
      assigned: 1500,
      expectedRevision,
    });
    expect(first.status).toBe(200);
    expect(first.json.revision).toBe(expectedRevision + 1);
    expect(assignedOf(first.json, categoryId)).toBe(1500);
    expect(ledgerRevision("CNY")).toBe(expectedRevision + 1);

    const stale = await call("PUT", `/api/budget/${MONTH}/category/${categoryId}/assign?currency=CNY`, {
      assigned: 9999,
      expectedRevision,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("budget_revision_conflict");
    expect(stale.json.code).not.toBe("currency_migration_required");
    expect(stale.json.error).toBe("budget_revision_conflict");
    expect(stale.json.budget.revision).toBe(expectedRevision + 1);
    expect(assignedOf(stale.json.budget, categoryId)).toBe(1500);
    expect(
      db
        .prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?")
        .get(MONTH, categoryId).assigned
    ).toBe(1500);
  });

  it("does not conflict when another currency ledger is written", async () => {
    const before = ledgerRevision("CNY");
    const sgdAssign = await call("PUT", `/api/budget/${MONTH}/category/${categoryId}/assign?currency=SGD`, {
      assigned: 3000,
      expectedRevision: ledgerRevision("SGD"),
    });
    expect(sgdAssign.status).toBe(200);
    expect(ledgerRevision("CNY")).toBe(before);
    expect(sgdAssign.json.revision).toBe(ledgerRevision("SGD"));
  });
});

describe("page budget writes require expectedRevision", () => {
  const pageWrites = () => [
    ["PUT", `/api/budget/${MONTH}/category/${categoryId}/assign?currency=CNY`, { assigned: 1 }],
    ["POST", `/api/budget/${MONTH}/move?currency=CNY`, { fromId: categoryId, toId: categoryId, amount: 1 }],
    ["POST", `/api/budget/${MONTH}/cover?currency=CNY`, { categoryId, fromId: "rta" }],
    ["POST", `/api/budget/${MONTH}/copy-previous?currency=CNY`, {}],
    ["POST", `/api/budget/${MONTH}/auto-assign?currency=CNY`, {}],
    ["PUT", `/api/goals/${categoryId}?currency=CNY`, { type: "monthly", target: 100 }],
    ["PUT", `/api/goals/${categoryId}?currency=CNY`, { type: null }],
  ];

  it("rejects each page write path when expectedRevision is missing", async () => {
    const assignedBefore = db
      .prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?")
      .get(MONTH, categoryId)?.assigned;
    for (const [method, url, body] of pageWrites()) {
      const result = await call(method, url, body);
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ error: "expected_revision_required", code: "expected_revision_required" });
    }
    expect(
      db
        .prepare("SELECT assigned FROM assignments WHERE currency_code='CNY' AND month=? AND category_id=?")
        .get(MONTH, categoryId)?.assigned
    ).toBe(assignedBefore);
  });

  it("rejects stale copy, auto-assign, move, cover, setGoal and clearGoal with 409", async () => {
    const boot = await call("GET", `/api/budget/${MONTH}?currency=CNY`);
    const expectedRevision = boot.json.revision;
    const first = await call("PUT", `/api/budget/${MONTH}/category/${categoryId}/assign?currency=CNY`, {
      assigned: 1800,
      expectedRevision,
    });
    expect(first.status).toBe(200);
    const stale = expectedRevision;
    const other = boot.json.groups
      .flatMap((group) => group.categories)
      .find((cat) => cat.id !== categoryId && !cat.id.startsWith("cc:"));
    expect(other?.id).toBeTruthy();
    const writes = [
      ["POST", `/api/budget/${MONTH}/copy-previous?currency=CNY`, {}],
      ["POST", `/api/budget/${MONTH}/auto-assign?currency=CNY`, {}],
      ["POST", `/api/budget/${MONTH}/move?currency=CNY`, { fromId: categoryId, toId: other.id, amount: 1 }],
      ["PUT", `/api/goals/${categoryId}?currency=CNY`, { type: "monthly", target: 100 }],
      ["PUT", `/api/goals/${categoryId}?currency=CNY`, { type: null }],
    ];
    for (const [method, url, body] of writes) {
      const result = await call(method, url, { ...body, expectedRevision: stale });
      expect(result.status).toBe(409);
      expect(result.json.code).toBe("budget_revision_conflict");
    }
    expect(assignedOf((await call("GET", `/api/budget/${MONTH}?currency=CNY`)).json, categoryId)).toBe(1800);
  });
});

describe("cross-currency transfers bump both ledgers", () => {
  it("increments CNY and SGD revision together", async () => {
    const cnyBefore = ledgerRevision("CNY");
    const sgdBefore = ledgerRevision("SGD");
    const posted = await call("POST", "/api/transfers", {
      fromId: sgd,
      toId: cny,
      date: `${MONTH}-08`,
      fromAmountMinor: 10_000,
      toAmountMinor: 55_000,
    });
    expect(posted.status).toBe(200);
    expect(ledgerRevision("CNY")).toBe(cnyBefore + 1);
    expect(ledgerRevision("SGD")).toBe(sgdBefore + 1);
  });

  it("does not treat a single number expectedRevision as a skip", async () => {
    const cnyBefore = ledgerRevision("CNY");
    const sgdBefore = ledgerRevision("SGD");
    const posted = await call("POST", "/api/transfers", {
      fromId: sgd,
      toId: cny,
      date: `${MONTH}-09`,
      fromAmountMinor: 10_000,
      toAmountMinor: 55_000,
      expectedRevision: Math.max(cnyBefore, sgdBefore) + 1,
    });
    expect(posted.status).toBe(409);
    expect(posted.json.code).toBe("budget_revision_conflict");
    expect(ledgerRevision("CNY")).toBe(cnyBefore);
    expect(ledgerRevision("SGD")).toBe(sgdBefore);
  });
});

describe("category structure writes use expectedCategoryRevision", () => {
  it("rejects a stale rename and keeps the first name", async () => {
    const boot = await call("GET", `/api/budget/${MONTH}?currency=CNY`);
    expect(boot.status).toBe(200);
    const revision = boot.json.categoryRevision;
    const first = await call("PUT", `/api/categories/${categoryId}`, {
      name: "吃饭",
      expectedCategoryRevision: revision,
    });
    expect(first.status).toBe(200);

    const stale = await call("PUT", `/api/categories/${categoryId}`, {
      name: "过期名",
      expectedCategoryRevision: revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("category_revision_conflict");
    expect(stale.json.code).not.toBe("currency_migration_required");
    expect(db.prepare("SELECT name FROM categories WHERE id=?").get(categoryId).name).toBe("吃饭");
  });
});
