# Professional dashboard redesign: audit and delivery record

## Scope and invariants

The existing React 19 / TypeScript / Vite app uses custom SVG/CSS charts, Express APIs and isolated SQLite or PostgreSQL centre stores. The four centre IDs, client-registry denominators, all-age versus senior attendance, reporting exclusions, privacy checks, approved mappings, preferences, review-before-save imports and resumable confirmations are retained. CaritaHub has no connector and remains Not connected. No new chart library, mock production figures, source rewrite or replacement database is planned.

## Complete view audit

| Workspace | Existing source and useful question | Audit finding and implementation direction |
| --- | --- | --- |
| Overview | dashboard overview + reporting briefing and attendance summary; what changed and where should managers look? | Duplicate headers and a long default daily table; keep four headline cards, trend and top-five ranking, put precise daily/monthly register behind disclosure, show up to three supported findings. |
| Programme Analysis | full dashboard, Event Type report; which activities have reach and repeat opportunity? | Retain ranking, comparison, domain/type selector and exact classifications; standardise shared ranking and table styling, five-row default with all values accessible. |
| Participation Insights | participation-patterns snapshot; who attends and which activities serve each group? | Keep one dimension-driven layout and valid client rates; compact essential filters, group comparison beside programme ranking, methodology and advanced diagnostics after primary results. |
| Engagement frequency and recency | existing engagement metadata and session distribution; how often do people return? | Preserve configurable frequency threshold, six detailed bins, distinct-session counts and coverage anchor; use one selected breakdown, compact stacks and optional methodology. |
| Client Engagement / outreach | centre registry + client report/outreach/priorities; who has eligible attendance and who needs follow-up? | Preserve verified denominator, one selected comparison, permission-scoped follow-up tables and review-first actions; consistent cards, distribution, statuses and form controls. |
| Participant Needs | needs overview, sourced feedback and profiles; what circumstances and stated needs inform planning? | Existing selectors already consolidate dimensions; retain them, remove nested visual card duplication, standardise protected distribution and compact limitations. |
| Location and distance | verified location store + participation patterns; does attendance differ by distance or block? | Keep verification completeness, address review and exact block table; charts share category comparison and two-factor design; no fabricated map or distance. |
| Planning / detailed action tracker | existing recommendations and needs actions; what should staff review next? | Retain evidence links, proposal versus approval and action owners; reduce repeated cards and use consistent priorities and action tables. |
| Audience, SRF, serving, barriers, alignment | full dashboard or protected needs/risk endpoints; what groups, classifications or recorded barriers need review? | Keep existing privacy and unavailable states; share distribution components, move repeated definitions to optional panels. |
| Operations and screening | operational snapshots and sourced monthly assessment totals; what delivery and screening was recorded? | Retain reported versus calculated values and gaps; make chart axes responsive, preserve missing values in trends, consistent legends and exact-value tables. |
| Custom Analysis / programme comparison | current approved aggregates and saved staff views; what comparison does this staff view need? | Preserve saved chart types, columns and filters; shared bars and time-series graphics, keep optional donut presets without making them a default. |
| Reports and presentations | frozen reporting snapshots, protected exports, PresentationFrame | Preserve mode/version/centre/period and sensitive export restrictions; consistent typography, chart colours and print page breaks. |
| Centre Administration | centre access, comparison, legacy source allocation | Move infrequent entry point to sidebar; retain exact grant enforcement, distinct-ID comparison contract and reviewed allocations. |
| Configuration / sync / personal preferences | configuration JSON, audit, personal preferences | Unified shell and form design; retain five tabs, activity search, impact preview, approval, restore and explicit disconnected sync. |
| Data Management / import / settings / record editors | existing source, deletion/recovery and import APIs | Keep every validation and confirmation step; consistent table, dialog, drawer and status design. |

## Chart inventory and disposition

Every retained chart family below is reviewed at its shared renderer and all listed consumers. None of the underlying analytical capabilities is removed.

| Renderer / visualisation | Consumers and question | Data, metric and denominator | Disposition and required treatment |
| --- | --- | --- | --- |
| KpiDeck, management Cards, client/needs/pattern/operations/configuration KPI tiles | All analytical pages; what is the headline result? | Existing aggregate fields; rates retain their original eligible/known-value denominators | Keep/redesign; compact values, shared tokens, definitions via accessible disclosure. |
| TrendChart + Sparkline | Overview, audience, programme detail, presentation; how has reach or attendance changed? | Dashboard trends; distinct seniors by selected metric or all-age entries, no invented rate | Keep/redesign; responsive SVG coordinate system, zero baseline, restrained colour, keyboard exact values and full table. Sparkline remains decorative. |
| ReportBars | Overview, patterns, Event Types, reports, domains; which categories lead? | Caller-supplied labelled aggregate and detail; count versus percentage preserved | Replace duplicated renderer with shared accessible ranking bars; five default rows and View all; full report values remain available. |
| Main Bars / LineChart / stacked distribution | Programme, audience, programme drawer; which programmes/groups contribute? | Existing dashboard/programme aggregate fields; cohort-specific denominators | Consolidate onto shared bar and trend primitives; preserve selectable metric, exact table and drill-down. |
| Portfolio + DomainPortfolio | Programme/domain comparison; what is the portfolio mix? | Distinct programme/session/unique aggregates; domains may overlap | Keep/redesign; common restrained category palette and correct overlap notes. |
| DemographicBars | Audience gender/race/age/client/boundary | Existing unique-senior counts / supplied senior denominator including unknown | Shared ranking geometry, correct per-row percentage labels and keyboard filter action. |
| TimingMatrix | Programme and custom timing analysis | Existing weekday/time-slot session and attendance aggregates | Keep heatmap; consistent cells, complete labels, accessible counts and no negative or truncated scale. |
| ParticipationRateChart | Age, CFS, SRF, gender, race, living, block/distance, attendance Q&A, presentations | Participating registered clients / eligible registered clients; confidence ranges and comparison floor unchanged | Keep/redesign as horizontal comparison; keep bounds/reference/unknown and small-group cautions, compact long methodology. |
| EngagementPanel stacks | Patterns and Event Types + presentations | Distinct-session depth and recency segments / eligible people in each group | Keep/redesign; one mode at a time, explicit counts and percentages, compact legend, optional history notes, no red CFS/SRF inference. |
| Session histogram + group median/IQR cards | Selected pattern group summary | Six existing bands among participants who attended; nonattenders excluded | Keep detailed view after compact engagement summary; preserve median/IQR and exact bins. |
| AnalysisTrends monthly bars | Participation trends | Existing monthly client/first-observed/returning/session metrics, full-history anchors | Use shared trend renderer; move anchor and methodology into expandable detail, keep complete monthly table. |
| ClientChart attending/registered bars | Client selected demographic groups | Attending and registered absolute counts on one zero-based common scale | Keep grouped comparison; consistent colours and exact rate labels; retain follow-up action and source privacy. |
| Client status bars, barriers, outreach age/CFS distributions | Client engagement and outreach | Approved inactivity bands, sourced barriers or protected group counts | Keep/redesign; shared category treatment, missing and unavailable remain distinct, no inferred cause. |
| ProtectedDistribution / AnalysisGraphic bars, line, table, optional donut | Needs profiles/interests/barriers, social risk, custom views | Caller-protected series and declared respondent/profile/registry denominator | Consolidate bars and lines, preserve table and saved donut choices; missing line points remain gaps. |
| Event Type mix, domain/type matrix, diagnostic labels and domain mix | Programme, patterns, programme comparison, presentation | Existing overlapping event/domain metrics; never add unique populations | Keep configurable mix + optional matrix, share bar styles, preserve diagnostic caveats and all classification rows in print. |
| Two-factor cells and location block/distance tables | Patterns accessibility comparisons | Protected age/CFS/risk versus distance/block cohorts; verified registry denominators only | Keep as table/heatmap where suitable; shared number alignment and compact legends. |
| OperationalChart line / grouped / stacked | Operations, screening and print | Sourced counts/rates and reported assessment totals; unavailable remains unavailable | Keep/redesign responsive axes, segment missing line observations, common tooltips and exact tables. |
| ParticipationSummary daily/monthly register | Overview exact reporting | Existing daily/monthly reporting aggregates with their defined IB/OB populations | Move detailed register into expandable section; capability and CSV remain. |
| Cross-centre comparison | Centre Administration | Per-centre official totals and versions; combined unique reach only for verified global IDs | Keep exact comparison table; common table design, no misleading summed programme uniques. |
| Configuration impact and frozen report charts | Configuration + report export | Approved before/after aggregate values; fixed snapshot version | Keep/redesign; consistent cards, bars and print layout; no source deletion. |

## Baseline and validation

Baseline screenshots, API samples, startup request counts, navigation timings and entry-bundle sizes are recorded by `scripts/check-professional-ui.mjs --baseline` against synthetic data and in-memory stores. The same runner is used after implementation at 1920, 1366, 1024, 768 and 375 pixels. Results and screenshots are under ignored `data/professional-ui-qa/`. The final measurements and verification boundaries follow below.


## Delivered implementation

- One global 68px top bar, 240px sidebar with persisted collapse and a phone navigation drawer. Infrequent administration, configuration, sync and settings controls live in navigation/account areas. Embedded pages no longer render a second sidebar or toolbar. Centre, period, reporting mode and export remain accessible.
- Shared `ChartCard`, `ChartHeader`, `HorizontalRankingChart`, `CompactTrend`, `MetricCard`, loading/empty states and responsive chart measurements. Reusable form, panel and modal primitives now have their own module. The style tokens apply across analytical and administration pages.
- Question-led chart headings, labelled scales, consistent colours, keyboard exact values, responsive legends and preserved exact tables. Shared rankings show five categories initially and expose every remaining row. Print exposes all ranking rows.
- Overview shows four compact headline metrics, trend plus programme ranking, three evidence-supported findings and a disclosed daily/monthly register. No unsupported explanations of attendance have been introduced.
- Participation comparison and programme ranking precede the attendance Q&A and engagement detail. Engagement frequency/recency share one selector; the six original session bands and median/IQR remain available through disclosure. Registration context, monthly history and lengthy definitions follow the primary comparison.
- Programme rankings follow the search and selected metric; programme comparisons, classification tables, needs selectors, client outreach, operations, saved custom chart choices, location review and every administration workflow remain available.
- Fixed operational line charts drawing missing observations at zero: missing points now break the line, while recorded zero remains a real point. Custom trends follow the same rule. Source calculations and analytical API payloads are unchanged.
- Shared HTML export styling retains centre/mode/version metadata. Management reports render outside the inert dashboard shell; report controls remain active, focus returns on exit, and staff navigation is excluded from printing. Compact report cards prevent an orphaned summary paragraph.

## Performance and data boundaries

Planning and the older audience/programme detail views load in separate chunks when opened. The global shell supplies the current staff response to its child, removing the duplicate `/api/me` call. Existing abort/context protections and per-centre API keys remain in force; dates are retained across centre changes and obsolete responses cannot populate the selected centre. Shared charts reuse a number formatter and respond to their container size instead of rendering oversized fixed SVGs.

No backend aggregation algorithm, SQL index, migration, database record or persisted centre configuration was changed. Existing aggregation and query contracts remain covered by the full suite. Backend latency is reported honestly below: this redesign does not establish a backend speed improvement.

The runner uses synthetic fixtures, SQLite in-memory stores and headless Chromium on loopback. API samples are seven measured requests after a warm-up. Browser readiness is the first populated Overview KPI response; it is not an LCP measurement. The baseline has one 1366px run, while the after run also visits other widths; caching and concurrent local test load affect the timings. These are diagnostic observations, not a production benchmark or a repeatable percentage-speed guarantee.

| Measurement | Before | After |
| --- | ---: | ---: |
| Overview readiness, 1366px | 392.9 ms | 305.1 ms |
| Initial API requests | 6 | 5 |
| `/api/me` requests | 2 | 1 |
| Global header height | 135.1px, plus nested header | 68px, single header |
| Initial JS entry | 342,574 bytes | 339,205 bytes |
| Initial JS entry gzip | 101,581 bytes | 101,511 bytes |
| Overview API median / maximum sampled latency | 14.9 / 23.5 ms | 23.6 / 136.8 ms |
| Patterns API median / maximum sampled latency | 16.8 / 28.6 ms | 30.1 / 51.6 ms |
| Clients API median / maximum sampled latency | 18.3 / 25.2 ms | 24.9 / 31.9 ms |

Overview, patterns and client response sizes remain 7,793, 17,690 and 10,863 bytes. The initial JavaScript transfer reduction is modest; additional shared styling increases CSS. There is no new chart dependency. The API timings vary across local runs and do not demonstrate a backend gain.

## Verification results

- Full `npm.cmd test`: **321 passed, 0 failed**. This covers SQLite and PostgreSQL behaviour, all four centre boundaries, permissions, privacy, protected denominators, source import classification, resumable confirmation, exclusions and reporting rules.
- Final UI rerun: **66 passed, 0 failed**, including preserved zero/missing/negative chart values and keyboard exact values. Additional targeted shell/report checks: **6 passed**, including collapsed navigation, centre switching and report portal behaviour.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` and `git diff --check`: passed.
- Chromium checks: **17 major routes at five widths = 85 page/layout cases**, no page-level horizontal overflow and no recorded browser exceptions. Sizes: 1920x1080, 1366x768, 1024x768, 768x900, 375x812. Corresponding screenshots are saved locally.
- Ten additional configuration tab checks cover all five tabs at desktop and phone widths. Read-only HTML export checks confirm shared report styling and centre metadata. Presentation checks cover shell isolation, active report controls, PDF generation and return to analysis.
- PDF text inspection confirms the executive summary and final follow-up section are present and staff navigation is absent. The final PDF has six pages with no orphaned summary paragraph; a rendered first-page inspection verifies spacing and readability.

Artifacts are local and ignored by Git: `data/professional-ui-qa/before/results.json`, `after/results.json`, route screenshots, `reports/management-print.pdf` and test logs under `data/professional-ui-*.txt`. Reproduce with `npm.cmd run build`, then `node scripts/check-professional-ui.mjs`; `--reports-only` checks administration/report output separately without replacing the full page matrix.

## Limits and remaining setup

- Changes are implemented and verified locally; no hosted deployment or import into a saved database was performed. Local synthetic snapshots do not establish hosted counts or real staff-device behaviour.
- CaritaHub remains **Not connected**, as confirmed by the user. Its settings remain available; this task does not invent an integration.
- The route matrix plus shared-renderer tests cover the major page layouts and chart families. They do not exhaust every possible saved custom view, staff dataset, location combination, error condition or physical touchscreen.
- No SQL or migration is required. To use locally, restart the existing application; for a hosted release, use the existing deployment process after review. Browser cache refresh may be needed after publishing.
