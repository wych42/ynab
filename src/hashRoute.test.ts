// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceEnabledCurrency,
  completeBudgetHash,
  parseHash,
  pushHash,
  replaceHash,
  subscribeHash,
} from "./hashRoute";

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  window.location.hash = "";
});

describe("parseHash", () => {
  it("parses the hash path and query", () => {
    expect(parseHash("#/budget?currency=USD")).toEqual({
      path: "/budget",
      query: { currency: "USD" },
    });
  });

  it("ignores unknown query keys when reading the budget currency", () => {
    const parsed = parseHash("#/budget?currency=SGD&foo=1");
    expect(parsed.path).toBe("/budget");
    expect(parsed.query.currency).toBe("SGD");
    expect(parsed.query.foo).toBe("1");
  });

  it("treats a missing query as an empty object", () => {
    expect(parseHash("#/budget")).toEqual({ path: "/budget", query: {} });
  });
});

describe("replaceHash", () => {
  it("notifies subscribers after replaceState because hashchange does not fire on replace", () => {
    window.location.hash = "#/budget";
    const listener = vi.fn();
    const unsub = subscribeHash(listener);
    const pushSpy = vi.spyOn(history, "pushState");
    const replaceSpy = vi.spyOn(history, "replaceState");

    replaceHash("#/budget?currency=CNY");

    expect(window.location.hash).toBe("#/budget?currency=CNY");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    unsub();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });
});

describe("completeBudgetHash", () => {
  it("replace-completes bare #/budget with the reporting or first enabled currency", () => {
    window.location.hash = "#/budget";
    const pushSpy = vi.spyOn(history, "pushState");
    const result = completeBudgetHash({
      enabledCurrencies: ["CNY", "USD", "SGD"],
      reportingCurrency: "CNY",
      storedCurrency: null,
    });
    expect(result.currency).toBe("CNY");
    expect(result.replaced).toBe(true);
    expect(parseHash(window.location.hash).query.currency).toBe("CNY");
    expect(parseHash(window.location.hash).path).toBe("/budget");
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("replace-completes bare #/budget with the stored enabled currency", () => {
    window.location.hash = "#/budget";
    const result = completeBudgetHash({
      enabledCurrencies: ["CNY", "USD", "SGD"],
      reportingCurrency: "CNY",
      storedCurrency: "SGD",
    });
    expect(result.currency).toBe("SGD");
    expect(result.replaced).toBe(true);
    expect(parseHash(window.location.hash).query.currency).toBe("SGD");
  });

  it("leaves an explicit currency in place and does not treat unknown keys as currency", () => {
    window.location.hash = "#/budget?currency=USD&foo=1";
    const result = completeBudgetHash({
      enabledCurrencies: ["CNY", "USD"],
      reportingCurrency: "CNY",
      storedCurrency: "CNY",
    });
    expect(result.currency).toBe("USD");
    expect(result.replaced).toBe(false);
    expect(parseHash(window.location.hash).query.currency).toBe("USD");
    expect(parseHash(window.location.hash).query.foo).toBe("1");
  });
});

describe("coerceEnabledCurrency", () => {
  it("distinguishes a catalog-disabled code from an unsupported code", () => {
    expect(
      coerceEnabledCurrency("CAD", ["CNY", "USD"], ["CNY", "USD", "CAD", "GBP"], "CNY"),
    ).toEqual({
      currency: "CNY",
      notice: { requested: "CAD", fallback: "CNY", reason: "disabled" },
    });
    expect(
      coerceEnabledCurrency("XXX", ["CNY", "USD"], ["CNY", "USD", "CAD", "GBP"], "CNY"),
    ).toEqual({
      currency: "CNY",
      notice: { requested: "XXX", fallback: "CNY", reason: "unsupported" },
    });
  });
});

describe("completeBudgetHash fallback", () => {
  it("replaces a disabled currency without pushing history", () => {
    window.location.hash = "#/budget?currency=CAD";
    const pushSpy = vi.spyOn(history, "pushState");
    const result = completeBudgetHash({
      enabledCurrencies: ["CNY", "USD"],
      supportedCurrencies: ["CNY", "USD", "CAD", "GBP"],
      reportingCurrency: "CNY",
      storedCurrency: null,
    });
    expect(result.notice?.reason).toBe("disabled");
    expect(result.replaced).toBe(true);
    expect(parseHash(window.location.hash).query.currency).toBe("CNY");
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });
});

describe("pushHash", () => {
  it("assigns location.hash so the browser records a history entry", () => {
    window.location.hash = "#/budget?currency=CNY";
    const listener = vi.fn();
    const unsub = subscribeHash(listener);
    pushHash("#/budget?currency=SGD");
    expect(window.location.hash).toBe("#/budget?currency=SGD");
    expect(listener).toHaveBeenCalled();
    unsub();
  });
});
