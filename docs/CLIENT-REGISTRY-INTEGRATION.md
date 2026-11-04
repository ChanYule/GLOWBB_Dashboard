# Client registry and attendance integration

Release: 4 November 2026. This extends the current dashboard and its three needs-based analysis levels. It does not replace overall programme analytics. Development reconciled both supplied workbooks read-only and imported them only into isolated test databases. No saved local or hosted attendance/client data was changed.

## Verified source reconciliation

| Measure                                            |          Verified result |
| -------------------------------------------------- | -----------------------: |
| Registry records / distinct Member IDs             |            1,473 / 1,473 |
| Registered clients with attendance                 |                      164 |
| Registered clients without recorded attendance     |                    1,309 |
| Observed client participation                      |      164 / 1,473 = 11.1% |
| Other attendance participants outside the registry |                      241 |
| Registry clients living alone                      |                      207 |
| Living-alone clients with / without attendance     |                 30 / 177 |
| Living-alone participation                         |         30 / 207 = 14.5% |
| Male registered clients / attending                |                 590 / 38 |
| Female registered clients / attending              |                883 / 126 |
| Male / female participation                        |             6.4% / 14.3% |
| Missing registry living arrangements               |                      450 |
| Distinct recorded residential blocks               |                       35 |
| Registry Is Client / Within Boundary               |  All 1,473 are Yes / Yes |
| Raw attendance / deduplicated attendance           |            3,344 / 3,343 |
| Distinct attendance participants                   |                      405 |
| Programmes / programme-date-time sessions          |                116 / 351 |
| Attendance coverage                                | 4 May to 3 November 2026 |

The ten registry headers match the supplied export exactly. No nonblank demographic/CFS/SRF/living/client/boundary conflicts were found between the 164 matched clients in these particular source files. Literal SRF `0`, `1`, `>1` and blanks remain distinct. Registry SRF counts are 1,393 / 71 / 4 / 5 respectively. These raw categories have no automatic clinical or social interpretation.

Living categories are retained: Alone 207, Family 440, Spouse 273, Children 62, Other 19, Room-mate 9, Relative(s) 7, Friend(s) 5, Tenant 1 and missing 450. CFS registry groups are 1–3: 1,188; 4: 138; 5: 82; 6: 50; 7–8: 15. Small sensitive results are withheld in staff reporting even though raw source totals can be independently verified for development.

The reference figures above are test/reconciliation checks, not production constants. `node scripts/reconcile-clients.mjs <registry.xlsx> <attendance.xlsx>` repeats the independent raw-row comparison and the application calculations without saving data or printing Member IDs. Automated source tests use `CLIENT_REFERENCE_WORKBOOK` and `NEEDS_REFERENCE_WORKBOOK`, or the supplied local paths. They explicitly skip when the source files are absent on another machine.

## Where staff work

**Client Engagement** is visible beside Management Overview and the three analysis levels. Management Overview includes a linked client-coverage summary when a registry exists. The original programme KPIs remain attendance-based, including non-client participants. The client section uses the registry as its population denominator; these two populations are not interchangeable.

- **Client participation:** six default cards, registered-versus-attending comparisons, status distribution, information gaps and evidence-linked findings.
- **Explore client participation gaps:** guided questions and advanced filters for status, age, gender, race, living arrangement, CFS, SRF, block, zone, language, stated interests, reported barriers, support needs, programme/domain and contact outcome.
- **Client follow-up list:** an authorised, audited and paginated individual workspace. It shows Member ID, age, living arrangement, block, last attendance, period-specific participation, contact outcome, assigned staff and contact date. CFS, SRF and support details stay in the protected individual profile.
- **Zones & rules:** administrator-only documented block groupings, observed inactivity boundaries and registry import history.

Client findings also appear in the existing needs-based planning results. **Create reviewed outreach action** opens the existing action editor with the finding, target group, source evidence and proposed next step already filled in. It saves to Programme Planning and Actions, preserving existing approval/status, assignment, evaluation and outreach-stage workflows. Nothing schedules or sends outreach automatically.

## Import and synchronisation

1. Open **Client Engagement → Import client registry**, or use **Data management → Client registry & engagement**. Data Quality and Administration also uses this importer.
2. Choose the supplied registry workbook. It must contain `Member ID`, `Gender`, `Current Living Arrangement`, `Age`, `Race`, `CFS`, `Social Risk Factor(s)`, `Is Client`, `Within Boundary`, `Block / Building No.`. Optional `Registration Date` (unambiguous `YYYY-MM-DD`) and `Preferred Language` are supported.
3. Choose **Preview client registry**. Review matched/new profiles, missing living information, duplicate/invalid rows, conflicting values and previously registered clients absent from the incoming file.
4. Saved nonblank values are retained by default. Approve individual source conflicts only when reviewed. Staff-reviewed profile corrections are protected and must be reviewed through the participant profile. Up to 500 conflicting fields can be approved in one confirmation; remaining conflicts can be retained and reviewed later.
5. Enter the registry snapshot date. Attest completeness only when verified. Review the preview and choose **Confirm client registry**.
6. Import attendance through the existing **Import attendance → Merge → Preview → Confirm** workflow if it is not already saved. Either source can be imported first; Member ID produces the same relationship. The attendance file is never used as a replacement client registry.

Member ID is converted to a trimmed string and hashed using the existing participant identity function. Case, internal punctuation and leading zeros are preserved; identifiers are not guessed, case-folded or fuzzy-matched. Names, age, gender and block are never matching keys. Duplicate Member IDs and invalid rows must be resolved before confirmation. Stale previews are rejected if participant reviews or membership have changed in the meantime.

New clients receive existing participant profiles. Approved nonblank fields enrich the current source profile; blanks do not erase values. Attendance, non-client participants, programme metadata and staff needs/preferences remain. Reimporting the same file creates no duplicate client or attendance records. Source snapshots and current membership records occupy separate keys in the existing registry table, so registry row counts include history and must not be mistaken for distinct clients.

The current client population is cumulative. Clients absent from a later file remain registered and are flagged in the preview. A source status change requires a reviewed conflicting-field approval; absence alone never ends registration. **Client follow-up list → Open follow-up → Explicit membership status change** provides a separate administrator archive/reactivation workflow with reason, typed confirmation and revision checking. Administrators can select archived or current-and-archived membership records in the follow-up list. Archiving changes the current population, while retaining attendance and profiles.

Legacy generic member snapshots remain stored. Once a client population is in use, the old generic registry confirmation endpoint rejects replacing it; staff use the client importer. Generic membership is not automatically interpreted as a client population.

## Definitions and reporting dates

Client metrics count distinct registered people, all ages. The denominator is the current client registry, reduced only by verified registration dates later than the selected period/reporting date and explicit client/archive status. Missing registration dates do not establish historical membership; the dashboard labels this limitation instead of inventing historical denominators.

- **Clients who attended:** eligible registered clients with a valid matching attendance record in the selected dates and programme/domain scope.
- **No recorded attendance:** eligible registered clients without such a record in that selection. This does not mean never attended, unwilling or permanently disengaged.
- **Participation rate:** attending clients divided by the eligible registered population, with the numerator and denominator displayed.
- **Other attendance participants:** distinct people attending in that period who fall outside the current registry. The supplied 241 correspond to non-client participants; after membership changes, the label can also include unmatched or archived clients and must not automatically be renamed non-clients.
- **Average sessions:** distinct programme sessions per participating client, not raw duplicate rows and not a measure of causal programme impact.

If no attendance has been imported, the registry is kept ready for linking, but participation rates and active/inactive classifications are unavailable rather than fabricated as zero. Periods wholly outside the available attendance coverage are rejected with a clear explanation. New client views default to the latest covered attendance date; saved reporting dates remain explicit. Choosing a date after the export coverage ends marks previously observed clients as history-limited, with active/inactive cards unavailable until updated attendance is supplied or a covered date is chosen.

Engagement status uses the latest recorded attendance on or before the separately selected reporting date, across full available history. It is independent of the period/programme selection. Defaults are active through 30 days, recently less active through 60, inactive 61–90 and inactive over 90. Clients with no recorded history remain a separate category. Administrators can change the three boundaries; labels use the configured values. These are observed recency classifications within the available source history, not a claim about unrecorded activity. The original Operations inactivity threshold and transition calculations remain available separately.

For each safe comparison row the dashboard shows registered, attending, no-recorded-attendance, rate and frequency. Grouped bars compare population and attendance directly. Larger block/zone tables support search, sorting and pagination. Available privacy-safe domain/last-attendance details can be expanded. Missing living arrangement is labelled as missing information, not as a social circumstance. Approved living/CFS/SRF labels remain reporting mappings; raw source values are preserved.

## Profiles, contacts and barriers

Open **Client follow-up list → Open follow-up**. Record the contact date, assigned staff, outcome, optional next date, information source and explanation/action/next step. Outcomes are Contact attempted, Contact successful, Participant not interested, Participant interested, Follow-up required, Referral or support required and Other approved outcome. Outcomes are staff records, not automatically inferred from attendance.

Barriers are optional and allow multiple selections. Permission to record voluntary barrier information is required when they are selected. Participant/caregiver reports are analysed separately from staff observations and unconfirmed hypotheses. **Prefers not to say**, Unknown and Not assessed do not become confirmed reasons. Recorded absence of a barrier differs from an unanswered question. Percentages use distinct assessed respondents; multiple selections overlap. Small response patterns and complementary values are withheld.

Saving a reviewed contact appends its history and updates the existing **Staff Follow-Up** profile section, preserving all other profile fields. The original before/after history, staff actor, information source and date remain audited. Idempotent references prevent duplicate submission; stale profile revisions require a reload. No call, email or text message is sent. Earlier reviewed barrier states remain authoritative until staff explicitly review them; a new contact does not silently overwrite a reviewed clinical/social assessment.

Expand **Open full participant profile and recorded needs** to use the existing eight-tab editor and survey workflow. Social and Living Circumstances now supports sourced staff corrections for living arrangement and residential block without replacing imported originals. Clinical/social raw classifications can be corrected through reviewed source imports, with approved mappings kept separate from source values. Attendance dates never become assessment dates.

## Personal and shared dashboard views

Choose **Customise client view**. Select cards and comparisons, change between grouped bars and tables, order charts, use a ready-made view, and save filters/layout under a personal name. Six cards are shown initially; staff can select additional cards. Ready-made client views cover engagement, inactivity, living arrangement, gender/minority, CFS/SRF, blocks/zones, barriers and planning. Overall Programme Performance remains in the original programme dashboard.

Administrators can share the current client layout as a template. Other authorised staff can choose it and save their own copy. Client preferences live alongside existing personal programme views, with server-side merging so saving either workspace preserves the other. Personal views cannot change organisation-wide definitions, risk mappings or block zones. Temporary direct access continues to use the shared workspace account; distinct personal preferences require separate staff accounts when sign-in is enabled.

## Security, reporting and interpretation

Client analytics, identifiable follow-up, contacts and source review require planner or administrator roles, enforced on the server. Registry import, zones/rules, shared templates and membership status changes require administrator access. Viewer accounts retain the original permitted general dashboards. The current configured sign-in mode, same-origin request checks, cookie protections and private-schema/RLS controls remain.

Raw Member IDs are retained in the private registry records for the explicitly requested authorised follow-up workflow. They are not added to general programme analytics, chart tooltips or management downloads. The follow-up list is audited and has no export endpoint. CFS, SRF and support notes are excluded from its default table.

New aggregate comparisons withhold small nonzero population, attendance and no-attendance cells, and suppress a complementary category to prevent subtraction of a single hidden row. Sparse domain/status/response details are also withheld. Arbitrary combined profile/programme filters are released only if the fixed equivalence cohorts across every supported filter field and exact attendance membership meet the configured minimum (at least five). Sensitive living/CFS/SRF/block/zone breakdowns use the fixed full-history cohort unless that condition holds; arbitrary sensitive period slices are withheld. General period-specific client totals remain available where safe. Authorised staff use the separate audited follow-up workflow for detailed investigation rather than bypassing aggregate suppression.

These are conservative reporting/access controls, not differential privacy or a guarantee against outside knowledge. Source imports change current snapshots. Detailed residential identifiers require organisational permission and retention review.

**Export centre summary CSV** and **Print management summary** use the full client cohort for the chosen dates, explicitly omit audience filters, and exclude Member IDs, blocks, CFS/SRF/living breakdowns and private notes. Exports have server-side permission and query restrictions; the hosted proxy permits only the approved CSV/HTML routes. Source files and registry settings remain private. Browser Print can save the summary as PDF.

Insights distinguish finding, relevance, unanswered questions and suggested action. Living alone, a block, CFS, SRF, gender or low recorded participation never establishes the cause of non-attendance or programme suitability. No individual vulnerability ranking, clinical eligibility decision, automatic outreach, geocoding or fabricated survey result is generated.

## Files and database components

New files:

- `server/client-domain.js`: exact source parser, source conflict inspection, registry-based cohort/participation calculations, privacy protection, findings and follow-up selection.
- `server/client-routes.js`: transactional registry review/import, reports, authorised list/contact history, membership, preferences/shared templates, rules, exports and auditing.
- `src/client-import.tsx`, `src/client-ui.tsx`, `src/clients.css`: linked client workspaces and responsive staff controls.
- `scripts/reconcile-clients.mjs`, `tests/clients.test.js` and this guide.

Extended files include `server/app.js`, `analysis-routes.js`, `data-management.js`, `needs-domain.js`, `needs-routes.js`, `api/index.js`, `src/main.tsx`, `needs-ui.tsx`, `data-management.tsx`, existing UI/hosting tests and the headless layout script.

No new tables are required. Existing structures are reused:

| Component                              | Extension                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| participants.details                   | Optional residential block and registry import provenance; no new attendance identity                                                       |
| member_registry.details                | Original source snapshots; one current record per client; Member ID, approved fields, field provenance, revision and explicit archive state |
| participant_profiles.details.basic     | Separately reviewed living/block corrections                                                                                                |
| participant_profiles.details.followUp  | Existing staff follow-up, updated by reviewed contact outcomes                                                                              |
| participant_feedback.details           | Append-only contact record and optional sourced barriers                                                                                    |
| profile_history / profile_observations | Before/after reviews and distinct imported raw observations                                                                                 |
| staff_preferences.value.clients        | Personal client views; preserves programme preferences                                                                                      |
| settings.value                         | Client registry provenance, documented zones, shared client templates and existing inactivity boundaries                                    |
| audit                                  | Registry results/timestamps, list/source views, contacts, membership and organisation changes                                               |

**No additional SQL migration is needed after migrations 001–004.** Existing private-schema foreign keys, uniqueness, backups and RLS remain. If starting a fresh Supabase installation, use the existing `supabase/setup-through-004.sql`. Restart the local server, or deploy the updated frontend and backend together. No live migration/deployment was performed.

Data management continues to back up, reset and restore the reused registry/profile/contact tables. Source snapshot rows are historical records, so a reset preview can show more registry rows than distinct clients. Backups retain private IDs and deleted information until explicitly removed. Existing accounts, audit history, organisation definitions and personal views remain under the earlier retention rules.

## Validation and remaining data needs

All 123 automated tests passed with no failures or skipped tests. Five focused final checks also passed after the feedback/date-boundary and import-refresh refinements. TypeScript checking, ESLint, the production build and whitespace checks passed. Tests cover both source files, reference denominators, exact matching/leading zeros/case, duplicates, non-client preservation, blank-safe enrichment, approved/protected conflicts, stale previews, repeated imports, SQLite/PostgreSQL transactions and forced rollback, reporting dates/statuses and insufficient history, complementary/combined-filter suppression, roles, individual list pagination/search, contact idempotency/revisions, explicit archive/reactivation, personal/shared settings, safe exports/proxying and React staff workflows.

Headless Chromium loaded both real workbooks into an isolated memory database and passed all 52 page/viewport checks with no horizontal page overflow, visible alerts or runtime exceptions. The linked client page, gap explorer, follow-up list, registry import form, existing needs/programme pages and deletion preview were checked at 1440×1000, 1024×768, 768×1024 and 390×844. Desktop/tablet screenshots were visually reviewed. No saved dashboard database was opened by these tests. This verifies emulated Chromium, not physical devices, Safari or a hosted deployment.

Additional evidence is still needed for stronger conclusions:

- Verified registration dates and historical membership status for historical population denominators.
- Earlier/comprehensive attendance exports and explicit source coverage assurance for stronger longitudinal inactivity/never-attended claims.
- Approved CFS/SRF definitions and dated assessments for category interpretation; no diagnosis or eligibility inference.
- Voluntary interests, language, support needs and reported-barrier feedback for reasons and programme matching. Missing responses are not negative answers.
- Reviewed programme accessibility/language/venue/capacity metadata before describing an offering as suitable or accessible.
- Validated full addresses/postal codes, centre coordinates and a reliable geocoding/travel source before distance, travel-time or map-based access analysis. Block groupings are the supported current alternative.
- Organisational disclosure/retention rules and appropriate staff account assignments before wider identifiable follow-up use.
