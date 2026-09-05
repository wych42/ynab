# Known-gap acceptance

Status: PASS for the scoped known gaps and the additionally discovered chart-label defect on final product commit `9b8fbe22ce962c424e8e52f9f530d858d5485b3a`. This judgment uses current independent execution. It does not claim the historical 147-case matrix is now completely verified.

The acceptance agent owns this document and `evidence/known-gap-acceptance-*` only. Product code and implementation tests are outside its write scope. Browser/API mutations must target a temporary database and dedicated local service. No production data is used.

## Scope and decision rule

Sources: `ui-product-intent.md`, `ui-release-followups.md`, `ui-final-acceptance.md`, and direct inspection of `src/pages/ReportsPage.tsx`, `src/hashRoute.ts`, `src/useWriteClient.tsx`, and server FX/date routes. The user-authorized date rule is a real calendar date no later than today in the household timezone. Missing frontend URL date defaults to household today; malformed or future explicit URL dates recover to household today with an explanation. The API retains its existing required `asOf` contract: missing, invalid and future valuation API dates return 400.

This round closes i18n centralization and valuation-date gaps only after current code, current full regression checks, and real browser observations agree. A previous P2 classification does not waive either gap. Native screen-reader speech and native 200% browser zoom remain previously documented evidence limits; this round does not classify their absence as a newly discovered product failure.

## Independent coverage

| ID | Setup and action | Required observable result | Evidence layer | Result |
| --- | --- | --- | --- | --- |
| KG-I18N-SOURCE | Inspect all newly added multi-currency system strings, including write client, notices, budget actions, regions and accessible labels | English and Chinese values live in existing `src/i18n.ts`; no second translation dictionary or inline bilingual strings remain in the changed surface | Source diff and search | PASS; evidence and limits below |
| KG-I18N-LIVE | Switch Chinese/English on budget, reports, settings, empty states and fallback notices | Role terms and new system messages use the selected language; custom user names/notes remain intact | Real browser | PASS; evidence and limits below |
| KG-I18N-CONFLICT | Trigger genuine stale budget and shared-category writes; inspect pending input and latest values in both languages | Currency, negative/JPY amount precision, category name, shared note and goal month retain their meanings; all interpolation values render with no unresolved placeholders | Real browser plus focused tests/source | PASS; evidence and limits below |
| KG-I18N-RETRY | Cancel a genuine conflict, then explicitly retry preserved draft | Cancel does not write; focus and draft remain; explicit retry writes expected values and preserves revision checks | Real browser/API readback | PASS; evidence and limits below |
| KG-DATE-DEFAULT | Open net-worth URL with no date | Household today appears in input, report, URL and request; URL completion uses replace | Real browser/API | PASS; evidence and limits below |
| KG-DATE-EMPTY | Open explicit `asOf=` | Treat explicit empty date according to invalid-date contract, recover with explanation, no empty date request | Real browser | PASS; evidence and limits below |
| KG-DATE-INVALID | Try `garbage`, `2026-02-30`, `2026-2-03`, `2026-13-01`, `0000-01-01`, and non-leap `2025-02-29` | Reject invalid calendar/format values before valuation/FX request; recover to household today with readable reason | Real browser/API and helper tests | PASS; evidence and limits below |
| KG-DATE-LEAP | Use valid historical `2024-02-29` | Preserve exact date through URL, input and request | Browser/API or targeted tests | PASS; evidence and limits below |
| KG-DATE-FUTURE | Open tomorrow and far-future `2099-01-01`; attempt date-input future edit | No future valuation or FX request; consistent recovery and reason; input boundary reflects household today | Real browser/API | PASS; evidence and limits below |
| KG-DATE-VALID | Open today and historical date, then switch reporting currency | Date and reporting currency agree across URL/input/report/request; household default setting unchanged | Real browser/API | PASS; evidence and limits below |
| KG-DATE-COMBINED | Open disabled/unsupported currency with invalid/future date | One stable canonical URL using valid currency and household today; both applicable reasons remain visible; no effect loop or stale invalid request | Real browser/network | PASS; evidence and limits below |
| KG-DATE-PRESERVE | Open invalid currency with valid historical date | Recover currency while retaining the exact historical date | Real browser/network | PASS; evidence and limits below |
| KG-DATE-HISTORY | Enter invalid URL from a valid route, wait after recovery, navigate backward and forward; edit to historical date | Recovery itself does not increase `history.length`; explanation survives rerender/replace; history does not loop; valid date selection restores normal interaction and clears obsolete warning | Real browser | PASS; evidence and limits below |
| KG-DATE-TIMEZONE | Household timezone differs from browser/server and falls on another calendar day | Defaults, maximum date and API acceptance all use household day; no local/UTC off-by-one | Real browser with controlled clock and API/helper evidence | PASS; evidence and limits below |
| KG-DATE-API | Direct invalid/future net-worth requests including repeated query values | 400 with structured error; no provider request or cache mutation; today/history still work | Isolated HTTP and service tests | PASS; evidence and limits below |
| KG-DATE-REGRESSION | Inspect date-helper callers and run full current tests | Investment valuation dates, ordinary transaction dates and FX cache/rate semantics are unchanged except explicitly authorized boundary | Diff/full tests | PASS; evidence and limits below |
| KG-REGRESSION | Freeze current source identity; run Node 20 full tests, typecheck and production build independently | All pass without newly skipped tests; report exact counts, version and relevant build warnings | Fresh execution logs | PASS; evidence and limits below |

## Counterexamples to investigate

- Currency repair and date repair can race if separate effects both rebuild the URL from stale query state. A valid historical date can be lost when the currency is repaired.
- Canonical URL replacement can immediately clear a warning because the next render sees valid input. Changing language must translate the retained warning without losing its original reason.
- Date inputs reject malformed strings at the browser level, so direct URL/API probes are necessary. A `max` attribute alone does not block programmatic or pasted future input from reaching fetch.
- `Date` can normalize impossible calendar dates. Lexicographic comparison is valid only after strict format/calendar validation. JavaScript's treatment of years below 100 requires explicit attention.
- Duplicate date query parameters, percent-encoded whitespace, a date-time string and an empty value must not accidentally bypass validation through string coercion.
- The browser may start a report request before boot settings load. A fallback based on machine timezone during that interval can fetch the wrong day.
- A later bootstrap/settings refresh can change household timezone. Derived date state must not retain an invalid day or clear its explanation incorrectly.
- A report request for a valid historical date can finish after a subsequent selection; its result must not be displayed under the newer selection.
- i18n interpolation must preserve zero, negative amounts, JPY precision, Unicode user names and notes, and multiple different placeholders. A translated conflict title alone does not prove draft details survived.
- History length alone cannot prove correct back/forward restoration; inspect the actual preceding and restored URLs as well.

## Execution evidence

Independent final execution: Node 20.20.2, 96 test files and 804 tests passed with zero failed or pending tests. Final typecheck passed. Final production build passed in 11.39 seconds; Vite emitted only its large-chunk warning. Evidence is `known-gap-acceptance-tests-final.log`, `known-gap-acceptance-vitest-final.json`, `known-gap-acceptance-typecheck-final.log`, and `known-gap-acceptance-build-final.log`. Product source and tests have no uncommitted changes, and `git diff --check` passed.

The coordinator assigned browser ownership and service preparation to this agent. Isolated service `http://localhost:3102` runs with Node 20.20.2 and `DATA_DIR=/private/tmp/ynab-known-gap-acceptance.YWZUZ0`. The initial sandbox rejected socket listening and loopback connections with EPERM; escalation review allowed both operations. These environment errors are not product failures.

Service checkpoint `f95e90e` passed 16 independent HTTP cases, recorded in `evidence/known-gap-acceptance-api-results.json`. Missing, empty, duplicate, malformed, impossible, non-padded, year-zero, non-leap, whitespace-prefixed and date-time values returned 400. Tomorrow and 2099 returned `future_valuation_date`. Household today, 2026-09-01 and 2024-02-29 returned 200 with the exact requested date and complete results. Fixtures contain two CNY/JPY accounts and one deterministic manual exchange rate, all in the temporary database. Household timezone is Pacific/Kiritimati.

Source inspection at i18n checkpoint `c5495d1` confirms `makeT` now performs a single callback-based placeholder pass. Replacement values containing `$&` or another placeholder are returned literally rather than interpreted again. Conflict notes continue to concatenate the user value outside translation lookup. Independent browser conflict results are recorded below.

## Final observations and coverage limits

| Coverage | Current independent evidence |
| --- | --- |
| Date URL recovery | `known-gap-acceptance-browser-dates-results.json` contains 17 passing browser checks. Missing/empty/invalid/future/calendar boundary dates, valid today/history/leap day, simultaneous invalid currency/date, historical date preservation, retained English warnings, and actual backward/forward restoration passed. Each case recorded real report requests and `history.replaceState` calls; invalid original values were never requested. |
| Household timezone and startup | `known-gap-acceptance-boot-timezone.json` records a 650ms delayed bootstrap with zero premature report requests. Browser time was fixed to 2026-09-04T10:30Z: Singapore day was September 4 while household Kiritimati day was September 5. URL, input, maximum date and sole request all used September 5. Future input created one user history entry, recovery created none, and explicit historical selection removed obsolete warnings. |
| Budget conflict and retry | `known-gap-acceptance-budget-conflict.json` shows genuine Chinese and English 409 dialogs with draft 123.45 and latest 678.90. Cancel retained the focused input and did not change the latest server value. Explicit retry wrote 12345 minor units, confirmed by HTTP readback. |
| JPY precision | `known-gap-acceptance-jpy-conflict.json` shows genuine JPY conflict draft 123, latest 678 and all JPY latest values without fractional digits. Cancel retained focus and draft. Negative assignment was rejected by the existing assignment input validation; it was not used to claim a negative-assignment conflict pass. |
| Shared-category conflict | English and Chinese conflicts displayed the literal `$&`, `{currency}`, `{fallback}`, zero, Unicode and multiline note values. `known-gap-acceptance-note-conflict-zh.json` records Chinese cancellation with focus, no write, and a second explicit save/retry with exact API readback. English was observed in the same real session; a language change after cancellation refreshed the snapshot, and the following explicit save succeeded directly. Repeated shared-scope confirmations used a `window.confirm` acceptance shim, with the actual Chinese/English prompt strings recorded. |
| System language coverage | `known-gap-acceptance-i18n-live.json` records Chinese/English EUR empty budget, empty investment report, settings and net-worth page text. Date warnings and budget/shared-category conflict text were separately checked. User-created Chinese category names were preserved. Source review plus the independent full suite verified dictionary key and placeholder parity and absence of newly migrated inline bilingual strings. Earlier pre-multi-currency copy explicitly enumerated in the test remains outside this migration. |
| Other date semantics | Server change adds the boundary inside net-worth reporting before snapshot/FX execution. Existing transaction, investment and FX date helpers are unchanged. The full suite includes the no-FX-call invalid-date assertions and household timezone-change assertions. Goal type, amount and target-month argument positions in conflict previews remain unchanged in the reviewed diff; target-month preservation was checked by source, not by a separate live goal editor scenario. |

## Additional chart defect and closure

`KG-CHART-LABELS` was added after the coordinator noticed clipping in the actual English screenshot. This was a confirmed product failure on `785fc2e`: the SVG began at x=544.5 while `CN¥16,000.00` and `CN¥12,000.00` began at x=515.7265625, leaving 28.7734375px outside the SVG. The visible screenshot lost the currency and leading digit. Initial evidence is `known-gap-acceptance-date-warning-en.png`.

Final `9b8fbe2` passes all eight browser combinations of English/Chinese, 1280px/390px, and net-worth/cashflow charts. `known-gap-acceptance-axis-results.json` records exact SVG/tick boxes; every money tick stays within its SVG. Visible narrow screenshots are `known-gap-acceptance-axis-visible-net-worth-390.png` and `known-gap-acceptance-axis-visible-cashflow-390.png`. Both local chart regions focus correctly and ArrowRight changes `scrollLeft` from 0 to 29 while focus remains; measured client width is 307 and scroll width 336.

Large negative USD/JPY and safe-integer extremes were verified by source and independently rerun helper tests, not by a live extreme-value chart. The width calculation accounts for the full formatted currency/sign string, both positive and negative rounded magnitude bounds, and wide glyphs. The narrow chart retains at least 208px of plot width through local scrolling. Normal real chart geometry verifies the actual font and SVG layout.

## Harness corrections

The initial date script used unavailable `URLSearchParams` in the Playwright tool's host sandbox; these script errors are preserved in `known-gap-acceptance-browser-dates-initial.json`. A corrected parser reran all 17 date checks successfully. Other harness corrections were a broad dialog selector matching both inspector and conflict, `innerText` collapsing note line breaks despite intact `textContent`, clicking an obscured language button behind a modal, un-routing before a delayed route finished, and changing language while the mobile sidebar was outside the viewport. These were independently identified as harness issues; the subsequent successful checks are the acceptance evidence.

The verdict is scoped PASS: all 17 planned coverage rows and the added chart-label case are satisfied at the evidence layers stated here, for 18 coverage items in total. Both requested known gaps and the discovered chart clipping defect are closed. A final real CNY-to-JPY selection retained historical date 2026-09-01 and household default CNY while showing JPY320,000 without decimals. Native screen-reader speech and native browser zoom remain the previous documented evidence limits. No production service was deployed and no production database was touched by this acceptance agent.

Independent acceptance signed on 2026-09-05 for `9b8fbe22ce962c424e8e52f9f530d858d5485b3a`. Browser ownership is released to the coordinator. The isolated port 3102 service and its temporary database are retained for reproducibility.
