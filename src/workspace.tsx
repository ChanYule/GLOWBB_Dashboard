import { metrics, reportingFilters } from "./view-config";
export { metrics, reportingFilters } from "./view-config";
import type { NeedsReport, ProtectedSeries } from "./needs-ui";
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api } from "./api";
import type {
  AnalysisChart,
  Dashboard,
  Filters,
  Preferences,
  SavedView,
  Stats,
  User,
  Programme,
} from "./types";
import { TimingMatrix } from "./analytics-ui";
import "./workspace.css";

const fmt = (v: unknown) =>
  typeof v === "number"
    ? new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(v)
    : "Withheld";
const kpiMetrics: Record<string, [string, string]> = {
  ...metrics,
  riskRecorded: [
    "Seniors with recorded social risk",
    "Latest-known mapped profile information. Counts are available only in the protected full-cohort report.",
  ],
  riskMissing: [
    "Seniors with missing risk information",
    "Blank profile information remains unknown. Counts are available only in the protected full-cohort report.",
  ],
};
const defaultKpis = [
  "unique",
  "male",
  "minority",
  "attendance",
  "sessions",
  "average",
];
const makeChart = (group: string, metric = "unique"): AnalysisChart => ({
  id: crypto.randomUUID(),
  group,
  metric,
  type: ["month", "week"].includes(group) ? "line" : "bar",
});
export function template(name: string, filters: Filters): SavedView {
  return {
    id: "",
    name,
    filters: { ...filters },
    period: "Custom range",
    kpis:
      name === "Outreach Analysis"
        ? ["unique", "male", "minority", "firstObserved", "returning"]
        : name === "Programme Planning"
          ? ["unique", "programmes", "sessions", "average", "repeat"]
          : defaultKpis,
    charts:
      name === "Participant Profile"
        ? [makeChart("needs-cfs"), makeChart("needs-living")]
        : name === "Outreach Gaps"
          ? [makeChart("needs-barriers"), makeChart("needs-interests")]
          : name === "Programme Planning"
            ? [makeChart("programme"), makeChart("timing", "average")]
            : name === "Outreach Analysis"
              ? [makeChart("domain", "male"), makeChart("race")]
              : [makeChart("month"), makeChart("programme")],
  };
}
const groups: Record<string, string> = {
  programme: "Programme",
  domain: "AAP domain",
  month: "Month",
  week: "Week",
  gender: "Gender",
  race: "Race",
  ages: "Age band",
  clients: "Client status",
  boundary: "Service boundary",
  frequency: "Attendance frequency",
  observed: "First observed / previously observed",
  timing: "Day and time slot",
  "needs-cfs": "Recorded CFS",
  "needs-living": "Living arrangement",
  "needs-marital": "Marital status",
  "needs-interests": "Stated interests",
  "needs-barriers": "Reported barriers",
  "needs-support": "Support needs",
};
const simpleGroups = [
  "gender",
  "race",
  "ages",
  "clients",
  "boundary",
  "frequency",
  "observed",
  "needs-cfs",
  "needs-living",
  "needs-marital",
  "needs-interests",
  "needs-barriers",
  "needs-support",
];
export function validTypes(group: string) {
  return ["needs-interests", "needs-barriers", "needs-support"].includes(group)
    ? ["bar", "table"]
    : group === "timing"
      ? ["bar", "table"]
      : ["month", "week"].includes(group)
        ? ["line", "bar", "table"]
        : simpleGroups.includes(group)
          ? ["bar", "donut", "table"]
          : ["bar", "table"];
}
function dataRows(
  data: Dashboard,
  c: AnalysisChart,
): { label: string; value: number | null }[] {
  if (c.group === "observed")
    return [
      { label: "First observed", value: data.summary.firstObserved },
      { label: "Previously observed", value: data.summary.returning },
    ];
  if (simpleGroups.includes(c.group))
    return (data[c.group as "gender"] || []).map((r) => ({
      ...r,
      value: r.value,
    }));
  const rows =
    c.group === "programme"
      ? data.programmes.map((p) => ({ ...p, label: p.name }))
      : c.group === "domain"
        ? data.domains
        : c.group === "timing"
          ? data.timing
          : data.trends;
  return rows.map((r) => ({
    label: r.label,
    value: r[c.metric as keyof Stats] as number | null,
  }));
}
export function AnalysisGraphic({
  rows,
  type,
  title,
}: {
  rows: { label: string; value: number | null }[];
  type: string;
  title: string;
}) {
  if (!rows.length)
    return <p className="chart-empty">No attendance matches this view.</p>;
  const max = Math.max(...rows.map((r) => r.value || 0), 1),
    total = rows.reduce((sum, r) => sum + (r.value || 0), 0);
  if (type === "table")
    return (
      <div className="work-table">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th>Group</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th>{r.label}</th>
                <td>{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (type === "line")
    return (
      <>
        <svg
          role="img"
          aria-label={title}
          viewBox="0 0 600 180"
          className="work-line"
        >
          <line x1="25" y1="150" x2="580" y2="150" stroke="#cbd5e1" />
          <polyline
            points={rows
              .map(
                (r, i) =>
                  `${25 + (i * 550) / Math.max(1, rows.length - 1)},${150 - ((r.value || 0) / max) * 125}`,
              )
              .join(" ")}
            fill="none"
            stroke="#087f86"
            strokeWidth="3"
          />
          {rows.map((r, i) => (
            <circle
              key={r.label}
              cx={25 + (i * 550) / Math.max(1, rows.length - 1)}
              cy={150 - ((r.value || 0) / max) * 125}
              r="4"
              fill="#087f86"
            >
              <title>
                {r.label}: {fmt(r.value)}
              </title>
            </circle>
          ))}
        </svg>
        <details>
          <summary>View trend values</summary>
          <AnalysisGraphic rows={rows} type="table" title={title} />
        </details>
      </>
    );
  if (type === "donut" && total > 0) {
    let offset = 0;
    const colors = ["#087f86", "#4f6bd4", "#8961ac", "#b47b29", "#61778c"];
    return (
      <div className="work-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={title}>
          {rows.map((r, i) => {
            const length = ((r.value || 0) / total) * 100;
            const item = (
              <circle
                key={r.label}
                cx="60"
                cy="60"
                r="45"
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth="16"
                pathLength="100"
                strokeDasharray={`${length} ${100 - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              >
                <title>
                  {r.label}: {fmt(r.value)}
                </title>
              </circle>
            );
            offset += length;
            return item;
          })}
        </svg>
        <ul>
          {rows.map((r) => (
            <li key={r.label}>
              {r.label}: <strong>{fmt(r.value)}</strong>
              {r.value !== null && ` (${fmt((r.value / total) * 100)}%)`}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="work-bars">
      {rows.map((r) => (
        <div key={r.label}>
          <span>{r.label}</span>
          <strong>{fmt(r.value)}</strong>
          <i style={{ width: `${((r.value || 0) / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}
function Chart({
  data,
  chart,
  filters,
  canExport,
  canViewNeeds,
}: {
  data: Dashboard;
  chart: AnalysisChart;
  filters: Filters;
  canExport: boolean;
  canViewNeeds: boolean;
}) {
  const [weekly, setWeekly] = useState<Dashboard | null>(null),
    [error, setError] = useState("");
  const [protectedSeries, setProtectedSeries] =
    useState<ProtectedSeries | null>(null);
  useEffect(() => {
    let live = true;
    setError("");
    setProtectedSeries(null);
    setWeekly(null);
    if (chart.group.startsWith("needs-")) {
      if (!canViewNeeds)
        setError(
          "This profile chart is restricted to authorised planners and administrators.",
        );
      else
        api<NeedsReport>("/api/needs/overview?" + new URLSearchParams(filters))
          .then((r) => {
            if (!live) return;
            const key = chart.group.slice(6);
            const values: Record<string, ProtectedSeries> = {
              cfs: r.profiles.cfs,
              living: r.profiles.living,
              marital: r.profiles.marital,
              interests: r.responses.interests,
              barriers: r.responses.barriers,
              support: r.responses.needs,
            };
            setProtectedSeries(values[key]);
          })
          .catch((e) => {
            if (live) setError(e.message);
          });
    }

    if (chart.group === "week")
      api<Dashboard>(
        "/api/dashboard?" +
          new URLSearchParams({ ...filters, interval: "week" }),
      )
        .then((d) => {
          if (live) setWeekly(d);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [chart.group, filters, canViewNeeds]);
  const title = `${metrics[chart.metric]?.[0] || "Unique seniors"} by ${groups[chart.group]?.toLowerCase()}`;
  return (
    <>
      <h3>{title}</h3>
      {canExport &&
        ["programme", "domain", "month", "week", "timing"].includes(
          chart.group,
        ) &&
        !["male", "minority"].includes(chart.metric) && (
          <a
            className="text-button"
            href={
              "/api/analysis/export?" +
              new URLSearchParams({
                ...filters,
                group: chart.group,
                metric: chart.metric,
              })
            }
          >
            Export results as CSV
          </a>
        )}
      {error ? (
        <p role="alert">{error}</p>
      ) : chart.group.startsWith("needs-") ? (
        !protectedSeries ? (
          <p role="status">Loading protected profile analysis?</p>
        ) : protectedSeries.suppressed ? (
          <p className="privacy-empty">
            {protectedSeries.note ||
              "Breakdown and complementary values withheld under privacy rules."}
          </p>
        ) : (
          <>
            <AnalysisGraphic
              rows={protectedSeries.values.map((v) => ({
                label: v.label,
                value: v.unique,
              }))}
              type={chart.type}
              title={title}
            />
            <p className="muted">
              {protectedSeries.denominator} distinct {protectedSeries.populationLabel||'seniors / question respondents'}. Stated needs and interests are not
              inferred from attendance. Multiple selections overlap.
            </p>
          </>
        )
      ) : chart.group === "week" && !weekly ? (
        <p role="status">Loading weekly results…</p>
      ) : (
        <AnalysisGraphic
          rows={dataRows(weekly || data, chart)}
          type={chart.type}
          title={title}
        />
      )}
      <p className="muted">
        {simpleGroups.includes(chart.group)
          ? "Distinct seniors in mutually exclusive groups. Percentages use the sum of displayed counts; unknown values remain separate."
          : "Unique reach overlaps across programmes and periods. Do not add these counts. Session averages use all-age attendance; repeat participants attended 2+ sessions in each group."}
      </p>
    </>
  );
}
function Kpis({
  data,
  keys,
  onRisk,
}: {
  data: Dashboard;
  keys: string[];
  onRisk?: () => void;
}) {
  return (
    <div className="metric-grid">
      {keys
        .filter((k) => kpiMetrics[k])
        .map((key) => {
          const value = data.summary[key as keyof Stats],
            prior = data.previous?.[key as keyof Stats];
          const delta =
            typeof prior === "number" && typeof value === "number"
              ? value - prior
              : null;
          const share =
            key === "male"
              ? data.summary.malePct
              : key === "minority"
                ? data.summary.minorityPct
                : null;
          return (
            <section className="metric-card" key={key}>
              <h2 title={kpiMetrics[key][1]}>{kpiMetrics[key][0]}</h2>
              <div className="metric-value">
                {key.startsWith("risk") ? "Protected" : fmt(value)}
              </div>
              {key.startsWith("risk") && onRisk && (
                <button className="text-button" onClick={onRisk}>
                  Open protected risk overview
                </button>
              )}
              {share !== null && (
                <small>
                  {fmt(share)}% of known {key === "male" ? "gender" : "race"}
                </small>
              )}
              <p className="muted">
                {delta === null
                  ? "No valid previous-period comparison"
                  : `${delta > 0 ? "+" : ""}${fmt(delta)} vs previous equivalent period`}
              </p>
              <details>
                <summary>Definition</summary>
                <p>{kpiMetrics[key][1]}</p>
              </details>
            </section>
          );
        })}
    </div>
  );
}
function reorder<T>(items: T[], index: number, target: number) {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
export function PersonalWorkspace({
  data,
  filters,
  setFilters,
  user,
  explore = false,
  onRisk,
}: {
  data: Dashboard;
  filters: Filters;
  setFilters: (f: Filters) => void;
  user: User;
  explore?: boolean;
  onRisk?: () => void;
}) {
  const [prefs, setPrefs] = useState<Preferences>({
      views: [],
      active: "",
      template: "Overview",
    }),
    [view, setView] = useState<SavedView>(() => template("Overview", filters)),
    [customise, setCustomise] = useState(false),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false),
    [name, setName] = useState("My dashboard"),
    [drag, setDrag] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api<Preferences>("/api/preferences")
      .then((p) => {
        if (!live) return;
        const clean = { ...p, views: Array.isArray(p.views) ? p.views : [] };
        setPrefs(clean);
        if (p.draft) setView(p.draft);
        setReady(true);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const persist = async (next: Preferences) => {
    try {
      await api("/api/preferences", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setPrefs(next);
      setMessage("Personal preferences saved to your account.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const change = (patch: Partial<SavedView>) =>
    setView((v) => ({ ...v, ...patch }));
  const saveNew = () => {
    const saved = {
      ...view,
      id: crypto.randomUUID(),
      name: name.trim() || "My dashboard",
      filters: { ...filters },
    };
    setView(saved);
    void persist({
      ...prefs,
      active: saved.id,
      views: [...prefs.views, saved],
      draft: saved,
    });
  };
  const templates = [
    "Overview",
    "Participant Profile",
    "Outreach Gaps",
    "Programme Planning",
    "Outreach Analysis",
  ];
  return (
    <div
      className={`work-space personal-workspace ${customise || explore ? "editing" : ""}`}
    >
      <div className="work-toolbar">
        <div>
          <span className="eyebrow">
            {explore ? "GUIDED ANALYSIS" : "YOUR WORKSPACE"}
          </span>
          <h2>{explore ? "Explore the Data" : view.name}</h2>
        </div>
        <label className="field">
          Dashboard view
          <select
            aria-label="Dashboard view"
            value={prefs.active || prefs.template}
            onChange={(e) => {
              const selected = [
                ...prefs.views,
                ...(data.settings.sharedTemplates || []),
              ].find((v) => v.id === e.target.value);
              const next = selected || template(e.target.value, filters);
              setView(next);
              if (selected) setFilters(reportingFilters(next, filters));
              setPrefs({
                ...prefs,
                active: selected?.id || "",
                template: e.target.value,
              });
            }}
          >
            <optgroup label="Team templates">
              {templates.map((t) => (
                <option key={t}>{t}</option>
              ))}
              {data.settings.sharedTemplates?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="My saved views">
              {prefs.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <button
          className="button"
          onClick={() => setCustomise(!customise)}
          aria-expanded={customise}
        >
          Customise My Dashboard
        </button>
      </div>
      {message && (
        <p role="status" className="note">
          {message}
        </p>
      )}
      {customise && (
        <section className="panel work-settings">
          <h3>Personal dashboard preferences</h3>
          <p>
            Preferences belong to {user.username}. Save to keep your layout
            across sessions and devices.
          </p>
          <h4>Choose statistics · drag to reorder or use arrow buttons</h4>
          <div className="work-checks">
            {Object.entries(kpiMetrics).map(([key, [label]]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={view.kpis.includes(key)}
                  onChange={(e) =>
                    change({
                      kpis: e.target.checked
                        ? [...view.kpis, key]
                        : view.kpis.filter((k) => k !== key),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <ol className="work-order">
            {view.kpis.map((key, i) => (
              <li
                key={key}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null)
                    change({ kpis: reorder(view.kpis, drag, i) });
                  setDrag(null);
                }}
              >
                {kpiMetrics[key]?.[0]}
                <button
                  className="button"
                  aria-label={`Move ${kpiMetrics[key]?.[0]} up`}
                  disabled={i === 0}
                  onClick={() => change({ kpis: reorder(view.kpis, i, i - 1) })}
                >
                  ↑
                </button>
                <button
                  className="button"
                  aria-label={`Move ${kpiMetrics[key]?.[0]} down`}
                  disabled={i === view.kpis.length - 1}
                  onClick={() => change({ kpis: reorder(view.kpis, i, i + 1) })}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <label className="field">
            Default reporting period
            <select
              value={view.period || "Custom range"}
              onChange={(e) => change({ period: e.target.value })}
            >
              {[
                "Available history",
                "This month",
                "Last month",
                "Last 3 months",
                "Last 6 months",
                "This year",
                "Custom range",
              ].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            View name
            <input
              aria-label="View name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </label>
          <div className="work-actions">
            <button
              className="button primary"
              disabled={!ready}
              onClick={() =>
                void persist({ ...prefs, draft: { ...view, filters } })
              }
            >
              Save personal preferences
            </button>
            <button className="button" disabled={!ready} onClick={saveNew}>
              Save as New View
            </button>
            <button
              className="button"
              onClick={() => setView(template("Overview", filters))}
            >
              Reset default layout
            </button>
            {view.id && (
              <>
                <button
                  className="button"
                  onClick={() => {
                    const updated = {
                      ...view,
                      name: name.trim() || view.name,
                      filters,
                    };
                    setView(updated);
                    void persist({
                      ...prefs,
                      views: prefs.views.map((v) =>
                        v.id === view.id ? updated : v,
                      ),
                      draft: updated,
                    });
                  }}
                >
                  Rename / update view
                </button>
                <button className="button" onClick={saveNew}>
                  Duplicate view
                </button>
                <button
                  className="button"
                  onClick={() => {
                    void persist({
                      ...prefs,
                      active: "",
                      draft: undefined,
                      views: prefs.views.filter((v) => v.id !== view.id),
                    });
                    setView(template("Overview", filters));
                  }}
                >
                  Delete personal view
                </button>
              </>
            )}
            {user.role === "admin" && (
              <button
                className="button"
                onClick={async () => {
                  try {
                    const config = await api<{
                      settings: Dashboard["settings"];
                    }>("/api/risk-configuration");
                    await api("/api/risk-configuration", {
                      method: "PUT",
                      body: JSON.stringify({
                        ...config.settings,
                        sharedTemplates: [
                          ...(config.settings.sharedTemplates || []),
                          { ...view, id: crypto.randomUUID(), name, filters },
                        ],
                      }),
                    });
                    setMessage(
                      "Team template saved. Refresh the dashboard to load it.",
                    );
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                Publish team template
              </button>
            )}
          </div>
        </section>
      )}
      {!explore && <Kpis data={data} keys={view.kpis} onRisk={onRisk} />}
      {explore && (
        <p className="note">
          1. Choose a metric → 2. Choose a grouping → 3. Apply global filters
          above → 4. View the result. Each chart uses the same reporting scope.
          Risk breakdowns are available only in the protected Social Risk
          Analysis section.
        </p>
      )}
      <div className="work-actions">
        <button
          className="button"
          onClick={() =>
            change({ charts: [...view.charts, makeChart("domain")] })
          }
        >
          Add Chart
        </button>
        <button className="button" onClick={() => setCustomise(true)}>
          Save analysis view
        </button>
        {view.id && user.role !== "viewer" && (
          <a
            className="button"
            href={
              "/api/analysis/view/" + encodeURIComponent(view.id) + "/export"
            }
          >
            Export saved view as CSV
          </a>
        )}
      </div>
      <div className="work-chart-grid">
        {view.charts.map((c, i) => (
          <section key={c.id} className={`panel ${c.wide ? "full-width" : ""}`}>
            <div className="work-chart-controls">
              <label>
                1. Measure
                <select
                  aria-label={`Chart ${i + 1} metric`}
                  value={simpleGroups.includes(c.group) ? "unique" : c.metric}
                  disabled={simpleGroups.includes(c.group)}
                  onChange={(e) =>
                    change({
                      charts: view.charts.map((x) =>
                        x.id === c.id ? { ...c, metric: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {Object.entries(metrics)
                    .filter(([k]) =>
                      [
                        "unique",
                        "male",
                        "minority",
                        "attendance",
                        "repeat",
                        "average",
                        "firstObserved",
                        "returning",
                      ].includes(k),
                    )
                    .map(([k, [label]]) => (
                      <option
                        key={k}
                        value={k}
                        disabled={
                          k.startsWith("needs-") && user.role === "viewer"
                        }
                      >
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                2. Group by
                <select
                  aria-label={`Chart ${i + 1} grouping`}
                  value={c.group}
                  onChange={(e) => {
                    const group = e.target.value;
                    change({
                      charts: view.charts.map((x) =>
                        x.id === c.id
                          ? {
                              ...c,
                              group,
                              metric: simpleGroups.includes(group)
                                ? "unique"
                                : c.metric,
                              type: validTypes(group)[0],
                            }
                          : x,
                      ),
                    });
                  }}
                >
                  {Object.entries(groups).map(([k, label]) => (
                    <option
                      key={k}
                      value={k}
                      disabled={
                        k.startsWith("needs-") && user.role === "viewer"
                      }
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                4. Display
                <select
                  aria-label={`Chart ${i + 1} display`}
                  value={c.type}
                  onChange={(e) =>
                    change({
                      charts: view.charts.map((x) =>
                        x.id === c.id ? { ...c, type: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {validTypes(c.group).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="work-actions">
              <button
                className="button"
                disabled={i === 0}
                onClick={() =>
                  change({ charts: reorder(view.charts, i, i - 1) })
                }
              >
                Move chart up
              </button>
              <button
                className="button"
                onClick={() =>
                  change({
                    charts: view.charts.map((x) =>
                      x.id === c.id ? { ...c, wide: !c.wide } : x,
                    ),
                  })
                }
              >
                {c.wide ? "Half width" : "Full width"}
              </button>
              <button
                className="button"
                onClick={() =>
                  change({ charts: view.charts.filter((x) => x.id !== c.id) })
                }
              >
                Hide chart
              </button>
            </div>
            <Chart
              data={data}
              chart={c}
              filters={filters}
              canViewNeeds={user.role !== "viewer"}
              canExport={
                user.role !== "viewer" &&
                ![
                  "gender",
                  "race",
                  "ageBand",
                  "client",
                  "boundary",
                  "cfs",
                  "observed",
                ].some((k) => filters[k as keyof Filters]) &&
                (!filters.target || filters.target === "all")
              }
            />
          </section>
        ))}
      </div>
      {explore && (
        <>
          <ComparePeriods data={data} filters={filters} />
          <section className="panel">
            <h3>Programme timing analysis</h3>
            <TimingMatrix data={data} />
          </section>
        </>
      )}
    </div>
  );
}
function ComparePeriods({
  data,
  filters,
}: {
  data: Dashboard;
  filters: Filters;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [other, setOther] = useState<Dashboard | null>(null),
    [error, setError] = useState("");
  return (
    <section className="panel">
      <h3>Compare reporting periods</h3>
      <p>
        Current view: {data.period.from} to {data.period.to}. Audience and
        programme filters are retained for the comparison.
      </p>
      <div className="work-toolbar">
        <label className="field">
          Comparison from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          Comparison to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={!from || !to || from > to}
          onClick={async () => {
            try {
              setOther(
                await api<Dashboard>(
                  "/api/dashboard?" +
                    new URLSearchParams({ ...filters, from, to }),
                ),
              );
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Compare periods
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {other && (
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Current period</th>
                <th>Comparison period</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {[
                "unique",
                "male",
                "minority",
                "sessions",
                "attendance",
                "repeat",
                "average",
              ].map((k) => (
                <tr key={k}>
                  <th>{metrics[k][0]}</th>
                  <td>{fmt(data.summary[k as keyof Stats])}</td>
                  <td>{fmt(other.summary[k as keyof Stats])}</td>
                  <td>
                    {fmt(
                      Number(data.summary[k as keyof Stats]) -
                        Number(other.summary[k as keyof Stats]),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        Different durations, programme frequencies and incomplete coverage
        affect comparisons. No causal effectiveness claim is made.
      </p>
    </section>
  );
}

export function Login({ onDone }: { onDone: (user: User) => void }) {
  const [error, setError] = useState("");
  return (
    <main className="login-shell">
      <form
        className="panel form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            onDone(
              await api<User>("/api/login", {
                method: "POST",
                body: JSON.stringify(Object.fromEntries(f)),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <span className="eyebrow">GLOW BUKIT BATOK</span>
        <h1>Staff sign in</h1>
        <p>Programme impact & outreach</p>
        <label className="field">
          Username
          <input name="username" autoComplete="username" required />
        </label>
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary">Sign in</button>
      </form>
    </main>
  );
}
export function SocialRisk({ user }: { user: User }) {
  type RiskStats = {
    unique: number;
    attendance: number;
    sessions: number;
    repeat: number;
    once: number;
    repeatRate: number | null;
    averagePerParticipant: number | null;
  };
  type RiskReport = {
    suppressed: boolean;
    limited: boolean;
    note: string;
    threshold: number;
    categories: (RiskStats & { label: string })[];
    states: (RiskStats & { label: string })[];
    programmes?: (RiskStats & {
      category: string;
      programme: string;
      domain: string;
    })[];
    demographics?: (RiskStats & {
      category: string;
      dimension: string;
      label: string;
    })[];
    insights?: {
      category: string;
      action: string;
      figures: string;
      explanation: string;
      followUp: string;
    }[];
    completion?: {
      completed: number;
      total: number;
      percent: number | null;
    } | null;
  };
  const [report, setReport] = useState<RiskReport | null>(null),
    [error, setError] = useState(""),
    [selectedCategory, setSelectedCategory] = useState(""),
    [dimension, setDimension] = useState("Gender");
  useEffect(() => {
    let live = true;
    if (user.role !== "viewer")
      api<RiskReport>("/api/social-risk")
        .then((r) => {
          if (live) setReport(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [user.role]);
  if (user.role === "viewer")
    return (
      <div className="panel">
        Social risk analysis is restricted to authorised planners and
        administrators.
      </div>
    );
  return (
    <section className="panel">
      <span className="eyebrow">PROTECTED AGGREGATE VIEW</span>
      <h2>Social Risk Analysis</h2>
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p role="status">Loading protected report…</p>}
      {report && (
        <>
          <p className="note">{report.note}</p>
          {report.limited && (
            <p className="warning">
              Social Risk Analysis is limited. Configure the meaning of imported
              risk codes and import additional classifications for a detailed
              breakdown. Raw value 0 does not establish absence of risk.
            </p>
          )}
          {report.suppressed ? (
            <p className="chart-empty">
              Breakdown withheld because a group sharing recorded profile fields
              and attendance patterns is smaller than {report.threshold}.
              Complementary counts, programme slices and downloads are also
              withheld.
            </p>
          ) : (
            <>
              <h3>Risk information overview · unique seniors</h3>
              <AnalysisGraphic
                rows={report.states.map((s) => ({
                  label: (
                    {
                      recorded: "Recorded risk category",
                      "no-risk": "Explicit no-risk classification",
                      missing: "Unknown / missing",
                      unmapped: "Unrecognised code awaiting mapping",
                    } as Record<string, string>
                  )[s.label],
                  value: s.unique,
                }))}
                title="Risk information states"
                type="bar"
              />
              <h3>Approved categories · categories may overlap</h3>
              <AnalysisGraphic
                rows={report.categories.map((c) => ({
                  label: c.label,
                  value: c.unique,
                }))}
                title="Mapped categories"
                type="bar"
              />
              <h3>Engagement by classification</h3>
              <div className="work-table">
                <table>
                  <thead>
                    <tr>
                      <th>Classification</th>
                      <th>Unique seniors</th>
                      <th>Attendance entries</th>
                      <th>One session</th>
                      <th>Multiple sessions</th>
                      <th>Average entries / senior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.states.map((r) => (
                      <tr key={r.label}>
                        <th>{r.label}</th>
                        <td>{fmt(r.unique)}</td>
                        <td>{fmt(r.attendance)}</td>
                        <td>{fmt(r.once)}</td>
                        <td>{fmt(r.repeat)}</td>
                        <td>{fmt(r.averagePerParticipant)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!!report.categories.length && (
                <>
                  <label className="field">
                    Social risk category
                    <select
                      value={selectedCategory || report.categories[0].label}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      {report.categories.map((c) => (
                        <option key={c.label}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  <h3>Programme reach in this category</h3>
                  <AnalysisGraphic
                    rows={(report.programmes || [])
                      .filter(
                        (p) =>
                          p.category ===
                          (selectedCategory || report.categories[0].label),
                      )
                      .map((p) => ({ label: p.programme, value: p.unique }))}
                    type="bar"
                    title="Programme reach within the selected category"
                  />
                  <div className="work-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Programme / domain</th>
                          <th>Unique seniors</th>
                          <th>Sessions attended</th>
                          <th>Attendance entries</th>
                          <th>Average entries / senior</th>
                          <th>Repeat seniors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.programmes || [])
                          .filter(
                            (p) =>
                              p.category ===
                              (selectedCategory || report.categories[0].label),
                          )
                          .map((p) => (
                            <tr key={p.programme}>
                              <th>
                                {p.programme}
                                <small>{p.domain}</small>
                              </th>
                              <td>{fmt(p.unique)}</td>
                              <td>{fmt(p.sessions)}</td>
                              <td>{fmt(p.attendance)}</td>
                              <td>{fmt(p.averagePerParticipant)}</td>
                              <td>
                                {fmt(p.repeat)} ({fmt(p.repeatRate)}%)
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <label className="field">
                    Demographic comparison
                    <select
                      value={dimension}
                      onChange={(e) => setDimension(e.target.value)}
                    >
                      {[
                        "Gender",
                        "Age band",
                        "Race",
                        "Client status",
                        "Service boundary",
                        "AAP domain",
                      ].map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <AnalysisGraphic
                    rows={(report.demographics || [])
                      .filter(
                        (d) =>
                          d.category ===
                            (selectedCategory || report.categories[0].label) &&
                          d.dimension === dimension,
                      )
                      .map((d) => ({ label: d.label, value: d.unique }))}
                    type="bar"
                    title={`${dimension} in the selected category`}
                  />
                  <p className="muted">
                    AAP domain reach overlaps; do not sum it. Repeat means two
                    or more distinct sessions in the same displayed scope.
                    Larger counts can reflect more available sessions.
                  </p>
                </>
              )}
              {(report.insights || []).map((i) => (
                <article className="callout" key={i.category}>
                  <h3>
                    {i.action} ? {i.category}
                  </h3>
                  <p>{i.figures}</p>
                  <p>{i.explanation}</p>
                  <p>{i.followUp}</p>
                </article>
              ))}
            </>
          )}
          <p className="muted">
            This report supports programme planning. Classifications are not
            diagnoses and attendance does not establish causation. The minimum
            subgroup rule is conservative and should be reviewed under the
            organisation's disclosure policy.
          </p>
        </>
      )}
    </section>
  );
}
export function RiskSettings({ onSaved }: { onSaved: () => void }) {
  type Config = {
    settings: Dashboard["settings"];
    values: { raw: string; participants: number }[];
  };
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Config>("/api/risk-configuration")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  const s = config?.settings;
  const update = (patch: Partial<Dashboard["settings"]>) =>
    setConfig((c) => (c ? { ...c, settings: { ...c.settings, ...patch } } : c));
  return (
    <section className="panel form-stack">
      <h2>Social Risk Factor Configuration</h2>
      <p>
        Administrator definitions apply to all reports. Document source-system
        meanings before mapping a code. Blank information always remains
        unknown. Complete raw strings are matched exactly; punctuation is never
        split automatically.
      </p>
      {error && <p role="alert">{error}</p>}
      {config && s && (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={s.multipleRiskFactors || false}
              onChange={(e) =>
                update({ multipleRiskFactors: e.target.checked })
              }
            />
            Source format confirmed: one raw value may map to multiple approved
            categories
          </label>
          <label className="field">
            Minimum sensitive subgroup size
            <input
              type="number"
              min={5}
              max={100}
              value={s.privacyMinimum}
              onChange={(e) =>
                update({ privacyMinimum: Number(e.target.value) })
              }
            />
          </label>
          {config.values.map(({ raw, participants }) => {
            const m = s.riskMappings?.[raw];
            const change = (patch: Partial<NonNullable<typeof m>>) =>
              update({
                riskMappings: {
                  ...s.riskMappings,
                  [raw]: {
                    label: "",
                    meaning: "",
                    noRisk: false,
                    categories: [],
                    ...m,
                    ...patch,
                  },
                },
              });
            return (
              <fieldset key={raw}>
                <legend>
                  {raw ? `Raw code: ${raw}` : "Blank / missing"} ·{" "}
                  {participants} participant profiles
                </legend>
                {!raw ? (
                  <p>Missing information cannot be mapped to no risk.</p>
                ) : (
                  <>
                    <p>
                      {m
                        ? "Configured mapping (save to apply)"
                        : "Unmapped: awaiting approved definition"}
                    </p>
                    <label className="field">
                      Label
                      <input
                        value={m?.label || ""}
                        onChange={(e) => change({ label: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Meaning / source definition
                      <textarea
                        value={m?.meaning || ""}
                        onChange={(e) => change({ meaning: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Approved category
                      {s.multipleRiskFactors
                        ? " names (one per line)"
                        : " name"}
                      <textarea
                        value={m?.categories.join("\n") || ""}
                        disabled={m?.noRisk}
                        onChange={(e) =>
                          change({
                            categories: e.target.value
                              .split("\n")
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={m?.noRisk || false}
                        onChange={(e) =>
                          change({
                            noRisk: e.target.checked,
                            ...(e.target.checked ? { categories: [] } : {}),
                          })
                        }
                      />
                      Source definition explicitly confirms this means no
                      recorded risk
                    </label>
                    <button
                      className="button"
                      onClick={() => {
                        const mappings = { ...s.riskMappings };
                        delete mappings[raw];
                        update({ riskMappings: mappings });
                      }}
                    >
                      Leave code unmapped
                    </button>
                  </>
                )}
              </fieldset>
            );
          })}
          <h3>Programme time definitions</h3>
          <p>
            Minutes after midnight. Morning precedes the first boundary;
            afternoon precedes the second.
          </p>
          {["Afternoon starts", "Evening starts"].map((label, i) => (
            <label className="field" key={label}>
              {label}
              <input
                type="time"
                value={`${String(Math.floor((s.timeBands?.[i] || [720, 1080][i]) / 60)).padStart(2, "0")}:${String((s.timeBands?.[i] || [720, 1080][i]) % 60).padStart(2, "0")}`}
                onChange={(e) => {
                  const bands = [...(s.timeBands || [720, 1080])];
                  const [h, m] = e.target.value.split(":").map(Number);
                  bands[i] = h * 60 + m;
                  update({ timeBands: bands });
                }}
              />
            </label>
          ))}
          <button
            className="button primary"
            onClick={async () => {
              try {
                await api("/api/risk-configuration", {
                  method: "PUT",
                  body: JSON.stringify(s),
                });
                setError("");
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save organisation definitions
          </button>
        </>
      )}
      <StaffAccounts />
    </section>
  );
}
function StaffAccounts() {
  const [message, setMessage] = useState("");
  return (
    <details>
      <summary>Staff accounts & permissions</summary>
      <p>
        Administrators manage definitions and imports. Planners view protected
        aggregates, export general reports and record planning actions. Viewers
        read general dashboards and save personal views. Saving an existing
        username resets its password and invalidates sessions.
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const values = Object.fromEntries(new FormData(form));
          try {
            await api("/api/users", {
              method: "POST",
              body: JSON.stringify(values),
            });
            form.reset();
            setMessage("Account saved; previous sessions revoked.");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <label className="field">
          Staff username
          <input name="username" required minLength={3} maxLength={60} />
        </label>
        <label className="field">
          Temporary password
          <input
            type="password"
            name="password"
            required
            minLength={12}
            maxLength={200}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          Permission
          <select name="role">
            <option value="viewer">Viewer</option>
            <option value="planner">Planner</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <button className="button">Save staff account</button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}

export function ProgrammeCompare({
  data,
  onProgramme,
  columns,
  setColumns,
}: {
  data: Dashboard;
  onProgramme: (p: Programme) => void;
  columns: string[];
  setColumns: Dispatch<SetStateAction<string[]>>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <section className="panel">
      <h3>Compare Programmes</h3>
      <p>
        Select two to four programmes. Reach is distinct within each programme
        and overlaps; frequency and sample sizes differ. Higher attendance alone
        does not establish greater effectiveness.
      </p>
      <div className="work-checks">
        {data.programmes.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              disabled={selected.length === 4 && !selected.includes(p.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, p.id]
                    : selected.filter((id) => id !== p.id),
                )
              }
            />
            {p.name}
          </label>
        ))}
      </div>
      <details>
        <summary>Choose comparison columns</summary>
        <div className="work-checks">
          {Object.entries(metrics).map(([key, [label]]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={columns.includes(key)}
                onChange={(e) =>
                  setColumns(
                    e.target.checked
                      ? [...columns, key]
                      : columns.filter((k) => k !== key),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      {selected.length >= 2 && (
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                {selected.map((id) => (
                  <th key={id}>
                    <button
                      className="text-button"
                      onClick={() =>
                        onProgramme(data.programmes.find((p) => p.id === id)!)
                      }
                    >
                      {data.programmes.find((p) => p.id === id)?.name}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>AAP domain</th>
                {selected.map((id) => (
                  <td key={id}>
                    {data.programmes.find((p) => p.id === id)?.domain}
                  </td>
                ))}
              </tr>
              {columns
                .filter((k) => metrics[k])
                .map((k) => (
                  <tr key={k}>
                    <th>{metrics[k][0]}</th>
                    {selected.map((id) => (
                      <td key={id}>
                        {fmt(
                          data.programmes.find((p) => p.id === id)?.[
                            k as keyof Stats
                          ],
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
