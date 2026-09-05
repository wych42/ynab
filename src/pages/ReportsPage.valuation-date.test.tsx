// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { makeT } from "../i18n";
const h = vi.hoisted(() => ({ request: vi.fn(), ready: true, timezone: "Asia/Singapore", lang: "en" as "en" | "zh" }));
vi.mock("../api", () => ({ api: { netWorthReport: h.request } }));
vi.mock("../netWorthRoute", async importOriginal => {
  const original = await importOriginal<typeof import("../netWorthRoute")>();
  return { ...original, householdToday: (zone?: string | null) => original.householdToday(zone, new Date("2026-09-04T16:30:00Z")) };
});
vi.mock("../store", () => ({ useApp: () => ({ t: makeT(h.lang), lang: h.lang, boot: h.ready ? { settings: { reportingCurrency: "USD", timezone: h.timezone }, enabledCurrencies: ["USD", "SGD"], supportedCurrencies: [{ code: "USD" }, { code: "SGD" }, { code: "CAD" }] } : null }) }));
import { ReportsPage } from "./ReportsPage";
beforeEach(() => { vi.clearAllMocks(); h.ready = true; h.timezone = "Asia/Singapore"; h.lang = "en"; h.request.mockReturnValue(new Promise(() => {})); });
afterEach(cleanup);

it.each(["bad", "", "2026-02-30", "2099-01-01", "bad&asOf=2024-02-29"])("repairs date %s before fetching and retains explanation", async asOf => {
  window.location.hash = `#/reports/net-worth?currency=SGD&asOf=${asOf}`;
  const length = history.length;
  const { rerender } = render(<ReportsPage />);
  await waitFor(() => expect(window.location.hash).toBe("#/reports/net-worth?currency=SGD&asOf=2026-09-05"));
  expect(h.request.mock.calls.every(([request]) => request.asOf === "2026-09-05")).toBe(true);
  expect(h.request).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain(asOf === "2099-01-01" ? "future" : "invalid");
  rerender(<ReportsPage />);
  expect(screen.getByRole("status").textContent).toContain("2026-09-05");
  expect(history.length).toBe(length);
  expect((screen.getByLabelText("Valuation date") as HTMLInputElement).max).toBe("2026-09-05");
});

it("waits for bootstrap before completing the date or fetching", async () => {
  h.ready = false;
  window.location.hash = "#/reports/net-worth?currency=USD";
  const { rerender } = render(<ReportsPage />);
  expect(h.request).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#/reports/net-worth?currency=USD");
  h.ready = true;
  rerender(<ReportsPage />);
  await waitFor(() => expect(h.request).toHaveBeenCalledWith({ reportingCurrency: "USD", months: 12, asOf: "2026-09-05" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("repairs both currency and date together, translates retained reasons, and clears them on valid navigation", async () => {
  window.location.hash = "#/reports/net-worth?currency=CAD&asOf=2099-01-01";
  const { rerender } = render(<ReportsPage />);
  await waitFor(() => expect(window.location.hash).toBe("#/reports/net-worth?currency=USD&asOf=2026-09-05"));
  expect(screen.getAllByRole("status").map(node => node.textContent).join(" ")).toMatch(/disabled.*future/s);
  expect(h.request).toHaveBeenCalledTimes(1);
  h.lang = "zh";
  rerender(<ReportsPage />);
  expect(screen.getAllByRole("status").map(node => node.textContent).join(" ")).toContain("未来");
  fireEvent.change(screen.getByLabelText("估值日"), { target: { value: "2024-02-29" } });
  await waitFor(() => expect(h.request).toHaveBeenLastCalledWith({ reportingCurrency: "USD", months: 12, asOf: "2024-02-29" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("rejects a future input change and reevaluates a household timezone change", async () => {
  window.location.hash = "#/reports/net-worth?currency=USD&asOf=2026-09-05";
  const { rerender } = render(<ReportsPage />);
  fireEvent.change(screen.getByLabelText("Valuation date"), { target: { value: "2099-01-01" } });
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("future"));
  expect(h.request.mock.calls.every(([request]) => request.asOf !== "2099-01-01")).toBe(true);
  h.timezone = "UTC";
  rerender(<ReportsPage />);
  await waitFor(() => expect(window.location.hash).toContain("asOf=2026-09-04"));
  expect(h.request).toHaveBeenLastCalledWith({ reportingCurrency: "USD", months: 12, asOf: "2026-09-04" });
});

it("preserves a valid historical date during currency repair and subsequent route navigation", async () => {
  window.location.hash = "#/reports/net-worth?currency=CAD&asOf=2024-02-29";
  render(<ReportsPage />);
  await waitFor(() => expect(window.location.hash).toBe("#/reports/net-worth?currency=USD&asOf=2024-02-29"));
  await act(async () => { window.location.hash = "#/reports/net-worth?currency=SGD&asOf=2026-09-04"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(h.request).toHaveBeenLastCalledWith({ reportingCurrency: "SGD", months: 12, asOf: "2026-09-04" });
  expect(screen.queryByRole("status")).toBeNull();
});
