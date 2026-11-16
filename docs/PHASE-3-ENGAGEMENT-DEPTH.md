# Phase 3: engagement depth and recency

## Staff workflow

Open **Staff Tools → Participation Patterns & Insights** and use **Engagement depth and recency**. The section supports Age Group, CFS, Social Risk Factor, Race, Gender, Living Arrangement, Residential block, Location & Distance, and Event Type. Select **Engagement depth** or **Recency** using **Show breakdown**.

Every recorded group remains available. Stacked bars show the segment mix, with `n` (eligible people in that group), exact counts and percentages. Labels and patterned missing-history segments supplement colour. **View all counts and percentages** opens a keyboard-accessible table; the table is rendered only when expanded to avoid unnecessary work on large block lists.

## Depth definitions

Distinct person-session pairs matching the selected reporting period/domain/venue are counted. Duplicate attendance does not add visits; future sessions remain excluded under the existing delivered-attendance rules.

| Segment | Definition |
| --- | --- |
| No recorded history | No attendance found anywhere in the available full history. This does **not** establish that the person never attended. |
| None in this view | Recorded history exists, but no sessions match this selected period/filter. History may be before or after the selected period, or in another domain/venue. |
| One-time | Exactly one matching session, regardless of previous visits outside the view. |
| Occasional | Two to five matching sessions by default. |
| Regular | Six or more matching sessions by default. |
| History/count unavailable | Required information is missing or invalid; not assumed to be zero. |

Administrators can change **Regular participation starts at this many sessions** in **Dashboard Settings → Data quality & definitions → Engagement depth**, from 3 to 1000. One-time always means exactly one; Occasional runs from two up to one less than that boundary. Labels update to match. The default boundary is six. This is an additive segment definition and does not change existing participation rates, same-programme repeat, membership, active/inactive rules or inactivity thresholds.

Registered-client segment percentages divide by eligible registered people in each characteristic group, including people with no recorded attendance. Attendance-only populations include that group's attendees and do not acquire a registered-client denominator. Below-60 attendance remains separate from client counts/rates.

## Recency definitions and anchor

Recency uses each person's latest attendance across **all** available programmes through the dashboard's attendance coverage end date. The anchor is displayed explicitly; it is not today and is not replaced by the selected period end. Buckets are **Within 30 days** (0–30), **31–60 days**, **61–90 days**, **More than 90 days**, **No recorded history**, and **History unavailable**.

Depth and recency therefore answer different questions: a person can have no matching attendance in an earlier selected period and recent attendance elsewhere in the available history. Recency is not a historical period-end status. Changing period/domain/venue does not change the global coverage anchor or remove other programme visits from recency history. In attendance-only scopes those filters can change which people belong to the population. A newer delivered attendance record can move the coverage anchor; the calendar advancing alone does not add elapsed days beyond that anchor.

No attendance coverage produces an unavailable breakdown, not a bar claiming everyone never attended. An empty group has n=0 and no applicable percentages. Missing registration dates do not establish historical membership; available history does not establish complete attendance coverage or a reason for non-participation.

## Event Types

Each type counts distinct qualifying sessions. In Registered clients, each type uses the eligible client cohort, including nonattenders of that type. Attendance-only type bars use the people who attended that type. The current audience/characteristic filters still apply. One session/person may belong to several Event Types: neither type totals nor their segment counts can be added across categories. Nonattendance is not an inferred Event Type preference. Event Type analysis retains its existing current-profile basis.

## Privacy, implementation and exports

Only aggregate counts/percentages and threshold/coverage metadata are returned. Per-person session counts and last dates used for classification stay server-side. Exact small-group staff counts follow the existing authorised staff policy. New breakdowns are unavailable under the conservative/default privacy projection; they cannot reveal protected cells. No viewer permissions, personal-data exports, source records or client classifications change.

**Presentation / PDF** adds a dedicated engagement section with **both** depth and recency, all count tables, anchor and caveats. Existing exact-count staff exports remain subject to the sharing-policy decision described in Phase 1; they are not public-safe/anonymised exports. Browser QA script section expectations were updated for the new logical section, without claiming a visual run.

Main files: `shared/engagement-depth.js` and declarations (classification/aggregate helpers), `server/patterns.js`, `server/event-report.js` (deduplicated histories and aggregate integration), `server/domain.js`, `server/app.js`, `src/main.tsx`, `src/types.ts` (defaults/settings validation), and `src/engagement-panel.tsx`, its CSS, `src/patterns-ui.tsx`, `src/event-types-ui.tsx` (screen/print views). No additional dependencies, migrations, resets or re-imports are required.

## Validation

Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`.

Tests cover threshold boundaries, day 30/31/60/61/90/91, leap-day arithmetic, missing/invalid/future dates, missing counts, empty groups, no history versus zero matching sessions, input non-mutation, aggregate-only results, deduplication, period/domain filters, fixed coverage anchoring, attendance-only denominators, overlapping Event Types, settings persistence/legacy saves, unchanged inactivity rules, UI switching and lazy count tables, and presentation content. Automated DOM checks do not establish rendered laptop/tablet layout or printed PDF pagination. Hosted deployment is not included in this phase.
