// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Bootstrap, BudgetData } from "../types";

function budgetData(month: string): BudgetData {
  return {
    month,
    currencyCode: "CNY",
    months: ["2026-07", "2026-08", "2026-09"],
    maxMonth: "2027-08",
    readyToAssign: 1,
    incomeThisMonth: 800000,
    assignedTotal: 50000,
    overspentTotal: 0,
    uncategorizedCount: 0,
    ageOfMoney: 12,
    groups: [
      {
        id: "g1",
        name: "Everyday",
        virtual: false,
        categories: [
          {
            id: "cat-1",
            name: "Groceries",
            assigned: 50000,
            activity: 0,
            available: 50000,
            goal: null,
            need: null,
            lastAssigned: 0,
            avgSpend: 0,
          },
        ],
      },
    ],
  };
}

const h = vi.hoisted(() => ({
  budget: vi.fn(),
  addCategory: vi.fn(),
  addGroup: vi.fn(),
  renameCategory: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    budget: (...args: unknown[]) => h.budget(...args),
    addCategory: (...args: unknown[]) => h.addCategory(...args),
    addGroup: (...args: unknown[]) => h.addGroup(...args),
    renameCategory: (...args: unknown[]) => h.renameCategory(...args),
  },
}));

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
    groups: [{ id: "g1", name: "Everyday", sort_order: 0, hidden: 0, is_income: 0, categories: [] }],
    currentMonth: "2026-08",
    currencyMigrationRequired: false,
    supportedCurrencies: [{ code: "CNY", exponent: 2, enabledByDefault: true }],
    enabledCurrencies: ["CNY"],
  } as unknown as Bootstrap;
  h.budget.mockReset().mockImplementation((month: string) => Promise.resolve(budgetData(month)));
  h.addCategory.mockReset().mockResolvedValue({ id: "c2" });
  h.addGroup.mockReset().mockResolvedValue({ id: "g2" });
  h.renameCategory.mockReset().mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("BudgetPage shared category confirm", () => {
  it("asks before creating a category and sends no request when cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BudgetPage />);
    const addButtons = await screen.findAllByTitle("新建分类");
    fireEvent.click(addButtons[0]);
    fireEvent.change(await screen.findByLabelText("名称"), { target: { value: "零食" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(confirmSpy).toHaveBeenCalledWith("这项修改会影响所有币种账本");
    expect(h.addCategory).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
