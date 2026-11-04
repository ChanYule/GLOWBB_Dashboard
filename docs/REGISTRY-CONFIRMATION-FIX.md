# Client registry confirmation fix

The screenshot shows a successful preview followed by the frontend's generic error fallback. It does not reveal the HTTP status or hosted function logs, so a production timeout cannot be confirmed from the screenshot alone.

Source inspection found a concrete timeout risk: confirmation issued separate PostgreSQL calls for every participant, both registry snapshots and each nonblank source field. A 1,473-client file therefore required thousands of sequential network round trips under a 60-second hosted function limit.

## Change

Confirmation now prepares the same reviewed records in memory and writes them in parameterized batches of at most 500 records. Existing participants are updated separately from new participants. Original source snapshots, current registry values and field observations retain their previous conflict and duplicate rules. All batches, settings, audit entry and preview removal remain in one transaction. SQLite retains its existing statement semantics within the same transaction.

The frontend recognises gateway timeouts and hosted timeout error envelopes. It tells staff to check whether saving completed before retrying. Unrecognised errors include the HTTP status instead of the generic “Unable to complete request.” Provider error details are not exposed, and confirmation is never retried automatically.

## Verification

- The supplied 1,473-client workbook was tested against an isolated PostgreSQL-compatible database: confirmation used 51 database calls.
- An injected failure during the observation batch rolled back participants, registry snapshots and observations, retained the preview, and allowed a successful retry.
- Existing SQLite/PostgreSQL tests cover source preservation, approved conflicts, staff corrections, repeat imports, role checks and stale previews.
- Timeout handling covers both JSON error envelopes and plain-text HTTP 504 responses.

Source workbooks and the saved workspace database were not changed. These are local tests, not verification of the currently hosted deployment.

Full validation: 130 tests passed; lint, type checking and the production build passed.

## Applying the fix

No new SQL migration is required. Redeploy the updated application code to the existing frontend and API deployment; a frontend-only deployment does not update a separately hosted API.

After deployment, refresh the dashboard and check whether the registry already saved. If it did not, create a fresh preview and confirm it. The 450 missing living arrangements shown in the screenshot are permitted missing values and do not block confirmation.
