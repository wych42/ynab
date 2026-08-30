const BUILTIN_CODES = ["CAD", "CNY", "EUR", "GBP", "JPY", "SGD", "USD"];
const DEFAULT_ENABLED_CODES = ["CNY", "EUR", "JPY", "SGD", "USD"];
const TWO_DECIMAL_CODES = ["CAD", "CNY", "EUR", "GBP", "SGD", "USD"];

function expectMoneyError(expect, MoneyError, fn, code) {
  let thrown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MoneyError);
  expect(thrown.code).toBe(code);
  expect(String(thrown.message).length).toBeGreaterThan(0);
}

export function defineMoneyTests({ describe, it, expect, money }) {
  const {
    BUILTIN_CURRENCY_CATALOG,
    MoneyError,
    assertSupportedCurrency,
    convertAmount,
    createMoneyModule,
    enableCurrency,
    formatMoney,
    getExponent,
    isSupportedCurrency,
    listBuiltinCurrencies,
    listDefaultEnabledCurrencies,
    parseAmountToMinor,
  } = money;

  describe("builtin currency catalog", () => {
    it("contains exactly CNY, USD, SGD, CAD, EUR, GBP, and JPY", () => {
      const codes = listBuiltinCurrencies().map((currency) => currency.code).sort();
      expect(codes).toEqual(BUILTIN_CODES);
      expect(BUILTIN_CURRENCY_CATALOG.map((currency) => currency.code).sort()).toEqual(BUILTIN_CODES);
    });

    it("enables CNY, USD, SGD, JPY, and EUR by default", () => {
      const codes = listDefaultEnabledCurrencies().map((currency) => currency.code).sort();
      expect(codes).toEqual(DEFAULT_ENABLED_CODES);
    });

    it("keeps CAD and GBP optional", () => {
      const enabled = new Set(listDefaultEnabledCurrencies().map((currency) => currency.code));
      expect(enabled.has("CAD")).toBe(false);
      expect(enabled.has("GBP")).toBe(false);
      expect(isSupportedCurrency("CAD")).toBe(true);
      expect(isSupportedCurrency("GBP")).toBe(true);
    });

    it("uses 0 decimal places for JPY and 2 for the other six currencies", () => {
      expect(getExponent("JPY")).toBe(0);
      for (const code of TWO_DECIMAL_CODES) {
        expect(getExponent(code)).toBe(2);
      }
    });

    it("returns catalog copies so callers cannot mutate the builtin list", () => {
      const listed = listBuiltinCurrencies();
      listed.pop();
      listed[0].code = "XXX";
      expect(listBuiltinCurrencies()).toHaveLength(7);
      expect(listBuiltinCurrencies().map((currency) => currency.code)).toContain("CNY");
    });
  });

  describe("currency validation", () => {
    it("accepts exact builtin codes", () => {
      for (const code of BUILTIN_CODES) {
        expect(isSupportedCurrency(code)).toBe(true);
        expect(() => assertSupportedCurrency(code)).not.toThrow();
      }
    });

    it("rejects lowercase codes", () => {
      expect(isSupportedCurrency("usd")).toBe(false);
      expectMoneyError(expect, MoneyError, () => assertSupportedCurrency("usd"), "invalid_currency_code");
      expectMoneyError(expect, MoneyError, () => parseAmountToMinor("1.00", "usd"), "invalid_currency_code");
    });

    it("rejects wrong-length codes", () => {
      expect(isSupportedCurrency("US")).toBe(false);
      expect(isSupportedCurrency("USDT")).toBe(false);
      expectMoneyError(expect, MoneyError, () => assertSupportedCurrency("US"), "invalid_currency_code");
      expectMoneyError(expect, MoneyError, () => assertSupportedCurrency("USDT"), "invalid_currency_code");
    });

    it("rejects codes outside the builtin catalog", () => {
      expect(isSupportedCurrency("AUD")).toBe(false);
      expectMoneyError(expect, MoneyError, () => assertSupportedCurrency("AUD"), "unsupported_currency");
      expectMoneyError(expect, MoneyError, () => parseAmountToMinor("10.00", "AUD"), "unsupported_currency");
    });
  });

  describe("amount parsing", () => {
    it("stores CNY 12.34 as 1234", () => {
      expect(parseAmountToMinor("12.34", "CNY")).toBe(1234);
    });

    it("stores USD -0.01 as -1", () => {
      expect(parseAmountToMinor("-0.01", "USD")).toBe(-1);
    });

    it("stores SGD 1,234.50 as 123450", () => {
      expect(parseAmountToMinor("1,234.50", "SGD")).toBe(123450);
    });

    it("stores JPY 123 as 123", () => {
      expect(parseAmountToMinor("123", "JPY")).toBe(123);
    });

    it("rejects JPY 123.4 instead of rounding it", () => {
      expectMoneyError(expect, MoneyError, () => parseAmountToMinor("123.4", "JPY"), "excess_precision");
    });

    it("rejects USD 1.234 instead of dropping the third decimal", () => {
      expectMoneyError(expect, MoneyError, () => parseAmountToMinor("1.234", "USD"), "excess_precision");
    });

    it("rejects results above Number.MAX_SAFE_INTEGER", () => {
      expectMoneyError(
        expect,
        MoneyError,
        () => parseAmountToMinor("90071992547409.92", "CNY"),
        "unsafe_integer",
      );
    });

    it("accepts MAX_SAFE_INTEGER as a JPY amount", () => {
      expect(parseAmountToMinor(String(Number.MAX_SAFE_INTEGER), "JPY")).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("parses amounts with fewer decimal places than the currency exponent", () => {
      expect(parseAmountToMinor("12.3", "CNY")).toBe(1230);
      expect(parseAmountToMinor("12", "USD")).toBe(1200);
    });

    it("parses zero for two-decimal and zero-decimal currencies", () => {
      expect(parseAmountToMinor("0", "JPY")).toBe(0);
      expect(parseAmountToMinor("0.00", "EUR")).toBe(0);
    });

    it("trims whitespace around a decimal amount", () => {
      expect(parseAmountToMinor("  8.50  ", "GBP")).toBe(850);
    });
  });

  describe("amount formatting", () => {
    it("formats JPY 123 in Chinese without decimal places and with a yen marker", () => {
      const formatted = formatMoney(123, "JPY", { locale: "zh-CN" });
      expect(formatted).not.toMatch(/\d[.,]\d/);
      expect(formatted).toMatch(/¥|JPY|日元/);
      expect(formatted).toMatch(/123/);
    });

    it("formats JPY 123 in English without decimal places and with a yen marker", () => {
      const formatted = formatMoney(123, "JPY", { locale: "en-US" });
      expect(formatted).not.toMatch(/\d[.,]\d/);
      expect(formatted).toMatch(/¥|JPY|日元/);
      expect(formatted).toMatch(/123/);
    });

    it("formats SGD minor units with two decimals for an explicit locale", () => {
      const formatted = formatMoney(1234, "SGD", { locale: "en-US" });
      expect(formatted).toMatch(/12\.34/);
      expect(formatted).toMatch(/SGD/);
    });

    it("formats CNY MAX_SAFE_INTEGER minor units without dropping the last digit", () => {
      const formatted = formatMoney(Number.MAX_SAFE_INTEGER, "CNY", { locale: "en-US" });
      expect(formatted).toContain("90,071,992,547,409.91");
    });
  });

  describe("currency conversion", () => {
    it("converts with decimal fixed-point rates and rounds only at the target precision", () => {
      expect(convertAmount({ amountMinor: 100, from: "JPY", to: "CNY", rate: "0.050" })).toBe(500);
      expect(convertAmount({ amountMinor: 10000, from: "USD", to: "CNY", rate: "7.20" })).toBe(72000);
    });

    it("rounds a positive half-unit away from zero", () => {
      expect(convertAmount({ amountMinor: 1, from: "USD", to: "CNY", rate: "7.5" })).toBe(8);
      expect(convertAmount({ amountMinor: 1, from: "USD", to: "JPY", rate: "150" })).toBe(2);
    });

    it("rounds a negative half-unit away from zero", () => {
      expect(convertAmount({ amountMinor: -1, from: "USD", to: "CNY", rate: "7.5" })).toBe(-8);
      expect(convertAmount({ amountMinor: -1, from: "USD", to: "JPY", rate: "150" })).toBe(-2);
    });

    it("keeps zero as zero", () => {
      expect(convertAmount({ amountMinor: 0, from: "USD", to: "CNY", rate: "7.5" })).toBe(0);
    });

    it("rounds values just below and above a half-unit to nearest", () => {
      expect(convertAmount({ amountMinor: 1, from: "USD", to: "CNY", rate: "7.4" })).toBe(7);
      expect(convertAmount({ amountMinor: 1, from: "USD", to: "CNY", rate: "7.6" })).toBe(8);
      expect(convertAmount({ amountMinor: -1, from: "USD", to: "CNY", rate: "7.4" })).toBe(-7);
      expect(convertAmount({ amountMinor: -1, from: "USD", to: "CNY", rate: "7.6" })).toBe(-8);
    });

    it("does not use binary floating-point intermediates", () => {
      expect(convertAmount({ amountMinor: 10, from: "USD", to: "CNY", rate: "0.1" })).toBe(1);
    });

    it("rejects an overflowing conversion", () => {
      expectMoneyError(
        expect,
        MoneyError,
        () => convertAmount({
          amountMinor: Number.MAX_SAFE_INTEGER,
          from: "JPY",
          to: "JPY",
          rate: "2",
        }),
        "unsafe_integer",
      );
    });
  });

  describe("in-memory currency enablement", () => {
    it("enables CAD idempotently without creating a second ledger entry", () => {
      const defaults = listDefaultEnabledCurrencies().map((currency) => currency.code);
      const once = enableCurrency(defaults, "CAD");
      const twice = enableCurrency(once, "CAD");
      expect(twice.filter((code) => code === "CAD")).toEqual(["CAD"]);
      expect(twice).toEqual(once);
    });

    it("can temporarily add AUD to the catalog without a database schema", () => {
      const aud = { code: "AUD", exponent: 2, enabledByDefault: false };
      const extended = createMoneyModule([...BUILTIN_CURRENCY_CATALOG, aud]);
      expect(extended.isSupportedCurrency("AUD")).toBe(true);
      expect(extended.getExponent("AUD")).toBe(2);
      expect(extended.parseAmountToMinor("10.50", "AUD")).toBe(1050);
      expect(isSupportedCurrency("AUD")).toBe(false);
      expect(extended.listBuiltinCurrencies().map((currency) => currency.code).sort()).toEqual(BUILTIN_CODES);
      expect(extended.listCurrencies().map((currency) => currency.code).sort()).toEqual([...BUILTIN_CODES, "AUD"].sort());

      const defaults = extended.listDefaultEnabledCurrencies().map((currency) => currency.code);
      const once = extended.enableCurrency(defaults, "AUD");
      const twice = extended.enableCurrency(once, "AUD");
      expect(twice.filter((code) => code === "AUD")).toEqual(["AUD"]);
      expect(defaults).not.toContain("AUD");
    });
  });
}
