// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, BudgetData, CurrencyRecord } from "../types";
import { formatMoney } from "../money";

const SUPPORTED: CurrencyRecord[] = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
  { code: "SGD", exponent: 2, enabledByDefault: true },
  { code: "CAD", exponent: 2, enabledByDefault: false },
  { code: "EUR", exponent: 2, enabledByDefault: true },
  { code: "GBP", exponent: 2, enabledByDefault: false },
  { code: "JPY", exponent: 0, enabledByDefault: true },
];

function budgetData(month: string, currencyCode: string, readyToAssign: number, assigned: number): BudgetData {
  return {
    month,
    currencyCode,
    months: ["2026-07", "2026-08", "2026-09"],
    maxMonth: "2027-08",
    readyToAssign,
    incomeThisMonth: 800000,
    assignedTotal: assigned,
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
  moveMoney: vi.fn(),
  coverOverspending: vi.fn(),
  autoAssign: vi.fn(),
  copyLastMonth: vi.fn(),
  setGoal: vi.fn(),
  budgetCalls: [] as { month: string; currency?: string }[],
  pendingCny: [] as Array<(value: BudgetData) => void>,
  activeCurrency: "CNY",
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
  },
}));

vi.mock("../store", () => {
  const t = (k: string) => k;
  const toast = vi.fn();
  const setLang = vi.fn();
  const refreshBoot = vi.fn().mockResolvedValue({});
  const setActiveCurrency = (code: string) => {
    h.activeCurrency = code;
  };
  return {
    useApp: () => ({
      boot: h.boot,
      loading: false,
      lang: "zh" as const,
      t,
      toast,
      setLang,
      refreshBoot,
      activeCurrency: h.activeCurrency,
      setActiveCurrency,
    }),
  };
});

import { BudgetPage } from "./BudgetPage";

const boot: Bootstrap = {
  settings: {
    currencySymbol: "¥",
    language: "zh",
    reportingCurrency: "CNY",
    timezone: "UTC",
    aiBaseUrl: "",
    aiModel: "",
    aiKey: "",
    aiExtraPrompt: "",
    aiRequireConfirmation: true,
    backupEnabled: false,
    backupCronTime: "03:00",
    backupR2Endpoint: "",
    backupR2Bucket: "",
    backupR2Prefix: "",
    backupR2AccessKeyId: "",
    backupR2HasSecret: false,
    backupLastRunAt: null,
    backupLastResult: null,
  },
  accounts: [
    {
      id: "acc-1",
      name: "现金钱包",
      type: "cash",
      on_budget: 1,
      closed: 0,
      starting_balance: 10000,
      starting_balance_date: null,
      sort_order: 0,
      created_at: "",
      balance: 10000,
      currencyCode: "CNY",
    },
  ],
  payees: [],
  groups: [],
  currentMonth: "2026-08",
  currencyMigrationRequired: false,
  supportedCurrencies: SUPPORTED,
  enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
};

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  localStorage.clear();
  h.activeCurrency = "CNY";
  h.boot = boot;
  h.budgetCalls = [];
  for (const resolve of h.pendingCny) resolve(budgetData("2026-08", "CNY", 0, 0));
  h.pendingCny = [];
  h.budget.mockReset();
  h.assign.mockReset();
  h.budget.mockImplementation((month: string, currency?: string) => {
    h.budgetCalls.push({ month, currency });
    const ready = currency === "SGD" ? 12 : 9_999_900;
    const assigned = currency === "JPY" ? 1234 : currency === "SGD" ? 7 : 50_000;
    return Promise.resolve(budgetData(month, currency ?? "CNY", ready, assigned));
  });
  h.assign.mockImplementation(async (month: string, categoryId: string, amount: number, currency: string) =>
    budgetData(month, currency, 1, amount)
  );
});

afterEach(cleanup);

describe("BudgetPage 按活动币种请求并展示", () => {
  it("每个月份请求都带上当前活动币种，并显示该币种代码", async () => {
    render(<BudgetPage />);
    expect(await screen.findByText("CNY")).toBeTruthy();
    await waitFor(() => expect(h.budgetCalls.length).toBe(3));
    expect(h.budgetCalls.map((call) => call.month).sort()).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(h.budgetCalls.every((call) => call.currency === "CNY")).toBe(true);
    expect(screen.getAllByText(formatMoney(9_999_900, "CNY", { locale: "zh-CN" })).length).toBeGreaterThan(0);
  });

  it("切换币种时先清掉旧窗口，不会把 CNY 金额当成 SGD 展示，并忽略迟到的 CNY 响应", async () => {
    h.budget.mockImplementation((month: string, currency?: string) => {
      h.budgetCalls.push({ month, currency });
      if (currency !== "SGD") {
        return new Promise<BudgetData>((resolve) => h.pendingCny.push(resolve));
      }
      return Promise.resolve(budgetData(month, "SGD", 12, 7));
    });

    const { rerender } = render(<BudgetPage />);
    await waitFor(() => expect(h.pendingCny.length).toBeGreaterThan(0));

    h.activeCurrency = "SGD";
    rerender(<BudgetPage />);
    expect(await screen.findByText("SGD")).toBeTruthy();
    expect(screen.queryByText("CNY")).toBeNull();
    expect(screen.queryByText(formatMoney(9_999_900, "CNY", { locale: "zh-CN" }))).toBeNull();

    const stale = h.pendingCny.splice(0);
    for (const resolve of stale) resolve(budgetData("2026-08", "CNY", 9_999_900, 50_000));
    await waitFor(() => {
      expect(screen.queryByText(formatMoney(9_999_900, "CNY", { locale: "zh-CN" }))).toBeNull();
    });
    expect(screen.getByText("SGD")).toBeTruthy();
    expect(h.budgetCalls.filter((call) => call.currency === "SGD").length).toBeGreaterThanOrEqual(3);
  });

  it("分配写入带上活动币种，两位小数币种保留最小单位", async () => {
    render(<BudgetPage />);
    const formatted = formatMoney(50_000, "CNY", { locale: "zh-CN" });
    const buttons = await screen.findAllByRole("button", { name: formatted });
    fireEvent.click(buttons[1] ?? buttons[0]);
    const input = await screen.findByDisplayValue("500.00");
    fireEvent.change(input, { target: { value: "12.34" } });
    fireEvent.blur(input);
    await waitFor(() => expect(h.assign).toHaveBeenCalledWith("2026-08", "cat-1", 1234, "CNY"));
  });

  it("日元分配没有小数输入和展示", async () => {
    h.activeCurrency = "JPY";
    render(<BudgetPage />);
    expect(await screen.findByText("JPY")).toBeTruthy();
    const formatted = formatMoney(1234, "JPY", { locale: "zh-CN" });
    expect(formatted).not.toMatch(/\./);
    const buttons = await screen.findAllByRole("button", { name: formatted });
    fireEvent.click(buttons[1] ?? buttons[0]);
    const input = await screen.findByDisplayValue("1234");
    expect((input as HTMLInputElement).value).toBe("1234");
    fireEvent.change(input, { target: { value: "1234.5" } });
    fireEvent.blur(input);
    await waitFor(() => expect(h.assign).not.toHaveBeenCalled());
  });
});
