// Storage helpers for the bare `#/budget` URL only.
// They are not page current state and must not be applied on bootstrap.
export const ACTIVE_BUDGET_CURRENCY_KEY = "activeBudgetCurrency";

export function resolveActiveBudgetCurrency(
  enabledCurrencies: string[],
  reportingCurrency: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  if (stored && enabledCurrencies.includes(stored)) return stored;
  if (reportingCurrency && enabledCurrencies.includes(reportingCurrency)) return reportingCurrency;
  return enabledCurrencies[0] ?? null;
}

export function readStoredBudgetCurrency(): string | null {
  try {
    return localStorage.getItem(ACTIVE_BUDGET_CURRENCY_KEY);
  } catch {
    return null;
  }
}

export function persistBudgetCurrency(code: string | null): void {
  try {
    if (code) localStorage.setItem(ACTIVE_BUDGET_CURRENCY_KEY, code);
    else localStorage.removeItem(ACTIVE_BUDGET_CURRENCY_KEY);
  } catch {
    // ignore storage failures
  }
}
