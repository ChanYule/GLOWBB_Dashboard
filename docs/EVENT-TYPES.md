# AAP Domain, Event Type and programme planning

## Staff workflow

Open **Programme Analysis → Programme Domains & Event Types**. The existing past-programme table remains below it. **Staff Tools → Participation Patterns & Insights → Event Type** opens the same analysis for participant comparisons. The three main pages remain unchanged.

Use the existing reporting dates, then choose AAP Domain, secondary Event Type and participant population. Select seniors using the configured age threshold, all recorded ages, male seniors or minority seniors. Expand **Compare Event Type with one participant characteristic** for age, gender, race, CFS, SRF, living arrangement, participation status, residential area or reviewed distance. Select a segment to examine its Event Type reach. Unknown locations remain unknown; this view does not geocode addresses.

**How Is Our Programme Mix Distributed?** is one horizontal chart. Switch between AAP Domain and Event Type, and between distinct programmes, delivered sessions and unique participant reach. Shares use the distinct total in the selected view. The matrix **What Additional Engagement Types Do Our Programmes Offer?** expands on request and follows the selected measure. Communal Dining remains a distinct primary domain. Categories overlap: one person, programme or session can appear in several Event Types. Never add category counts or percentages to obtain an overall total.

**Top Programmes** shows five results initially. Choose a domain, Event Type and participant segment; rank by unique reach, attendance entries, same-programme repeat participants or average attendance per delivered session. **View All** uses 20-row pagination. In Programme Analysis, programme names open the existing detail panel, including recorded session classifications and the planning workflow. The retained full past-programme table follows the page's global filters.

**Are We Offering the Right Mix of Programmes?** compares provision, reach and repeat engagement. Recorded interests are compared only with explicitly staff-tagged programme interest categories. Event Type wording never supplies an inferred interest or need. With insufficient feedback, the dashboard asks for more participant feedback. Zero tagged sessions requires a source/tag review before claiming an unmet need.

**What This Means for Programme Planning** generates up to five supported findings, each containing actual evidence, implication, what to investigate and a suggested action. It does not assign a causal effectiveness score or recommend expansion from popularity alone. Unavailable findings are omitted rather than invented.

## Import and history

Use **Import attendance → Merge and Update Existing Records**, review, then confirm. Older 10-, 11- and 13-column exports remain supported alongside the new 14-column format containing `Activity Name/Event Type`.

Member ID, exact trimmed programme name, date and session times retain their existing identity rules. Event Type never changes attendance identity or replaces AAP Domain. Overlapping exports enrich matching sessions without duplicate attendance. Programme-domain conflicts retain existing review/skip behavior. A metadata-only merge can be confirmed without new attendance or profile updates.

The preview shows incoming Event Types, session-update counts, warnings and before/after classification changes (up to 100 displayed changes, with the complete count above). Confirmation explicitly includes session classifications. Nonblank changes apply in reviewed **Merge** mode. **Add** retains classifications on existing sessions. Older exports and blank incoming values never erase classifications. New sessions can carry classifications in either mode.

If rows disagree about the same session, the importer warns staff and retains existing metadata. A new conflicting session remains unclassified and retains the conflicting source strings. Resolve the source and preview again. Changes after a metadata-update preview require a fresh preview. Each historical session retains its own classification; later programme sessions never overwrite earlier sessions. Accepted updates retain previous raw values and labels in session history.

## Parsing and administrator review

Comma is the only automatic delimiter. `Social & Cognitive, Learning` becomes **Social & Cognitive** and **Learning**. Ampersands stay inside labels; duplicate comma-separated labels are deduplicated per session. Source spelling is preserved after standard outer-whitespace trimming.

Expand **Administrator Event Type label review** for distinct imported labels and session counts. `Social & Volunterism` is flagged for review, never silently corrected. Edit display labels and verified equivalent-label merges, optionally annotate parent/secondary classifications, then **Preview label mappings**. Review the proposed changes, acknowledge review and **Apply reviewed mappings**. Discarding a preview saves no mapping.

Mapping several originals to the same approved label merges reporting membership without duplicate sessions or people. Parent/secondary annotations do not split combined labels or imply outcomes. Raw labels and historical identities remain intact. Mapping revisions are retained in settings history; stale previews are rejected.

## Definitions and privacy

- **Programmes:** distinct programme identities with qualifying delivered sessions.
- **Sessions:** distinct session identities delivered on or before the reporting date.
- **Unique reach:** distinct Member IDs attending qualifying sessions; the configured age threshold applies when seniors are selected.
- **Attendance:** distinct person/session pairs, including across overlapping imports.
- **Same-programme repeat:** people with at least two distinct qualifying sessions of one programme, counted once per Event Type.
- **Repeat opportunity:** people attending a programme with at least two qualifying delivered sessions. A one-off has no repeat opportunity; its repeat rate is unavailable, not a failure score.
- **Different programmes with this type:** people attending at least two programmes carrying the selected label.
- **Multiple AAP Domains:** people attending qualifying programmes across at least two primary domains. This differs from both repeat measures above.
- **Client coverage:** unique registered clients attending a labelled session divided by the complete eligible registered-client population, including nonattenders. An incomplete registry does not produce a rate. Nonattenders have no inferred Event Type preference.

Current imported/reviewed profiles apply. Existing privacy minimums have a floor of five. Small cells, complements, overlapping reconstructions and sensitive full-history cohorts are protected. Some filtered views therefore withhold participant figures; these are not zero. Supply counts may remain visible.

Administrators and planners can use protected analysis. Only administrators change mappings. Shared exports reject sensitive demographic, CFS, SRF, living-arrangement and location comparisons. Reports contain no Member IDs, home coordinates, clinical notes or participant records. Saved choices use a separate `eventTypes` key in existing staff preferences, preserving other views. Page reporting-date controls remain authoritative.

## Management reporting

Management Overview adds a concise top-three secondary-classification summary when records support it, using the existing briefing request and planning snapshot. It does not fetch the detailed Event Type endpoint. The existing management presentation includes primary domain distribution and selected secondary patterns.

The section's **Presentation / PDF** provides a concise three-section report: primary domains, selected secondary classifications with reach/repeat figures, and planning findings/limitations. Sensitive filtered sharing is rejected server-side. Classification does not prove health, learning or social outcomes.

## Data model and performance

No additional SQL migration is required. Existing `sessions.optional` JSON stores `eventTypeRaw`, a deduplicated `eventTypes` array, conflicting source values and previous-value history, attached to each stable historical session. Administrator mappings/history use settings; mapping previews use the existing expiring preview store. SQLite and PostgreSQL bulk-import paths persist the fields. Existing backups preserve session optional fields and settings.

`server/event-types.js` owns parsing/mapping, `server/event-report.js` indexed aggregation, and `server/event-routes.js` protected reports, exports, preferences and reviewed mapping endpoints. `src/event-types-ui.tsx` loads separately on Programme Analysis or the selected Event Type characteristic. Existing programme details, management and presentation components are extended. Results remain visible during updates, obsolete requests are cancelled, filters are debounced and advanced sections are collapsed. Imports and mapping changes trigger fresh aggregation; no stale server aggregation cache is introduced.

Before the upgrade, the source reconciliation's five-calculation local analytics median was **25.00 ms**. The final equivalent run measured **27.01 ms**; the new Event Type calculation measured **15.62 ms** across seven warm calculations. An earlier concurrent run measured about 42 ms; repeating after concurrent checks completed showed that result was not stable. These are local in-process measurements, not hosted latency or a speed-improvement claim. The final main JavaScript entry grew from **313.46 kB** to **315.70 kB**, with detailed Event Type UI in a separate lazy chunk.

Reproduce aggregate-only validation:

```powershell
node scripts/reconcile-event-types.mjs 'C:/Users/CHANYULE/Downloads/member_attendances_20261105093446.xlsx'
```

The supplied workbook reconciled to **3,429 raw rows, 3,428 deduplicated attendance entries, 417 participants, 118 programmes, 357 sessions, seven primary domains, 20 raw combinations and ten labels**. Session totals were Social & Cognitive 151, Learning 145, Social 55, Physical 55 and Cognitive & Learning 45. Matrix totals matched Physical/Learning 77, Physical/Social & Cognitive 69 and Learning/Social & Cognitive 54. One programme changes classifications across sessions. These figures are validation references, never production constants.

The final full suite passed **178 tests**, with zero failures or skipped tests. Lint, strict type checking and the production build passed. Tests cover backward compatibility, parsing, combined labels, raw preservation, metadata-only merges, source conflicts, history, overlapping/matrix counts, repeat opportunity, client denominators, administrator review, exports, preferences and workbook reconciliation. PostgreSQL-compatible integration tests exercise bulk persistence. Browser QA passed **131 checks** across five desktop/tablet/mobile viewport sizes without horizontal page overflow, visible errors or runtime exceptions. The Event Type report generated **three PDF pages**. Both supplied workbooks were loaded into an isolated in-memory application for QA.

Source workbooks and saved workspace records are not modified or populated by validation. Hosted deployment, production database performance and physical devices remain unverified. There is no cost/capacity model, causal effectiveness estimate, automatic preference-to-Event-Type inference or proof of accessibility from labels.
