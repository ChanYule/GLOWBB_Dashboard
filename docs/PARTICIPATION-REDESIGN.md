# Participation analysis fix and compact interface

## Diagnosis and evidence

**Follow-up screenshot: `path` identified.** The subsequent screenshot explicitly reports the rejected key as `path`. Reproduction confirmed that the old hosted fix removed Vercel's own `req.query` property but did not remove a `path` value embedded in the request URL itself. Express then parsed that reserved routing value as an analytical filter and rejected it. The shared request-boundary normalizer now strips only the reserved `path` query key from hosted, proxy and direct-server requests. The actual endpoint pathname and all legitimate analytical filters remain unchanged. Unknown audience filters and invalid dates still fail their existing checks. Hosted regression tests cover URL metadata plus an own query property, repeated path keys, preserved dates/population, programme-type analysis and proxy forwarding. No data or metric substitution is involved. The earlier saved-preference issue below remains separately fixed.

The exact combination **Overall Programme Planning → All attendance participants → Age Group → 4 May–5 November 2026** is valid. It is not a registry-only dimension, a date-format error or an unsupported population.

The routing follow-up passed the full **187-test suite**, lint, type checking and production build. It requires deployment of the updated API/backend; no SQL migration, data reset or preference reset is required.

The old generic message came from the API's strict parameter-shape guard: an unsupported key, a non-string value or an oversized value caused rejection before calculation. The frontend copied the entire stored `patterns` preference object into its API query without validating it. A saved view containing obsolete `preset`, `metric` or routing metadata reproduces the failure even though its visible selectors are valid. Saved scope/dimension/ranking values could also become incompatible. The frontend now normalizes legacy preferences before constructing a request; the save endpoint uses the same normalizer. Valid dates and supported analysis choices are retained, and staff receive an explanatory notice. Normalization updates the loaded view; saving persists the repaired preferences without replacing other workspaces.

The supplied screenshot description did not contain the failed network request or hosted preference record. Therefore the exact offending production key cannot be established from this local checkout. The verified defect above is fixed and tested; the valid selector combination is covered independently against the actual workbook. The existing hosted handler already removes Vercel's own query-property routing metadata so Express can parse the original URL. Unsupported live API parameters still fail validation with actionable information; arbitrary sensitive filters are not silently accepted.

A second issue made otherwise valid attendee analysis unhelpful: the old privacy gate demanded identical full-profile/attendance-history cohorts even for a single demographic distribution across the complete attendance history. That could withhold every age category. Canonical single-dimension distributions now use category-size and complementary suppression. Custom periods, domain slices, dated profiles and combined comparisons retain full-history differencing protection. Programme rankings, repeat cells, small cells and complements retain their existing protections. There is no blanket privacy bypass.

## Compatibility rules

`shared/participation-compat.js` supplies the browser and server with population capabilities, staff dimensions, allowed query keys, saved-view normalization and metric compatibility. The API still validates delivered dates, permission and privacy rules.

| Population | Eligible people | Available metrics | Client coverage rates |
|---|---|---|---|
| All attendance participants (all ages) | Distinct registered and non-client attendees in the selected period | Unique reach, entries, average sessions, repeat opportunity, distributions, programme rankings, domains and Event Types | No |
| Registered clients | Eligible complete registered population, including nonattenders | Registered, attended, no recorded attendance, coverage, distributions, reach and repeat metrics | Only with complete verified registry and delivered attendance |
| Registered clients with attendance | Registered clients who attended during this period | Attendance-based distributions, programme choice and repeat engagement; explicitly a subset | No |
| Senior participants aged 60+ | Attendees with recorded age at least 60 | Senior attendance-based distributions, programme choice and repeat engagement | No |

Age groups are **Below 60, 60 to 69, 70 to 79, 80 and above**. Below 60 is excluded only for the explicit senior-only scope. Missing/unknown ages remain distinct where relevant and are never assumed to be senior.

Age, CFS, SRF, race, gender and living arrangement are available across the four populations, subject to privacy protection and recorded data. Residential block/distance analysis uses the full client population and reviewed location bindings; selecting it switches to the compatible population with a notice. Unverified buildings stay visibly unverified; block numbers never establish a street. Event Type retains its overlapping session classifications and uses the existing protected programme-type calculation.

A requested client-rate metric changes to unique reach for an attendance-based population. Labels and population notes explain the denominator. An incomplete registry gives direct guidance and a **Use all attendance participants** action. Withheld values remain unavailable, never zero.

## Interface and workflow

Open **Staff Tools → Participation Patterns & Insights**. The subtitle is now: “Understand who participates, which programmes attract them and where engagement gaps exist.”

- **Analyse by** replaces nine large wrapping buttons with one accessible selector.
- Preset, population, reporting period and **More filters** share a compact row. Available history, last three/six months and custom dates retain the selected dimension.
- **More filters** exposes dates, profile basis, location measures/destinations when relevant, saved view and reset. The separate advanced comparison remains collapsed until requested.
- **Presentation / PDF** and **Refresh analysis** sit beside the analysis selector. Refresh requests the selected analysis, rather than refreshing unrelated dashboard sections.
- Up to four KPI cards show the relevant population, selected-group attendance, valid coverage/programme variety and average sessions. Characteristic completeness replaces an unavailable average; withheld metrics are never presented as zero.
- The main comparison occupies roughly 60% of the desktop row; top-five programmes occupy the remaining space. A compact ranked list avoids a wide scrolling table in the narrow column. Staff can change the group/ranking, open programme details and view all results.
- Repeat engagement and planning implications follow below. Tablet/mobile widths stack the two main panels. Existing navy/teal styling is retained.

The default view uses all attendance participants so staff can see useful analysis before a registry is imported. When no group is explicitly selected, the largest releasable participant group supplies the initial ranking. Staff can still select any other group. Changing dates does not reset the dimension or entire dashboard.

## Errors, reporting and performance

API failures preserve selected filters and previous valid results, with **Retry participation analysis** and **Reset filters**. A genuine zero-person date selection explains that no records match. Missing registry/location prerequisites and unmapped SRF values have specific guidance. A privacy-withheld result is distinguished from an empty dataset.

Presentation uses the actual population label, including the attending-client subset and seniors. Attendance-only reports show unique reach rather than an unavailable registered-client rate. Existing export restrictions, four-section participation PDF, Event Type PDF and protected location reports remain in place.

Only the selected dimension is grouped. Full-characteristic privacy signatures are constructed only for custom/combined slices that require them; canonical distributions avoid that additional work. Existing planning snapshots and request coalescing are reused. Obsolete requests are aborted, filter changes are debounced, and previous results remain visible during updates. Location administration, block details, programme classifications and advanced comparisons load on demand. No geocoding or routing request is triggered by navigation. No aggregation cache was added, so imports/settings cannot leave a stale cache behind.

## Validation and delivery boundary

The latest attendance workbook was read without modifying it or the saved workspace. Its exact requested date/population/age scenario returned **417 unique participants**, all four age bands, valid top-programme results and no client-rate denominator. Unique counts were checked independently from source identities, including the below-60 count. Tests also exercise all four populations, each demographic dimension, incompatible residential scopes, malformed saved views, missing values, empty periods, repeat opportunity, API failures, permissions, preferences and protected exports.

The full suite passed **185 tests**, with no failures or skipped tests. After the final KPI/PDF display changes, the focused participation/source/UI suite also passed **54 tests**. Lint, strict type checking and production build passed. Browser QA passed **136 checks** across 1440, 1366, 1024, 768 and 375 pixel viewport widths, without horizontal page overflow, visible errors or runtime exceptions. Participation/location reports retained four PDF pages, and the Event Type report retained three. A final management-print check also passed.

Benchmark artifacts are `data/performance-participation-before.json`, `data/performance-participation-after.json`, `data/performance-participation-after-repeat.json`, `data/performance-participation-final.json`, `data/participation-patterns-before.json` and `data/needs-layout-qa/patterns-performance.json`. Main-page readiness measured 557 ms before and 667/456/598 ms in subsequent runs, with the same requests and response sizes. Warm overview API medians ranged from 36–48 ms versus 41 ms before, so no consistent whole-dashboard speed improvement is claimed. The final selected-age API median was **42.89 ms**, versus **54.63 ms** before; this includes the larger initial ranking group. The entry grew by just 99 bytes (315,705 to 315,804 bytes), with the participation page remaining a separate lazy chunk. Measurements are local loopback HTTP/SQLite results and include parsing and aggregation; they do not establish hosted latency or device performance. Different runs vary, especially with concurrent tests.

No SQL migration, login change, data replacement or source-workbook write is required. The work is local; hosted deployment and the original failed production payload remain outside the verified evidence. Small or reconstructable comparisons can still be withheld, and observed demographic/distance associations do not prove barriers or programme outcomes.
