# Phase 1: participation reliability

## Staff workflow

Open **Staff Tools → Participation Patterns & Insights**, choose **Registered clients**, and compare **Client participation rate (%)**.

- Each group shows participating / registered counts, `n` (registered clients), the recorded rate and a 95% **plausible range**. The dot is the rate; the whisker is the range. A dashed line marks overall participation across the same eligible registry, period and domain. Differences from that line are percentage points, not percentage changes or significance tests.
- **Sort groups** offers rate, registered group size and natural label order. Age/CFS bands retain their order; block numbers sort numerically.
- Groups below **20** registered clients carry **Small group, interpret with caution**. Groups below **10** remain visible but do not enter automatic highest/lowest comparisons. Administrators can change these two thresholds in **Dashboard Settings → Data quality & definitions → Participation comparison reliability**. The comparison floor must not exceed the caution threshold. Existing minimum-senior/session recommendation definitions are separate.
- Q&A cards and **What the Data Tells Us** give the compared counts and ranges, state whether the ranges overlap, and explain missing, small, withheld and non-standard categories separately. They do not infer a cause or an ordered social-risk scale. CFS compares the lowest/highest supported standard bands without asserting a decreasing trend.
- **Pool small groups** adds **Other (small groups combined)** from at least two known, released groups below the caution threshold. Original groups remain visible. Counts are summed before calculating the combined rate; percentages are never averaged. Automatic pooled comparisons exclude their source groups to avoid comparing overlapping populations. Pooling is a temporary view choice, not a registry change. Combined CFS groups have no ordered interpretation.
- Recorded block numbers remain valid categories even if their address is unverified. Address warnings remain; this does not verify a building or enable an inferred walking distance.

The Q&A uses the full eligible registered-client population independently of the selected group/population. Dates, domain and profile basis still apply. Below-60 attendance remains separate and supplies no registered-client rate.

## Interpretation and privacy

Participation still means clients attending at least once divided by registered clients in the group. Exact recorded counts are not uncertain. The plausible range is a **model-based stability indicator**, not a correction for incomplete coverage, missing registration dates, selection bias, current-profile bias or historical membership. Attendance records are not a random population survey. Neither overlapping nor non-overlapping intervals are presented as a formal test; comparing the extremes of many groups can exaggerate differences. Groups form part of the overall population, so their rates are not independent of the reference rate.

The implementation uses the two-sided 95% Wilson score method with normal quantile 1.959963984540054. Formula reference: [NIST/SEMATECH, confidence intervals for a proportion](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). Zero successes and all successes retain non-zero interval widths; zero or invalid denominators yield unavailable rates/ranges. Missing values are never converted to zero.

Authorised staff retain exact group counts, including groups of one. Existing role checks, viewer restrictions and identifier-free report contracts are unchanged. An overall rate is not added when it could reconstruct an already withheld group. Pooling only uses released aggregate counts for disjoint single-characteristic groups; it must not be applied to overlapping Event Types or programme audiences.

**Presentation / PDF** uses the same range chart, sorting and pooling snapshot, including `n`, cautions and caveats. Existing authorised staff exports still contain exact small counts under the deliberately enabled staff policy. They are not anonymised/public-safe reports. Suppressing exact small counts in a separately shareable export remains a user decision; this phase does not change personal-data handling or add identifiable CSV exports.

## Implementation and validation

- `shared/participation-reliability.js` and its declarations: counts, intervals, thresholds, natural sorting, pooling and shared insight text.
- `server/patterns.js`: protected overall context, thresholds and range-aware findings, including distance comparisons.
- `server/domain.js`, `server/app.js`, `src/types.ts`, `src/main.tsx`: additive defaults, validated settings persistence and settings fields. No SQL migration, reset or re-import.
- `src/participation-rate-chart.tsx`, its CSS, `src/patterns-ui.tsx` and `src/attendance-questions*.tsx/ts`: screen and print integration using released aggregates only.

Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build`. Tests cover reference interval values, n=1, zero/all successes, missing/invalid counts, all-small groups, interval overlap, CFS ordering, unverified blocks, weighted pooling, non-mutation, protected totals, legacy settings saves, sorting and print content. Existing API, database and interface regressions remain included.

Visual browser QA was attempted using isolated synthetic data, but the browser access host was unavailable. Automated DOM checks establish content and interactions, not rendered laptop/tablet layout or printed PDF pagination. Hosted deployment has not been performed.
