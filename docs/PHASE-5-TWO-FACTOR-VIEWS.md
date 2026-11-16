# Phase 5: two-factor participation

## Staff workflow

Open **Staff Tools → Participation Patterns & Insights → Advanced comparison (optional)**. Select **Compare CFS × living arrangement**, or choose a first characteristic in **Analyse by** and a **Second characteristic**. Existing demographic and location pairs are supported. Programme domain remains the existing filter; it is not a second axis. Overlapping Event Types retain their separate analysis.

Each matrix cell shows the participation rate, **n = registered clients in that combination**, participating clients and the Phase 1 95% plausible range. Participation still means attending at least once in the selected period/domain divided by eligible registered clients, including nonattenders. Duplicated attendance and repeat visits do not increase the numerator. The matrix covers the full matched population; the selected primary group and location secondary-group focus do not restrict it. Those selectors still apply to their existing programme/detail tables.

Darker teal indicates higher participation. Cells below the configured **caution threshold** (default 20 registered clients) are grey and hatched, with a written small-group warning. Counts remain visible under the existing exact-count staff policy. Unknown/unavailable cells are grey; missing combinations have no rate. Zero recorded participation remains 0%, with a non-zero upper plausible limit. Labels and counts convey the information without colour.

Rows and columns are paginated independently (12 rows and six columns per page) in a keyboard-focusable scrolling region. **Additional combined measures** retains the existing combined-group table, including average sessions and repeat rate. The new matrix disappears while its query changes or fails, so stale findings are not shown under newly selected filters.

## Review panel

**Where need is high but participation is low** lists a cell only when all of these hold:

- A recorded support indicator describes **every client in the cell** and is one of the selected factors: CFS wholly at/above the configured Phase 4 boundary (default 7), recorded living alone, or an explicitly selected and documented non-no-risk SRF code.
- Both categories are known, the client-rate denominator is available, and the cell meets both Phase 1 reliability thresholds. Unknown/prefer-not-to-say and non-standard CFS categories are excluded. In particular, cells below the caution threshold are not promoted into findings.
- The cell's **upper plausible limit is below the overall lower plausible limit**, using Phase 1's interval calculation. Overall uses the same eligible registry, period and programme-domain filter.

The panel displays each cell's counts, rate, range, support indicator and the overall counts/range. Age, gender, race and a low attendance rate alone are not support indicators. SRF codes have no assumed order; none are selected by default. CFS bands crossing the boundary are not assumed high. Missing indicators do not establish no support needs. Current versus dated profile rules are unchanged; unavailable historical profiles remain unknown.

This is a cautious descriptive screen, **not a formal significance test** or evidence of causation. Cells form part of the overall population, so comparisons are not independent. Reviewing many cells can exaggerate apparent differences. Intervals do not correct missing history, profile bias or incomplete coverage. The panel recommends reviewing recorded barriers and voluntary feedback; it never sends a message, creates a contact or decides eligibility. No qualifying cells does not mean no unmet need.

## Privacy, denominators and exports

The matrix reuses the existing protected combined-cell release. If that release is withheld, the new payload contains no cell labels, counts, support flags, findings or overall margin. No hidden cells are reconstructed or pooled. Viewer access remains denied by the existing routes. Computation stays server-side; new responses contain aggregate cells only, without Member IDs or per-person attendance arrays.

Client rates require a complete eligible registry and attendance coverage. Partial registries retain available recorded counts but have no rates/ranges/findings. Attendance-only scopes, including below-60 attendance, have no registered-client denominator and never acquire a client participation rate. No registry classifications or metric definitions change.

**Presentation / PDF** includes all released recorded combinations, n, participating counts, ranges, small-group labels, review findings and caveats. It uses a compact long table rather than the paginated screen matrix, so combinations beyond the current row/column pages are included. Existing staff export permissions and exact-small-count policy remain unchanged; this is not a public-safe anonymised report. Existing residential-block export restrictions still apply. Identifiable Phase 4 CSV remains disabled pending separate approval; Phase 5 does not enable it.

## Implementation and validation

`shared/two-factor-analysis.js` and its declarations define the aggregate matrix and interval screen. `server/patterns.js` attaches factor-specific recorded support labels only to released combinations and supplies the protected overall reference. `src/two-factor-panel.tsx` and its CSS provide the accessible screen/print views; `src/patterns-ui.tsx` integrates query freshness, the shortcut and presentation. Tests cover reliability boundaries, support rules, non-overlap, missing/zero/invalid denominators, unknown/withheld groups, filter/profile basis, duplicate attendance, pagination, stale results and print completeness.

Validation passed **254 automated tests**, strict type checking, lint and the production build. Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`. No dependencies, SQL migration, resets or re-imports are needed. Automated DOM tests do not verify rendered laptop/tablet layout or PDF pagination. No hosted deployment is included.
