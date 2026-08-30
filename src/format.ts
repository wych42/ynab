import type { Lang } from "./i18n";
import { formatMoney } from "./money";

let currencySymbol = "¥";
export function setCurrencySymbol(s: string) {
  currencySymbol = s || "¥";
}

export function localeForLang(lang?: string): string {
  return lang === "en" ? "en-US" : "zh-CN";
}

export function formatAccountMoney(
  amountMinor: number,
  currencyCode: string | null | undefined,
  lang?: string,
): string {
  if (currencyCode) return fmtMoney(amountMinor, { currencyCode, locale: localeForLang(lang) });
  return fmtMoney(amountMinor);
}

export function totalsByCurrency(
  accounts: { currencyCode?: string | null; balance: number }[],
): { currencyCode: string; total: number }[] {
  const map = new Map<string, number>();
  for (const acc of accounts) {
    const code = acc.currencyCode;
    if (!code) continue;
    map.set(code, (map.get(code) ?? 0) + acc.balance);
  }
  return [...map.entries()].map(([currencyCode, total]) => ({ currencyCode, total }));
}

export function groupAccountsByCurrency<T extends { currencyCode?: string | null }>(
  accounts: T[],
): { currencyCode: string; accounts: T[] }[] {
  const map = new Map<string, T[]>();
  for (const acc of accounts) {
    const code = acc.currencyCode;
    if (!code) continue;
    const list = map.get(code) ?? [];
    list.push(acc);
    map.set(code, list);
  }
  return [...map.entries()].map(([currencyCode, grouped]) => ({ currencyCode, accounts: grouped }));
}

export function fmtMoney(
  cents: number,
  opts?: { sign?: boolean; currencyCode?: string; locale?: string },
): string {
  if (opts?.currencyCode) {
    const formatted = formatMoney(cents, opts.currencyCode, { locale: opts.locale });
    if (opts.sign && cents > 0) return `+${formatted}`;
    return formatted;
  }
  const neg = cents < 0;
  const abs = Math.abs(cents) / 100;
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : opts?.sign ? "+" : ""}${currencySymbol}${str}`;
}

export function fmtMoneyShort(cents: number): string {
  const abs = Math.abs(cents);
  const neg = cents < 0 ? "-" : "";
  if (abs >= 1e10) return `${neg}${currencySymbol}${(abs / 1e10).toFixed(1)}亿`;
  if (abs >= 1e7) return `${neg}${currencySymbol}${Math.round(abs / 1e6)}万`;
  if (abs >= 1e6) return `${neg}${currencySymbol}${(abs / 1e6).toFixed(1)}万`;
  return fmtMoney(cents);
}

export function fmtMonth(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, 1));
}

export function fmtMonthShort(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
  }).format(new Date(y, m - 1, 1));
}

export function fmtDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (lang === "zh") return `${Number(m)}月${Number(d)}日`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

export function ymdInTz(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    const d = date;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}

export function todayIso(timeZone?: string): string {
  if (!timeZone) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return ymdInTz(new Date(), timeZone);
}

export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Legacy 2-decimal parser. New code should use parseAmountToMinor. */
export function parseAmountToCents(input: string): number | null {
  const s = input.replace(/[,，\s¥$￥]/g, "");
  if (!s || !/^-?\d*(\.\d*)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100);
}
