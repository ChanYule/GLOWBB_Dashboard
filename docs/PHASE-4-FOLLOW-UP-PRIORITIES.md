# Phase 4: follow-up priorities

Open **Client Engagement & Outreach → Follow-up priorities**. Choose the attendance period and reporting date, then review the priority list or **Lapsing soon**. Block, age group, recorded support indicators, recency and recorded programme interests narrow the list. Missing interests are not inferred from attendance. **Review client / plan follow-up** opens the existing review workflow; viewing never sends a message or saves a contact.

## Priority rules

The list includes registered clients with no attendance matching the selected view, or existing previously attending inactive status. Below-60 attendees remain outside the registered-client population. Summary counts describe the matched client audience before the indicator/recency list selectors; list totals describe the filtered results. Categories can overlap.

The score is an editable ordering aid, not a clinical risk score or an automatic contact decision. Every component appears beside the client as a labelled points chip. Administrators can edit **Dashboard Settings → Follow-up priority rules**.

| Default rule                                         |           Points |
| ---------------------------------------------------- | ---------------: |
| Existing inactive status                             |               40 |
| Otherwise, no recorded attendance history            |               30 |
| Otherwise, no attendance matching this view          |               10 |
| Recorded CFS wholly at or above 7                    |              +10 |
| Recorded living alone                                |              +10 |
| Explicitly selected, documented SRF indicator        |              +10 |
| Each complete 30-day gap, on covered reporting dates | +2, capped at 12 |

Exactly one attendance base applies. Support and gap points are added. Ties use longer covered gaps, then Member ID. Age, race and gender do not add points. CFS bands crossing the configured boundary are flagged for review rather than assumed high. Future-dated assessments are not used as historical evidence. Current recorded profiles do not establish historical circumstances or reasons for attendance.

SRF codes receive **no points by default**. A selected code must also have a documented meaning and be explicitly marked as not a no-risk code in the existing SRF mappings. Raw 0, 1 and greater-than-1 codes are not treated as an ordered scale. Unknown CFS/living arrangement/SRF is shown separately; missing information adds no points and does not mean no support needs.

## Recency and watchlist

Existing active/inactive definitions are unchanged. These lists use the existing Client Engagement reporting date, unlike Phase 3's fixed coverage-end aggregate recency. Beyond available coverage, inactive/watch counts, gap points and elapsed-day sorting are unavailable. **Use last covered date** restores a supported date. No recorded history remains a distinct observation, not proof that someone never attended.

The watchlist contains existing **active** clients only. With at least four distinct attendance dates, it uses the median positive interval between dates across all available programmes. The default watch threshold is `ceil(typical interval × 80%)`. With insufficient dates, the explicit fallback is a 21-day gap. All three settings are editable. Same-day visits count once. This is a review prompt based on limited history, not a prediction; it never changes inactivity status.

## Registration conversion

The default recent-registration cohort covers 90 days ending at the earlier of reporting date and attendance coverage end. This view uses the eligible registered population independently of priority-list filters and the selected attendance period. Current registry records are not a historical census.

Each 14/30-day rate uses known registration dates with covered starts and completed follow-up windows. Attendance on registration day through day 14/30 is included. Pending windows, uncovered starts, unknown registration dates and dates outside the recent cohort are counted separately. Pre-registration attendance is excluded from conversion and flagged as a data issue. The table separates attendance within the window, later attendance and no recorded attendance after registration through the anchor. “No recorded” is not a claim that a client never attended. No denominator produces an unavailable rate.

## Access and CSV approval boundary

The API and workspace retain administrator/planner access; viewers cannot fetch the list. Results are paginated and contain a subset of the existing outreach/review fields, with reasons and watch metadata. Raw attendance histories stay server-side. Access audits record only view, count and page. No third-party calls or automatic outreach are introduced.

**Identifiable CSV download remains disabled pending explicit user approval**, as required by Step 0 and the original personal-data change instruction. The review dialog is a blueprint: it displays the warning, proposed columns and acknowledgement, but acknowledgement cannot enable download. The export endpoint always rejects requests; no CSV generator or file is created.

Proposed columns: **Member ID, Recorded block, Attendance flag, Last recorded attendance, Assigned staff, Last contact date**. Clinical details, scores, SRF/CFS, names, phone numbers and free-text notes are omitted. If approved, implementation must retain role checks, require confirmation per download, use these exact minimal columns, escape spreadsheet formulas safely, and audit only count/filter metadata rather than personal rows.

## Implementation and validation

Core files are `shared/outreach-priority-rules.js`, `server/outreach-priorities.js`, `src/outreach-priorities-ui.tsx`, `src/outreach-rules-fields.tsx` and their route/settings integration. Rules use existing JSON settings storage; no migration or re-import is needed. Dashboard risk redaction now clones its response before removing fields, preserving nested settings/defaults while retaining the existing public projection. The definitions dialog loads saved priority rules from an administrator-only endpoint before allowing saves; redacted dashboard settings cannot erase selected SRF codes.

Validation passed **247 automated tests**, strict type checking, lint and production build. Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`. Tests cover explicit scoring, missing profiles, median/fallback watch rules, conversion boundaries and exclusions, pagination, filters, source immutability, role checks, aggregate-only access audit, blocked CSV, settings round trips on SQLite/PostgreSQL, and tab/review integration. Automated DOM checks do not establish rendered laptop/tablet layout. Deployment and visual browser QA are not claimed.
