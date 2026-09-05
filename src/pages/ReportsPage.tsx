import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Hourglass, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../api";
import { useApp } from "../store";
import { displayFxRate, displayFxSource, fmtMoney, fmtMonthShort, localeForLang } from "../format";
import { coerceEnabledCurrency, formatHash, parseHash, pushHash, replaceHash, useHashRoute, type CurrencyNotice } from "../hashRoute";
import type { CashflowDetail, CashflowOverview, InvestmentList, NetWorthReport } from "../types";
import { Spinner } from "../components/ui";
import { householdToday, resolveNetWorthRoute, type ValuationDateNotice } from "../netWorthRoute";
import { chartMoneyLayout } from "../chartMoneyLayout";

const PALETTE = ["#6a63f0", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#84cc16", "#14b8a6", "#f97316"];

function reportsSection(path: string): "cashflow" | "investments" | "net-worth" {
  if (path.startsWith("/reports/investments")) return "investments";
  if (path.startsWith("/reports/net-worth")) return "net-worth";
  return "cashflow";
}

function currencyRoleName(role: string, code: string) {
  return `${role}：${code}`;
}

function useReportRequest<T>(key: string | null, fetchReport: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; data: T | null; error: boolean } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let active = true;
    fetchReport().then(
      data => { if (active) setResult({ key, attempt, data, error: false }); },
      () => { if (active) setResult({ key, attempt, data: null, error: true }); },
    );
    return () => { active = false; };
  }, [key, attempt]);
  const current = result?.key === key && result.attempt === attempt ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? false, retry: () => setAttempt(value => value + 1) };
}

function ReportPending({ error, retry }: { error: boolean; retry: () => void }) {
  const { t } = useApp();
  return error ? <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
    <p>{t("rep_loadError")}</p>
    <button type="button" onClick={retry} className="mt-2 rounded border px-3 py-1">{t("rep_retry")}</button>
  </div> : <Spinner />;
}

function currencyChipClass(selected: boolean) {
  return `rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
    selected ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
  }`;
}

type ReportCurrencyNotice = CurrencyNotice & {
  section: "cashflow" | "net-worth";
  displayedCurrency: string;
};

function CurrencyFallbackNotice({ notice }: { notice: ReportCurrencyNotice | null }) {
  const { t } = useApp();
  if (!notice) return null;
  const fallback = notice.section === "cashflow" ? t("rep_viewAll") : notice.fallback;
  return (
    <div role="status" aria-live="polite" className="mb-3 text-xs font-medium text-amber-700">
      {notice.reason === "disabled"
        ? t("currency_disabled", { code: notice.requested, fallback })
        : t("currency_unsupported", { code: notice.requested, fallback })}
    </div>
  );
}

export function ReportsPage() {
  const { t, boot } = useApp();
  const route = useHashRoute();
  const parsed = parseHash(route);
  const section = reportsSection(parsed.path);
  const [notice, setNotice] = useState<ReportCurrencyNotice | null>(null);
  const enabled = boot?.enabledCurrencies ?? [];
  const supported = (boot?.supportedCurrencies ?? []).map((item) => item.code);
  const fallback = boot?.settings.reportingCurrency && enabled.includes(boot.settings.reportingCurrency)
    ? boot.settings.reportingCurrency
    : enabled[0] ?? null;

  useEffect(() => {
    if (section !== "cashflow") {
      setNotice(null);
      return;
    }
    const requested = parsed.query.currency;
    const coerced = coerceEnabledCurrency(requested, enabled, supported, fallback);
    if (coerced.notice && coerced.currency) {
      setNotice({ ...coerced.notice, section, displayedCurrency: "" });
      const nextQuery = { ...parsed.query };
      delete nextQuery.currency;
      replaceHash(formatHash("/reports/cashflow", nextQuery));
      return;
    }
    // Retain the explanation on the normalized destination. Clear it only when
    // navigation changes the displayed section or currency, not on replace/rerender.
    setNotice(previous => previous?.section === section && previous.displayedCurrency === (requested || "") ? previous : null);
  }, [parsed.query.currency, parsed.query.asOf, section, enabled, supported, fallback]);

  return (
    <div className="mx-auto min-w-0 w-full max-w-6xl break-words px-4 py-6 md:px-6 md:py-8 [&_.num]:break-all">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{t("nav_reports")}</h1>
        <nav className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-0.5 text-[12px] font-semibold">
          <a
            href="#/reports/cashflow"
            className={`rounded-md px-2.5 py-1 ${section === "cashflow" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
          >
            {t("rep_nativeView")}
          </a>
          <a
            href="#/reports/investments"
            className={`rounded-md px-2.5 py-1 ${section === "investments" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
          >
            {t("nav_investments")}
          </a>
          <a
            href="#/reports/net-worth"
            className={`rounded-md px-2.5 py-1 ${section === "net-worth" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
          >
            {t("nav_netWorth")}
          </a>
        </nav>
      </div>
      <CurrencyFallbackNotice notice={notice} />
      {section === "investments" ? (
        <InvestmentReportPage />
      ) : section === "net-worth" ? (
        <NetWorthPage />
      ) : parsed.query.currency ? (
        <CashflowDetailPage currency={parsed.query.currency} />
      ) : (
        <CashflowOverviewPage />
      )}
    </div>
  );
}

function CashflowOverviewPage() {
  const { t, lang, boot } = useApp();
  const { data, error, retry } = useReportRequest<CashflowOverview>("overview", () => api.cashflowOverview());

  const active = data?.currencies.filter((row) => row.active) ?? [];
  const enabled = boot?.enabledCurrencies ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-600">{`${t("rep_viewCurrency")}：${t("rep_viewAll")}`}</span>
        <button
          type="button"
          className={currencyChipClass(true)}
          aria-label={currencyRoleName(t("rep_viewCurrency"), t("rep_viewAll"))}
          aria-pressed="true"
        >
          {t("rep_viewAll")}
        </button>
        {enabled.map((code) => {
          const row = data?.currencies.find((item) => item.currencyCode === code);
          return (
            <a
              key={code}
              href={`#/reports/cashflow?currency=${encodeURIComponent(code)}`}
              className={currencyChipClass(false)}
              aria-label={currencyRoleName(t("rep_viewCurrency"), code)}
            >
              {code}
              {row && !row.active ? ` · ${t("rep_inactive")}` : ""}
            </a>
          );
        })}
      </div>
      {!data && <ReportPending error={error} retry={retry} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((row) => (
          <a
            key={row.currencyCode}
            href={`#/reports/cashflow?currency=${encodeURIComponent(row.currencyCode)}`}
            className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card hover:border-brand-200"
          >
            <div className="text-sm font-bold text-slate-800">{row.currencyCode}</div>
            <dl className="mt-3 space-y-1 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-slate-400">{t("rep_cashflowIncome")}</dt>
                <dd className="num text-emerald-600">
                  {fmtMoney(row.incomeMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">{t("rep_cashflowExpense")}</dt>
                <dd className="num text-rose-500">
                  {fmtMoney(row.expenseMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">{t("rep_cashflowNet")}</dt>
                <dd className="num font-semibold text-slate-800">
                  {fmtMoney(row.netInflowMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </dd>
              </div>
            </dl>
          </a>
        ))}
      </div>
    </div>
  );
}

function CashflowDetailPage({ currency }: { currency: string }) {
  const { t, boot } = useApp();
  const { data, error, retry } = useReportRequest<CashflowDetail>(currency, async () => {
    const report = await api.cashflowDetail(currency, 12);
    if (report.currencyCode !== currency) throw new Error("Unexpected report currency");
    return report;
  });

  const enabled = boot?.enabledCurrencies ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-600">{`${t("rep_viewCurrency")}：${currency}`}</span>
        <a
          href="#/reports/cashflow"
          className={currencyChipClass(false)}
          aria-label={currencyRoleName(t("rep_viewCurrency"), t("rep_viewAll"))}
        >
          {t("rep_viewAll")}
        </a>
        {enabled.map((code) => (
          <a
            key={code}
            href={`#/reports/cashflow?currency=${encodeURIComponent(code)}`}
            className={currencyChipClass(code === currency)}
            aria-label={currencyRoleName(t("rep_viewCurrency"), code)}
            aria-current={code === currency ? "true" : undefined}
          >
            {code}
          </a>
        ))}
      </div>
      {data ? <CashflowDetailView data={data} /> : <ReportPending error={error} retry={retry} />}
    </div>
  );
}

function InvestmentReportPage() {
  const { t, lang, boot } = useApp();
  const route = useHashRoute();
  const query = parseHash(route).query;
  const { data, error, retry } = useReportRequest<InvestmentList>("investments", () => api.investments());
  const [filterNotice, setFilterNotice] = useState(false);
  const enabled = boot?.enabledCurrencies ?? [];
  const currency = query.currency && enabled.includes(query.currency) ? query.currency : "";
  const availableAccounts = (data?.accounts ?? []).filter(row => !currency || row.currencyCode === currency);
  const account = availableAccounts.some(row => row.accountId === query.account) ? query.account : "";
  useEffect(() => {
    if (!boot || !data) return;
    if ((query.currency || "") !== currency || (query.account || "") !== account) {
      setFilterNotice(true);
      replaceHash(formatHash("/reports/investments", { ...(currency ? { currency } : {}), ...(account ? { account } : {}) }));
    }
  }, [boot, data, query.currency, query.account, currency, account]);
  const changeFilter = (nextCurrency: string, nextAccount: string) => {
    setFilterNotice(false);
    pushHash(formatHash("/reports/investments", { ...(nextCurrency ? { currency: nextCurrency } : {}), ...(nextAccount ? { account: nextAccount } : {}) }));
  };
  const rows = availableAccounts.filter(row => !account || row.accountId === account);
  const subtotalMap = new Map<string, number>();
  for (const row of rows) subtotalMap.set(row.currencyCode, (subtotalMap.get(row.currencyCode) ?? 0) + row.balanceMinor);
  const subtotals = [...subtotalMap].map(([currencyCode, balanceMinor]) => ({ currencyCode, balanceMinor }));

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold text-slate-800">{t("nav_investments")}</h2>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <label className="flex min-w-0 flex-wrap items-center gap-2">{t("rep_viewCurrency")}
          <select className="max-w-full rounded border p-1" value={currency} onChange={e => changeFilter(e.target.value, "")}>
            <option value="">{t("rep_viewAll")}</option>
            {enabled.map(code => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-wrap items-center gap-2">{t("rep_investmentAccount")}
          <select className="max-w-full rounded border p-1" value={account} disabled={!data} onChange={e => changeFilter(currency, e.target.value)}>
            <option value="">{t("rep_allAccounts")}</option>
            {availableAccounts.map(row => <option key={row.accountId} value={row.accountId}>{row.name}</option>)}
          </select>
        </label>
      </div>
      {filterNotice && <p role="status" className="mb-3 text-sm text-amber-700">{t("rep_filterUnavailable")}</p>}
      {!data ? <ReportPending error={error} retry={retry} /> : <>
      {rows.length === 0 && <div className="mb-3 text-sm text-slate-500">
        <p>{t("rep_noInvestments")}</p>
        <a href="#/accounts" className="mt-2 inline-block text-brand-600 underline">{t("rep_addInvestment")}</a>
      </div>}
      <div role="region" aria-label={t("mc_investmentAccounts")} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-card">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2">{t("account_name")}</th>
              <th className="px-4 py-2">{t("account_currency")}</th>
              <th className="px-4 py-2 text-right">{t("inv_balance")}</th>
              <th className="px-4 py-2 text-right">{t("inv_balanceChange")}</th>
              <th className="px-4 py-2 text-right">{t("inv_contributions")}</th>
              <th className="px-4 py-2 text-right">{t("inv_withdrawals")}</th>
              <th className="px-4 py-2 text-right">{t("inv_netContributions")}</th>
              <th className="px-4 py-2">{t("inv_latestValuation")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.accountId} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-700">
                  <a href={`#/accounts/${row.accountId}`} className="hover:text-brand-600">
                    {row.name}
                  </a>
                </td>
                <td className="px-4 py-2 text-slate-500">{row.currencyCode}</td>
                <td className="num px-4 py-2 text-right">
                  {fmtMoney(row.balanceMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </td>
                <td className="num px-4 py-2 text-right">
                  {fmtMoney(row.balanceChangeMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </td>
                <td className="num px-4 py-2 text-right">
                  {fmtMoney(row.contributionsMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </td>
                <td className="num px-4 py-2 text-right">
                  {fmtMoney(row.withdrawalsMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </td>
                <td className="num px-4 py-2 text-right">
                  {fmtMoney(row.netContributionsMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
                </td>
                <td className="px-4 py-2 text-slate-500">{row.latestValuationDate ?? t("inv_noValuation")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {subtotals.length > 0 && (
        <div aria-label={t("rep_nativeSubtotals")} className="mt-4 space-y-1 text-[13px] text-slate-600">
          {subtotals.map((row) => (
            <div key={row.currencyCode} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>{t("rep_nativeSubtotals")}：{row.currencyCode}</span>
              <span className="num font-semibold">
                {fmtMoney(row.balanceMinor, { currencyCode: row.currencyCode, locale: localeForLang(lang) })}
              </span>
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}

function NetWorthPage() {
  const { boot, t } = useApp();
  const route = useHashRoute();
  const enabled = boot?.enabledCurrencies ?? [];
  const reportingDefault = boot?.settings.reportingCurrency && enabled.includes(boot.settings.reportingCurrency)
    ? boot.settings.reportingCurrency : enabled[0] ?? null;
  const today = boot ? householdToday(boot.settings.timezone) : "";
  const resolved = resolveNetWorthRoute(route, {
    today, enabled, supported: (boot?.supportedCurrencies ?? []).map(item => item.code), fallback: reportingDefault,
  });
  const { currency, asOf, hash: canonicalHash, dateNotice, currencyNotice } = resolved;
  const [recovery, setRecovery] = useState<{
    hash: string; date: ValuationDateNotice | null; currency: CurrencyNotice | null;
  } | null>(null);
  const ready = !!boot && !!currency;
  const { data, error, retry } = useReportRequest<NetWorthReport>(ready ? `${currency}|${asOf}` : null, async () => {
    const report = await api.netWorthReport({ reportingCurrency: currency ?? "", months: 12, asOf });
    if (report.reportingCurrency !== currency) throw new Error("Unexpected report currency");
    return report;
  });

  useEffect(() => {
    if (!ready) return;
    if (dateNotice || currencyNotice) {
      setRecovery({ hash: canonicalHash, date: dateNotice, currency: currencyNotice });
    } else {
      setRecovery(previous => previous?.hash === canonicalHash ? previous : null);
    }
    if (route !== canonicalHash) replaceHash(canonicalHash);
  }, [ready, route, canonicalHash, dateNotice, currencyNotice?.reason, currencyNotice?.requested]);

  return (
    <div>
      <CurrencyFallbackNotice notice={recovery?.currency ? { ...recovery.currency, section: "net-worth", displayedCurrency: currency ?? "" } : null} />
      {recovery?.date && <div role="status" aria-live="polite" className="mb-3 text-xs font-medium text-amber-700">
        {t(recovery.date === "future" ? "rep_futureValuationDate" : "rep_invalidValuationDate", { date: asOf })}
      </div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t("rep_convertTo")} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-600">{t("rep_convertTo")}</span>
          {enabled.map((code) => (
            <button
              type="button"
              key={code}
              aria-label={currencyRoleName(t("rep_convertTo"), code)}
              aria-pressed={code === currency}
              className={currencyChipClass(code === currency)}
              onClick={() => pushHash(formatHash("/reports/net-worth", { currency: code, asOf }))}
            >
              {code}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <span>{t("rep_asOf", { date: asOf })}</span>
          <input
            type="date"
            aria-label={t("rep_valuationDate")}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            value={asOf}
            max={today || undefined}
            disabled={!ready}
            onChange={(e) => {
              const query = new URLSearchParams({ currency: currency ?? "", asOf: e.target.value });
              pushHash(`#/reports/net-worth?${query.toString()}`);
            }}
          />
        </label>
      </div>
      <div className="mb-4 space-y-1 text-xs leading-relaxed text-slate-500">
        <p>{t("rep_netWorthChanges")}</p>
        <p>{t("rep_fxValuationOnly")}</p>
      </div>
      {data ? <NetWorthReportView data={data} /> : <ReportPending error={error} retry={retry} />}
    </div>
  );
}

function CashflowDetailView({ data }: { data: CashflowDetail }) {
  const { lang, t } = useApp();
  const currency = data.currencyCode;
  const money = (amount: number) => fmtMoney(amount, { currencyCode: currency, locale: localeForLang(lang) });
  const chartLayout = chartMoneyLayout([...data.income, ...data.expense].map(row => row.value), money);

  const ie = data.months.map((m, i) => ({
    label: fmtMonthShort(m, lang),
    income: data.income[i]?.value ?? 0,
    expense: data.expense[i]?.value ?? 0,
    _income: data.income[i]?.value ?? 0,
    _expense: data.expense[i]?.value ?? 0,
  }));
  const pie = data.breakdown.filter((b) => b.value > 0).map((b) => ({ name: b.kind === "uncategorized" ? t("tx_uncategorized") : b.name, value: b.value, _raw: b.value }));
  const cur = data.income[data.income.length - 1];

  return (
    <>
      <p className="mb-4 text-xs text-slate-400">{t("rep_nativeHint")}</p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Hourglass size={13} /> {t("rep_aom")}
          </div>
          <div className="num mt-2 text-2xl font-bold text-slate-900">{t("rep_aomDays", { n: data.ageOfMoney })}</div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t("rep_aomDesc")}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <TrendingUp size={13} /> {t("rep_income")} ({fmtMonthShort(cur?.month ?? "", lang)})
          </div>
          <div className="num mt-2 text-2xl font-bold text-emerald-600">{money(cur?.value ?? 0)}</div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            {lang === "zh" ? "所有预算内账户的本月流入。" : "Total inflows to on-budget accounts this month."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={t("rep_incomeExpense")}>
          <ChartData title={t("rep_incomeExpense")} headers={[t("mc_month"), t("rep_income"), t("rep_expense")]} rows={ie.map((row, index) => [data.months[index], money(row.income), money(row.expense)])} />
          <div role="region" aria-label={t("rep_incomeExpense")} tabIndex={0} className="max-w-full overflow-x-auto">
          <div style={{ minWidth: chartLayout.minChartWidth }}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={chartLayout.axisWidth}
                tickFormatter={(v: number) => money(v)} />
              <Tooltip content={<IETooltip currency={currency} lang={lang} />} cursor={{ fill: "rgba(106,99,240,0.05)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name={t("rep_income")} fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="expense" name={t("rep_expense")} fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
          </div>
          </div>
        </Card>

        <Card title={t("rep_breakdown")}>
          <ChartData title={t("rep_breakdown")} headers={[t("write_category"), t("rep_expense")]} rows={pie.map(row => [row.name, money(row.value)])} />
          {pie.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="flex min-w-0 flex-col items-center sm:flex-row">
              <div className="min-w-0 w-full sm:w-[55%]">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} strokeWidth={0}>
                    {pie.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip currency={currency} lang={lang} total={pie.reduce((s, p) => s + p.value, 0)} />} />
                </PieChart>
              </ResponsiveContainer>
              </div>
              <div className="min-w-0 w-full max-h-[250px] flex-1 space-y-1 overflow-auto pr-1">
                {pie.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] hover:bg-slate-50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="min-w-0 flex-1 truncate text-slate-600">{p.name}</span>
                    <span className="num font-medium text-slate-700">{money(p._raw)}</span>
                    <span className="num w-10 text-right text-[11px] text-slate-400">
                      {Math.round((p._raw / pie.reduce((s, x) => s + x._raw, 0)) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title={t("rep_topPayees")}>
          {data.topPayees.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-2 pt-1">
              {data.topPayees.map((p, i) => {
                const max = data.topPayees[0]?.value || 1;
                const pct = Math.max((p.value / max) * 100, 4);
                return (
                  <div key={i} className="group relative overflow-hidden rounded-lg bg-slate-50/80 px-3 py-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-100 to-brand-50 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span className="truncate pr-3 text-[13px] font-medium text-slate-700">{p.name}</span>
                      <span className="num text-[13px] font-semibold text-brand-700">{money(p.value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={t("rep_incomeSources")}>
          {data.incomeSources.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="space-y-2 pt-1">
              {data.incomeSources.map((p, i) => {
                const max = data.incomeSources[0]?.value || 1;
                const pct = Math.max((p.value / max) * 100, 4);
                return (
                  <div key={i} className="group relative overflow-hidden rounded-lg bg-emerald-50/60 px-3 py-2">
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-100 to-transparent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span className="truncate pr-3 text-[13px] font-medium text-slate-700">{p.name}</span>
                      <span className="num text-[13px] font-semibold text-emerald-700">{money(p.value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function NetWorthReportView({ data }: { data: NetWorthReport }) {
  const { lang, t } = useApp();
  const currency = data.reportingCurrency;
  const money = (amount: number) => fmtMoney(amount, { currencyCode: currency, locale: localeForLang(lang) });
  const nativeMoney = (amount: number, code: string) =>
    fmtMoney(amount, { currencyCode: code, locale: localeForLang(lang) });
  const history = data.history.map((point) => ({
    month: point.month,
    label: fmtMonthShort(point.month, lang),
    net: point.complete ? point.netWorthMinor : null,
  }));
  const chartLayout = chartMoneyLayout(history.map(row => row.net), money);
  const historyMissing = data.history.flatMap((point) =>
    point.complete
      ? []
      : point.missing.map((row) => ({
          from: row.base,
          to: row.quote,
          date: point.asOf,
        })),
  );

  return (
    <>
      <p className="mb-4 text-xs text-slate-400">
        {t("rep_netWorthHint")} {t("rep_asOf", { date: data.asOf })}
      </p>

      {data.complete ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Scale size={13} /> {t("rep_now")}
            </div>
            <div className={`num mt-2 text-2xl font-bold ${data.netWorthMinor < 0 ? "text-rose-600" : "text-slate-900"}`}>
              {money(data.netWorthMinor)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
              <TrendingUp size={13} /> {t("rep_assets")}
            </div>
            <div className="num mt-2 text-2xl font-bold text-emerald-700">{money(data.totalAssetsMinor)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rose-500">
              <TrendingDown size={13} /> {t("rep_liabilities")}
            </div>
            <div className="num mt-2 text-2xl font-bold text-rose-600">{money(data.totalLiabilitiesMinor)}</div>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-900">{t("rep_incomplete")}</p>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider text-amber-700">{t("rep_missingRates")}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {data.missing.map((row) => (
              <li key={`${row.base}-${row.quote}-${row.requestedDate}`}>
                {t("rep_missingPair", { from: row.base, to: row.quote })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {historyMissing.length > 0 ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-900">{t("rep_historyMissing")}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {historyMissing.map((row) => (
              <li key={`${row.from}-${row.to}-${row.date}`}>
                {t("rep_historyMissingPair", { from: row.from, to: row.to, date: row.date })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mb-5">
          <Card title={t("rep_netWorth")}>
            <ChartData title={t("rep_netWorth")} headers={[t("mc_month"), t("rep_netWorth")]} rows={history.map(row => [row.month, row.net == null ? t("rep_incomplete") : money(row.net)])} />
            <div role="region" aria-label={t("rep_netWorth")} tabIndex={0} className="max-w-full overflow-x-auto">
            <div style={{ minWidth: chartLayout.minChartWidth }}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nwFxFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6a63f0" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#6a63f0" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={chartLayout.axisWidth}
                  tickFormatter={(v: number) => money(v)}
                />
                <Tooltip content={<MoneyTooltip currency={currency} lang={lang} />} cursor={{ stroke: "#c7d2fe" }} />
                <Area type="monotone" dataKey="net" stroke="#6a63f0" strokeWidth={2.5} fill="url(#nwFxFill)" />
              </AreaChart>
            </ResponsiveContainer>
            </div>
            </div>
          </Card>
        </div>
      ) : null}

      <Card title={t("rep_accountsDetail")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="pb-2 pr-3 font-bold">{t("account_name")}</th>
                <th className="pb-2 pr-3 font-bold">{t("account_currency")}</th>
                <th className="pb-2 pr-3 text-right font-bold">{t("rep_nativeBalance")}</th>
                <th className="pb-2 pr-3 text-right font-bold">{t("rep_convertedBalance")}</th>
                <th className="pb-2 pr-3 font-bold">{t("rep_rateDate")}</th>
                <th className="pb-2 pr-3 font-bold">{t("rep_rateSource")}</th>
                <th className="pb-2 text-right font-bold">{t("rep_rate")}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-700">{row.name}</td>
                  <td className="py-2 pr-3 text-slate-500">{row.currencyCode}</td>
                  <td className="num py-2 pr-3 text-right text-slate-700">
                    {nativeMoney(row.nativeBalanceMinor, row.currencyCode)}
                  </td>
                  <td className="num py-2 pr-3 text-right text-slate-700">
                    {row.convertedBalanceMinor == null ? t("rep_convertedNone") : money(row.convertedBalanceMinor)}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{row.fx?.rateDate ?? t("rep_convertedNone")}</td>
                  <td className="py-2 pr-3 text-slate-500">
                    {row.fx
                      ? displayFxSource(row.fx.source, row.fx.from === row.fx.to || row.fx.source === "identity", lang)
                      : t("rep_convertedNone")}
                  </td>
                  <td className="num py-2 text-right text-slate-500">
                    {row.fx
                      ? displayFxRate(row.fx.from, row.fx.to, row.fx.rate, lang)
                      : t("rep_convertedNone")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function ChartData({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  const { t } = useApp();
  return <details className="mb-3 text-xs">
    <summary className="cursor-pointer font-medium text-slate-600">{t("rep_chartData")}</summary>
    <div className="min-w-0 max-w-full overflow-x-auto" tabIndex={0}>
      <table aria-label={title} className="w-full text-left">
        <thead><tr>{headers.map(header => <th key={header} scope="col" className="p-2">{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column} className="p-2">{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
      <h2 className="mb-3 text-[13px] font-bold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

function EmptyChart() {
  return <div className="flex h-[220px] items-center justify-center text-sm text-slate-300">—</div>;
}

function moneyOf(amount: number, currency: string, lang: string) {
  return fmtMoney(amount, { currencyCode: currency, locale: localeForLang(lang) });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MoneyTooltip(props: any) {
  const { active, payload, label, currency, lang } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-0.5 font-semibold text-slate-600">{label}</div>
      <div className="num font-bold text-brand-600">{moneyOf(Number(payload[0].value), currency, lang)}</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IETooltip(props: any) {
  const { active, payload, label, currency, lang } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-semibold text-slate-600">{label}</div>
      {payload.map((p: { dataKey?: string; value?: number; name?: string }, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span style={{ color: p.dataKey === "income" ? "#10b981" : "#f43f5e" }}>{p.name}</span>
          <span className="num font-medium text-slate-700">{moneyOf(Number(p.value), currency, lang)}</span>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieTooltip({ active, payload, total, currency, lang }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] shadow-pop">
      <div className="font-semibold text-slate-600">{p.name}</div>
      <div className="num text-slate-800">{moneyOf(p.value, currency, lang)}</div>
      <div className="num text-[11px] text-slate-400">{Math.round((p.value / total) * 100)}%</div>
    </div>
  );
}
