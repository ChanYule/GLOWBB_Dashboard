# Location, distance and participation

Open **Staff Tools → Participation Patterns & Insights → Location & Distance**, or use the location-analysis button in **Client Engagement & Outreach**. The three main staff pages stay unchanged. Residential location is an optional analysis, not a requirement for importing attendance or using the main dashboard.

## Reading the analysis

The four headline cards show verified residential locations, registered clients with attendance, clients with no recorded attendance, and the selected distance group's participation rate. The denominator includes registered clients without attendance and those with unknown locations. The selected reporting period and existing population rules apply. Verification coverage and availability of the selected distance measure are reported separately.

Choose walking-route distance, estimated walking duration, or straight-line distance. These are separate measures: straight-line distance never silently substitutes for a missing walking route. Default distance bands end at 500, 1,000 and 2,000 metres; duration bands end at 5, 10 and 20 minutes. Administrators can change these reporting bands. They are not clinical or accessibility thresholds. A route provider's walking time is not a senior's personal journey time.

**Main GLOW BB centre** compares residential distance to the reference centre against attendance across all recorded venues. Selecting a verified programme venue includes only sessions whose recorded venue name exactly matches that destination. Centre distance does not establish the distance travelled to every programme.

The protected residential-block table supports search, sorting and pagination. Start with the number of clients with no attendance, then consider the population and participation rate together. Expand **Explore Distance and Other Factors** to compare CFS, age, SRF, living arrangement, gender, race or participation status. These are descriptive comparisons and within-group findings, not a statistically adjusted causal model. Small and reconstructable groups retain the existing suppression rules.

Programme reach, repeat participation, timing comparisons and reported transport barriers help staff decide what to investigate. Unknown or unassessed feedback is not evidence that a barrier is absent. Explicit participant/caregiver responses and staff observations are distinguished. Conflicting same-date transport responses are not treated as a confirmed answer.

**Record proposed location follow-up** opens the existing action editor with a draft. Review evidence, owner, dates and the proposed action before saving. Nothing contacts clients or starts an outreach campaign automatically.

## Administrator setup

1. Expand **Administrator location verification**. The supplied reference address is **Block 212 Bukit Batok Street 21, #01-237, Singapore 650212**. Its coordinates initially remain unverified; no real coordinates have been invented or seeded.
2. Review the centre's coordinates and source, then explicitly confirm verification. The centre's display address retains its unit number.
3. Enter a residential building using block plus street, or a six-digit postal code. A block number alone is ambiguous. Do not infer a town or street from a block number.
4. Search OneMap when configured, or enter coordinates manually from a reliable source. Search candidates remain awaiting verification. Review the building, coordinates and source before marking it **Verified**. Other statuses are **Awaiting verification**, **Ambiguous** and **Unable to locate**.
5. Open client matching, select the specific reviewed clients and confirm the address match. Selecting a page only selects checkboxes; saving is explicit. Repeated raw block numbers on different streets must not be merged. Changed source addresses invalidate previous bindings.
6. Optionally review programme venues using their exact recorded venue names. Refresh walking routes explicitly after both building and destination coordinates are verified.

Search sends building-level address data only. Route requests send building and destination coordinates only. Names, Member IDs, unit numbers, demographics, health information and attendance history are not sent to OneMap. Matching does not edit participant identities or attendance.

## OneMap and caching

Configure credentials on the **backend only**, using `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` for token renewal, or `ONEMAP_TOKEN`. Never use a `VITE_` prefix or commit credentials. OneMap currently requires an authorization token for [search](https://www.onemap.gov.sg/apidocs/search) and [walking routing](https://www.onemap.gov.sg/apidocs/routing); see its [authentication documentation](https://www.onemap.gov.sg/apidocs/authentication).

Search results are cached per distinct building for seven days. Walking routes are cached per verified building/destination fingerprint for 30 days. Changing coordinates or verification invalidates the applicable route. Straight-line measurements are calculated separately from verified coordinates. Refresh processes up to three buildings per request, shows progress, supports stopping after a batch, and reuses valid cached routes unless explicitly forced.

Provider requests have timeouts, bounded retries and rate-limit handling. Partial results are retained. A temporary provider failure retains a still-valid cached route without extending its original age; a definite missing route does not retain that route as current. Missing services or coordinates leave walking measures unknown. Opening a chart or navigating the dashboard makes no external geocoding/routing calls.

## Database, privacy and recovery

New migration: [`005_locations.sql`](../supabase/migrations/005_locations.sql), after the existing migrations 001–004. The server can initialize this migration on first location use when its database role has the required rights. For a restricted hosted role, run the SQL through the existing Supabase SQL Editor workflow first. Vercel server packaging includes the migration file.

Reviewed locations, bindings and caches live in a private, revision-controlled `location_store` row. PostgreSQL enables row-level security and revokes direct public, anonymous and authenticated-client access. Existing server permissions govern requests: administrator review endpoints remain administrator-only, while protected analysis follows existing planning/report permissions. Conflicting revisions require reloading rather than silently overwriting another review.

Analysis responses do not contain residential coordinates or Member IDs. Shared management exports exclude residential-block drill-downs and home details; existing small-group protections apply. There is no map with invented or unverified markers. Public-transport journey estimates and individual accessibility/vulnerability scores are not implemented.

Backups include location records. Restoring an older backup without a location table preserves current location settings. Programme-data reset preserves reviewed centre/building settings while clearing client bindings; normal typed confirmation and recovery safeguards remain in place.

## Validation and limits

The full automated suite passed **167 tests**, including 12 focused location tests. Lint, strict type checking and the production build passed. The location tests cover ambiguous/invalid addresses, explicit verification, exact client/source matching, band boundaries, routing units and failures, cache expiry and invalidation, deduplication, non-attender denominators, demographic comparisons, repeat participation, suppression, permissions, exports, reset and backup compatibility. SQLite and PostgreSQL-compatible PGlite paths are exercised. UI tests cover reviewed candidates and draft action creation. The full regression run also verified existing PostgreSQL registry imports before optional location storage has been initialized.

Browser QA used the supplied attendance and registry workbooks in an isolated in-memory application: 3,343 attendance records and 1,473 clients. It passed 125 page/viewport checks across five viewport sizes with no horizontal page overflow, visible errors or runtime exceptions. The location presentation generated four PDF pages. Residential distance remained unknown because the source addresses had not been reviewed. The saved application database was not populated by QA.

The main JavaScript bundle changed from 313.21 kB before this upgrade to 313.46 kB; location review and block-table interfaces load as separate chunks. A repeatable five-request local benchmark measured a 50.61 ms median for distance analysis and 42–73 ms across the other dimensions in this run. These include local HTTP and aggregation; they do not establish hosted performance or a speed improvement. Regenerate with `scripts/check-needs-layout.mjs` and both workbook paths; measurements are written to `data/needs-layout-qa/patterns-performance.json`.

No OneMap credentials were configured locally. Provider behavior was tested with controlled responses; live geocoding and route accuracy remain unverified. No hosted deployment, production Supabase migration or physical-device validation was performed. Configure credentials and review the centre/building coordinates before expecting meaningful distance findings.
