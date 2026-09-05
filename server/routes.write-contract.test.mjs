import { afterAll, expect, it } from "vitest";
import { makeTempDataDir } from "./test-support/database.mjs";
import { startTestApi } from "./test-support/http.mjs";
process.env.DATA_DIR = makeTempDataDir("write-contract-");
const { api } = await import("./routes.mjs");
const { db, createAccount } = await import("./db.mjs");
const { postTransaction } = await import("./currency-ledger.mjs");
const server = await startTestApi(api);
afterAll(() => server.close());
const cny = createAccount({ name: "CNY", type: "checking", currencyCode: "CNY", startingBalance: 10000 });
const sgd = createAccount({ name: "SGD", type: "checking", currencyCode: "SGD", startingBalance: 10000 });
const tx = postTransaction(db, { accountId: cny, date: "2026-09-01", amount: -100, payeeName: "shop" });
it("returns read-time ledger and category revisions on bootstrap and registers", async () => {
  for (const url of ["/api/bootstrap", `/api/accounts/${cny}/transactions`, "/api/transactions"]) {
    const r = await server.call("GET", url);
    expect(r.json.ledgerRevisions).toMatchObject({ CNY: expect.any(Number), SGD: expect.any(Number) });
    expect(r.json.categoryRevision).toEqual(expect.any(Number));
  }
});
it("rejects missing versions on account, transaction and category writes", async () => {
  for (const [method, url, body] of [
    ["POST", "/api/accounts", { name: "new", type: "checking", currencyCode: "CNY" }],
    ["PUT", `/api/accounts/${cny}`, { closed: true }],
    ["DELETE", `/api/accounts/${sgd}`, {}],
    ["POST", "/api/transactions", { accountId: cny, amount: 500, date: "2026-09-01" }],
    ["DELETE", `/api/transactions/${tx.id}`, {}],
    ["POST", `/api/reconcile/${cny}`, { statementBalance: 100 }],
    ["POST", "/api/category-groups", { name: "new group" }],
  ]) {
    const r = await server.call(method, url, body);
    expect(r.status, url).toBe(400);
    expect(r.json.code, url).toMatch(/expected_.*revision_required/);
  }
});
it("filters currency before pagination and count", async () => {
  postTransaction(db, { accountId: sgd, date: "2026-09-01", amount: -50, payeeName: "SG shop" });
  const r = await server.call("GET", "/api/transactions?currency=SGD&limit=1");
  expect(r.json.total).toBe(1);
  expect(r.json.transactions.map(t => t.currencyCode)).toEqual(["SGD"]);
});
it("rejects incomplete cross-currency versions before changing either ledger", async () => {
  const boot = (await server.call("GET", "/api/bootstrap")).json;
  const r = await server.call("POST", "/api/transfers", { fromId: cny, toId: sgd, date: "2026-09-01", fromAmountMinor: 100, toAmountMinor: 20, expectedRevision: { CNY: boot.ledgerRevisions.CNY } });
  expect(r.status).toBe(400);
  expect((await server.call("GET", "/api/bootstrap")).json.ledgerRevisions).toEqual(boot.ledgerRevisions);
});
it("rolls back an account rename when closing the indebted card fails", async () => {
  const card = createAccount({ name: "Card", type: "creditCard", currencyCode: "CNY", startingBalance: -1000 });
  const boot = (await server.call("GET", "/api/bootstrap")).json;
  const r = await server.call("PUT", `/api/accounts/${card}`, { name: "Must roll back", closed: true, expectedRevision: boot.ledgerRevisions });
  expect(r.status).toBe(400);
  expect(db.prepare("SELECT name FROM accounts WHERE id=?").get(card).name).toBe("Card");
  expect((await server.call("GET", "/api/bootstrap")).json.ledgerRevisions).toEqual(boot.ledgerRevisions);
});
it("moves an empty account between ledger read models atomically", async () => {
  const empty = createAccount({ name: "Empty", type: "cash", currencyCode: "CNY", startingBalance: 0 });
  const boot = (await server.call("GET", "/api/bootstrap")).json;
  const r = await server.call("PUT", `/api/accounts/${empty}`, { currencyCode: "SGD", expectedRevision: boot.ledgerRevisions });
  expect(r.status).toBe(200);
  const after = (await server.call("GET", "/api/bootstrap")).json;
  expect(after.ledgerRevisions.CNY).toBe(boot.ledgerRevisions.CNY + 1);
  expect(after.ledgerRevisions.SGD).toBe(boot.ledgerRevisions.SGD + 1);
});
it("returns fresh shared structure on stale rename and bumps all ledger read models", async () => {
  const boot = (await server.call("GET", "/api/bootstrap")).json;
  const r = await server.call("POST", "/api/category-groups", { name: "Shared", expectedCategoryRevision: boot.categoryRevision });
  expect(r.status).toBe(200);
  const stale = await server.call("PUT", `/api/category-groups/${r.json.id}`, { name: "Stale", expectedCategoryRevision: boot.categoryRevision });
  expect(stale.status).toBe(409);
  expect(stale.json.groups.find(g => g.id === r.json.id).name).toBe("Shared");
  expect(stale.json.ledgerRevisions.CNY).toBe(boot.ledgerRevisions.CNY + 1);
});
