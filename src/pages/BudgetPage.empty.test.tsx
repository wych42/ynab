// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Bootstrap, BudgetData, CurrencyRecord } from "../types";

const SUPPORTED: CurrencyRecord[] = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
  { code: "SGD", exponent: 2, enabledByDefault: true },
  { code: "EUR", exponent: 2, enabledByDefault: true },
  { code: "JPY", exponent: 0, enabledByDefault: true },
];

function budgetData(month: string, currencyCode: string): BudgetData {
  return {
    month,
    currencyCode,
    months: ["2026-07", "2026-08", "2026-09"],
    maxMonth: "2027-08",
    readyToAssign: 0,
    incomeThisMonth: 0,
    assignedTotal: 0,
    overspentTotal: 0,
    uncategorizedCount: 0,
    ageOfMoney: 0,
    groups: [
      {
        id: "g1",
        name: "Everyday",
        virtual: false,
        categories: [
          {
            id: "cat-1",
            name: "Groceries",
            assigned: 0,
            activity: 0,
            available: 0,
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
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  api: {
    budget: (...args: unknown[]) => h.budget(...args),
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
      id: "acc-cny",
      name: "家庭日常",
      type: "checking",
      on_budget: 1,
      closed: 0,
      starting_balance: 10000000,
      starting_balance_date: null,
      sort_order: 0,
      created_at: "",
      balance: 10000000,
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
  window.location.hash = "#/budget?currency=EUR";
  h.boot = boot;
  h.budget.mockReset();
  h.budget.mockImplementation((month: string, currency?: string) =>
    Promise.resolve(budgetData(month, currency ?? "EUR")),
  );
});

afterEach(cleanup);

describe("BudgetPage empty ledger", () => {
  it("does not render a zero category table when EUR has no on-budget accounts", async () => {
    render(<BudgetPage />);

    expect(await screen.findByText("EUR 还没有预算内账户")).toBeTruthy();
    expect(screen.getByText("创建 EUR 账户")).toBeTruthy();
    expect(screen.getByText("切换预算账本")).toBeTruthy();
    expect(screen.getByLabelText("预算账本")).toBeTruthy();
    expect(screen.queryByText("Groceries")).toBeNull();
    expect(screen.queryByText("欢迎使用小文预算")).toBeNull();
  });
});
