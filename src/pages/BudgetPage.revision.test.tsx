// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, BudgetData, CurrencyRecord } from "../types";
import { formatMoney } from "../money";

const SUPPORTED: CurrencyRecord[] = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
];

const REVISION = 7;

function budgetData(month: string, assigned = 50_000, available = 30_000): BudgetData {
  return {
    month,
    currencyCode: "CNY",
    months: ["2026-07", "2026-08", "2026-09"],
    maxMonth: "2027-08",
    readyToAssign: 10_000,
    incomeThisMonth: 800000,
    assignedTotal: assigned,
    overspentTotal: available < 0 ? Math.abs(available) : 0,
    uncategorizedCount: 0,
    ageOfMoney: 12,
    revision: REVISION,
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
            activity: -20_000,
            available,
            goal: available < 0 ? null : { category_id: "cat-1", type: "monthly", target: 80_000, target_month: null },
            need: null,
            lastAssigned: 40_000,
            avgSpend: 25_000,
          },
          {
            id: "cat-2",
            name: "Dining",
            assigned: 20_000,
            activity: 0,
            available: 20_000,
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
  assign: vi.fn(),
  moveMoney: vi.fn(),
  coverOverspending: vi.fn(),
  autoAssign: vi.fn(),
  copyLastMonth: vi.fn(),
  setGoal: vi.fn(),
  clearGoal: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  api: {
    budget: (...args: unknown[]) => h.budget(...args),
    assign: (...args: unknown[]) => h.assign(...args),
    moveMoney: (...args: unknown[]) => h.moveMoney(...args),
    coverOverspending: (...args: unknown[]) => h.coverOverspending(...args),
    autoAssign: (...args: unknown[]) => h.autoAssign(...args),
    copyLastMonth: (...args: unknown[]) => h.copyLastMonth(...args),
    setGoal: (...args: unknown[]) => h.setGoal(...args),
    clearGoal: (...args: unknown[]) => h.clearGoal(...args),
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
  vi.spyOn(window, "confirm").mockReturnValue(true);
  h.boot = {
    settings: { reportingCurrency: "CNY", timezone: "UTC" },
    accounts: [
      {
        id: "acc-1",
        name: "现金",
        type: "cash",
        on_budget: 1,
        closed: 0,
        currencyCode: "CNY",
        balance: 1,
        starting_balance: 1,
        starting_balance_date: null,
        sort_order: 0,
        created_at: "",
      },
    ],
    payees: [],
    groups: [],
    currentMonth: "2026-08",
    currencyMigrationRequired: false,
    supportedCurrencies: SUPPORTED,
    enabledCurrencies: ["CNY", "USD"],
  } as unknown as Bootstrap;
  h.budget.mockReset().mockImplementation((month: string) => Promise.resolve(budgetData(month)));
  for (const fn of [h.assign, h.moveMoney, h.coverOverspending, h.autoAssign, h.copyLastMonth, h.setGoal, h.clearGoal]) {
    fn.mockReset().mockResolvedValue(budgetData("2026-08"));
  }
});

afterEach(() => {
  cleanup();
});

describe("BudgetPage write paths send expectedRevision", () => {
  it("inspector assign includes the loaded ledger revision", async () => {
    render(<BudgetPage />);
    fireEvent.click(await screen.findByText("Groceries"));
    fireEvent.click(await screen.findByText(`与上月相同 (${formatMoney(40_000, "CNY", { locale: "zh-CN" })})`));
    await waitFor(() => expect(h.assign).toHaveBeenCalledWith("2026-08", "cat-1", 40_000, "CNY", REVISION));
  });

  it("copyLastMonth includes the loaded ledger revision", async () => {
    render(<BudgetPage />);
    const copy = await screen.findAllByTitle("复制上月预算");
    fireEvent.click(copy[0]);
    await waitFor(() => expect(h.copyLastMonth).toHaveBeenCalledWith("2026-08", "CNY", REVISION));
  });

  it("autoAssign includes the loaded ledger revision", async () => {
    render(<BudgetPage />);
    fireEvent.click(await screen.findByText("待分配金额"));
    fireEvent.click(screen.getAllByRole("button", { name: "一键分配至目标" })[0]);
    await waitFor(() => expect(h.autoAssign).toHaveBeenCalledWith("2026-08", "CNY", REVISION));
  });

  it("moveMoney includes the loaded ledger revision", async () => {
    render(<BudgetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "移动资金" }));
    fireEvent.change(screen.getByLabelText("从"), { target: { value: "cat-1" } });
    fireEvent.change(screen.getByLabelText("到"), { target: { value: "cat-2" } });
    fireEvent.change(screen.getByLabelText("金额"), { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: "移动" }));
    await waitFor(() => expect(h.moveMoney).toHaveBeenCalledWith("2026-08", "cat-1", "cat-2", 100, "CNY", REVISION));
  });

  it("coverOverspending includes the loaded ledger revision", async () => {
    h.budget.mockImplementation((month: string) => Promise.resolve(budgetData(month, 50_000, -1_000)));
    render(<BudgetPage />);
    fireEvent.click(await screen.findByRole("button", { name: /超支/ }));
    fireEvent.click(await screen.findByRole("button", { name: "弥补超支" }));
    await waitFor(() => expect(h.coverOverspending).toHaveBeenCalledWith("2026-08", "cat-1", "rta", "CNY", REVISION));
  });

  it("setGoal includes the loaded ledger revision", async () => {
    h.budget.mockImplementation((month: string) => Promise.resolve(budgetData(month, 50_000, 30_000)));
    const emptyGoal = budgetData("2026-08");
    emptyGoal.groups[0].categories[0].goal = null;
    h.budget.mockImplementation((month: string) => Promise.resolve({ ...emptyGoal, month }));
    render(<BudgetPage />);
    fireEvent.click(await screen.findByText("Groceries"));
    fireEvent.change(await screen.findByLabelText("目标类型"), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText("目标金额"), { target: { value: "80.00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(h.setGoal).toHaveBeenCalledWith(
        "cat-1",
        { type: "monthly", target: 8000, targetMonth: null },
        "CNY",
        REVISION,
      ),
    );
  });

  it("clearGoal includes the loaded ledger revision", async () => {
    render(<BudgetPage />);
    fireEvent.click(await screen.findByText("Groceries"));
    fireEvent.click(await screen.findByRole("button", { name: "移除目标" }));
    await waitFor(() => expect(h.clearGoal).toHaveBeenCalledWith("cat-1", "CNY", REVISION));
  });
});
