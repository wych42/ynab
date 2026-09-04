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

function baseAccount(
  id: string,
  name: string,
  currencyCode: string,
  extra: Partial<Account> = {},
): Account & { balance: number } {
  return {
    id,
    name,
    type: "cash",
    on_budget: 1,
    closed: 0,
    starting_balance: extra.starting_balance ?? 0,
    starting_balance_date: "2026-08-01",
    sort_order: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    balance: extra.balance ?? extra.starting_balance ?? 0,
    currencyCode,
    ...extra,
  };
}

const h = vi.hoisted(() => ({
  accountRegister: vi.fn(),
  updateAccount: vi.fn(),
  createTx: vi.fn(),
  reconcile: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  account: null as (Account & { balance: number }) | null,
  extraAccounts: [] as Account[],
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
      createTx: (...args: unknown[]) => h.createTx(...args),
      reconcile: (...args: unknown[]) => h.reconcile(...args),
    },
  };
});

vi.mock("../store", () => ({
  useApp: () => ({
    boot: {
      settings: { currencySymbol: "¥", language: "zh", reportingCurrency: "CNY", timezone: "UTC" },
      accounts: [h.account, ...h.extraAccounts].filter(Boolean),
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
  return baseAccount("acc-jpy", "日元现金", "JPY", { starting_balance: balance, balance });
}

beforeEach(() => {
  h.updateAccount.mockReset().mockResolvedValue({});
  h.createTx.mockReset().mockResolvedValue({ ok: true });
  h.reconcile.mockReset().mockResolvedValue({ ok: true, adjustment: null });
  h.refreshBoot.mockReset().mockResolvedValue({});
  h.toast.mockReset();
  h.account = jpyAccount(0);
  h.extraAccounts = [
    baseAccount("acc-cny", "家庭 CNY", "CNY"),
    baseAccount("acc-sgd", "SGD 日常", "SGD", { type: "checking" }),
    baseAccount("acc-usd", "USD 信用卡", "USD", { type: "creditCard" }),
  ];
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
    expect(screen.queryByRole("combobox", { name: "account_currency" })).toBeNull();
  });

  it("有非期初流水的账户只读显示账户币种，没有下拉", async () => {
    h.account = baseAccount("acc-usd", "美元卡", "USD", { type: "creditCard", starting_balance: -2200, balance: -2200 });
    h.transactions = [
      {
        id: "tx-usd",
        accountId: "acc-usd",
        date: "2026-08-20",
        payeeName: "Paris cafe",
        isStart: false,
        transferAccountId: null,
        otherAccountName: null,
        otherAccountType: null,
        categoryId: null,
        categoryName: null,
        memo: "",
        amount: -2200,
        cleared: 1,
        reconciled: 0,
        balance: -2200,
        currencyCode: "USD",
      },
    ];
    render(<AccountDetailPage id="acc-usd" />);
    expect(await screen.findByText("Paris cafe")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "account_currency" })).toBeNull();
    expect(screen.getByText("account_currency：USD")).toBeTruthy();
  });

  it("空账户可以提交币种修改，选项只有已启用币种", async () => {
    h.account = jpyAccount(0);
    render(<AccountDetailPage id="acc-jpy" />);
    const select = (await screen.findByLabelText("account_currency")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["CNY", "USD", "SGD", "EUR", "JPY"]);
    expect([...select.options].map((o) => o.value)).not.toContain("CAD");
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

describe("AccountDetailPage 跨币种转账、原始金额与 JPY 精度", () => {
  async function chooseTransfer(name: string) {
    const payee = await screen.findByLabelText("tx_payee");
    fireEvent.focus(payee);
    const option = await screen.findByRole("button", { name });
    fireEvent.mouseDown(option);
  }

  it("requires and submits the destination amount when the other account uses another currency", async () => {
    h.account = baseAccount("acc-sgd", "SGD 日常", "SGD", { type: "checking", starting_balance: 500000, balance: 500000 });
    render(<AccountDetailPage id="acc-sgd" />);
    await chooseTransfer("家庭 CNY");
    const dest = await screen.findByLabelText("tx_destAmount");
    fireEvent.change(screen.getByPlaceholderText("tx_outflow"), { target: { value: "100.00" } });
    fireEvent.change(dest, { target: { value: "550.00" } });
    fireEvent.keyDown(screen.getByPlaceholderText("tx_outflow"), { key: "Enter" });
    await waitFor(() =>
      expect(h.createTx).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-sgd",
          transferAccountId: "acc-cny",
          amount: -10000,
          toAmountMinor: 55000,
        })
      )
    );
  });

  it("omits destination amount for a same-currency transfer", async () => {
    h.account = baseAccount("acc-cny-src", "CNY 日常", "CNY", { type: "checking" });
    h.extraAccounts = [baseAccount("acc-cny", "家庭 CNY", "CNY")];
    render(<AccountDetailPage id="acc-cny-src" />);
    await chooseTransfer("家庭 CNY");
    expect(screen.queryByLabelText("tx_destAmount")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("tx_outflow"), { target: { value: "22.00" } });
    fireEvent.keyDown(screen.getByPlaceholderText("tx_outflow"), { key: "Enter" });
    await waitFor(() =>
      expect(h.createTx).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-cny-src",
          transferAccountId: "acc-cny",
          amount: -2200,
        })
      )
    );
    expect(h.createTx.mock.calls[0][0].toAmountMinor).toBeUndefined();
  });

  it("美元卡原始消费下拉有 GBP 和 EUR，没有账户币种 USD", async () => {
    h.account = baseAccount("acc-usd", "USD 信用卡", "USD", { type: "creditCard" });
    render(<AccountDetailPage id="acc-usd" />);
    const select = (await screen.findByLabelText("tx_originalCurrency")) as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain("GBP");
    expect(values).toContain("EUR");
    expect(values).not.toContain("USD");
  });

  it("只填商户金额不会倒推账户入账金额", async () => {
    h.account = baseAccount("acc-usd", "USD 信用卡", "USD", { type: "creditCard" });
    render(<AccountDetailPage id="acc-usd" />);
    fireEvent.change(await screen.findByLabelText("tx_originalCurrency"), { target: { value: "EUR" } });
    fireEvent.change(screen.getByLabelText("tx_originalAmount"), { target: { value: "20.00" } });
    expect((screen.getByPlaceholderText("tx_outflow") as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(screen.getByPlaceholderText("tx_outflow"), { key: "Enter" });
    await waitFor(() => expect(h.createTx).not.toHaveBeenCalled());
  });

  it("submits original EUR 20.00 with a USD booked amount of -22.00", async () => {
    h.account = baseAccount("acc-usd", "USD 信用卡", "USD", { type: "creditCard" });
    h.transactions = [
      {
        id: "tx-usd",
        accountId: "acc-usd",
        date: "2026-08-20",
        payeeName: "Paris cafe",
        isStart: false,
        transferAccountId: null,
        otherAccountName: null,
        otherAccountType: null,
        categoryId: null,
        categoryName: null,
        memo: "",
        amount: -2200,
        cleared: 1,
        reconciled: 0,
        balance: -2200,
        currencyCode: "USD",
        originalCurrencyCode: "EUR",
        originalAmountMinor: 2000,
      },
    ];
    render(<AccountDetailPage id="acc-usd" />);
    expect(await screen.findByText(formatMoney(2200, "USD", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(2000, "EUR", { locale: "zh-CN" }))).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("tx_outflow"), { target: { value: "22.00" } });
    fireEvent.change(screen.getByLabelText("tx_originalCurrency"), { target: { value: "EUR" } });
    fireEvent.change(screen.getByLabelText("tx_originalAmount"), { target: { value: "20.00" } });
    fireEvent.keyDown(screen.getByPlaceholderText("tx_outflow"), { key: "Enter" });
    await waitFor(() =>
      expect(h.createTx).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-usd",
          amount: -2200,
          originalCurrencyCode: "EUR",
          originalAmountMinor: 2000,
        })
      )
    );
  });

  it("submits JPY outflow as whole yen without inventing decimal places", async () => {
    h.account = jpyAccount(1234);
    render(<AccountDetailPage id="acc-jpy" />);
    fireEvent.change(await screen.findByPlaceholderText("tx_outflow"), { target: { value: "234" } });
    fireEvent.keyDown(screen.getByPlaceholderText("tx_outflow"), { key: "Enter" });
    await waitFor(() =>
      expect(h.createTx).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-jpy",
          amount: -234,
        })
      )
    );
  });

  it("rejects a JPY outflow with a decimal fraction", async () => {
    h.account = jpyAccount(1234);
    render(<AccountDetailPage id="acc-jpy" />);
    fireEvent.change(await screen.findByPlaceholderText("tx_outflow"), { target: { value: "123.4" } });
    fireEvent.keyDown(screen.getByPlaceholderText("tx_outflow"), { key: "Enter" });
    await waitFor(() => expect(h.createTx).not.toHaveBeenCalled());
  });

  it("uses whole-yen precision in the reconcile field", async () => {
    h.account = jpyAccount(1234);
    render(<AccountDetailPage id="acc-jpy" />);
    fireEvent.click(await screen.findByText("account_reconcile"));
    const input = (await screen.findByLabelText("rec_statement")) as HTMLInputElement;
    expect(input.value).toBe("1234");
    fireEvent.change(input, { target: { value: "1500" } });
    fireEvent.click(screen.getByText("common_confirm"));
    await waitFor(() =>
      expect(h.reconcile).toHaveBeenCalledWith("acc-jpy", { statementBalance: 1500, markCleared: true })
    );
  });
});
