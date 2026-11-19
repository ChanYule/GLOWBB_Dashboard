# Programme & Outreach Dashboard

**Staff experience update — 19 November 2026:** Compact shared layouts, question-led participation controls, contextual needs reviews, Centre Overview tabs, focused management reports and scoped summary reuse. [Page/chart audit, measured performance, test results and visual-verification limits](docs/REDESIGN-2026-11-19.md). No new migration is required for this redesign; existing centre and SPPB prerequisites remain.

**SPPB Assessments:** Supplementary Member ID-linked assessment histories, protected unmatched staging, scoring validation, reviewed reassessment follow-up and Excel/print exports now sit within the existing four-centre platform. See the [SPPB staff and deployment guide](docs/SPPB-ASSESSMENTS.md). PostgreSQL adds shared control-plane **migration 007**; existing members and attendance are preserved. Source scoring remains pending until organisational approval.

**Larger imports:** XLSX/CSV imports now support files up to **20 MB**. Large files upload in small requests before the normal preview and confirmation. Deploy frontend and backend together; no new SQL is required. Existing row-count and workbook-expansion checks remain.

**Attendance import fix:** Full Tzu Chi SEEN location labels now route by physical location, while Activity Name determines GLOW or SEEN, including verified GLOW_ names. [Source reconciliation and staff import guide](docs/CENTRE-IMPORT-ALIASES.md). No new SQL migration beyond 006.

**Multi-centre upgrade:** GLOW Bukit Batok, SEEN Bukit Batok, GLOW Nanyang and SEEN Nanyang now share one staff platform. Start with the [multi-centre setup and staff guide](docs/MULTI-CENTRE.md) for migration 006, staff grants, reviewed historical allocation, centre registries and hosting requirements. The dashboard opens directly without sign-in. Older release notes below describe earlier versions and their former setup.

> **Client outreach priorities:** Full-registry age profiles and block-level gaps for young seniors, minority seniors, seniors living alone and previously attending inactive clients, with recorded working status and existing reviewed follow-up. [Staff workflow, source counts and validation](docs/OUTREACH-PRIORITIES.md). No additional SQL migration is required.

> **Participation analysis fix and compact interface:** Compatible populations/metrics, repaired legacy preferences, a compact analysis selector and side-by-side comparison/ranking panels. [Diagnosis, population definitions, staff workflow and validation](docs/PARTICIPATION-REDESIGN.md). No additional SQL migration is required.

> **AAP Domain & Event Types:** Import the new 14-column attendance export, review session classifications and administrator mappings, and compare programme mix, reach and repeat engagement in Programme Analysis and Participation Patterns. Management summaries and PDF reports are integrated. [Staff guide, definitions, data model and validation](docs/EVENT-TYPES.md). This upgrade requires **no additional SQL migration** beyond the existing application setup.

> **Location & Distance:** Reviewed building locations, cached walking routes, participation comparisons and proposed follow-ups are integrated into Participation Patterns and Client Engagement. [Setup, definitions, privacy and validation](docs/LOCATION-PARTICIPATION.md). This upgrade adds private storage in **migration 005**; earlier release notes below describe their own SQL requirements.

> **Participation Patterns & Insights:** Compare participant groups, programme reach and repeat engagement under **Staff Tools**. [Staff guide, definitions, privacy and validation](docs/PARTICIPATION-PATTERNS.md). That release did not require an additional SQL migration.

> **Simpler staff interface:** [Three main pages: Main Dashboard, Programme Analysis and Planning](docs/SIMPLE-STAFF-GUIDE.md). Occasional tools are under **Staff Tools**. Existing records and import safeguards are preserved. No additional SQL is required.

> **Client registry integration:** [Linked client participation, safe registry imports, follow-up, source validation and staff guide](docs/CLIENT-REGISTRY-INTEGRATION.md). Client Engagement extends the existing three-level dashboard. No additional SQL is needed after migrations 001 through 004.

> **Data management update:** Review imports, delete selected attendance or reset programme data, and recover from automatic backups. Secondary reports are under **Staff Tools**; mobile navigation opens through **Menu**. [Staff guide](docs/DATA-MANAGEMENT.md). No new SQL migration is required beyond 001 through 004.

> **Latest 13-column needs-based upgrade:** [Features, actual workbook reconciliation, migration 004 and staff workflows](docs/NEEDS-BASED-UPGRADE.md). The three analysis levels, profile/feedback collection, registry attestations and action tracking extend the existing dashboard.

> **3 November 2026 upgrade:** See [the upgrade guide](docs/UPGRADE-2026-11-03.md) for safe merge imports, social risk mappings, staff sign-in, personal dashboard views, migration 003 and current limitations. Older delivery notes describe previous releases.

﻿# GLOW Bukit Batok · Programme Impact & Outreach

A local full-stack staff application built in the supplied empty repository. No prior application, database, API, routes, authentication, design system or attendance features existed to preserve or integrate. No reference attendance workbook was attached. The dashboard starts empty and contains no fabricated statistics.

For the existing Vercel deployment, follow [Vercel + Supabase setup](docs/HOSTING.md). The hosted API uses Supabase PostgreSQL when `DATABASE_URL` is set; local development continues to support SQLite. A Vite static build alone does not deploy a database.

See the [dashboard redesign and analytics handoff](docs/REDESIGN.md) for metric definitions, chart purposes, automated insight rules, validation and remaining browser checks. An isolated synthetic preview is available with `node scripts/preview-redesign.mjs` after building; it never opens the real database.

The integrated **Operations & Screening** view adds all-age participation, IB clients/OB non-clients, configurable inactivity, reported monthly SPPB/Tanita totals, staff targets and aggregate CSV reporting. See [operations definitions and import instructions](docs/OPERATIONS.md). Assessment unique-person/eligibility metrics remain unavailable when only monthly totals exist.

## Run on Windows

Requires Node.js 24.14 or later (uses the built-in SQLite API) and npm.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:3000. The dashboard opens directly without sign-in, using one shared workspace with access to all four centres. See the multi-centre guide above.

```powershell
npm.cmd run build
npm.cmd start
```

The production server serves the built React app and API together. Default binding is loopback only. `PORT`, `HOST`, `DB_PATH` and `APP_ORIGIN` are supported. Login has been removed; anyone who can reach the application can view and change its data. The default loopback binding limits access to this computer. Do not put the database or a backup in a public web directory. No deployment was performed.

## Import the attendance workbook

1. Select **Import attendance**.
2. Choose `.xlsx` or UTF-8 `.csv`, up to 20 MB and 100,000 attendance rows. `.xls` is not supported. XLSX expanded contents are limited to 64 MB. Export formula cells as values first.
3. Put these exact headers in row 1, in any order, on exactly one worksheet:

   `Name/Member ID`, `Gender`, `Name/Age`, `Name/Race`, `Name/CFS`, `Is Client`, `Within Boundary`, `Activity Name`, `AAP Domain`, `Session Detail`.

4. Session Detail must use e.g. `2026-05-04, 09:00 AM - 09:45 AM`. Dates and times are Singapore local wall time. Overnight ranges are rejected rather than guessed. YES/NO, TRUE/FALSE, Y/N and 1/0 are accepted status values; other values remain unknown.
5. Preview counts, timing, row errors, demographic warnings and possible naming variants. Download the full row issue report if needed. Nothing has been written yet.
6. Review the checkbox and confirm **ready rows only**. Invalid and conflicting rows are skipped; duplicate rows are not reinserted. Previews expire after 20 minutes and are stored in the database across restarts. Dashboard values refresh from the configured database. Hosted uploads must be under 4 MB; local SQLite uploads retain the 8 MB limit.

Programme identity uses the exact trimmed programme name (case and punctuation remain significant). Similar names are flagged but not merged. Session identity includes programme, date, start and end, with absent venue represented explicitly in its key. Attendance identity includes participant and session. Separate same-day sessions remain distinct. Source session notation and import ID are retained on attendance.

Member identifiers are SHA-256 pseudonyms: raw identifiers and original workbooks are not retained. Pseudonyms remain personal data, not anonymous data. Preserve original identifiers in your approved source system to ensure repeat-import matching. Existing accepted member demographics and programme domain win; rows with conflicting details (including age changes) are flagged and skipped, including conflicts on duplicate attendance. Correct/reconcile in the source before reimporting; there is no destructive overwrite or merge tool. Missing age is accepted but excluded from senior metrics; invalid age is rejected. UNKNOWN race and missing race are stored as separate categories. CFS is retained without medical interpretation.

The import preview includes the supplied reference checks: 3,101 raw rows, 385 all-age people, 364 seniors, 84 male seniors, 18 minority seniors, 2 UNKNOWN-race seniors, 110 programmes, 1 exact duplicate, 4 May–26 October 2026. These are comparison constants only. **The exact workbook must still be supplied and validated**; no assertion that these totals match is made. Reference diagnostics use current definitions and dates observed up to today.

## Use the dashboard

- **Overview:** distinct senior reach, male/minority counts and known-demographic percentages, deduplicated attendance (all ages), monthly/weekly/quarterly trends, programme rankings, first-observed/returning and repeat engagement, domain reach and evidence-based insights.
- **Programme Performance:** search and rank programmes; open a programme for session timing, attendance trend, average attendance, senior subgroups and evidence limits. A single observed session is not assumed to be the programme’s only intended delivery.
- **Audience & Outreach:** gender/race, configured age bands, client/boundary status, frequency and weekday/time-of-day comparisons. Timing is descriptive. Venue and living-arrangement charts are unavailable because these fields were not supplied.
- **Planning & Recommendations:** review transparent Expand/Maintain/Improve/Review prompts; configure targets to identify Pilot opportunities. Switch the 3/6-month discussion sequence. Save a planning status and resource assumptions for a programme or target-led pilot. No programme or attendance is automatically changed. Target progress always uses that target’s own dates/programme scope; global dashboard filters do not redefine goals.
- **Data & settings**: data quality, import history, audit events, senior threshold, minority categories, age-band boundaries and evidence thresholds. Changes recalculate metrics and targets without rewriting attendance.
- Global reporting period, domain, programme and audience filters affect all applicable observed charts, programme comparisons and programme recommendations. More filters expands age, gender, race, client and boundary choices. Reset restores available history. Target-driven opportunities explicitly retain the target’s own scope.
- **Export report:** filtered aggregate programme CSV or a print-friendly HTML summary; use the browser’s Print → Save as PDF. Reporting period, observed trends, findings, recommendations and limitations are included. Audience-filtered shared exports are blocked. Shared exports omit all demographic breakdowns and staff notes, rather than selectively releasing small demographic cells. Internal dashboards display small counts with cautions.

## Calculation and recommendation rules

Distinct Member IDs across the whole selected period determine overall reach: never sum monthly or programme counts. Age is the accepted recorded age (no birth dates are supplied). Default senior age is 60; default minority categories are MALAY, INDIAN and OTHERS. Known-gender denominator includes MALE and FEMALE; known-race denominator excludes UNKNOWN and MISSING. Missing demographics do not remove seniors from overall reach. Missing age prevents age eligibility being established.

Attendance entries and average attendance/session include all ages. Senior frequency uses senior attendance entries divided by unique seniors. Repeat participation means 2+ distinct sessions in the selected scope. Frequency categories are once (1), occasionally (2–4), frequently (5+). First observed uses the participant’s earliest attendance in the full available dataset, before applying programme/demographic/date filters. It does not establish a new centre client. Future-dated sessions are stored but excluded from delivered-attendance metrics until their calendar date; no end-of-day or real-time delivery confirmation is inferred.

Trend periods with no recorded attendance within the reporting range show zero, meaning zero in available records, not confirmed no delivery. Current month/week/quarter is marked in progress. Comparison KPIs use an immediately preceding equal-duration period only when imported history extends to its start. Current-period comparisons use elapsed days. Full-history default has no implied previous comparison. Imported history may be incomplete.

Sufficient programme evidence requires at least 3 sessions and 5 seniors by default (configurable upward). Nonzero senior reach below either threshold is Limited; no senior reach is Insufficient. These programmes are **Review**, not hidden. With sufficient evidence: a decline over 25% between the last two complete observed months, each with enough sessions, prompts **Improve**; reaching at least 25% of selected unique seniors prompts **Expand**; otherwise **Maintain**. No impact score or causal claim is made. **Pilot** prompts arise only from an explicitly configured target with a remaining gap, and do not invent a new programme or forecast. Use participant feedback, staff hours and resources before approving actions.

## Storage, migrations, access and backup

- `server/db.js` applies additive schema version 1 on startup using `CREATE TABLE IF NOT EXISTS` and non-destructive initial settings. It does not reset existing data. No separate manual SQL migration is required for this new database.
- Tables: participants, programmes, sessions, attendance, imports, settings, targets, decisions, opportunity_decisions, audit, users, logins, schema_version, import_previews. Foreign keys enforce relationships. Imports run in a transaction. Participant details and programme/session optional JSON fields reserve future extension without making missing optional data invalid.
- Default persistent database: `data/glowbb.sqlite` (ignored by Git). Existing data survives ordinary restarts. The built-in SQLite API is documented at https://nodejs.org/api/sqlite.html.
- Hosted database: apply `supabase/migrations/001_dashboard.sql` in a new Supabase project and configure the server-only `DATABASE_URL`. The private `glowbb` schema is not accessed through the browser Data API. See [hosting setup](docs/HOSTING.md) for connection pooling, credentials, deployment and verification. The schema migration does not transfer existing SQLite data.
- Sign-in is temporarily disabled by default in development and production. Set `DASHBOARD_AUTH=1` to restore staff sign-in. Direct access uses the shared workspace administrator; existing accounts remain saved. Same-origin mutation checks remain.
- Audits record imports, definitions, target and planning changes under a persistent Local workspace actor. This is a technical audit identity, not an authenticated person. No participant IDs or free-text notes are written to audit output/logs.
- For SQLite, stop the server before a filesystem backup and copy the complete `data` directory (including any SQLite WAL/SHM files) to approved encrypted storage. Restore with the server stopped. Supabase needs its own project backups; a SQLite backup does not include hosted data. Apply organisation-approved access, encryption, retention and backup schedules. Import previews store parsed pseudonymised rows, expire after 20 minutes, and are deleted on confirmation, cancellation or cleanup at the next preview upload. See the hosting guide for scheduled cleanup independent of traffic. Uploaded source buffers are discarded after parsing. Downloaded row reports are staff data and should follow the same retention rules.

Future optional fields reserved in the JSON extension contract: preferredLanguage, livingArrangement, referralSource, interests, accessibilityNeeds, transportBarriers, firstRegistrationDate; venue, theme, capacity, cost, staffHours, registrationCount, waitingListCount, objectives, feedback, outreachMethod. They are not populated or editable in this release because the source data contains none of these values and there is no existing profile/calendar system to connect. Costs or capacity efficiencies must not be inferred from attendance. A future integration must use stable participant/programme/session IDs, authorised write validation and migrations before presenting those metrics.

## Verify

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd audit
```

See [delivery and QA notes](docs/DELIVERY.md) for actual results and limits. Main implementation: `server/domain.js` (parsing/analytics), `server/db.js` (persistence), `server/app.js` (local workspace API), `server/index.js` (app server), `src/main.tsx` / `src/types.ts` / `src/styles.css` (dashboard), `tests` (automated checks). Existing attendance and planning data are preserved.

See [the 4 November redesign report and staff guide](docs/REDESIGN-REPORT.md) for the five main workspaces, Presentation View, performance evidence, registry header compatibility and production access configuration.

See [performance hardening and verification](docs/PERFORMANCE-HARDENING.md) for faster database reads, bulk merges, deletion/recovery and debounced filtering/search.

See [Main Dashboard and Client Engagement](docs/MAIN-DASHBOARD.md) for the daily/monthly summary, client IB/OB definitions and the all-history two-programme inactive measure.

See [Dashboard & Data Configuration](docs/CONFIGURATION-CENTRE.md) for reviewed activity exclusions, reporting versions, management report presets, permissions and disconnected CaritaHub draft settings.
