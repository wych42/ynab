// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Bootstrap, CurrencyRecord } from "../types";

const SUPPORTED: CurrencyRecord[] = [
  { code: "CNY", exponent: 2, enabledByDefault: true },
  { code: "USD", exponent: 2, enabledByDefault: true },
  { code: "SGD", exponent: 2, enabledByDefault: true },
  { code: "CAD", exponent: 2, enabledByDefault: false },
  { code: "EUR", exponent: 2, enabledByDefault: true },
  { code: "GBP", exponent: 2, enabledByDefault: false },
  { code: "JPY", exponent: 0, enabledByDefault: true },
];

const cachedRate = {
  rateDate: "2026-08-28",
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "7.20",
  source: "frankfurter_ecb",
  fetchedAt: "2026-08-30T00:00:00.000Z",
};

const manualRate = {
  rateDate: "2026-08-28",
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "7.10",
  source: "manual",
  fetchedAt: "2026-08-30T00:00:00.000Z",
};

const h = vi.hoisted(() => ({
  getFxStatus: vi.fn(),
  syncFxRates: vi.fn(),
  putFxRate: vi.fn(),
  deleteFxRate: vi.fn(),
  saveSettings: vi.fn(),
  imChannels: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  api: {
    getFxStatus: (...a: unknown[]) => h.getFxStatus(...a),
    syncFxRates: (...a: unknown[]) => h.syncFxRates(...a),
    putFxRate: (...a: unknown[]) => h.putFxRate(...a),
    deleteFxRate: (...a: unknown[]) => h.deleteFxRate(...a),
    saveSettings: (...a: unknown[]) => h.saveSettings(...a),
    imChannels: (...a: unknown[]) => h.imChannels(...a),
  },
}));

vi.mock("../store", () => ({
  useApp: () => ({
    boot: h.boot,
    loading: false,
    lang: "zh",
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    setLang: vi.fn(),
    refreshBoot: h.refreshBoot,
    toast: h.toast,
  }),
}));

import { SettingsPage } from "./SettingsPage";

function fxStatus(overrides: Record<string, unknown> = {}) {
  return {
    defaultProvider: "frankfurter_ecb",
    latestRateDate: "2026-08-28",
    latestSource: "frankfurter_ecb",
    rates: [cachedRate],
    lastSyncError: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.getFxStatus.mockReset().mockResolvedValue(fxStatus());
  h.syncFxRates.mockReset().mockResolvedValue(fxStatus());
  h.putFxRate.mockReset().mockResolvedValue({ ok: true });
  h.deleteFxRate.mockReset().mockResolvedValue({ ok: true });
  h.saveSettings.mockReset().mockResolvedValue({ ok: true });
  h.refreshBoot.mockReset().mockResolvedValue({});
  h.toast.mockReset();
  h.imChannels.mockReset().mockResolvedValue({ channels: [] });
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
});

afterEach(cleanup);

describe("SettingsPage FX section", () => {
  it("hides internal FX source codes from the default area", async () => {
    render(<SettingsPage />);
    const section = await screen.findByTestId("fx-section");
    expect(within(section).queryByText("frankfurter_ecb")).toBeNull();
    expect(within(section).queryByText("manual")).toBeNull();
    expect(within(section).getByTestId("fx-latest-date").textContent).toContain("2026-08-28");
    expect(within(section).getByTestId("fx-provider").textContent).toContain("欧洲央行参考汇率");
    expect(screen.queryByTestId("fx-cache-list")).toBeNull();
    expect(section.textContent).toContain("settings_fxHint");
  });

  it("keeps internal source codes in diagnostics after expand", async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "settings_fxDiagnostics" }));
    const list = await screen.findByTestId("fx-cache-list");
    expect(list.textContent).toContain("frankfurter_ecb");
    expect(list.textContent).toContain("USD");
    expect(list.textContent).toContain("7.20");
  });

  it("only offers enabled currencies for a manual rate", async () => {
    render(<SettingsPage />);
    const base = (await screen.findByLabelText("settings_fxBase")) as HTMLSelectElement;
    const quote = (await screen.findByLabelText("settings_fxQuote")) as HTMLSelectElement;
    const enabled = ["CNY", "USD", "SGD", "EUR", "JPY"];
    expect([...base.options].map((option) => option.value).filter(Boolean)).toEqual(enabled);
    expect([...quote.options].map((option) => option.value).filter(Boolean)).toEqual(enabled);
    expect([...base.options].map((option) => option.value)).not.toContain("CAD");
    expect([...quote.options].map((option) => option.value)).not.toContain("GBP");
  });

  it("saves a positive manual rate for two enabled currencies and a date", async () => {
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("settings_fxBase"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("settings_fxQuote"), { target: { value: "CNY" } });
    fireEvent.change(screen.getByLabelText("settings_fxDate"), { target: { value: "2026-08-28" } });
    fireEvent.change(screen.getByLabelText("settings_fxRate"), { target: { value: "7.10" } });
    fireEvent.click(screen.getByRole("button", { name: "settings_fxSaveManual" }));
    await waitFor(() => expect(h.putFxRate).toHaveBeenCalledWith("2026-08-28", "USD", "CNY", "7.10"));
  });

  it("deletes a manual override from the cache list", async () => {
    h.getFxStatus.mockResolvedValue(fxStatus({ latestSource: "manual", rates: [manualRate, cachedRate] }));
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "settings_fxDiagnostics" }));
    const del = await screen.findByRole("button", { name: "settings_fxDeleteManual USD/CNY 2026-08-28" });
    fireEvent.click(del);
    await waitFor(() => expect(h.deleteFxRate).toHaveBeenCalledWith("2026-08-28", "USD", "CNY"));
  });

  it("shows a refresh error without clearing the cached rate list", async () => {
    const err = Object.assign(new Error("offline"), { code: "fx_provider_timeout" });
    h.syncFxRates.mockRejectedValue(err);
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "settings_fxDiagnostics" }));
    expect(await screen.findByTestId("fx-cache-list")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "settings_fxRefresh" }));
    expect(await screen.findByTestId("fx-refresh-error")).toBeTruthy();
    const list = screen.getByTestId("fx-cache-list");
    expect(list.textContent).toContain("7.20");
    expect(h.getFxStatus).toHaveBeenCalled();
  });
});
