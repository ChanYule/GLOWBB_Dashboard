# Delivery and quality assurance · 26 October 2026

Built in the user-confirmed empty `GLOWBB_Dashboard` repository. No existing application or data was overwritten. The resulting application uses React/TypeScript, Vite, Express and persistent SQLite. No hosted Site or external account was created.

The login page and authentication gate were subsequently removed at the user’s request. The dashboard now opens directly with full workspace access. Existing data and historical audit references remain intact; new changes use a Local workspace audit actor. The server still binds to 127.0.0.1 by default.

## Included

- Four dashboard sections, global and advanced filters, aggregate KPI cards, trends, programme rankings/details, audience/domain/timing/frequency comparisons and contextual insights.
- Excel/CSV preview, explicit confirmation, row error download, strict session parsing, stable pseudonymous participants, recurring programme/session identity, exact and attendance duplicate detection, idempotent imports, naming variation flags, conflict skips and import audit history.
- Configurable senior age, minority categories, age bands and evidence thresholds; staff-defined goals with scoped achievement and remaining gaps; transparent programme recommendations and target-led pilot prompts; persistent planning statuses and notes; 3/6-month discussion sequence without invented forecasts.
- Direct dashboard access without a login page or account setup, with aggregate CSV and print/PDF reports; demographic-filter restrictions on shared exports, omission of demographic breakdowns and notes, CSV formula protection and HTML escaping.
- Additive startup schema version 1 with related participants, programmes, sessions and attendance, plus staff sessions, imports, definitions, targets, programme/pilot decisions and audit tables. No manual migration is required for a new database. The `data` directory persists between starts and is excluded from source control.

## Verification actually run

| Check                                                                      | Result                                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Automated parser, analytics, persistence, API/security and component suite | 32 tests passed, 0 failed                                                                                        |
| ESLint (JavaScript and TypeScript, React hook rules)                       | Passed                                                                                                           |
| TypeScript strict type check                                               | Passed                                                                                                           |
| Vite production build                                                      | Passed                                                                                                           |
| npm dependency audit                                                       | 0 known vulnerabilities                                                                                          |
| Production HTTP smoke check                                                | Previous build smoke check; analytics now opens without authentication and is covered by the API regression test |

Tests cover XLSX and quoted CSV, exact headers, formula rejection, invalid files, noon/midnight and invalid dates/times, senior eligibility, missing/UNKNOWN race separation, known-demographic denominators, repeated attendees across programmes/months, separate same-day sessions, duplicate imports, conflicting demographics including duplicate identities, naming variants, filters across applicable aggregates, first observation, partial periods, zero months, future dates, empty data, programme rankings, limited samples, all implemented programme recommendation categories, incomplete-month comparison restrictions, equal-duration previous periods, actual SQLite file reopening, direct access and origin checks, review before persistence, target scope, programme/pilot decisions, export restrictions/escaping, chart selection, search, filter reset, planning components and empty-data planning.

Component tests use jsdom. They do not measure rendered CSS geometry, browser-native dialog focus trapping, physical touch, print pagination or actual screen-reader behavior. The browser tool returned no available browsers. No live visual or device checks were performed at 1366, 1024, 768 or mobile widths. Responsive layouts and native modal dialogs are implemented, but their live behavior still needs browser verification.

## Remaining verification and data limits

- The reference workbook was not attached. Its expected figures are shown as import validation checks; the exact 3,101-row dataset and expected totals remain unverified. Do not use those constants as dashboard statistics.
- No supplied venue, cost, capacity, language, satisfaction, living-arrangement, registration history or organisational reference population exists. These metrics are not fabricated. Optional JSON extension fields are reserved, with no optional-field editing workflow in this release.
- Participant demographics use first accepted source details. Conflicts, including age changes, are skipped and require source reconciliation; there is no destructive demographic update or programme-merge feature. Preview reports give row numbers and source-neutral explanations, not raw member identifiers.
- There is no full centre history, zero-attendance calendar feed, existing staff-task system or external sign-in system in this starting repository. First observed is not new to the centre; recorded sessions are sessions with attendance, not all scheduled sessions. No staff-task owner assignment is offered.
- Shared exports intentionally omit every demographic breakdown and staff note. Staff dashboards include small counts for internal analysis, with explicit sample-size cautions. Apply local policy when sharing or printing an internal screen.
- Confirm the organisation’s approved access, retention, backup, encryption and hosting policies before using personal data outside the local staff workstation. No such policies were supplied. No deployment, organisational policy review or real-device rehearsal was performed.

## Staff handoff

See [README](../README.md) for Node requirements, running locally without account setup, exact import headers and preview steps, dashboard operation, settings, target configuration, evidence rules and backup/restore instructions.

For browser acceptance, use synthetic/test records in a separate `DB_PATH`, then check all four tabs at 1366, 1024, 768 and 390 px; keyboard navigation/dialog close and focus return; long names and no page overflow; chart controls and readable values; preview/cancel/confirm/reimport; direct access to imports and settings; filtered report privacy; and browser Print → Save as PDF. These are outstanding manual checks, not passed tests.

## Vercel hosting repair

Live checks confirmed the homepage returns HTTP 200 while `/api/dashboard` and `/api/quality` return plain-text 404 responses. Added `src/api.ts` for safe response handling, `api/[...path].js` for same-origin forwarding to a persistent backend, `vercel.json`, `render.yaml`, `/api/ready`, and [hosting instructions](HOSTING.md). Proxy/client regression tests cover the reported response, malformed JSON, missing backend configuration, filters, JSON mutations, multipart uploads, CSV/PDF report responses, oversized bodies, redirects and failed connections. All 32 tests pass locally. Provider deployment, persistent-disk restart verification and live end-to-end checks remain outstanding; no backend service has been provisioned.

## Vercel and Supabase preparation — 27 October 2026

The API now runs the Express application directly on Vercel when `DATABASE_URL` is configured. Added a PostgreSQL adapter, a private-schema Supabase migration and database-backed import previews. Import confirmation uses a single transaction, a transaction-scoped lock and bulk inserts; it rechecks conflicts against current records. Local SQLite mode and the previous proxy remain supported. No accounts, cloud resources, environment variables or deployments were changed.

Validation: all 35 tests passed, including three new tests using an embedded PostgreSQL engine for repeatable schema migration, API operations, confirmation across app instances, duplicate imports, planning persistence, exports, expiration and rollback after a forced database failure. ESLint, TypeScript and the Vite production build passed. The build needed the existing approved unsandboxed command because the sandbox blocked a Vite helper process. Dependency installation reported zero vulnerabilities. `git diff --check` passed.

The local database was inspected read-only and contained zero participants, attendance entries, targets and planning decisions. It was not moved or overwritten. Supabase creation, applying the migration, Vercel environment configuration, deployment and live verification remain pending. See [HOSTING.md](HOSTING.md) for those steps and the existing unauthenticated-access limitation.

## Nested API routing repair — 27 October 2026

Read-only checks against production confirmed `/api/ready` returns HTTP 200 with `ready: true` and schema version 1, while `/api/import/preview` returns Vercel's plain-text HTTP 404 before Express. The Supabase connection is working; nested API routing was missing.

Replaced `api/[...path].js` with a static `api/index.js` entry and explicitly rewrote `/api/:path*` to that function. The hosted application regression test now goes through the hosted handler for import preview/confirmation, planning and exports. Updated the dialog to show and check the 4 MB hosted file limit (8 MB on loopback), explain temporary preview storage, and handle platform HTTP 413 responses clearly.

All 38 tests, lint, typecheck, production build and `git diff --check` passed. Tests and build needed approved unsandboxed runs because the sandbox prevented esbuild/Vite helper processes from starting. No cloud configuration, attendance records or deployment were changed. Deploy the updated source, including the new API entry file, then verify a small test import in production.

## Programme operations and health reporting — 28 October 2026

Added the integrated, lazy-loaded Operations & Screening view. The user confirmed IB means clients, OB means non-clients, and screening figures are monthly totals only. Operational metrics therefore use `Is Client` independently of boundary status and all-age unique-person denominators; SPPB/Tanita monthly counts never create individual assessment records or eligibility claims.

Implemented monthly reporting/revision entry, CSV/XLSX preview/confirmation, retained history, configurable inactivity and reactivation, daily/weekly/monthly/yearly operational summaries, demographic/engagement/screening charts, evidence-based observations, staff attention items, monthly staff targets and privacy-restricted aggregate CSV. The schema version 2 migration is additive, transactional and automatic on first operational access with the existing database account's permissions; the SQL is explicitly bundled for Vercel. No new secret or attendance reimport is needed. Individual screening unique counts, assessment overlap, eligibility, clinical scores and overdue status remain unavailable.

Validation: all 62 regression tests passed. A final focused run of 13 operational/PostgreSQL tests passed after the migration-version optimisation, including failed-setup rollback/retry, forced import rollback, preview-kind isolation, no participant creation from totals, deduplication, source-percentage checks and aggregate export privacy. Lint, typecheck, production build and whitespace checks passed. A synthetic 50,000-attendance calculation benchmark completed a six-month operational report with configured inactivity in 211 ms locally. No assertion failures remain.

The original Excel reporting workbook was not supplied; the tested interface is the documented monthly template. No browser surface is connected, so actual responsive visual/console acceptance remains pending. No production records, cloud settings or deployment were changed. See [OPERATIONS.md](OPERATIONS.md) for calculations, limitations, staff use and deployment behavior.

## Screening activity people counts — 28 October 2026

The user clarified the exact activity names: `GLOW - SPPB Assessment` and `GLOW - Tanita Body Measurements`. Added attendance-derived unique people per activity per day/month and across the selected period, combining client statuses without IB/OB breakdown columns. Daily counts are not summed into monthly or period uniques. All ages and missing-age participants are included, active filters remain effective, similar activity names are excluded and future sessions are ignored. The screening view now defaults to this source; manually reported monthly assessment totals and history remain available separately and are never merged with people counts. No schema/data rewrite or reimport is required.

Validation: all 26 operational and UI tests passed, including repeat participation across days/months, exact-name matching, client/non-client inclusion, date filtering, future exclusions, source separation and daily/monthly controls. Typecheck, lint, production build and whitespace checks passed. No production deployment was performed; browser visual checks remain unavailable in this session.

## Actual-workbook screening reconciliation — 28 October 2026

Read the supplied attendance workbook without editing it or printing participant identifiers. The source has `GLOW - Tanita Body Measurement` (singular), while the prior matcher only accepted the user-supplied plural spelling. This reproduced the incorrect zero on a fresh simulated import. Added an explicit singular/plural alias list and made the source spelling the displayed canonical name; source records/programme identities remain unchanged and briefings still do not match.

Independent source counts and the corrected application pipeline agree for every screening day and month: 10 SPPB unique people/10 entries, 23 Tanita unique people/29 entries; Tanita monthly unique counts July 5, August 3, September 7 and October 13. The full workbook parses 3,101 rows, with zero invalid rows, zero demographic conflicts and one exact duplicate skipped on an empty simulated import. The reusable read-only reconciliation script never opens or changes the stored database. This verifies screening counts for the full supplied source, not the current production filter selection or completeness of a separately imported database.
