// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, BudgetData, CurrencyRecord } from "../types";
import { formatMoney } from "../money";
import { ApiError } from "../api";

const SUPPORTED: CurrencyRecord[] = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
];

function budgetData(month: string, assigned: number): BudgetData {
  return {
    month,
    currencyCode: "CNY",
    months: ["2026-07", "2026-08", "2026-09"],
    maxMonth: "2027-08",
    readyToAssign: 1,
    incomeThisMonth: 800000,
    assignedTotal: assigned,
    overspentTotal: 0,
    uncategorizedCount: 0,
    ageOfMoney: 12,
    revision: 2,
    groups: [
      {
        id: "g1",
        name: "Everyday",
        virtual: false,
        categories: [
          {
            id: "cat-1",
            name: "Groceries",
            assigned,
            activity: -20000,
            available: assigned - 20000,
            goal: null,
            need: null,
            lastAssigned: 40000,
            avgSpend: 25000,
          },
        ],
      },
    ],
  };
}

const h = vi.hoisted(() => ({
  budget: vi.fn(),
  assign: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", async () => {
  class ApiError extends Error {
    status?: number;
    code?: string;
    budget?: unknown;
  }
  return {
    ApiError,
    api: {
      budget: (...args: unknown[]) => h.budget(...args),
      assign: (...args: unknown[]) => h.assign(...args),
    },
  };
});

vi.mock("../store", async () => {
  const { makeT } = await import("../i18n");
  const t = makeT("zh");
  const toast = vi.fn();
  const setLang = vi.fn();
  const refreshBoot = vi.fn().mockResolvedValue({});
  return {
    useApp: () => ({
      boot: h.boot,
      loading: false,
      lang: "zh" as const,
      t,
      toast,
      setLang,
      refreshBoot,
    }),
  };
});

import { BudgetPage } from "./BudgetPage";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  window.location.hash = "#/budget?currency=CNY";
  h.boot = {
    settings: { reportingCurrency: "CNY", timezone: "UTC" },
    accounts: [{ id: "acc-1", name: "现金", type: "cash", on_budget: 1, closed: 0, currencyCode: "CNY", balance: 1, starting_balance: 1, starting_balance_date: null, sort_order: 0, created_at: "" }],
    payees: [],
    groups: [],
    currentMonth: "2026-08",
    currencyMigrationRequired: false,
    supportedCurrencies: SUPPORTED,
    enabledCurrencies: ["CNY", "USD"],
  } as unknown as Bootstrap;
  h.budget.mockReset().mockImplementation((month: string) => Promise.resolve(budgetData(month, 50_000)));
  h.assign.mockReset();
});

afterEach(cleanup);

describe("BudgetPage 409 conflict", () => {
  it("retry keeps one write in flight and focuses the saved assignment cell", async () => {
    const err = new ApiError("budget_revision_conflict");
    err.code = "budget_revision_conflict";
    err.budget = budgetData("2026-08", 32209);
    let resolveRetry!: (data: BudgetData) => void;
    h.assign.mockRejectedValueOnce(err).mockImplementation(() => new Promise(resolve => { resolveRetry = resolve; }));
    render(<BudgetPage />);
    const buttons = await screen.findAllByRole("button", { name: formatMoney(50000, "CNY", { locale: "zh-CN" }) });
    fireEvent.click(buttons[1]);
    const input = await screen.findByDisplayValue("500.00");
    fireEvent.change(input, { target: { value: "42" } });
    buttons[2].focus();
    const retry = await screen.findByRole("button", { name: "重新提交我的修改" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    const cancel = screen.getByRole("button", { name: "取消" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    expect(screen.getByText("预算已在另一设备更新")).toBeTruthy();
    expect(h.assign).toHaveBeenCalledTimes(2);
    resolveRetry(budgetData("2026-08", 4200));
    await waitFor(() => expect(screen.queryByDisplayValue("42")).toBeNull());
    const saved = document.getElementById("budget-assignment-cat-1-2026-08")?.querySelector("button");
    expect(saved?.textContent).toContain("42.00");
    expect(document.activeElement === saved).toBe(true);
  });

  it("cancel after Tab blur returns focus to the original draft without resubmitting", async () => {
    const err = new ApiError("budget_revision_conflict");
    err.code = "budget_revision_conflict";
    err.budget = budgetData("2026-08", 32209);
    h.assign.mockRejectedValue(err);
    render(<BudgetPage />);
    const buttons = await screen.findAllByRole("button", { name: formatMoney(50000, "CNY", { locale: "zh-CN" }) });
    fireEvent.click(buttons[1] ?? buttons[0]);
    const input = await screen.findByDisplayValue("500.00");
    fireEvent.change(input, { target: { value: "42" } });
    buttons[2].focus();
    await screen.findByText("预算已在另一设备更新");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByText("预算已在另一设备更新")).toBeNull());
    expect((screen.getByDisplayValue("42") as HTMLInputElement).value).toBe("42");
    expect(document.activeElement === screen.getByDisplayValue("42")).toBe(true);
    expect(h.assign).toHaveBeenCalledTimes(1);
  });

  it("keeps the user input, shows the latest server value, and does not auto-retry", async () => {
    const err = new ApiError("budget_revision_conflict");
    err.code = "budget_revision_conflict";
    err.status = 409;
    err.budget = budgetData("2026-08", 50_000);
    h.assign.mockRejectedValue(err);

    render(<BudgetPage />);
    const formatted = formatMoney(50_000, "CNY", { locale: "zh-CN" });
    const buttons = await screen.findAllByRole("button", { name: formatted });
    fireEvent.click(buttons[1] ?? buttons[0]);
    const input = await screen.findByDisplayValue("500.00");
    fireEvent.change(input, { target: { value: "12.34" } });
    fireEvent.blur(input);
    expect(await screen.findByText("预算已在另一设备更新")).toBeTruthy();
    expect(screen.getByText(/你刚输入 12.34/)).toBeTruthy();
    expect(screen.getByText(/最新值 500.00/)).toBeTruthy();
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue("12.34")).toBeTruthy();
  });
});
