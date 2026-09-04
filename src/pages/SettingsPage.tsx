import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  HardDriveUpload,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { displayFxSource } from "../format";
import type { FxStatus, ImChannel, ImChannelType, Lang, WechatLoginState } from "../types";
import { Btn, Modal, inputCls } from "../components/ui";

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
        {desc && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">{desc}</p>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function SettingsPage() {
  const { boot, lang, setLang, t, toast, refreshBoot } = useApp();

  /* ------------------------- 通用 ------------------------- */
  const [reportingCurrency, setReportingCurrency] = useState(boot?.settings.reportingCurrency ?? "");
  const [addCurrency, setAddCurrency] = useState("");
  const [timezone, setTimezone] = useState(boot?.settings.timezone ?? "UTC");
  const enabledCurrencies = boot?.enabledCurrencies ?? [];
  const supportedCurrencies = boot?.supportedCurrencies ?? [];
  const currenciesToAdd = supportedCurrencies.filter((currency) => !enabledCurrencies.includes(currency.code));

  useEffect(() => {
    setReportingCurrency(boot?.settings.reportingCurrency ?? "");
  }, [boot?.settings.reportingCurrency]);

  // 时区选项：优先使用 Intl 提供的完整 IANA 列表，缺失时回落到常用时区
  const tzOptions = (() => {
    try {
      const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
      if (list && list.length) return list;
    } catch {}
    return [
      "UTC",
      "Asia/Shanghai",
      "Asia/Hong_Kong",
      "Asia/Taipei",
      "Asia/Tokyo",
      "Asia/Seoul",
      "Asia/Singapore",
      "Asia/Bangkok",
      "Asia/Kolkata",
      "Asia/Dubai",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Moscow",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "America/Sao_Paulo",
      "Australia/Sydney",
      "Pacific/Auckland",
    ];
  })();

  const saveGeneral = async () => {
    try {
      await api.saveSettings({
        timezone,
        ...(reportingCurrency ? { reportingCurrency } : {}),
      });
      await refreshBoot();
      toast(t("settings_savedOk"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  const enableSelectedCurrency = async () => {
    if (!addCurrency) return;
    try {
      await api.saveSettings({ enableCurrency: addCurrency });
      setAddCurrency("");
      await refreshBoot();
      toast(t("settings_savedOk"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  const [fxStatus, setFxStatus] = useState<FxStatus | null>(null);
  const [fxError, setFxError] = useState("");
  const [fxBusy, setFxBusy] = useState(false);
  const [fxBase, setFxBase] = useState("");
  const [fxQuote, setFxQuote] = useState("");
  const [fxDate, setFxDate] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [fxDiagOpen, setFxDiagOpen] = useState(false);

  const loadFxStatus = useCallback(async () => {
    const status = await api.getFxStatus();
    setFxStatus(status);
    return status;
  }, []);

  useEffect(() => {
    loadFxStatus().catch(() => {});
  }, [loadFxStatus]);

  const refreshFx = async () => {
    setFxBusy(true);
    setFxError("");
    try {
      const status = await api.syncFxRates();
      setFxStatus(status);
    } catch {
      setFxError(t("settings_fxRefreshFail"));
    } finally {
      setFxBusy(false);
    }
  };

  const saveManualRate = async () => {
    if (!fxBase || !fxQuote || !fxDate || !fxRate) return;
    try {
      await api.putFxRate(fxDate, fxBase, fxQuote, fxRate.trim());
      setFxError("");
      await loadFxStatus();
      toast(t("settings_savedOk"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  const deleteManualRate = async (rateDate: string, baseCurrency: string, quoteCurrency: string) => {
    try {
      await api.deleteFxRate(rateDate, baseCurrency, quoteCurrency);
      await loadFxStatus();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  /* ------------------------- AI / LLM ------------------------- */
  const [aiBaseUrl, setAiBaseUrl] = useState(boot?.settings.aiBaseUrl ?? "");
  const [aiModel, setAiModel] = useState(boot?.settings.aiModel ?? "");
  const [aiKey, setAiKey] = useState(boot?.settings.aiKey ?? "");
  const [aiExtraPrompt, setAiExtraPrompt] = useState(boot?.settings.aiExtraPrompt ?? "");
  const [aiRequireConfirmation, setAiRequireConfirmation] = useState(boot?.settings.aiRequireConfirmation ?? true);
  const [testing, setTesting] = useState(false);
  const configured = !!boot?.settings.aiKey;

  useEffect(() => {
    if (typeof boot?.settings.aiRequireConfirmation === "boolean") setAiRequireConfirmation(boot.settings.aiRequireConfirmation);
  }, [boot?.settings.aiRequireConfirmation]);

  const saveAi = async () => {
    // 关闭二次确认时二次弹窗，防止误关导致不可逆写入
    if (boot?.settings.aiRequireConfirmation && !aiRequireConfirmation) {
      if (!confirm(t("settings_aiRequireConfirmDisableTip"))) {
        setAiRequireConfirmation(true);
        return;
      }
    }
    await api.saveSettings({
      aiBaseUrl: aiBaseUrl.trim(),
      aiModel: aiModel.trim(),
      aiKey: aiKey.trim(),
      aiExtraPrompt: aiExtraPrompt.trim(),
      aiRequireConfirmation,
    });
    await refreshBoot();
    toast(t("settings_savedOk"));
  };

  const testAi = async () => {
    setTesting(true);
    try {
      await saveAi();
      await api.aiTest();
      toast(t("settings_testOk"), "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setTesting(false);
    }
  };

  /* ------------------------- 每日备份 ------------------------- */
  const [backupEnabled, setBackupEnabled] = useState(boot?.settings.backupEnabled ?? false);
  const [backupTime, setBackupTime] = useState(boot?.settings.backupCronTime ?? "03:00");
  const [r2Endpoint, setR2Endpoint] = useState(boot?.settings.backupR2Endpoint ?? "");
  const [r2Bucket, setR2Bucket] = useState(boot?.settings.backupR2Bucket ?? "");
  const [r2Prefix, setR2Prefix] = useState(boot?.settings.backupR2Prefix ?? "");
  const [r2AccessKeyId, setR2AccessKeyId] = useState(boot?.settings.backupR2AccessKeyId ?? "");
  const [r2SecretKey, setR2SecretKey] = useState("");
  const [backupBusy, setBackupBusy] = useState<"none" | "save" | "test" | "run">("none");

  const saveBackup = async () => {
    setBackupBusy("save");
    try {
      await api.saveSettings({
        backupEnabled,
        backupCronTime: backupTime,
        backupR2Endpoint: r2Endpoint.trim(),
        backupR2Bucket: r2Bucket.trim(),
        backupR2Prefix: r2Prefix.trim(),
        backupR2AccessKeyId: r2AccessKeyId.trim(),
        // 密钥留空表示保持服务端已存值不变
        backupR2SecretKey: r2SecretKey.trim(),
      });
      await refreshBoot();
      setR2SecretKey("");
      toast(t("settings_savedOk"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setBackupBusy("none");
    }
  };

  const testBackup = async () => {
    setBackupBusy("test");
    try {
      await api.testBackup();
      toast(t("settings_backupTestOk"), "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setBackupBusy("none");
    }
  };

  const runBackupNow = async () => {
    setBackupBusy("run");
    try {
      const r = await api.runBackup();
      await refreshBoot();
      toast("ok" in r ? t("settings_backupRunOk", { file: r.file }) : t("common_error"), "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setBackupBusy("none");
    }
  };

  const lastRunText = (() => {
    if (!boot?.settings.backupLastRunAt) return null;
    const ok = boot.settings.backupLastResult === "ok";
    const time = new Date(boot.settings.backupLastRunAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
    return ok
      ? `${t("settings_backupLastRun")}: ${time}`
      : t("settings_backupLastFail", { msg: boot.settings.backupLastResult ?? "" }) + ` (${time})`;
  })();

  /* ------------------------- IM 渠道 ------------------------- */
  const [channels, setChannels] = useState<ImChannel[] | null>(null);
  const [editing, setEditing] = useState<ImChannel | "new" | null>(null);
  const [loginFor, setLoginFor] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const { channels: list } = await api.imChannels();
      setChannels(list);
    } catch {
      setChannels([]);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <h1 className="text-lg font-bold text-slate-800">{t("settings_title")}</h1>

      <Card title={t("settings_general")}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_language")}</span>
            <div className="flex overflow-hidden rounded-full border border-slate-200 p-0.5">
              {(["zh", "en"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${
                    lang === l ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {l === "zh" ? "中文" : "EN"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_reportingCurrency")}</span>
            <select
              aria-label={t("settings_reportingCurrency")}
              value={reportingCurrency}
              onChange={(e) => setReportingCurrency(e.target.value)}
              className={`${inputCls} min-w-[140px]`}
            >
              {!reportingCurrency && <option value="">{t("settings_addCurrencyPlaceholder")}</option>}
              {enabledCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t("settings_reportingHint")}</p>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_timezone")}</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${inputCls} min-w-[220px]`}>
              {!tzOptions.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t("settings_timezoneHint")}</p>
          </div>
          <div className="flex items-end">
            <Btn onClick={saveGeneral}>{t("common_save")}</Btn>
          </div>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs font-medium text-slate-500">{t("settings_enabledCurrencies")}</p>
          <ul data-testid="enabled-currencies" className="mb-3 flex flex-wrap gap-1.5">
            {enabledCurrencies.map((code) => {
              const inUse = code === reportingCurrency || (boot?.accounts ?? []).some((acc) => acc.currencyCode === code);
              return (
                <li key={code} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-medium text-slate-600">
                  <span>{code}</span>
                  {inUse ? <span> · <span>{t("settings_inUse")}</span></span> : null}
                </li>
              );
            })}
          </ul>
          {currenciesToAdd.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_addCurrency")}</span>
                <select
                  aria-label={t("settings_addCurrency")}
                  value={addCurrency}
                  onChange={(e) => setAddCurrency(e.target.value)}
                  className={`${inputCls} min-w-[160px]`}
                >
                  <option value="">{t("settings_addCurrencyPlaceholder")}</option>
                  {currenciesToAdd.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code}
                    </option>
                  ))}
                </select>
              </label>
              <Btn aria-label={t("settings_addCurrencyConfirm")} onClick={enableSelectedCurrency} disabled={!addCurrency}>
                {t("settings_addCurrencyConfirm")}
              </Btn>
            </div>
          )}
        </div>
      </Card>

      <Card title={t("settings_fxSection")} desc={t("settings_fxDesc")}>
        <div data-testid="fx-section" className="space-y-4">
          <p className="text-[11px] leading-relaxed text-slate-400">{t("settings_fxHint")}</p>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxProvider")}</span>
              <p data-testid="fx-provider" className="text-sm font-medium text-slate-700">
                {fxStatus?.defaultProvider ? displayFxSource(fxStatus.defaultProvider) : "—"}
              </p>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxLatestDate")}</span>
              <p data-testid="fx-latest-date" className="text-sm font-medium text-slate-700">
                {fxStatus?.latestRateDate ?? t("settings_fxEmpty")}
              </p>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxLatestSource")}</span>
              <p data-testid="fx-latest-source" className="text-sm font-medium text-slate-700">
                {fxStatus?.latestSource ? displayFxSource(fxStatus.latestSource) : "—"}
              </p>
            </div>
            <Btn aria-label={t("settings_fxRefresh")} disabled={fxBusy} onClick={refreshFx}>
              {fxBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {fxBusy ? t("settings_fxRefreshing") : t("settings_fxRefresh")}
            </Btn>
          </div>
          {fxError && (
            <p data-testid="fx-refresh-error" className="text-xs text-rose-500">
              {fxError}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxBase")}</span>
              <select
                aria-label={t("settings_fxBase")}
                value={fxBase}
                onChange={(e) => setFxBase(e.target.value)}
                className={`${inputCls} min-w-[110px]`}
              >
                <option value="">{t("settings_addCurrencyPlaceholder")}</option>
                {enabledCurrencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxQuote")}</span>
              <select
                aria-label={t("settings_fxQuote")}
                value={fxQuote}
                onChange={(e) => setFxQuote(e.target.value)}
                className={`${inputCls} min-w-[110px]`}
              >
                <option value="">{t("settings_addCurrencyPlaceholder")}</option>
                {enabledCurrencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxDate")}</span>
              <input
                aria-label={t("settings_fxDate")}
                type="date"
                className={inputCls}
                value={fxDate}
                onChange={(e) => setFxDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t("settings_fxRate")}</span>
              <input
                aria-label={t("settings_fxRate")}
                className={`${inputCls} w-28`}
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder="7.20"
              />
            </label>
            <Btn onClick={saveManualRate} disabled={!fxBase || !fxQuote || !fxDate || !fxRate}>
              {t("settings_fxSaveManual")}
            </Btn>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
              onClick={() => setFxDiagOpen((open) => !open)}
            >
              {t("settings_fxDiagnostics")}
            </button>
            {fxDiagOpen && (
              <>
                <p className="mb-2 mt-3 text-xs font-medium text-slate-500">{t("settings_fxCached")}</p>
                <ul data-testid="fx-cache-list" className="space-y-1.5">
                  {(fxStatus?.rates ?? []).map((row) => (
                    <li
                      key={`${row.rateDate}-${row.baseCurrency}-${row.quoteCurrency}-${row.source}`}
                      className="flex items-center gap-2 text-[12px] text-slate-600"
                    >
                      <span className="min-w-0 flex-1">
                        {row.baseCurrency}/{row.quoteCurrency} {row.rate} · {row.rateDate} · {row.source}
                      </span>
                      {row.source === "manual" && (
                        <button
                          type="button"
                          className="rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                          aria-label={`${t("settings_fxDeleteManual")} ${row.baseCurrency}/${row.quoteCurrency} ${row.rateDate}`}
                          onClick={() => deleteManualRate(row.rateDate, row.baseCurrency, row.quoteCurrency)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title={t("settings_aiSection")} desc={t("settings_aiDesc")}>
        <Field label={t("settings_baseUrl")}>
          <input className={inputCls} value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label={t("settings_model")}>
          <input className={inputCls} value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o-mini" />
        </Field>
        <Field label={t("settings_apiKey")}>
          <input
            className={inputCls}
            type="password"
            autoComplete="off"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder="sk-…"
          />
        </Field>
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">{t("settings_extraPrompt")}</span>
            <span className="text-[11px] text-slate-300">{aiExtraPrompt.length}/20000</span>
          </div>
          <textarea
            className={`${inputCls} min-h-[96px] resize-y`}
            value={aiExtraPrompt}
            maxLength={20000}
            onChange={(e) => setAiExtraPrompt(e.target.value)}
            placeholder={t("settings_extraPromptPlaceholder")}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t("settings_extraPromptHint")}</p>
        </div>
        <label className="mb-4 flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
          <input
            aria-label={t("settings_aiRequireConfirm")}
            type="checkbox"
            checked={aiRequireConfirmation}
            onChange={(e) => {
              const next = e.target.checked;
              if (boot?.settings.aiRequireConfirmation && !next) {
                if (!confirm(t("settings_aiRequireConfirmDisableTip"))) return;
              }
              setAiRequireConfirmation(next);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-slate-700">{t("settings_aiRequireConfirm")}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">{t("settings_aiRequireConfirmHint")}</span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <Btn variant="primary" onClick={saveAi}>
            <Check size={14} /> {t("settings_aiSave")}
          </Btn>
          <Btn disabled={testing} onClick={testAi}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t("settings_testConn")}
          </Btn>
          <span
            className={`ml-auto h-2 w-2 rounded-full ${configured ? "bg-emerald-400" : "bg-slate-300"}`}
            title={configured ? t("settings_testOk") : t("chat_notConfigured")}
          />
        </div>
      </Card>

      <Card title={t("settings_backupSection")} desc={t("settings_backupDesc")}>
        <label className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-500">
          <input
            aria-label={t("settings_backupEnable")}
            type="checkbox"
            checked={backupEnabled}
            onChange={(e) => setBackupEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          {t("settings_backupEnable")}
        </label>
        <Field label={t("settings_backupTime")}>
          <input
            aria-label={t("settings_backupTime")}
            type="time"
            className={`${inputCls} w-32`}
            value={backupTime}
            onChange={(e) => setBackupTime(e.target.value)}
          />
        </Field>

        <p className="mb-3 mt-4 text-xs font-semibold text-slate-600">{t("settings_backupR2")}</p>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Field label={t("settings_backupEndpoint")}>
            <input className={inputCls} value={r2Endpoint} onChange={(e) => setR2Endpoint(e.target.value)} placeholder="https://<account>.r2.cloudflarestorage.com" />
          </Field>
          <Field label={t("settings_backupBucket")}>
            <input className={inputCls} value={r2Bucket} onChange={(e) => setR2Bucket(e.target.value)} placeholder="my-backups" />
          </Field>
          <Field label={t("settings_backupPrefix")}>
            <input className={inputCls} value={r2Prefix} onChange={(e) => setR2Prefix(e.target.value)} placeholder="xiaowen-ynab-backup" />
          </Field>
          <Field label={t("settings_backupAccessKeyId")}>
            <input className={inputCls} value={r2AccessKeyId} onChange={(e) => setR2AccessKeyId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={t("settings_backupSecretKey")}>
            <input
              className={inputCls}
              type="password"
              autoComplete="off"
              value={r2SecretKey}
              onChange={(e) => setR2SecretKey(e.target.value)}
              placeholder={boot?.settings.backupR2HasSecret ? t("settings_backupSecretPlaceholder") : ""}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn variant="primary" disabled={backupBusy !== "none"} onClick={saveBackup} aria-label="backup_save">
            {backupBusy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {backupBusy === "save" ? t("settings_backupBusy") : t("settings_backupSave")}
          </Btn>
          <Btn disabled={backupBusy !== "none"} onClick={testBackup} aria-label="backup_test">
            {t("settings_backupTest")}
          </Btn>
          <Btn disabled={backupBusy !== "none"} onClick={runBackupNow} aria-label="backup_run">
            {backupBusy === "run" ? <Loader2 size={14} className="animate-spin" /> : <HardDriveUpload size={14} />}
            {t("settings_backupRunNow")}
          </Btn>
          {lastRunText && <span className={`ml-auto text-[11px] ${boot?.settings.backupLastResult === "ok" ? "text-slate-400" : "text-rose-500"}`}>{lastRunText}</span>}
        </div>
      </Card>

      <Card title={t("settings_imSection")} desc={t("settings_imDesc")}>
        <div className="space-y-2">
          {(channels ?? []).map((ch) => (
            <ChannelRow
              key={ch.id}
              channel={ch}
              onChanged={loadChannels}
              onEdit={() => setEditing(ch)}
              onLogin={() => setLoginFor(ch.id)}
            />
          ))}
          {channels && channels.length === 0 && (
            <p className="py-6 text-center text-xs leading-relaxed text-slate-300">{t("settings_noChannels")}</p>
          )}
        </div>
        <div className="mt-4">
          <Btn variant="primary" onClick={() => setEditing("new")}>
            <Plus size={14} /> {t("settings_addChannel")}
          </Btn>
        </div>
      </Card>

      {editing && (
        <ChannelModal
          channel={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await loadChannels();
            toast(t("settings_savedOk"));
          }}
        />
      )}

      {loginFor && (
        <WechatLoginModal
          channel={channels?.find((c) => c.id === loginFor) ?? null}
          onClose={() => setLoginFor(null)}
          onConfirmed={async () => {
            setLoginFor(null);
            await loadChannels();
            toast(t("settings_savedOk"));
          }}
        />
      )}
    </div>
  );
}

/* ------------------------- 渠道行 ------------------------- */

function ChannelRow({
  channel,
  onChanged,
  onEdit,
  onLogin,
}: {
  channel: ImChannel;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onLogin: () => void;
}) {
  const { t, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const Icon = channel.type === "telegram" ? Send : MessageCircle;
  const typeLabel = channel.type === "telegram" ? "Telegram" : "微信";
  const wxUserId = channel.type === "wechat" ? channel.config.userId : undefined;

  const toggle = async () => {
    setBusy(true);
    try {
      await api.updateImChannel(channel.id, { enabled: !channel.enabled });
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t("settings_deleteChannelConfirm"))) return;
    try {
      await api.deleteImChannel(channel.id);
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-2.5 transition-colors hover:border-slate-200">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          channel.type === "telegram" ? "bg-sky-50 text-sky-500" : "bg-emerald-50 text-emerald-600"
        }`}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-slate-700">{channel.name}</div>
        <div className="truncate text-[11px] text-slate-300">
          {channel.type === "wechat"
            ? wxUserId
              ? `${typeLabel} · ${wxUserId}`
              : t("settings_notBound")
            : typeLabel}
        </div>
      </div>
      {channel.type === "wechat" && (
        <Btn aria-label={`login-${channel.id}`} onClick={onLogin}>
          <QrCode size={13} /> {t("settings_wechatScan")}
        </Btn>
      )}
      <button
        aria-label={channel.id}
        role="switch"
        aria-checked={channel.enabled}
        disabled={busy}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
          channel.enabled ? "bg-emerald-500" : "bg-slate-200"
        }`}
      >
        <span
          className={`ml-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            channel.enabled ? "translate-x-4" : ""
          }`}
        />
      </button>
      <div className="flex shrink-0 gap-0.5">
        <button
          aria-label={`edit-${channel.id}`}
          className="rounded-md p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
        <button
          aria-label={`del-${channel.id}`}
          className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
          onClick={remove}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------- 渠道编辑弹窗 ------------------------- */

function ChannelModal({
  channel,
  onClose,
  onSaved,
}: {
  channel: ImChannel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, toast } = useApp();
  const [type, setType] = useState<ImChannelType>(channel?.type ?? "telegram");
  const [name, setName] = useState(channel?.name ?? "");
  const tg = channel && channel.type === "telegram" ? channel.config : null;
  const [token, setToken] = useState(tg?.token ?? "");
  const [allowedChatIds, setAllowedChatIds] = useState((tg?.allowedChatIds ?? []).join(", "));

  const isWechat = type === "wechat";
  const allowedIdList = allowedChatIds
    .split(/[\uFF0C,\s]+/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  const submit = async () => {
    if (!name.trim()) {
      toast(t("settings_channelName"), "err");
      return;
    }
    try {
      if (channel) {
        await api.updateImChannel(channel.id, {
          name: name.trim(),
          config: isWechat ? {} : { token, allowedChatIds: allowedIdList },
        });
      } else {
        await api.createImChannel({
          type,
          name: name.trim(),
          enabled: false,
          // 个人微信的凭据由扫码登录写入，创建时无需填写
          config: isWechat ? {} : { token, allowedChatIds: allowedIdList },
        });
      }
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  return (
    <Modal title={channel ? t("settings_editChannel") : t("settings_addChannel")} onClose={onClose}>
      <Field label={t("settings_channelType")}>
        <select className={inputCls} value={type} disabled={!!channel} onChange={(e) => setType(e.target.value as ImChannelType)}>
          <option value="telegram">Telegram</option>
          <option value="wechat">微信（个人号 · 扫码登录）</option>
        </select>
      </Field>
      <Field label={t("settings_channelName")}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={isWechat ? "我的微信" : "我的机器人"} />
      </Field>

      {isWechat ? (
        <>
          {channel?.type === "wechat" && channel.config.userId && (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              {t("settings_boundAccount", { id: channel.config.userId })}
            </p>
          )}
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-700">
            {t("settings_scanHint")}
          </p>
        </>
      ) : (
        <>
          <Field label={t("settings_botToken")}>
            <input className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF…" />
          </Field>
          <Field label={t("settings_allowedIds")}>
            <input className={inputCls} value={allowedChatIds} onChange={(e) => setAllowedChatIds(e.target.value)} placeholder="123456789, 987654321" />
          </Field>
        </>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>{t("common_cancel")}</Btn>
        <Btn variant="primary" aria-label="channel_submit" onClick={submit}>
          <Check size={14} /> {t("common_save")}
        </Btn>
      </div>
    </Modal>
  );
}

/* ------------------------- 微信扫码登录弹窗 ------------------------- */

function WechatLoginModal({
  channel,
  onClose,
  onConfirmed,
}: {
  channel: ImChannel | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { t, toast } = useApp();
  const [state, setState] = useState<WechatLoginState | null>(null);
  const [code, setCode] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const doneRef = useRef(false);
  const channelId = channel?.id ?? "";

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;

    api
      .startWechatLogin(channelId)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((e) => {
        if (!cancelled) toast(e instanceof Error ? e.message : t("common_error"), "err");
      });

    const timer = setInterval(async () => {
      if (doneRef.current || cancelled) return;
      try {
        const s = await api.wechatLoginState(channelId);
        if (cancelled) return;
        setState((prev) => ({ ...s, qrDataUrl: s.qrDataUrl ?? prev?.qrDataUrl ?? null }));
        if (["confirmed", "failed", "timeout", "already_connected"].includes(s.status)) {
          doneRef.current = true;
          clearInterval(timer);
          if (s.status === "confirmed") setTimeout(onConfirmed, 600);
        }
      } catch {
        // 登录会话不存在（超时/未开始）→ 停止轮询
        doneRef.current = true;
        clearInterval(timer);
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const statusText =
    state?.status === "need_verifycode" ? t("settings_verifyPrompt") : state?.message || state?.error || "";

  const cancel = async () => {
    setCancelling(true);
    try {
      doneRef.current = true;
      await api.cancelWechatLogin(channelId);
    } catch {}
    onClose();
  };

  const submitCode = async () => {
    const c = code.trim();
    if (!c) return;
    try {
      await api.submitWechatVerifyCode(channelId, c);
      setCode("");
      setState((prev) => (prev ? { ...prev, status: "scanned" } : prev));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  };

  return (
    <Modal title={`${t("settings_wechatScan")} · ${channel?.name ?? ""}`} onClose={onClose} width="max-w-sm">
      <div className="flex flex-col items-center">
        {state?.qrDataUrl ? (
          <img src={state.qrDataUrl} alt="qrcode" className="rounded-xl border border-slate-100 p-1" />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center rounded-xl border border-slate-100 bg-slate-50">
            <Loader2 size={22} className="animate-spin text-brand-500" />
          </div>
        )}
        <p className="mt-3 min-h-[36px] text-center text-xs leading-relaxed text-slate-500">{statusText}</p>

        {state?.status === "need_verifycode" && (
          <div className="mt-1 flex w-full items-center gap-2">
            <input
              aria-label={t("settings_verifyPrompt")}
              className={inputCls}
              value={code}
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && submitCode()}
              placeholder="1234"
            />
            <Btn variant="primary" aria-label="verify_submit" onClick={submitCode} disabled={!code.trim()}>
              <Check size={14} /> OK
            </Btn>
          </div>
        )}

        <button className="mt-4 text-xs text-slate-400 hover:text-slate-600" disabled={cancelling} onClick={cancel}>
          {t("settings_loginCancel")}
        </button>
      </div>
    </Modal>
  );
}
