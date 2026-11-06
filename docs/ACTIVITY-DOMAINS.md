# Combined activity domains

Activity/programme lists now show one **Domains** field combining the primary AAP Domain and recorded secondary Event Types. Primary appears first and repeated names are removed, ignoring case and extra whitespace.

Examples:

- Primary Physical, secondary Cognitive → **Physical, Cognitive**.
- Primary Cognitive, secondary Cognitive+Social or Cognitive & Social → **Cognitive, Social**.
- Primary Physical, secondary Social & Cognitive, Learning, Physical → **Physical, Social, Cognitive, Learning**.

Comma, ampersand and plus delimit the displayed component names. Meaningful labels such as Social – Communal Dining and Self care and mindfulness remain intact. Unknown secondary classifications are not displayed as an extra domain when another domain is recorded. If no domain is recorded, the field says Unclassified / unknown. Known spelling variations are not silently merged; existing administrator-approved mappings still apply.

This is a display projection using `shared/activity-domains.js`. The source primary domain, raw Event Type, approved mappings and each historical session classification remain intact. Primary-domain and Event-Type analytics retain their existing meanings. Multiple labels do not duplicate an activity, attendance entry or participant.

The combined field is used in programme classification tables, Event Type rankings, Participation Patterns rankings, the past-programme list, programme details, session details, classification PDF tables and the general programme CSV/HTML report. Search includes the displayed combined list. Full programme responses reuse their unique session metadata; the main overview does not load extra classification arrays or make extra requests.

Tests cover the requested examples, case/whitespace deduplication, multiple combined labels, unknown values, unchanged raw import labels, table pagination, print rows, CSV/HTML consistency and unchanged attendance records. No SQL migration or re-import is needed; redeploy the frontend and API/backend to apply this local change online.

Validation: 203 automated tests passed, with zero failures or skips. Lint, type checking and production build passed. Browser QA passed 141 checks, including printed activity tables with every programme retained once and no repeated domain names within each combined cell. Hosted deployment remains outstanding.
