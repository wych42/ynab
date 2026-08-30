// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Account, CurrencyRecord, Tx } from "../types";
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

const h = vi.hoisted(() => ({
  accountRegister: vi.fn(),
  updateAccount: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  account: null as (Account & { balance: number }) | null,
  transactions: [] as Tx[],
}));

vi.mock("../api", () => {
  class ApiError extends Error {
    code?: string;
    status?: number;
  }
  return {
    ApiError,
    api: {
      accountRegister: (...args: unknown[]) => h.accountRegister(...args),
      updateAccount: (...args: unknown[]) => h.updateAccount(...args),
    },
  };
});

vi.mock("../store", () => ({
  useApp: () => ({
    boot: {
      settings: { currencySymbol: "¥", language: "zh", reportingCurrency: "CNY", timezone: "UTC" },
      accounts: h.account ? [h.account] : [],
      payees: [],
      groups: [],
      currentMonth: "2026-08",
      supportedCurrencies: SUPPORTED,
      enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
    },
    t: (k: string) => k,
    lang: "zh",
    refreshBoot: h.refreshBoot,
    toast: h.toast,
  }),
}));

import { AccountDetailPage } from "./AccountDetailPage";
import { ApiError } from "../api";

function jpyAccount(balance: number): Account & { balance: number } {
  return {
    id: "acc-jpy",
    name: "日元现金",
    type: "cash",
    on_budget: 1,
    closed: 0,
    starting_balance: balance,
    starting_balance_date: "2026-08-01",
    sort_order: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    balance,
    currencyCode: "JPY",
  };
}

beforeEach(() => {
  h.updateAccount.mockReset().mockResolvedValue({});
  h.refreshBoot.mockReset().mockResolvedValue({});
  h.toast.mockReset();
  h.account = jpyAccount(0);
  h.transactions = [];
  h.accountRegister.mockReset().mockImplementation(async () => ({
    account: h.account,
    transactions: h.transactions,
  }));
});

afterEach(cleanup);

describe("AccountDetailPage 按账户币种格式化并允许修改空账户币种", () => {
  it("账户余额和流水按 JPY 格式化，不出现两位小数", async () => {
    h.account = jpyAccount(1234);
    h.transactions = [
      {
        id: "tx-1",
        accountId: "acc-jpy",
        date: "2026-08-02",
        payeeName: "便利店",
        isStart: false,
        transferAccountId: null,
        otherAccountName: null,
        otherAccountType: null,
        categoryId: null,
        categoryName: null,
        memo: "",
        amount: -234,
        cleared: 1,
        reconciled: 0,
        balance: 1000,
      },
    ];

    render(<AccountDetailPage id="acc-jpy" />);
    expect(await screen.findByText(formatMoney(1234, "JPY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(234, "JPY", { locale: "zh-CN" }))).toBeTruthy();
    expect(formatMoney(1234, "JPY", { locale: "zh-CN" })).not.toMatch(/\./);
  });

  it("空账户可以提交币种修改", async () => {
    h.account = jpyAccount(0);
    render(<AccountDetailPage id="acc-jpy" />);
    const select = (await screen.findByLabelText("account_currency")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "USD" } });
    await waitFor(() => expect(h.updateAccount).toHaveBeenCalledWith("acc-jpy", { currencyCode: "USD" }));
  });

  it("锁定修改时展示服务端稳定错误", async () => {
    const err = new ApiError("account_currency_locked");
    err.code = "account_currency_locked";
    err.status = 400;
    h.updateAccount.mockRejectedValue(err);
    h.account = jpyAccount(0);

    render(<AccountDetailPage id="acc-jpy" />);
    fireEvent.change(await screen.findByLabelText("account_currency"), { target: { value: "USD" } });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("account_currencyLocked", "err"));
  });
});
