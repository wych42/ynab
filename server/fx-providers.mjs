import { Decimal } from "decimal.js";
import { MoneyError, assertSupportedCurrency } from "./money.mjs";

export const DEFAULT_FX_PROVIDER_ID = "frankfurter_ecb";
export const FRANKFURTER_ECB_SOURCE = "frankfurter_ecb";
export const FRANKFURTER_DEFAULT_BASE_URL = "https://api.frankfurter.dev";
export const MANUAL_FX_SOURCE = "manual";
export const IDENTITY_FX_SOURCE = "identity";
export const DEFAULT_FX_TIMEOUT_MS = 8000;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_SHAPE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class FxProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FxProviderError";
    this.code = code;
    this.details = details;
  }
}

export function parseYmd(value, ErrorType = FxProviderError, code = "fx_provider_invalid_request") {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) {
    throw new ErrorType(code, "date must be YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ErrorType(code, "date must be a real calendar day");
  }
  return value;
}

export function assertFetchRequest({ base, quotes, fromDate, toDate }) {
  assertSupportedCurrency(base);
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new FxProviderError("fx_provider_invalid_request", "quotes must be a non-empty array");
  }
  for (const quote of quotes) assertSupportedCurrency(quote);
  parseYmd(fromDate);
  parseYmd(toDate);
  if (fromDate > toDate) {
    throw new FxProviderError("fx_provider_invalid_request", "fromDate must be on or before toDate");
  }
}

function rateToString(value) {
  if (typeof value === "string") {
    if (!RATE_SHAPE.test(value) || new Decimal(value).lte(0)) {
      throw new FxProviderError("fx_provider_invalid_rate", "rate must be a positive decimal");
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const asString = new Decimal(value).toFixed();
    if (!RATE_SHAPE.test(asString) || new Decimal(asString).lte(0)) {
      throw new FxProviderError("fx_provider_invalid_rate", "rate must be a positive decimal");
    }
    return asString;
  }
  throw new FxProviderError("fx_provider_invalid_rate", "rate must be a positive decimal");
}

function readRawItem(item) {
  if (!item || typeof item !== "object") {
    throw new FxProviderError("fx_provider_invalid_response", "rate item must be an object");
  }
  return {
    rateDate: item.rateDate ?? item.date,
    baseCurrency: item.baseCurrency ?? item.base,
    quoteCurrency: item.quoteCurrency ?? item.quote,
    rate: item.rate,
  };
}

export function normalizeProviderRecords(raw, request, source) {
  if (source === MANUAL_FX_SOURCE || source === IDENTITY_FX_SOURCE) {
    throw new FxProviderError("fx_provider_invalid_request", "automatic providers cannot use a reserved source");
  }
  if (!Array.isArray(raw)) {
    throw new FxProviderError("fx_provider_invalid_response", "provider response must be an array");
  }
  if (raw.length === 0) {
    throw new FxProviderError("fx_provider_empty_result", "provider returned no rates");
  }

  const quoteSet = new Set(request.quotes);
  const records = [];
  for (const item of raw) {
    const parsed = readRawItem(item);
    if (
      typeof parsed.rateDate !== "string" ||
      typeof parsed.baseCurrency !== "string" ||
      typeof parsed.quoteCurrency !== "string"
    ) {
      throw new FxProviderError("fx_provider_invalid_response", "provider rate is missing fields");
    }
    parseYmd(parsed.rateDate, FxProviderError, "fx_provider_invalid_response");
    if (parsed.rateDate > request.toDate) {
      throw new FxProviderError("fx_provider_future_rate", "provider returned a rate after the requested range");
    }
    rateToString(parsed.rate);
    if (parsed.rateDate < request.fromDate) continue;
    if (parsed.baseCurrency !== request.base) continue;
    if (!quoteSet.has(parsed.quoteCurrency)) continue;
    assertSupportedCurrency(parsed.baseCurrency);
    assertSupportedCurrency(parsed.quoteCurrency);
    records.push(
      Object.freeze({
        rateDate: parsed.rateDate,
        baseCurrency: parsed.baseCurrency,
        quoteCurrency: parsed.quoteCurrency,
        rate: rateToString(parsed.rate),
        source,
      }),
    );
  }
  if (records.length === 0) {
    throw new FxProviderError("fx_provider_empty_result", "provider returned no rates");
  }
  return records;
}

function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

export async function withTimeout(work, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const workPromise = Promise.resolve().then(() => work(controller.signal));
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(abortError());
      }, timeoutMs);
      workPromise.then(resolve, reject);
    });
  } catch (err) {
    if (controller.signal.aborted || err?.name === "AbortError") {
      throw new FxProviderError("fx_provider_timeout", "fx provider timed out");
    }
    if (err instanceof FxProviderError || err instanceof MoneyError) throw err;
    throw new FxProviderError("fx_provider_network_error", "fx provider network error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toProviderError(failure) {
  if (failure instanceof FxProviderError) return failure;
  if (failure && typeof failure.code === "string" && failure.code.startsWith("fx_provider_")) {
    return new FxProviderError(failure.code, failure.message ?? failure.code);
  }
  if (failure instanceof Error) {
    return new FxProviderError("fx_provider_network_error", "fx provider network error");
  }
  return new FxProviderError(
    failure?.code ?? "fx_provider_invalid_request",
    failure?.message ?? "fx provider request failed",
  );
}

export function createInMemoryFxAdapter({
  records = [],
  source = "in_memory",
  failure = null,
  rawResult,
  throwRaw = null,
  timeoutMs = DEFAULT_FX_TIMEOUT_MS,
  delayMs = 0,
} = {}) {
  if (source === MANUAL_FX_SOURCE || source === IDENTITY_FX_SOURCE) {
    throw new FxProviderError("fx_provider_invalid_request", "automatic providers cannot use a reserved source");
  }
  let currentRecords = records.slice();
  let currentFailure = failure;
  let currentRaw = rawResult;
  let currentThrowRaw = throwRaw;
  const calls = [];

  return {
    source,
    calls,
    setRecords(next) {
      currentRecords = (next ?? []).slice();
    },
    setFailure(next) {
      currentFailure = next;
    },
    setRawResult(next) {
      currentRaw = next;
    },
    async fetchRates(input) {
      assertFetchRequest(input);
      calls.push({ base: input.base, quotes: [...input.quotes], fromDate: input.fromDate, toDate: input.toDate });
      if (currentFailure) throw toProviderError(currentFailure);
      return withTimeout(async (signal) => {
        if (currentThrowRaw) throw currentThrowRaw;
        if (delayMs > 0) await sleepWithAbort(delayMs, signal);
        const raw =
          currentRaw !== undefined
            ? currentRaw
            : currentRecords.map((row) => ({
                date: row.rateDate,
                base: row.baseCurrency,
                quote: row.quoteCurrency,
                rate: row.rate,
              }));
        return normalizeProviderRecords(raw, input, source);
      }, timeoutMs);
    },
  };
}

export function createFrankfurterEcbAdapter({
  fetchImpl = globalThis.fetch.bind(globalThis),
  baseUrl = FRANKFURTER_DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_FX_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new FxProviderError("fx_provider_invalid_request", "fetchImpl is required");
  }
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return {
    source: FRANKFURTER_ECB_SOURCE,
    async fetchRates(input) {
      assertFetchRequest(input);
      const url = new URL("v2/rates", root);
      url.searchParams.set("base", input.base);
      url.searchParams.set("quotes", input.quotes.join(","));
      url.searchParams.set("from", input.fromDate);
      url.searchParams.set("to", input.toDate);
      url.searchParams.set("providers", "ECB");

      const json = await withTimeout(async (signal) => {
        let response;
        try {
          response = await fetchImpl(url.toString(), { method: "GET", signal });
        } catch (err) {
          if (err?.name === "AbortError" || signal.aborted) {
            throw new FxProviderError("fx_provider_timeout", "fx provider timed out");
          }
          if (err instanceof FxProviderError || err instanceof MoneyError) throw err;
          throw new FxProviderError("fx_provider_network_error", "fx provider network error");
        }
        if (!response || typeof response.status !== "number") {
          throw new FxProviderError("fx_provider_invalid_response", "provider returned no HTTP response");
        }
        if (response.status < 200 || response.status >= 300) {
          throw new FxProviderError("fx_provider_http_error", `fx provider HTTP ${response.status}`);
        }
        try {
          return await response.json();
        } catch {
          throw new FxProviderError("fx_provider_invalid_response", "provider returned invalid JSON");
        }
      }, timeoutMs);

      return normalizeProviderRecords(json, input, FRANKFURTER_ECB_SOURCE);
    },
  };
}

const registry = new Map();
let defaultProviderId = DEFAULT_FX_PROVIDER_ID;

export function registerFxProvider(id, factoryOrAdapter) {
  if (!id || typeof id !== "string") {
    throw new FxProviderError("fx_provider_invalid_request", "provider id is required");
  }
  if (id === MANUAL_FX_SOURCE || id === IDENTITY_FX_SOURCE) {
    throw new FxProviderError("fx_provider_invalid_request", `${id} is a reserved source`);
  }
  registry.set(id, factoryOrAdapter);
}

export function getDefaultFxProviderId() {
  return defaultProviderId;
}

export function setDefaultFxProviderId(id) {
  if (!registry.has(id)) {
    throw new FxProviderError("fx_provider_invalid_request", `unknown fx provider ${id}`);
  }
  defaultProviderId = id;
}

export function getFxProvider(id = defaultProviderId, opts = {}) {
  const entry = registry.get(id);
  if (!entry) {
    throw new FxProviderError("fx_provider_invalid_request", `unknown fx provider ${id}`);
  }
  return typeof entry === "function" ? entry(opts) : entry;
}

registerFxProvider(DEFAULT_FX_PROVIDER_ID, (opts) => createFrankfurterEcbAdapter(opts));
