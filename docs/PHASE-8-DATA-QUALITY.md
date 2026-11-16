# Phase 8: data quality and interface polish

## Staff workflow

Open **Client Engagement & Outreach → Data completeness**, or use the completeness panel under a **Registered clients** analysis in **Participation Patterns & Insights**. It shows known/missing counts and percentages for age, gender, race, CFS, living arrangement, recorded block, registration date and address verification. The denominator is the current eligible client population as of the displayed date, including nonattenders; it is not just the chosen demographic group or its programme attendees. The panel uses current records even when an attendance comparison uses dated snapshots.

Unknown, invalid, unrecorded and prefer-not-to-say fields are counted as missing for analysis; this is not an instruction to pressure someone for information. Standard numeric CFS bands must be valid and not future-dated. A recorded block is known source text, not a verified address. Zero eligible clients gives unavailable percentages rather than 0% completeness.

**Review missing [attribute]** opens a staff-only, paginated list containing a subset of the existing follow-up fields. In the client workspace, **Review client / plan follow-up** opens the existing reviewed profile/contact workflow. No edit or contact happens automatically. Access audits contain only field, count and page; raw personal rows and clinical details are not logged. No identifiable list export is added.

## Addresses and Distance analysis

One verification banner replaces the repeated “unverified; address not assumed” block-label suffix. It shows verified-client count, percentage and a labelled progress bar. Old saved/direct block-group queries with the suffix remain compatible. A source block still does not establish a street, address, route or barrier.

Verification uses the existing reviewed building binding, valid coordinates and unchanged source/building fingerprints. **Open Distance analysis** is enabled only when at least one client has a verified location and the centre is verified with valid coordinates. It does not require or pretend 100% completeness. Unverified clients remain in Distance unknown; walking distances still require current cached route evidence. No geocoding, route refresh or external call is triggered by viewing completeness.

## Optional known-registration comparison

The existing participation rate and denominator remain unchanged. **Show known-registration comparison rate** adds a separately labelled rate using only clients with a valid registration date on or before attendance coverage start, excluding unknown/invalid dates and registrations after that start. It shows participating/registered counts, both exclusion counts and a 95% plausible range. The comparison is unavailable without a complete registry and attendance coverage or under conservative privacy settings.

In Participation Patterns, its population is the overall eligible registry across groups; in Client Engagement it follows the current client view. The selected attendance period/domain still determines participation. This is not a corrected historical census or a correction for missing attendance, profile bias or past membership uncertainty. Registration on coverage start is included. The optional comparison never classifies below-60 non-clients as clients.

## Definitions, dates and layout

Keyboard-accessible **Info** disclosures provide concise metric definitions, including relevant numerator, denominator and period/basis. Existing KPI definitions remain, with new help for participation/ranges, group cards, engagement depth/recency, monthly metrics, programme repeat/representation and completeness. Programme-table column help reuses the existing metric definitions. Controls are widened and the living-arrangement preset shortened; laptop/tablet layouts wrap to fewer columns without truncating the selected label. Wide analytical tables scroll inside their panels.

Each analysis page now shows **Data last updated** and **Attendance coverage**. Patterns uses its own refreshed response timestamp; other analysis workspaces use the shared loaded-dashboard source stamp. Source updates include recorded attendance imports, registry imports, reviewed profiles, feedback and planning actions. SQLite UTC stamps and ISO stamps are compared as actual instants and displayed in Singapore time. Unknown update time remains unavailable; report generation time is never substituted for a source update. These timestamps do not claim a location-route cache was refreshed.

## Presentation, safety and validation

Participation Patterns **Presentation / PDF** retains plausible ranges, n, segment counts, two-factor evidence, programme diagnostics/domain mix, monthly trends/change evidence and caveats, and adds aggregate completeness, verification progress, the known-registration comparison and source stamps. Personal missing-data dialogs/buttons are excluded. Existing management summaries and CSV contracts remain; the separate identifiable Phase 4 CSV is still disabled. Exact small staff counts follow the existing authorised policy and are not public-safe anonymised reports.

New aggregate details are restricted to the existing authorised staff projection. The missing-list endpoint enforces administrator/planner access and returns existing follow-up fields only, capped at 25 rows per page. Source workbooks, records and classifications are preserved. No additional dependency, SQL migration, reset, re-import or scheduled job is introduced; the existing location-store setup is reused.

Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build`. `node scripts/check-analysis-polish.mjs` validates a built frontend against an isolated in-memory synthetic fixture at 1440, 1024, 768 and 390 pixels, checking viewport width, selected-label fit, verification progress, the missing-list dialog and client completeness. Screenshots/results are written to `data/analysis-polish-qa`; no saved dashboard database or supplied workbook is opened. Isolated browser profiles are retained in OS temporary storage for manual cleanup, with their path printed by the script.

Browser screenshots establish local layout in Chromium, not physical-device behaviour, all PDF pagination or hosted deployment. An earlier temporary browser profile remains under `data/analysis-polish-browser-l5zi94`: Windows first locked it, and automatic approval review then blocked its removal with “blocked by policy.” No deletion was retried.

Final local validation passed 274 automated tests, strict type checking, lint and production build. The focused Chromium check passed at all four widths with no runtime exceptions; tablet/mobile screenshots were inspected. Saved dashboard data and supplied workbooks were not used by the browser fixture.
