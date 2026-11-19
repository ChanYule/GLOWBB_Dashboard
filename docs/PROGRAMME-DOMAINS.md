# Programme Domains

Programme Analysis and Participation Patterns now use one session-level classification. The only reporting domains, in display order, are **Physical, Cognitive, Learning, Social and Volunteerism**.

Both source AAP Domain and Activity Name/Event Type contribute. Commas and ampersands separate exact tokens; trimming and case normalisation are allowed. Duplicate tokens count once. The explicitly authorised spelling `Volunterism` maps to Volunteerism. Programme names, substrings, plus signs and related phrases do not imply a domain. For example, `Cognitive stimulating activity` needs an administrator-approved exact mapping.

## Staff workflow

Open **Programme Analysis → Programme Domain Analysis**. The centre and reporting period follow the dashboard selection. Choose a mix measure and one Programme Domain to rank its top five programmes by unique reach, attendance or repeat participation. Select a programme to open its existing performance detail. Participant-group comparisons support age, gender, race, CFS, SRF, living arrangements, client participation and validated distance. The existing eligibility, centre permissions and privacy rules still apply.

The comparison table shows reach, repeat opportunity and demographic reach. Breadth counts distinct recognised domains attended in the selected period. Advanced programme details and **Raw source audit** start collapsed. The raw matrix remains available only within that audit. **Present / export domain report** fetches the protected export before presenting; sensitive group comparisons must be reset before sharing. The printed report includes its period, centre, population, definitions and all programme detail rows for the selected domain.

**Save domain view** stores separate Programme Domain preferences and preserves previous staff preferences. Earlier Event Type views remain accessible within the raw audit. Dashboard dates take precedence over saved dates. Cached read results are isolated by centre, reporting mode and request parameters, expire within 15 seconds, and are cleared by writes or an explicit refresh.

## Counting

- A multi-domain session contributes once to each applicable domain, but once overall.
- Unique reach uses distinct participants; overlapping domain reach is never summed into an overall total.
- Attendance deduplicates participant/session membership in the analytical report.
- Programme rankings use only delivered sessions carrying the selected domain. Two sessions with different domains do not create repeat participation within either domain.
- Repeat means two or more distinct sessions of the same programme within the period and selected domain. Opportunity requires at least two qualifying delivered sessions of that programme.
- Sessions without any recognised domain retain their attendance and overall reach. Their count appears in Data Quality and the domain report; they are excluded from the five-domain charts. Unclassified is not a sixth reporting domain.
- Programme-domain labels describe recorded objectives, not achieved outcomes or the cause of participation differences.

## Import and configuration

Attendance imports accept either source classification column, both columns, or neither. Other required attendance fields still apply. New imports retain literal AAP Domain and Event Type on each session, so recurring programmes can have different classifications on different dates. The original programme-level source field remains intact. Reviewed merges preserve earlier source values in session history. Conflicting classifications within the same incoming session retain the conflicting source values and warn staff; they do not discard valid attendance.

Open **Dashboard Configuration → Approved demographic and programme mappings → Programme Domains (approved exact aliases)** to enter the exact source phrase and one or more of the five approved domains, separated by commas or ampersands. Review and confirm the configuration change. Analytics derive classifications using the current approved mapping; import-time derived values are not treated as permanently authoritative. The older reviewed Event Type mapping workflow is also recognised when its approved display label resolves to exact approved domain tokens.

Existing sessions with no stored session-specific AAP source fall back to the original programme-level source. A classification history that was never imported cannot be reconstructed. Reimport reliable source records through reviewed Merge when corrections are needed.

No SQL migration, new table or dependency is required: source/history fields use existing session JSON storage, and derived classification is computed on backend snapshots. Existing session and participant IDs, attendance records and client-registry membership remain unchanged. Current imports and manual source reconciliation reuse the shared parser. This change does not create or enable a CaritaHub connector or scheduled synchronisation.

## Verification

Tests cover exact parsing and aliases, missing fields, multi-domain overlap, recurring-session differences, reviewed source corrections, distinct reach, repeat opportunity, demographic selections, small-group withholding, isolated four-centre imports, raw-value preservation, protected exports, staff preferences and the simplified UI. Existing SQLite and PostgreSQL regression tests continue to run.

Local verification: the complete `npm test` run passed **344 tests**. Subsequent focused UI/domain tests passed **76 tests**, and focused patterns, diagnostics, social-risk and SPPB tests passed **47 tests**. Lint, TypeScript checking and the production build passed. These are local automated results, not a hosted acceptance check.

The recorded synthetic benchmark in `programme-domains-performance.json` uses 2,400 source rows and 400 registered clients in memory. The Programme Domain report measured 16.99 ms median over nine warm loopback samples. This is an API measurement, not a browser, network or hosted performance claim. Reproduce with `node scripts/measure-dashboard.mjs <output.json>` after building.

Native/browser control was unavailable during this implementation; visual layout, PDF pagination on a real browser and hosted operation were not verified. No source workbook or saved operational workspace was imported, modified or deployed for this task.
