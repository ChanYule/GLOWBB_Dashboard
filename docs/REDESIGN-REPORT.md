# GLOW Bukit Batok dashboard redesign

Implemented locally on 4 November 2026. This guide covers the redesign, validation and staff workflow. No hosted deployment, production credentials, saved attendance or source workbook was changed.

## 1. Redesign summary

The dashboard now starts with six management indicators, three focused charts and three short evidence-based review prompts. Five primary workspaces lead from an overview to client outreach, programme review, recorded needs and agreed actions. Detailed tools remain accessible through More Tools.

## 2. Screens and components

| Workspace                         | Result and retained detail                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Management Overview               | Six cards: current registered clients, clients attending, no recorded attendance, unique seniors, male seniors and minority seniors. Registry cards use all registered ages; senior cards retain the configured age threshold. Known-gender and known-race denominators are labelled. Missing sources show unavailable values. |
| Client Engagement & Outreach      | One main comparison selector, status context, private follow-up lists, residential analysis, conflict review, profile editing, saved client views and outreach recording. Advanced customisation retains existing chart choices.                                                                                               |
| Programme Performance             | One domain portfolio chart with a programme/session/reach selector; searchable, sortable ranking table; optional columns; comparison of 2–4 programmes; programme details with one trend, session timing, verified accessibility and explicit feedback gaps. Comparison code loads when opened.                                |
| Participant Needs & Accessibility | One profile selector; one response selector; respondent denominators and missing-data states; accessibility requirements versus staff-reviewed metadata. The optional programme comparison table loads when opened. Participant records, barriers and detailed alignment remain available.                                     |
| Planning & Actions                | First five evidenced priorities, expandable remaining findings, existing action tracker and configurable outreach targets. Staff retain owners, priority, due dates, status and recorded outcomes.                                                                                                                             |
| More Tools                        | Custom Analysis, Operations & Screening, Social Risk Analysis, detailed audience/profile/barrier/alignment tools, Data Quality and Dashboard Settings. Administrators retain a visible Data management shortcut.                                                                                                               |
| Imports and data management       | Five-step progress indicator; existing preview, conflict approval, completeness attestation, typed deletion confirmation, backups and recovery preserved.                                                                                                                                                                      |
| Settings                          | Personal preferences are separate from organisation definitions. Organisation controls appear only for administrators; existing server-side permissions remain authoritative.                                                                                                                                                  |

The shared design system uses navy `#14263D`, teal `#0D9488`, blue `#3B82F6`, purple `#7C3AED`, amber `#D97706`, white panels and background `#F6F8FB`. Shared colour tokens have one authoritative definition in `src/design-system.css`; existing workflow layout styles remain in their page files. Typography, buttons, form controls, cards, tables, focus indicators, responsive layouts and modal actions share common rules. Tables scroll within their containers on small screens.

## 3. Chart audit and consolidation

| Previously visible or duplicated                                    | Current treatment                                                                    | Reason                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Client, needs and custom-workspace material stacked on the overview | Six cards, coverage chart, one monthly trend, top five programmes and three findings | Makes the management brief readable before opening detailed tools.                                                       |
| Separate all/male/minority trend or ranking views                   | Metric selector on each chart                                                        | Compares the relevant measure without repeating charts.                                                                  |
| Multiple client demographic comparisons                             | One main comparison selector plus status context                                     | Keeps the population denominator visible while changing the planning question. Existing advanced views remain available. |
| Domain delivery and reach measures                                  | One portfolio selector                                                               | Distinct programmes, sessions and unique seniors answer different questions and are not interchangeable.                 |
| Several profile and response distributions                          | One profile selector and one response selector                                       | Separates recorded profiles, reported interests, confirmed barriers and hypotheses.                                      |
| Long list of planning findings                                      | Five initial priorities and expandable evidence                                      | Retains the detail while reducing initial page length.                                                                   |
| Detailed custom, risk, screening and timing charts                  | Retained in secondary workspaces                                                     | These support specialist review and continue to use their existing protection rules.                                     |

Unique reach overlaps across programmes, domains and time periods. These values must not be added together. Attendance describes recorded participation and does not establish impact, diagnosis, eligibility or the cause of non-participation.

## 4. Presentation and management reporting

Open **Presentation View** from Management Overview. It freezes the displayed dashboard figures, client coverage and reporting filters when opened, avoiding a second calculation changing the report while staff present it. The report has six sections:

1. Executive summary.
2. Client engagement.
3. Programme performance.
4. Needs and accessibility.
5. Planning and actions.
6. Follow-up plan.

Use the report navigation links to move between sections. **Back to dashboard** or Escape returns to the workspace. Keyboard focus stays inside the presentation, and the background workspace is inert. **Print / Save as PDF** uses the browser print dialogue, with landscape pages, page breaks, readable colours and hidden workspace controls. No export library is required.

The presentation excludes identifiable follow-up records, Member IDs, clinical distributions, contact history, staff-written action notes and private owners. Actions are represented by status totals; configured outreach targets show their metric, dates and current/target values. Operational owner and due-date detail remains in the private tracker. Audience-filtered presentations require resetting audience filters before sharing, consistently with existing protected exports. Programme/domain-filtered senior analysis remains possible; the full-registry coverage cards become unavailable when their denominator cannot match that slice.

## 5. Client registry import

Both explicit header styles are accepted: `Member ID` and `Name/Member ID`, with the corresponding `Name/` aliases for known registry fields. The ten mandatory fields remain validated, including **Block / Building No.** Ambiguous or duplicate headers, including aliases that resolve to the same field, are rejected.

Member IDs remain trimmed strings: leading zeros, case and punctuation are preserved. Block values remain strings, including leading zeros and letters. Blank or uncertain values are retained for review rather than guessed. Worksheet selection still rejects ambiguous workbooks and formulas. Existing duplicate checks, preview fingerprints, per-field conflict approval, preservation of staff corrections and completeness attestation remain in place. Importing a registry does not replace attendance or remove people absent from a later file.

## 6. Performance changes

- Needs analysis selects eligible participants once instead of recalculating analytics for each person. Attendance histories reuse participant, programme and session indexes.
- Target progress uses summary calculations and reuses identical scopes within the request, including the same prior-period comparison rules.
- The overview requests a lean response without individual programme session lists, programme-level trends or hidden secondary charts. Secondary workspaces request lightweight dashboard context.
- A narrow briefing endpoint returns protected coverage, aggregate responses and action status totals from a read-only transaction. Its client path skips unused demographic comparisons and returns only the four coverage measures.
- Needs, client, data management, custom analysis, operations and presentation code loads by workspace. There is no large chart or PDF dependency.
- Filter requests cancel obsolete work. Valid content remains visible while updating or after a recoverable error. The presentation button waits for both datasets to finish updating.
- Concurrent ordinary GET requests are coalesced only while pending. Mutations clear that map; cancellable requests remain independent. No protected result cache persists across sessions.
- No speculative database indexes or persistent analytics cache were introduced.

## 7. Measured results

See the measurement table and machine-readable evidence below. The benchmark uses the supplied attendance and registry workbooks read-only, imports into SQLite `:memory:`, and opens an isolated headless Chromium profile at 1440 × 1000. It measures a production build over loopback. API timing records the first call followed by seven warm calls; the browser uses a fresh profile after the API fixture is prepared. Browser readiness is polled at 100 ms intervals.

These measurements do not represent provider startup, hosted PostgreSQL latency, a slow network or physical mobile hardware. A first API request is not a serverless cold-start measurement. Timings vary with local CPU load; payload and request counts are deterministic for this fixture. The detailed programme endpoint remains available and intentionally retains its larger payload.

| Measurement | Before | After |
|---|---:|---:|
| Production entry script | 450.36 KB | 303.39 KB |
| Entry gzip size | 126.65 KB | 90.89 KB |
| Initial overview ready | 845.7 ms | 577.4 ms |
| Initial API requests | 6 | 4 |
| Overview response size | 359.37 KB | 107.98 KB |
| Overview API first call | 134.4 ms | 59.1 ms |
| Overview API warm median | 71.2 ms | 52.5 ms |
| Needs API first call | 591.0 ms | 219.5 ms |
| Needs API warm median | 443.1 ms | 188.1 ms |
| Client API warm median | 63.3 ms | 61.6 ms |
| Detailed dashboard API warm median | 71.2 ms | 71.4 ms |
| Detailed filtered API warm median | 40.1 ms | 84.4 ms |
| Warm filter UI ready | Not recorded | 260.6 ms |

The overview response comparison uses the old default full dashboard response versus the new lean overview contract. Detailed filters were slower in this run; that endpoint retains its full report and no speedup is claimed for it. The measured warm UI filter update includes both overview and briefing readiness and met the 500 ms local target. Initial overview readiness met the 2 second local target. Neither target has been verified on hosted infrastructure.

Raw evidence: [before](performance-baseline.json), [after](performance-after.json).

Reproduce after a production build:

```powershell
node scripts/check-needs-layout.mjs 'C:/Users/CHANYULE/Downloads/member_attendances_20261103110958.xlsx' 'C:/Users/CHANYULE/Downloads/Members (cth.user) (16).xlsx' --benchmark=after
```

The `baseline` JSON was captured before the implementation. Re-running that label against the new code does not recreate the old implementation.

## 8. Database and production access

**No additional SQL migration is required for this redesign.** Existing PostgreSQL installations should already have migrations 001–004 from the registry upgrade. A new database can use `supabase/setup-through-004.sql`; the existing migration guide remains applicable. This redesign reuses existing JSON metadata, preferences, action and registry tables.

The previously requested temporary direct-access behaviour remains unchanged: runtime sign-in is enabled only when `DASHBOARD_AUTH=1`. Existing accounts are preserved. No `.env.local`, live environment, password or deployed access setting was changed.

For a production rollout, `.env.production.example` and the optional Render template explicitly set `DASHBOARD_AUTH=1`. Set `APP_ORIGIN` to the actual frontend origin, configure the server-only database connection and provision the intended staff accounts before rollout. `scripts/create-staff.mjs` reads account JSON from stdin, hashes passwords and revokes the account's existing sessions. Use that established workflow or existing accounts; do not put passwords in command arguments. Planner/viewer/admin permissions continue to be enforced by the API. The shared direct-access administrator is a temporary workspace mode, not the recommended production configuration.

## 9. Validation

- `npm.cmd run lint`: passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 128 tests passed, no failures or skipped tests.
- Final focused reporting and UI run: 30 tests passed, including overview/context private-note exclusion and report snapshot consistency.
- `npm.cmd run build`: passed; production entry script 303.39 KB.
- Browser acceptance: 105 page/dialog checks at 1440, 1366, 1024, 768 and 375 px; no horizontal page overflow, visible errors or runtime exceptions.
- Presentation: six logical sections and six printed PDF pages; keyboard focus and print-control hiding checked. Final print inspection verifies that the legacy internal-workspace banner is excluded.
- Source files and the saved local database were preserved.

Checks cover reconciliation, registry aliases and literal block values, unique counts and prior-period equivalence, client population denominators, small-group protection, role restrictions, private export exclusions, saved preferences, transactional preservation, deletion/recovery, source preservation, UI interactions, keyboard controls and presentation consistency.

Screenshots, the printable report and detailed browser results are written under `data/needs-layout-qa/`, which is ignored by Git. Source workbooks remain unchanged; all test imports use temporary or in-memory databases. A read-only check of the existing local database confirmed zero attendance records, zero participants and schema version 1; the test fixture was not saved there.

## 10. Remaining boundaries

- Hosted deployment, remote database latency, provider cold starts and physical device testing have not been performed.
- Complete historical membership, programme capacity/cost, eligibility rules and reasons for non-attendance are not inferred.
- Staff must supply or verify accessibility metadata, voluntary feedback, outreach targets and outcomes. Missing information remains **Data required**.
- Shared presentation content deliberately summarises actions; private operational details remain in Planning & Actions.
- Existing specialist charts and detailed tools remain available; the redesign concentrates the default experience rather than deleting analytical capability.

## 11. Staff quick guide

1. Import the client registry through Client Engagement & Outreach. Preview records, resolve issues, approve only intended changes and attest completeness when justified.
2. Import attendance with **Import attendance**. Review the preview and confirm the intended mode.
3. Choose a reporting preset or dates on Management Overview. Open **More filters** for programme, domain or audience review. Use **Reset filters** to return to the population overview.
4. Read the six cards, check their denominators and use **View analysis** to investigate a finding.
5. In Client Engagement & Outreach, choose one comparison measure. Use the separate private follow-up list to record reviewed contact and next steps.
6. Compare programme frequency, reach and average attendance. Open programme details to inspect session timing and missing accessibility information.
7. Use Participant Needs & Accessibility to review recorded responses. Keep staff hypotheses distinct from participant-reported barriers.
8. In Planning & Actions, agree priorities, owners, dates and numerical targets for the next 3–6 months. Record progress and outcomes without claiming causation.
9. Open Presentation View when figures have finished updating. Review all six sections, then use **Print / Save as PDF**.
10. Use Dashboard Settings for personal views or authorised organisation controls. Use Data management for reviewed deletion, recovery and backups.
