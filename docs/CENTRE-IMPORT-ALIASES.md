# Attendance location aliases and import review

The importer now recognises the full source location labels without treating the word **SEEN** in a venue name as a programme service. The current shared, no-login workspace is preserved.

## Classification

Location and service are resolved separately, then combined into the existing four centre IDs.

| Verified location aliases               | Location      |
| --------------------------------------- | ------------- |
| Bukit Batok; Tzu Chi SEEN @ Bukit Batok | `bukit_batok` |
| Nanyang; Tzu Chi SEEN @ Nanyang         | `nanyang`     |

Matching normalises Unicode compatibility forms, casing, surrounding/repeated whitespace and spacing around `@`. Unknown labels, missing values and labels naming both locations remain unclassified. There is no fuzzy substring matching. If Centre and Centres columns are both present, verified aliases of the same location agree; different or unresolved locations require review.

Only **Activity Name** selects the service. An initial standalone GLOW prefix selects GLOW; other valid names select SEEN. Spaces, colon, hyphen and underscore are accepted separators. `GLOWING`, `GLOW2` and a GLOW word in the middle remain SEEN. Blank activity names remain invalid. Original activity/location values and any reviewed override remain in session classification metadata; names are not rewritten.

The underscore rule is verified from the supplied source: 113 attendance rows across six programme names use `GLOW_`. These are GLOW activities, and are not sent to SEEN merely because a programming-language word boundary treats underscore as part of a word.

## Staff workflow

1. Choose **Import attendance**, upload the workbook and select **Preview import**.
2. Review the total rows and the four separate centre cards. Each card distinguishes rows to insert, duplicates, skipped conflicts, invalid rows and profile/session updates. Counts are calculated from the file and saved state, not from the reference totals below.
3. Use **Inspect [centre] rows** to browse every source row for that centre, 25 at a time. The table shows source row number, original activity/location, AAP Domain, Event Type, session and proposed action. It omits Member IDs and personal profile fields.
4. Review the validation report and any explicit classification overrides. Unclassified or unauthorised centre rows block confirmation. Missing Member IDs, invalid sessions and programme-domain conflicts remain visible and are skipped under the existing reviewed-import rules. Blank activity names require source correction.
5. Confirm the reviewed import. The receipt uses centre display names. Re-uploading the same file identifies existing attendance rather than adding duplicates.

The preview has a 20-minute validity. Inspection checks preview ownership, current centre grants and administrator permission on the server. Switching inspected centres or changing a reviewed preview discards delayed row-list responses from the previous view.

## Supplied workbook validation

Read-only validation of `member_attendances_20261116163550.xlsx`, followed by actual API preview/confirmation into **isolated in-memory workspaces**, produced:

| Measure                                  | Verified result |
| ---------------------------------------- | --------------: |
| Raw attendance rows                      |           3,610 |
| Exact source duplicates                  |               1 |
| Inserted attendance entries              |           3,609 |
| Unique attendance participants, all ages |             426 |
| Distinct programme names                 |             122 |
| Distinct programme sessions              |             385 |
| GLOW Bukit Batok raw rows                |           3,610 |
| Other three centres' raw rows            |          0 each |
| Unclassified / invalid rows              |           0 / 0 |
| New entries on re-upload                 |               0 |

Raw controls are independently calculated from source cells and compared with the production classifier and saved import results. The test checks source-file hashes before/after, centre isolation, unchanged AAP Domain/Event Type metadata, original classification provenance, absence of attendance-derived client affiliation, and an empty unassigned archive. Reference counts appear only in this specific-file test and documentation.

The source workbook is not committed. Run its test locally with:

```powershell
$env:CENTRE_ATTENDANCE_WORKBOOK = 'C:\path\member_attendances_20261116163550.xlsx'
node --test --test-isolation=none tests/centre-source-workbook.test.js
```

Without the variable, the test looks for this exact filename in the current user's Downloads folder. It reports a skip if the private source is unavailable. Synthetic tests always cover alias boundaries, mixed centres, matching IDs across centres, duplicates, invalid inputs, permissions and isolated registry denominators.

## Data, migration and verification limits

No new SQL migration is required beyond the existing multi-centre setup (006). Classification provenance uses existing session JSON metadata. Attendance identity, centre namespace isolation, historical migration review/backups, client registry workflows, Member ID hashing, saved views and report scoping are retained. Preview lookups use row/session maps; row inspection does not recalculate analytics or read all centre workspaces.

The local saved root database was inspected read-only and contained no attendance, participant, programme or session rows; no saved centre files were found. This says nothing about hosted data. Neither the saved database nor the source workbook was changed by validation. Staff still need to deploy the code and upload/review/confirm the workbook in the intended workspace.

If a previous manually overridden import put records into the wrong centre, do not silently reassign or delete them. Review its provenance and use the existing centre-specific deletion preview and backup/recovery workflow before deciding how to correct it.

Validation completed locally: all 292 automated tests passed in the final full run, including the private source-workbook test (not skipped). ESLint, TypeScript and Vite build passed. Chromium import preview and page-two inspection passed at widths 1440, 1024, 768 and 390, with no page overflow or runtime exceptions. The first full test run had one intermittent location-review UI assertion failure; the unchanged isolated test, full UI suite and final full suite subsequently passed. No production code outside this import change was modified to suppress it.

Browser checks use an isolated fixture and the explicitly supplied read-only workbook; no real import is confirmed through the browser harness. Physical-device and hosted verification were not performed.


## Changed files

- `shared/centres.js` / `.d.ts`: verified location aliases, independent service classification and underscore prefix support.
- `server/centre-imports.js`: per-centre action summaries, original-source inspection, pagination, grant checks and indexed in-memory row/session lookups.
- `src/centre-import-review.tsx`, `src/main.tsx`, `src/types.ts`, `src/platform.css`: four summary cards, source-row browsing, accurate counters and readable receipts.
- `tests/centre-source-workbook.test.js`, multi-centre SQLite/PostgreSQL tests and UI tests: private workbook reconciliation, mixed aliases, duplicate prevention, permissions and stale-response checks.
- `scripts/check-analysis-polish.mjs`: optional read-only workbook upload/preview checks; README and multi-centre guide updated.
