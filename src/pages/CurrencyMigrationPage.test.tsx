// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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
  getCurrencyMigration: vi.fn(),
  confirmCurrencyMigration: vi.fn(),
  refreshBoot: vi.fn(),
  toast: vi.fn(),
  boot: {
    settings: {
      currencySymbol: "$",
      language: "zh",
      reportingCurrency: null,
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
    currencyMigrationRequired: true,
    supportedCurrencies: [
      { code: "CNY", exponent: 2, enabledByDefault: true },
      { code: "USD", exponent: 2, enabledByDefault: true },
      { code: "SGD", exponent: 2, enabledByDefault: true },
      { code: "CAD", exponent: 2, enabledByDefault: false },
      { code: "EUR", exponent: 2, enabledByDefault: true },
      { code: "GBP", exponent: 2, enabledByDefault: false },
      { code: "JPY", exponent: 0, enabledByDefault: true },
    ],
    enabledCurrencies: [],
  } as Bootstrap,
}));

vi.mock("../api", () => {
  class ApiError extends Error {
    code?: string;
    anomalies?: { table: string; id: string; field: string; value: number }[];
    backup?: { fileName: string; filePath: string };
  }
  return {
    ApiError,
    api: {
      getCurrencyMigration: (...args: unknown[]) => h.getCurrencyMigration(...args),
      confirmCurrencyMigration: (...args: unknown[]) => h.confirmCurrencyMigration(...args),
    },
  };
});

vi.mock("../store", () => ({
  AppProvider: ({ children }: { children: ReactNode }) => children,
  useApp: () => ({
    boot: h.boot,
    loading: false,
    authEnabled: false,
    authenticated: true,
    lang: "zh",
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    refreshBoot: h.refreshBoot,
    toast: h.toast,
    setLang: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

import { ApiError } from "../api";
import { CurrencyMigrationPage } from "./CurrencyMigrationPage";
import App from "../App";

function preview(overrides: Record<string, unknown> = {}) {
  return {
    status: "pending",
    currencyMigrationRequired: true,
    currencySymbol: h.boot.settings.currencySymbol,
    suggestedCurrency: null,
    supportedCurrencies: SUPPORTED,
    ...overrides,
  };
}

beforeEach(() => {
  h.getCurrencyMigration.mockReset();
  h.confirmCurrencyMigration.mockReset();
  h.refreshBoot.mockReset();
  h.toast.mockReset();
  h.boot.currencyMigrationRequired = true;
  h.boot.settings.currencySymbol = "$";
  h.getCurrencyMigration.mockResolvedValue(preview());
  h.refreshBoot.mockResolvedValue(undefined);
  window.location.hash = "#/budget";
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("CurrencyMigrationPage", () => {
  it("explains the backup, requires an explicit built-in currency, and describes JPY scaling", async () => {
    render(<CurrencyMigrationPage />);
    expect(await screen.findByText("migration_title")).toBeTruthy();
    expect(screen.getByText("migration_backupNote")).toBeTruthy();
    expect(screen.getByText("migration_jpyScaleNote")).toBeTruthy();
    expect(screen.getByText('migration_currentSymbol:{"symbol":"$"}')).toBeTruthy();
    expect(screen.getByText("migration_dollarAmbiguous")).toBeTruthy();

    const select = (await screen.findByLabelText("migration_chooseCurrency")) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((option) => option.value)).toEqual(["", ...SUPPORTED.map((currency) => currency.code)]);
    expect(screen.getByRole("button", { name: "migration_confirm" })).toHaveProperty("disabled", true);
    expect(h.confirmCurrencyMigration).not.toHaveBeenCalled();
  });

  it("does not treat $ as USD and does not auto-fill a currency", async () => {
    h.getCurrencyMigration.mockResolvedValue(preview({ suggestedCurrency: null, currencySymbol: "$" }));
    render(<CurrencyMigrationPage />);
    const select = (await screen.findByLabelText("migration_chooseCurrency")) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.value).not.toBe("USD");
    expect(screen.queryByText(/migration_suggestion/)).toBeNull();
    expect(screen.getByText("migration_dollarAmbiguous")).toBeTruthy();
  });

  it("shows a ¥ suggestion without selecting it", async () => {
    h.boot.settings.currencySymbol = "¥";
    h.getCurrencyMigration.mockResolvedValue(preview({ currencySymbol: "¥", suggestedCurrency: "CNY" }));
    render(<CurrencyMigrationPage />);
    expect(await screen.findByText('migration_suggestion:{"code":"CNY"}')).toBeTruthy();
    const select = screen.getByLabelText("migration_chooseCurrency") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("button", { name: "migration_confirm" })).toHaveProperty("disabled", true);
  });

  it("submits the currency the user chose", async () => {
    h.confirmCurrencyMigration.mockResolvedValue({ status: "complete", alreadyCompleted: false });
    render(<CurrencyMigrationPage />);
    fireEvent.change(await screen.findByLabelText("migration_chooseCurrency"), { target: { value: "SGD" } });
    fireEvent.click(screen.getByRole("button", { name: "migration_confirm" }));
    await waitFor(() => expect(h.confirmCurrencyMigration).toHaveBeenCalledWith("SGD"));
    await waitFor(() => expect(h.refreshBoot).toHaveBeenCalled());
  });

  it("lists backend table, record, field and original value when JPY scaling fails", async () => {
    const err = new ApiError("legacy_scale_not_divisible") as ApiError & {
      code: string;
      anomalies: { table: string; id: string; field: string; value: number }[];
    };
    err.code = "legacy_scale_not_divisible";
    err.anomalies = [{ table: "transactions", id: "tx-legacy-spend", field: "amount", value: -1234 }];
    h.confirmCurrencyMigration.mockRejectedValue(err);

    render(<CurrencyMigrationPage />);
    fireEvent.change(await screen.findByLabelText("migration_chooseCurrency"), { target: { value: "JPY" } });
    fireEvent.click(screen.getByRole("button", { name: "migration_confirm" }));

    expect(await screen.findByText("migration_anomalyHeading")).toBeTruthy();
    expect(
      screen.getByText(
        'migration_anomalyRow:{"table":"transactions","id":"tx-legacy-spend","field":"amount","value":-1234}'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/migration_restoreBackup/)).toBeNull();
    expect(h.refreshBoot).not.toHaveBeenCalled();
  });

  it("shows the restore backup path when transform fails after a snapshot", async () => {
    const err = new ApiError("currency_migration_failed") as ApiError & {
      code: string;
      backup: { fileName: string; filePath: string };
    };
    err.code = "currency_migration_failed";
    err.backup = {
      fileName: "budget-pre-currency-v10-20260831-153045.sqlite",
      filePath: "/tmp/currency-migration-backups/budget-pre-currency-v10-20260831-153045.sqlite",
    };
    h.confirmCurrencyMigration.mockRejectedValue(err);

    render(<CurrencyMigrationPage />);
    fireEvent.change(await screen.findByLabelText("migration_chooseCurrency"), { target: { value: "CNY" } });
    fireEvent.click(screen.getByRole("button", { name: "migration_confirm" }));

    expect(await screen.findByText("migration_failed")).toBeTruthy();
    expect(
      screen.getByText(
        'migration_restoreBackup:{"path":"/tmp/currency-migration-backups/budget-pre-currency-v10-20260831-153045.sqlite"}'
      )
    ).toBeTruthy();
    expect(h.refreshBoot).not.toHaveBeenCalled();
  });

  it("shows a backup-failed message without inventing a restore path", async () => {
    const err = new ApiError("currency_migration_backup_failed") as ApiError & { code: string };
    err.code = "currency_migration_backup_failed";
    h.confirmCurrencyMigration.mockRejectedValue(err);

    render(<CurrencyMigrationPage />);
    fireEvent.change(await screen.findByLabelText("migration_chooseCurrency"), { target: { value: "CNY" } });
    fireEvent.click(screen.getByRole("button", { name: "migration_confirm" }));

    expect(await screen.findByText("migration_backupFailed")).toBeTruthy();
    expect(screen.queryByText(/migration_restoreBackup/)).toBeNull();
    expect(h.refreshBoot).not.toHaveBeenCalled();
  });
});

describe("app shell while currency migration is required", () => {
  it("only shows the migration page and ignores account or budget navigation", async () => {
    window.location.hash = "#/accounts";
    render(<App />);
    expect(await screen.findByText("migration_title")).toBeTruthy();
    expect(screen.queryByText("nav_accounts")).toBeNull();
    expect(screen.queryByText("nav_budget")).toBeNull();
    expect(screen.queryByText("account_add")).toBeNull();
    expect(screen.queryByText("budget_rta")).toBeNull();

    window.location.hash = "#/budget";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(screen.getByText("migration_title")).toBeTruthy();
    expect(screen.queryByText("budget_rta")).toBeNull();
    expect(screen.queryByText("nav_transactions")).toBeNull();
  });
});
