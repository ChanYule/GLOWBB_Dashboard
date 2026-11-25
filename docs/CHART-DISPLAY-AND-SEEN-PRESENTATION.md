# Chart display and SEEN Nanyang presentation

The header **Display** menu is shared by all four centres. It stores Theme, Chart values and Chart size on this device. System mode follows the browser's preferred colour scheme. A small same-origin bootstrap sets the saved theme before React starts. The print stylesheet uses a light palette.

| Chart area | Changes in this implementation |
| --- | --- |
| Shared horizontal rankings | Larger labels and tracks, theme-aware accent colours, detail available on focus or hover, and optional percentage display with an explicit overall denominator |
| Programme Domains | Applies exact programme, session, unique participant and attendance totals. SEEN Nanyang shows the four measures simultaneously. The other centres retain the measure selector |
| Programme rankings | Staff can choose a chart or table, open programme detail, and compare reach or attendance against the selected domain total in chart view. Repeat rankings stay in counts |
| Demographic bars | Inherit the display preference and keep their individual toggle. Percentages use the labelled full population, with unknown values included where applicable |
| Trends, assessment scores and operational measurements | Keep source units unless an applicable denominator is supplied. Existing trends inherit the shared chart palette where supported |

Changing Theme, Chart values, Chart size or a chart override requires no API fetch. Percentage conversion is only enabled when the chart provides a denominator. Zero or missing denominators and withheld rows stay unavailable. Overlapping programme domains are compared with the exact overall total, so domain shares can legitimately add to more than 100%.

SEEN Nanyang staff can use **Present** in the header. It opens a full-viewport meeting view with optional browser full screen, section navigation, an opening section saved on the current device, expandable domain charts and print/PDF for the current section. The meeting uses the centre and reporting dates, and overview cards and domain results are fetched once per opening. The engagement and needs sections use the existing protected briefing endpoint when selected. Existing presentation and export routes remain available. GLOW Nanyang residential outreach stays in its own workspace.

The meeting view covers centre performance, trends, domains, programme rankings, selected demographics, client engagement, participant needs and planning findings. It does not yet provide a combined selected-section PDF, a named meeting layout library, an SPPB assessment slide, or expand controls on every chart. Additional specialist charts still need individual review for percentage compatibility, sizes and dark theme contrast. A local headless Chromium check used synthetic data at 1366 x 900 and 390 x 844. It exercised the four-panel analysis, light and dark themes, display controls, the meeting view and expanding/restoring a chart. The three display changes generated zero additional API requests. Hosted behaviour and a before/after loading benchmark remain unverified.

There is no new migration, environment variable or data import for this release.
