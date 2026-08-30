// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, CurrencyRecord, ReportsData } from "../types";
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
  nativeReport: vi.fn(),
  reports: vi.fn(),
  activeCurrency: "CNY",
  boot: {} as Bootstrap,
  pendingCny: [] as Array<(value: ReportsData) => void>,
}));

vi.mock("../api", () => ({
  api: {
    nativeReport: (...args: unknown[]) => h.nativeReport(...args),
    reports: (...args: unknown[]) => h.reports(...args),
  },
}));

vi.mock("../store", () => {
  const t = (k: string, vars?: Record<string, string | number>) => (vars ? `${k}:${JSON.stringify(vars)}` : k);
  const setActiveCurrency = (code: string) => {
    h.activeCurrency = code;
  };
  return {
    useApp: () => ({
      boot: h.boot,
      lang: "zh" as const,
      t,
      activeCurrency: h.activeCurrency,
      setActiveCurrency,
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

const native: ReportsData = {
  currencyCode: "CNY",
  months: ["2026-06", "2026-07", "2026-08"],
  income: [
    { month: "2026-06", value: 0 },
    { month: "2026-07", value: 0 },
    { month: "2026-08", value: 200_000 },
  ],
  expense: [
    { month: "2026-06", value: 0 },
    { month: "2026-07", value: 0 },
    { month: "2026-08", value: 80_000 },
  ],
  netWorth: [
    { month: "2026-06", assets: 100_000, liabilities: 0, net: 100_000 },
    { month: "2026-07", assets: 100_000, liabilities: 0, net: 100_000 },
    { month: "2026-08", assets: 10_120_000, liabilities: 500_000, net: 9_620_000 },
  ],
  accounts: [],
  totalAssets: 10_120_000,
  totalLiabilities: 500_000,
  netWorthNow: 9_620_000,
  breakdown: [{ name: "餐饮", value: 80_000 }],
  topPayees: [{ name: "盒马", value: 80_000 }],
  incomeSources: [{ name: "工资薪酬", value: 200_000 }],
  ageOfMoney: 18,
};

beforeEach(() => {
  h.activeCurrency = "CNY";
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
  for (const resolve of h.pendingCny) resolve({ ...native, currencyCode: "CNY" });
  h.pendingCny = [];
  h.nativeReport.mockReset().mockResolvedValue(native);
  h.reports.mockReset();
});

afterEach(cleanup);

describe("ReportsPage 原币收支", () => {
  it("按活动币种请求原币报表，并用该币种格式化最小单位金额", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(h.nativeReport).toHaveBeenCalledWith("CNY", 12));
    expect(h.reports).not.toHaveBeenCalled();
    expect(await screen.findByText("CNY")).toBeTruthy();
    expect(screen.getByText(formatMoney(9_620_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getAllByText(formatMoney(200_000, "CNY", { locale: "zh-CN" })).length).toBeGreaterThan(0);
    expect(screen.getByText("盒马")).toBeTruthy();
    expect(screen.getAllByText(formatMoney(80_000, "CNY", { locale: "zh-CN" })).length).toBeGreaterThan(0);
    expect(screen.getByText("rep_nativeHint")).toBeTruthy();
    expect(screen.queryByText(formatMoney(96_200, "CNY", { locale: "zh-CN" }))).toBeNull();
  });

  it("ignores a late CNY response after SGD has already rendered", async () => {
    const sgdReport: ReportsData = {
      ...native,
      currencyCode: "SGD",
      netWorthNow: 12,
      totalAssets: 12,
      totalLiabilities: 0,
      income: native.income.map((row, index) => (index === 2 ? { ...row, value: 12 } : row)),
      expense: native.expense.map((row) => ({ ...row, value: 0 })),
      breakdown: [],
      topPayees: [],
      incomeSources: [],
    };
    h.nativeReport.mockImplementation((currency?: string) => {
      if (currency !== "SGD") {
        return new Promise<ReportsData>((resolve) => h.pendingCny.push(resolve));
      }
      return Promise.resolve(sgdReport);
    });

    const { rerender } = render(<ReportsPage />);
    await waitFor(() => expect(h.pendingCny.length).toBeGreaterThan(0));

    h.activeCurrency = "SGD";
    rerender(<ReportsPage />);
    expect(await screen.findByText("SGD")).toBeTruthy();
    expect(screen.queryByText("CNY")).toBeNull();
    expect(screen.queryByText(formatMoney(9_620_000, "CNY", { locale: "zh-CN" }))).toBeNull();

    const stale = h.pendingCny.splice(0);
    for (const resolve of stale) resolve(native);
    await waitFor(() => {
      expect(screen.getByText("SGD")).toBeTruthy();
    });
    expect(screen.queryByText("CNY")).toBeNull();
    expect(screen.queryByText(formatMoney(9_620_000, "CNY", { locale: "zh-CN" }))).toBeNull();
  });
});
