// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Account, CurrencyRecord, InvestmentAccountView, Tx } from "../types";
import { formatMoney } from "../money";
import { dicts } from "../i18n";

const SUPPORTED: CurrencyRecord[] = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
  { code: "SGD", exponent: 2, enabledByDefault: true },
  { code: "CAD", exponent: 2, enabledByDefault: false },
  { code: "EUR", exponent: 2, enabledByDefault: true },
  { code: "GBP", exponent: 2, enabledByDefault: false },
  { code: "JPY", exponent: 0, enabledByDefault: true },
];

const h = vi.hoisted(() => ({
  accountRegister: vi.fn(),
  investmentAccount: vi.fn(),
  reconcile: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  accounts: [] as Account[],
  transactionsById: {} as Record<string, Tx[]>,
  pendingInvestment: [] as Array<(value: InvestmentAccountView) => void>,
}));

vi.mock("../api", () => ({
  api: {
    accountRegister: (...args: unknown[]) => h.accountRegister(...args),
    investmentAccount: (...args: unknown[]) => h.investmentAccount(...args),
    reconcile: (...args: unknown[]) => h.reconcile(...args),
    updateAccount: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: {
      settings: { currencySymbol: "¥", language: "zh", reportingCurrency: "CNY", timezone: "UTC" },
      accounts: h.accounts,
      payees: [],
      groups: [],
      currentMonth: "2026-08",
      supportedCurrencies: SUPPORTED,
      enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
    },
    t: (k: string) => k,
    lang: "zh" as const,
    refreshBoot: h.refreshBoot,
    toast: h.toast,
  }),
}));

import { AccountDetailPage } from "./AccountDetailPage";

function baseAccount(id: string, name: string, extra: Partial<Account> = {}): Account & { balance: number } {
  return {
    id,
    name,
    type: extra.type ?? "checking",
    on_budget: extra.on_budget ?? 1,
    closed: 0,
    starting_balance: extra.starting_balance ?? extra.balance ?? 0,
    starting_balance_date: extra.starting_balance_date ?? "2026-01-01",
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    balance: extra.balance ?? extra.starting_balance ?? 0,
    currencyCode: extra.currencyCode ?? "USD",
    ...extra,
  };
}

function investmentView(overrides: Partial<InvestmentAccountView> = {}): InvestmentAccountView {
  const accountId = overrides.accountId ?? "inv-usd";
  const balanceMinor = overrides.balanceMinor ?? 1_100_000;
  return {
    accountId,
    name: overrides.name ?? "USD 投资账户",
    currencyCode: overrides.currencyCode ?? "USD",
    asOf: overrides.asOf ?? "2026-08-20",
    months: overrides.months ?? 12,
    balanceMinor,
    contributionsMinor: overrides.contributionsMinor ?? 10_000,
    withdrawalsMinor: overrides.withdrawalsMinor ?? 4_000,
    netContributionsMinor: overrides.netContributionsMinor ?? 6_000,
    balanceChangeMinor: overrides.balanceChangeMinor ?? 100_000,
    latestValuationDate: overrides.latestValuationDate === undefined ? "2026-08-20" : overrides.latestValuationDate,
    history: overrides.history ?? [
      { month: "2026-07", asOf: "2026-07-31", balanceMinor: 1_000_000 },
      { month: "2026-08", asOf: "2026-08-20", balanceMinor },
    ],
  };
}

function usd(amount: number) {
  return formatMoney(amount, "USD", { locale: "zh-CN" });
}

beforeEach(() => {
  h.accounts = [
    baseAccount("inv-usd", "USD 投资账户", {
      type: "investment",
      on_budget: 0,
      starting_balance: 1_000_000,
      balance: 1_100_000,
      currencyCode: "USD",
    }),
    baseAccount("acc-cny", "家庭 CNY", { type: "checking", currencyCode: "CNY", starting_balance: 10000, balance: 10000 }),
  ];
  h.transactionsById = { "inv-usd": [], "acc-cny": [] };
  h.pendingInvestment = [];
  h.refreshBoot.mockReset().mockResolvedValue({});
  h.toast.mockReset();
  h.reconcile.mockReset().mockResolvedValue({ ok: true, adjustment: 100_000 });
  h.accountRegister.mockReset().mockImplementation(async (id: unknown) => {
    const account = h.accounts.find((row) => row.id === id);
    return { account, transactions: h.transactionsById[String(id)] ?? [] };
  });
  h.investmentAccount.mockReset().mockResolvedValue(investmentView());
});

afterEach(cleanup);

describe("AccountDetailPage investment summary", () => {
  it("shows a native-currency summary only for investment accounts", async () => {
    render(<AccountDetailPage id="inv-usd" />);
    expect(await screen.findByText("inv_balance")).toBeTruthy();
    expect(screen.getByText("inv_balanceChange")).toBeTruthy();
    expect(screen.getByText("inv_contributions")).toBeTruthy();
    expect(screen.getByText("inv_withdrawals")).toBeTruthy();
    expect(screen.getByText("inv_netContributions")).toBeTruthy();
    expect(screen.getByText("inv_latestValuation")).toBeTruthy();
    expect(screen.getByText("inv_history")).toBeTruthy();
    expect(screen.getByText("2026-08-20")).toBeTruthy();
    expect(screen.getByText("2026-07")).toBeTruthy();
    expect(screen.getAllByText(usd(1_100_000)).length).toBeGreaterThan(0);
    expect(screen.getByText(usd(100_000))).toBeTruthy();
    expect(screen.getByText(usd(10_000))).toBeTruthy();
    expect(screen.getByText(usd(4_000))).toBeTruthy();
    expect(screen.getByText(usd(6_000))).toBeTruthy();
    expect(screen.getByText("account_updateValuation")).toBeTruthy();
    expect(screen.queryByText("account_reconcile")).toBeNull();
    await waitFor(() =>
      expect(h.investmentAccount).toHaveBeenCalledWith(
        "inv-usd",
        expect.objectContaining({ months: 12, asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      ),
    );

    cleanup();
    h.investmentAccount.mockClear();
    render(<AccountDetailPage id="acc-cny" />);
    expect(await screen.findByText("家庭 CNY")).toBeTruthy();
    expect(screen.queryByText("inv_balance")).toBeNull();
    expect(screen.queryByText("inv_history")).toBeNull();
    expect(screen.getByText("account_reconcile")).toBeTruthy();
    expect(h.investmentAccount).not.toHaveBeenCalled();
  });

  it("shows an empty valuation state when the account has never been valued", async () => {
    h.investmentAccount.mockResolvedValue(investmentView({ latestValuationDate: null, balanceChangeMinor: 0, balanceMinor: 1_000_000 }));
    h.accounts[0] = { ...h.accounts[0], balance: 1_000_000 };
    render(<AccountDetailPage id="inv-usd" />);
    expect(await screen.findByText("inv_noValuation")).toBeTruthy();
    expect(screen.queryByText("2026-08-20")).toBeNull();
  });

  it("updates valuation through the existing reconcile API and refreshes register, summary and bootstrap", async () => {
    const after = investmentView({ balanceMinor: 1_250_000, balanceChangeMinor: 250_000, latestValuationDate: "2026-08-31" });
    h.investmentAccount.mockResolvedValueOnce(investmentView()).mockResolvedValueOnce(after);
    h.accountRegister
      .mockResolvedValueOnce({ account: h.accounts[0], transactions: [] })
      .mockResolvedValueOnce({ account: { ...h.accounts[0], balance: 1_250_000 }, transactions: [] });

    render(<AccountDetailPage id="inv-usd" />);
    fireEvent.click(await screen.findByText("account_updateValuation"));
    const input = (await screen.findByLabelText("rec_marketValue")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12500.00" } });
    fireEvent.click(screen.getByText("common_confirm"));

    await waitFor(() =>
      expect(h.reconcile).toHaveBeenCalledWith("inv-usd", { statementBalance: 1_250_000, markCleared: true }),
    );
    await waitFor(() => expect(h.refreshBoot).toHaveBeenCalled());
    expect(h.accountRegister).toHaveBeenCalledTimes(2);
    expect(h.investmentAccount).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(usd(250_000))).toBeTruthy();
    expect(screen.getAllByText(usd(1_250_000)).length).toBeGreaterThan(0);
  });

  it("ignores a late investment summary after switching accounts", async () => {
    const oldView = investmentView({
      accountId: "inv-old",
      name: "旧投资",
      balanceMinor: 1_000_000,
      contributionsMinor: 1,
      withdrawalsMinor: 0,
      netContributionsMinor: 1,
      balanceChangeMinor: 0,
    });
    const newView = investmentView({
      accountId: "inv-new",
      name: "新投资",
      balanceMinor: 2_200_000,
      contributionsMinor: 8_800,
      withdrawalsMinor: 0,
      netContributionsMinor: 8_800,
      balanceChangeMinor: 200_000,
      latestValuationDate: "2026-08-18",
      history: [{ month: "2026-08", asOf: "2026-08-18", balanceMinor: 2_200_000 }],
    });
    h.accounts = [
      baseAccount("inv-old", "旧投资", { type: "investment", on_budget: 0, balance: 1_000_000, currencyCode: "USD" }),
      baseAccount("inv-new", "新投资", { type: "investment", on_budget: 0, balance: 2_200_000, currencyCode: "USD" }),
    ];
    h.investmentAccount.mockImplementation((id: unknown) => {
      if (id === "inv-old") {
        return new Promise<InvestmentAccountView>((resolve) => h.pendingInvestment.push(resolve));
      }
      return Promise.resolve(newView);
    });

    const { rerender } = render(<AccountDetailPage id="inv-old" />);
    await waitFor(() => expect(h.pendingInvestment.length).toBeGreaterThan(0));
    rerender(<AccountDetailPage id="inv-new" />);
    expect(await screen.findByText("新投资")).toBeTruthy();
    expect(screen.getAllByText(usd(2_200_000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(usd(8_800)).length).toBeGreaterThan(0);
    expect(screen.getByText(usd(200_000))).toBeTruthy();
    for (const resolve of h.pendingInvestment.splice(0)) resolve(oldView);
    await waitFor(() => {
      expect(screen.getByText("新投资")).toBeTruthy();
    });
    expect(screen.queryByText("旧投资")).toBeNull();
    expect(screen.queryByText(usd(1_000_000))).toBeNull();
    expect(screen.queryByText(usd(1))).toBeNull();
  });

  it("does not present return, holdings, quantity, cost basis or tax fields", async () => {
    render(<AccountDetailPage id="inv-usd" />);
    expect(await screen.findByText("inv_balanceChange")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/收益|持仓|数量|成本基础|税务|holdings|quantity|cost basis|\breturn\b|\bprofit\b|\btax\b/i);
    expect(dicts.zh.inv_balanceChange).not.toMatch(/收益|回报/);
    expect(dicts.en.inv_balanceChange.toLowerCase()).not.toMatch(/return|profit/);
    expect(dicts.zh.account_updateValuation).toBe("更新估值");
    expect(dicts.en.account_updateValuation).toBe("Update valuation");
  });
});
