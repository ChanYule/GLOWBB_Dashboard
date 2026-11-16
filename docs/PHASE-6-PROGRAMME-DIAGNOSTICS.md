# Phase 6: programme diagnostics

## Where to look

In **Programme Analysis**, the **Past programmes** table now always shows a programme diagnostic column: unique senior reach, recorded sessions, all-age attendance entries, senior repeat attendance, and any small-sample/one-off-draw cautions. Existing search, sorting, saved columns and programme-detail buttons remain available. The programme drawer includes the same diagnostic labels.

Administrators/planners can expand **Compare programme reach by participant group**, choose a characteristic/group and review programme-level representation and primary-domain mix. This comparison uses the full eligible registered-client population for the selected dates and programme domain. Other Programme Analysis filters do not apply; the interface states this explicitly. It loads only when opened and hides stale results while a query changes. Viewers cannot request it.

In **Participation Patterns & Insights → Most Popular Programmes by Participant Group**, the same diagnostics appear beside the existing unique reach, delivered sessions, entries and repeat count. The selected group’s primary-domain mix is shown below. Existing attendance-only scopes, including **Below 60**, retain attendance/programme exploration without a registered-client rate or representation denominator.

## Definitions and cautions

- **Diagnostic repeat attendance** = unique people attending at least two distinct sessions of the programme in the selected view ÷ unique programme attendees. The Programme Analysis table retains its senior-only reach/repeat audience and all-age entry counts, labelled explicitly. The participant-group view uses the selected population/group. Duplicate person-session rows do not inflate group counts.
- A single-session programme has a diagnostic repeat rate of **0%** when it has attendees, with a limited-opportunity warning. Its existing programme repeat field remains **Not applicable**, and the existing opportunity-based group repeat metric and ranking are unchanged. This is an additive, separately labelled diagnostic; no old metric is redefined.
- **Small sample** uses the Phase 1 caution threshold (default fewer than 20 unique people). Exact recorded counts remain visible under the existing staff policy, but do not establish popularity.
- **One-off draw signal** appears when no participant repeats across at least two delivered sessions, or unique reach is very small (below the Phase 1 comparison floor, default 10). The displayed reason distinguishes these cases. A tiny programme may receive the signal even with repeat attendance; this describes insufficient reach evidence, not programme quality, suitability or proof of a one-off preference. These thresholds follow existing Dashboard Settings.
- Withheld repeat values remain unavailable. Neither a diagnostic rate nor a negative one-off signal can reveal whether a protected repeat count is zero. No attendees means no repeat-rate denominator.

## Representation

Representation compares **the selected group’s share of a programme’s registered-client attendees** with **its share of the same eligible registered-client population**. Both numerator/denominator pairs, percentages, percentage-point difference and ratio are shown. Example: 10 of 50 programme client attendees (20%) versus 40 of 100 registered clients (40%) gives −20 percentage points and 0.5× the registry share.

All-age/non-client attendance is excluded from both shares. Do not compare an all-age attendee share with a client-only registry share. A complete registry, attendance coverage and releasable group/programme totals are required. Incomplete registries, attendance-only scopes and protected margins return unavailable representation. No missing denominator is treated as zero. Current registry/profile information does not establish historical membership or circumstances at every visit.

The indicator is descriptive. A difference does not establish unmet need, exclusion, suitability, a cause, or statistical significance. Check reach, delivery opportunity, profile completeness and voluntary feedback before deciding on action. Small-sample warnings remain visible beside the comparison.

## Primary-domain mix

Learning, Physical, Social and Cognitive are always shown when the aggregate is available, alongside other recorded primary-domain labels. Each row contains unique attendees, their percentage of all selected-group attendees, attendance entries, and percentage of selected-group entries. A person may appear in several domains: unique counts and attendee percentages must not be added. Entries belong to one recorded primary domain and their shares sum to approximately 100% after rounding.

The period and programme-domain filter apply. Zero means no matching recorded attendance, not no interest or no support needs. Missing coverage yields unavailable values. Other/unclassified primary labels remain visible; Event Types are not reassigned or added as primary-domain entries. Existing combined programme-domain labels and classification tables remain unchanged.

## Privacy and exports

All calculations stay server-side and release aggregate counts only. Existing staff roles, small/complementary-cell suppression and filter-slice protections remain in force. Representation is withheld if another protected category could be recovered from the new total. Domain-entry totals/shares are withheld when a hidden programme or repeat count could be recovered by subtraction. No per-person histories, identifiers, external calls or automatic outreach are introduced. Source workbooks, saved attendance and classifications are unchanged.

The existing **Presentation / PDF** snapshot includes diagnostic/representation labels for all programme rows returned in that snapshot, plus selected-group domain mix and caveats. It no longer silently clips a 20-row results page to five rows. The existing top-five/page selection remains the export selection; it does not promise every programme across all pages. Existing general programme exports retain their current fields. Exact staff counts are not a public-safe anonymised export. The separate identifiable Phase 4 CSV remains disabled pending approval.

## Implementation and validation

Shared definitions/types: `shared/programme-diagnostics.js` and declarations. Server integration: `server/domain.js` and `server/patterns.js`. Screen/print labels: `src/programme-diagnostic-ui.tsx` and CSS; lazy group comparison: `src/programme-group-diagnostics.tsx`; existing page integration: `src/main.tsx`, `src/patterns-ui.tsx`, `src/types.ts`. Tests cover repeat/sample boundaries, unchanged old metrics, same-population representation, deduplication, domain overlap/shares, filtering, partial registries, withheld totals, staff/viewer access, lazy loading and print row completeness.

Validation passed **263 automated tests**, strict type checking, lint and the production build. Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build`. No dependencies, SQL migration, resets or re-imports are needed. Automated DOM checks do not verify rendered laptop/tablet layout or PDF pagination. No hosted deployment is included.
