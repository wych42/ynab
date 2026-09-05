# Net-worth valuation date boundary

Server stage completed on 2026-09-05. Frontend recovery is still pending; this server result alone does not close MC-UI-NW-009.

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

## Frontend handoff

The net-worth URL should resolve an invalid or future `asOf` to the household timezone's today, replace the invalid URL entry, preserve other valid filters, and display an accessible localized explanation. Explicit empty values must be distinguished from absent values so that the former gets an explanation. The date input should expose `max=today`; direct URL and synthetic input changes still need validation before fetching. Dates equal to today and real historical calendar dates must stay untouched. The UI must avoid querying the invalid date or retaining a spinner or generic Retry-only page.

Use i18n entries for the invalid-date and future-date explanations. Cover URL replacement, retained currency, no storage writes, reason persistence, no repeated fetch of the rejected date, and a usable date control in component tests, then confirm real browser/network behavior. No frontend files were edited during this stage.

No commit, push, or deployment was performed. The existing modified implementation plan and prior acceptance evidence were preserved.
