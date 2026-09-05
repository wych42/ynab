# Full money labels on report axes

The independent browser acceptance confirmed clipping of `CN¥16,000.00` and `CN¥12,000.00`: the SVG began at x=544.5, while the label bounding boxes began at x=515.73, leaving 28.77px outside the SVG. The screenshot showed the top tick as `6,000.00`, losing both currency and the leading digit.

Both affected charts used a fixed 70px Y axis, a negative 12px left margin and the complete currency formatter. The cashflow and net-worth charts now use one shared `chartMoneyLayout` helper, a zero left margin, and enough width for their final formatted strings. The helper includes currency prefixes, signs, separators and decimal places; it also budgets for automatic domain rounding to the next magnitude. Its 11px font allowance uses 8px for ordinary characters, 14px for wider glyphs and 16px additional padding. Values at the safe-integer boundary are clamped only for sizing samples; the actual data and chart domains are unchanged.

Each chart keeps at least 200px of plotting room plus the right margin. When its containing card is narrower, the chart scrolls within a `tabIndex=0`, labeled region. The region uses the existing translated chart title. Full tick amounts, tooltips and chart-data table values are preserved.

TDD: `chartMoneyLayout.test.ts` first failed because the helper was absent. Two additional page tests independently failed because the cashflow and net-worth chart scroll regions did not exist. After implementation, the helper and page-polish tests passed 29/29 and `npm run typecheck` passed. The subsequent complete ReportsPage test run and helper run passed 6 files and 50 tests, with 0 pending; results are recorded in `known-gap-chart-axis-vitest.json`. `git diff --check` passed.

Coverage includes the observed CNY16,000 clipping case in both languages, large negative USD and JPY values in both languages, JPY zero-decimal formatting, absent history, safe-integer limits, minimum plotting width, and both chart regions' keyboard access and local scrolling. DOM tests establish the layout contract; final text bounding boxes and screenshots are verified by the independent browser worker after rebuild.

Changed files: `src/chartMoneyLayout.ts`, `src/chartMoneyLayout.test.ts`, `src/pages/ReportsPage.tsx`, `src/pages/ReportsPage.polish.test.tsx`. No date/i18n logic, database values, commits or deployment were changed by this worker.
