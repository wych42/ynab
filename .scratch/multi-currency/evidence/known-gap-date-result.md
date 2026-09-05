# Net-worth valuation date boundary

Server and frontend implementation completed on 2026-09-05. Independent real browser acceptance is still pending; these automated checks alone do not close MC-UI-NW-009.

## Contract and implementation

The existing HTTP contract requires `reportingCurrency`, `asOf`, and `months`. An omitted `asOf` continues to return HTTP 400 `invalid_date`; the frontend owns filling in the household default date.

`server/reports.mjs` now checks a strictly parsed calendar date against the household's current day before loading balances or calling FX. The default clock is `todayYmd`, which reads the configured timezone on each call. The reports factory accepts an injected `today` function for deterministic boundary tests.

- Invalid format, empty dates, and impossible calendar days: HTTP 400 `invalid_date`.
- Future calendar dates: HTTP 400 `future_valuation_date`.
- Valid historical dates and today: retain normal report behavior.
- Investment observation dates, account inputs, and FX-provider date parsing are unchanged.

## Verification

Node runtime: `/Users/chichi/.local/share/mise/installs/node/20.20.2/bin/node`.

TDD RED: the new `server/reports.valuation-date.test.mjs` ran 8 tests, with 2 failures and 6 passes. A request for 2099-01-01 returned 200 rather than 400; the injected timezone-boundary test also accepted a future date. The initial sandbox invocation could not bind localhost; rerunning with approved localhost access executed the tests and established the behavioral failures.

GREEN: the new date suite and existing net-worth HTTP, currency reports, investment module, and investment-list HTTP suites passed: 5 files, 37 tests. TypeScript `tsc -b --noEmit` passed.

New checks cover `bad`, an explicit empty value, 2026-02-30, non-padded 2026-2-03, 2099-01-01, missing asOf, a leap-day historical value, and today. Rejected HTTP requests seed a nonzero USD account and assert that the registered FX provider receives no request. At the fixed instant 2026-09-04T16:30Z, September 5 is accepted in Asia/Singapore and rejected in UTC; changing the household timezone is observed by the same reports module. No global Date replacement is used.

## Frontend implementation and verification

`src/netWorthRoute.ts` resolves both currency and date into one canonical URL. It uses the same strict Date.UTC field comparisons as the backend, rejects duplicate dates and explicit empty dates, keeps valid history and unrelated query parameters, and computes the day in the household timezone through a clock-injectable helper.

`ReportsPage.tsx` now leaves net-worth normalization to one effect; the outer currency effect handles cashflow only. Requests use resolved valid values only after bootstrap completes. A recovery record binds both reasons to the canonical destination, preserving them across replace and language rerenders and clearing them after valid navigation. The date input exposes the household day's maximum and disables itself until boot is ready. Programmatic input changes still pass through route validation. Existing keyed request handling continues to discard obsolete responses.

Two new bilingual entries in `src/i18n.ts` explain invalid or future valuation dates and offer a historical-date choice. The existing valuation-date label is retained.

Frontend TDD RED: the new component suite failed 8 of 9 tests against the original page. It demonstrated invalid/future requests, premature requests before bootstrap, missing recovery notices and missing timezone revalidation. The new pure-helper suite initially failed because its implementation module was absent.

Frontend GREEN: 19 helper tests and 9 component tests pass. The existing currency, investments, net-worth and polish component suites plus these new suites pass together: 6 files, 62 tests. Node 20 TypeScript checking passes. Coverage includes empty/invalid/future/duplicate dates; both currency and date invalid at once; preserving history during currency repair; no bootstrap request; timezone changes; localized reason persistence; replacement without increasing history length; and synthetic future input changes. Native browser back/forward and network acceptance remain assigned to the independent acceptance agent.

## Independent acceptance handoff

The net-worth URL should resolve an invalid or future `asOf` to the household timezone's today, replace the invalid URL entry, preserve other valid filters, and display an accessible localized explanation. Explicit empty values must be distinguished from absent values so that the former gets an explanation. The date input should expose `max=today`; direct URL and synthetic input changes still need validation before fetching. Dates equal to today and real historical calendar dates must stay untouched. The UI must avoid querying the invalid date or retaining a spinner or generic Retry-only page.

Confirm URL replacement, retained currency, no storage writes, reason persistence, no repeated fetch of the rejected date, and a usable date control in the real browser/network workflow.

This worker performed no commit, push, or deployment. The coordinator committed the server stage independently. The existing modified implementation plan and prior acceptance evidence were preserved.
