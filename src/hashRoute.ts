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

export function completeBudgetHash(opts: {
  enabledCurrencies: string[];
  reportingCurrency?: string | null;
  storedCurrency?: string | null;
  hash?: string;
}): { currency: string | null; replaced: boolean } {
  const current = opts.hash ?? window.location.hash;
  const parsed = parseHash(current);
  if (parsed.path !== "/budget") {
    return { currency: parsed.query.currency ?? null, replaced: false };
  }
  if (parsed.query.currency) {
    return { currency: parsed.query.currency, replaced: false };
  }
  const fallback = resolveActiveBudgetCurrency(
    opts.enabledCurrencies,
    opts.reportingCurrency,
    opts.storedCurrency,
  );
  if (!fallback) return { currency: null, replaced: false };
  replaceHash(formatHash(parsed.path, { ...parsed.query, currency: fallback }));
  return { currency: fallback, replaced: true };
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
