import { beforeEach, describe, expect, it } from "vitest";
import { defineMoneyTests } from "../shared/money-cases.mjs";
import { fmtMoney, setCurrencySymbol } from "./format";
import * as money from "./money";

defineMoneyTests({ describe, it, expect, money });

describe("fmtMoney compatibility boundary", () => {
  beforeEach(() => {
    setCurrencySymbol("¥");
  });

  it("keeps the legacy 2-decimal global-symbol path when currencyCode is omitted", () => {
    expect(fmtMoney(123)).toBe("¥1.23");
    expect(fmtMoney(123456)).toBe("¥1,234.56");
  });

  it("formats through the money module when currencyCode is provided", () => {
    expect(fmtMoney(123, { currencyCode: "JPY", locale: "en-US" })).toBe("¥123");
    expect(fmtMoney(1234, { currencyCode: "SGD", locale: "en-US" })).toMatch(/12\.34/);
  });
});
