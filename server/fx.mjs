import { Decimal } from "decimal.js";
import { MoneyError, assertSupportedCurrency, convertAmount } from "./money.mjs";
import { getCurrencyBootstrapState, listEnabledCurrencyCodes } from "./currency-state.mjs";
import {
  DEFAULT_FX_PROVIDER_ID,
  DEFAULT_FX_TIMEOUT_MS,
  FRANKFURTER_DEFAULT_BASE_URL,
  FRANKFURTER_ECB_SOURCE,
  FxProviderError,
  IDENTITY_FX_SOURCE,
  MANUAL_FX_SOURCE,
  createFrankfurterEcbAdapter,
  createInMemoryFxAdapter,
  getDefaultFxProviderId,
  getFxProvider,
  parseYmd,
  registerFxProvider,
  setDefaultFxProviderId,
} from "./fx-providers.mjs";

export {
  DEFAULT_FX_PROVIDER_ID,
  DEFAULT_FX_TIMEOUT_MS,
  FRANKFURTER_DEFAULT_BASE_URL,
  FRANKFURTER_ECB_SOURCE,
  FxProviderError,
  IDENTITY_FX_SOURCE,
  MANUAL_FX_SOURCE,
  createFrankfurterEcbAdapter,
  createInMemoryFxAdapter,
  getDefaultFxProviderId,
  getFxProvider,
  registerFxProvider,
  setDefaultFxProviderId,
};

const RATE_SHAPE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SOURCE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;
const EUR = "EUR";
const LOOKBACK_DAYS = 14;

export class FxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FxError";
    this.code = code;
  }
}

export function isFxError(error) {
  return error instanceof FxError || error instanceof FxProviderError || error instanceof MoneyError;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function utcNowIso() {
  return new Date().toISOString();
}

export function addUtcDays(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function uniqueCodes(codes) {
  const out = [];
  const seen = new Set();
  for (const code of codes) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function invertRate(rate) {
  return new Decimal(1).div(rate).toFixed();
}

function preferSource(rows) {
  return rows.find((row) => row.source === MANUAL_FX_SOURCE) ?? rows[0];
}

function missingResult(base, quote, requestedDate, reason) {
  return {
    ok: false,
    missing: { base, quote, requestedDate, reason },
  };
}

function successResult({ from, to, asOfDate, rate, rateDate, source, path }) {
  return { ok: true, from, to, asOfDate, rate, rateDate, source, path };
}

function pickDirect(rows, from, to) {
  const found = rows.filter((row) => row.base_currency === from && row.quote_currency === to);
  if (!found.length) return null;
  const picked = preferSource(found);
  return { rate: picked.rate, source: picked.source, path: "direct" };
}

function pickInverse(rows, from, to) {
  const found = rows.filter((row) => row.base_currency === to && row.quote_currency === from);
  if (!found.length) return null;
  const picked = preferSource(found);
  return { rate: invertRate(picked.rate), source: picked.source, path: "inverse" };
}

function pickDirected(rows, from, to) {
  return pickDirect(rows, from, to) ?? pickInverse(rows, from, to);
}

function pickEurCross(rows, from, to) {
  if (from === EUR || to === EUR) return null;
  const fromToEur = pickDirected(rows, from, EUR);
  const eurToQuote = pickDirected(rows, EUR, to);
  if (!fromToEur || !eurToQuote) return null;
  const rate = new Decimal(fromToEur.rate).mul(eurToQuote.rate);
  if (!rate.isFinite() || rate.lte(0)) return null;
  const source =
    fromToEur.source === MANUAL_FX_SOURCE || eurToQuote.source === MANUAL_FX_SOURCE
      ? MANUAL_FX_SOURCE
      : fromToEur.source;
  return { rate: rate.toFixed(), source, path: "eur_cross" };
}

function selectOnDate(rows, from, to) {
  return pickDirect(rows, from, to) ?? pickInverse(rows, from, to) ?? pickEurCross(rows, from, to);
}

function wrapProviderFailure(err) {
  if (err instanceof FxProviderError || err instanceof FxError || err instanceof MoneyError) return err;
  return new FxProviderError("fx_provider_network_error", "fx provider network error");
}

function isRecoverableProviderFailure(err) {
  if (err instanceof FxError || err instanceof MoneyError) return false;
  return true;
}

function assertNormalizedCacheRecord(row, { fromDate, toDate, asOfToday } = {}) {
  if (!row || typeof row !== "object") {
    throw new FxProviderError("fx_provider_invalid_response", "provider rate is missing fields");
  }
  const rateDate = row.rateDate;
  const baseCurrency = row.baseCurrency;
  const quoteCurrency = row.quoteCurrency;
  const rate = row.rate;
  const source = row.source;
  parseYmd(rateDate, FxProviderError, "fx_provider_invalid_response");
  if (toDate && rateDate > toDate) {
    throw new FxProviderError("fx_provider_future_rate", "provider returned a rate after the requested range");
  }
  if (asOfToday && rateDate > asOfToday) {
    throw new FxProviderError("fx_provider_future_rate", "provider returned a future rate");
  }
  if (fromDate && rateDate < fromDate) {
    throw new FxProviderError("fx_provider_invalid_response", "provider returned a rate before the requested range");
  }
  try {
    assertSupportedCurrency(baseCurrency);
    assertSupportedCurrency(quoteCurrency);
  } catch (err) {
    throw new FxProviderError("fx_provider_invalid_request", err.message);
  }
  if (baseCurrency === quoteCurrency) {
    throw new FxProviderError("fx_provider_invalid_request", "base and quote currencies must differ");
  }
  if (typeof rate !== "string" || !RATE_SHAPE.test(rate) || new Decimal(rate).lte(0)) {
    throw new FxProviderError("fx_provider_invalid_rate", "rate must be a positive decimal");
  }
  if (
    typeof source !== "string" ||
    !SOURCE_SHAPE.test(source) ||
    source === MANUAL_FX_SOURCE ||
    source === IDENTITY_FX_SOURCE
  ) {
    throw new FxProviderError("fx_provider_invalid_request", "automatic providers cannot use a reserved source");
  }
  return { rateDate, baseCurrency, quoteCurrency, rate, source };
}

function presentRate(row) {
  return {
    rateDate: row.rate_date,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: row.rate,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

export function createFxModule({
  db,
  provider = null,
  providerId = null,
  today = utcToday,
  nowIso = utcNowIso,
  lookbackDays = LOOKBACK_DAYS,
} = {}) {
  if (!db) throw new FxError("invalid_request", "fx module requires a database");
  const adapter = provider ?? getFxProvider(providerId ?? getDefaultFxProviderId());
  let lastSyncError = null;

  const insertRate = db.prepare(
    `INSERT INTO fx_rates(rate_date, base_currency, quote_currency, rate, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(rate_date, base_currency, quote_currency, source)
     DO UPDATE SET rate=excluded.rate, fetched_at=excluded.fetched_at`,
  );
  const deleteManual = db.prepare(
    "DELETE FROM fx_rates WHERE rate_date=? AND base_currency=? AND quote_currency=? AND source=?",
  );
  const listAll = db.prepare(
    "SELECT rate_date, base_currency, quote_currency, rate, source, fetched_at FROM fx_rates ORDER BY rate_date DESC, base_currency, quote_currency, source",
  );
  const listOnOrBefore = db.prepare(
    "SELECT rate_date, base_currency, quote_currency, rate, source, fetched_at FROM fx_rates WHERE rate_date<=?",
  );

  const persistRecords = db.transaction((rows, fetchedAt) => {
    for (const row of rows) {
      if (row.source === MANUAL_FX_SOURCE || row.source === IDENTITY_FX_SOURCE) {
        throw new FxError("manual_source_reserved", "automatic providers cannot write reserved sources");
      }
      insertRate.run(row.rateDate, row.baseCurrency, row.quoteCurrency, row.rate, row.source, fetchedAt);
    }
  });

  function assertPair(baseCurrency, quoteCurrency) {
    assertSupportedCurrency(baseCurrency);
    assertSupportedCurrency(quoteCurrency);
    if (baseCurrency === quoteCurrency) {
      throw new FxError("same_currency_pair", "base and quote currencies must differ");
    }
  }

  function assertEnabledPair(baseCurrency, quoteCurrency) {
    const enabled = listEnabledCurrencyCodes(db);
    if (!enabled.includes(baseCurrency) || !enabled.includes(quoteCurrency)) {
      const code = !enabled.includes(baseCurrency) ? baseCurrency : quoteCurrency;
      throw new FxError("currency_not_enabled", `${code} is not an enabled currency`);
    }
  }

  function assertPositiveRate(rate) {
    if (typeof rate !== "string" || !RATE_SHAPE.test(rate) || new Decimal(rate).lte(0)) {
      throw new FxError("invalid_rate", "rate must be a positive decimal string");
    }
    return rate;
  }

  function resolveRange({ fromDate, toDate, dates } = {}) {
    let from = fromDate;
    let to = toDate;
    if (Array.isArray(dates) && dates.length) {
      const sorted = dates.slice().sort();
      from = from ?? sorted[0];
      to = to ?? sorted[sorted.length - 1];
    } else if (dates && typeof dates === "object") {
      from = from ?? dates.fromDate ?? dates.from;
      to = to ?? dates.toDate ?? dates.to;
    }
    to = to ?? today();
    from = from ?? addUtcDays(to, -lookbackDays);
    parseYmd(from, FxError, "invalid_date");
    parseYmd(to, FxError, "invalid_date");
    if (from > to) throw new FxError("invalid_date", "fromDate must be on or before toDate");
    return { fromDate: from, toDate: to };
  }

  function selectFromCache(from, to, asOfDate) {
    const rows = listOnOrBefore.all(asOfDate);
    const byDate = new Map();
    for (const row of rows) {
      const list = byDate.get(row.rate_date);
      if (list) list.push(row);
      else byDate.set(row.rate_date, [row]);
    }
    const dates = [...byDate.keys()].sort().reverse();
    for (const rateDate of dates) {
      const picked = selectOnDate(byDate.get(rateDate), from, to);
      if (picked) return { ...picked, rateDate };
    }
    return null;
  }

  async function fetchProviderRates(currencies, fromDate, toDate) {
    const codes = uniqueCodes(currencies).filter((code) => {
      try {
        assertSupportedCurrency(code);
        return true;
      } catch {
        return false;
      }
    });
    const records = [];
    for (const base of codes) {
      const quotes = codes.filter((code) => code !== base);
      if (!quotes.length) continue;
      try {
        const batch = await adapter.fetchRates({ base, quotes, fromDate, toDate });
        records.push(...batch);
      } catch (err) {
        if (err instanceof FxProviderError && err.code === "fx_provider_empty_result") continue;
        throw err;
      }
    }
    return records;
  }

  function writeCache(records, range) {
    if (!records.length) return;
    const normalized = records.map((row) => assertNormalizedCacheRecord(row, range));
    persistRecords(normalized, nowIso());
  }

  async function syncRates(input = {}) {
    const { fromDate, toDate } = resolveRange(input);
    const currencies = uniqueCodes([
      ...(input.currencies ?? listEnabledCurrencyCodes(db)),
      EUR,
    ]);
    try {
      const records = await fetchProviderRates(currencies, fromDate, toDate);
      if (!records.length) {
        throw new FxProviderError("fx_provider_empty_result", "provider returned no rates");
      }
      writeCache(records, { fromDate, toDate, asOfToday: today() });
      lastSyncError = null;
      return { ok: true, ...getStatus() };
    } catch (err) {
      const wrapped = wrapProviderFailure(err);
      lastSyncError = { code: wrapped.code, message: wrapped.message };
      throw wrapped;
    }
  }

  async function syncIfMissing(from, to, asOfDate) {
    const cached = selectFromCache(from, to, asOfDate);
    if (cached) return { picked: cached, providerFailed: false };
    try {
      const { fromDate, toDate } = resolveRange({ toDate: asOfDate });
      const records = await fetchProviderRates([from, to, EUR], fromDate, toDate);
      writeCache(records, { fromDate, toDate, asOfToday: today() });
    } catch (err) {
      const fallback = selectFromCache(from, to, asOfDate);
      if (fallback) return { picked: fallback, providerFailed: false };
      if (isRecoverableProviderFailure(err)) {
        return { picked: null, providerFailed: true };
      }
      throw err;
    }
    return { picked: selectFromCache(from, to, asOfDate), providerFailed: false };
  }

  async function getRate({ from, to, asOf } = {}) {
    assertSupportedCurrency(from);
    assertSupportedCurrency(to);
    const asOfDate = parseYmd(asOf, FxError, "invalid_date");
    if (from === to) {
      return successResult({
        from,
        to,
        asOfDate,
        rate: "1",
        rateDate: asOfDate,
        source: IDENTITY_FX_SOURCE,
        path: "identity",
      });
    }
    const { picked, providerFailed } = await syncIfMissing(from, to, asOfDate);
    if (picked) {
      return successResult({
        from,
        to,
        asOfDate,
        rate: picked.rate,
        rateDate: picked.rateDate,
        source: picked.source,
        path: picked.path,
      });
    }
    return missingResult(from, to, asOfDate, providerFailed ? "provider_failed" : "missing_rate");
  }

  async function convert({ amountMinor, from, to, asOf } = {}) {
    const quoted = await getRate({ from, to, asOf });
    if (!quoted.ok) return quoted;
    return {
      ...quoted,
      amountMinor: convertAmount({ amountMinor, from, to, rate: quoted.rate }),
    };
  }

  function putManualRate({ rateDate, baseCurrency, quoteCurrency, rate } = {}) {
    assertPair(baseCurrency, quoteCurrency);
    assertEnabledPair(baseCurrency, quoteCurrency);
    const date = parseYmd(rateDate, FxError, "invalid_date");
    if (date > today()) throw new FxError("future_rate_date", "manual rates cannot be dated in the future");
    const normalized = assertPositiveRate(rate);
    insertRate.run(date, baseCurrency, quoteCurrency, normalized, MANUAL_FX_SOURCE, nowIso());
  }

  function deleteManualRate({ rateDate, baseCurrency, quoteCurrency } = {}) {
    assertPair(baseCurrency, quoteCurrency);
    assertEnabledPair(baseCurrency, quoteCurrency);
    const date = parseYmd(rateDate, FxError, "invalid_date");
    if (date > today()) throw new FxError("future_rate_date", "manual rates cannot be dated in the future");
    deleteManual.run(date, baseCurrency, quoteCurrency, MANUAL_FX_SOURCE);
  }

  function listRates() {
    return listAll.all().map(presentRate);
  }

  function getStatus() {
    const { reportingCurrency, enabledCurrencies } = getCurrencyBootstrapState(db);
    const asOf = today();
    const coverage = {
      reportingCurrency,
      asOf,
      currencies: reportingCurrency ? enabledCurrencies.map(currencyCode => {
        if (currencyCode === reportingCurrency) return { currencyCode, status: "identity", rateDate: null };
        // Inspect the same dated cache paths used by valuation, without fetching.
        const picked = selectFromCache(currencyCode, reportingCurrency, asOf);
        return { currencyCode, status: picked ? "available" : "missing", rateDate: picked?.rateDate ?? null };
      }) : [],
    };
    const rates = listRates();
    const latestRateDate = rates[0]?.rateDate ?? null;
    let latestSource = null;
    if (latestRateDate) {
      const sameDay = rates.filter((row) => row.rateDate === latestRateDate);
      latestSource = sameDay.some((row) => row.source === MANUAL_FX_SOURCE)
        ? MANUAL_FX_SOURCE
        : sameDay[0].source;
    }
    return {
      defaultProvider: getDefaultFxProviderId(),
      coverage,
      latestRateDate,
      latestSource,
      rates,
      lastSyncError,
    };
  }

  return {
    getRate,
    convert,
    syncRates,
    putManualRate,
    deleteManualRate,
    listRates,
    getStatus,
  };
}
