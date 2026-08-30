import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Landmark } from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { Btn, Spinner, inputCls } from "../components/ui";
import type { CurrencyMigrationAnomaly, CurrencyMigrationBackup, CurrencyMigrationPreview } from "../types";

function hasAnomalies(error: unknown): error is { anomalies: CurrencyMigrationAnomaly[] } {
  return typeof error === "object" && error !== null && Array.isArray((error as { anomalies?: unknown }).anomalies);
}

function readErrorBackup(error: unknown): CurrencyMigrationBackup | null {
  if (typeof error !== "object" || error === null) return null;
  const backup = (error as { backup?: unknown }).backup;
  if (!backup || typeof backup !== "object") return null;
  const fileName = (backup as { fileName?: unknown }).fileName;
  const filePath = (backup as { filePath?: unknown }).filePath;
  if (typeof fileName !== "string" || typeof filePath !== "string") return null;
  return { fileName, filePath };
}

export function CurrencyMigrationPage() {
  const { boot, t, refreshBoot } = useApp();
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<CurrencyMigrationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [anomalies, setAnomalies] = useState<CurrencyMigrationAnomaly[]>([]);
  const [errorKey, setErrorKey] = useState<
    "migration_unsupportedCurrency" | "migration_failed" | "migration_backupFailed" | null
  >(null);
  const [restoreBackup, setRestoreBackup] = useState<CurrencyMigrationBackup | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCurrencyMigration()
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!boot) {
    return <Spinner />;
  }

  const currencies = preview?.supportedCurrencies ?? boot.supportedCurrencies ?? [];
  const symbol = boot.settings.currencySymbol ?? preview?.currencySymbol ?? "";
  const dollarAmbiguous = symbol.trim() === "$";
  const suggestion = dollarAmbiguous ? null : preview?.suggestedCurrency ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setAnomalies([]);
    setErrorKey(null);
    setRestoreBackup(null);
    try {
      await api.confirmCurrencyMigration(selected);
      await refreshBoot();
    } catch (err) {
      const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
      if (hasAnomalies(err) && err.anomalies.length) {
        setAnomalies(err.anomalies);
      } else if (code === "unsupported_currency") {
        setErrorKey("migration_unsupportedCurrency");
      } else if (code === "currency_migration_backup_failed") {
        setErrorKey("migration_backupFailed");
      } else {
        setErrorKey("migration_failed");
        setRestoreBackup(readErrorBackup(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-lg">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-card">
          <div className="mb-1 flex items-center gap-2 text-brand-600">
            <Landmark size={18} />
            <h1 className="text-lg font-semibold text-slate-900">{t("migration_title")}</h1>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">{t("migration_desc")}</p>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">{t("migration_backupNote")}</p>
          <p className="mb-3 text-xs leading-relaxed text-slate-600">
            {t("migration_currentSymbol", { symbol })}
          </p>
          {dollarAmbiguous && (
            <p className="mb-3 text-xs leading-relaxed text-amber-700">{t("migration_dollarAmbiguous")}</p>
          )}
          {suggestion && (
            <p className="mb-3 text-xs leading-relaxed text-slate-600">{t("migration_suggestion", { code: suggestion })}</p>
          )}
          <p className="mb-4 text-xs leading-relaxed text-slate-500">{t("migration_jpyScaleNote")}</p>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("migration_chooseCurrency")}</span>
            <select
              className={inputCls}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              aria-label={t("migration_chooseCurrency")}
            >
              <option value="">{t("migration_choosePlaceholder")}</option>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
          </label>

          {anomalies.length > 0 && (
            <div className="mb-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
              <p className="mb-2 text-xs font-medium text-rose-700">{t("migration_anomalyHeading")}</p>
              <ul className="space-y-1">
                {anomalies.map((row) => (
                  <li key={`${row.table}:${row.id}:${row.field}`} className="text-xs text-rose-800">
                    {t("migration_anomalyRow", {
                      table: row.table,
                      id: row.id,
                      field: row.field,
                      value: row.value,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {errorKey && <p className="mb-3 text-xs font-medium text-rose-600">{t(errorKey)}</p>}
          {restoreBackup && (
            <p className="mb-3 text-xs leading-relaxed text-rose-700">
              {t("migration_restoreBackup", { path: restoreBackup.filePath })}
            </p>
          )}

          <Btn type="submit" variant="primary" disabled={!selected || busy} className="w-full" aria-label={t("migration_confirm")}>
            {busy ? t("migration_busy") : t("migration_confirm")}
          </Btn>
        </div>
      </form>
    </div>
  );
}
