// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Account } from "../types";
import { formatMoney } from "../money";

const h = vi.hoisted(() => ({
  accounts: [] as Account[],
  activeCurrency: "CNY",
  setActiveCurrency: vi.fn(),
  saveSettings: vi.fn(),
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
    setLang: vi.fn(),
    activeCurrency: h.activeCurrency,
    setActiveCurrency: h.setActiveCurrency,
  }),
}));

vi.mock("../api", () => ({
  api: {
    saveSettings: (...args: unknown[]) => h.saveSettings(...args),
  },
}));

import { Sidebar } from "./Sidebar";

beforeEach(() => {
  h.activeCurrency = "CNY";
  h.setActiveCurrency.mockReset();
  h.saveSettings.mockReset();
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

describe("Sidebar 币种账本切换器", () => {
  it("用已启用币种选择器替换旧的符号编辑，切换时不保存 currencySymbol", () => {
    h.accounts = [];
    render(<Sidebar route="#/budget" open />);

    const selector = screen.getByLabelText("sidebar_budgetCurrency") as HTMLSelectElement;
    expect(selector.value).toBe("CNY");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.change(selector, { target: { value: "SGD" } });
    expect(h.setActiveCurrency).toHaveBeenCalledWith("SGD");
    expect(h.saveSettings).not.toHaveBeenCalled();
  });
});
