import { useEffect, useRef, useState } from "react";
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
import { fmtMoney, fmtMonthShort, localeForLang } from "../format";
import type { NetWorthReport, ReportsData } from "../types";
import { Spinner } from "../components/ui";

const PALETTE = ["#6a63f0", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#84cc16", "#14b8a6", "#f97316"];

type ReportView = "native" | "netWorth";

function todayYmd(timeZone?: string | null) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // fall through to UTC
  }
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { lang, t, activeCurrency, boot } = useApp();
  const [view, setView] = useState<ReportView>("native");
  const [nativeData, setNativeData] = useState<ReportsData | null>(null);
  const [netWorthData, setNetWorthData] = useState<NetWorthReport | null>(null);
  const requestGen = useRef(0);
  const reportingCurrency = boot?.settings.reportingCurrency ?? null;
  const timezone = boot?.settings.timezone ?? null;

  useEffect(() => {
    const gen = ++requestGen.current;
    setNativeData(null);
    setNetWorthData(null);
    if (view === "native") {
      if (!activeCurrency) return;
      const requested = activeCurrency;
      api
        .nativeReport(requested, 12)
        .then((report) => {
          if (requestGen.current !== gen) return;
          if (report.currencyCode !== requested) return;
          setNativeData(report);
        })
        .catch(() => {});
      return;
    }
    if (!reportingCurrency) return;
    const requested = reportingCurrency;
    const asOf = todayYmd(timezone);
    api
      .netWorthReport({ reportingCurrency: requested, months: 12, asOf })
      .then((report) => {
        if (requestGen.current !== gen) return;
        if (report.reportingCurrency !== requested) return;
        setNetWorthData(report);
      })
      .catch(() => {});
  }, [view, activeCurrency, reportingCurrency, timezone]);

  const nativeReady = view === "native" && !!activeCurrency && !!nativeData && nativeData.currencyCode === activeCurrency;
  const netWorthReady =
    view === "netWorth" &&
    !!reportingCurrency &&
    !!netWorthData &&
    netWorthData.reportingCurrency === reportingCurrency;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{t("nav_reports")}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${
                view === "native" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
              }`}
              onClick={() => setView("native")}
            >
              {t("rep_nativeView")}
            </button>
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${
                view === "netWorth" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
              }`}
              onClick={() => setView("netWorth")}
            >
              {t("rep_netWorthView")}
            </button>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
            {view === "native" ? activeCurrency : reportingCurrency}
          </span>
          <span>{t("rep_months", { n: 12 })}</span>
        </div>
      </div>

      {view === "native" ? (
        nativeReady && nativeData ? (
          <NativeReportView data={nativeData} />
        ) : (
          <Spinner />
        )
      ) : netWorthReady && netWorthData ? (
        <NetWorthReportView data={netWorthData} />
      ) : (
        <Spinner />
      )}
    </div>
  );
}

function NativeReportView({ data }: { data: ReportsData }) {
  const { lang, t } = useApp();
  const currency = data.currencyCode;
  const money = (amount: number) => fmtMoney(amount, { currencyCode: currency, locale: localeForLang(lang) });

  const nw = data.netWorth.map((p) => ({
    ...p,
    label: fmtMonthShort(p.month, lang),
    liabilitiesAbs: Math.abs(p.liabilities),
  }));
  const ie = data.months.map((m, i) => ({
    label: fmtMonthShort(m, lang),
    income: data.income[i].value,
    expense: data.expense[i].value,
    _income: data.income[i].value,
    _expense: data.expense[i].value,
  }));
  const pie = data.breakdown.filter((b) => b.value > 0).map((b) => ({ name: b.name, value: b.value, _raw: b.value }));
  const cur = data.income[data.income.length - 1];

  return (
    <>
      <p className="mb-4 text-xs text-slate-400">{t("rep_nativeHint")}</p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Scale size={13} /> {t("rep_now")}
          </div>
          <div className={`num mt-2 text-2xl font-bold ${data.netWorthNow < 0 ? "text-rose-600" : "text-slate-900"}`}>
            {money(data.netWorthNow)}
          </div>
          <div className="mt-1.5 flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-emerald-600">
              <TrendingUp size={12} /> {t("rep_assets")} {money(data.totalAssets)}
            </span>
            <span className="flex items-center gap-1 text-rose-500">
              <TrendingDown size={12} /> {t("rep_liabilities")} {money(data.totalLiabilities)}
            </span>
          </div>
        </div>
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
        <Card title={t("rep_netWorth")}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={nw} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6a63f0" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#6a63f0" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={70}
                tickFormatter={(v: number) => money(v)} />
              <Tooltip content={<MoneyTooltip currency={currency} lang={lang} />} cursor={{ stroke: "#c7d2fe" }} formatter={(v: number | string) => [money(Number(v)), t("rep_net")]} />
              <Area type="monotone" dataKey="net" stroke="#6a63f0" strokeWidth={2.5} fill="url(#nwFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title={t("rep_incomeExpense")}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={70}
                tickFormatter={(v: number) => money(v)} />
              <Tooltip content={<IETooltip currency={currency} lang={lang} />} cursor={{ fill: "rgba(106,99,240,0.05)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name={t("rep_income")} fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="expense" name={t("rep_expense")} fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title={t("rep_breakdown")}>
          {pie.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="flex items-center">
              <ResponsiveContainer width="55%" height={250}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} strokeWidth={0}>
                    {pie.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip currency={currency} lang={lang} total={pie.reduce((s, p) => s + p.value, 0)} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="max-h-[250px] flex-1 space-y-1 overflow-y-auto pr-1">
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
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={history} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
                  width={70}
                  tickFormatter={(v: number) => money(v)}
                />
                <Tooltip content={<MoneyTooltip currency={currency} lang={lang} />} cursor={{ stroke: "#c7d2fe" }} />
                <Area type="monotone" dataKey="net" stroke="#6a63f0" strokeWidth={2.5} fill="url(#nwFxFill)" />
              </AreaChart>
            </ResponsiveContainer>
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
                  <td className="py-2 pr-3 text-slate-500">{row.fx?.source ?? t("rep_convertedNone")}</td>
                  <td className="num py-2 text-right text-slate-500">{row.fx?.rate ?? t("rep_convertedNone")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
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
