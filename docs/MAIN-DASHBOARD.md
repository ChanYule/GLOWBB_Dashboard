# Main Dashboard and Client Engagement

The primary tab is now **Main Dashboard**. Registered-client totals, clients without recorded attendance and the client coverage bar are in **Client Engagement & Outreach**.

## Main Dashboard

The four headline cards show:

- Total unique participants across all recorded ages, with the age 60+ count shown underneath (or the configured senior threshold).
- Male seniors.
- Minority seniors.
- Attendance entries across recorded ages.

One audience selector updates both the reach trend and top-five programme rankings. Planning notes expand on request. Programme and session counts remain in programme analysis and the attendance summary. Registry coverage is no longer a main dashboard card, chart or finding. See the [simple staff workflow](SIMPLE-STAFF-GUIDE.md) for navigation and planning.

## Daily and monthly summary

**Attendance summary** provides Daily and Monthly views. The Daily view has a month selector within the active reporting range and shows week, date, programmes, attendances, unique participants, IB, OB, male and minority counts. The Monthly view shows each month and a deduplicated reporting-period total.

- The sheet and total unique participants card include all recorded ages, subject to the active dashboard filters. Male and minority senior headline cards and the senior charts retain the configured senior age threshold.
- **IB** means existing clients; **OB** means non-clients. These are the same definitions used by Operations. Unknown client status remains separate and is not guessed into either group.
- Sheet percentages use the unique participants in that row. Senior headline gender/race percentages retain their labelled known-information denominators.
- Monthly and overall totals deduplicate people and programmes. Do not add daily unique values together. The same person may appear on several days.
- Weeks start on Monday. Empty weekends are omitted; recorded weekend attendance is retained. Future dates and dates outside the selected period or available source coverage show blank cells. Public holidays are not inferred from the example image.

The table scrolls within its own container on smaller screens and keeps column headings and totals visible. Month changes cancel obsolete requests and keep the existing summary visible while refreshing.

## Client Engagement & Outreach

The existing registered-client cards and private follow-up tools remain available. **Registered client coverage** is now displayed directly below the client cards. Import, archive/reactivate, contact review, source preservation, privacy controls and deletion/recovery workflows are unchanged.

Presentation View still includes its separate client-engagement report section. Its executive cards now match the main dashboard's outreach and delivery focus. Main-dashboard findings skip the registry coverage calculation; that coverage is fetched only when opening the full presentation.

No SQL migration is required. Deploy the updated frontend and API together to apply these changes to the hosted dashboard. No source workbook or saved workspace data was changed during local verification.

Validation: 135 automated tests passed, plus 110 browser/layout checks across five screen sizes. Daily/monthly switching, source-reconciled totals, month selection, protected filters, registry separation and presentation behaviour were checked. Lint, type checking and the production build passed.
