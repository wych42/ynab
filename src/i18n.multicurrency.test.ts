import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { dicts, makeT } from "./i18n";

const files = ["useWriteClient.tsx", "format.ts", "pages/BudgetPage.tsx", "pages/AccountsPage.tsx", "pages/TransactionsPage.tsx", "pages/ReportsPage.tsx"];
// Existing copy from a3b9295 is outside this migration. Currency/date locale
// selection is behavior, so these exact expressions remain allowed.
const legacyEnglish: Record<string, string[]> = {
  "pages/BudgetPage.tsx": ["Today", "Group is not empty", "Credit Card Payments", "This is money with no job yet. Rule one: give every dollar a job by assigning it below.", "Nothing is overspent right now.", "Rule three: roll with the punches.", "Group"],
  "pages/AccountsPage.tsx": ["Account created", "No accounts yet. Create your first one!", "On-budget accounts (cash, savings, credit cards) drive the budget; tracking accounts just watch assets. Credit cards may start negative for existing debt."],
  "pages/ReportsPage.tsx": ["Total inflows to on-budget accounts this month."],
};
const localeExpressions = ['lang === "en" ? "en-US" : "zh-CN"', 'lang === "en" ? "en" : "zh"', 'lang === "zh" ? "zh-CN" : "en-US"'];
it("keeps both dictionaries and interpolation variables in sync", () => {
  expect(Object.keys(dicts.zh).sort()).toEqual(Object.keys(dicts.en).sort());
  for (const key of Object.keys(dicts.zh) as (keyof typeof dicts.zh)[]) {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    expect(placeholders(dicts.zh[key]), key).toEqual(placeholders(dicts.en[key]));
  }
});
it("centralizes the new multi-currency copy, including accessible names", () => {
  const required = ["write_categoryConflict", "write_budgetConflict", "write_retry", "write_pending", "budget_noFunds", "acc_currencyFilter", "txp_bookingCurrency", "rep_valuationDate", "fx_manual"];
  for (const key of required) expect(Object.keys(dicts.zh)).toContain(key);
  const migrated = Object.entries(dicts.en).filter(([key]) => /^(write_|mc_|fx_)/.test(key)).map(([, value]) => value);
  const leaks: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && (migrated.includes(node.text) || node.text === "asOf" && ts.isJsxAttribute(node.parent))) leaks.push(`${file}: ${node.text}`);
      if (ts.isConditionalExpression(node) && /^(en|lang\s*===)/.test(node.condition.getText(source))) {
        const expression = node.getText(source).replace(/\s+/g, " ");
        const legacy = ts.isStringLiteral(node.whenFalse) && legacyEnglish[file]?.includes(node.whenFalse.text);
        const locale = file === "format.ts" && localeExpressions.includes(expression);
        const oldTransfer = file === "pages/TransactionsPage.tsx" && expression === 'lang === "zh" ? `转账 ${tx.otherAccountName}` : `Transfer: ${tx.otherAccountName}`';
        if (!legacy && !locale && !oldTransfer) leaks.push(`${file}: ${expression}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(leaks).toEqual([]);
});
it("preserves literal user content in translated placeholders", () => {
  for (const lang of ["zh", "en"] as const) {
    expect(makeT(lang)("currency_disabled", { code: "CAD", fallback: "SGD" })).toContain("CAD");
    expect(makeT(lang)("currency_disabled", { code: "CAD", fallback: "SGD" })).toContain("SGD");
    const code = "My {fallback} $& account";
    const result = makeT(lang)("currency_disabled", { code, fallback: "SGD" });
    expect(result).toContain(code);
    expect(result).toContain("SGD");
    expect(makeT(lang)("currency_disabled", { code: "CAD" })).toContain("{fallback}");
  }
});
