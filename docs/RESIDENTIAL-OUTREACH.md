# Residential participation and GLOW Nanyang outreach

The attendance importer recognises the optional `Name/Block / Building No.` and `Name/Street Name` columns in all four workspaces. Older templates remain valid. Paired residential observations retain the workbook values, the related session date as a reference, and the time the observation was saved. The session date does not establish when the resident moved or when the address was verified. The existing Member ID and session keys still determine attendance identity. Address discrepancies do not block valid attendance writes.

The Overview disclosure **Residential participation** shows staff the top releasable blocks and streets for the selected centre. **Targeted Residential Outreach** and its print/PDF view are available only in the authorised `glow_nanyang` workspace. The endpoint checks the centre ID resolved by the platform after access checks. SEEN Nanyang has its own general residential view and contributes no attendance to GLOW Nanyang outreach.

The 900 Series requires a number from 900 to 999 and Jurong West Street 91, 92 or 93. Blocks 701–710 require a number in that inclusive range and a recognised Jurong West street, avenue or central label. Recognised formatting variations include a BLK prefix, a separate letter suffix, case and spacing, and St or St. before a street number. A participant needs one consistent paired address across available source observations to contribute to a target group. Missing and conflicting evidence stays in the source store. Street typos such as Steer 91, Steer 93, Steert 71 and Juong West St 61 are not approved aliases.

Workbook audit, before import deduplication, reporting exclusions, privacy thresholds and date filters:

| Measure | Result |
| --- | ---: |
| Attendance rows | 72,002 |
| GLOW Nanyang rows | 10,620 |
| SEEN Nanyang rows | 61,382 |
| Distinct GLOW Nanyang Member IDs | 626 |
| GLOW Member IDs with a recorded age of at least 60 | 574 |
| 900 Series distinct residents / raw rows | 69 / 912 |
| Blocks 701–710 distinct residents / raw rows | 139 / 4,517 |

The two target counts use the application's exact normalization rules against workbook observations. The brief cites 68 / 890 and 140 / 4,545 respectively. These differences remain open for reconciliation with the original reference query. No spelling correction was inferred to force agreement.

Residential views load only when opened. PostgreSQL deduplicates source address pairs before sending them to the server. The bounded cache stores aggregate results by centre, user, reporting mode, dates and data revisions. The existing participation calculations supply exact counts for the targeted view. Cold requests still read a centre attendance snapshot, and production transfer and browser timings have not been measured.

Small groups are withheld and management printouts omit Member IDs, full addresses and individual assessment data. These are attendance-based counts. Registry-rate denominators, reviewed street alias management, per-person address correction tools, configurable target groups, and residential demographic or distance integration are not part of this implementation. Continue using the existing verified location workflow for distance analysis.

No new migration is required. The feature uses the existing profile observation table and the established revision cache. For data already imported before the residential columns were supported, preview the source workbook and use the normal reviewed import to capture residential observations. Verify the centre split before confirming. No production import or deployment was performed for the local verification.
