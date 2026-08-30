import { Decimal } from "decimal.js";
import { BUILTIN_CURRENCY_CATALOG as RAW_CATALOG } from "./currency-catalog.mjs";

export const BUILTIN_CURRENCY_CATALOG = RAW_CATALOG;

const CODE_SHAPE = /^[A-Z]{3}$/;
const AMOUNT_SHAPE = /^-?\d+(?:\.\d+)?$/;
const RATE_SHAPE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class MoneyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

function copyCurrency(currency) {
  return {
    code: currency.code,
    exponent: currency.exponent,
    enabledByDefault: Boolean(currency.enabledByDefault),
  };
}

function fractionDigits(normalized) {
  const dot = normalized.indexOf(".");
  return dot === -1 ? 0 : normalized.length - dot - 1;
}

function assertSafeInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new MoneyError("invalid_amount", `${label} must be a safe integer`);
  }
}

function decimalToSafeInteger(value, label) {
  if (!value.isFinite() || !value.isInteger()) {
    throw new MoneyError("invalid_amount", `${label} must be an integer`);
  }
  if (value.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError("unsafe_integer", `${label} exceeds Number.MAX_SAFE_INTEGER`);
  }
  const asNumber = value.toNumber();
  if (!Number.isSafeInteger(asNumber)) {
    throw new MoneyError("unsafe_integer", `${label} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return asNumber;
}

export function createMoneyModule(catalog = BUILTIN_CURRENCY_CATALOG) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new MoneyError("invalid_catalog", "currency catalog must be a non-empty array");
  }

  const records = [];
  const byCode = new Map();
  for (const entry of catalog) {
    if (!entry || typeof entry.code !== "string" || !CODE_SHAPE.test(entry.code)) {
      throw new MoneyError("invalid_catalog", "catalog entries need a 3-letter uppercase code");
    }
    if (!Number.isInteger(entry.exponent) || entry.exponent < 0) {
      throw new MoneyError("invalid_catalog", `${entry.code} exponent must be a non-negative integer`);
    }
    if (byCode.has(entry.code)) {
      throw new MoneyError("invalid_catalog", `duplicate currency code ${entry.code}`);
    }
    const record = Object.freeze(copyCurrency(entry));
    records.push(record);
    byCode.set(record.code, record);
  }
  Object.freeze(records);

  function getCurrency(code) {
    assertSupportedCurrency(code);
    return copyCurrency(byCode.get(code));
  }

  function isSupportedCurrency(code) {
    return typeof code === "string" && byCode.has(code);
  }

  function assertSupportedCurrency(code) {
    if (typeof code !== "string" || !CODE_SHAPE.test(code)) {
      throw new MoneyError("invalid_currency_code", "currency code must be 3 uppercase letters");
    }
    if (!byCode.has(code)) {
      throw new MoneyError("unsupported_currency", `${code} is not in the currency catalog`);
    }
  }

  function getExponent(code) {
    return getCurrency(code).exponent;
  }

  function listCurrencies() {
    return records.map(copyCurrency);
  }

  function listDefaultEnabledCurrencies() {
    return records.filter((currency) => currency.enabledByDefault).map(copyCurrency);
  }

  function parseAmountToMinor(input, currencyCode) {
    const exponent = getExponent(currencyCode);
    if (typeof input !== "string") {
      throw new MoneyError("invalid_amount", "amount must be a decimal string");
    }
    const normalized = input.trim().replace(/[,，\s]/g, "").replace(/^\+/, "");
    if (!AMOUNT_SHAPE.test(normalized)) {
      throw new MoneyError("invalid_amount", "amount must be a decimal number");
    }
    if (fractionDigits(normalized) > exponent) {
      throw new MoneyError("excess_precision", `${currencyCode} allows at most ${exponent} decimal places`);
    }
    const minor = new Decimal(normalized).times(new Decimal(10).pow(exponent));
    return decimalToSafeInteger(minor, "amount");
  }

  function formatMoney(amountMinor, currencyCode, options = {}) {
    const exponent = getExponent(currencyCode);
    assertSafeInteger(amountMinor, "amount");
    const locale = options.locale;
    const negative = amountMinor < 0;
    const absMinor = BigInt(negative ? -amountMinor : amountMinor);
    const scale = 10n ** BigInt(exponent);
    const absInteger = absMinor / scale;
    const absFraction = absMinor % scale;

    const currencyFormatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    });
    const grouping = currencyFormatter.resolvedOptions().useGrouping;
    const groupedInteger = new Intl.NumberFormat(locale, {
      useGrouping: grouping,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(absInteger);
    const fractionDigits = exponent === 0
      ? ""
      : new Intl.NumberFormat(locale, {
        useGrouping: false,
        minimumIntegerDigits: exponent,
        maximumFractionDigits: 0,
      }).format(absFraction);

    let integerReplaced = false;
    return currencyFormatter.formatToParts(negative ? -1 : 1).map((part) => {
      if (part.type === "integer") {
        if (integerReplaced) return "";
        integerReplaced = true;
        return groupedInteger;
      }
      if (part.type === "group") return "";
      if (part.type === "fraction") return fractionDigits;
      return part.value;
    }).join("");
  }

  function convertAmount({ amountMinor, from, to, rate }) {
    const fromExp = getExponent(from);
    const toExp = getExponent(to);
    assertSafeInteger(amountMinor, "amount");
    if (typeof rate !== "string" || !RATE_SHAPE.test(rate) || new Decimal(rate).lte(0)) {
      throw new MoneyError("invalid_rate", "rate must be a positive decimal string");
    }
    const converted = new Decimal(amountMinor)
      .times(rate)
      .times(new Decimal(10).pow(toExp - fromExp))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return decimalToSafeInteger(converted, "converted amount");
  }

  function enableCurrency(currentlyEnabled, code) {
    assertSupportedCurrency(code);
    if (!Array.isArray(currentlyEnabled)) {
      throw new MoneyError("invalid_enabled_list", "enabled currencies must be an array of codes");
    }
    const next = [];
    const seen = new Set();
    for (const item of currentlyEnabled) {
      assertSupportedCurrency(item);
      if (seen.has(item)) continue;
      seen.add(item);
      next.push(item);
    }
    if (!seen.has(code)) next.push(code);
    return next;
  }

  return {
    catalog: records,
    listCurrencies,
    listBuiltinCurrencies() {
      return BUILTIN_CURRENCY_CATALOG.map(copyCurrency);
    },
    listDefaultEnabledCurrencies,
    isSupportedCurrency,
    assertSupportedCurrency,
    getCurrency,
    getExponent,
    parseAmountToMinor,
    formatMoney,
    convertAmount,
    enableCurrency,
  };
}

const builtin = createMoneyModule(BUILTIN_CURRENCY_CATALOG);

export const listCurrencies = builtin.listCurrencies;
export const listBuiltinCurrencies = builtin.listCurrencies;
export const listDefaultEnabledCurrencies = builtin.listDefaultEnabledCurrencies;
export const isSupportedCurrency = builtin.isSupportedCurrency;
export const assertSupportedCurrency = builtin.assertSupportedCurrency;
export const getCurrency = builtin.getCurrency;
export const getExponent = builtin.getExponent;
export const parseAmountToMinor = builtin.parseAmountToMinor;
export const formatMoney = builtin.formatMoney;
export const convertAmount = builtin.convertAmount;
export const enableCurrency = builtin.enableCurrency;
