// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Bootstrap, InvestmentList } from "../types";
import { formatMoney } from "../money";

const list: InvestmentList = {
  asOf: "2026-09-04",
  months: 12,
  accounts: [
    {
      accountId: "usd-broker",
      name: "先锋券商",
      currencyCode: "USD",
      balanceMinor: 1_000_000,
      balanceChangeMinor: 50_000,
      contributionsMinor: 20_000,
      withdrawalsMinor: 0,
      netContributionsMinor: 20_000,
      latestValuationDate: "2026-09-04",
    },
    {
      accountId: "sgd-broker",
      name: "SGD 投资",
      currencyCode: "SGD",
      balanceMinor: 200_000,
      balanceChangeMinor: 0,
      contributionsMinor: 200_000,
      withdrawalsMinor: 0,
      netContributionsMinor: 200_000,
      latestValuationDate: "2026-09-01",
    },
  ],
  subtotalsByCurrency: [
    {
      currencyCode: "SGD",
      balanceMinor: 200_000,
      balanceChangeMinor: 0,
      contributionsMinor: 200_000,
      withdrawalsMinor: 0,
      netContributionsMinor: 200_000,
    },
    {
      currencyCode: "USD",
      balanceMinor: 1_000_000,
      balanceChangeMinor: 50_000,
      contributionsMinor: 20_000,
      withdrawalsMinor: 0,
      netContributionsMinor: 20_000,
    },
  ],
};

const h = vi.hoisted(() => ({
  investments: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  api: {
    investments: (...args: unknown[]) => h.investments(...args),
    cashflowOverview: vi.fn(),
    cashflowDetail: vi.fn(),
    netWorthReport: vi.fn(),
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

import { ReportsPage } from "./ReportsPage";

beforeEach(() => {
  window.location.hash = "#/reports/investments";
  h.boot = {
    settings: { reportingCurrency: "CNY", timezone: "UTC" },
    accounts: [],
    payees: [],
    groups: [],
    currentMonth: "2026-09",
    currencyMigrationRequired: false,
    supportedCurrencies: [],
    enabledCurrencies: ["CNY", "USD", "SGD", "EUR", "JPY"],
  } as unknown as Bootstrap;
  h.investments.mockReset().mockResolvedValue(list);
});

afterEach(cleanup);

describe("Investment report", () => {
  it("has an independent nav entry and the field whitelist", async () => {
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "投资" })).toBeTruthy();
    expect(await screen.findByText("先锋券商")).toBeTruthy();
    expect(screen.getByText("SGD 投资")).toBeTruthy();
    const pageText = (document.body.textContent ?? "").replace(/\u00a0/g, " ");
    expect(pageText).toContain(formatMoney(1_000_000, "USD", { locale: "zh-CN" }).replace(/\u00a0/g, " "));
    expect(pageText).toContain(formatMoney(200_000, "SGD", { locale: "zh-CN" }).replace(/\u00a0/g, " "));
    await waitFor(() => expect(h.investments).toHaveBeenCalled());
    expect(screen.queryByText(/收益|回报率|持仓|成本基础/)).toBeNull();
  });
});
