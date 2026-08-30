import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  FxProviderError,
  createFrankfurterEcbAdapter,
  createInMemoryFxAdapter,
} from "./fx.mjs";

const REQUEST = {
  base: "USD",
  quotes: ["EUR", "CNY"],
  fromDate: "2026-08-24",
  toDate: "2026-08-28",
};

const FLAT_ROWS = [
  { date: "2026-08-28", base: "USD", quote: "EUR", rate: "0.8739" },
  { date: "2026-08-28", base: "USD", quote: "CNY", rate: "7.20" },
];

const NORMALIZED_ROWS = [
  { rateDate: "2026-08-28", baseCurrency: "USD", quoteCurrency: "EUR", rate: "0.8739" },
  { rateDate: "2026-08-28", baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.20" },
];

function hangingFetch(_url, init = {}) {
  return new Promise((_, reject) => {
    const abort = () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
  });
}

function jsonResponse(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capturingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function expectNormalizedRecord(record, { source }) {
  expect(Object.keys(record).sort()).toEqual([
    "baseCurrency",
    "quoteCurrency",
    "rate",
    "rateDate",
    "source",
  ]);
  expect(record).not.toHaveProperty("date");
  expect(record).not.toHaveProperty("quote");
  expect(record.source).toBe(source);
  expect(record.rateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(record.baseCurrency).toMatch(/^[A-Z]{3}$/);
  expect(record.quoteCurrency).toMatch(/^[A-Z]{3}$/);
  expect(typeof record.rate).toBe("string");
  expect(record.rate).toMatch(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
  expect(new Decimal(record.rate).gt(0)).toBe(true);
}

async function expectProviderCode(fn, code) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(FxProviderError);
  expect(error.code).toBe(code);
  return error;
}

function createAdapters(scenario) {
  return [
    {
      name: "InMemoryFxAdapter",
      source: scenario.inMemorySource ?? "in_memory",
      adapter: createInMemoryFxAdapter(scenario.inMemory),
    },
    {
      name: "FrankfurterEcbAdapter",
      source: "frankfurter_ecb",
      adapter: createFrankfurterEcbAdapter({
        fetchImpl: scenario.fetchImpl,
        baseUrl: scenario.baseUrl ?? "https://fx.test",
        timeoutMs: scenario.timeoutMs ?? 40,
      }),
    },
  ];
}

describe("FX provider contract", () => {
  it("returns only normalized records for InMemory and Frankfurter adapters", async () => {
    const fetchImpl = capturingFetch(() => jsonResponse(FLAT_ROWS));
    const adapters = createAdapters({
      inMemory: { records: NORMALIZED_ROWS },
      fetchImpl,
    });

    for (const { name, source, adapter } of adapters) {
      const rows = await adapter.fetchRates(REQUEST);
      expect(rows, name).toHaveLength(2);
      for (const row of rows) expectNormalizedRecord(row, { source });
      const cny = rows.find((row) => row.quoteCurrency === "CNY");
      expect(cny.rateDate).toBe("2026-08-28");
      expect(cny.baseCurrency).toBe("USD");
      expect(new Decimal(cny.rate).eq("7.20")).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("account");
      expect(JSON.stringify(rows)).not.toContain("balance");
    }

    expect(fetchImpl.calls).toHaveLength(1);
    const url = new URL(fetchImpl.calls[0].url);
    expect(url.origin).toBe("https://fx.test");
    expect(url.pathname).toBe("/v2/rates");
    expect(url.searchParams.get("providers")).toBe("ECB");
    expect(url.searchParams.get("base")).toBe("USD");
    expect(url.searchParams.get("quotes")).toBe("EUR,CNY");
    expect(url.searchParams.get("from")).toBe("2026-08-24");
    expect(url.searchParams.get("to")).toBe("2026-08-28");
    expect([...url.searchParams.keys()].sort()).toEqual(["base", "from", "providers", "quotes", "to"]);
    expect(fetchImpl.calls[0].url).not.toMatch(/account|balance|payee|transaction/i);
  });

  it("parses a numeric Frankfurter rate without leaking the vendor object", async () => {
    const adapter = createFrankfurterEcbAdapter({
      fetchImpl: async () =>
        jsonResponse([{ date: "2026-07-17", base: "USD", quote: "EUR", rate: 0.5 }]),
      baseUrl: "https://api.frankfurter.dev",
      timeoutMs: 40,
    });
    const [row] = await adapter.fetchRates({
      base: "USD",
      quotes: ["EUR"],
      fromDate: "2026-07-17",
      toDate: "2026-07-17",
    });
    expect(row).toEqual({
      rateDate: "2026-07-17",
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      rate: "0.5",
      source: "frankfurter_ecb",
    });
  });
});

describe("FX provider error matrix", () => {
  const matrix = [
    {
      name: "timeout",
      code: "fx_provider_timeout",
      inMemory: { delayMs: 200, timeoutMs: 20 },
      fetchImpl: hangingFetch,
      timeoutMs: 20,
    },
    {
      name: "HTTP error",
      code: "fx_provider_http_error",
      inMemory: { failure: { code: "fx_provider_http_error", message: "fx provider HTTP 500" } },
      fetchImpl: async () => jsonResponse({ error: "nope" }, 500),
    },
    {
      name: "network error",
      code: "fx_provider_network_error",
      inMemory: { throwRaw: new Error("getaddrinfo ENOTFOUND api.frankfurter.dev") },
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.frankfurter.dev");
      },
    },
    {
      name: "connection failure",
      code: "fx_provider_network_error",
      inMemory: { throwRaw: new TypeError("fetch failed") },
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    },
    {
      name: "empty array",
      code: "fx_provider_empty_result",
      inMemory: { rawResult: [] },
      fetchImpl: async () => jsonResponse([]),
    },
    {
      name: "illegal rate",
      code: "fx_provider_invalid_rate",
      inMemory: {
        rawResult: [{ date: "2026-08-28", base: "USD", quote: "EUR", rate: "-1" }],
      },
      fetchImpl: async () =>
        jsonResponse([{ date: "2026-08-28", base: "USD", quote: "EUR", rate: 0 }]),
    },
    {
      name: "future date",
      code: "fx_provider_future_rate",
      inMemory: {
        rawResult: [{ date: "2026-09-01", base: "USD", quote: "EUR", rate: "0.87" }],
      },
      fetchImpl: async () =>
        jsonResponse([{ date: "2026-09-01", base: "USD", quote: "EUR", rate: "0.87" }]),
    },
    {
      name: "non-array",
      code: "fx_provider_invalid_response",
      inMemory: { rawResult: { amount: 1, rates: { EUR: 0.87 } } },
      fetchImpl: async () => jsonResponse({ amount: 1, rates: { EUR: 0.87 } }),
    },
  ];

  it.each(matrix)("normalizes $name for both adapters", async (scenario) => {
    const adapters = createAdapters(scenario);
    for (const { name, adapter } of adapters) {
      const error = await expectProviderCode(() => adapter.fetchRates(REQUEST), scenario.code);
      expect(name).toBeTruthy();
      expect(String(error.message)).not.toMatch(/account|balance|payee|transaction/i);
    }
  });

  it("normalizes malformed JSON as an invalid response", async () => {
    const adapter = createFrankfurterEcbAdapter({
      fetchImpl: async () => jsonResponse("not-json {"),
      timeoutMs: 40,
    });
    await expectProviderCode(() => adapter.fetchRates(REQUEST), "fx_provider_invalid_response");
  });
});
