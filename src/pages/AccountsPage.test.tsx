// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Account, Bootstrap, CurrencyRecord } from "../types";
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

function account(partial: Partial<Account> & Pick<Account, "id" | "name" | "type" | "balance" | "currencyCode">): Account {
  return {
    on_budget: 1,
    closed: 0,
    starting_balance: partial.balance,
    starting_balance_date: "2026-08-01",
    sort_order: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

const h = vi.hoisted(() => ({
  createAccount: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  boot: {
    settings: {
      currencySymbol: "¥",
      language: "zh",
      reportingCurrency: "CNY",
      timezone: "UTC",
    },
    accounts: [] as Account[],
    payees: [],
    groups: [],
    currentMonth: "2026-08",
    currencyMigrationRequired: false,
    supportedCurrencies: [] as CurrencyRecord[],
    enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
  },
}));

vi.mock("../api", () => ({
  api: {
    createAccount: (...a: unknown[]) => h.createAccount(...a),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: h.boot,
    lang: "zh",
    t: (k: string, v?: Record<string, string | number>) => {
      const mapped: Record<string, string> = { account_tagOnBudget: "预算内", account_tagOffBudget: "预算外" };
      const base = mapped[k] ?? k;
      return v ? `${base}:${JSON.stringify(v)}` : base;
    },
    refreshBoot: h.refreshBoot,
    toast: h.toast,
  }),
}));

import { AccountsPage } from "./AccountsPage";

beforeEach(() => {
  for (const fn of [h.createAccount, h.refreshBoot, h.toast]) fn.mockReset();
  h.refreshBoot.mockResolvedValue({});
  h.createAccount.mockResolvedValue({ id: "a1" });
  h.boot.settings.reportingCurrency = "CNY";
  h.boot.supportedCurrencies = SUPPORTED;
  h.boot.enabledCurrencies = ["CNY", "USD", "SGD", "EUR", "JPY"];
  h.boot.accounts = [];
});

afterEach(cleanup);

describe("AccountsPage 新建账户弹窗", () => {
  it("类型下拉的每个选项都标注预算内/预算外", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "account_add" }));
    const select = (await screen.findByLabelText("account_type")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "支票账户 · 预算内",
      "储蓄账户 · 预算内",
      "现金 · 预算内",
      "信用卡 · 预算内",
      "信用额度 · 预算外",
      "投资账户 · 预算外",
      "房产 · 预算外",
      "车辆 · 预算外",
      "其他资产 · 预算外",
      "助学贷款 · 预算外",
      "个人贷款 · 预算外",
      "其他负债 · 预算外",
    ]);
  });

  it("选择带标注的类型后提交，仍发送对应的类型值", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "account_add" }));
    const nameInput = await screen.findByLabelText("account_name");
    fireEvent.change(nameInput, { target: { value: "工资卡" } });
    fireEvent.change(screen.getByLabelText("account_type"), { target: { value: "savings" } });
    fireEvent.click(screen.getByRole("button", { name: "account_create" }));
    await waitFor(() =>
      expect(h.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ name: "工资卡", type: "savings" })
      )
    );
  });

  it("币种选项来自 Bootstrap 目录，默认取汇总币种，并发送 startingBalanceMinor", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "account_add" }));
    const currency = (await screen.findByLabelText("account_currency")) as HTMLSelectElement;
    expect(currency.value).toBe("CNY");
    expect([...currency.options].map((o) => o.value)).toEqual(SUPPORTED.map((item) => item.code));
    expect([...currency.options].map((o) => o.value)).toEqual(expect.arrayContaining(["CAD", "GBP"]));

    fireEvent.change(screen.getByLabelText("account_name"), { target: { value: "美元卡" } });
    fireEvent.change(currency, { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("account_startBalance"), { target: { value: "12.34" } });
    fireEvent.click(screen.getByRole("button", { name: "account_create" }));

    await waitFor(() =>
      expect(h.createAccount).toHaveBeenCalledWith({
        name: "美元卡",
        type: "checking",
        currencyCode: "USD",
        startingBalanceMinor: 1234,
        startingDate: expect.any(String),
      })
    );
  });

  it("JPY 拒绝小数输入，且不调用创建接口", async () => {
    render(<AccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "account_add" }));
    fireEvent.change(await screen.findByLabelText("account_name"), { target: { value: "日元现金" } });
    fireEvent.change(screen.getByLabelText("account_currency"), { target: { value: "JPY" } });
    fireEvent.change(screen.getByLabelText("account_startBalance"), { target: { value: "123.4" } });
    fireEvent.click(screen.getByRole("button", { name: "account_create" }));

    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    expect(h.createAccount).not.toHaveBeenCalled();
  });
});

describe("AccountsPage 按账户币种展示，不把异币余额加在一起", () => {
  it("预算内分组按币种小计，JPY 不显示小数", async () => {
    h.boot.accounts = [
      account({ id: "cny-1", name: "家庭日常", type: "checking", on_budget: 1, balance: 10000000, currencyCode: "CNY" }),
      account({ id: "jpy-1", name: "日元现金", type: "cash", on_budget: 1, balance: 100000, currencyCode: "JPY" }),
      account({
        id: "usd-1",
        name: "美元投资",
        type: "investment",
        on_budget: 0,
        balance: 1000000,
        currencyCode: "USD",
      }),
    ];

    render(<AccountsPage />);

    const onBudget = screen.getByText("sidebar_onBudget").closest("section");
    const tracking = screen.getByText("sidebar_tracking").closest("section");
    expect(onBudget).toBeTruthy();
    expect(tracking).toBeTruthy();

    expect(within(onBudget as HTMLElement).getByText("家庭日常")).toBeTruthy();
    expect(within(onBudget as HTMLElement).getAllByText(formatMoney(10000000, "CNY", { locale: "zh-CN" })).length).toBe(2);
    expect(within(onBudget as HTMLElement).getAllByText(formatMoney(100000, "JPY", { locale: "zh-CN" })).length).toBe(2);
    expect(within(onBudget as HTMLElement).queryByText(formatMoney(10100000, "CNY", { locale: "zh-CN" }))).toBeNull();
    expect(formatMoney(100000, "JPY", { locale: "zh-CN" })).not.toMatch(/\.00/);
    expect(within(onBudget as HTMLElement).getByText("CNY")).toBeTruthy();
    expect(within(onBudget as HTMLElement).getByText("JPY")).toBeTruthy();

    expect(within(tracking as HTMLElement).getByText("美元投资")).toBeTruthy();
    expect(within(tracking as HTMLElement).getAllByText(formatMoney(1000000, "USD", { locale: "zh-CN" })).length).toBeGreaterThan(0);
  });
});
