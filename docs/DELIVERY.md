# Delivery and quality assurance · 26 October 2026

Built in the user-confirmed empty `GLOWBB_Dashboard` repository. No existing application or data was overwritten. The resulting application uses React/TypeScript, Vite, Express and persistent SQLite. No hosted Site or external account was created.

## Included

- Four dashboard sections, global and advanced filters, aggregate KPI cards, trends, programme rankings/details, audience/domain/timing/frequency comparisons and contextual insights.
- Excel/CSV preview, explicit confirmation, row error download, strict session parsing, stable pseudonymous participants, recurring programme/session identity, exact and attendance duplicate detection, idempotent imports, naming variation flags, conflict skips and import audit history.
- Configurable senior age, minority categories, age bands and evidence thresholds; staff-defined goals with scoped achievement and remaining gaps; transparent programme recommendations and target-led pilot prompts; persistent planning statuses and notes; 3/6-month discussion sequence without invented forecasts.
- Staff accounts and admin/planner/viewer permissions enforced in the API; authenticated aggregate CSV and print/PDF reports; demographic-filter restrictions on shared exports, omission of demographic breakdowns and notes, CSV formula protection and HTML escaping.
- Additive startup schema version 1 with related participants, programmes, sessions and attendance, plus staff sessions, imports, definitions, targets, programme/pilot decisions and audit tables. No manual migration is required for a new database. The `data` directory persists between starts and is excluded from source control.

## Verification actually run

| Check                                                                      | Result                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Automated parser, analytics, persistence, API/security and component suite | 23 tests passed, 0 failed                                                              |
| ESLint (JavaScript and TypeScript, React hook rules)                       | Passed                                                                                 |
| TypeScript strict type check                                               | Passed                                                                                 |
| Vite production build                                                      | Passed                                                                                 |
| npm dependency audit                                                       | 0 known vulnerabilities                                                                |
| Production HTTP smoke check                                                | App and JavaScript 200; unauthenticated analytics 401; content security policy present |

Tests cover XLSX and quoted CSV, exact headers, formula rejection, invalid files, noon/midnight and invalid dates/times, senior eligibility, missing/UNKNOWN race separation, known-demographic denominators, repeated attendees across programmes/months, separate same-day sessions, duplicate imports, conflicting demographics including duplicate identities, naming variants, filters across applicable aggregates, first observation, partial periods, zero months, future dates, empty data, programme rankings, limited samples, all implemented programme recommendation categories, incomplete-month comparison restrictions, equal-duration previous periods, actual SQLite file reopening, permission/origin checks, review before persistence, target scope, programme/pilot decisions, export restrictions/escaping, chart selection, search, filter reset, role-specific UI and empty-data planning.

Component tests use jsdom. They do not measure rendered CSS geometry, browser-native dialog focus trapping, physical touch, print pagination or actual screen-reader behavior. The browser tool returned no available browsers. No live visual or device checks were performed at 1366, 1024, 768 or mobile widths. Responsive layouts and native modal dialogs are implemented, but their live behavior still needs browser verification.

## Remaining verification and data limits

- The reference workbook was not attached. Its expected figures are shown as import validation checks; the exact 3,101-row dataset and expected totals remain unverified. Do not use those constants as dashboard statistics.
- No supplied venue, cost, capacity, language, satisfaction, living-arrangement, registration history or organisational reference population exists. These metrics are not fabricated. Optional JSON extension fields are reserved, with no optional-field editing workflow in this release.
- Participant demographics use first accepted source details. Conflicts, including age changes, are skipped and require source reconciliation; there is no destructive demographic update or programme-merge feature. Preview reports give row numbers and source-neutral explanations, not raw member identifiers.
- There is no full centre history, zero-attendance calendar feed, existing staff-task system or external sign-in system in this starting repository. First observed is not new to the centre; recorded sessions are sessions with attendance, not all scheduled sessions. No staff-task owner assignment is offered.
- Shared exports intentionally omit every demographic breakdown and staff note. Staff dashboards include small counts for authorised analysis, with explicit sample-size cautions. Apply local policy when sharing or printing an internal screen.
- Confirm the organisation’s approved access, retention, backup, encryption and hosting policies before using personal data outside the local staff workstation. No such policies were supplied. No deployment, organisational policy review or real-device rehearsal was performed.

## Staff handoff

See [README](../README.md) for Node requirements, initial staff account setup, roles, running locally, exact import headers and preview steps, dashboard operation, settings, target configuration, evidence rules and backup/restore instructions.

For browser acceptance, use synthetic/test records in a separate `DB_PATH`, then check all four tabs at 1366, 1024, 768 and 390 px; keyboard navigation/dialog close and focus return; long names and no page overflow; chart controls and readable values; preview/cancel/confirm/reimport; denied viewer changes; filtered report privacy; and browser Print → Save as PDF. These are outstanding manual checks, not passed tests.
