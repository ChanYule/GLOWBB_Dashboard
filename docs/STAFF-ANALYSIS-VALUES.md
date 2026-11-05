# Full recorded values in staff analysis

At the user's request, administrator and planner analysis now displays all recorded group counts, including groups of one or two people. Small-group, complementary-total and combined-cohort suppression is disabled for these authorised staff reports.

This applies to Participation Patterns, Location & Distance, Event Types, Client Engagement, needs/feedback analysis, social-risk analysis and their existing authorised aggregate reporting flows. It includes attendance entries, programme counts, repeat counts, averages and demographic breakdowns when the data supports them. It does not change endpoint permissions or add participant identifiers to management reports.

`server/staff-analysis.js` applies the policy to a temporary settings projection for authorised requests. It does not update the saved privacy threshold, source records, imports, assessments or programme classifications. Pure report calculations retain their conservative default when no authorised staff projection is supplied. Viewer accounts do not gain access to staff endpoints.

**Unavailable is different from withheld.** An attendance-only population cannot supply registered-client counts, nonattender counts or client coverage rates. Those client-only columns are omitted from its group table. Select Registered clients and supply a complete verified registry for those metrics. Missing ages, unmapped SRF codes, unverified addresses and uncollected feedback remain missing/unknown. A zero denominator or no repeat opportunity produces an unavailable rate, not a fabricated zero.

Evidence thresholds for planning recommendations remain separate from visibility. Showing one person's recorded attendance does not justify a causal conclusion, a suitability claim or an automatic programme recommendation. Reported barriers remain distinct from inferred explanations.

No SQL migration, data reset or re-import is required. Deploy the updated API/backend and frontend to apply the changed reporting policy to the hosted dashboard. Older documentation describing staff small-group withholding is superseded by this policy.

Validation: **190 automated tests passed**, including single-person SRF counts, attendance entries, averages, repeat metrics, combined comparisons, unchanged stored thresholds and unavailable registry denominators. Lint, type checking and production build passed. Browser QA passed **136 checks** across desktop, tablet and mobile viewport sizes, including existing reports and workflows. These are local checks; hosted deployment remains outstanding.
