import { quietWrite, isWriteCancelled, WriteCancelled } from "../writeCancellation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  CopyPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "../api";
import { useApp } from "../store";
import { fmtMoney, fmtMoneyShort, fmtMonth, fmtMonthShort, formatMinorInput, localeForLang } from "../format";
import { parseAmountToMinor } from "../money";
import type { BudCategory, BudGroup, BudgetData } from "../types";
import { Btn, Field, Modal, Spinner, inputCls } from "../components/ui";
import { completeBudgetHash, formatHash, parseHash, pushHash, useHashRoute, type CurrencyNotice } from "../hashRoute";
import { persistBudgetCurrency, readStoredBudgetCurrency } from "../activeCurrency";
import { useWriteClient } from "../useWriteClient";
import { budgetNeedsFunding } from "../budgetEmptyState";

const BudgetCurrencyContext = createContext("");
const BudgetWriteContext = createContext(api);
const BudgetWriteOriginContext = createContext<(element: HTMLElement) => void>(() => {});

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("collapsedGroups") || "[]");
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      localStorage.setItem("collapsedGroups", JSON.stringify(next));
      return next;
    });
  };
  return { collapsed, toggle };
}

type Selection =
  | { kind: "rta" }
  | { kind: "cat"; cat: BudCategory; groupId: string; month: string }
  | null;

const GRID =
  "grid grid-cols-[minmax(150px,1fr)_92px_76px_100px_92px_76px_100px_92px_76px_100px] items-center gap-x-2";
const MONTH_GRID = "grid grid-cols-[92px_76px_100px] items-center gap-x-2";

export function BudgetPage() {
  const { boot, t, lang, refreshBoot, toast } = useApp();
  const route = useHashRoute();
  const [base, setBase] = useState<string>("");
  const [win, setWin] = useState<{ months: string[]; data: Record<string, BudgetData> } | null>(null);
  const currencyRef = useRef<string | null>(null);
  const urlCurrency = parseHash(route).query.currency ?? null;
  const [currencyNotice, setCurrencyNotice] = useState<CurrencyNotice | null>(null);
  const [conflict, setConflict] = useState<{ input: string; latest: string } | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [editing, setEditing] = useState<{ catId: string; month: string; value: string } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [addOpen, setAddOpen] = useState<"group" | "category" | null>(null);
  const [addGroupId, setAddGroupId] = useState("");
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState<{ kind: "group" | "category"; id: string; name: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const { collapsed, toggle } = useCollapsedGroups();
  const rtaMenuRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const restoreCurrencyFocus = useRef<string | null>(null);
  const savedAssignmentFocus = useRef<string | null>(null);
  const { client: writeApi, conflictDialog, setWriteOrigin } = useWriteClient({ ...boot, categoryRevision: win?.data[base]?.categoryRevision ?? boot?.categoryRevision }, lang, () => setCopying(false));
  useLayoutEffect(() => {
    if (editing || !savedAssignmentFocus.current) return;
    if (document.activeElement === document.body) document.getElementById(savedAssignmentFocus.current)?.querySelector<HTMLButtonElement>("button")?.focus();
    savedAssignmentFocus.current = null;
  });

  useEffect(() => {
    if (!base && boot) setBase(boot.currentMonth);
  }, [boot, base]);

  const load = useCallback(quietWrite(async (m: string, currency: string) => {
    const months = [shiftMonth(m, -1), m, shiftMonth(m, 1)];
    const list = await Promise.all(months.map((mm) => api.budget(mm, currency).catch(() => null)));
    if (currencyRef.current !== currency) return;
    const data: Record<string, BudgetData> = {};
    list.forEach((d, i) => {
      if (d && d.currencyCode === currency) data[months[i]] = d;
    });
    if (!data[m]) throw new Error("bad month");
    setWin({ months, data });
  }), []);

  useEffect(() => {
    if (!boot) return;
    const result = completeBudgetHash({
      enabledCurrencies: boot.enabledCurrencies,
      supportedCurrencies: (boot.supportedCurrencies ?? []).map((item) => item.code),
      reportingCurrency: boot.settings.reportingCurrency,
      storedCurrency: readStoredBudgetCurrency(),
    });
    setCurrencyNotice(previous => result.notice ?? (previous?.fallback === result.currency ? previous : null));
    if (result.currency) persistBudgetCurrency(result.currency);
  }, [boot, route]);

  const switchCurrency = (code: string) => {
    restoreCurrencyFocus.current = document.activeElement?.id === "budget-ledger-currency" ? code : null;
    setCurrencyNotice(null);
    persistBudgetCurrency(code);
    const parsed = parseHash(window.location.hash);
    pushHash(formatHash("/budget", { ...parsed.query, currency: code }));
  };

  useEffect(() => {
    currencyRef.current = urlCurrency;
    setWin(null);
    setSel(null);
    setEditing(null);
  }, [urlCurrency]);

  useEffect(() => {
    if (!base || !urlCurrency) return;
    const hasOnBudget = boot?.accounts.some((a) => !a.closed && a.on_budget && a.currencyCode === urlCurrency);
    if (boot && boot.accounts.length > 0 && !hasOnBudget) return;
    load(base, urlCurrency).catch(() => toast(t("common_error"), "err"));
  }, [base, urlCurrency, boot, load, t, toast]);

  useEffect(() => {
    const h = () => setGroupMenu(null);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  const timelineMonths = useMemo(() => {
    const curD = win?.data[base];
    if (!curD) return [];
    const arr: string[] = [];
    let m = curD.months[0];
    while (m <= curD.maxMonth && arr.length < 240) {
      arr.push(m);
      m = shiftMonth(m, 1);
    }
    return arr;
  }, [win, base]);

  const loaded = !!win?.data[base] && win.data[base].currencyCode === urlCurrency;
  useLayoutEffect(() => {
    if (!urlCurrency || restoreCurrencyFocus.current !== urlCurrency) return;
    const selector = document.getElementById("budget-ledger-currency");
    if (document.activeElement === document.body || document.activeElement?.id === "budget-ledger-currency") selector?.focus({ preventScroll: true });
    const emptyLedger = boot && !boot.accounts.some(account => !account.closed && account.on_budget && account.currencyCode === urlCurrency);
    if (loaded || emptyLedger) restoreCurrencyFocus.current = null;
  }, [urlCurrency, loaded, boot]);
  useEffect(() => {
    if (!loaded) return;
    stripRef.current?.querySelector(`[data-m="${base}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [base, loaded]);

  if (!boot) return <Spinner />;
  const currency = urlCurrency;
  if (!currency) return <Spinner />;

  const hasOnBudget = boot.accounts.some((a) => !a.closed && a.on_budget && a.currencyCode === currency);
  if (boot.accounts.length > 0 && !hasOnBudget) {
    return (
      <EmptyCurrencyLedger
        notice={currencyNotice}
        currency={currency}
        enabled={boot.enabledCurrencies}
        onSwitch={switchCurrency}
      />
    );
  }

  if (!loaded || !win || curHasMismatch(win, base, currency)) {
    return (
      <div className="flex h-full flex-col">
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <BudgetLedgerSelect currency={currency} enabled={boot.enabledCurrencies} onChange={switchCurrency} />
          <BudgetCurrencyNotice notice={currencyNotice} />
        </div>
        <Spinner />
      </div>
    );
  }

  const money = (amount: number) => fmtMoney(amount, { currencyCode: currency, locale: localeForLang(lang) });
  const moneyShort = (amount: number) => fmtMoneyShort(amount, { currencyCode: currency, locale: localeForLang(lang) });

  const monthsWin = win.months;
  const cur = win.data[base];
  const firstMonth = cur.months[0];
  const isCurrent = base === boot.currentMonth;
  const canNext = base < cur.maxMonth;
  const canPrev = base > firstMonth;

  const apply = (d: BudgetData) => {
    if (d.currencyCode !== currencyRef.current) return;
    setWin((w) => (w && w.data[d.month] ? { ...w, data: { ...w.data, [d.month]: d } } : w));
    setSel(current => {
      if (current?.kind !== "cat" || current.month !== d.month) return current;
      const cat = d.groups.flatMap(g => g.categories).find(c => c.id === current.cat.id);
      return cat ? { ...current, cat } : null;
    });
  };

  const commitAssign = quietWrite(async (month: string, catId: string, value: string, origin?: HTMLInputElement) => {
    if (!currencyRef.current) return;
    let cents: number;
    try {
      cents = parseAmountToMinor(value, currencyRef.current);
    } catch {
      return;
    }
    if (cents < 0) return;
    try {
      if (origin) setWriteOrigin(origin);
      apply(await writeApi.assign(month, catId, cents, currencyRef.current, win?.data[month]?.revision));
      savedAssignmentFocus.current = `budget-assignment-${catId}-${month}`;
      setEditing(null);
      setConflict(null);
    } catch (err) {
      if (isWriteCancelled(err)) return;
      const conflictErr = err as ApiError;
      if (conflictErr?.code === "budget_revision_conflict" && conflictErr.budget) {
        apply(conflictErr.budget);
        setEditing({ catId, month, value });
        setConflict({
          input: value,
          latest: formatMinorInput(
            conflictErr.budget.groups.flatMap((g) => g.categories).find((c) => c.id === catId)?.assigned ?? 0,
            currencyRef.current,
          ),
        });
        return;
      }
      toast(t("common_error"), "err");
    }
  });

  const copyPrev = quietWrite(async (m: string) => {
    if (!confirm(t("budget_copyLastConfirm")) || !currencyRef.current) return;
    setCopying(true);
    try {
      apply(await writeApi.copyLastMonth(m, currencyRef.current, win?.data[m]?.revision));
      toast(t("budget_copyLastOk"));
    } catch (error) {
      if (isWriteCancelled(error)) return;
      toast(t("common_error"), "err");
    } finally {
      setCopying(false);
    }
  });

  const catIndex: Record<string, Map<string, BudCategory>> = {};
  for (const m of monthsWin) {
    const d = win.data[m];
    if (!d) continue;
    const map = new Map<string, BudCategory>();
    for (const g of d.groups) for (const c of g.categories) map.set(c.id, c);
    catIndex[m] = map;
  }

  const overspentCats = cur.groups.flatMap((g) => g.categories).filter((c) => c.available < 0);
  const selData = sel?.kind === "cat" ? win.data[sel.month] ?? cur : cur;

  const emptyStart = boot.accounts.length === 0 && cur.months.length === 1 && cur.incomeThisMonth === 0;
  if (emptyStart) return <EmptyStart />;
  const needsFunding = budgetNeedsFunding(cur, boot.accounts.filter(a => !a.closed && a.on_budget && a.currencyCode === currency));

  return (
    <BudgetCurrencyContext.Provider value={currency}><BudgetWriteContext.Provider value={writeApi}><BudgetWriteOriginContext.Provider value={setWriteOrigin}>
    {conflictDialog}
    <div className="flex h-full min-w-0 max-w-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="sticky top-0 z-20 min-w-0 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 pb-2 pt-3 md:px-6">
            <BudgetLedgerSelect currency={currency} enabled={boot.enabledCurrencies} onChange={switchCurrency} />
            <BudgetCurrencyNotice notice={currencyNotice} />
            {conflict && (
              <div role="status" aria-live="polite" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <div className="font-semibold">{t("budget_conflict")}</div>
                <div>{t("budget_conflictKept", { value: conflict.input })}</div>
                <div>{t("budget_conflictLatest", { value: conflict.latest })}</div>
              </div>
            )}
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              <button
                onClick={() => canPrev && setBase(shiftMonth(base, -1))}
                disabled={!canPrev}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm disabled:opacity-30"
              >
                <ChevronLeft size={17} />
              </button>
              <div className="min-w-[128px] text-center text-sm font-semibold text-slate-800">{fmtMonth(base, lang)}</div>
              <button
                onClick={() => canNext && setBase(shiftMonth(base, 1))}
                disabled={!canNext}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm disabled:opacity-30"
              >
                <ChevronRight size={17} />
              </button>
              {!isCurrent && (
                <button
                  onClick={() => setBase(boot.currentMonth)}
                  className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-white"
                >
                  {lang === "zh" ? "今" : "Today"}
                </button>
              )}
            </div>

            {/* RTA */}
            <div className="relative max-w-full" ref={rtaMenuRef}>
              <button
                onClick={() => setSel(sel?.kind === "rta" ? null : { kind: "rta" })}
                className={`flex max-w-full flex-wrap items-baseline gap-2 rounded-xl px-4 py-2 shadow-sm transition-all ${
                  cur.readyToAssign < 0
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-gradient-to-r from-brand-600 to-brand-500 text-white hover:brightness-110"
                } ${sel?.kind === "rta" ? "ring-2 ring-offset-2 ring-brand-300" : ""}`}
              >
                <span className="text-xs font-medium opacity-90">{t("budget_rta")}</span>
                <span className="num break-all text-lg font-bold">{money(cur.readyToAssign)}</span>
                <ChevronDown size={14} className="self-center opacity-70" />
              </button>
              {sel?.kind === "rta" && (
                <div className="anim-pop absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-slate-100 bg-white p-3 shadow-pop">
                  <div className="space-y-1.5 text-[13px]">
                    <div className="flex justify-between text-slate-500">
                      <span>{t("budget_incomeThisMonth")}</span>
                      <b className="num text-emerald-600">{money(cur.incomeThisMonth)}</b>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>{t("budget_assignedTotal")}</span>
                      <b className="num text-slate-700">{money(cur.assignedTotal)}</b>
                    </div>
                    <div className="flex justify-between border-t border-slate-100 pt-1.5 text-slate-500">
                      <span>{t("rep_aom")}</span>
                      <b className="num text-slate-700">{cur.ageOfMoney}d</b>
                    </div>
                  </div>
                  <Btn
                    variant="primary"
                    className="mt-3 w-full"
                    onClick={quietWrite(() => writeApi.autoAssign(cur.month, currency, cur.revision).then(apply).then(() => toast(t("budget_autoAssign") + " ✓")))}
                  >
                    <Sparkles size={14} /> {t("budget_autoAssign")}
                  </Btn>
                </div>
              )}
            </div>

            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
              {overspentCats.length > 0 && (
                <Btn variant="danger" onClick={() => setCoverOpen(true)}>
                  <AlertTriangle size={14} />
                  {t("budget_overspent")} {money(Math.abs(cur.overspentTotal))}
                </Btn>
              )}
              <Btn onClick={() => setMoveOpen(true)}>
                <ArrowRightLeft size={14} />
                {t("budget_moveMoney")}
              </Btn>
              <Btn onClick={() => { setAddGroupId(""); setAddOpen("group"); }} title={t("budget_addGroup")}>
                <Plus size={14} />
                <span>{t("budget_addGroup")}</span>
              </Btn>
              <Btn variant="primary" onClick={() => { setAddGroupId(""); setAddOpen("category"); }} title={t("budget_addCategory")}>
                <Plus size={14} />
                <span>{t("budget_addCategory")}</span>
              </Btn>
            </div>
          </div>

          {/* Month timeline */}
          <div ref={stripRef} className="flex items-center gap-1 overflow-x-auto px-4 pb-1.5 pt-0.5 md:px-6">
            {timelineMonths.map((m, i) => {
              const prev = i > 0 ? timelineMonths[i - 1] : "";
              const showYear = !prev || m.slice(0, 4) !== prev.slice(0, 4);
              return (
                <div key={m} className="flex items-center">
                  {showYear && <span className="px-2 text-[11px] font-bold text-slate-300">{m.slice(0, 4)}</span>}
                  <button
                    data-m={m}
                    onClick={() => setBase(m)}
                    title={fmtMonth(m, lang)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                      m === base
                        ? "bg-brand-600 text-white shadow-sm"
                        : m === boot.currentMonth
                          ? "bg-white text-brand-600 ring-1 ring-brand-200 hover:bg-brand-50"
                          : "text-slate-400 hover:bg-white hover:text-slate-700 hover:shadow-sm"
                    }`}
                  >
                    {fmtMonthShort(m, lang)}
                  </button>
                </div>
              );
            })}
          </div>

          {!isCurrent && base > boot.currentMonth && (
            <div className="border-t border-amber-100 bg-amber-50 px-4 py-1.5 text-xs text-amber-700 md:px-6">
              {t("budget_futureHint")}
            </div>
          )}
          {cur.uncategorizedCount > 0 && (
            <a href="#/transactions?filter=uncategorized" className="block border-t border-amber-100 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 md:px-6">
              <AlertTriangle size={12} className="mr-1 inline" />
              {t("budget_uncategorized", { n: cur.uncategorizedCount })}
              <span className="ml-2 underline">{t("budget_goResolve")} →</span>
            </a>
          )}

        </div>

        <div role="region" aria-label={t("mc_budgetTable")} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div className={needsFunding ? "min-w-0" : "min-w-[1060px]"}>
          {/* Column headers scroll together with the category rows. */}
          {!needsFunding && <>
          <div className={`${GRID} px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:px-6`}>
            <div>{t("nav_budget").toUpperCase()}</div>
            {monthsWin.map((m) => (
              <MonthHead
                key={m}
                m={m}
                data={win.data[m]}
                active={m === base}
                first={firstMonth}
                copying={copying}
                onPick={() => setBase(m)}
                onCopy={() => copyPrev(m)}
              />
            ))}
          </div>
          <div className={`${GRID} px-4 pb-2 text-[10px] font-medium uppercase tracking-wide text-slate-300 md:px-6`}>
            <div />
            {monthsWin.map((m) => (
              <div key={m} className={`${MONTH_GRID} col-span-3`}>
                <div className="text-right">{t("budget_assignCol")}</div>
                <div className="text-right">{t("budget_activityCol")}</div>
                <div className="text-right">{t("budget_availableCol")}</div>
              </div>
            ))}
          </div>
          </>}

        {/* Table body */}
        <div className="flex-1 space-y-4 px-3 py-4">
          {needsFunding ? <div role="status" className="max-w-xl rounded-xl border bg-white p-6"><h2 className="font-semibold">{t("budget_noFunds", { code: currency })}</h2><p className="my-3 text-sm text-slate-600">{t("mc_noFundsHint")}</p><a className="text-brand-600 underline" href={`#/accounts/${boot.accounts.find(a => !a.closed && a.on_budget && a.currencyCode === currency)?.id}`}>{t("mc_recordFunds")}</a></div> : cur.groups.map((g) => (
            <GroupBlock
              key={g.id}
              group={g}
              monthsWin={monthsWin}
              catIndex={catIndex}
              activeMonth={base}
              collapsed={collapsed.includes(g.id)}
              onToggle={() => toggle(g.id)}
              selection={sel}
              onSelect={setSel}
              editing={editing}
              setEditing={setEditing}
              onCommitAssign={commitAssign}
              onMenu={(e, id) => {
                e.stopPropagation();
                setGroupMenu({ id, x: e.clientX, y: e.clientY });
                setAddGroupId(id);
              }}
              onQuickAdd={() => {
                setAddOpen("category");
                setAddGroupId(g.id);
              }}
            />
          ))}
          {boot.groups.some(g => g.categories.some(c => c.hidden)) && <details className="rounded border bg-white p-3 text-sm"><summary>{t("mc_hiddenCategories")}</summary>{boot.groups.flatMap(g => g.categories).filter(c => c.hidden).map(c => <div key={c.id} className="mt-2 flex items-center justify-between"><span>{c.name}</span><button className="text-brand-600" onClick={quietWrite(async () => { if (!confirm(t("budget_categoryShare"))) return; await writeApi.updateCategory(c.id, { hidden: false }); await Promise.all([load(base, currency), refreshBoot()]); })}>{t("write_restoreCategory")}</button></div>)}</details>}
        </div>
          </div>
        </div>
      </div>

      {/* Inspector */}
      {sel && (
        <Inspector
          sel={sel}
          data={selData}
          onClose={() => setSel(null)}
          onApply={apply}
          onCover={() => setCoverOpen(true)}
          onMove={() => setMoveOpen(true)}
          onRename={(id, name) => setRenameOpen({ kind: "category", id, name })}
          onDeleteCat={quietWrite(async (id) => {
            if (!confirm(t("budget_categoryShare") + "\n" + t("confirm_deleteCat"))) return;
            try {
              await writeApi.deleteCategory(id);
              setSel(null);
              if (currency) await Promise.all([load(base, currency), refreshBoot()]);
              toast("OK");
            } catch (error) {
      if (isWriteCancelled(error)) return;
              toast(t("account_deleteWarn"), "err");
            }
          })}
        />
      )}

      {moveOpen && (
        <MoveMoneyModal
          data={cur}
          onClose={() => setMoveOpen(false)}
          onDone={(d) => {
            apply(d);
            setMoveOpen(false);
          }}
        />
      )}
      {coverOpen && (
        <CoverModal
          data={cur}
          initialCatId={sel?.kind === "cat" && sel.cat.available < 0 ? sel.cat.id : undefined}
          onClose={() => setCoverOpen(false)}
          onDone={(d) => {
            apply(d);
            setCoverOpen(false);
          }}
        />
      )}
      {addOpen && (
        <AddModal
          kind={addOpen}
          groups={boot.groups}
          initialGroupId={addGroupId}
          onClose={() => setAddOpen(null)}
          onDone={quietWrite(async () => {
            setAddOpen(null);
            if (currency) await Promise.all([load(base, currency), refreshBoot()]);
          })}
        />
      )}
      {groupMenu?.id !== undefined && groupMenu.id !== "__root__" && (
        <div
          className="anim-pop fixed z-50 w-40 rounded-xl border border-slate-100 bg-white py-1 shadow-pop"
          style={{ left: Math.min(groupMenu.x, window.innerWidth - 170), top: groupMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const grp = boot.groups.find((g) => g.id === groupMenu.id);
            if (!grp) return null;
            return (
              <>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setRenameOpen({ kind: "group", id: grp.id, name: grp.name });
                    setGroupMenu(null);
                  }}
                >
                  <Pencil size={13} /> {t("budget_rename")}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setAddOpen("category");
                    setGroupMenu(null);
                  }}
                >
                  <Plus size={13} /> {t("budget_addCategory")}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50"
                  onClick={quietWrite(async () => {
                    setGroupMenu(null);
                    try {
                      if (!confirm(t("budget_categoryShare"))) return;
                      await writeApi.deleteGroup(grp.id);
                      if (currency) await Promise.all([load(base, currency), refreshBoot()]);
                    } catch (error) {
      if (isWriteCancelled(error)) return;
                      toast(lang === "zh" ? "分组不为空" : "Group is not empty", "err");
                    }
                  })}
                >
                  <Trash2 size={13} /> {t("budget_delete")}
                </button>
              </>
            );
          })()}
        </div>
      )}
      {renameOpen && (
        <RenameModal
          kind={renameOpen.kind}
          name={renameOpen.name}
          onClose={() => setRenameOpen(null)}
          onSave={quietWrite(async (name) => {
            if (!confirm(t("budget_categoryShare"))) return;
            if (renameOpen.kind === "group") await writeApi.renameGroup(renameOpen.id, name);
            else await writeApi.renameCategory(renameOpen.id, name);
            setRenameOpen(null);
            if (currency) await Promise.all([load(base, currency), refreshBoot()]);
          })}
        />
      )}
    </div>
    </BudgetWriteOriginContext.Provider></BudgetWriteContext.Provider></BudgetCurrencyContext.Provider>
  );
}

function useBudgetMoney() {
  const { lang } = useApp();
  const currency = useContext(BudgetCurrencyContext);
  const locale = localeForLang(lang);
  return {
    currency,
    money: (amount: number) => fmtMoney(amount, { currencyCode: currency || undefined, locale }),
    moneyShort: (amount: number) => fmtMoneyShort(amount, { currencyCode: currency || undefined, locale }),
  };
}

function curHasMismatch(
  win: { data: Record<string, BudgetData> },
  base: string,
  currency: string,
): boolean {
  const cur = win.data[base];
  return !cur || cur.currencyCode !== currency;
}

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function statusOf(c: BudCategory): "overspent" | "partial" | "funded" | "plain" | "income" {
  if (c.available < 0) return "overspent";
  if (c.goal && c.need && c.goal.type === "monthly" && c.goal.target > 0) {
    return c.assigned >= c.goal.target ? "funded" : "partial";
  }
  if (c.goal && c.need) return c.need.need <= 0 ? "funded" : c.assigned > 0 ? "partial" : "plain";
  return "plain";
}

const pillCls: Record<string, string> = {
  overspent: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  funded: "bg-emerald-100 text-emerald-700",
  plain: "",
  income: "",
};

function availCls(c: BudCategory): string {
  const st = statusOf(c);
  if (st === "overspent") return pillCls.overspent;
  if (st === "partial") return pillCls.partial;
  if (st === "funded") return pillCls.funded;
  return "text-slate-700";
}

function goalPct(c: BudCategory): number | null {
  if (!c.goal) return null;
  if (c.goal.type === "monthly" && c.goal.target > 0) return Math.min((c.assigned / c.goal.target) * 100, 100);
  if (c.goal.type === "targetBalance" && c.goal.target > 0) return Math.min((Math.max(c.available, 0) / c.goal.target) * 100, 100);
  if (c.goal.type === "targetByDate" && c.need) return Math.min((c.assigned / Math.max(c.need.need, 1)) * 100, 100);
  return null;
}

/* ------------------------------ Month header cell ------------------------------ */

function MonthHead({
  m,
  data,
  active,
  first,
  copying,
  onPick,
  onCopy,
}: {
  m: string;
  data?: BudgetData;
  active: boolean;
  first: string;
  copying: boolean;
  onPick: () => void;
  onCopy: () => void;
}) {
  const { t, lang } = useApp();
  const { moneyShort } = useBudgetMoney();
  const rta = data?.readyToAssign;
  return (
    <div className={`col-span-3 flex items-center justify-between gap-1 rounded-lg pl-2 pr-1 ${active ? "bg-brand-50" : "bg-slate-100"}`}>
      <button
        onClick={onPick}
        title={fmtMonth(m, lang)}
        className={`truncate py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
          active ? "text-brand-700" : "text-slate-400 hover:text-slate-600"
        }`}
      >
        {fmtMonth(m, lang)}
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        {rta != null && (
          <span className={`num text-[10px] ${rta < 0 ? "font-semibold text-rose-500" : "text-slate-400"}`} title={t("budget_rta")}>
            {moneyShort(rta)}
          </span>
        )}
        <button
          onClick={onCopy}
          disabled={!data || copying || m <= first}
          title={data && m > first ? t("budget_copyLast") : undefined}
          className="rounded p-1 text-slate-300 transition-colors hover:bg-brand-100 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-40"
        >
          <CopyPlus size={13} />
        </button>
      </span>
    </div>
  );
}

/* ------------------------------ Group & rows ------------------------------ */

function GroupBlock({
  group,
  monthsWin,
  catIndex,
  activeMonth,
  collapsed,
  onToggle,
  selection,
  onSelect,
  editing,
  setEditing,
  onCommitAssign,
  onMenu,
  onQuickAdd,
}: {
  group: BudGroup;
  monthsWin: string[];
  catIndex: Record<string, Map<string, BudCategory>>;
  activeMonth: string;
  collapsed: boolean;
  onToggle: () => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  editing: { catId: string; month: string; value: string } | null;
  setEditing: React.Dispatch<React.SetStateAction<{ catId: string; month: string; value: string } | null>>;
  onCommitAssign: (month: string, catId: string, v: string, origin?: HTMLInputElement) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
  onQuickAdd: () => void;
}) {
  const { t, lang } = useApp();
  const { currency, money } = useBudgetMoney();
  const cats = group.categories;
  const groupName = group.virtual ? (lang === "zh" ? "信用卡还款" : "Credit Card Payments") : group.name;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <header
        className={`${GRID} cursor-pointer bg-slate-50/80 px-3 py-2 transition-colors hover:bg-slate-100/80`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5 pl-1 text-[13px] font-bold text-slate-700">
          <span className={`text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`}>›</span>
          {groupName}
          {!group.virtual && (
            <button
              className="ml-1 rounded p-0.5 text-slate-300 transition-colors hover:bg-slate-200 hover:text-slate-600"
              onClick={(e) => {
                e.stopPropagation();
                onMenu(e, group.id);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        {monthsWin.map((m) => {
          const idx = catIndex[m];
          const has = !!idx;
          const tot = cats.reduce(
            (acc, c) => {
              const cc = idx?.get(c.id);
              acc.assigned += cc?.assigned ?? 0;
              acc.activity += cc?.activity ?? 0;
              acc.available += cc?.available ?? 0;
              return acc;
            },
            { assigned: 0, activity: 0, available: 0 }
          );
          return (
            <div key={m} className={`${MONTH_GRID} col-span-3 rounded-lg py-0.5 ${m === activeMonth && has ? "bg-brand-50" : has ? "bg-slate-100" : ""}`}>
              <div className="num pr-2 text-right text-[13px] font-semibold text-slate-500">
                {has ? money(tot.assigned) : "–"}
              </div>
              <div className="num pr-2 text-right text-[13px] font-semibold text-slate-500">
                {has ? money(tot.activity) : "–"}
              </div>
              <div className="num pr-2 text-right text-[13px] font-bold text-slate-600">
                {has ? money(tot.available) : "–"}
              </div>
            </div>
          );
        })}
      </header>
      {!collapsed && (
        <div className="border-t border-slate-100">
          {cats.map((c) => (
            <Row
              key={c.id}
              catId={c.id}
              name={c.name ?? ""}
              monthsWin={monthsWin}
              catIndex={catIndex}
              activeMonth={activeMonth}
              selected={selection?.kind === "cat" && selection.cat.id === c.id}
              onSelect={() => {
                const src = catIndex[activeMonth]?.get(c.id);
                if (src) onSelect({ kind: "cat", cat: src, groupId: group.id, month: activeMonth });
              }}
              editingMonth={editing?.catId === c.id ? editing.month : null}
              editingValue={editing?.catId === c.id ? editing.value : null}
              onStartEdit={(m) => {
                const cc = catIndex[m]?.get(c.id);
                setEditing({ catId: c.id, month: m, value: currency ? formatMinorInput(cc?.assigned ?? 0, currency) : "" });
              }}
              onChange={(v) => setEditing((e) => (e && e.catId === c.id ? { ...e, value: v } : e))}
              onCancelEdit={() => setEditing(null)}
              onCommit={(m, v, origin) => onCommitAssign(m, c.id, v, origin)}
            />
          ))}
          {!group.virtual && (
            <button
              onClick={onQuickAdd}
              className="flex w-full items-center gap-1.5 px-4 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-50 hover:text-brand-600"
            >
              <Plus size={12} /> {t("budget_addCategory")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Row({
  catId,
  name,
  monthsWin,
  catIndex,
  activeMonth,
  selected,
  onSelect,
  editingMonth,
  editingValue,
  onStartEdit,
  onChange,
  onCancelEdit,
  onCommit,
}: {
  catId: string;
  name: string;
  monthsWin: string[];
  catIndex: Record<string, Map<string, BudCategory>>;
  activeMonth: string;
  selected: boolean;
  onSelect: () => void;
  editingMonth: string | null;
  editingValue: string | null;
  onStartEdit: (month: string) => void;
  onChange: (v: string) => void;
  onCancelEdit: () => void;
  onCommit: (month: string, v: string, origin?: HTMLInputElement) => void;
}) {
  const { money } = useBudgetMoney();
  return (
    <div
      onClick={onSelect}
      className={`row-hover relative ${GRID} cursor-pointer border-b border-slate-50 px-3 py-[7px] text-[13px] transition-colors last:border-b-0 ${
        selected ? "bg-brand-50/80" : "hover:bg-slate-50"
      }`}
    >
      <div className="truncate pl-4 font-medium text-slate-700">{name}</div>
      {monthsWin.map((m) => {
        const cat = catIndex[m]?.get(catId) ?? null;
        const pct = cat ? goalPct(cat) : null;
        const isEditing = editingMonth === m && !!cat;
        return (
          <div key={m} className={`${MONTH_GRID} relative col-span-3 rounded-lg ${m === activeMonth && cat ? "bg-brand-50" : cat ? "bg-slate-100" : ""}`}>
            {pct != null && pct > 0 && (
              <div
                className="absolute bottom-0 left-1 right-1 h-[3px] overflow-hidden rounded-full"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r transition-all"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100 ? "#10b981" : "linear-gradient(90deg,#f59e0b,#fbbf24)",
                  }}
                />
              </div>
            )}
            <div id={`budget-assignment-${catId}-${m}`} className="text-right" onClick={(e) => e.stopPropagation()}>
              {isEditing ? (
                <input
                  autoFocus
                  className="cell-input"
                  value={editingValue ?? ""}
                  onChange={(e) => onChange(e.target.value)}
                  onBlur={(event) => onCommit(m, editingValue ?? "", event.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommit(m, editingValue ?? "", e.currentTarget);
                    if (e.key === "Escape") onCancelEdit();
                  }}
                />
              ) : (
                <button
                  onClick={() => onStartEdit(m)}
                  disabled={!cat}
                  className={`num w-full rounded-md px-2 py-1 text-right transition-colors hover:bg-brand-50 disabled:pointer-events-none ${
                    !cat || cat.assigned === 0 ? "text-slate-300 hover:text-brand-500" : "font-medium text-slate-700"
                  }`}
                >
                  {!cat || cat.assigned === 0 ? "–" : money(cat.assigned)}
                </button>
              )}
            </div>
            <div className={`num pr-2 text-right ${!cat ? "text-slate-300" : cat.activity > 0 ? "text-emerald-600" : "text-slate-500"}`}>
              {!cat ? "–" : money(cat.activity)}
            </div>
            <div className="pr-2 text-right">
              <span className={`num rounded-md px-2 py-1 text-[13px] font-semibold ${!cat ? "text-slate-300" : availCls(cat)}`}>
                {!cat ? "–" : money(cat.available)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Inspector ------------------------------ */

function Inspector({
  sel,
  data,
  onClose,
  onApply,
  onCover,
  onMove,
  onRename,
  onDeleteCat,
}: {
  sel: Exclude<Selection, null>;
  data: BudgetData;
  onClose: () => void;
  onApply: (d: BudgetData) => void;
  onCover: () => void;
  onMove: () => void;
  onRename: (id: string, name: string) => void;
  onDeleteCat: (id: string) => void;
}) {
  const { t, lang, toast, refreshBoot } = useApp();
  const api = useContext(BudgetWriteContext);
  const { currency, money } = useBudgetMoney();
  const [custom, setCustom] = useState("");
  const customInput = useRef<HTMLInputElement>(null);
  const setOrigin = useContext(BudgetWriteOriginContext);

  const cat = sel.kind === "cat" ? sel.cat : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const assign = async (cents: number) => {
    if (!cat || !currency) return;
    onApply(await api.assign(data.month, cat.id, cents, currency, data.revision));
    toast(money(cents) + " ✓");
  };
  const submitCustom = quietWrite(async () => {
    if (!currency) return;
    let cents: number;
    try { cents = parseAmountToMinor(custom, currency); } catch { return; }
    if (cents < 0) return;
    if (customInput.current) setOrigin(customInput.current);
    await assign(cents);
    setCustom("");
  });

  const goalForm = useMemo(() => {
    if (!cat?.goal) return { type: "", target: "", date: "" };
    return {
      type: cat.goal.type,
      target: cat.goal.target ? formatMinorInput(cat.goal.target, currency || "CNY") : "",
      date: cat.goal.target_month ?? "",
    };
  }, [cat?.goal, currency]);
  const [gf, setGf] = useState(goalForm);
  useEffect(() => setGf(goalForm), [goalForm]);

  return (
    <>
      <div
        key={`bd-${cat?.id ?? "rta"}`}
        aria-hidden="true"
        onClick={onClose}
        className="anim-fade fixed inset-0 z-30 bg-navy-950/25 min-[1680px]:hidden"
      />
      <aside
        key={cat?.id ?? "rta"}
        role="dialog"
        aria-label={sel.kind === "cat" ? (cat?.name ?? "") : t("inspector_readyToAssign")}
        className="anim-slide fixed inset-y-0 right-0 z-40 h-full w-[320px] max-w-[85vw] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-pop min-[1680px]:static min-[1680px]:z-auto min-[1680px]:max-w-none min-[1680px]:shadow-none"
      >
        {sel.kind === "rta" ? (
          <>
            <SectionTitle icon={<Coins size={15} />} title={t("inspector_readyToAssign")} onClose={onClose} />
            <div className={`num mt-3 text-3xl font-bold ${data.readyToAssign < 0 ? "text-rose-600" : "text-brand-600"}`}>
              {money(data.readyToAssign)}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {lang === "zh"
                ? "这是尚未分配任何任务的钱。YNAB 第一法则：给每一块钱一个任务，把它分配到下面的分类里。"
                : "This is money with no job yet. Rule one: give every dollar a job by assigning it below."}
            </p>
            <Btn variant="primary" className="mt-4 w-full" onClick={quietWrite(() => currency && api.autoAssign(data.month, currency, data.revision).then(onApply))}>
              <Sparkles size={14} /> {t("budget_autoAssign")}
            </Btn>
            <Btn className="mt-2 w-full" onClick={onMove}>
              <ArrowRightLeft size={14} /> {t("inspector_moveBtn")}
            </Btn>
          </>
        ) : cat ? (
          <>
            <SectionTitle
              icon={<Target size={15} />}
              title={cat.name ?? ""}
              onClose={onClose}
              actions={
                <>
                  <button className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => cat.name && onRename(cat.id, cat.name)}>
                    <Pencil size={13} />
                  </button>
                  <button className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => onDeleteCat(cat.id)}>
                    <Trash2 size={13} />
                  </button>
                </>
              }
            />

            <div className={`mt-3 rounded-xl p-3 ${cat.available < 0 ? "bg-rose-50" : "bg-slate-50"}`}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("inspector_available")}</div>
              <div className={`num mt-0.5 text-3xl font-bold ${cat.available < 0 ? "text-rose-600" : "text-slate-800"}`}>
                {money(cat.available)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{t("inspector_leftover")}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
                <div>
                  <span className="text-slate-400">{t("inspector_assigned")}: </span>
                  <b className="num text-slate-600">{money(cat.assigned)}</b>
                </div>
                <div>
                  <span className="text-slate-400">{t("inspector_activity")}: </span>
                  <b className={`num ${cat.activity > 0 ? "text-emerald-600" : "text-slate-600"}`}>{money(cat.activity)}</b>
                </div>
              </div>
            </div>

            {cat.available < 0 && (
              <Btn variant="danger" className="mt-3 w-full" onClick={onCover}>
                <AlertTriangle size={14} /> {t("budget_cover")} ({money(Math.abs(cat.available))})
              </Btn>
            )}
            <Btn className="mt-2 w-full" onClick={onMove}>
              <ArrowRightLeft size={14} /> {t("inspector_moveBtn")}
            </Btn>

            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inspector_quickAssign")}</div>
              <div className="space-y-1.5">
                {cat.need != null && cat.need.need > 0 && (
                  <QuickBtn label={t("inspector_needTarget", { amt: money(cat.need.need) })} onClick={() => assign(cat.need!.need)} />
                )}
                <QuickBtn label={t("inspector_lastMonth", { amt: money(cat.lastAssigned) })} onClick={() => assign(cat.lastAssigned)} />
                {cat.avgSpend > 0 && (
                  <QuickBtn label={t("inspector_avgSpend", { amt: money(cat.avgSpend) })} onClick={() => assign(cat.avgSpend)} />
                )}
                <div className="flex gap-1.5 pt-1">
                  <input
                    ref={customInput}
                    className={inputCls + " num"}
                    placeholder={t("inspector_custom")}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitCustom();
                    }}
                  />
                  <Btn
                    variant="primary"
                    onClick={submitCustom}
                  >
                    ✓
                  </Btn>
                </div>
              </div>
            </div>

            {!cat.id.startsWith("cc:") && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <NoteEditor
                  note={cat.note ?? ""}
                  onSave={async (note, origin) => {
                    if (!confirm(t("budget_categoryShare"))) throw new WriteCancelled();
                    if (origin) setOrigin(origin);
                    await api.updateCategory(cat.id, { note });
                    if (currency) onApply(await api.budget(data.month, currency));
                    toast("✓");
                  }}
                />
                <button className="mt-3 text-sm text-slate-600" onClick={quietWrite(async () => {
                  if (!confirm(t("budget_categoryShare"))) return;
                  await api.updateCategory(cat.id, { hidden: true });
                  if (currency) onApply(await api.budget(data.month, currency));
                  await refreshBoot();
                  onClose();
                })}>{t("write_hideCategory")}</button>
              </div>
            )}

            {!cat.id.startsWith("cc:") && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <GoalEditor
                  cat={cat}
                  gf={gf}
                  setGf={setGf}
                  lang={lang}
                  t={t}
                  onSave={quietWrite(async () => {
                    if (!gf.type || !currency) return;
                    let cents: number;
                    try {
                      cents = parseAmountToMinor(gf.target || "0", currency);
                    } catch {
                      return;
                    }
                    await api.setGoal(cat.id, {
                      type: gf.type as "monthly" | "targetBalance" | "targetByDate",
                      target: cents,
                      targetMonth: gf.date || null,
                    }, currency, data.revision);
                    onApply(await api.budget(data.month, currency));
                    toast("✓");
                  })}
                  onClear={quietWrite(async () => {
                    if (!currency) return;
                    await api.clearGoal(cat.id, currency, data.revision);
                    onApply(await api.budget(data.month, currency));
                  })}
                />
              </div>
            )}
          </>
        ) : null}
      </aside>
    </>
  );
}

function SectionTitle({
  icon,
  title,
  onClose,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="-mx-1 flex items-center gap-2 px-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800">{title}</h3>
      {actions}
      <button onClick={onClose} className="rounded-md p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500">
        ✕
      </button>
    </div>
  );
}

function NoteEditor({ note, onSave }: { note: string; onSave: (note: string, origin: HTMLTextAreaElement | null) => Promise<void> }) {
  const { t } = useApp();
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(note);
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Field label={t("inspector_note")}>
        <textarea
          ref={input}
          className={inputCls + " min-h-[96px] resize-y"}
          placeholder={t("inspector_notePlaceholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      {value !== saved && (
        <Btn
          variant="primary"
          className="w-full"
          onClick={quietWrite(async () => {
            if (input.current) {
              input.current.focus();
            }
            await onSave(value, input.current);
            setSaved(value);
          })}
        >
          {t("common_save")}
        </Btn>
      )}
    </>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={quietWrite(onClick)}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-[13px] font-medium text-slate-600 shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
    >
      {label}
    </button>
  );
}

function GoalEditor({
  cat,
  gf,
  setGf,
  t,
  onSave,
  onClear,
}: {
  cat: BudCategory;
  gf: { type: string; target: string; date: string };
  setGf: (g: { type: string; target: string; date: string }) => void;
  lang: string;
  t: (k: never) => string;
  onSave: () => void;
  onClear: () => void;
}) {
  const showTarget = gf.type !== "";
  const showDate = gf.type === "targetByDate";
  const pct =
    cat.goal?.type === "monthly" && cat.goal.target > 0
      ? Math.min((cat.assigned / cat.goal.target) * 100, 100)
      : cat.goal?.type === "targetBalance" && cat.goal.target > 0
        ? Math.min((Math.max(cat.available, 0) / cat.goal.target) * 100, 100)
        : null;

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inspector_goal" as never)}</div>
        {cat.goal && (
          <button onClick={onClear} className="text-[11px] font-medium text-rose-500 hover:underline">
            {t("inspector_clearGoal" as never)}
          </button>
        )}
      </div>
      {pct != null && (
        <div className="mb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      <Field label={t("inspector_goalType" as never)}>
        <select className={inputCls} value={gf.type} onChange={(e) => setGf({ ...gf, type: e.target.value })}>
          <option value="">—</option>
          <option value="monthly">{t("inspector_monthly" as never)}</option>
          <option value="targetBalance">{t("inspector_targetBalance" as never)}</option>
          <option value="targetByDate">{t("inspector_targetByDate" as never)}</option>
        </select>
      </Field>
      {showTarget && (
        <Field label={t("inspector_goalAmount" as never)}>
          <input className={inputCls + " num"} value={gf.target} onChange={(e) => setGf({ ...gf, target: e.target.value })} placeholder="0.00" />
        </Field>
      )}
      {showDate && (
        <Field label={t("inspector_goalDate" as never)}>
          <input type="date" className={inputCls} value={gf.date} onChange={(e) => setGf({ ...gf, date: e.target.value })} />
        </Field>
      )}
      {(showTarget || cat.goal) && (
        <Btn variant="primary" className="mt-1 w-full" onClick={onSave}>
          {t("common_save" as never)}
        </Btn>
      )}
    </>
  );
}

/* ------------------------------ Modals ------------------------------ */

function MoveMoneyModal({ data, onClose, onDone }: { data: BudgetData; onClose: () => void; onDone: (d: BudgetData) => void }) {
  const api = useContext(BudgetWriteContext);
  const { t, lang, toast } = useApp();
  const { currency, money } = useBudgetMoney();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const opts = data.groups.flatMap((g) => [
    <optgroup key={g.id} label={g.virtual ? (lang === "zh" ? "信用卡还款" : "Credit Card Payments") : g.name}>
      {g.categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} — {money(Math.max(c.available, 0))}
        </option>
      ))}
    </optgroup>,
  ]);

  return (
    <Modal title={t("move_title")} onClose={onClose}>
      <Field label={t("move_from")}>
        <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">—</option>
          {opts}
        </select>
      </Field>
      <Field label={t("move_to")}>
        <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">—</option>
          {opts}
        </select>
      </Field>
      <Field label={t("move_amount")}>
        <input autoFocus className={inputCls + " num"} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </Field>
      <Btn
        variant="primary"
        className="w-full"
        onClick={quietWrite(async () => {
          if (!from || !to || from === to || !currency) return;
          let cents: number;
          try {
            cents = parseAmountToMinor(amount, currency);
          } catch {
            return;
          }
          if (cents <= 0) return;
          onDone(await api.moveMoney(data.month, from, to, cents, currency, data.revision));
          toast("✓");
        })}
      >
        <ArrowRightLeft size={14} /> {t("move_confirm")}
      </Btn>
    </Modal>
  );
}

function CoverModal({
  data,
  initialCatId,
  onClose,
  onDone,
}: {
  data: BudgetData;
  initialCatId?: string;
  onClose: () => void;
  onDone: (d: BudgetData) => void;
}) {
  const { t, lang } = useApp();
  const api = useContext(BudgetWriteContext);
  const { currency, money } = useBudgetMoney();
  const overspent = data.groups.flatMap((g) => g.categories).filter((c) => c.available < 0);
  const [catId, setCatId] = useState(initialCatId ?? overspent[0]?.id ?? "");
  const [fromId, setFromId] = useState<string>("rta");
  const donors = data.groups.flatMap((g) => g.categories).filter((c) => c.available > 0 && c.id !== catId);
  const catName = data.groups.flatMap((g) => g.categories).find((c) => c.id === catId)?.name ?? "";

  return (
    <Modal title={t("cover_title")} onClose={onClose}>
      {overspent.length === 0 ? (
        <p className="text-sm text-slate-500">{lang === "zh" ? "当前没有超支的分类。" : "Nothing is overspent right now."}</p>
      ) : (
        <>
          {overspent.length > 1 && (
            <Field label={t("budget_overspent")}>
              <select className={inputCls} value={catId} onChange={(e) => setCatId(e.target.value)}>
                {overspent.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({money(c.available)})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="mb-3 text-[13px] leading-relaxed text-slate-500">
            {t("cover_intro", { name: catName, amount: money(Math.abs(overspent.find((c) => c.id === catId)?.available ?? 0)) })}
          </p>
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {data.readyToAssign > 0 && (
              <DonorOption
                active={fromId === "rta"}
                label={t("cover_useRta")}
                sub={money(data.readyToAssign)}
                onClick={() => setFromId("rta")}
              />
            )}
            {donors.map((c) => (
              <DonorOption key={c.id} active={fromId === c.id} label={c.name ?? ""} sub={money(c.available)} onClick={() => setFromId(c.id)} />
            ))}
          </div>
          <Btn
            variant="primary"
            className="mt-4 w-full"
            onClick={quietWrite(async () => {
              if (!catId || !fromId) return;
              if (currency) onDone(await api.coverOverspending(data.month, catId, fromId, currency, data.revision));
            })}
          >
            {t("inspector_coverBtn")}
          </Btn>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {lang === "zh" ? "第三法则：灵活应变，随时调整预算。" : "Rule three: roll with the punches."}
          </p>
        </>
      )}
    </Modal>
  );
}

function DonorOption({ active, label, sub, onClick }: { active: boolean; label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[13px] transition-all ${
        active ? "border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-300" : "border-slate-200 text-slate-600 hover:border-slate-300"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="num ml-2 shrink-0 text-slate-400">{sub}</span>
    </button>
  );
}

function AddModal({
  kind,
  groups,
  initialGroupId,
  onClose,
  onDone,
}: {
  kind: "group" | "category";
  groups: { id: string; name: string }[];
  initialGroupId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useApp();
  const api = useContext(BudgetWriteContext);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(initialGroupId || groups[0]?.id || "");

  return (
    <Modal title={kind === "group" ? t("budget_addGroup") : t("budget_addCategory")} onClose={onClose}>
      <Field label={t("budget_name")}>
        <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {kind === "category" && (
        <Field label={lang === "zh" ? "所属分组" : "Group"}>
          <select className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Btn
        variant="primary"
        className="w-full"
        onClick={quietWrite(async () => {
          if (!name.trim()) return;
          if (!confirm(t("budget_categoryShare"))) return;
          if (kind === "group") await api.addGroup(name.trim());
          else await api.addCategory(groupId, name.trim());
          await onDone();
        })}
      >
        <Plus size={14} /> {t("common_add")}
      </Btn>
    </Modal>
  );
}

function RenameModal({ name: init, onClose, onSave }: { kind: string; name: string; onClose: () => void; onSave: (n: string) => void }) {
  const { t } = useApp();
  const [name, setName] = useState(init);
  return (
    <Modal title={t("budget_rename")} onClose={onClose}>
      <Field label={t("budget_name")}>
        <input
          autoFocus
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
        />
      </Field>
      <Btn variant="primary" className="w-full" onClick={() => name.trim() && onSave(name.trim())}>
        {t("common_save")}
      </Btn>
    </Modal>
  );
}

function BudgetLedgerSelect({
  currency,
  enabled,
  onChange,
}: {
  currency: string;
  enabled: string[];
  onChange: (code: string) => void;
}) {
  const { t } = useApp();
  return (
    <label className="flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold tracking-wide text-slate-600">
      <span>{t("budget_currency")}</span>
      <select
        id="budget-ledger-currency"
        aria-label={t("budget_currency")}
        value={currency}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand-400"
      >
        {enabled.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyCurrencyLedger({
  notice,
  currency,
  enabled,
  onSwitch,
}: {
  notice: CurrencyNotice | null;
  currency: string;
  enabled: string[];
  onSwitch: (code: string) => void;
}) {
  const { t } = useApp();
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-8">
      <div className="anim-pop max-w-lg text-center">
        <h1 className="text-2xl font-bold text-slate-900">{t("budget_emptyLedger", { code: currency })}</h1>
        <BudgetCurrencyNotice notice={notice} />
        <div className="mt-8 flex flex-col items-center gap-4">
          <a
            href={`#/accounts?createCurrency=${encodeURIComponent(currency)}`}
            className="inline-flex items-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-500"
          >
            {t("budget_createCurrencyAccount", { code: currency })}
          </a>
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm font-medium text-slate-500">{t("budget_switchLedger")}</span>
            <BudgetLedgerSelect currency={currency} enabled={enabled} onChange={onSwitch} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BudgetCurrencyNotice({ notice }: { notice: CurrencyNotice | null }) {
  const { t } = useApp();
  if (!notice) return null;
  return <div role="status" aria-live="polite" className="text-xs font-medium text-amber-700">{t(notice.reason === "disabled" ? "currency_disabled" : "currency_unsupported", { code: notice.requested, fallback: notice.fallback })}</div>;
}

function EmptyStart() {
  const { t, refreshBoot, toast } = useApp();
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-8">
      <div className="anim-pop max-w-lg text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-xl shadow-brand-600/25">
          <CalendarDays size={30} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{t("empty_welcomeTitle")}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-500">{t("empty_welcomeDesc")}</p>
        <div className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3 text-left">
          {[t("rule1"), t("rule2"), t("rule3"), t("rule4")].map((r, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-medium text-slate-600 shadow-sm">
              <span className="mr-1.5 font-bold text-brand-500">{i + 1}</span>
              {r}
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Btn
            variant="primary"
            onClick={quietWrite(async () => {
              try {
                await api.loadDemo();
                await refreshBoot();
                location.reload();
              } catch (error) {
      if (isWriteCancelled(error)) return;
                toast(t("common_error"), "err");
              }
            })}
          >
            <Sparkles size={14} /> {t("empty_loadDemo")}
          </Btn>
          <Btn onClick={() => location.reload()}>{t("empty_startFresh")}</Btn>
        </div>
      </div>
    </div>
  );
}
