# Client age profile and outreach priorities

**Who Are We Serving? → Age profile** now uses the full registered-client population when a complete registry is available. It includes clients with no recorded attendance. The CFS chart remains based on unique programme participants, as requested separately; the two charts explicitly identify their populations.

Open **Client Engagement & Outreach → Outreach priorities** to move from population gaps to recorded blocks and individual follow-up. This is an additional workspace inside Client Engagement, not another main dashboard page. The Main Dashboard's attendance summary remains unchanged.

## Staff workflow

1. Choose the attendance period and reporting date above the workspace. The age chart and group overview retain the full eligible registered population; attendance reflects the selected period.
2. Select **Young seniors · 60–69**, **Minority seniors**, **Seniors recorded living alone**, **Previously attended, now inactive**, or **All registered clients**. Minority uses the existing configured race categories. Living-alone and minority presets use recorded age 60+; missing ages are not assumed to be senior.
3. Review registered, attended, no-recorded-attendance and coverage figures. Group rows overlap and must not be added. The work-list attendance selector does not reduce the registered denominator. For another young-senior range, choose All registered clients and set age limits under More outreach filters.
4. Review **Which blocks have the largest gaps?** and select a block. Counts are sorted primarily by the number with no recorded attendance, with group size beside the rate. Block labels are preserved from source; streets/addresses are not inferred from the number. Verify actual addresses before planning visits. Source block labels can be ambiguous across streets.
5. Review the paginated list of Member ID, age, race, block, living arrangement, working status, CFS, SRF, last attendance and elapsed days. Age/CFS/SRF filters and the collapsed profile summary support investigation. **Review client / plan follow-up** opens the existing contact form and full profile. This does not send any message or save a contact automatically.

## Working status

Neither supplied workbook contains employment information. All unrecorded statuses therefore remain **Not recorded**. Age, retirement assumptions and attendance frequency never determine working status.

In the full participant profile's basic information, staff can record **Working**, **Not working**, **Retired**, **Unknown** or **Prefers not to say**. Known working/nonworking/retired statuses require an information source and recorded date. The existing reviewed profile revision/save workflow applies. The outreach list exposes that provenance in the status tooltip. These are latest-known recorded profiles, not proof of historical employment at every attendance date. No new employment import format or employment inference is introduced.

## Inactivity

The workspace uses the existing Client Engagement recency rules. With the default 30/60/90-day bands, inactive means previous attendance more than 60 days before the reporting date. The configured threshold is displayed; it can be changed in the existing Zones & rules settings.

Clients with no recorded history are separate from previously attending clients who became inactive. Classification is unavailable when the reporting date exceeds the imported attendance coverage. **Use last covered date** provides a direct correction. The inactivity API rejects unsupported reporting dates rather than returning a false zero. On the full available-history period, inactive clients necessarily have past attendance; their historical coverage is not evidence of current activity. Use last attendance/days since and a suitable recent reporting period.

Current registry/profile information is used; known registration dates affect eligibility. Unknown registration dates do not establish historical membership. CFS, SRF, living arrangement and employment are context for staff review, not automatic causes, suitability decisions or individual risk scores. Check reported barriers, interests, contact preferences and actual support needs before deciding the next step.

## Supplied-file reconciliation

Read-only reconciliation of the last supplied attendance export (`member_attendances_20261105093446.xlsx`) and client registry (`Members (cth.user) (16).xlsx`), using attendance through **5 November 2026**, gives:

| Registered group | Registered | Attended | No recorded attendance | Coverage |
|---|---:|---:|---:|---:|
| All clients | 1,473 | 168 | 1,305 | 11.4% |
| Young seniors, 60–69 | 495 | 61 | 434 | 12.3% |
| Minority seniors | 298 | 13 | 285 | 4.4% |
| Seniors recorded living alone | 207 | 30 | 177 | 14.5% |

The full registered age profile is 495 aged 60–69, 698 aged 70–79 and 280 aged 80+. There are 79 previously observed inactive clients under the default rule as of the last covered date. These are validation results from the supplied files, not hardcoded dashboard totals, a new registry-completeness attestation, or verification of current hosted data.

Reproduce with:

```powershell
node scripts/reconcile-outreach.mjs 'C:/Users/CHANYULE/Downloads/member_attendances_20261105093446.xlsx' 'C:/Users/CHANYULE/Downloads/Members (cth.user) (16).xlsx'
```

## Implementation and limits

`server/client-outreach.js` reuses the existing exact Member ID links, current-client population, filters and recency calculation. `POST /api/clients/outreach` is restricted to administrators/planners and audits the group/count/page viewed. The client interface loads the workspace only when selected, debounces/aborts obsolete requests, caps table height and paginates the individual list. General exports do not gain identifiable client lists.

Employment fields use the existing reviewed-profile JSON storage, so no SQL migration is required. Source workbooks and saved client records are not changed by reconciliation or tests. Existing client views, registry imports, CFS participant analysis and manual follow-up remain available. Redeploy frontend and API/backend to apply this local change to the hosted dashboard.

Validation passed **200 automated tests**, lint, strict type checking and production build. Browser QA passed **141 checks** across desktop, tablet and mobile widths, including the new outreach workspace, living-alone drill-down and return to the existing client analysis. Tests verify correct denominators, minority/alone/inactive cohorts, CFS/SRF/age/block context, recorded employment provenance, pagination, staff permissions and audit access. The new workspace is a separate lazy-loaded chunk; the main JavaScript entry remains approximately 315.86 kB. No hosted deployment or physical-device behavior is claimed.
