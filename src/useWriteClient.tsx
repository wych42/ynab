import { makeT, type Lang } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { ApiError } from "./api";
import { formatAccountMoney, formatMinorInput } from "./format";
import { isVersionedWrite, writeArguments, type WriteSnapshot } from "./writeContext";
import { WriteCancelled } from "./writeCancellation";

type Conflict = { error: ApiError; name: string; original: unknown[]; origin: HTMLElement | null; retry: () => void; cancel: () => void };
function draftLines(conflict: Conflict, lang: Lang): string[] {
  const t = makeT(lang);
  const args = conflict.original;
  const name = conflict.name;
  const categories = conflict.error.groups?.flatMap(g => g.categories) ?? [];
  const category = (id: unknown) => id === "rta" ? t("write_ready") : categories.find(c => c.id === id)?.name ?? conflict.error.budget?.groups.flatMap(g => g.categories).find(c => c.id === id)?.name ?? t("write_category");
  if (name === "moveMoney") return [`${category(args[1])} → ${category(args[2])}`, formatAccountMoney(args[3] as number, args[4] as string, lang)];
  if (name === "coverOverspending") return [`${category(args[2])} → ${category(args[1])}`, t("write_cover")];
  if (name === "copyLastMonth" || name === "autoAssign") return [`${args[0]} · ${args[1]}`, name === "copyLastMonth" ? t("write_copy") : t("write_auto")];
  if (name === "clearGoal") return [category(args[0]), t("write_removeGoal")];
  if (name === "setGoal") {
    const goal = args[1] as { type: string; target: number; targetMonth?: string };
    const type = ({ monthly: t("write_monthly"), targetBalance: t("write_targetBalance"), targetByDate: t("write_byDate") } as Record<string, string>)[goal.type];
    return [category(args[0]), `${type} · ${formatAccountMoney(goal.target, args[2] as string, lang)}`, goal.targetMonth ?? ""];
  }
  if (["addCategory", "renameCategory", "renameGroup", "addGroup"].includes(name)) return [String(args[name === "addGroup" ? 0 : 1])];
  if (name === "updateCategory") {
    const patch = args[1] as { name?: string; note?: string; hidden?: boolean };
    return [category(args[0]), patch.name ?? "", patch.note == null ? "" : `${t("write_note")}：${patch.note}`, patch.hidden == null ? "" : patch.hidden ? t("write_hideCategory") : t("write_restoreCategory")];
  }
  const body = args.find(arg => arg && typeof arg === "object" && !Array.isArray(arg)) as Record<string, unknown> | undefined;
  if (!body) return [t("write_apply")];
  const account = conflict.error.accounts?.find(a => a.id === (body.accountId ?? args[0]));
  const code = typeof body.currencyCode === "string" ? body.currencyCode : account?.currencyCode;
  const lines = [account?.name ?? "", ...[body.name, body.date, body.startingDate, body.payeeName, body.memo].filter(v => typeof v === "string") as string[]];
  if (code) for (const key of ["amount", "statementBalance", "startingBalanceMinor"]) if (typeof body[key] === "number") lines.push(`${t("write_accountAmount")}：${formatAccountMoney(body[key] as number, code, lang)}`);
  if (body.closed != null) lines.push(body.closed ? t("write_closeAccount") : t("write_reopenAccount"));
  const other = conflict.error.accounts?.find(a => a.id === body.transferAccountId);
  const otherAmount = body.fromAmountMinor ?? body.toAmountMinor;
  if (other?.currencyCode && typeof otherAmount === "number") lines.push(`${other.name}：${formatAccountMoney(otherAmount, other.currencyCode, lang)}`);
  return lines.filter(Boolean);
}
export function useWriteClient(snapshot: WriteSnapshot | null | undefined, lang: Lang, onCancel?: () => void) {
  const read = useRef(snapshot);
  read.current = snapshot;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [writing, setWriting] = useState(false);
  const pending = useRef(false);
  const pendingReject = useRef<((error: Error) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nextOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => () => { pendingReject.current?.(new WriteCancelled()); pendingReject.current = null; }, []);
  useEffect(() => {
    if (!conflict) return;
    const prior = conflict.origin;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (prior?.isConnected) prior.focus(); };
  }, [conflict]);
  useEffect(() => { if (conflict && writing) dialogRef.current?.focus(); }, [conflict, writing]);
  const client = useMemo(() => new Proxy(api, {
    get(target, property) {
      const name = String(property);
      const method = target[name as keyof typeof api];
      if (!isVersionedWrite(name)) return method;
      return (...original: unknown[]) => {
        const origin = nextOrigin.current ?? document.activeElement as HTMLElement | null;
        nextOrigin.current = null;
        if (pending.current) return Promise.reject(new WriteCancelled());
        pending.current = true;
        const captured = read.current ?? {};
        return new Promise((resolve, reject) => {
          pendingReject.current = reject;
          const finish = () => { pending.current = false; pendingReject.current = null; };
          let attemptInFlight = false;
          const attempt = async (version: WriteSnapshot, retry = false) => {
            if (attemptInFlight) return;
            attemptInFlight = true;
            setWriting(true);
            try {
              const result = await (method as (...args: unknown[]) => Promise<unknown>)(...writeArguments(name, original, version, retry));
              setConflict(null);
              finish();
              resolve(result);
            } catch (caught) {
              const error = caught as ApiError;
              if (error?.code !== "budget_revision_conflict" && error?.code !== "category_revision_conflict") { finish(); reject(caught); return; }
              const latest = { ledgerRevisions: error.ledgerRevisions ?? (error.budget ? { [error.budget.currencyCode]: error.budget.revision! } : undefined), categoryRevision: error.categoryRevision };
              setConflict({ error, name, original, origin, retry: () => { void attempt(latest, true); }, cancel: () => { if (attemptInFlight) return; finish(); setConflict(null); reject(new WriteCancelled()); cancelRef.current?.(); } });
            } finally {
              attemptInFlight = false;
              setWriting(false);
            }
          };
          void attempt(captured);
        });
      };
    },
  }), []);
  const t = makeT(lang);
  const conflictDialog = conflict && (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="write-conflict-title" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); conflict.cancel(); }
      if (event.key === "Tab") {
        if (writing) { event.preventDefault(); return; }
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
        if (!buttons?.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
      }
    }}>
      <div className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <h2 id="write-conflict-title" className="font-semibold" role="status" aria-live="assertive">{conflict.error.code === "category_revision_conflict" ? t("write_categoryConflict") : t("write_budgetConflict")}</h2>
        <p className="my-3 text-sm">{t("write_kept")}</p>
        {conflict.name === "assign" && <div className="my-3 text-sm"><p>{t("budget_currency")} {String(conflict.original[3])}</p><p>{t("write_input")} {formatMinorInput(conflict.original[2] as number, conflict.original[3] as string)}</p><p>{t("write_latestValue")} {formatMinorInput(conflict.error.budget?.groups.flatMap(g => g.categories).find(c => c.id === conflict.original[1])?.assigned ?? 0, conflict.original[3] as string)}</p></div>}
        {conflict.name !== "assign" && <div className="my-3 rounded bg-slate-50 p-2 text-sm"><strong>{t("write_pending")}</strong>{draftLines(conflict, lang).map((line, index) => <div key={index}>{line}</div>)}</div>}
        <p className="text-sm font-semibold">{t("write_latestValues")}</p>
        {conflict.error.budget && <ul className="my-2 text-sm"><li>{t("write_ready")}：{formatAccountMoney(conflict.error.budget.readyToAssign, conflict.error.budget.currencyCode, lang)}</li>{conflict.error.budget.groups.flatMap(g => g.categories).map(c => <li key={c.id}>{c.name}：{formatAccountMoney(c.assigned, conflict.error.budget!.currencyCode, lang)}{c.goal && ` / ${t("write_goal")}: ${formatAccountMoney(c.goal.target, conflict.error.budget!.currencyCode, lang)}`}</li>)}</ul>}
        {conflict.error.accounts?.map(a => <div className="text-sm" key={a.id}>{a.name}：{formatAccountMoney(a.balance, a.currencyCode, lang)}</div>)}
        {conflict.error.code === "category_revision_conflict" && conflict.error.groups?.map(g => <div className="my-2 text-sm" key={g.id}><strong>{g.name}</strong>{g.categories.map(c => <div key={c.id}>{c.name}{c.note ? `：${c.note}` : ""}{c.hidden ? t("write_hidden") : ""}</div>)}</div>)}
        <div className="mt-4 flex gap-3"><button disabled={writing} className="rounded bg-brand-600 px-3 py-2 text-white disabled:opacity-50" onClick={conflict.retry}>{t("write_retry")}</button><button disabled={writing} className="rounded border px-3 py-2 disabled:opacity-50" onClick={conflict.cancel}>{t("cancel")}</button></div>
        {writing && <p role="status" className="mt-2 text-sm">{t("write_submitting")}</p>}
      </div>
    </div>
  );
  return { client, conflictDialog, setWriteOrigin: (element: HTMLElement) => { nextOrigin.current = element; } };
}
