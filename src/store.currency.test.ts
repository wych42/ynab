import { describe, expect, it } from "vitest";
import { ACTIVE_BUDGET_CURRENCY_KEY, resolveActiveBudgetCurrency } from "./activeCurrency";

describe("resolveActiveBudgetCurrency", () => {
  it("prefers a stored enabled code, then reporting currency, then the first enabled ledger", () => {
    expect(resolveActiveBudgetCurrency(["CNY", "USD", "SGD"], "USD", "SGD")).toBe("SGD");
    expect(resolveActiveBudgetCurrency(["CNY", "USD", "SGD"], "USD", null)).toBe("USD");
    expect(resolveActiveBudgetCurrency(["CNY", "USD", "SGD"], null, null)).toBe("CNY");
  });

  it("does not keep a stored or reporting code that is not enabled", () => {
    expect(resolveActiveBudgetCurrency(["CNY", "SGD"], "GBP", "USD")).toBe("CNY");
    expect(resolveActiveBudgetCurrency(["JPY"], "CNY", "CNY")).toBe("JPY");
    expect(resolveActiveBudgetCurrency([], "CNY", "CNY")).toBeNull();
  });
});

describe("activeBudgetCurrency storage is fallback-only", () => {
  it("keeps the storage key name and never treats a disabled stored value as the page currency", () => {
    expect(ACTIVE_BUDGET_CURRENCY_KEY).toBe("activeBudgetCurrency");
    // Disabled stored USD is not page state; bare-budget URL fallback uses reporting/default CNY.
    expect(resolveActiveBudgetCurrency(["CNY", "SGD"], "CNY", "USD")).toBe("CNY");
    expect(resolveActiveBudgetCurrency(["CNY", "SGD"], "USD", "GBP")).toBe("CNY");
  });
});
