# Managing and deleting saved data

Open **Data management** in the main navigation. On a phone, open **Menu** first. This screen shows all saved records, independently of reporting filters. It is available to administrators; with temporary direct access enabled, the shared workspace has administrator access.

## Import, review or delete

**Import attendance** opens the existing preview-before-save workflow. **Reporting definitions** and **Risk & staff settings** keep organisation controls together here. Imports show the number of attendance entries originally added and how many are still saved. Entries duplicated in a later upload belong to the import that originally added them.

Choose **Delete attendance** beside an import, or **Choose data to delete** for these options:

| Option                     | Removed                                                                                                                                                                                | Kept                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| One attendance import      | Attendance originally added by that import; sessions left without attendance                                                                                                           | People, reviewed profiles, feedback, programme catalogue, registry, plans and targets                          |
| Attendance in a date range | Attendance on or between the selected dates; sessions left without attendance                                                                                                          | Other dates and the same profile/planning information                                                          |
| All attendance             | All attendance and sessions that lose their last attendee                                                                                                                              | People, profiles, feedback, programme catalogue, registry, plans and targets                                   |
| Reset programme data       | Attendance, people and their imported observations/review history, programmes, sessions, import history, registry snapshots, feedback, planning actions, assessment totals and targets | Accounts, reporting definitions, operational configuration, personal views, audit history and existing backups |

**Review deletion** shows the affected counts. Type the displayed confirmation phrase and select **Delete selected data**. Cancel closes the review without changing saved programme data. The server rejects expired previews and previews made before another staff member changed the saved data. Confirmed changes are transactional and audited. Pending upload/registry previews are invalidated after a deletion or restore.

Deleting attendance does not undo demographic enrichment performed by an earlier import. Use the full reset only when the participant information should also be cleared. A complete reset removes the registry completeness attestation so empty data cannot imply complete membership coverage.

## Recovery and permanent backup removal

A full recovery copy is saved automatically before every deletion or restore. **Review undo**, or **Backups → Review restore**, previews the selected saved state. Restore replaces current programme data, including records added after that backup; it is not a merge. Type **RESTORE DATA** to confirm. The current state is backed up first, so a restore can itself be reversed. Accounts, preferences, audit events and organisation definitions remain current; the saved registry attestation is restored with its registry records.

**Download** saves the recovery JSON. Older attendance-replacement backups remain downloadable but cannot be restored using this screen. New data-management backups support restore. Restoring from uploaded JSON is not supported.

Backups contain deleted participant information until removed. Select the trash button beside a backup and type **DELETE BACKUP** to permanently delete that recovery copy. This does not change current dashboard records. Audit history and separately downloaded backups are retained; source Excel/CSV files on your computer are never deleted by the dashboard.

## Interface changes

The main navigation now keeps Management Overview and the three analysis levels visible. Secondary reports are grouped under **More analysis tools**. On a phone, **Menu** opens navigation without placing every report above the content. Data management has its own unfiltered inventory, import history, recovery tab and separate deletion area. Needs/profile/action screens remain available when attendance is empty.

## Deployment

No additional SQL migration is required beyond migrations 001–004. Existing backup, preview and audit tables are reused; the operations schema is initialised through its existing versioned setup. Restart the local server, or deploy the updated frontend and backend together. No production data is deleted by installing this change.

All 108 automated tests passed. Verification covers SQLite and PostgreSQL deletion scopes, inclusive dates, shared sessions, preserved profiles, stale/expired previews, administrator permissions, request origins, typed confirmations, reset/restore, rollback after a failed restore, permanent backup removal and React staff workflows. The final data-management UI checks also passed after adding the selection details and smaller-screen import cards. ESLint, TypeScript checking, the production build and whitespace checks passed. Headless Chromium completed 36 checks across eight pages and the deletion preview at desktop, tablet and phone widths with no page overflow, visible alerts or runtime exceptions. These checks verify emulated Chromium, not physical devices or the live site. Development tests use isolated databases and leave saved dashboard data unchanged.
