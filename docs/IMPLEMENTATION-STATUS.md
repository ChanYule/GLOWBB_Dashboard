# Staff analysis improvement status

| Phase | Local outcome | Guide |
| --- | --- | --- |
| 1 | Plausible ranges, reliability thresholds and cautious comparisons implemented | [Reliability](PHASE-1-RELIABILITY.md) |
| 2 | Explicit group/overall denominators, median/IQR and session histogram implemented | [Group context](PHASE-2-GROUP-CONTEXT.md) |
| 3 | Engagement depth and coverage-anchored recency implemented | [Engagement](PHASE-3-ENGAGEMENT-DEPTH.md) |
| 4 | Priority rules/reasons, watchlist, conversion and export-review blueprint implemented; identifiable CSV remains disabled pending approval | [Follow-up priorities](PHASE-4-FOLLOW-UP-PRIORITIES.md) |
| 5 | Two-factor matrix and cautious support-needs review implemented | [Two-factor views](PHASE-5-TWO-FACTOR-VIEWS.md) |
| 6 | Programme repeat diagnostics, representation and primary-domain mix implemented | [Programme diagnostics](PHASE-6-PROGRAMME-DIAGNOSTICS.md) |
| 7 | Monthly client trends and covered equivalent-period changes implemented; campaign markers skipped because there is no event-marker table | [Trends](PHASE-7-TRENDS.md) |
| 8 | Completeness/missing lists, address-verification progress, optional registration comparison, metric definitions, source stamps, responsive controls and protected report content implemented | [Data quality](PHASE-8-DATA-QUALITY.md) |

Existing client classifications, rate definitions, source workbooks and records are preserved. Below-60 attendance remains explorable as attendance-only data and does not acquire a registered-client denominator. New registration/diagnostic comparisons are explicitly separate from the original metrics.

## Remaining decisions and follow-up

- Identifiable Phase 4 CSV requires the separate personal-data approval requested after Phase 4. It has not been enabled or generated.
- Existing authorised staff reports retain exact small counts. A distinct public/anonymised sharing policy would require a separate decision before changing exports.
- Campaign annotations need a sourced event-marker table; programme sessions are not used as invented campaign markers.
- Improve known registration dates and reviewed address bindings through the existing staff workflows. Do not infer historical membership, street addresses, distances or barriers from missing records.
- Import newer delivered attendance when available; partial months and coverage gaps remain explicit. Current profiles/registries do not supply a historical census.
- Changes are local and have not been deployed. Browser checks use an isolated synthetic database; physical-device behaviour and full PDF pagination remain unverified.

Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, then `node scripts/check-analysis-polish.mjs` for the focused synthetic layout check. Temporary browser profiles are retained for manual cleanup; a previous workspace QA-profile removal was blocked by automatic approval review, as documented in the Phase 8 guide.

Phase 7 was committed as `5b888ab` after 267 tests passed. Final Phase 8 validation passed 274 tests, type checking, lint, build and the focused four-width Chromium check.
