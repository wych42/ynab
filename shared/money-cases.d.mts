import type * as Money from "./money.mjs";

export function defineMoneyTests(t: {
  describe: typeof import("vitest").describe;
  it: typeof import("vitest").it;
  expect: typeof import("vitest").expect;
  money: typeof Money;
}): void;
