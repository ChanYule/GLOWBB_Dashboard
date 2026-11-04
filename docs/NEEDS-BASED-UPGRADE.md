# GLOW BB needs-based programme planning upgrade

Release: 3 November 2026. This guide supersedes the earlier upgrade's missing-workbook limitation. The original Excel workbook was read only; it was not rewritten or imported into a saved local/hosted database during development. All import and browser verification used isolated in-memory databases. Staff retain the review-before-confirm import workflow.

Temporary access update: staff sign-in is disabled by default in development and production. Access uses the shared workspace administrator. Existing accounts and history are retained; set `DASHBOARD_AUTH=1` to restore sign-in. If an existing hosting environment has that variable set to `1`, change it to `0` and redeploy/restart. For a single copy-paste Supabase setup, run `supabase/setup-through-004.sql`, which combines migrations 001–004 in order and preserves existing records.

Latest interface update: use **Data management** for imports, definitions, deletion and recovery. Secondary reports are grouped under **More analysis tools**; phone navigation opens through **Menu**. See [Managing and deleting saved data](DATA-MANAGEMENT.md).

Latest client integration: [Client registry and attendance integration](CLIENT-REGISTRY-INTEGRATION.md) adds the supplied ten-column client workbook, population-based engagement, authorised follow-up and shared client views. Source limitations below describe the earlier release where no registry had yet been supplied.

## Source reconciliation

The supplied `member_attendances_20261103110958.xlsx` matches the reference figures through independent raw-row aggregation and application parsing:

| Measure                                      |         Verified result |
| -------------------------------------------- | ----------------------: |
| Raw attendance rows                          |                   3,344 |
| Exact duplicate rows                         |                       1 |
| Attendance after identity deduplication      |                   3,343 |
| Unique Member IDs                            |                     405 |
| Unique seniors aged 60+                      |                     382 |
| Unique male seniors aged 60+                 |                      86 |
| Distinct programme names                     |                     116 |
| Distinct programme/date/start/end sessions   |                     351 |
| Earliest / latest attendance                 | 4 May / 3 November 2026 |
| Participant raw SRF `0` / `1` / `>1` / blank |        328 / 9 / 2 / 66 |
| Participants with blank living arrangement   |                     223 |
| Participants with blank marital status       |                       8 |

No conflicting participant values were found within this workbook. All 3,344 rows parsed without validation failures. Reimporting the workbook into the isolated database added zero attendance records.

| Original AAP domain      | Distinct sessions |
| ------------------------ | ----------------: |
| Learning                 |               111 |
| Physical                 |                98 |
| Cognitive                |                60 |
| Social                   |                42 |
| Social – Communal Dining |                 8 |
| Others                   |                26 |
| Volunteerism             |                 6 |

These are reference checks for this particular workbook, not production values. `scripts/reconcile-needs.mjs <workbook>` repeats the read-only reconciliation without printing Member IDs. The automated reference test can use `NEEDS_REFERENCE_WORKBOOK`; it explicitly skips only when the source is absent on another host.

**Denominators matter:** without a complete registry, profile completeness uses all known/imported profiles, initially 405. When a complete registry is attested, needs/quality summaries use its eligible population and label that scope. Senior outreach uses 382 participating seniors. The workbook records 39 people living alone across all ages, including 37 seniors; blank living arrangement is 223 across all ages and 209 among seniors. These are participating people, not evidence of the centre's entire membership. Main minority statistics continue to use the existing configurable mapping; monthly/domain unique counts are never added to obtain overall reach.

## Existing architecture and preservation

The existing React/TypeScript/Vite frontend, Express API, SQLite database, private-schema PostgreSQL/Supabase adapter, authenticated administrator/planner/viewer roles, ExcelJS/CSV parsing, programme analytics, comparisons, timing analysis, planning decisions, targets, personal views and operational/screening reports were extended. No replacement framework, paid AI service or additional runtime dependency was introduced.

There was no verified member registry, participant needs/feedback collection system or ActivityHub scheduling integration in this checkout. The new structures provide those local evidence/collection workflows without claiming that an external integration exists. Existing operational inactivity logic and its own configured threshold remain intact; the new observed-engagement bands are labelled separately.

Existing uncommitted changes were retained. No hosted database, migration or deployment was changed. No attendance history was deleted. The source workbook remained unchanged.

## The three analysis levels

- **Who Are We Serving?** Participant KPIs, optional demographic overview, age distribution including below-60s, recorded CFS, living arrangement, marital status, stated interests, support needs and preferences. Protected profile distributions use registered seniors when a complete registry is attested; otherwise they use seniors observed in attendance, with that scope labelled. A dedicated living-alone indicator uses the raw recorded value and never implies loneliness. Other demographic distributions use seniors, with their denominators shown.
- **Gaps and Participation Barriers:** Recorded engagement bands, membership limitations, six reported-barrier themes, separate staff observations/unconfirmed hypotheses, needs coverage and missing information. Small participation counts are not automatically described as underserved. A registry, target, expressed demand or approved benchmark is needed for that conclusion.
- **Programme Planning and Actions:** Findings, possible explanations and recommended actions are presented separately, with evidence, target group, priority and next step. Staff create and approve actions; nothing automatically schedules, excludes, cancels or sends outreach.

**Management Overview** links all three levels and retains customisable cards/charts, with concise information-gap findings. Programme Performance, Audience & Outreach, the existing Planning & Recommendations, Operations & Screening and Social Risk Analysis remain available. Programme Alignment, Explore the Data and Data Quality and Administration provide secondary tools. Chart editing controls are revealed through customisation; the normal overview is simpler.

## Import the workbook safely

1. Open **Import attendance** and choose **Merge and Update Existing Records**.
2. Select the supplied workbook and choose **Preview import**.
3. Review existing matches, new attendance, duplicates, profile enrichments, missing fields, conflicts and resulting counts. Staff-reviewed overrides are flagged separately and remain current until reviewed in the participant profile.
4. Confirm only after checking the preview. A smaller file never triggers replacement automatically.

Ten-column, eleven-column SRF and thirteen-column living/marital exports remain supported. Member IDs use the existing stable hash for matching. Session identity remains exact programme name + date + both times. Optional living/marital values are retained as `livingRaw`/`maritalRaw`. Blanks do not erase completed values. Raw social codes, including `0` and `>1`, are never split or interpreted automatically. Optional language, registration and assessment-date headers have reserved supported fields; new arbitrary columns are not silently interpreted as clinical data.

Distinct raw profile observations are stored separately from mappings and staff reviews. They record when a value was imported, not the participant's status on an old attendance date. Explicit effective/assessment dates are retained when supplied. Old attendance is not used to invent historical health or living changes.

The existing Full Replacement mode still requires explicit administrator confirmation and a transactional backup. It replaces attendance only and retains profiles, settings and staff decisions. Use it only with a reviewed complete replacement; Merge is the appropriate mode for the supplied export.

## Participant profiles and voluntary feedback

Open **Participant profile & feedback** from a needs page and enter the exact Member ID. There is no identifiable participant directory or individual risk ranking in the general dashboard. Lookup/profile views are audited. Raw Member IDs are not retained in general analytics or chart tooltips.

The eight tabs are:

1. Basic Information: imported demographics plus optional separately reviewed corrections, preferred language and verified registration date.
2. Health and Functional Profile: original CFS, assessment date when known, approved source category and programme-support considerations. No medical condition or suitability is inferred.
3. Social and Living Circumstances: original living/marital/SRF values plus voluntary social-contact/practical-support/joining preferences. Correct imported raw circumstances through a reviewed source import.
4. Care and Support Needs: multiple support categories with Reported, Assessed, Not present, Not assessed or Unknown states, source, optional date and relevant support details.
5. Interests and Programme Preferences: multiple explicitly stated interests, days/times, languages, formats, requested activities and volunteered reasons. Attendance never populates an interest automatically.
6. Participation History: actual programme records, counts, first-observed and last attendance, frequency and observed engagement. First observed is not proof of being a new member.
7. Engagement Barriers: multiple reported barriers/hypotheses, source/date, related programme/domain, action information and outcomes.
8. Staff Follow-Up: required flag, assigned staff, type/date/status, outcome and next action.

Choose the information source and an effective date only if known, then **Review and save profile**. Draft fields survive tab changes. A stale revision returns a conflict instead of overwriting another staff member's work. Original imports and before/after profile revisions are retained. Separately reviewed basic fields are used consistently by the main dashboard, operations, targets, reports and needs analysis; imported originals remain available in the profile.

**Collect voluntary survey / staff feedback** provides a staff-assisted responsive survey and a staff feedback method. Questions are optional; permission to record, date and information source are required. Staff can record interests, preferred times/language, reported barriers, suggested improvements and follow-up requests without requiring medical disclosure. Feedback is append-only with idempotent references. No message is sent.

Respondent percentages use distinct people who answered the relevant question, not attendance rows or the entire membership. With an attested complete registry, needs/feedback summaries include its senior members with no recorded attendance. Otherwise they include known senior profiles and do not claim complete membership. Demographic/participation charts retain their separate reporting-period attendance cohort. Later unanswered questions retain known earlier feedback. Explicit empty interest responses and explicitly confirmed Not present barriers differ from missing information. Staff-reviewed preferences and same-category barrier states take precedence; a new feedback entry does not silently overwrite a reviewed profile. Earlier reports remain in the feedback history. Confirmed participant/caregiver barrier reports are analysed separately from staff observations and unconfirmed information.

## Membership and inactivity

**Data Quality and Administration → Verified member registry import** accepts a separate registry with `Name/Member ID` and optional Gender, Name/Age, Name/Race, Registration Date and the supported raw CFS/SRF/living/marital/language fields. Preview occurs before saving. Existing known participant values and attendance remain; missing basic fields can be enriched. Previous registry snapshots remain stored. Duplicate/invalid rows must be resolved before attesting completeness.

Two separate attestations are required for different claims:

- A complete membership snapshot enables a registered-member denominator and registry-based inactivity counts/rates.
- Separately verified complete attendance history is required to label a member **never attended**. Otherwise the label is **no recorded attendance**, with incomplete-history caveats.

Without a complete registry, member totals, member inactivity rates and never-attended totals are Unavailable. Staff can still see observed recency bands among people previously recorded in attendance. Default new bands are 0–30, 31–60, 61–90 and over 90 days; administrators can change the three boundaries. These are current full-history snapshots as of Singapore today, independently labelled from the dashboard reporting range. Low activity never establishes unwillingness or a reason for non-participation. The legacy Operations threshold/transition workflow is not silently overwritten by the new bands.

## Programme alignment, coverage and planning

**Programme Alignment** compares distinct programmes, delivered recorded sessions and distinct senior reach separately. Session percentages use delivered sessions; participants overlap across domains. Administrators can group original domains for reporting while retaining raw categories.

Use **Programme accessibility** to review intended outcomes, explicit interest/support-need tags, offering status, activity level, mobility requirements, seated options, language, venue/transport access, group size, equipment and staff/volunteer support. Verified future offerings can be added to the catalogue without creating fictitious sessions or attendance. Staff must confirm whether an offering is current, planned or past; attendance history alone does not establish the current schedule. Existing optional programme metadata is retained.

Needs Coverage matches only these explicit reviewed tags. It shows respondent demand, matching catalogue programmes, recorded sessions and privacy-safe reach among the relevant group. No title matching implies clinical or social suitability. Missing catalogue metadata is an information gap, not proof of an unmet need.

The rules add Review findings for incomplete information, Pilot discussions for sufficiently reported interests without a reviewed catalogue match, and Targeted Outreach for privacy-safe participant/caregiver-reported barriers. Explanations distinguish unverified hypotheses. Recommendation priorities for quality, interest and barrier findings are configurable by administrators; staff can set each saved action's priority. Expand suggestions in the existing programme engine now also require a documented confirmed-demand source and review date, in addition to sufficient measured participation. Large attendance alone is insufficient.

Use **Create planning action**, **Create targeted outreach plan** or **Record proposed follow-up** to save title, finding, target group, proposed change, staff owner, dates, priority, status, notes and outcome. Statuses are Proposed, Under Review, Approved, In Progress, Completed and Not Proceeding. Revision checks prevent lost edits.

Outreach plans distinguish contacted, responded, interested, registered, attended and repeat stages. Empty means not collected; zero is an explicit observation. Counts require an evidence source and consistent same-cohort funnel values. They are manually recorded evidence, never contacts inferred as attendance. Before/after evaluation notes capture the metric, denominator, periods and limitations; existing Explore period comparisons provide measured counts. No causal effect is claimed.

## Customisation and administration

**Customise My Dashboard** retains personal KPIs, chart order/size, reporting preferences, filters and saved views. Participant Profile, Outreach Gaps and Programme Planning templates join the earlier templates. Explore adds CFS, living arrangement, marital status, stated interests, reported barriers and support needs as protected groupings. Valid chart types are constrained: overlapping responses cannot use a donut. Personal settings remain account-specific and cannot change organisation definitions.

**Needs reporting settings** is administrator-only: observed inactivity boundaries, CFS display labels with documented approved meanings, living/domain reporting groupings and transparent recommendation priorities. Changes are audited; raw source values remain unchanged. Existing Data & settings and Social Risk Factor Configuration retain senior age, age bands, minority definitions, evidence/privacy thresholds, approved risk mappings, time bands, accounts and shared templates.

Do not map raw SRF `0`, `1` or `>1` without the source codebook. Do not use CFS labels as automatic programme eligibility rules.

## Privacy, reporting and limits

Administrators and planners can access needs analysis, individual profile lookup and staff action records. Viewers retain general participation dashboards and their own preferences, with server-side denial of sensitive profiles, needs reports, registry changes and exports. Existing production sign-in, origin checks, cookie protections and private-schema database access remain.

New sensitive distributions use a fixed full-history cohort. Date/audience filters update general participation/programme metrics but withhold protected CFS/living/marital/response breakdowns rather than releasing repeated sensitive slices. If a nonzero category is below the configured minimum (at least five), the whole breakdown and complementary values are withheld. Repeated-response pattern checks also protect small intersections of overlapping response categories. Small repeat/nonrepeat complements withhold their related engagement statistics. Risk analysis retains its stricter equivalence-cohort controls. Detailed source mappings are administrator-only.

These are conservative staff reporting controls, not a claim of differential privacy or anonymisation against arbitrary outside knowledge. General legacy participation analytics remain available under their existing staff controls. Organisational disclosure policy and permission assignments still require owner review. There is no public anonymous survey or unauthenticated Member ID lookup.

**Export summary CSV** and **Print management summary** use Who Are They / What Are We Missing / What Should We Do, with reporting scope, completeness, alignment, findings and action progress. Action/outreach stages use their own dates/evidenced cohorts; small stage values and small stage differences are withheld together. Downloads omit individual profiles, raw clinical/social breakdowns and private notes. Audience-filtered exports are blocked; small demographic summary complements are suppressed. CSV formula escaping and report HTML escaping remain. The hosted proxy now allows the new approved report/download routes while rejecting unexpected HTML responses. Browser Print → Save as PDF provides a meeting report; an Excel file is not required because CSV is supported.

Current limits/data needed:

- No complete registry or complete registration/attendance history was supplied, so whole-centre membership coverage, true never-attended status and genuine new-member counts cannot be established from this workbook.
- No approved SRF/CFS codebook, dated assessment history or population benchmark was supplied. Raw codes remain uninterpreted until configured; historical classifications and underserved status are not invented.
- Interests, care needs, preferences and barriers are absent from this Excel file. Collection forms are ready; initial sections correctly show not yet collected or privacy suppression.
- Needs/barrier subgroup comparisons and arbitrary combined sensitive filters remain restricted. There is no automatic individual risk ranking or suitability/eligibility decision.
- Programme accessibility, confirmed demand, current offerings, capacity/cost and outreach outcomes require reviewed source inputs. There is no ActivityHub synchronisation, automated scheduling, external messaging or causal evaluation.
- Core numerical targets remain the existing unique/male/minority/first-observed metrics. New outreach stages and follow-up/evaluation progress are recorded in the action tracker; they do not invent new default performance targets.
- Profile correction of imported living/marital/SRF/CFS values uses a reviewed source import; the staff form preserves those originals. Optional reviewed basic corrections and support information have their own version history.
- Printed summaries are reviewed management reports, not unrestricted sensitive-data downloads. Physical tablet/Safari/Android behaviour and a live deployment remain separate verification steps.

## Database migration and changed files

SQLite adds schema version 4 and six tables on startup:

| Table                | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| participant_profiles | Current reviewed JSON profile with revision and staff provenance        |
| profile_history      | Before/after revisions, source, optional effective date and audit actor |
| profile_observations | Distinct imported raw field observations and recorded time              |
| participant_feedback | Append-only voluntary survey/staff feedback                             |
| needs_actions        | Revision-controlled programme actions and outreach plans                |
| member_registry      | Preserved attested membership snapshots                                 |

Participant JSON gains optional raw living/marital fields and import timestamps. Settings JSON gains reviewed CFS/living/domain mappings, engagement bands, registry attestation metadata and planning priorities. No existing table is dropped. Existing attendance backup/replacement protections remain.

For PostgreSQL/Supabase, back up and apply **supabase/migrations/004_needs_based.sql** after migrations 001, 002 and 003, before running this application revision. Alternatively run **supabase/setup-through-004.sql** to apply all four idempotent migrations in order. The new private `glowbb` tables have row-level security and no browser-role grants. Reapplying migration 004 preserves records. No live migration was executed. SQLite migration happens when the updated local server starts. Restart the server after backend changes. Sign-in is temporarily optional as described at the start of this guide.

Main new files: `server/needs-domain.js`, `server/needs-routes.js`, `src/needs-ui.tsx`, `src/needs.css`, migration 004, `scripts/reconcile-needs.mjs`, `scripts/check-needs-layout.mjs`, `tests/needs.test.js` and this guide.

Main extended files: `server/domain.js`, `db.js`, `postgres.js`, `app.js`, `analysis-routes.js`, `operations-routes.js`, `risk-report.js`, `src/main.tsx`, `workspace.tsx`, `api/index.js`, README and existing dashboard/operations/hosting/Supabase/UI tests. Core analytics/operations/export paths now use the same reviewed basic profile overrides. Existing operational tables/reports, attendance history and staff preferences are retained.

## Verification

All 97 automated tests passed, with zero failures or skipped tests, both in separate-file runs and in the final combined no-isolation run (28.5 seconds). Rollback tests deliberately log database error codes while verifying recovery. Coverage includes the actual workbook, old and new imports, deduplication, blank-safe profile enrichment, Member ID matching, observed/member engagement distinctions, registry attestations, profile source/effective dates, optimistic revisions, consent and idempotent feedback, later blank-answer preservation, response denominators, overlap/complement suppression, permission checks, programme metadata, action/outreach persistence, PostgreSQL migration/rollback, exports/proxy routes and React staff workflows.

Headless Chromium QA loaded the actual workbook into an isolated memory database and checked seven pages at 1440×1000, 1024×768, 768×1024 and 390×844. The last validated run completed 28 page/viewport checks without horizontal page overflow, visible alert errors or browser runtime exceptions. Representative desktop/tablet screenshots were visually reviewed; initial layout spacing was reduced. This verifies emulated Chromium layout, not a physical tablet or hosted service. The workbook and saved dashboard databases were not modified by QA.

ESLint, TypeScript checking, the Vite production build and `git diff --check` passed. Final production assets include the latest interface wording and registered-member profile cohort correction.
