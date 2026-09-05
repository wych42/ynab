import { coerceEnabledCurrency, formatHash, parseHash, type CurrencyNotice } from "./hashRoute";

export type ValuationDateNotice = "invalid" | "future";

export function householdToday(timeZone?: string | null, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function resolveNetWorthRoute(hash: string, options: {
  today: string;
  enabled: string[];
  supported: string[];
  fallback: string | null;
}): { currency: string | null; asOf: string; hash: string; dateNotice: ValuationDateNotice | null; currencyNotice: CurrencyNotice | null } {
  const parsed = parseHash(hash);
  const dates = new URLSearchParams(hash.split("?")[1] ?? "").getAll("asOf");
  const requested = dates[0];
  const dateNotice = dates.length > 1 || (requested !== undefined && !isCalendarDate(requested))
    ? "invalid"
    : requested !== undefined && requested > options.today ? "future" : null;
  const asOf = requested === undefined || dateNotice ? options.today : requested;
  const { currency, notice } = coerceEnabledCurrency(parsed.query.currency, options.enabled, options.supported, options.fallback);
  return {
    currency, asOf, dateNotice, currencyNotice: notice,
    hash: formatHash("/reports/net-worth", { ...parsed.query, currency: currency ?? "", asOf }),
  };
}
