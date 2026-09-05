import { expect, it, vi } from "vitest";
import { snapshotClient } from "./snapshot-client.mjs";
it("reads a fresh snapshot for each ordinary write and keeps the raw client untouched", async () => {
  let revision = 2;
  const raw = vi.fn(async (method, url, body) => url === "/api/bootstrap" ? { status: 200, json: { ledgerRevisions: { CNY: revision++ }, categoryRevision: 7 } } : { status: 200, json: body });
  const call = snapshotClient(raw);
  expect((await call("POST", "/api/transactions", { amount: 1 })).json.expectedRevision).toEqual({ CNY: 2 });
  expect((await call("DELETE", "/api/accounts/a")).json.expectedRevision).toEqual({ CNY: 3 });
  expect((await call("PUT", "/api/categories/a", { note: "n" })).json.expectedCategoryRevision).toBe(7);
  expect((await raw("POST", "/api/transactions", {})).json).toEqual({});
});
it.each([undefined, null, 0, { CNY: 1 }])("preserves explicitly supplied revision %s", async expectedRevision => {
  const raw = vi.fn(async (_method, _url, body) => ({ status: 200, json: body }));
  const body = { expectedRevision };
  await snapshotClient(raw)("POST", "/api/transactions", body);
  expect(raw).toHaveBeenCalledTimes(1);
  expect(raw).toHaveBeenCalledWith("POST", "/api/transactions", body);
});
it("does not change reads, unrelated writes, explicit category versions or malformed bodies", async () => {
  const raw = vi.fn(async (_method, _url, body) => ({ status: 200, json: body }));
  const call = snapshotClient(raw);
  for (const [method, url, body] of [["GET", "/api/accounts"], ["PUT", "/api/settings", {}], ["POST", "/api/transactions", null], ["POST", "/api/transactions", []], ["PUT", "/api/categories/a", { expectedCategoryRevision: undefined }]]) {
    raw.mockClear();
    await call(method, url, body);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw).toHaveBeenCalledWith(method, url, body);
  }
});
