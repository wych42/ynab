// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatMoney } from "../money";
import type { Account, Tx } from "../types";

const SUPPORTED = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
  { code: "SGD", exponent: 2, enabledByDefault: true },
  { code: "EUR", exponent: 2, enabledByDefault: true },
  { code: "JPY", exponent: 0, enabledByDefault: true },
];

const h = vi.hoisted(() => ({
  transactions: vi.fn(),
  setTxCategory: vi.fn(),
  bulkSetCategory: vi.fn(),
  bulkDeleteTx: vi.fn(),
  deleteTx: vi.fn(),
  setTxStatus: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    transactions: (...args: unknown[]) => h.transactions(...args),
    setTxCategory: h.setTxCategory,
    bulkSetCategory: h.bulkSetCategory,
    bulkDeleteTx: h.bulkDeleteTx,
    deleteTx: h.deleteTx,
    setTxStatus: h.setTxStatus,
  },
}));

function account(partial: Partial<Account> & Pick<Account, "id" | "name" | "currencyCode">): Account {
  return {
    type: "cash",
    on_budget: 1,
    closed: 0,
    starting_balance: 0,
    starting_balance_date: "2026-08-01",
    sort_order: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    balance: 0,
    ...partial,
  };
}

vi.mock("../store", async () => {
  const { makeT } = await import("../i18n");
  return {
    useApp: () => ({
      boot: {
        settings: { currencySymbol: "¥", language: "zh", reportingCurrency: "CNY", timezone: "UTC" },
        accounts: [
          account({ id: "acc-usd", name: "USD 信用卡", currencyCode: "USD" }),
          account({ id: "acc-jpy", name: "日元现金", currencyCode: "JPY" }),
          account({ id: "acc-sgd", name: "SGD 日常", currencyCode: "SGD" }),
          account({ id: "acc-cny", name: "家庭 CNY", currencyCode: "CNY" }),
        ],
        payees: [],
        groups: [],
        currentMonth: "2026-08",
        supportedCurrencies: SUPPORTED,
        enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
      },
      t: makeT("zh"),
      lang: "zh",
      refreshBoot: h.refreshBoot,
      toast: h.toast,
    }),
  };
});

import { TransactionsPage } from "./TransactionsPage";

function tx(partial: Partial<Tx>): Tx {
  return {
    id: "tx-x",
    accountId: "acc-usd",
    date: "2026-08-20",
    payeeName: "Paris cafe",
    isStart: false,
    transferAccountId: null,
    otherAccountName: null,
    otherAccountType: null,
    categoryId: null,
    categoryName: null,
    memo: null,
    amount: -2200,
    cleared: 0,
    reconciled: 0,
    account_name: "USD 信用卡",
    currencyCode: "USD",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.transactions.mockResolvedValue({ total: 0, transactions: [] });
  h.refreshBoot.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("TransactionsPage 按账户币种显示金额", () => {
  it("formats each row in its account currency and shows the original EUR amount", async () => {
    h.transactions.mockResolvedValue({
      total: 2,
      transactions: [
        tx({
          id: "tx-usd",
          payeeName: "Paris cafe",
          amount: -2200,
          currencyCode: "USD",
          originalCurrencyCode: "EUR",
          originalAmountMinor: 2000,
        }),
        tx({
          id: "tx-jpy",
          accountId: "acc-jpy",
          account_name: "日元现金",
          payeeName: "便利店",
          amount: -1234,
          currencyCode: "JPY",
        }),
      ],
    });

    render(<TransactionsPage />);
    expect(await screen.findByText("Paris cafe")).toBeTruthy();
    expect(screen.getByText(formatMoney(2200, "USD", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(2000, "EUR", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText("账户入账")).toBeTruthy();
    expect(screen.getByText("商户计价")).toBeTruthy();
    expect(screen.getByText(formatMoney(1234, "JPY", { locale: "zh-CN" }))).toBeTruthy();
    expect(formatMoney(1234, "JPY", { locale: "zh-CN" })).not.toMatch(/\./);
    const actions = document.querySelector(".row-actions");
    expect(actions?.className).toMatch(/focus-within:opacity-100/);
  });

  it("shows the other-leg currency and amount for a cross-currency transfer", async () => {
    h.transactions.mockResolvedValue({
      total: 1,
      transactions: [
        tx({
          id: "tx-fx",
          accountId: "acc-sgd",
          account_name: "SGD 日常",
          payeeName: null,
          amount: -10000,
          currencyCode: "SGD",
          transferAccountId: "acc-cny",
          otherAccountName: "家庭 CNY",
          otherAccountType: "checking",
          otherAccountCurrencyCode: "CNY",
          otherAmountMinor: 55000,
          categoryName: "换汇转出",
        }),
      ],
    });

    render(<TransactionsPage />);
    expect(await screen.findByText("转账 家庭 CNY")).toBeTruthy();
    const sgdText = formatMoney(10000, "SGD", { locale: "zh-CN" });
    const cnyText = formatMoney(55000, "CNY", { locale: "zh-CN" });
    expect(document.body.textContent).toContain(sgdText);
    expect(document.body.textContent).toContain(cnyText);
    expect(screen.getByText("转出")).toBeTruthy();
    expect(screen.getByText("入账")).toBeTruthy();
  });

  it("batch bar only shows the selected count after picking CNY and SGD rows", async () => {
    h.transactions.mockResolvedValue({
      total: 2,
      transactions: [
        tx({
          id: "tx-cny",
          accountId: "acc-cny",
          account_name: "家庭 CNY",
          payeeName: "盒马",
          amount: -10000,
          currencyCode: "CNY",
        }),
        tx({
          id: "tx-sgd",
          accountId: "acc-sgd",
          account_name: "SGD 日常",
          payeeName: "FairPrice",
          amount: -5000,
          currencyCode: "SGD",
        }),
      ],
    });

    render(<TransactionsPage />);
    expect(await screen.findByText("盒马")).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    expect(screen.getByText("已选 2 笔")).toBeTruthy();
    expect(screen.queryByText(formatMoney(15000, "CNY", { locale: "zh-CN" }))).toBeNull();
    expect(screen.queryByText(formatMoney(15000, "SGD", { locale: "zh-CN" }))).toBeNull();
  });
});
