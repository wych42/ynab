export type CurrencyRecord = {
  code: string;
  exponent: number;
  enabledByDefault: boolean;
};

export type FormatMoneyOptions = {
  locale?: string;
};

export type ConvertAmountInput = {
  amountMinor: number;
  from: string;
  to: string;
  rate: string;
};

export class MoneyError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export type MoneyModule = {
  catalog: readonly CurrencyRecord[];
  listCurrencies(): CurrencyRecord[];
  listBuiltinCurrencies(): CurrencyRecord[];
  listDefaultEnabledCurrencies(): CurrencyRecord[];
  isSupportedCurrency(code: unknown): boolean;
  assertSupportedCurrency(code: unknown): asserts code is string;
  getCurrency(code: string): CurrencyRecord;
  getExponent(code: string): number;
  parseAmountToMinor(input: string, currencyCode: string): number;
  formatMoney(amountMinor: number, currencyCode: string, options?: FormatMoneyOptions): string;
  convertAmount(input: ConvertAmountInput): number;
  enableCurrency(currentlyEnabled: readonly string[], code: string): string[];
};

export const BUILTIN_CURRENCY_CATALOG: readonly CurrencyRecord[];

export function createMoneyModule(catalog?: readonly CurrencyRecord[]): MoneyModule;
export function listCurrencies(): CurrencyRecord[];
export function listBuiltinCurrencies(): CurrencyRecord[];
export function listDefaultEnabledCurrencies(): CurrencyRecord[];
export function isSupportedCurrency(code: unknown): boolean;
export function assertSupportedCurrency(code: unknown): asserts code is string;
export function getCurrency(code: string): CurrencyRecord;
export function getExponent(code: string): number;
export function parseAmountToMinor(input: string, currencyCode: string): number;
export function formatMoney(amountMinor: number, currencyCode: string, options?: FormatMoneyOptions): string;
export function convertAmount(input: ConvertAmountInput): number;
export function enableCurrency(currentlyEnabled: readonly string[], code: string): string[];
