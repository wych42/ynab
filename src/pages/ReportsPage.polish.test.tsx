// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { makeT } from "../i18n";
import { displayFxSource } from "../format";
const h = vi.hoisted(() => ({ overview: vi.fn(), detail: vi.fn(), investments: vi.fn(), netWorth: vi.fn() }));
vi.mock("../api", () => ({ api: { cashflowOverview: h.overview, cashflowDetail: h.detail, investments: h.investments, netWorthReport: h.netWorth } }));
vi.mock("../store", () => {
  const boot = { settings: { reportingCurrency: "USD" }, enabledCurrencies: ["USD", "SGD"], supportedCurrencies: [{ code: "USD" }, { code: "SGD" }, { code: "GBP" }] };
  return { useApp: () => ({ lang: "en", t: makeT("en"), boot }) };
});
import { ReportsPage } from "./ReportsPage";
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const account = (accountId: string, currencyCode: string, balanceMinor: number) => ({ accountId, name: accountId, currencyCode, balanceMinor, balanceChangeMinor: 0, contributionsMinor: 0, withdrawalsMinor: 0, netContributionsMinor: 0, latestValuationDate: null });
beforeEach(() => { vi.resetAllMocks(); h.investments.mockResolvedValue({ accounts: [account("first", "USD", 100), account("second", "USD", 200), account("third", "SGD", 300)], subtotalsByCurrency: [] }); });
afterEach(cleanup);
it("localizes FX sources without exposing unknown identifiers", () => {
  expect(displayFxSource("manual", false, "en")).toBe("Manual rate");
  expect(displayFxSource("identity", false, "en")).toBe("No conversion needed");
  expect(displayFxSource("secret_provider", false, "en")).toBe("Other reference rate");
  expect(displayFxSource("secret_provider")).toBe("其他参考汇率");
});
it.each([ ["#/reports/cashflow", "overview"], ["#/reports/cashflow?currency=USD", "detail"], ["#/reports/investments", "investments"], ["#/reports/net-worth?currency=USD&asOf=2026-09-04", "netWorth"] ] as const)("recovers rejected request %s", async (hash, endpoint) => {
  window.location.hash = hash;
  h[endpoint].mockRejectedValue(new Error("private raw message"));
  render(<ReportsPage />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("private raw message")).toBeNull();
  const before = h[endpoint].mock.calls.length;
  const responses = {
    overview: { month: "2026-08", currencies: [] },
    detail: { currencyCode: "USD", months: ["2026-08"], income: [{ month: "2026-08", value: 100 }], expense: [], breakdown: [], topPayees: [], incomeSources: [], ageOfMoney: 1 },
    investments: { accounts: [], subtotalsByCurrency: [] },
    netWorth: { reportingCurrency: "USD", asOf: "2026-09-04", complete: true, netWorthMinor: 100, totalAssetsMinor: 100, totalLiabilitiesMinor: 0, history: [], accounts: [], missing: [] },
  };
  h[endpoint].mockResolvedValue(responses[endpoint]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(h[endpoint].mock.calls.length).toBe(before + 1));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
it("filters investment rows and native subtotals using the URL", async () => {
  window.location.hash = "#/reports/investments";
  render(<ReportsPage />);
  await screen.findByRole("link", { name: "first" });
  fireEvent.change(screen.getByRole("combobox", { name: "View currency" }), { target: { value: "USD" } });
  await waitFor(() => expect(screen.queryByRole("link", { name: "third" })).toBeNull());
  fireEvent.change(screen.getByRole("combobox", { name: "Investment account" }), { target: { value: "second" } });
  await waitFor(() => expect(screen.queryByRole("link", { name: "first" })).toBeNull());
  expect(window.location.hash).toContain("account=second");
  expect(screen.getByLabelText("Native subtotals").textContent).toContain("2.00");
  expect(screen.getByLabelText("Investment accounts").className).toContain("overflow-x-auto");
  await act(async () => { window.location.hash = "#/reports/investments?currency=SGD"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(await screen.findByRole("link", { name: "third" })).toBeTruthy();
});
it("normalizes unavailable investment filters with explanation", async () => {
  window.location.hash = "#/reports/investments?currency=GBP&account=missing";
  render(<ReportsPage />);
  await screen.findByRole("link", { name: "first" });
  await waitFor(() => expect(window.location.hash).toBe("#/reports/investments"));
  expect(screen.getByRole("status").textContent).toContain("unavailable");
});
it("ignores a late error from a previous cashflow currency", async () => {
  let rejectOld!: (e: Error) => void;
  h.detail.mockImplementation((code) => code === "USD" ? new Promise((_, reject) => { rejectOld = reject; }) : new Promise(() => {}));
  window.location.hash = "#/reports/cashflow?currency=USD";
  render(<ReportsPage />);
  await waitFor(() => expect(h.detail).toHaveBeenCalledWith("USD", 12));
  await act(async () => { window.location.hash = "#/reports/cashflow?currency=SGD"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await act(async () => rejectOld(new Error("old")));
  expect(screen.queryByRole("alert")).toBeNull();
});
it("provides labeled cashflow chart values in a local scroll region", async () => {
  h.detail.mockResolvedValue({ currencyCode: "USD", months: ["2026-08"], income: [{ month: "2026-08", value: 12345 }], expense: [{ month: "2026-08", value: 6789 }], breakdown: [], topPayees: [], incomeSources: [], ageOfMoney: 1 });
  window.location.hash = "#/reports/cashflow?currency=USD";
  render(<ReportsPage />);
  const table = await screen.findByRole("table", { name: "Income vs Expenses" });
  expect(table.textContent).toContain("123.45");
  expect(table.textContent).toContain("67.89");
  expect(table.parentElement?.className).toContain("overflow-x-auto");
});
it("rejects cashflow payloads with the wrong currency", async () => {
  h.detail.mockResolvedValue({ currencyCode: "SGD", months: ["2026-08"], income: [{ month: "2026-08", value: 100 }], expense: [], breakdown: [], topPayees: [], incomeSources: [], ageOfMoney: 1 });
  window.location.hash = "#/reports/cashflow?currency=USD";
  render(<ReportsPage />);
  expect(await screen.findByRole("alert")).toBeTruthy();
});
it("explains an empty investment result", async () => {
  window.location.hash = "#/reports/investments?currency=USD";
  h.investments.mockResolvedValue({ accounts: [], subtotalsByCurrency: [] });
  render(<ReportsPage />);
  expect(await screen.findByText("No investment accounts match these filters.")).toBeTruthy();
});
