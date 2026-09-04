// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Account } from "../types";
import { formatMoney } from "../money";

const h = vi.hoisted(() => ({
  accounts: [] as Account[],
  setLang: vi.fn(),
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: {
      settings: { currencySymbol: "¥", reportingCurrency: "CNY" },
      accounts: h.accounts,
      enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
    },
    t: (k: string) => k,
    lang: "zh",
    setLang: h.setLang,
  }),
}));

import { Sidebar } from "./Sidebar";

beforeEach(() => {
  h.accounts = [];
  h.setLang.mockReset();
  localStorage.clear();
});

afterEach(cleanup);

describe("Sidebar 账户行按账户币种格式化", () => {
  it("各行使用自己的 currencyCode，不把异币余额加总", () => {
    h.accounts = [
      {
        id: "cny-1",
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
      {
        id: "jpy-1",
        name: "日元现金",
        type: "cash",
        on_budget: 1,
        closed: 0,
        starting_balance: 100000,
        starting_balance_date: null,
        sort_order: 0,
        created_at: "",
        balance: 100000,
        currencyCode: "JPY",
      },
    ];

    render(<Sidebar route="#/accounts" open />);

    expect(screen.getByText("家庭日常")).toBeTruthy();
    expect(screen.getAllByText(formatMoney(10000000, "CNY", { locale: "zh-CN" })).length).toBe(2);
    expect(screen.getAllByText(formatMoney(100000, "JPY", { locale: "zh-CN" })).length).toBe(2);
    expect(screen.queryByText(formatMoney(10100000, "CNY", { locale: "zh-CN" }))).toBeNull();
    expect(screen.getAllByText("CNY").length).toBeGreaterThan(0);
    expect(screen.getAllByText("JPY").length).toBeGreaterThan(0);
  });
});

describe("Sidebar 不再提供全局币种选择器", () => {
  it("没有 sidebar_budgetCurrency，语言切换仍在", () => {
    render(<Sidebar route="#/budget" open />);

    expect(screen.queryByLabelText("sidebar_budgetCurrency")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("中文")).toBeTruthy();
    expect(screen.getByText("EN")).toBeTruthy();
  });

  it("预算导航可以带最近账本查询，点击本身不切换账本", () => {
    localStorage.setItem("activeBudgetCurrency", "SGD");
    render(<Sidebar route="#/accounts" open />);
    const budget = screen.getByRole("link", { name: "nav_budget" });
    expect(budget.getAttribute("href")).toBe("#/budget?currency=SGD");
  });
});
