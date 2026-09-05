import { expect, it, vi } from "vitest";
import { writeArguments } from "./writeContext";
it("uses the revision captured by the read, including both transfer legs", () => {
  const read = { ledgerRevisions: { CNY: 2, SGD: 7 }, categoryRevision: 3 };
  expect(writeArguments("createTx", [{ accountId: "a", amount: 10 }], read)).toEqual([{ accountId: "a", amount: 10, expectedRevision: { CNY: 2, SGD: 7 } }]);
  expect(writeArguments("renameCategory", ["cat", "Food"], read)).toEqual(["cat", "Food", 3]);
  expect(writeArguments("assign", ["2026-09", "cat", 100, "SGD", 1], read)).toEqual(["2026-09", "cat", 100, "SGD", 1]);
});
it("only replaces a budget revision after an explicit conflict retry", () => {
  expect(writeArguments("assign", ["2026-09", "cat", 100, "SGD", 1], { ledgerRevisions: { SGD: 7 } }, true)[4]).toBe(7);
});
