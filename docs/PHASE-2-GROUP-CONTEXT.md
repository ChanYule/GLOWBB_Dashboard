# Phase 2: selected group and overall context

In **Staff Tools → Participation Patterns & Insights**, every primary KPI now refers to the selected group. Muted secondary lines describe the overall eligible population for the same reporting period, domain and population selection.

For **Registered clients**, the four cards show:

1. **Group registered clients** — the selected group's eligible registered population, including clients with no attendance. The secondary line shows the overall registry count.
2. **Group participants** — distinct people with recorded attendance, explicitly stated as a count out of the group's registered clients. The secondary line uses overall participating / registered counts.
3. **Group participation rate** — participating group clients divided by registered group clients, alongside the overall rate and its counts. A complete verified registry and available attendance history are still required; this is not a session attendance rate.
4. **Median sessions / participant** — the middle distinct session count among people who attended, with the interquartile range (IQR, middle 50%). The secondary line shows the overall attendee median and IQR. The mean remains in a hover tooltip and the keyboard-accessible **Definition and mean** disclosure.

For attendance-only populations (including **Below 60**), the first three cards show group participants, attendance entries and programmes. No registered-client denominator or client participation rate is supplied. Overall context describes the same selected attendance population, not the whole client registry. Location verification totals remain separately labelled in the distance view.

## Session distribution

The selected group's histogram counts participants with **1**, **2–3**, **4–5**, **6–10**, **11–20** and **21+** sessions in the selected period/domain. Labels give exact counts and percentages, so colour is not needed to interpret it. Each person-session pair counts once, including when the person attended different programmes. Duplicate records and future sessions are excluded by the existing attendance selection.

Nonattenders are excluded from the median, mean and histogram; they remain in participation-rate denominators. This preserves the population used by the existing mean. Median and quartiles use linear interpolation at `(n - 1) × p` on sorted positive session counts, with `p = 0.25, 0.5, 0.75`. One participant has identical median/quartiles. No participants produces an unavailable median/IQR/mean, not a zero median. No attendance history produces unavailable distribution and attending totals, while known registry counts remain available. These are attendance descriptions, not preference, suitability or impact measures.

## Privacy and exports

New calculations run server-side. Responses contain aggregate medians, quartiles, means and histogram bins, never lists of each person's session counts or additional personal identifiers. Existing exact-value authorised staff policy applies. Conservative/default reports receive no new histogram/quantile or overall-detail release that could reconstruct suppressed groups. No permissions, personal-data exports, source records or client classifications change.

**Presentation / PDF** uses the same group summary, overall context, median/IQR and histogram as the screen. Definitions and coverage caveats remain. Existing exact-count staff exports are not public-safe/anonymised exports; the separate sharing policy decision recorded in Phase 1 still applies.

## Files and validation

- `server/session-distribution.js`: aggregate session summary and quartiles.
- `server/patterns.js`: selected-group distributions and separate overall context, respecting date/domain selection and the existing staff privacy projection.
- `src/participation-group-summary.tsx` and `.css`: four explicit group KPI cards, muted overall lines, accessible mean disclosure and responsive histogram.
- `src/patterns-ui.tsx`: shared screen/presentation integration and separately labelled overall location totals.
- `tests/session-distribution.test.js`, `tests/patterns.test.js`, `tests/ui.test.js`: skew, odd/even/single/empty samples, bin boundaries, input non-mutation, deduplication, filtering, privacy, missing history, group denominators, attendance-only views and presentation content.

Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build`. No dependencies, migrations, data resets or re-imports are required. Automated DOM tests do not verify rendered laptop/tablet layout or PDF pagination. No hosted deployment is included in this phase.
