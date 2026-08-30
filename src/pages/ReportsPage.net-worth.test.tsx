// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, CurrencyRecord, NetWorthReport, ReportsData } from "../types";
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
  netWorthReport: vi.fn(),
  reports: vi.fn(),
  activeCurrency: "CNY",
  boot: {} as Bootstrap,
  pendingNative: [] as Array<(value: ReportsData) => void>,
  pendingNetWorth: [] as Array<(value: NetWorthReport) => void>,
}));

vi.mock("../api", () => ({
  api: {
    nativeReport: (...args: unknown[]) => h.nativeReport(...args),
    netWorthReport: (...args: unknown[]) => h.netWorthReport(...args),
    reports: (...args: unknown[]) => h.reports(...args),
  },
}));

vi.mock("../store", () => {
  const t = (k: string, vars?: Record<string, string | number>) => (vars ? `${k}:${JSON.stringify(vars)}` : k);
  return {
    useApp: () => ({
      boot: h.boot,
      lang: "zh" as const,
      t,
      activeCurrency: h.activeCurrency,
      setActiveCurrency: (code: string) => {
        h.activeCurrency = code;
      },
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

const completeNetWorth: NetWorthReport = {
  reportingCurrency: "CNY",
  asOf: "2026-08-30",
  months: 12,
  complete: true,
  totalAssetsMinor: 20_400_000,
  totalLiabilitiesMinor: 500_000,
  netWorthMinor: 19_900_000,
  missing: [],
  accounts: [
    {
      id: "cny-bank",
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      nativeBalanceMinor: 10_000_000,
      convertedBalanceMinor: 10_000_000,
      fx: {
        from: "CNY",
        to: "CNY",
        asOfDate: "2026-08-30",
        rateDate: "2026-08-30",
        source: "identity",
        path: "identity",
        rate: "1",
      },
    },
    {
      id: "usd-invest",
      name: "USD 投资账户",
      type: "investment",
      currencyCode: "USD",
      nativeBalanceMinor: 1_000_000,
      convertedBalanceMinor: 7_200_000,
      fx: {
        from: "USD",
        to: "CNY",
        asOfDate: "2026-08-30",
        rateDate: "2026-08-28",
        source: "frankfurter_ecb",
        path: "direct",
        rate: "7.20",
      },
    },
  ],
  history: [
    {
      month: "2026-07",
      asOf: "2026-07-31",
      complete: true,
      totalAssetsMinor: 19_000_000,
      totalLiabilitiesMinor: 500_000,
      netWorthMinor: 18_500_000,
      missing: [],
      rates: [],
    },
    {
      month: "2026-08",
      asOf: "2026-08-30",
      complete: true,
      totalAssetsMinor: 20_400_000,
      totalLiabilitiesMinor: 500_000,
      netWorthMinor: 19_900_000,
      missing: [],
      rates: [],
    },
  ],
};

const incompleteNetWorth: NetWorthReport = {
  reportingCurrency: "CNY",
  asOf: "2026-08-30",
  months: 12,
  complete: false,
  totalAssetsMinor: null,
  totalLiabilitiesMinor: null,
  netWorthMinor: null,
  missing: [{ base: "SGD", quote: "CNY", requestedDate: "2026-08-30", reason: "missing_rate" }],
  accounts: [
    {
      id: "cny-bank",
      name: "家庭 CNY 日常账户",
      type: "checking",
      currencyCode: "CNY",
      nativeBalanceMinor: 10_000_000,
      convertedBalanceMinor: 10_000_000,
      fx: {
        from: "CNY",
        to: "CNY",
        asOfDate: "2026-08-30",
        rateDate: "2026-08-30",
        source: "identity",
        path: "identity",
        rate: "1",
      },
    },
    {
      id: "sgd-bank",
      name: "SGD 日常账户",
      type: "checking",
      currencyCode: "SGD",
      nativeBalanceMinor: 500_000,
      convertedBalanceMinor: null,
      fx: null,
    },
  ],
  history: [
    {
      month: "2026-08",
      asOf: "2026-08-30",
      complete: false,
      totalAssetsMinor: null,
      totalLiabilitiesMinor: null,
      netWorthMinor: null,
      missing: [{ base: "SGD", quote: "CNY", requestedDate: "2026-08-30", reason: "missing_rate" }],
      rates: [],
    },
  ],
};

function bootFixture(reportingCurrency: string | null = "CNY"): Bootstrap {
  return {
    settings: {
      currencySymbol: "¥",
      language: "zh",
      reportingCurrency,
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
}

beforeEach(() => {
  h.activeCurrency = "CNY";
  h.boot = bootFixture("CNY");
  for (const resolve of h.pendingNative) resolve({ ...native, currencyCode: "CNY" });
  for (const resolve of h.pendingNetWorth) resolve(completeNetWorth);
  h.pendingNative = [];
  h.pendingNetWorth = [];
  h.nativeReport.mockReset().mockResolvedValue(native);
  h.netWorthReport.mockReset().mockResolvedValue(completeNetWorth);
  h.reports.mockReset();
});

afterEach(cleanup);

async function openNetWorth() {
  render(<ReportsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "rep_netWorthView" }));
}

describe("ReportsPage native and consolidated views", () => {
  it("keeps native income/expense charts on the native view and does not fetch net worth", async () => {
    render(<ReportsPage />);
    expect(await screen.findByText("rep_nativeView")).toBeTruthy();
    expect(screen.getByText("rep_netWorthView")).toBeTruthy();
    await waitFor(() => expect(h.nativeReport).toHaveBeenCalledWith("CNY", 12));
    expect(h.netWorthReport).not.toHaveBeenCalled();
    expect(screen.getByText("rep_nativeHint")).toBeTruthy();
    expect(screen.getByText("盒马")).toBeTruthy();
    expect(screen.getByText("rep_incomeExpense")).toBeTruthy();
    expect(screen.getByText("rep_breakdown")).toBeTruthy();
    expect(screen.getByText(formatMoney(9_620_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
  });

  it("loads consolidated net worth with the reporting currency and shows complete totals", async () => {
    await openNetWorth();
    await waitFor(() =>
      expect(h.netWorthReport).toHaveBeenCalledWith(
        expect.objectContaining({
          reportingCurrency: "CNY",
          months: 12,
          asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ),
    );
    expect(h.nativeReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("rep_nativeHint")).toBeNull();
    expect(screen.queryByText("盒马")).toBeNull();
    expect(await screen.findByText(formatMoney(20_400_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(500_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText("家庭 CNY 日常账户")).toBeTruthy();
    expect(screen.getByText("USD 投资账户")).toBeTruthy();
    expect(screen.getByText(formatMoney(1_000_000, "USD", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText("2026-08-28")).toBeTruthy();
    expect(screen.getByText("frankfurter_ecb")).toBeTruthy();
    expect(screen.getByText("7.20")).toBeTruthy();
  });

  it("hides unified totals when incomplete and still lists native balances plus missing pairs", async () => {
    h.netWorthReport.mockResolvedValue(incompleteNetWorth);
    await openNetWorth();
    expect(await screen.findByText("rep_incomplete")).toBeTruthy();
    expect(screen.getByText("SGD 日常账户")).toBeTruthy();
    expect(screen.getAllByText(formatMoney(10_000_000, "CNY", { locale: "zh-CN" })).length).toBeGreaterThan(0);
    const sgdNative = formatMoney(500_000, "SGD", { locale: "zh-CN" }).replace(/\u00a0/g, " ");
    expect(
      screen.getByText((content) => content.replace(/\u00a0/g, " ") === sgdNative),
    ).toBeTruthy();
    expect(screen.getByText(`rep_missingPair:${JSON.stringify({ from: "SGD", to: "CNY" })}`)).toBeTruthy();
    expect(screen.queryByText(formatMoney(20_400_000, "CNY", { locale: "zh-CN" }))).toBeNull();
    expect(screen.queryByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeNull();
    expect(screen.queryByText("rep_now")).toBeNull();
  });

  it("keeps current totals and dated history-gap hints when a middle month is incomplete", async () => {
    const gapped: NetWorthReport = {
      ...completeNetWorth,
      history: [
        {
          month: "2026-06",
          asOf: "2026-06-30",
          complete: true,
          totalAssetsMinor: 18_000_000,
          totalLiabilitiesMinor: 500_000,
          netWorthMinor: 17_500_000,
          missing: [],
          rates: [],
        },
        {
          month: "2026-07",
          asOf: "2026-07-31",
          complete: false,
          totalAssetsMinor: null,
          totalLiabilitiesMinor: null,
          netWorthMinor: null,
          missing: [{ base: "USD", quote: "CNY", requestedDate: "2026-07-31", reason: "missing_rate" }],
          rates: [],
        },
        {
          month: "2026-08",
          asOf: "2026-08-30",
          complete: true,
          totalAssetsMinor: 20_400_000,
          totalLiabilitiesMinor: 500_000,
          netWorthMinor: 19_900_000,
          missing: [],
          rates: [],
        },
      ],
    };
    h.netWorthReport.mockResolvedValue(gapped);
    await openNetWorth();
    expect(await screen.findByText(formatMoney(20_400_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(500_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    expect(screen.getByText("rep_now")).toBeTruthy();
    expect(screen.getByText("rep_historyMissing")).toBeTruthy();
    expect(
      screen.getByText(`rep_historyMissingPair:${JSON.stringify({ from: "USD", to: "CNY", date: "2026-07-31" })}`),
    ).toBeTruthy();
  });

  it("ignores a late native response after switching to net worth", async () => {
    h.nativeReport.mockImplementation(
      () => new Promise<ReportsData>((resolve) => h.pendingNative.push(resolve)),
    );
    render(<ReportsPage />);
    await waitFor(() => expect(h.pendingNative.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "rep_netWorthView" }));
    expect(await screen.findByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    for (const resolve of h.pendingNative.splice(0)) resolve(native);
    await waitFor(() => {
      expect(screen.getByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeTruthy();
    });
    expect(screen.queryByText("盒马")).toBeNull();
    expect(screen.queryByText(formatMoney(9_620_000, "CNY", { locale: "zh-CN" }))).toBeNull();
  });

  it("ignores a late CNY net-worth response after the reporting currency changes", async () => {
    const usdReport: NetWorthReport = {
      ...completeNetWorth,
      reportingCurrency: "USD",
      totalAssetsMinor: 88,
      totalLiabilitiesMinor: 0,
      netWorthMinor: 88,
      accounts: [],
      history: [
        {
          month: "2026-08",
          asOf: "2026-08-30",
          complete: true,
          totalAssetsMinor: 88,
          totalLiabilitiesMinor: 0,
          netWorthMinor: 88,
          missing: [],
          rates: [],
        },
      ],
    };
    h.netWorthReport.mockImplementation((params?: { reportingCurrency?: string }) => {
      if (params?.reportingCurrency !== "USD") {
        return new Promise<NetWorthReport>((resolve) => h.pendingNetWorth.push(resolve));
      }
      return Promise.resolve(usdReport);
    });

    const { rerender } = render(<ReportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "rep_netWorthView" }));
    await waitFor(() => expect(h.pendingNetWorth.length).toBeGreaterThan(0));

    h.boot = bootFixture("USD");
    rerender(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getAllByText(formatMoney(88, "USD", { locale: "zh-CN" })).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeNull();

    for (const resolve of h.pendingNetWorth.splice(0)) resolve(completeNetWorth);
    await waitFor(() => {
      expect(screen.getAllByText(formatMoney(88, "USD", { locale: "zh-CN" })).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(formatMoney(19_900_000, "CNY", { locale: "zh-CN" }))).toBeNull();
    expect(screen.queryByText(formatMoney(20_400_000, "CNY", { locale: "zh-CN" }))).toBeNull();
  });
});
