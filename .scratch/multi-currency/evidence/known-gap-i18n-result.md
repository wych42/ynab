# Multi-currency copy migration

Completed the known `MC-UI-I18N-008` copy-management gap against the new UI changes since `a3b9295`. This result records source and component verification; it does not claim a native screen-reader run or a deployed result.

## Scope and changes

- `src/useWriteClient.tsx`: moved every inline bilingual conflict title, explanation, action, pending draft label, goal label, account action and hidden-state label into `src/i18n.ts`. Translation is selected on each render, including an already-open conflict. The hook and draft formatter now accept the existing `Lang` union.
- `src/pages/BudgetPage.tsx`: migrated the budget-table accessible name, unfunded-account heading/explanation/action, and hidden-category controls. The heading uses the existing translator's `{code}` interpolation.
- `src/pages/AccountsPage.tsx`: migrated the household net-worth link and account-currency filter.
- `src/pages/TransactionsPage.tsx`: migrated the account-booking-currency filter and its accessible name.
- `src/pages/ReportsPage.tsx`: migrated the investment-list accessible name, chart-data month/category headings and valuation-date accessible name. `aria-label="asOf"` now uses translated `rep_valuationDate`.
- `src/format.ts`: migrated all human-readable exchange-rate source labels. Numeric currency formatting and locale selection remain unchanged.
- `src/i18n.ts`: added matching Chinese and English entries; reused the existing budget-ledger translation. Fixed interpolation to replace placeholders in the original template once, using a callback, so supplied text containing `{fallback}` or `$&` remains literal.

Tests changed: `src/i18n.multicurrency.test.ts`, `src/useWriteClient.test.tsx`, `src/pages/AccountsPage.test.tsx`. The account-page tests now use the real translator instead of returning translation keys, while retaining their observable label and workflow assertions.

## RED and GREEN evidence

1. Before copy migration, the new dictionary/source contract failed because `write_categoryConflict` was missing; two other dictionary tests passed. The failed assertion demonstrated the centralized-copy gap.
2. The language-switch component test first exposed an incorrect test expectation for an ordinary space: the production formatter returns a nonbreaking space in `SGD 123.45`. The test now accepts a whitespace separator and still asserts the exact currency code and amount. This was a test correction, not a product regression.
3. The literal-interpolation regression failed against the old implementation: `My {fallback} $& account` became `My SGD {code} account`. After replacing sequential `replaceAll` calls with one callback-based template pass, both languages preserve the complete supplied value. Missing variables still leave their placeholders intact.
4. The first broad related-test run reported 100 passed and 3 failed. All three failures were in AccountsPage's key-returning translator mock, which could no longer produce migrated visible labels. Replacing that mock with `makeT(h.lang)` and checking actual translated labels fixed those failures.
5. Final related run: **18 files, 103 tests passed, 0 failed, 0 pending**. Machine-readable results: `known-gap-i18n-vitest.json`.

Command used with Node 20.20.2 first in PATH:

```sh
npx vitest run src/i18n.multicurrency.test.ts src/i18n.p0.test.ts src/useWriteClient.test.tsx src/format.test.ts src/pages/BudgetPage src/pages/AccountsPage src/pages/TransactionsPage src/pages/ReportsPage --reporter=json --outputFile=.scratch/multi-currency/evidence/known-gap-i18n-vitest.json
```

The dictionary contract compares all Chinese/English keys and their placeholder sets. The TypeScript AST guard scans the six migrated source files, detects inline language conditionals and migrated literal strings, and rejects the internal `asOf` accessible name. Its explicit legacy list was checked against `a3b9295`; it does not use a grep-for-Chinese heuristic. The open-conflict component test switches Chinese to English without another write, checks translated conflict and draft labels, and preserves Chinese/English user names, notes and the SGD amount.

`npm run typecheck` passed after the initial migration. The later run during parallel date implementation reported only the date worker's new `src/netWorthRoute.test.ts` importing its not-yet-created module. No i18n type errors were reported. The coordinator will run the final integrated typecheck when that implementation is ready. `git diff --check -- src` passed after the related test run.

## Source-scan exclusions

The baseline comparison covered new inline language conditions throughout the frontend, then checked the six migration targets in full. Existing pre-`a3b9295` messages remain outside this cleanup: Budget Today/group error/credit-card group/help text, Accounts creation/existing onboarding text, Transactions transfer-name text, and the existing Reports inflow explanation. Currency codes, API fields, URL keys, HTML roles, date/number locale identifiers, user account/category/group names and notes are data or behavior and were not translated or rewritten. No server or date-boundary implementation was changed by this worker.

ReportsPage and i18n were frozen and handed to the date worker after this migration. The pre-existing uncommitted `ui-implementation-plan.md` was not edited. No commit, push, deployment or database write was performed.
