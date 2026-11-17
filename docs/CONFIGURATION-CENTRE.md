# Dashboard & Data Configuration

Open **Dashboard & Data Configuration** in the top bar. Select the centre first. All changes belong to that centre unless an administrator explicitly selects a shared policy for several authorised centres.

## Staff workflow

1. In **Activity Exclusions**, search and select activities. Counts in this inventory describe the source attendance in the chosen impact period, including excluded records.
2. Choose the scope, effective dates and a short reason. Names and example reason categories never exclude records automatically.
3. Select **Preview Matches & Impact**. Review the matched names, attendance, recalculated distinct reach, demographic totals, client figures and programme rankings.
4. Check the confirmation box, then approve the configuration or submit an administrator approval request. A changed form needs a new preview. Source or settings changes invalidate an old preview.
5. To undo an exclusion, select the activities and choose **Include Normally � preview restoration**. Administrators can also preview restoration of an earlier approved version under **Centre Configuration**. Restoration creates a new version; it does not rewrite history.

## Exclusion scopes

| Scope                      | Reporting effect                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official attendance KPIs   | Removes eligible sessions and attendance from official attendance totals, senior reach, male/minority reach, repeat/returning/first-observed calculations, demographic analysis, client participation, eligible-history inactivity, programme comparisons and linked recommendations. |
| Programme performance only | Removes activities from programme rankings, AAP Domain comparisons, Event Type programme-mix reports and programme-performance recommendations. Centre-wide attendance, reach and client participation remain included. These sections intentionally have different populations.      |
| Selected saved report      | Applies only when generating the selected report preset. Centre-wide KPIs remain unchanged. Save a preset in **KPI & Reporting Rules** before selecting it.                                                                                                                           |
| Flag for review            | Labels the approved activities for review; attendance stays included.                                                                                                                                                                                                                 |
| Include Normally           | Removes selected activity IDs from existing exclusions. New unrelated rules still require review.                                                                                                                                                                                     |

Unique reach always uses remaining distinct stored Member IDs. Programme unique counts are never subtracted from the centre total or summed across activities. Client registries, membership status and denominators are preserved. Below-60 attendance remains available without becoming registered-client attendance.

Repeat and first-observed meanings retain the existing dashboard definitions. Exclusions can change the eligible history from which those measures are calculated. Available history does not establish that someone never attended. Source coverage dates remain visible even when every activity is excluded, so zero eligible attendance is distinct from missing imports. Client inactivity is available only at covered dates with the required verified registry. Client rates are unavailable without the complete registry, rather than shown as zero.

Unlinked reported monthly assessment totals cannot be attributed to an activity and remain unchanged. Raw source history, metadata editors, import review, backup, deletion and recovery tools continue to use source data.

## Advanced matching

The optional advanced builder supports exact selected IDs, exact names, contains, prefix, AAP Domain, Event Type, service classification, explicit stored duplicate/invalid flags and all activities in the selected centre. Rule dates apply inclusively to sessions. IDs take priority over text matching. Matching names in another centre do not inherit a rule.

A preview approves an explicit snapshot of matched activity IDs. A new activity that later matches a text/category rule remains included and appears as **Review Required**. **Preview new matches for this rule** is required before approval. Unknown classifications are never guessed. Duplicate/invalid matching reads an explicit stored flag, not an inferred activity name; individual selection remains available when there is no such flag.

Shared policies require administrator access to every target centre. Each centre has its own preview, version and approval transaction. If a later centre changes during approval, earlier successful approvals remain recorded. Retry the same preview to resume idempotently; it is not a distributed all-or-nothing transaction.

## Official and exploratory reporting

**Official reporting** uses the approved configuration. **Explore including excluded activities** temporarily includes approved exclusions for authorised staff, with a visible exploratory label. It does not change the saved rules. Aggregate exports and report metadata identify the mode and configuration version. Cross-centre management comparison always uses each centre's official settings and lists their versions.

The management report builder offers six templates: Monthly Centre Performance, Programme Effectiveness, Male and Minority Outreach, Participant Needs and Accessibility, Inactive Client Engagement and Quarterly Management Review. Choose the period, KPI cards, sections, demographic breakdowns, programme ranking and columns. Select the centre using the global selector. Additional activity exclusions or temporarily including approved exclusions require exploratory mode.

Generate a preview before exporting. HTML includes printable tables and selected trend/programme charts; use the browser's Print / Save as PDF. CSV is Excel-compatible. Each preview fixes aggregate values, mode, configuration and source fingerprint for 20 minutes. Changing data or approved rules does not recalculate that preview. Generate a new one to see updated figures. Export audit retains the complete configuration snapshot, inclusion choices and version after the preview expires; it does not archive a copy of an exported PDF.

## Definitions, quality and personal display

Administrators can preview changes to senior age, age boundaries, minority categories, inactivity thresholds, regular engagement and documented exact CFS/living/AAP Domain mappings. Existing SRF, programme metadata, location and source-classification review tools remain available. Approved changes through those existing KPI-definition workflows also create configuration history. Identity deduplication, repeat integrity and source naming conventions cannot be disabled.

Optional missing CFS, SRF, living arrangement, AAP Domain and Event Type warnings affect later import previews. Missing information does not exclude a valid record. Mandatory identity, date, centre, duplicate and profile-conflict validation remains in the established import review workflow. Valid excluded attendance still imports and repeated imports still detect duplicates.

**Personal Dashboard Preferences** controls the account's saved personal analysis cards, charts, default dates, demographic dimension, programme ranking, report columns and layout. Report presets also save their selected options. Existing Custom Analysis views are retained. Preferred centre is saved through the global centre selector. Current dates remain preserved while switching centres. Personal display choices never change official KPI definitions.

The existing no-login shared workspace is preserved. In that mode everyone uses the shared administrator actor, so its personal preferences and audit identity are shared. In authenticated integrations, existing `planner` staff can review/request exclusions and save personal analysis; existing `admin` users approve settings only in their authorised centres; viewers cannot manage configuration or enter exploratory mode. Enforcement is on the backend.

## CaritaHub

**Not connected**, as confirmed by the user. No connector, scheduled job, fake sync button, success status or retrieval counts have been added. The panel stores reviewed draft categories and either all-history or a custom date range for the current authorised centre. Incremental retrieval is unavailable until an actual connector supports it. It does not contact CaritaHub. Manual workbook imports remain operational and preserve valid excluded source attendance.

## Storage and setup

No new SQL migration is needed. Rules and versions extend each existing centre's `settings` JSON; audit snapshots use `audit`; personal defaults use `staff_preferences`; owned, expiring previews use `import_previews`. SQLite centre databases and private PostgreSQL schemas retain their existing separation. Existing multi-centre database setup remains a prerequisite. Deploy the updated frontend and backend together using the existing deployment process; this change has not been deployed by Codex.

## Local verification

- Full automated suite: 308 tests passed, including SQLite and PGlite/PostgreSQL coverage. A presentation coverage regression found in the initial run was fixed and the full rerun passed.
- Lint, strict TypeScript check and production build passed.
- Isolated Chrome browser checks: 1440, 1024, 768 and 390 pixel widths; all five tabs, preview/confirmation, approval, report snapshot, history, personal save and disconnected sync. No saved or hosted attendance was changed.
- `node scripts/benchmark-configuration.mjs`: 1,000 synthetic participants, 100 programmes, 1,000 sessions and 20,000 attendance records. Seven measured iterations after three warmups: policy projection median 0.90 ms; baseline analytics 92.96 ms; analytics with 20 approved activity exclusions including projection 82.16 ms. Fewer eligible rows make the latter comparison unsuitable as a speedup claim. Raw attendance stayed 20,000; eligible attendance was 16,000. Local results do not establish hosted performance.

Reproduce checks with `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`, `node scripts/check-analysis-polish.mjs --configuration` and `node scripts/benchmark-configuration.mjs`. QA screenshots and machine-readable results are written under ignored `data/analysis-polish-qa` and `data/configuration-qa`.
