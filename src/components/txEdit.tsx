import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useApp } from "../store";
import { formatAccountMoney, parseAmountToCents, todayIso } from "../format";
import { parseAmountToMinor } from "../money";
import type { CategoryGroup } from "../types";
import type { Lang } from "../i18n";

export interface FormState {
  date: string;
  payeeName: string;
  transferAccountId: string;
  categoryId: string;
  memo: string;
  inflow: string;
  outflow: string;
  otherAmount: string;
  originalCurrencyCode: string;
  originalAmount: string;
}

export const emptyForm = (timeZone?: string): FormState => ({
  date: todayIso(timeZone),
  payeeName: "",
  transferAccountId: "",
  categoryId: "",
  memo: "",
  inflow: "",
  outflow: "",
  otherAmount: "",
  originalCurrencyCode: "",
  originalAmount: "",
});

function parseFormMinor(raw: string, currencyCode?: string | null): number | null {
  if (!raw.trim()) return 0;
  if (currencyCode) {
    try {
      return parseAmountToMinor(raw, currencyCode);
    } catch {
      return null;
    }
  }
  return parseAmountToCents(raw);
}

export function formAmount(f: FormState, currencyCode?: string | null): number | null {
  const inf = parseFormMinor(f.inflow, currencyCode);
  const outf = parseFormMinor(f.outflow, currencyCode);
  if (inf === null || outf === null) return null;
  const v = inf - outf;
  return v === 0 ? null : v;
}

export function parseOptionalMinor(raw: string, currencyCode: string): number | null {
  if (!raw.trim()) return null;
  try {
    return parseAmountToMinor(raw, currencyCode);
  } catch {
    return null;
  }
}

/* ------------------------- Payee selector ------------------------- */

export function PayeeSelect({
  value,
  transferValue,
  onChange,
  excludeAccountId,
}: {
  value: string;
  transferValue: string;
  onChange: (patch: { payeeName?: string; transferAccountId?: string }) => void;
  excludeAccountId?: string;
}) {
  const { boot, t } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const others = (boot?.accounts ?? []).filter((a) => a.id !== excludeAccountId && !a.closed);
  const payees = boot?.payees ?? [];
  const q = value.toLowerCase();
  const filteredPayees = payees.filter((p) => p.toLowerCase().includes(q)).slice(0, 8);
  const filteredAccounts = others.filter((a) => !q || a.name.toLowerCase().includes(q));

  const selectedTransfer = others.find((a) => a.id === transferValue);

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        aria-label={t("tx_payee")}
        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none transition-colors placeholder:text-slate-300 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
        placeholder={selectedTransfer ? `→ ${selectedTransfer.name}` : ""}
        value={value}
        onChange={(e) => onChange({ payeeName: e.target.value, transferAccountId: "" })}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="anim-pop absolute left-0 top-full z-40 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-slate-100 bg-white py-1 shadow-pop">
          {filteredAccounts.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">转账 / Transfer</div>
              {filteredAccounts.map((a) => (
                <button
                  key={a.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-brand-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ transferAccountId: a.id, payeeName: "" });
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                >
                  {a.on_budget ? <ArrowUpRight size={13} className="text-sky-500" /> : <ArrowDownLeft size={13} className="text-violet-500" />}
                  {a.name}
                </button>
              ))}
            </>
          )}
          {filteredPayees.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">收款方 / Payees</div>
              {filteredPayees.map((p) => (
                <button
                  key={p}
                  className="w-full px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-brand-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ payeeName: p, transferAccountId: "" });
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                >
                  {p}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------- Category select ------------------------- */

export function CategorySelect({
  value,
  onChange,
  disabled,
  compact = true,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { boot, t } = useApp();
  const groups = (boot?.groups ?? []).filter((g) => g.categories.length > 0);
  const incomeFirst = [...groups.filter((g) => g.is_income), ...groups.filter((g) => !g.is_income)];
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${compact ? "max-w-[150px] truncate" : ""} w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] outline-none transition-colors disabled:text-slate-300 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100`}
    >
      <option value="">{t("tx_uncategorized")}</option>
      {incomeFirst.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {g.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// 计算默认收入来源分类：优先「其他收入」，否则收入组的第一个分类。
export function defaultIncomeCategory(groups: CategoryGroup[]): string {
  const income = groups.filter((g) => g.is_income).flatMap((g) => g.categories);
  return income.find((c) => c.name === "其他收入")?.id ?? income[0]?.id ?? "";
}

export function incomeCategoryIds(groups: CategoryGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.is_income).flatMap((g) => g.categories.map((c) => c.id)));
}

export function AmountInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-[13px] num outline-none transition-colors placeholder:text-slate-300 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function originalSpendCodes(
  supported: { code: string }[] | undefined,
  accountCurrency: string | null | undefined,
): string[] {
  return (supported ?? []).map((item) => item.code).filter((code) => code !== accountCurrency);
}

export function OriginalSpendFields({
  accountCurrency,
  form,
  setForm,
}: {
  accountCurrency: string | null | undefined;
  form: FormState;
  setForm: (next: FormState) => void;
}) {
  const { boot, t } = useApp();
  const codes = originalSpendCodes(boot?.supportedCurrencies, accountCurrency);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-brand-100 px-4 py-2 text-[12px]">
      <label className="flex items-center gap-2">
        <span className="text-slate-500">{t("tx_originalCurrency")}</span>
        <select
          aria-label={t("tx_originalCurrency")}
          className="rounded-md border border-slate-200 bg-white px-2 py-1"
          value={form.originalCurrencyCode}
          onChange={(e) => setForm({ ...form, originalCurrencyCode: e.target.value })}
        >
          <option value="">{t("tx_originalNone")}</option>
          {codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-slate-500">{t("tx_originalAmount")}</span>
        <input
          aria-label={t("tx_originalAmount")}
          className="w-36 rounded-md border border-slate-200 bg-white px-2 py-1 text-right num outline-none"
          value={form.originalAmount}
          onChange={(e) => setForm({ ...form, originalAmount: e.target.value })}
          disabled={!form.originalCurrencyCode}
        />
      </label>
    </div>
  );
}

export function TxAmountCaption({
  amount,
  currencyCode,
  originalCurrencyCode,
  originalAmountMinor,
  otherAccountCurrencyCode,
  otherAmountMinor,
  lang,
}: {
  amount: number;
  currencyCode?: string | null;
  originalCurrencyCode?: string | null;
  originalAmountMinor?: number | null;
  otherAccountCurrencyCode?: string | null;
  otherAmountMinor?: number | null;
  lang: Lang;
}) {
  const { t } = useApp();
  const booked = formatAccountMoney(Math.abs(amount), currencyCode, lang);
  if (originalCurrencyCode && originalAmountMinor != null) {
    return (
      <>
        <span className="block">
          <span className="mr-1 font-medium text-slate-500">{t("tx_accountBooked")}</span>
          {booked}
        </span>
        <span className="block text-[11px] font-normal text-slate-400">
          <span className="mr-1">{t("tx_merchantPrice")}</span>
          {formatAccountMoney(originalAmountMinor, originalCurrencyCode, lang)}
        </span>
      </>
    );
  }
  if (otherAccountCurrencyCode && otherAmountMinor != null && otherAccountCurrencyCode !== currencyCode) {
    const other = formatAccountMoney(Math.abs(otherAmountMinor), otherAccountCurrencyCode, lang);
    const sent = amount < 0 ? booked : other;
    const received = amount < 0 ? other : booked;
    return (
      <>
        <span className="block">
          <span className="mr-1 font-medium text-slate-500">{t("tx_transferOut")}</span>
          {sent}
        </span>
        <span className="block text-[11px] font-normal text-slate-400">
          <span className="mr-1">{t("tx_transferIn")}</span>
          {received}
        </span>
      </>
    );
  }
  return <span className="block">{booked}</span>;
}
