# Programme operations and monthly health reporting

## Open the integrated view

Select **Operations & Screening** in the existing dashboard navigation. It contains participation/outreach, Health Screening Overview, and the operational report. The existing overview, programme details, planning, attendance imports, definitions and reports remain available. The operational view loads on demand to keep the existing pages lightweight.

The user's confirmed definitions are **IB = clients** and **OB = non-clients**. These use the stored `Is Client` status. `Within Boundary` remains a separate service-boundary filter and is never substituted for client status.

All new operational participation metrics use **all ages**. Existing senior KPI cards retain their existing age threshold and known-demographic denominators.

## Statistics and definitions

- Programme types conducted: distinct programme identifiers with recorded attendance. Sessions are counted separately, rather than assuming the spreadsheet's programme total means one or the other.
- Attendance: deduplicated participant/session records. Unique participants: distinct identifiers across the entire selected interval. Daily and monthly unique counts are never summed to create a larger-period unique count.
- Average attendance: all-age attendance entries / distinct recorded sessions.
- IB/OB: selected unique participants with accepted client status true/false. Unknown client status remains separate. IB, OB and male percentages use **all selected unique participants**, including unknown values. IB/OB therefore sum to 100% only when everyone has known client status.
- First observed participants: first recorded attendance anywhere in the available dataset occurs during the interval, before applying programme or demographic filters. This does not establish a first-ever centre client. New IB/OB uses the same rule plus client status.
- Previously recorded participants: selected participants first recorded before the interval. Repeat participation is different: two or more distinct sessions inside the interval. Repeat rate uses all-age unique participants as its denominator.

The client status is the accepted participant attribute in the existing model, not a dated history of client-status changes. Missing history, source demographic conflicts and changing membership must still be reconciled through the existing source process.

## Monthly SPPB and Tanita totals

The user confirmed that assessments are available as **monthly totals only**. The implementation does not create participant assessment histories or infer individual completion from those totals.

In **Health Screening Overview → Record monthly totals**, enter the report month, reported-as-of date, SPPB and/or Tanita completed-assessment counts. Blank means unavailable; zero means the report confirms zero. Mark a month final only after the month has ended and staff have verified the totals.

Both assessment cards show the known reported total, number of months represented, and the current month's total when it is included in the selection. Unique people assessed, repeat assessments, both/neither assessments, eligibility coverage, scores and overdue screening status remain unavailable. No clinical interpretation or invented eligibility rule is supplied.

The grouped assessment chart compares monthly totals. Counts are not divided among days or weeks. Historical months cut by a date selection are not allocated to that partial period. A current month-to-date report may be displayed when the selection starts by the month's first day and extends through today. Missing months stay unavailable. Yearly assessment totals sum known selected monthly reports and can be incomplete; coverage is disclosed rather than treating absent reports as zero.

Programme, domain and audience filters cannot segment a workspace-wide monthly assessment report. Assessment totals are unavailable under those filters; reset them to see the totals. The source ledger is explicitly labelled as workspace reporting history.

### Excel and CSV import

Download the header-only [monthly template](../public/assessment-monthly-template.csv). CSV and XLSX are supported with these headers:

| Column         | Accepted value                                            |
| -------------- | --------------------------------------------------------- |
| Month          | `YYYY-MM`                                                 |
| SPPB           | Whole completed-assessment count, or blank if unavailable |
| Tanita         | Whole completed-assessment count, or blank if unavailable |
| Reported As Of | `YYYY-MM-DD`, no later than today                         |
| Final          | `YES` or `NO`                                             |

Use values, not formulas, with at most 500 monthly rows and one matching worksheet. Hosted files must be smaller than 4 MB. Preview, review warnings and confirm; no assessment counts are saved during preview. Preview metadata is temporarily stored using the existing preview expiry/cancellation mechanism.

If optional `Unique Participants`, `IB`, `OB`, `Male`, `IB %`, `OB %` and `Male %` columns are present, inconsistent percentages or IB+OB counts are flagged. These participation figures are **not imported** and cannot overwrite attendance-derived metrics. Overall/daily totals cannot masquerade as monthly records because Month must be a calendar month.

The exact source workbook was not attached to this request. Its original layout, merged cells, source percentages and historical totals have not been independently verified. The tested import contract is the template above; no claim is made that an unspecified report layout imports unchanged.

### Revision history

Changing an existing assessment total requires confirming a revision. The new report is appended; previous entries remain stored and can be viewed under **View retained reporting revisions**. The latest reporting date and revision determine the current monthly total. Reimporting the same record does not double-count it or restore an older revision. A revision cannot predate the current report; use a current reporting date to correct an earlier figure.

Monthly writes, audit output and preview consumption are atomic on SQLite and PostgreSQL. The attendance-confirmation endpoint rejects assessment previews, and assessment confirmation rejects attendance previews.

## Inactivity and reactivation

No organisational inactivity threshold was supplied. Inactivity figures are therefore unavailable until authorised staff choose **Configure inactivity definition** and enter an approved number of calendar days. Leave it blank to disable the calculation. There is no automatic default.

At the end of a reporting date, a person is inactive when at least the configured number of days have elapsed since their last matching recorded attendance. A later attendance is a reactivation only after at least one inactive calendar day. Returning exactly on the threshold date does not invent a prior inactive day.

Inactive count is a snapshot at the period end, among people observed in matching historical attendance. Newly inactive and reactivated counts are distinct people with those transitions during the period. One person may transition in several months but is counted once in an overall selected interval; monthly transition counts must not be summed to get overall unique people.

These figures describe the observed attendance cohort, not every registered participant or people who never attended. Programme/domain/audience filters limit matching history, so the inactivity scope changes with those filters. Attendance outside the available records is unknown. No medical urgency or diagnosis is inferred.

## Reports, attention items and insights

The operational report switches between day, week, month and year. Weekly view provides programme types, sessions, attendance, unique participants and attendance per session. IB/OB/male, first-observed IB/OB, inactivity snapshots and transitions remain available where the required records/definition exist. The table is paginated and scrolls within its panel on narrow screens.

Charts include monthly first-observed/previously recorded participants, IB/OB counts with percentage tooltips, male counts/shares, configured inactivity/reactivation, and grouped SPPB/Tanita totals. Charts show the latest six selected months for readability; their accessible figure tables contain the full selected series. Unavailable assessment values are distinct from zero.

Staff Attention Required flags observed inactivity, missing demographic fields, missing monthly assessment reporting and existing evidence-qualified programme decline recommendations. Demographic field-issue counts may overlap on the same participant and are labelled accordingly. Programme items open the existing programme detail view. No personal participant records, medical scores or fabricated follow-up schedules are exposed.

Assessment observations compare adjacent final reports independently for each assessment type. No comparison is made across missing, non-adjacent, provisional or partially selected months. Male trend observations require three adjacent full selected months with the configured participant/session sample thresholds. Inactivity comparisons require the approved definition, sufficient recorded lookback and an adequate number of observed transitions. Observations provide actual counts, periods and a supporting report/ledger link without claiming causation.

Operational CSV export preserves the application's existing shared-report privacy rules: audience-filtered exports are blocked, demographic breakdown columns and notes are omitted, and no participant identifiers are exported. This CSV is a shareable aggregate summary, rather than a reproduction of the full internal demographic table. XLSX export was not added; XLSX **import** is supported and tested.

## Staff-defined targets

Staff may enter monthly targets for all-age unique participants, male participants, IB clients, OB non-clients, first-observed participants, SPPB and Tanita assessments. No arbitrary targets are generated. Progress always uses each target's month and workspace-wide scope, independently of current dashboard filters. Unknown assessment actuals or future target months show unavailable progress rather than fake zeros. Missing/provisional reports remain limitations; a shortfall is not programme failure.

These operational targets are separate from the existing senior programme-planning targets so a health-assessment target cannot generate an inappropriate programme-pilot recommendation.

## Storage and deployment

Added `assessment_monthly`, `operational_settings` and `operational_targets`, with additive schema version 2. On first access, the operational route applies the migration transactionally when the existing database account has the required table-creation permissions. Subsequent function instances check the version and skip DDL. PostgreSQL uses a transaction-scoped lock and rolls back failed setup before reusing a connection. SQLite changes are also transactional. Existing attendance, participants, definitions and planning data are not reset or rewritten.

The Supabase migration is [002_operations.sql](../supabase/migrations/002_operations.sql). It retains the private schema, RLS and denied browser-role access. Vercel includes this file in the server bundle alongside the public CA certificate; no new environment variables are required. With a deliberately restricted database account, apply the migration once through an authorised database administrator. After migration, `/api/ready` reports schema version 2. Do not rerun onboarding or re-enter attendance.

No production data, cloud setting or deployment was changed during implementation. The application's pre-existing absence of per-person authentication is unchanged; no personal health-record access was added.

## Validation

The regression suite covers existing analytics/imports/filters/planning/report privacy and the new client-status mapping, percentage denominators, monthly/weekly/yearly deduplication, inactivity boundaries, unknown versus zero assessments, date filters, CSV/XLSX parsing, formula rejection, revision idempotence, preview-kind isolation, staff controls, operational navigation with empty attendance, aggregate export and SQLite/PostgreSQL migration/transaction rollback. Final execution results are recorded in the delivery note.

Actual results: all 62 tests passed in the full regression run. After the migration-version fast path, all 13 focused operational/PostgreSQL tests passed. Final TypeScript, ESLint, `git diff --check` and the production build passed. The operational UI is a separate lazy-loaded bundle (8.42 KB compressed JavaScript and 1.55 KB compressed CSS). A synthetic calculation check with 50,000 attendance records produced a six-month report with configured inactivity in 211 ms in this environment; this is not a live-server latency guarantee.

Responsive layouts and contained chart/table scrolling are implemented. Automated DOM interaction tests do not verify actual viewport layout. Browser visual acceptance remains pending because this session exposes no browser surface. The original reporting workbook and any real screening schedules/eligibility definitions remain unavailable.
