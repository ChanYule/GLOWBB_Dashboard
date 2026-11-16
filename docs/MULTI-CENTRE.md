# Multi-centre staff dashboard

The existing application now serves GLOW Bukit Batok, SEEN Bukit Batok, GLOW Nanyang and SEEN Nanyang under **Programme & Outreach Dashboard**. All existing analysis pages share one interface. This is a repository implementation; no hosted deployment or historical allocation was performed.

## Staff workflow

1. Select an authorised centre in the persistent header. Dates carry across; programme-specific filters and page drafts reset. The selected centre appears in the header, browser title and reports.
2. Use the existing attendance, client, programme, participation, needs, planning, operations and location pages. Every request runs inside the selected centre's workspace. Below-60 attendance remains available without turning those attendees into clients.
3. Upload attendance using **Import attendance**. Review the four centre counts, duplicates, validation issues and classification exceptions. Confirm only after resolving unclassified rows and any centres outside your access. The completion screen lists per-centre receipts.
4. Import each centre's client registry through its existing Client Engagement workflow. Attendance alone never establishes membership. Rates remain unavailable without a complete, verified centre client denominator.
5. Administrators use **Centre administration & comparisons** to review historical allocation and staff access. Management comparison requires its own permission and includes only authorised centres.

## Classification and imports

`shared/centres.js` is the reusable classifier. Stable IDs are `glow_bukit_batok`, `seen_bukit_batok`, `glow_nanyang`, `seen_nanyang`.

| Source Centre/Centres | Activity Name         | Destination      |
| --------------------- | --------------------- | ---------------- |
| Bukit Batok           | GLOW - Stretch & Flow | GLOW Bukit Batok |
| Bukit Batok           | Healthy Cooking       | SEEN Bukit Batok |
| Nanyang               | GLOW Kopi Talk        | GLOW Nanyang     |
| Nanyang               | Art and Craft         | SEEN Nanyang     |

Location matching trims whitespace and ignores casing. Only the exact two locations are accepted; conflicting Centre/Centres columns require review. GLOW must be the initial standalone prefix, ignoring case and leading spaces. GLOWING, GLOW2 and names containing GLOW only in the middle default to SEEN. Blank names remain invalid even with a centre override.

Administrators can override individual rows or explicitly apply one evidenced centre to all unresolved rows. Source names, raw locations and reviewed reasons remain preserved; no prefix is removed. Existing Member ID matching and session validation are retained. Imports support Add/Merge and preserve other centres and prior records. Full replacement through the mixed-centre importer is disabled; reviewed deletion/recovery remains available within each centre.

Each centre commits atomically. A mixed-centre import is **not** one distributed transaction: a later failure may follow an earlier successful centre commit. Retry the same preview within its 20-minute validity to resume and return existing receipts without duplicating committed attendance. After expiry, re-upload and inspect again; existing attendance deduplication still applies. Previews contain temporary source data, are user-owned, and cannot be used after expiry. Expired preview storage is pruned on the next attendance upload, not by a background timer.

## Data architecture and migrations

The audit found existing analytics and staff workflows built around a complete workspace. To retain their counting, privacy and recovery behavior, the upgrade uses **isolated centre workspaces**, rather than duplicating pages or relying on hundreds of optional SQL filters.

| Scope                                         | SQLite                            | PostgreSQL                          |
| --------------------------------------------- | --------------------------------- | ----------------------------------- |
| Identity, grants, preferences, legacy archive | Existing root database            | Existing private `glowbb` schema    |
| Each centre's full workspace                  | `data/centres/<centre-id>.sqlite` | Private `centre_<centre-id>` schema |

Programme identity is `(centre ID, local programme ID)`. Identical names/IDs in different centre namespaces never join automatically. Profiles, affiliations, registries, attendance, sessions, targets, mappings, addresses, saved views, previews, actions and recovery snapshots are scoped together. There is no automatic cross-centre profile synchronisation or shared programme template linking.

Migration **006_multi_centre.sql** adds centre metadata, grants, personal centre preferences, identity verification policy and durable historical allocation intents. PostgreSQL tables have RLS enabled and deny PUBLIC/anon/authenticated access. The trusted backend database role creates each private centre schema lazily using existing migrations 001–005. It must have the corresponding schema/table DDL privileges. No browser database credentials or search-path switching is used.

SQLite applies additive setup automatically. Existing root analytical rows remain untouched in a protected, unassigned archive. New centre stores start empty, with an incomplete registry and an unverified blank reference address. Block 212 is never inherited by Nanyang or SEEN.

### Historical review

In **Review historical allocation**, map programmes using source evidence, record a review reason, and inspect the preview. Earlier registry affiliation can be copied only to GLOW Bukit Batok. Earlier settings, targets, actions and personal views need an explicit destination; legacy location configuration can go only to GLOW Bukit Batok. Ambiguous programmes can remain unassigned. If a legacy programme contains sessions from multiple actual centres, keep it unassigned and prepare a corrected source export; this migration maps whole programmes, not guessed individual sessions.

Confirm by typing `MIGRATE REVIEWED RECORDS`. A full server-side legacy recovery snapshot precedes copying, and can be downloaded through **Show legacy recovery snapshots**. Target conflicts stop that centre transaction rather than overwrite existing records. Source rows remain in the archive, excluded from live centre analytics. Completed allocations are recorded; pending allocations can resume only into their reviewed centre. The same source programme cannot be allocated to a second centre. Source changes invalidate the preview.

Migration recovery downloads contain sensitive source records and settings. Keep them in approved staff storage. The retained archive and backup support administrator recovery; there is no automatic cross-centre rollback button for an already completed historical allocation.

## Access, settings and reporting

Authentication and roles remain central. Existing administrators receive initial access to all four centres and comparison permission; existing non-admin accounts receive GLOW Bukit Batok only. New accounts receive no centre grant until an administrator assigns it. A viewer never gains protected management comparison through a grant. Every API request checks current grants, including exports, profiles, settings and imports. Centre context is mandatory; conflicting header/query context is rejected. Account/role checks remain authoritative in the root database.

Production requires staff sign-in by default, even if `DASHBOARD_AUTH=0` was previously used. Local development can retain direct access without setting `DASHBOARD_AUTH=1`; keep that mode bound to loopback. Production administrators create staff through the existing `scripts/create-staff.mjs` workflow, then assign centre access in the new panel.

Global settings are branding, roles, access and the exact-ID verification policy. Metric definitions remain shared code. Centre settings are existing approved formula parameters, targets, mappings, reporting configuration, registry status and verified address. Personal saved views remain personal and centre-specific; the preferred centre is global per staff account. Changing a personal view cannot alter stored metric settings.

The optional comparison supports all authorised centres and the requested GLOW/SEEN location pairs, with dates, coverage, senior thresholds, aggregate counts, verified client rates, CSV and Print / Save as PDF. Count differences do not establish performance or causation. Definitions and coverage can differ: use matched periods and review centre settings before comparing.

Combined senior reach is withheld until an administrator records source evidence that exact Member IDs are globally unique. Once verified, matching opaque IDs are counted once across selected centres; centre uniques are never summed. Unknown/locally reused identifiers must not be declared globally verified. Membership remains separate in each centre regardless of this policy. No personal participant rows are included in the comparison export.

## Hosting and first use

1. Back up the existing database and deployment configuration. Do not point a disposable development run at production.
2. For PostgreSQL, retain migrations 001–005 and apply 006 using the trusted backend role. Set server-only `DATABASE_URL`, `APP_ORIGIN`, and staff sign-in configuration; the runtime also applies additive 006 setup. Confirm the role can create private centre schemas. No source records are allocated by running SQL.
3. For SQLite, persist and back up both the root database and **all** centre files together. `CENTRE_DATA_DIR` optionally changes the centre directory; otherwise it is beside `DB_PATH` in `centres/`. A Vercel filesystem is not durable SQLite hosting. Use PostgreSQL or the existing proxy to a persistent backend.
4. Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build`, then start the server. Ensure the frontend and backend are upgraded together; old centre-less API clients are intentionally rejected.
5. Assign staff access, review historical allocations, import the appropriate centre registries, and verify each centre's reference address before distance analysis. Do not attest global Member IDs without source evidence.

The local database artifact inspected at the start had no attendance/programme rows. That observation does not establish what is in the hosted database or supplied workbooks. No saved user database was used for synthetic QA, and no real historical migration was confirmed.

## Validation and performance

- Full automated suite: 288 passing tests, including prior analytics and new classification, four-centre idempotent imports, affiliation/denominator separation, exports, saved settings, permissions and centre-switching tests. SQLite and in-process PostgreSQL both pass. Additional reviewed-allocation assertions also pass in the focused suite.
- Browser: synthetic in-memory fixture at widths 1440, 1024, 768 and 390. Checks cover existing participation/client analysis, all three other-centre switches, empty states, comparison tables, all ten print columns and page overflow. Screenshots and results are local under `data/analysis-polish-qa/`. These are Chromium viewport checks, not physical tablet tests or hosted validation.
- Typecheck, ESLint and Vite production build passed.
- Centre apps/stores are reused, only the selected workspace is read, and in-flight browser GETs coalesce by centre. Centre changes invalidate prior responses and remount page state. Existing pagination and lean overview calculations remain intact. There is no shared cross-centre analytics cache.
- Repeatable benchmark: `node scripts/benchmark-multi-centre.mjs`; raw results in [MULTI-CENTRE-BENCHMARK.json](MULTI-CENTRE-BENCHMARK.json). With 1,000 synthetic participants and 1,110 entries, local overview median was 17.15 ms before / 15.68 ms after; participation analysis was 26.36 / 31.26 ms. Small differences include timing noise and authorization overhead. No general speedup, hosted-latency or production-load claim is made.

The nine implementation phases are covered by the architecture audit, additive control migration/classifier, reviewed imports, global selector, isolated reuse of existing analysis, neutral branding, scoped settings/access, management comparison, and the automated/browser/performance validation above. Operational deployment, verified source mappings, registry attestations and centre addresses remain administrator setup steps.
