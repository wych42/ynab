// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, CashflowOverview, CurrencyRecord } from "../types";
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

const overview: CashflowOverview = {
  month: "2026-08",
  currencies: [
    { currencyCode: "CNY", incomeMinor: 200_000, expenseMinor: 80_000, netInflowMinor: 120_000, active: true },
    { currencyCode: "SGD", incomeMinor: 80_000, expenseMinor: 12_000, netInflowMinor: 68_000, active: true },
    { currencyCode: "USD", incomeMinor: 0, expenseMinor: 2200, netInflowMinor: -2200, active: true },
    { currencyCode: "JPY", incomeMinor: 0, expenseMinor: 1234, netInflowMinor: -1234, active: true },
    { currencyCode: "EUR", incomeMinor: 0, expenseMinor: 0, netInflowMinor: 0, active: false },
  ],
};

const h = vi.hoisted(() => ({
  cashflowOverview: vi.fn(),
  cashflowDetail: vi.fn(),
  nativeReport: vi.fn(),
  netWorthReport: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  api: {
    cashflowOverview: (...args: unknown[]) => h.cashflowOverview(...args),
    cashflowDetail: (...args: unknown[]) => h.cashflowDetail(...args),
    nativeReport: (...args: unknown[]) => h.nativeReport(...args),
    netWorthReport: (...args: unknown[]) => h.netWorthReport(...args),
  },
}));

vi.mock("../store", async () => {
  const { makeT } = await import("../i18n");
  const t = makeT("zh");
  return {
    useApp: () => ({
      boot: h.boot,
      lang: "zh" as const,
      t,
    }),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

import { ReportsPage } from "./ReportsPage";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/reports";
  h.boot = {
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
    accounts: [],
    payees: [],
    groups: [],
    currentMonth: "2026-08",
    currencyMigrationRequired: false,
    supportedCurrencies: SUPPORTED,
    enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
  };
  h.cashflowOverview.mockReset().mockResolvedValue(overview);
  h.cashflowDetail.mockReset();
  h.nativeReport.mockReset();
  h.netWorthReport.mockReset();
});

afterEach(cleanup);

describe("ReportsPage 收支全部", () => {
  it("打开报表默认请求现金流总览，不调用 nativeReport", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(h.cashflowOverview).toHaveBeenCalled());
    expect(h.nativeReport).not.toHaveBeenCalled();
    expect(screen.getByText("查看币种：全部")).toBeTruthy();
    const pageText = (document.body.textContent ?? "").replace(/\u00a0/g, " ");
    expect(pageText).toContain(formatMoney(200_000, "CNY", { locale: "zh-CN" }).replace(/\u00a0/g, " "));
    expect(pageText).toContain(formatMoney(80_000, "SGD", { locale: "zh-CN" }).replace(/\u00a0/g, " "));
    expect(screen.getByText(/无活动/)).toBeTruthy();
  });

  it("预算刚看过 SGD 也不会把报表变成 SGD 详情", async () => {
    localStorage.setItem("activeBudgetCurrency", "SGD");
    window.location.hash = "#/reports/cashflow";
    render(<ReportsPage />);
    await waitFor(() => expect(h.cashflowOverview).toHaveBeenCalled());
    expect(h.cashflowDetail).not.toHaveBeenCalled();
    expect(h.nativeReport).not.toHaveBeenCalled();
    expect(screen.getByText(/查看币种/)).toBeTruthy();
  });
});
