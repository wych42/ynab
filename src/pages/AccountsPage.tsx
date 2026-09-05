import { quietWrite, isWriteCancelled } from "../writeCancellation";
import { useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useApp } from "../store";
import { formatAccountMoney, groupAccountsByCurrency, todayIso } from "../format";
import { parseAmountToMinor } from "../money";
import { api } from "../api";
import { Btn, Field, Modal, inputCls } from "../components/ui";
import { accountIcon } from "../components/Sidebar";
import type { Account, Bootstrap } from "../types";
import { parseHash } from "../hashRoute";
import { useWriteClient } from "../useWriteClient";

export const ACCOUNT_TYPE_LABELS: Record<string, { zh: string; en: string; onBudget: number }> = {
  checking: { zh: "支票账户", en: "Checking", onBudget: 1 },
  savings: { zh: "储蓄账户", en: "Savings", onBudget: 1 },
  cash: { zh: "现金", en: "Cash", onBudget: 1 },
  creditCard: { zh: "信用卡", en: "Credit Card", onBudget: 1 },
  lineOfCredit: { zh: "信用额度", en: "Line of Credit", onBudget: 0 },
  investment: { zh: "投资账户", en: "Investment", onBudget: 0 },
  property: { zh: "房产", en: "Property", onBudget: 0 },
  vehicle: { zh: "车辆", en: "Vehicle", onBudget: 0 },
  otherAsset: { zh: "其他资产", en: "Other Asset", onBudget: 0 },
  studentLoan: { zh: "助学贷款", en: "Student Loan", onBudget: 0 },
  personalLoan: { zh: "个人贷款", en: "Personal Loan", onBudget: 0 },
  otherLiability: { zh: "其他负债", en: "Other Liability", onBudget: 0 },
};

function AccountCard({ acc }: { acc: Account }) {
  const { lang } = useApp();
  const Icon = accountIcon(acc.type);
  const label = ACCOUNT_TYPE_LABELS[acc.type];
  return (
    <a
      href={`#/accounts/${acc.id}`}
      className="group flex items-center gap-3.5 rounded-xl border border-transparent bg-white px-4 py-3 shadow-card transition-all hover:-translate-y-px hover:border-brand-200 hover:shadow-pop"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-slate-800">{acc.name}</div>
        <div className="text-[11px] text-slate-400">{label ? label[lang] : acc.type}</div>
      </div>
      <div className={`num text-[14px] font-bold ${acc.balance < 0 ? "text-rose-600" : "text-slate-700"}`}>
        {formatAccountMoney(acc.balance, acc.currencyCode, lang)}
      </div>
      <ChevronRight size={15} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
    </a>
  );
}

function Section({ title, accounts }: { title: string; accounts: Account[] }) {
  const { lang } = useApp();
  if (!accounts.length) return null;
  const groups = groupAccountsByCurrency(accounts);
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h2>
      </div>
      <div className="space-y-5">
        {groups.map((group) => {
          const total = group.accounts.reduce((sum, acc) => sum + acc.balance, 0);
          return (
            <div key={group.currencyCode}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-[11px] font-semibold tracking-wide text-slate-400">{group.currencyCode}</span>
                <span className={`num text-sm font-semibold ${total < 0 ? "text-rose-500" : "text-slate-500"}`}>
                  {formatAccountMoney(total, group.currencyCode, lang)}
                </span>
              </div>
              <div className="space-y-2">
                {group.accounts.map((a) => (
                  <AccountCard key={a.id} acc={a} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function defaultAccountCurrency(boot: Bootstrap) {
  return boot.settings.reportingCurrency ?? boot.enabledCurrencies[0] ?? boot.supportedCurrencies[0]?.code ?? "";
}

export function AccountsPage() {
  const { boot, t, lang, refreshBoot, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [balance, setBalance] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [date, setDate] = useState(() => todayIso(boot?.settings.timezone));
  const [currencyFilter, setCurrencyFilter] = useState("");
  const { client: api, conflictDialog } = useWriteClient(boot, lang);
  useEffect(() => {
    const requested = parseHash().query.createCurrency;
    if (boot && requested && boot.enabledCurrencies.includes(requested)) {
      setCurrencyCode(requested);
      setOpen(true);
    }
  }, [boot?.enabledCurrencies.join(",")]);

  if (!boot) return null;
  const accs = boot.accounts.filter(a => !currencyFilter || a.currencyCode === currencyFilter);
  const onBudget = accs.filter((a) => !a.closed && a.on_budget);
  const tracking = accs.filter((a) => !a.closed && !a.on_budget);
  const closed = accs.filter((a) => a.closed);
  const enabled = boot.enabledCurrencies ?? [];

  const openCreate = () => {
    setDate(todayIso(boot.settings.timezone));
    setCurrencyCode(defaultAccountCurrency(boot));
    setOpen(true);
  };

  const create = quietWrite(async () => {
    if (!name.trim() || !currencyCode) return;
    try {
      const startingBalanceMinor = balance.trim() === "" ? 0 : parseAmountToMinor(balance, currencyCode);
      await api.createAccount({
        name: name.trim(),
        type,
        currencyCode,
        startingBalanceMinor,
        startingDate: date,
      });
      setOpen(false);
      setName("");
      setBalance("");
      await refreshBoot();
      toast(lang === "zh" ? "账户已创建" : "Account created");
    } catch (e) {
      if (isWriteCancelled(e)) return;
      toast(e instanceof Error ? e.message : t("common_error"), "err");
    }
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      {conflictDialog}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-7">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("nav_accounts")}</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{t("common_allAccounts")}</p>
          <a href="#/reports/net-worth" className="mt-2 inline-block text-sm font-medium text-brand-600 underline-offset-2 hover:underline">
            {lang === "zh" ? "查看家庭净资产" : "View household net worth"}
          </a>
        </div>
        <Btn variant="primary" onClick={openCreate}>
          <Plus size={15} /> {t("account_add")}
        </Btn>
      </div>
      <label className="mb-4 block text-sm">{lang === "zh" ? "账户币种筛选" : "Filter by account currency"} <select aria-label={lang === "zh" ? "账户币种筛选" : "Filter by account currency"} className={inputCls} value={currencyFilter} onChange={e => setCurrencyFilter(e.target.value)}><option value="">{lang === "zh" ? "全部币种" : "All currencies"}</option>{enabled.map(code => <option key={code}>{code}</option>)}</select></label>

      {accs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-400">
          {lang === "zh" ? "还没有账户，创建第一个账户开始记账。" : "No accounts yet. Create your first one!"}
        </div>
      ) : (
        <>
          <Section title={t("sidebar_onBudget")} accounts={onBudget} />
          <Section title={t("sidebar_tracking")} accounts={tracking} />
          <Section title={t("sidebar_closed")} accounts={closed} />
        </>
      )}

      {open && (
        <Modal title={t("account_add")} onClose={() => setOpen(false)}>
          <Field label={t("account_name")}>
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("account_type")}>
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v[lang]} · {t(v.onBudget ? "account_tagOnBudget" : "account_tagOffBudget")}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <Field label={t("account_currency")}>
                <select className={inputCls} value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                  {enabled.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </Field>
              <a href="#/settings" className="-mt-2 mb-3 inline-block text-[11px] font-medium text-brand-600 hover:underline">
                {t("account_manageCurrencies")}
              </a>
            </div>
          </div>
          <Field label={t("account_startDate")}>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t("account_startBalance")}>
            <input className={inputCls + " num"} placeholder={currencyCode || "0"} value={balance} onChange={(e) => setBalance(e.target.value)} />
          </Field>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
            {lang === "zh"
              ? "预算内账户（现金、储蓄、信用卡）参与预算分配；预算外账户仅用于跟踪资产负债。信用卡可填负数表示已有欠款。"
              : "On-budget accounts (cash, savings, credit cards) drive the budget; tracking accounts just watch assets. Credit cards may start negative for existing debt."}
          </p>
          <Btn variant="primary" className="w-full" onClick={create}>
            {t("account_create")}
          </Btn>
        </Modal>
      )}
    </div>
  );
}
