# Supabase egress and dashboard performance

Implementation date: 24 November 2026. Local implementation and validation only; no production database, billing account or Render deployment was accessed.

## Findings and evidence

The application uses `pg` from the Render backend, not the browser Supabase Data API. Each centre already has its own PostgreSQL schema. The principal source-level problem was repeated **full-centre JSON snapshots**, not routine fetching of all four centres. `server/postgres.js` combined participants, programmes, sessions and every attendance row into one result. One database row could therefore contain megabytes. `readPlanningState` added profiles, feedback and registry rows. A small browser summary did not imply a small PostgreSQL result.

On the synthetic baseline, a 3 KB dashboard context response downloaded approximately **4.33 MB** of database result JSON on every visit, including unchanged repeat visits. This establishes a code-level waste pattern; it does not attribute the user's reported 6.24 GB bill to a particular endpoint without production traffic evidence.

Supabase distinguishes database/Data API and Shared Pooler egress. Data sent over the PostgreSQL connection still matters; a browser or CDN-only optimisation would not fix this path. See [Supabase egress documentation](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

## Database request inventory

[Machine-readable inventory](database-request-inventory.json) covers the literal routes and SQL prefixes in the server. Regenerate with `node scripts/audit-database.mjs`. It is a static inventory, not a production traffic log. Dynamic adapters and the principal request families are described below. Row counts and result sizes depend on the selected centre and source data; unknown production measurements are not invented.

| File / function | Endpoint or workflow | Database operation and original frequency | Rows / estimated transfer | Purpose and action |
| --- | --- | --- | --- | --- |
| `postgres.js/readData`, `needs-domain.js/readEffectiveData` | `/api/dashboard` | Full core snapshot plus profile read on each visit/filter | One JSON row containing all centre facts; 4.33 MB in baseline | Context and Overview now use SQL aggregates. Full detail remains available on demand and has an aggregate-response cache. |
| `app.js/dashboard` | Dashboard targets | Repeated JavaScript analysis for each target period | Reused full dataset; repeated CPU calculations | Exact SQL target summaries; shared target scopes reused within the request. Main staff pages explicitly skip unused target calculations; saved targets and default legacy API behaviour remain. |
| `pattern-routes.js/report` | `/api/participation-patterns` | Full planning snapshot for selected dimension | All centre attendance/profiles on a cold calculation | Bounded, revision-aware aggregate cache. Existing protected cohort definitions retained. |
| `event-routes.js/report` | `/api/programme-domains/report`, `/api/event-types/report` | Full planning snapshot on each filter/navigation | Full-centre facts on a cold calculation | Cache final aggregates, not raw participant snapshots. |
| `client-routes.js/readState` | `POST /api/clients/report` | Full planning snapshot | Full-centre facts before aggregate calculation | Cache aggregate response by canonical request body and staff identity. |
| `client-routes.js` | Outreach, priorities, follow-ups, data quality | Full planning snapshot before audited filtering/pagination | All centre facts; browser lists already paginated | Identifiable lists remain uncached. This is a remaining cold-query optimisation opportunity. |
| `needs-routes.js/report` | `/api/needs/overview` | Full planning state and protected calculations | All centre facts on cache miss | Cache final aggregate response; existing suppression and denominators preserved. |
| `needs-routes.js` | `/api/participants/:id` | Previously full planning state for one profile | Previously entire centre | SQL now retrieves only the selected participant, their source attendance, relevant sessions/programmes, profile and feedback. |
| `sppb-routes.js/context/report` | `/api/sppb/overview` | Previously full planning state plus matching historical assessments | Previously centre attendance plus full score source JSON | Thin membership metadata, compact score projection and exact attendance windows; default overview caches aggregates with no individual rows. |
| `sppb-routes.js` | `/api/sppb/members/:id` | Previously full centre context, then one member's records | Previously unrelated centre attendance | Member-scoped affiliation/profile data; only relevant attendance windows and the requested full source history. |
| `sppb-routes.js/allRecords` | SPPB import/review | Shared source scan during explicit administrator review | Potentially all SPPB source records | Full raw records retained where source review requires them. Ordinary analysis omits raw workbook cells. |
| `configuration.js` | `/api/configuration` | Previously full planning snapshot just to show settings | Previously full centre | Settings and personal preferences only. No attendance read. |
| `configuration.js/inventory` | `/api/configuration/activities` | Previously all attendance/profiles/feedback before showing 25 activities | Previously full centre | Reads programme/session classification metadata; SQL attendance totals only for the current page's programme IDs and dates. Complex matching/status logic retained. |
| `configuration.js` | `/api/configuration/history` | Previously all matching audit rows, then slice | Growing audit history | SQL `LIMIT 20 OFFSET ...` plus a count. |
| `client-routes.js` | `/api/clients/settings` | Previously full planning state | Previously all attendance | Membership metadata only. |
| `needs-routes.js` | `/api/needs/settings` | Previously all core records for mapping options | Previously all attendance | SQL distinct raw CFS, living and domain labels only. |
| `reporting.js` | `/api/reporting/briefing` | Full state on each overview/report open | Full-centre facts on cache miss | Cache final summary; source records and notes are never included in the cached briefing. |
| `reporting.js`, `analysis-routes.js`, `configuration.js` | Detailed PDF/CSV/XLSX and reviewed report builder | Explicit report/export requests | May require full selected centre state | Existing authorization, policy versions and privacy remain. Complex export calculations are retained. |
| `platform.js/access`, `identity.js` | Every authorised API request | Small identity/grant/preference/settings queries | Small fixed rows | Retained on every request; permissions are checked before cache reuse. |
| `platform.js` | Centre comparison | Explicit authorised cross-centre analysis | Selected authorised centres only | No automatic all-centre dashboard load. Exact global-ID checks remain. |
| `centre-imports.js`, `import-batches.js`, `postgres.js/saveImport` | Attendance import | Explicit reviewed, bounded, idempotent batches | Current-state comparisons during import | Existing new-row/bulk writes and recovery receipts retained; ordinary analytical snapshots omit unused source/import columns. |
| `client-routes.js`, `client-writes.js` | Registry imports and profile changes | Explicit reviewed transactions | Source comparison/history needed for conflict checks | Preserve idempotency, conflict review, history and rollback. Revision triggers invalidate affected centre caches after commit. |
| `configuration.js` | CaritaHub settings | Draft retrieval preferences | Settings only after this change | Source integration is disconnected in this checkout; there is no automatic sync job or polling to remove. |
| `operations-routes.js`, `location-routes.js` | Explicit operational/location analysis | Snapshot-based specialised calculations | Centre-specific state | Not loaded as hidden pages. No change to location verification or source definitions. |
| `data-management.js` | Backup/restore/delete previews | Explicit administrator operations | Full records intentionally needed | Never replace exact backups with summaries or cache destructive-operation previews. |

No network polling, focus refresh or Supabase Realtime subscription was found in the analytical flow. A React state setter called `setInterval` in the operations component is not a polling timer. CaritaHub is not connected in the current source.

## SQL calculation changes

`server/sql-dashboard.js` calculates exact counts in PostgreSQL for dashboard Context and Overview, including date/programme/population selections, senior reach, male/minority reach, attendance, sessions, repeats, first-observed/returning participants, cross-programme/domain engagement, monthly trends, programme rankings, previous equivalent periods and five overlapping Programme Domains.

The SQL groups carry compact, exact internal identities and a five-bit domain set, rather than repeated profile JSON or expanded domain records. These are lossless encodings within one query, not approximate distinct counts.

Session classification still uses the existing shared exact mapping definition. Only **distinct classification combinations** are retrieved, then passed back as a small parameterised mapping. Raw attendance and participant profiles stay inside PostgreSQL for this path. Profile corrections preserve the existing materialisation rules. Official, performance-only and selected-report exclusions are applied separately. Source coverage remains distinct from eligible reporting coverage.

Overall reach is computed from participant identities, never by adding monthly/domain/programme distinct counts. Attendance totals are calculated before overlapping-domain expansion. Raw unclassified sessions remain in overall totals. `Volunterism`, approved mapping aliases, explicit missing source values and multi-domain sessions retain their existing semantics.

Complex participation, needs, outreach and validated SPPB scoring still use the existing tested definitions. They were not blindly translated into different SQL approximations. Their remaining cold-workload limitations are listed below.

## Cache, revisions and security

The final aggregate cache is process-local, uses LRU eviction, defaults to 10 minutes of idle time and coalesces concurrent identical calculations. Each centre cache is bounded to 96 entries / 24 MiB, with a 2 MiB per-result limit. The shared SPPB summary cache is separately bounded to 32 entries / 8 MiB. Large results are returned without being retained. A hit extends the idle expiry only after a successful revision check, so hot unchanged results can be reused longer. Cache loss or a restart affects speed, not correctness.

Keys include workspace namespace, user ID, role, Singapore day, canonical filters/body, reporting mode, report selection/configuration version and committed database revisions. The platform checks the current centre grants before serving requests; protected routes also check staff access before invoking the cache. Cached data remains behind `Cache-Control: no-store`. No public CDN cache, browser local-storage dataset, Redis or paid service is introduced.

Migration 008 adds tiny per-schema revision rows and statement-level triggers. Attendance/imports, registry/participants, assessments, classifications, configuration, profiles/feedback, planning and locations have separate revision categories. A committed write changes the relevant centre's revision. Rollback rolls it back too. Other centre schemas are unchanged. Audit views and personal display preferences do not advance source revisions. Each cache lookup reads the small current revision vector, so another Render process or a direct authorised database change invalidates old results. A revision change during calculation prevents storing that calculation as a current cache entry.

Individual assessment histories, participant profiles, identifiable follow-up tables, source cells and import previews are not placed in the server aggregate cache. SPPB's default `summaryOnly=1` response contains no individual table rows; table/history requests remain explicit.

## Frontend and imports

The six-section staff workspace is preserved. Programme Analysis does not fetch the full programme/session detail dataset until its detail disclosure is opened. Programme details can still open from the domain ranking. SPPB defaults to its aggregate overview. Heavy modules remain lazy-loaded.

Identical cancellable GETs share one fetch. Cancelling one subscriber leaves other subscribers active; the underlying request is aborted when nobody needs it. Centre/reporting-context changes invalidate pending reads. Obsolete centre responses remain rejected. Read-only POST analysis calls do not cancel unrelated GETs or invalidate recent aggregate results. No automatic write retry is added.

The existing reviewed import workflows already insert only new attendance/SPPB records, use bulk/bounded transactions, preserve raw originals and recover committed receipts after a lost response. Those safeguards remain. SPPB relinking now performs a database-side membership match, updates only changed link flags and skips an unchanged rewrite; SQLite follows the same no-change rule. Raw source fields remain intact. New revision triggers cover successful import and configuration commits without recalculating all centres. Ordinary PostgreSQL analytics snapshots now omit attendance `source_session` and `import_id` values that their decoder never used; exact backups still read those original columns explicitly.

## Measurements

| View / visit | Database JSON bytes before -> after | Database statements before -> after | Local API milliseconds before -> after |
| --- | ---: | ---: | ---: |
| context / cold | 4,329,794 -> 4,530 | 7 -> 9 | 568.5 -> 741.2 |
| context / repeat | 4,329,794 -> 305 | 7 -> 2 | 326.3 -> 7.2 |
| context / filtered | 4,329,794 -> 4,520 | 7 -> 9 | 208.4 -> 330.8 |
| context / filtered-repeat | 4,329,794 -> 305 | 7 -> 2 | 239.7 -> 7.4 |
| overview / cold | 4,329,796 -> 23,943 | 8 -> 10 | 458.8 -> 1860.2 |
| overview / repeat | 4,329,796 -> 305 | 8 -> 2 | 516.0 -> 12.1 |
| overview / filtered | 4,329,796 -> 17,474 | 8 -> 10 | 291.4 -> 494.6 |
| overview / filtered-repeat | 4,329,796 -> 305 | 8 -> 2 | 274.0 -> 13.2 |
| full / cold | 4,329,798 -> 2,624,432 | 9 -> 11 | 797.4 -> 1309.3 |
| full / repeat | 4,329,798 -> 305 | 9 -> 2 | 778.6 -> 68.4 |
| full / filtered | 4,329,798 -> 2,624,432 | 9 -> 11 | 281.7 -> 336.0 |
| full / filtered-repeat | 4,329,798 -> 305 | 9 -> 2 | 284.8 -> 31.1 |

Artifacts: [original pre-change baseline](egress-baseline.json), [final optimised run](egress-optimized.json), [controlled legacy validation run](egress-legacy-validation.json). All **12 normalized response fingerprints** in the final run match the controlled legacy implementation; only the generation timestamp is excluded from that equality check.

Uncached database result bytes fell by **99.90% for Context** and **99.45% for Overview**. Repeat requests fell to **305 estimated bytes** (more than 99.99% less). Compact legacy-detail snapshots fell by about **39.4%** on a cache miss. Their larger browser payload remains intentionally available when requested.

Cold requests use two extra revision reads, and **the local cold calculations are slower than the original JavaScript path**. This is a measured trade-off, not a universal speed improvement: the final overview was about **1.86 seconds cold / 12 ms warm**. First-use filter calculations also remain more expensive than a cache hit. Cold SQL execution is accepted here for its substantial transfer reduction and exact results, with the remaining latency limitation made explicit. This in-process WASM PostgreSQL benchmark does not establish native Supabase query speed.

The final index check changed a 29-row member lookup from a sequential scan (**4.94 ms**) to a bitmap index/heap scan (**0.20 ms**) on this fixture. The new index occupied **1,146,880 bytes**. One-time revision/index setup took approximately **114 ms**, separately from the page timings.


The fixture contains 1,200 synthetic participants, 24 programmes, 1,800 sessions and 36,000 attendances. Both artifacts record database result rows/estimated JSON bytes, statement time, query count, API payload size, API elapsed time, process CPU and heap use. These are local PGlite/HTTP measurements, **not browser rendering, Render cold-start, network latency or production Supabase billing measurements**. The original baseline was captured before implementation. Do not treat one local sample as a latency guarantee.

Reproduce with:

```powershell
node scripts/benchmark-egress.mjs --baseline --output=data/egress-baseline-repeat.json
node scripts/benchmark-egress.mjs --output=data/egress-optimized-repeat.json
```

The baseline mode restores the old synthetic snapshot projection and disables the main aggregate cache/SQL path. It is an isolated comparison mode, not a production setting. Avoid running benchmarks concurrently with the test suite. The script does not read `DATABASE_URL` or connect to a hosted database.

## Index and storage review

Existing session-date, attendance-session, primary-key and SPPB-member indexes are retained. Migration 008 adds just `(participant_id, session_id)` on attendance to support scoped profiles and SPPB windows. The benchmark includes `EXPLAIN (ANALYZE, BUFFERS)` before/after and reports index size. Actual index size depends on identifier length and centre row counts.

No source history, old assessment, audit entry, preview receipt or backup was deleted. Backups and raw-source JSON can duplicate historical information, but retention changes need a separate policy decision. No materialised copy of every attendance row or combinatorial summary cube is introduced. Aggregate-result reuse is the selected precomputation strategy; arbitrary date ranges retain exact distinct counts.

## Diagnostics and failures

An administrator can expand **Data & settings → Performance diagnostics**. It loads only when opened and refreshes manually. `/api/analytics/diagnostics` reports bounded cache counters, database statement counts/timings, estimated result bytes, recent slow-operation summaries, source revisions, last attendance import and the disconnected sync status. Counters reset on process restart. SQL text, parameters, credentials and participant values are not logged or retained by this instrumentation.

Database failures do not enter the result cache. A failed revision check does not silently serve an unverifiable server cache entry. Existing connection deadlines and recoverable API errors remain. The frontend can retain its last successfully loaded authorised selection, with an explicit out-of-date message when refresh fails; it does not substitute invented zeros. Centre or permission context changes still clear the old workspace.

## Monthly transfer estimate

Assumptions: **10 staff x 22 workdays x 40 backend aggregate requests/day = 8,800 requests/month**; the same synthetic record volume; 70% of misses use the SQL summaries and 30% use compact legacy calculations. Add an illustrative **500 MB** allowance for clinical details/imports/exports and **3 KB/request** for platform identity/centre/settings overhead. Protocol overhead and real production volumes are not measured.

| Assumed aggregate cache hit rate | Estimated monthly application result transfer including allowances |
| --- | ---: |
| 80% | 1.94 GB |
| 50% | 4.07 GB |
| 0% | 7.60 GB |

The **80% hit scenario is about 1.94 GB**, within the requested 3 GB headroom objective under these assumptions. The zero-hit scenario exceeds 5 GB. Serving 8,800 copies of the original 4.33 MB snapshots alone would be about 38.1 GB, but this is not the user's observed traffic or a prediction of their bill.

This is a workload estimate, not a forecast or official Supabase meter. More staff, unique filter combinations, cache misses, several server processes, restarts, large source exports and repeated clinical table browsing can exceed it. Confirm with the real Supabase Database/Shared Pooler usage after deployment. Paid upgrades are not part of this implementation.

## Supabase and Render rollout

1. Use the existing Supabase project and schema owner. Run the entire additive [008_analytics_egress.sql](../supabase/migrations/008_analytics_egress.sql) in **Supabase Dashboard → SQL Editor** after existing migrations 001–007. It installs private revision tables/triggers/functions and the attendance index in `glowbb` and existing centre schemas. It is idempotent and preserves source rows. Index creation can briefly block writes; use a quiet period. Future centre schemas are supported by the application's installer.
2. The application also ensures this migration on the first optimised PostgreSQL read, using the same privileged server-side setup pattern as earlier migrations. Pre-running it avoids first-request DDL work. Keep the backend's schema-owner permissions, or explicitly grant the required private installer/trigger/table privileges to the actual backend database role. Never grant these to `anon` or `authenticated`.
3. Deploy the updated frontend and backend together to the **existing Render service**. Keep its current server-only `DATABASE_URL`, verified TLS, `APP_ORIGIN`, `HOST=0.0.0.0` and Node 24 setup. Build with `npm ci && npm run build`; start with `npm start`. Do not create a new paid service or SQLite disk from the older optional `render.yaml` template for this Supabase optimisation.
4. Optional settings: `ANALYTICS_CACHE_SECONDS=600` (up to 900); `ANALYTICS_DIAGNOSTICS=0` disables PostgreSQL result-size instrumentation. `ANALYTICS_OPTIMIZATIONS=0` bypasses the main SQL dashboard/aggregate cache for investigation; scoped profile/SPPB reads remain available. No browser credential or new external service is required.
5. After deployment, check `/api/ready`, verify authorised centre switching, compare known KPI periods, test a reviewed import and verify that a warm response becomes a miss after a committed change. Open the administrator diagnostics manually and review Supabase's own egress graph over representative usage. No production validation has been performed here.

## Validation and remaining limits

Executed locally:

- `npm.cmd test`: **366 passed, 0 failed**. Coverage includes all four centre workspaces, permissions and pending centre switches; exact distinct counts; registered-client denominators; programme/domain analysis; age/CFS/SRF/race/living/distance and repeat participation; source imports and idempotent receipts; profiles, exclusions and official/exploratory rules; saved preferences; and management exports.
- `node --test --test-isolation=none tests/egress.test.js tests/sppb.test.js`: **17 passed, 0 failed** after strengthening migration-reapply, separate-adapter revision and unchanged-SPPB-relink assertions.
- New cache checks cover user/role/centre keys, concurrent identical requests, eviction/expiry, source changes during calculation, external database changes, rollback, connection failure and recovery without inventing a zero summary.
- SQL parity covers profile corrections, explicit null/unclassified source domains, overlapping domains, current/prior periods, demographic/programme filters, target comparisons and dated official/performance/report-specific exclusions.
- Browser API tests cover shared cancellation, logout/write invalidation, obsolete centre responses, and read-only analysis POSTs leaving unrelated GETs active.
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`: **passed** on the final code. `git diff --check`: **passed**.
- Synthetic before/after benchmark and controlled legacy fingerprints: **all 12 cases match**. Index plan and byte estimates are included in the artifacts.

These are automated local checks. No production import, production migration, hosted/browser rendering test or actual billing verification was performed.

Some complex cold analyses, audited follow-up lists, raw exports and exact import conflict/recovery comparisons still require compact full-centre snapshots. They are not replaced with incorrect monthly sums, approximations, narrowed membership denominators or changed clinical scoring. Configuration activity matching still loads programme/session classification metadata before applying complex status rules; it does not load attendance/profiles for that purpose. Further SQL ports should preserve those definitions and demonstrate a measured benefit.

No monthly quota guarantee, hosted 1–2 second loading guarantee, physical-device check or browser rendering benchmark is claimed. No production deployment or paid resource was created. There are no optional paid changes awaiting approval.

## Modified implementation files

- PostgreSQL/revisions/cache: `server/postgres.js`, `server/sql-dashboard.js`, `server/analytics-revisions.js`, `server/analytics-cache.js`, `server/database-metrics.js`, migration 008.
- Routes: `server/app.js`, `server/client-routes.js`, `server/configuration.js`, `server/needs-routes.js`, `server/pattern-routes.js`, `server/event-routes.js`, `server/reporting.js`, `server/sppb-routes.js`, `server/sppb-analysis.js`.
- Tool entry points and release notes: `package.json`, `README.md`.
- Frontend: `src/api.ts`, `src/main.tsx`, `src/platform.tsx`, `src/sppb-ui.tsx`, `src/performance-diagnostics.tsx`.
- Reproducible evidence: `scripts/audit-database.mjs`, `scripts/benchmark-egress.mjs`, `tests/fixtures/egress-database.js`, `tests/egress.test.js`, existing PostgreSQL/SPPB/hosting/UI regression tests, baseline/optimised JSON artifacts and the static inventory.
