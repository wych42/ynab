import { formatAccountMoney } from "../format";
import { useApp } from "../store";
import type { InvestmentAccountView } from "../types";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="num mt-1 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

export function InvestmentAccountSummary({ view }: { view: InvestmentAccountView }) {
  const { t, lang } = useApp();
  const money = (amount: number) => formatAccountMoney(amount, view.currencyCode, lang);
  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label={t("inv_balance")} value={money(view.balanceMinor)} />
        <Metric label={t("inv_balanceChange")} value={money(view.balanceChangeMinor)} />
        <Metric label={t("inv_contributions")} value={money(view.contributionsMinor)} />
        <Metric label={t("inv_withdrawals")} value={money(view.withdrawalsMinor)} />
        <Metric label={t("inv_netContributions")} value={money(view.netContributionsMinor)} />
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{t("inv_latestValuation")}</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">
            {view.latestValuationDate ?? t("inv_noValuation")}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{t("inv_history")}</div>
        <ul className="mt-2 space-y-1">
          {view.history.map((point) => (
            <li key={point.month} className="flex items-center justify-between text-[13px]">
              <span className="text-slate-500">{point.month}</span>
              <span className="num font-medium text-slate-800">{money(point.balanceMinor)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
