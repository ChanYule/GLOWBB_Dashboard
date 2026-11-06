# CFS linked to programme participants

Recorded CFS charts now use **distinct people who attended qualifying programme sessions in the selected reporting period**, including clients, non-clients and all selected ages. Registry members without matching attendance are excluded from this chart. Reporting dates and programme/audience filters apply; missing CFS stays in the population as its own category.

The denominator and engagement table labels identify participants rather than seniors or total registered clients. Repeated attendance does not increase the profile count. Attendance entries and repeat/frequency measures use distinct person/session pairs. Latest recorded or staff-reviewed CFS is used; this is not proof that an assessment occurred on an attendance date. Living arrangement and other registry profile scopes are unchanged.

Validation passed 51 focused tests across CFS cohort selection, existing needs analysis and UI workflows, plus lint, type checking and production build. Tests include under-60 non-clients, missing CFS/age, repeated and duplicated attendance, date/programme filters, future sessions and adding 100 registered nonattenders without changing CFS results.

The last supplied workbook, `member_attendances_20261105093446.xlsx`, independently reconciles to 417 unique participants: CFS 1–3 = 374, 4 = 21, 5 = 9, 6 = 5, 7–8 = 1, missing = 7. Recorded CFS 4–8 totals 36 participants, or 8.6% of the full participant population including missing CFS. These are source-validation results, not fixed dashboard values or a verification of current hosted data.

This is a local change. Redeploy frontend and API/backend to apply it. No SQL migration, source edits or re-import is required.
