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

const h = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  imChannels: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  boot: {} as Bootstrap,
}));

vi.mock("../api", () => ({
  api: {
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

beforeEach(() => {
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

describe("SettingsPage 汇总币种与已启用币种", () => {
  it("列出默认五种已启用币种，添加币种只来自目录且没有自由输入", async () => {
    render(<SettingsPage />);

    const enabled = await screen.findByTestId("enabled-currencies");
    expect(within(enabled).getByText("CNY")).toBeTruthy();
    expect(within(enabled).getByText("USD")).toBeTruthy();
    expect(within(enabled).getByText("SGD")).toBeTruthy();
    expect(within(enabled).getByText("JPY")).toBeTruthy();
    expect(within(enabled).getByText("EUR")).toBeTruthy();
    expect(within(enabled).queryByText("CAD")).toBeNull();
    expect(within(enabled).queryByText("GBP")).toBeNull();

    const add = (await screen.findByLabelText("settings_addCurrency")) as HTMLSelectElement;
    expect(add.tagName).toBe("SELECT");
    expect([...add.options].map((o) => o.value).filter(Boolean)).toEqual(["CAD", "GBP"]);
    expect(screen.queryByRole("textbox", { name: "settings_addCurrency" })).toBeNull();
    expect(screen.queryByLabelText("settings_currencyLabel")).toBeNull();
  });

  it("可以从目录启用 CAD，并把汇总币种改成已启用的 USD", async () => {
    render(<SettingsPage />);

    fireEvent.change(await screen.findByLabelText("settings_addCurrency"), { target: { value: "CAD" } });
    fireEvent.click(screen.getByRole("button", { name: "settings_addCurrencyConfirm" }));
    await waitFor(() => expect(h.saveSettings).toHaveBeenCalledWith({ enableCurrency: "CAD" }));

    fireEvent.change(screen.getByLabelText("settings_reportingCurrency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "common_save" }));
    await waitFor(() =>
      expect(h.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ reportingCurrency: "USD", timezone: "UTC" })
      )
    );
    expect(h.saveSettings.mock.calls.some((args) => "currencySymbol" in (args[0] as object))).toBe(false);
  });
});
