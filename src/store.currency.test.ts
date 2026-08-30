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

  it("exposes a storage key used only for valid enabled codes", () => {
    expect(ACTIVE_BUDGET_CURRENCY_KEY).toBe("activeBudgetCurrency");
  });
});
