import { useEffect, useState } from "react";
import { resolveActiveBudgetCurrency } from "./activeCurrency";

export type HashQuery = Record<string, string>;

export type ParsedHash = {
  path: string;
  query: HashQuery;
};

const listeners = new Set<() => void>();
let listening = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureListening(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("hashchange", notify);
}

export function parseHash(hash = typeof window === "undefined" ? "" : window.location.hash): ParsedHash {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIndex = raw.indexOf("?");
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const query: HashQuery = {};
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    for (const [key, value] of params.entries()) query[key] = value;
  }
  return { path, query };
}

export function formatHash(path: string, query: HashQuery = {}): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `#${normalized}?${qs}` : `#${normalized}`;
}

export function subscribeHash(listener: () => void): () => void {
  ensureListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function replaceHash(next: string): void {
  const hash = next.startsWith("#") ? next : `#${next}`;
  const url = new URL(window.location.href);
  url.hash = hash;
  history.replaceState(history.state, "", url.toString());
  notify();
}

export function pushHash(next: string): void {
  const hash = next.startsWith("#") ? next : `#${next}`;
  if (window.location.hash !== hash) window.location.hash = hash;
  notify();
}

export type CurrencyNotice = {
  requested: string;
  fallback: string;
  reason: "disabled" | "unsupported";
};

export function coerceEnabledCurrency(
  requested: string | undefined,
  enabledCurrencies: string[],
  supportedCurrencies: string[],
  fallback: string | null,
): { currency: string | null; notice: CurrencyNotice | null } {
  if (!requested) return { currency: fallback, notice: null };
  if (enabledCurrencies.includes(requested)) return { currency: requested, notice: null };
  if (!fallback) return { currency: null, notice: null };
  const reason = supportedCurrencies.includes(requested) ? "disabled" : "unsupported";
  return { currency: fallback, notice: { requested, fallback, reason } };
}

export function completeBudgetHash(opts: {
  enabledCurrencies: string[];
  supportedCurrencies?: string[];
  reportingCurrency?: string | null;
  storedCurrency?: string | null;
  hash?: string;
}): { currency: string | null; replaced: boolean; notice: CurrencyNotice | null } {
  const current = opts.hash ?? window.location.hash;
  const parsed = parseHash(current);
  const fallback = resolveActiveBudgetCurrency(
    opts.enabledCurrencies,
    opts.reportingCurrency,
    opts.storedCurrency,
  );
  if (parsed.path !== "/budget") {
    const coerced = coerceEnabledCurrency(
      parsed.query.currency,
      opts.enabledCurrencies,
      opts.supportedCurrencies ?? [],
      fallback,
    );
    return { currency: coerced.currency, replaced: false, notice: coerced.notice };
  }
  const coerced = coerceEnabledCurrency(
    parsed.query.currency,
    opts.enabledCurrencies,
    opts.supportedCurrencies ?? [],
    fallback,
  );
  const nextHash = coerced.currency
    ? formatHash(parsed.path, { ...parsed.query, currency: coerced.currency })
    : current;
  const needsReplace = (!parsed.query.currency && !!fallback) || !!coerced.notice;
  if (needsReplace && coerced.currency && nextHash !== window.location.hash) {
    replaceHash(nextHash);
    return { currency: coerced.currency, replaced: true, notice: coerced.notice };
  }
  return { currency: coerced.currency, replaced: false, notice: null };
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(() => (typeof window === "undefined" ? "#/budget" : window.location.hash || "#/budget"));
  useEffect(() => {
    const sync = () => setRoute(window.location.hash || "#/budget");
    const unsub = subscribeHash(sync);
    if (!window.location.hash) window.location.hash = "#/budget";
    return unsub;
  }, []);
  return route;
}
