# Participation Patterns & Insights

Programme rankings now include explicit repeat-attendance diagnostics, small-sample cautions, registered-client representation and selected-group primary-domain mix. [Phase 6 definitions and staff workflow](PHASE-6-PROGRAMME-DIAGNOSTICS.md).

**Advanced comparison (optional)** now includes a two-factor participation matrix and a cautious support-needs review panel. [Phase 5 workflow, decision rules and export/privacy limits](PHASE-5-TWO-FACTOR-VIEWS.md).

This guide describes the original participation-patterns release. For the subsequent location extension, migration 005 and current validation, see [Location, distance and participation](LOCATION-PARTICIPATION.md).

Open **Staff Tools → Participation Patterns & Insights**. The three main pages and the main summary without an Inactive column are preserved.

## Staff workflow

1. Choose a preset or select **Age Group**, **CFS**, **Social Risk Factor**, **Race**, **Gender**, **Living Arrangement** or **Residential block** for the detailed comparison.
2. Choose **Registered clients (all ages)** for client participation rates, or **All attendance participants (all ages)** for reach including non-clients. Blank date fields mean all delivered history. This page has its own reporting dates; other pages' demographic filters are not silently applied.
3. Review the four cards and **Participant group comparison**. Switch the comparison metric; expand **View group figures and definitions** for counts, attendance, programme variety and repeat figures.
4. Choose a specific group and rank programmes by **Unique Reach**, **Attendance Entries** or **Repeat Engagement**. Five privacy-safe programmes appear initially. **View all programmes** opens a paginated list. Select a programme for its breakdown by the current characteristic and the presence of recorded accessibility fields.
5. Read **Repeat participation and engagement** and **What the Data Tells Us**. Each finding separates evidence, interpretation, questions and suggested staff action. Sourced participant/caregiver feedback is separate from possible explanations.
6. **Save preferred view** preserves the characteristic, scope, ranking and filters in existing staff preferences. Presets cover age, CFS, SRF, race/minority outreach, living arrangement, repeat engagement and overall planning.
7. **Advanced comparison (optional)** adds a second characteristic, programme domain or dated attribute basis. Closing the panel removes the second characteristic from requests; any domain and attribute basis remain labelled. Narrow comparisons may be withheld.
8. **Presentation / PDF** opens a protected snapshot using the existing report shell. **Print / Save as PDF** excludes the disabled workspace. Close or Escape restores the workspace.

## Calculations and definitions

### Engagement depth and recency

**Engagement depth and recency** adds group segment mixes, exact counts and percentages across all analysis dimensions, including overlapping Event Types. Defaults are One-time = 1 session, Occasional = 2–5, Regular = 6+, with separate No recorded history and None in this view categories. The regular boundary is configurable in Dashboard Settings. Recency uses 30/60/90-day bands anchored to the attendance coverage end date across full available history, independently of the selected period/domain. It does not change existing active/inactive rules. [Phase 3 definitions, staff workflow, privacy and validation](PHASE-3-ENGAGEMENT-DEPTH.md).

### Selected group and overall context

Primary KPI figures refer to the selected group, with the group's denominator stated explicitly. Muted secondary lines give overall figures for the same period/domain/population. The primary session measure is now the median and middle-50% range among attendees, with the mean available in **Definition and mean** and a tooltip. A six-bin histogram shows sessions per attendee. [Phase 2 staff workflow, definitions, privacy and validation](PHASE-2-GROUP-CONTEXT.md).

### Participants below 60

The registered-client age view also shows **Below 60 · attendance participants** as a separate attendance summary. **View below-60 attendance and programmes**, or selecting **Below 60** in the group selector, opens all-age attendance analysis focused on that group. Saved client-only Below 60 selections open this attendance view too. Dates, domain and profile basis are retained. Counts use distinct people and person-session pairs; unknown ages stay separate. This does not add anyone to the client registry or change client participation-rate denominators. No registered-client participation rate is shown for the attendance-only group.

### Attendance questions that matter

The staff page also answers four focused questions about CFS, residential block, living arrangement and social risk. Each card provides a recorded-data answer, a staff follow-up, expandable **Evidence and limits**, and **Explore this comparison** to open the underlying registered-client analysis.

These answers always include registered clients with no recorded attendance, follow this page's period, domain and profile basis, and remain independent of the selected population/group. Participation means attending at least once divided by registered clients; it is not attendance at booked sessions. Answers require a verified complete registry. Phase 1 now adds plausible ranges, configurable caution/comparison thresholds (default 20/10), exact exclusion reasons and optional pooling; every original group remains available to staff. [Staff workflow, calculation, settings, privacy and validation](PHASE-1-RELIABILITY.md). CFS compares the lowest and highest available standard bands without asserting a trend. Differences do not establish causes or actual barriers. No additional SQL migration is required.

- Exact stored identities join registry and attendance. Import canonicalisation and programme mapping rules are unchanged; similar programme names are not merged.
- Age groups are mutually exclusive: Below 60, 60 to 69, 70 to 79, 80 and above. Missing, Unknown and invalid ages stay separate.
- Source CFS groups and administrator mappings are retained. The numeric/source ranges use 1–3, 4, 5, 6 and 7–8. SRF raw codes remain visible with approved labels; no ordered social-risk meaning is inferred from `0`, `1` or `>1`. Missing SRF is not no risk. Living arrangement groups and minority membership reuse approved settings.
- Registered-client participation rate divides distinct participating eligible registered clients by all eligible current registered clients in that group, including people without attendance. Rates require a complete, attested registry and delivered attendance. Overall scope has no registered-client denominator.
- Attendance deduplicates person/session pairs and excludes future sessions. Unique people are not summed across programmes. Delivered-session counts show available programme opportunity, rather than only the sessions attended by a selected group.
- Programme repeat participants attended at least two distinct sessions of that programme in the selected period. The programme rate divides by its unique people. One-session programmes show **Not applicable**.
- Group repeat rate divides people repeating a same programme by people attending at least one multi-session programme. Average sessions divides person/session entries by participating people. Programme/domain variety and first-observed/previously-recorded people are separate measures.
- First observed means first in available delivered history, not a new client. No recorded attendance is not proof that someone never attended.

## Historical attributes and evidence

Current recorded attributes are used consistently by default. They are not represented as attributes at each historical session. Dates of birth are unavailable for calculating age at attendance.

**Dated profile at period end** uses the latest staff profile snapshot with an effective date no later than period end. Missing or undated historical attributes remain missing. Future assessments do not fill a historical gap. Current registered membership is not a historical census; missing registration dates do not establish historical membership.

Findings are calculated when releasable evidence supports them. Group comparisons use the configurable comparison floor and state whether 95% plausible ranges overlap. CFS endpoint comparisons do not establish a decreasing trend. No SRF ordering, causal explanation, medical suitability or individual vulnerability score is invented. Attendance does not establish preference, language, loneliness or transport barriers.

Re-engagement after inactivity is not added as an inferred metric. Existing client outreach and inactivity workflows remain available. Programme details identify existing structured accessibility fields and direct staff back to the full assessment; clinical free text is not shared.

## API, storage and privacy

New routes are restricted server-side to administrators and planners:

- `GET /api/participation-patterns`: one selected characteristic and group ranking, with an optional protected second characteristic.
- `PUT /api/participation-patterns/preferences`: partial update of `staff_preferences.value.patterns`, preserving other staff workspaces.
- `GET /api/participation-patterns/export`: the same protected aggregate contract used for presentation, with an audit entry.

No additional SQL migration is needed beyond existing migrations through 004. Analysis does not write imports, participants, memberships or programmes. PostgreSQL reuses the single-query planning snapshot and read transaction. Dated snapshots are fetched only when requested.

The minimum release size is the larger of five people and the configured privacy minimum. Small cells and complements are protected. A lone hidden group causes complementary suppression of another group to prevent subtraction from known totals. Repeat and first-observed details are protected independently. Rankings omit protected programmes and protect complementary programme/group cells. Related additive totals and averages are withheld when they could reconstruct a hidden programme or domain count. Withheld values never become zero.

Custom date/domain slices, dated profiles, overall attendee cohorts and combined comparisons require safe full characteristic/attendance-history cohorts. Some narrow comparisons are therefore unavailable; arbitrary filters must not reconstruct small sensitive groups. Saved views and exports use the same rules. These routes return no participant IDs, private notes or clinical free text.

## Components, visuals and performance

`server/patterns.js` supplies grouping, indexed aggregation, evidence rules and suppression. `server/pattern-routes.js` supplies report, preferences and export contracts. `src/patterns-ui.tsx` and `src/patterns.css` supply the lazy-loaded page. Existing navigation, preferences, horizontal bars and the presentation shell were extended.

One comparison bar chart shows the selected metric, with a 0–100 scale for rates. The top-five ranking table keeps delivered sessions beside reach and repeat figures, helping staff distinguish breadth from recurring engagement. Domain variety, sourced barriers and combined comparisons expand on request. Tables scroll inside panels on small screens.

The initial main bundle was 312.43 kB; the final feature build was 313.21 kB. The new page is a separate lazy chunk of about 18 kB before gzip. Browser QA verifies that the main dashboard makes no participation-patterns request. These are size measurements, not speed-improvement claims.

Using the supplied workbooks in an isolated in-memory SQLite application (3,343 attendance records and 1,473 clients), final-run five-request local medians were approximately 53–96 ms across the six main characteristics, with JSON responses around 6–8 kB. This includes local HTTP, parsing and aggregation and does not establish hosted PostgreSQL latency. The QA script regenerates `data/needs-layout-qa/patterns-performance.json`.

## Verification and limits

The full automated suite passed 153 tests, including SQLite/PostgreSQL integration, grouping, denominators, duplicates, repeat opportunity, top-five limits, exact programme identities, historical snapshots, privacy, evidence-based findings, permissions, preference preservation and export safety. Lint, strict type checking and production build passed.

The browser QA script runs 118 checks across all pages at 1440, 1366, 1024, 768 and 375 pixels, selected-characteristic changes, the new presentation and retained workflows. The protected PDF was verified as four readable pages with workspace controls hidden and no blank workspace page. Fixtures are isolated; source workbooks and saved workspace data are not imported into or overwritten by QA.

These are local changes. Hosted deployment and physical-device behaviour need separate verification.
