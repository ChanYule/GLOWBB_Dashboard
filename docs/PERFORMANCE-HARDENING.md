# Performance and responsiveness checks

Follow-up to the dashboard redesign and registry confirmation fix. Changes were made locally; no hosted deployment, credentials, authentication mode or saved workspace data was changed.

## Improvements

- Registry confirmation retains the previously added batch writes and now reads its planning state in one database statement. The full 1,473-client test uses 44 database calls.
- Attendance re-imports batch updates to existing participant profiles. The redundant second pass of individual updates was removed. Historical attendance and reviewed merge behaviour remain intact.
- Reviewed deletion batches only the selected attendance/session IDs. Restore batches records in parent-before-child order. Confirmation, stale-preview checks, recovery copies, rollback, audit and preservation of unrelated records remain mandatory.
- PostgreSQL report and backup reads use a single statement for each snapshot, reducing network round trips while keeping a consistent view of the data. SQLite retains its existing transaction handling.
- The management briefing uses the same protected interest-response calculations as the full needs report, then stops before building unused profile charts, histories and programme comparisons. Equivalence tests cover both ordinary and restricted filters.
- Saved-analysis exports calculate a weekly report once per request, even when several saved charts use it.
- Global filters coalesce rapid changes over 100 ms. Follow-up search coalesces typing over 180 ms, cancels obsolete requests and keeps existing rows visible while updating. Report refreshes still occur after saved changes.
- Social Risk and Programme Alignment request lightweight dashboard context instead of loading hidden general charts.
- No persistent protected-data cache, speculative index, new dependency or additional SQL migration was introduced.

## Database regression checks

The tests use isolated PostgreSQL-compatible databases and do not import into the saved workspace.

| Workflow | Dataset | Database calls |
|---|---:|---:|
| Client registry confirmation | 1,473 clients | 44 |
| Attendance merge with changed ages | 620 participants | 16 |
| Reviewed attendance deletion | 620 entries | 12 |
| Full recovery from the deletion backup | Same records and source observations | 45 |
| Planning-state read | Complete consistent snapshot | One SELECT, plus BEGIN/COMMIT |

The large merge/delete/restore test verifies exact recovered records. Existing tests also verify conflict approval, repeat imports, source preservation, stale previews, failed-write rollback, role checks, privacy suppression and private export exclusions. Query-count limits guard against reintroducing a network call per record.

## Browser measurements

The supplied workbooks were read into SQLite `:memory:`. Measurements use a production build, an isolated Chromium profile and loopback networking. API runs collect a first request and seven warm samples; browser readiness is polled every 100 ms. The initial browser load occurs after preparing the API fixture, so this is not a hosted cold-start test.

| Measurement | Before | After |
|---|---:|---:|
| Fresh-browser overview | 964.0 ms | 621.6 ms |
| Warm filter update, including briefing | 498.7 ms | 190.6 ms |

Local CPU load affects timings. The smaller database-call counts and removal of repeated work are structural improvements; the timings are observations from this fixture, not a guarantee for hosted latency or larger future datasets.

Raw evidence: [before](performance-smooth-before.json), [after](performance-smooth-after.json).

## Validation

- 132 automated tests passed, with no failures or skips.
- Lint, type checking and the production build passed.
- Search verification checks that rapid typing sends only the final search request and leaves the current rows visible.
- Browser verification covers the primary and secondary pages, imports, deletion review, settings and presentation at 1440, 1366, 1024, 768 and 375 px.
- The six-section report retains keyboard containment, protected content boundaries and print layout.

Browser result: 105 page/dialog checks passed across all five widths, with no horizontal page overflow, visible errors or runtime exceptions. Screenshots and detailed results are in `data/needs-layout-qa/`.

## Applying the changes

No extra SQL is required. Redeploy the updated frontend and API to the existing hosting setup. If the API is hosted separately, a frontend-only deployment does not apply the database improvements.

Hosted database latency, provider startup, network conditions and physical-device performance have not been measured in this local workspace. After deployment, check the overview, a filter change, client search, registry confirmation and attendance re-import using the actual staff environment. Imports and deletions should continue to use their normal review and confirmation workflows.
