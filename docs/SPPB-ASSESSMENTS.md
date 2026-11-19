# SPPB Assessments

This is a supplementary assessment source in the existing four-centre dashboard. It never creates participants, membership or attendance. Existing centre classification and attendance-screening totals are unchanged. The original source file is never edited.

## Using the page

1. Select the centre in the existing header, then open **Analysis → SPPB Assessments**. Management comparison users can select **All authorised centres · unique members** within the page. The same member and assessment are counted once across those centres.
2. Use assessment dates, status, Member ID search, age, recorded CFS and reporting date. Date filters select members with dated assessments in that interval; latest results and reassessment status use their full history through the reporting date. Clear date filters to include people without assessments.
3. Select a **Member ID** to open the history drawer. It shows original component/total scores, source details (including repeated column names), score-validation status, approved comparable scores and exploratory programme attendance between comparable assessment dates. Original walking times, aids and incomplete-test reasons are expandable. Assessment location remains **Unknown**.
4. Use **Reassessment follow-up** to review last dates, elapsed days, due dates, assignment and internal follow-up status. The drawer saves a reviewed internal follow-up; it schedules no assessment and sends no message.
5. Authorised profiles have an **SPPB Assessments** section opening the same underlying member history. An attendance-only profile does not grant access to physical-function results.
6. **Excel export** downloads a real XLSX workbook. **Print / PDF** opens an escaped print report; use the browser's Print → Save as PDF. Reports are restricted to the current authorised population and filters. They separate original scores from validated scores and include interpretation limits. PDF is browser-generated, not a server-generated PDF attachment.

## Import and matching

Open **Data Management → Import SPPB Assessments**, or **SPPB Assessments → Data quality & import**. A shared-source import requires an administrator with access to all four active centres. A centre-limited administrator cannot inspect the cross-centre unmatched source.

Upload the supplied XLSX (or a UTF-8 CSV with the same required score/date headers), review the counts and matched/unmatched Member ID lists, tick the review acknowledgement and choose **Confirm SPPB import**. Discard removes the owned preview. Preview expires after 20 minutes. Failed confirmation rolls back the entire shared import and leaves the preview retryable. Large uploads use the existing chunked-upload infrastructure.

Exact trimmed Member ID is hashed using the existing `hash([memberId])` identity. Case, punctuation and leading zeros remain significant. Gender, date of birth and age never match identities. A matched participant may be attendance-only; this matches the source but does not establish verified client affiliation or permission to see results. There is no source-centre inference.

Records are stored once in shared control-plane storage. Idempotency uses a fingerprint of the exact member and original ordered source cells, excluding file name, row position and batch. Identical rows collapse to one record; nonidentical same-day entries are retained. Import batches retain source hash, filename, original row count, duplicate/matching/review counts and timestamp. Records retain original source rows/cells and the first import batch. A renamed-file reimport creates no duplicate history.

Unmatched and invalid-ID records remain in protected storage indefinitely; there is no automatic retention purge. After importing member data, choose **Reprocess after member imports**. Reports also recheck live participant and registry relationships, so centre revocation, archiving or registry changes affect visibility without copying assessments into another centre. Shared SPPB records survive a centre workspace reset; centre-only backups do not include this control-plane source. Back up the control database as part of operational backups.

## Scoring and conflicts

Default label: **Imported SPPB score, scoring validation pending**. There is no automatic clamping, gait rescaling, clinical threshold or diagnosis. Out-of-range original scores remain intact.

Standard SPPB consists of balance, gait and chair components each scored 0–4, totalling 0–12. Source references: [WHO ICOPE locomotor-capacity training](https://cdn.who.int/media/docs/default-source/mca-documents/ageing/icope-training-programme/revised-modules-19-may-2025/who-icope_m9_locomotor-capacity_fg.pdf), [NIA SPPB resource](https://www.nia.nih.gov/research/resource/short-physical-performance-battery-sppb). These sources establish the standard ranges; they do not validate this export's scoring system.

An all-centre administrator configures a source scoring definition, an approved version, validation method and evidence under **Approved reassessment interval and scoring rules**:

- **Original standard-range scores only**: explicit identity approval can validate unchanged integer components within 0–4 and an internally consistent total within 0–12. It does not validate any out-of-range row.
- **Individually reviewed standard scores only**: every validated result requires a separate record review referencing the approved version. Raw originals remain unchanged; corrected standard scores are stored separately. No general transformation is invented.

Use a new approved version for incompatible protocols. Scoring approval can be revoked, immediately disabling affected comparisons. Configuration and record reviews use revision checks and retain prior/current values in restricted audit records. Source-definition assignments retain the imported definition separately.

The quality section preserves unresolved same-member/date entries. Administrators may keep unresolved, confirm separate assessments with evidence, mark a record superseded or reference another corrected assessment for the same member. No original is deleted. Without reliable within-day order, multiple separate same-day results still have no automatic latest score or comparison. Unresolved conflicts never enter validated comparisons.

Latest assessment date uses dated, nonsuperseded records on or before the reporting date. A latest-day conflict is shown as requiring review rather than choosing a higher score. Score difference requires an unambiguous latest standard result and the previous unambiguous result on an earlier date with the same approved scoring version. Missing/future dates, invalid scores, unresolved conflicts and incompatible versions are excluded. Dates and component differences support every comparison. Charts break at incompatible or unvalidated records and ambiguous days. Numerical differences are observations, not confirmed meaningful clinical improvement or causal programme effects.

## Reassessment interval

No interval is enabled by default. Under **Approved reassessment interval and scoring rules**, enter 3, 6, 12 or another whole number of months (1–120), the approaching-date window, and the organisational procedure/evidence. Choose **Save reviewed assessment configuration**. End-of-month due dates are clamped to the destination month's last calendar day. Due today, overdue, approaching, recently assessed, no assessment, date unavailable and interval unconfigured stay distinct. No clinical interval is assumed.

## Database and deployment

New shared control-plane tables are `sppb_records` (indexed canonical member key and immutable original-source details plus separate review), `sppb_batches` and `sppb_configuration`. There are no foreign keys creating members in centre databases. Existing authentication, centre grants and transaction infrastructure are reused. SQLite creates the additive tables at platform startup.

For PostgreSQL/Supabase, apply **`supabase/migrations/007_sppb_assessments.sql`** in the **SQL Editor for the dashboard's existing database**, after migration 006. Run it once for the shared `glowbb` schema, not once per centre. Platform startup also runs this idempotent migration using the configured server connection. The server role needs the same schema/table creation permissions used by existing startup setup. All three new tables enable RLS and revoke direct access from PUBLIC, anon and authenticated; access is through the server only. No new environment variable or external service is required.

Individual results require admin/planner role plus active client-registry affiliation in the requested authorised centre. Merely appearing in attendance does not grant access. General viewers get only a fixed, protected centre-level coverage aggregate with small/complementary counts withheld; no member lists, scores, search or detailed filters. Exports and history access are audited. Shared imports, unmatched records, score review and scoring configuration require an all-centre administrator. Sensitive source fields are not logged to the console or sent to an external service.

The pipeline is ready for an approved future connector to reuse `parseSppb`, the shared preview/confirm matching and persistence, and the scoring checks. No CaritaHub endpoint or active sync is invented.

## Source verification and local matching

Read-only inspection of `Short Physical Performance Battery (SPPB) (1).xlsx` found 666 records, 397 Member IDs, 189 members with at least two distinct dates, 69 conflicting same-day groups, one missing date and latest assessment 28 October 2026. There are 124 original totals above 12 and 139 gait values above 4. Every recorded total equals its three recorded component scores. These are source checks, never production constants.

The local database inspected during development contained zero participants and no centre database files: local matching is therefore 0 matched / 397 unmatched Member IDs. The source was not imported into saved workspace data and the hosted database was not queried. Production counts must come from the import preview against the actual deployment.

Repeat the read-only source and optional local-centre matching checks with:

```powershell
node scripts/reconcile-sppb.mjs "C:\Users\CHANYULE\Downloads\Short Physical Performance Battery (SPPB) (1).xlsx" "C:\Users\CHANYULE\Documents\GLOWBB_Dashboard\data\centres"
```

## Implementation and verification

Core files: `server/sppb-domain.js`, `server/sppb-routes.js`, `src/sppb-ui.tsx`, `src/sppb.css`, migration 007, `scripts/reconcile-sppb.mjs` and `tests/sppb.test.js`. Integration points: platform initialization/routing, PostgreSQL table adapter, chunked uploads, centre URL routing, both navigation shells, Data Management and Participant Needs profiles. Earlier client-registry changes in this checkout are preserved.

Tests cover source reconciliation and original-file preservation, native/serial dates, matching, all four centres, shared identities, attendance-only access denial, protected staging, reprocessing, duplicate imports, source conflicts, original scores, approval/version checks, comparison dates, calendar reassessment, coverage, profile-history API, exploratory participation, revision conflicts, permissions, real XLSX/print exports and transaction rollback with retry on SQLite and PostgreSQL. UI regression checks cover the ninth profile tab, retained drafts, pending-score labels and deferred member-history loading.

Final local checks: **332 tests passed, zero failures or skips**, plus lint, TypeScript checking, production build and `git diff --check`. Source assertions ran against the supplied XLSX. The earlier profile-tab count assertion was updated for the added SPPB section; an existing participation test now waits for its four background Q&A requests before asserting the request count.

The browser preview host was unavailable in this session. Automated DOM checks and responsive CSS do not establish visual desktop, tablet or mobile behavior. No hosted migration, data import or deployment was performed. The source scoring discrepancy remains unresolved until the organisation supplies and approves the scoring protocol.
