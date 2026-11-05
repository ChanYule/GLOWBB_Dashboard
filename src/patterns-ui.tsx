import { useEffect, useState, lazy, Suspense } from "react";
import { api } from "./api";
import { ReportBars } from "./management";
import type { User } from "./types";
import "./patterns.css";
const LocationAdmin = lazy(() =>
  import("./location-admin").then((m) => ({ default: m.LocationAdmin })),
);
const EventTypeInsights=lazy(()=>import('./event-types-ui').then(m=>({default:m.EventTypeInsights})));
const LocationBlocks = lazy(() =>
  import("./location-ui").then((m) => ({ default: m.LocationBlocks })),
);
const ActionEditor = lazy(() =>
  import("./needs-ui").then((m) => ({ default: m.ActionEditor })),
);
type ActionDraft = ReturnType<typeof import("./needs-ui").blankAction>;
const PresentationFrame = lazy(() =>
  import("./presentation").then((m) => ({ default: m.PresentationFrame })),
);
const dimensions = {
  age: "Age Group",
  cfs: "CFS",
  risk: "Social Risk Factor",
  race: "Race",
  gender: "Gender",
  living: "Living Arrangement",
  block: "Residential block",
  distance: "Location & Distance",
  eventType: 'Event Type',
};
type Query = Record<string, string>;
type Group = {
  label: string;
  suppressed: boolean;
  registered?: number | null;
  unique?: number;
  noAttendance?: number | null;
  rate?: number | null;
  attendance?: number;
  programmes?: number;
  domains?: number;
  averageDomains?: number | null;
  averageSessions?: number | null;
  repeat?: number;
  opportunity?: number;
  repeatRate?: number | null;
  firstObserved?: number;
  returning?: number;
};
type Programme = {
  id: string;
  name: string;
  domain: string;
  sessions: number;
  unique: number;
  attendance: number | null;
  repeat: number | null;
  repeatRate: number | null;
  averageSessions: number | null;
};
export type Report = {
  dimension: keyof typeof dimensions;
  location?: null | {
    centre: { address: string; status: string };
    metric: string;
    destination: string;
    note: string;
    destinations: { id: string; label: string }[];
    verifiedClients: number | null;
    registered: number | null;
    attending: number | null;
    noAttendance: number | null;
    locationCompleteness: number | null;
    transport: null | {
      reported: number;
      noReportedBarrier: number;
      notAssessed: number;
      staffObserved: number;
      denominator: number;
    };
    blockRows: null | {
      rows: (Group & {
        distance: number | null;
        method: string;
        verified: boolean;
      })[];
      total: number;
      page: number;
    };
    timing?: null | { label: string; unique: number }[];
  };
  minority: null | {
    registered: number | null;
    unique: number;
    rate: number | null;
  };
  scope: string;
  basis: string;
  group: string;
  ranking: string;
  period: { from: string | null; to: string | null };
  coverage: { from: string | null; to: string | null };
  minimum: number;
  ratesAvailable: boolean;
  registryComplete: boolean;
  population: number | null;
  completeness: number | null;
  comparisonSuppressed: boolean;
  groups: Group[];
  rankings: {
    suppressed: boolean;
    rows: Programme[];
    total: number | null;
    page: number;
    limit: number;
  };
  domainsAvailable: string[];
  domains: { suppressed: boolean; rows: { label: string; unique: number }[] };
  combined: null | {
    suppressed: boolean;
    rows: (Group & { groups: string[] })[];
  };
  reportedBarriers: {
    suppressed: boolean;
    rows: { label: string; unique: number }[];
  };
  programmeDetail:
    | null
    | (Programme & {
        suppressed: boolean;
        breakdown: { label: string; unique: number }[];
        accessibilityFields: string[];
      });
  findings: {
    title: string;
    evidence: string;
    interpretation: string;
    investigate: string;
    action: string;
  }[];
  limitations: string[];
  metricsDefinition: Record<string, string>;
};
const fmt = (n: number | null | undefined, suffix = "") =>
  n == null
    ? "Unavailable / withheld"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n) +
      suffix;
const presets = [
  ["age", "Age and Programme Participation"],
  ["cfs", "CFS Participation Patterns"],
  ["risk", "SRF Participation Patterns"],
  ["race", "Race and Minority Outreach"],
  ["living", "Living Arrangement Participation"],
  ["repeat", "Repeat Programme Engagement"],
  ["overall", "Overall Programme Planning"],
  ["gender", "Gender Participation"],
  ["block", "Residential Participation"],
  ["distance", "Location and Participation"],
];
const denied =
  "Small groups or this filter combination are protected. Try the full available period without a domain filter. Missing and withheld values are not zero.";

function Ranking({
  report,
  onProgramme,
  printing = false,
}: {
  report: Report;
  onProgramme?: (id: string) => void;
  printing?: boolean;
}) {
  if (report.rankings.suppressed) return <p className="note">{denied}</p>;
  return report.rankings.rows.length ? (
    <div className="work-table patterns-programmes">
      <table>
        <caption className="sr-only">
          Programme rankings for {report.group}
        </caption>
        <thead>
          <tr>
            <th>Programme / domain</th>
            <th>Delivered sessions</th>
            <th>Unique reach</th>
            <th>Attendance entries</th>
            <th>Repeat</th>
          </tr>
        </thead>
        <tbody>
          {report.rankings.rows.slice(0, printing ? 5 : undefined).map((p) => (
            <tr key={p.id}>
              <th>
                {onProgramme && !printing ? (
                  <button
                    className="text-button"
                    onClick={() => onProgramme(p.id)}
                  >
                    {p.name}
                  </button>
                ) : (
                  p.name
                )}
                <small>{p.domain}</small>
              </th>
              <td>{p.sessions}</td>
              <td>{p.unique}</td>
              <td>{fmt(p.attendance)}</td>
              <td>
                {p.repeatRate == null
                  ? p.sessions <= 1
                    ? "Not applicable: one session"
                    : "Withheld"
                  : `${p.repeat} (${p.repeatRate}%)`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="note">
      No eligible programmes for this group and ranking metric.
    </p>
  );
}

export function ParticipationPatterns({
  user,
  revision,
  initialDimension = "",
  onClients,
}: {
  user: User;
  revision: number;
  initialDimension?: string;
  onClients?: () => void;
}) {
  const [q, setQ] = useState<Query>({
    dimension: initialDimension || "age",
    scope: "clients",
    ranking: "unique",
    basis: "current",
  });
  const [adminOpen, setAdminOpen] = useState(false),
    [locationRevision, setLocationRevision] = useState(0),
    [actionDraft, setActionDraft] = useState<ActionDraft | null>(null);
  const [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false);
  const [metric, setMetric] = useState("rate"),
    [advanced, setAdvanced] = useState(false),
    [printReport, setPrintReport] = useState<Report | null>(null);
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    api<{ patterns?: Query }>("/api/preferences", { signal: c.signal })
      .then((p) => {
        if (p.patterns)
          setQ({
            ...p.patterns,
            ...(initialDimension
              ? {
                  dimension: initialDimension,
                  scope: "clients",
                  group: "",
                  second: "",
                }
              : {}),
          });
      })
      .catch(() => {})
      .finally(() => {
        if (!c.signal.aborted) setReady(true);
      });
    return () => c.abort();
  }, [user.role, initialDimension]);
  const query = new URLSearchParams({
    ...q,
    ...(!advanced ? { second: "" } : {}),
  }).toString();
  useEffect(() => {
    if (user.role === "viewer" || !ready || q.dimension==='eventType') return;
    const c = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Report>("/api/participation-patterns?" + query, { signal: c.signal })
        .then((r) => {
          if (!c.signal.aborted) {
            setReport(r);
            setError("");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, revision, locationRevision, user.role, ready, q.dimension]);
  if (user.role === "viewer")
    return (
      <section className="panel">
        <h2>Authorised staff access</h2>
        <p>
          Participant characteristics and combined analyses are restricted to
          authorised staff.
        </p>
      </section>
    );
  const update = (key: string, value: string) =>
    setQ((old) => ({
      ...old,
      [key]: value,
      ...(key !== "page" ? { page: "0" } : {}),
      ...(["dimension", "scope", "from", "to", "domain", "basis"].includes(key)
        ? { group: "", programme: "" }
        : {}),
    }));
  if(q.dimension==='eventType')return <><div className="patterns-dimensions" role="group" aria-label="Participant characteristic">{Object.entries(dimensions).map(([key,label])=><button key={key} aria-pressed={key==='eventType'} onClick={()=>setQ(old=>({...old,dimension:key,group:'',second:''}))}>{label}</button>)}</div><div className="patterns-filter-grid"><label>From<input aria-label="Event patterns from" type="date" value={q.from||''} onChange={e=>update('from',e.target.value)}/></label><label>To<input aria-label="Event patterns to" type="date" value={q.to||''} onChange={e=>update('to',e.target.value)}/></label></div><Suspense fallback={<p>Loading programme classifications…</p>}><EventTypeInsights user={user} revision={revision} initial={{from:q.from||'',to:q.to||''}} patterns/></Suspense></>;
  const chooseDimension = (dimension: string) => {
    setAdvanced(false);
    setQ((old) => ({
      ...old,
      dimension,
      scope: dimension === "distance" ? "clients" : old.scope,
      group: "",
      programme: "",
      second: "",
      page: "0",
      all: "",
    }));
  };
  const selected = report?.groups.find((g) => g.label === report.group);
  const comparisonMetric =
    !report?.ratesAvailable && metric === "rate" ? "unique" : metric;
  const takeReport = async () => {
    setMessage("");
    try {
      const r = await api<Report>(
        "/api/participation-patterns/export?" + query,
      );
      setPrintReport(r);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <div className="patterns-page" aria-busy={loading}>
      <p className="muted">
        Understand how participant groups engage with programmes and identify
        opportunities for future planning.
      </p>
      <section className="panel patterns-controls">
        <div className="patterns-filter-grid">
          <label>
            Analysis preset
            <select
              aria-label="Analysis preset"
              value={
                q.dimension === "distance"
                  ? "distance"
                  : q.ranking === "repeat"
                    ? "repeat"
                    : q.scope === "overall"
                      ? "overall"
                      : q.dimension
              }
              onChange={(e) => {
                const v = e.target.value;
                setAdvanced(false);
                setQ({
                  ...q,
                  dimension: ["repeat", "overall"].includes(v) ? "age" : v,
                  scope: v === "overall" ? "overall" : "clients",
                  ranking: v === "repeat" ? "repeat" : "unique",
                  group: "",
                  second: "",
                  programme: "",
                  page: "0",
                });
              }}
            >
              {presets.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Population
            <select
              aria-label="Analysis population"
              value={q.scope}
              onChange={(e) => update("scope", e.target.value)}
            >
              <option value="clients">Registered clients (all ages)</option>
              <option value="overall" disabled={q.dimension === "distance"}>
                All attendance participants (all ages)
              </option>
            </select>
          </label>
          <label>
            From
            <input
              aria-label="Patterns from"
              type="date"
              value={q.from || ""}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <label>
            To
            <input
              aria-label="Patterns to"
              type="date"
              value={q.to || ""}
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
        </div>
        <div
          className="patterns-dimensions"
          role="group"
          aria-label="Participant characteristic"
        >
          {Object.entries(dimensions).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={q.dimension === key}
              onClick={() => chooseDimension(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {q.dimension === "distance" && (
          <div className="patterns-filter-grid">
            <label>
              Distance measure
              <select
                aria-label="Distance measure"
                value={q.distanceMetric || "walking"}
                onChange={(e) => update("distanceMetric", e.target.value)}
              >
                <option value="walking">Walking-route distance</option>
                <option value="time">Estimated walking-route time</option>
                <option value="straight">
                  Straight-line distance (not walking)
                </option>
              </select>
            </label>
            <label>
              Distance destination
              <select
                aria-label="Distance destination"
                value={q.destination || "centre"}
                onChange={(e) => update("destination", e.target.value)}
              >
                {(
                  report?.location?.destinations || [
                    { id: "centre", label: "Main GLOW BB centre" },
                  ]
                ).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="work-actions patterns-actions">
          <button
            className="button"
            onClick={async () => {
              try {
                const {
                  second: _second,
                  programme: _programme,
                  page: _page,
                  all: _all,
                  ...saved
                } = q;
                void _second;
                void _programme;
                void _page;
                void _all;
                await api("/api/participation-patterns/preferences", {
                  method: "PUT",
                  body: JSON.stringify(saved),
                });
                setMessage(
                  "Preferred analytical view saved to your staff account.",
                );
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Save preferred view
          </button>
          <button
            className="button"
            onClick={() => {
              setAdvanced(false);
              setQ({
                dimension: "age",
                scope: "clients",
                ranking: "unique",
                basis: "current",
              });
            }}
          >
            Reset analysis
          </button>
          <button
            className="button primary"
            disabled={loading || !!error || !report}
            onClick={takeReport}
          >
            Presentation / PDF
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
      {q.dimension === "distance" && user.role === "admin" && (
        <details
          className="panel"
          onToggle={(e) => setAdminOpen(e.currentTarget.open)}
        >
          <summary>Administrator location verification</summary>
          {adminOpen && (
            <Suspense fallback={<p>Loading location review...</p>}>
              <LocationAdmin
                onChanged={() => setLocationRevision((n) => n + 1)}
              />
            </Suspense>
          )}
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="muted">
          Updating selected analysis...
        </p>
      )}
      {report && (
        <div
          className={
            loading || error ? "patterns-results updating" : "patterns-results"
          }
        >
          <p className="patterns-basis">
            {report.period.from || "No delivered history"} to{" "}
            {report.period.to || "—"} ·{" "}
            {report.scope === "clients"
              ? "Current registered-client population"
              : "All recorded attendees; no registered-client rate denominator"}{" "}
            ·{" "}
            {report.basis === "dated"
              ? "Dated profile snapshots"
              : "Current recorded attributes"}
            {q.domain ? ` / Domain: ${q.domain}` : ""}
          </p>
          <div className="patterns-kpis">
            {(report.dimension === "distance" && report.location
              ? [
                  [
                    "Verified residential locations",
                    fmt(report.location.verifiedClients),
                  ],
                  ["Clients with attendance", fmt(report.location.attending)],
                  ["No recorded attendance", fmt(report.location.noAttendance)],
                  [
                    "Selected distance-group rate",
                    selected?.suppressed
                      ? "Withheld"
                      : fmt(selected?.rate, "%"),
                  ],
                ]
              : [
                  [
                    report.scope === "clients"
                      ? "Registered clients"
                      : "Unique participants",
                    fmt(report.population),
                  ],
                  ["Selected group", report.group || "No group"],
                  [
                    report.scope === "clients"
                      ? "Group participation rate"
                      : "Group unique reach",
                    selected?.suppressed
                      ? "Withheld"
                      : report.scope === "clients"
                        ? fmt(selected?.rate, "%")
                        : fmt(selected?.unique),
                  ],
                  ["Known characteristic", fmt(report.completeness, "%")],
                ]
            ).map(([label, value]) => (
              <article className="panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          {report.dimension === "distance" && report.location && (
            <p className="note">
              Verified residential location coverage:{" "}
              {fmt(report.location.locationCompleteness, "%")} of registered
              clients. Availability of the selected distance measure:{" "}
              {fmt(report.completeness, "%")} ? Selected group: {report.group}.
              Centre coordinates: {report.location.centre.status}.{" "}
              {report.location.note} Unknown distances remain in the population.
            </p>
          )}
          <section className="panel">
            <div className="report-section-heading">
              <h2>
                {report.dimension === "distance"
                  ? "Participation by Distance"
                  : "Participant group comparison"}
              </h2>
              <label>
                Compare
                <select
                  aria-label="Group comparison metric"
                  value={comparisonMetric}
                  onChange={(e) => setMetric(e.target.value)}
                >
                  {report.scope === "clients" && (
                    <option value="rate" disabled={!report.ratesAvailable}>
                      Client participation rate (%)
                    </option>
                  )}
                  <option value="unique">Unique participating people</option>
                  <option value="averageSessions">Average sessions</option>
                  <option value="repeatRate">Repeat engagement (%)</option>
                </select>
              </label>
            </div>
            {!report.coverage.from ? (
              <p>
                Import and review attendance to compare participation.
                Registered clients without attendance remain in the population.
              </p>
            ) : report.comparisonSuppressed ? (
              <p className="note">{denied}</p>
            ) : (
              <>
                <ReportBars
                  maxValue={
                    ["rate", "repeatRate"].includes(comparisonMetric)
                      ? 100
                      : undefined
                  }
                  rows={report.groups
                    .filter((g) => g[comparisonMetric as keyof Group] != null)
                    .map((g) => ({
                      label: g.label,
                      value: Number(g[comparisonMetric as keyof Group]),
                      detail: `${fmt(g.unique)} participating${g.registered == null ? "" : ` / ${fmt(g.registered)} registered`} · ${fmt(g.rate, "%")} client rate`,
                    }))}
                />
                {!report.ratesAvailable && report.scope === "clients" && (
                  <p className="note">
                    A complete, verified client registry and delivered
                    attendance are required before participation rates can be
                    shown.
                  </p>
                )}
              </>
            )}
            <details>
              <summary>View group figures and definitions</summary>
              <div className="work-table">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Registered</th>
                      <th>Participating</th>
                      <th>No recorded attendance</th>
                      <th>Rate (%)</th>
                      <th>Entries</th>
                      <th>Programmes</th>
                      <th>Domains</th>
                      <th>Average sessions</th>
                      <th>Repeat (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.groups.map((g) => (
                      <tr key={g.label}>
                        <th>{g.label}</th>
                        {[
                          g.registered,
                          g.unique,
                          g.noAttendance,
                          g.rate,
                          g.attendance,
                          g.programmes,
                          g.domains,
                          g.averageSessions,
                          g.repeatRate,
                        ].map((n, i) => (
                          <td key={i}>{g.suppressed ? "Withheld" : fmt(n)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.values(report.metricsDefinition).map((d) => (
                <p key={d}>{d}</p>
              ))}
            </details>
          </section>
          {report.dimension === "distance" && (
            <Suspense fallback={<p>Loading residential comparison...</p>}>
              <LocationBlocks
                query={q}
                revision={revision + locationRevision}
                onClients={onClients}
              />
            </Suspense>
          )}
          <section className="panel">
            <h2>Most Popular Programmes by Participant Group</h2>
            <div className="patterns-filter-grid">
              <label>
                Specific group
                <select
                  aria-label="Specific participant group"
                  value={report.group}
                  onChange={(e) => update("group", e.target.value)}
                >
                  {report.groups.map((g) => (
                    <option key={g.label}>{g.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Ranking metric
                <select
                  aria-label="Programme ranking metric"
                  value={q.ranking}
                  onChange={(e) => update("ranking", e.target.value)}
                >
                  <option value="unique">Unique Reach</option>
                  <option value="attendance">Attendance Entries</option>
                  <option value="repeat">Repeat Engagement</option>
                </select>
              </label>
            </div>
            <p className="muted">
              Only privacy-safe programme results are shown. Withheld cells are
              not zero.
            </p>
            <Ranking
              report={report}
              onProgramme={(id) => update("programme", id)}
            />
            {!report.rankings.suppressed && (
              <div className="work-actions">
                <button
                  className="button"
                  onClick={() => update("all", q.all === "1" ? "" : "1")}
                >
                  {q.all === "1" ? "Top five" : "View all programmes"}
                </button>
                {q.all === "1" && (
                  <>
                    <button
                      className="button"
                      disabled={!report.rankings.page}
                      onClick={() =>
                        update("page", String(report.rankings.page - 1))
                      }
                    >
                      Previous programmes
                    </button>
                    <button
                      className="button"
                      disabled={
                        (report.rankings.page + 1) * 20 >=
                        (report.rankings.total || 0)
                      }
                      onClick={() =>
                        update("page", String(report.rankings.page + 1))
                      }
                    >
                      Next programmes
                    </button>
                  </>
                )}
              </div>
            )}
            {report.programmeDetail && (
              <details open>
                <summary>
                  Selected programme: {report.programmeDetail.name}
                </summary>
                {report.programmeDetail.suppressed ? (
                  <p>{denied}</p>
                ) : (
                  <ReportBars
                    rows={report.programmeDetail.breakdown.map((g) => ({
                      label: g.label,
                      value: g.unique,
                    }))}
                  />
                )}
                <p>
                  Accessibility fields recorded:{" "}
                  {report.programmeDetail.accessibilityFields.join(", ") ||
                    "No supported structured fields recorded"}
                  . Review the existing programme accessibility workspace for
                  the full staff assessment.
                </p>
              </details>
            )}
          </section>
          <section className="panel">
            <h2>Repeat participation and engagement</h2>
            {selected?.suppressed ? (
              <p>{denied}</p>
            ) : (
              <>
                <div className="patterns-repeat">
                  <p>
                    <strong>{fmt(selected?.repeat)}</strong> people repeated the
                    same programme
                  </p>
                  <p>
                    <strong>{fmt(selected?.repeatRate, "%")}</strong> among{" "}
                    {fmt(selected?.opportunity)} people with repeat opportunity
                  </p>
                  <p>
                    <strong>{fmt(selected?.averageSessions)}</strong> sessions
                    per participating person
                  </p>
                  <p>
                    <strong>
                      {fmt(selected?.firstObserved)} /{" "}
                      {fmt(selected?.returning)}
                    </strong>{" "}
                    first observed / recorded before this period
                  </p>
                </div>
                <p className="muted">
                  One-session programmes have no repeat opportunity. First
                  observed means first in available records, not a new client.
                </p>
              </>
            )}
            <details>
              <summary>Programme variety and sourced feedback</summary>
              {report.domains.suppressed ? (
                <p>{denied}</p>
              ) : (
                <ReportBars
                  rows={report.domains.rows.map((d) => ({
                    label: d.label,
                    value: d.unique,
                  }))}
                />
              )}
              <h3>Reported barriers</h3>
              {report.reportedBarriers.suppressed ? (
                <p>Feedback aggregates are withheld under privacy rules.</p>
              ) : report.reportedBarriers.rows.length ? (
                <ReportBars
                  rows={report.reportedBarriers.rows.map((b) => ({
                    label: b.label,
                    value: b.unique,
                  }))}
                />
              ) : (
                <p>
                  No releasable participant/caregiver-reported barriers are
                  recorded for this group. Ask for voluntary feedback; do not
                  infer a reason from attendance.
                </p>
              )}
            </details>
          </section>
          {report.dimension === "distance" && report.location && (
            <section className="panel">
              <h2>Reported Transport Barriers by Distance Group</h2>
              <p>
                {report.group}: sourced participant/caregiver reports are
                separate from assumptions about distance.
              </p>
              {report.location.transport ? (
                <div className="patterns-repeat">
                  <p>
                    <strong>{fmt(report.location.transport.reported)}</strong>{" "}
                    with a sourced transport concern
                  </p>
                  <p>
                    <strong>
                      {fmt(report.location.transport.noReportedBarrier)}
                    </strong>{" "}
                    explicitly reported no transport barrier
                  </p>
                  <p>
                    <strong>
                      {fmt(report.location.transport.notAssessed)}
                    </strong>{" "}
                    not assessed / not confirmed
                  </p>
                  <p>
                    <strong>
                      {fmt(report.location.transport.staffObserved)}
                    </strong>{" "}
                    with staff-observed concerns (separate from reported
                    barriers)
                  </p>
                </div>
              ) : (
                <p>
                  Response coverage is withheld or unavailable under privacy
                  rules. Missing feedback is not absence of a barrier.
                </p>
              )}
              {onClients && (
                <button className="button" onClick={onClients}>
                  Review client feedback and follow-up
                </button>
              )}
              <details>
                <summary>Observed weekday and time-slot participation</summary>
                {report.location.timing ? (
                  <ReportBars
                    rows={report.location.timing.map((r) => ({
                      label: r.label,
                      value: r.unique,
                    }))}
                  />
                ) : (
                  <p>
                    Timing breakdowns are unavailable or protected for this
                    group. Observed attendance does not establish a preferred
                    schedule.
                  </p>
                )}
              </details>
            </section>
          )}
          <section className="patterns-findings">
            <h2>What the Data Tells Us</h2>
            {report.findings.map((f) => (
              <article className="panel" key={f.title}>
                <h3>{f.title}</h3>
                <p>
                  <b>Evidence:</b> {f.evidence}
                </p>
                <p>{f.interpretation}</p>
                <p>
                  <b>What to investigate:</b> {f.investigate}
                </p>
                <p>
                  <b>Suggested action:</b> {f.action}
                </p>
                {report.dimension === "distance" && (
                  <button
                    className="button"
                    onClick={async () => {
                      const { blankAction } = await import("./needs-ui");
                      const draft = blankAction("outreach", {
                        id: "location-finding",
                        category: "Targeted Outreach",
                        title: f.title,
                        finding: f.evidence,
                        explanation: f.interpretation,
                        action: f.action,
                        target: report.group,
                        evidence: f.evidence,
                        priority: "Medium",
                        next: f.investigate,
                      });
                      draft.notes = (
                        f.interpretation +
                        " Investigate: " +
                        f.investigate
                      ).slice(0, 2000);
                      draft.reportedNeeds = report.location?.transport
                        ? `${report.location.transport.reported} sourced transport concerns in this group; verify individual requirements through existing records.`
                        : "Reported barriers are unavailable or withheld. Seek appropriate voluntary feedback.";
                      draft.evidenceSource = `Protected location analysis: ${report.period.from} to ${report.period.to}`;
                      setActionDraft(draft);
                    }}
                  >
                    Record proposed location follow-up
                  </button>
                )}
              </article>
            ))}
          </section>
          <details
            className="panel"
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setAdvanced(open);
              if (open && q.dimension === "distance" && !q.second)
                setQ((old) => ({ ...old, second: "cfs" }));
            }}
          >
            <summary>
              {q.dimension === "distance"
                ? "Explore Distance and Other Factors"
                : "Advanced comparison (optional)"}
            </summary>
            {advanced && (
              <>
                <div className="patterns-filter-grid">
                  <label>
                    Second characteristic
                    <select
                      aria-label="Second characteristic"
                      value={q.second || ""}
                      onChange={(e) => update("second", e.target.value)}
                    >
                      <option value="">Choose another characteristic</option>
                      {Object.entries({
                        ...dimensions,
                        ...(q.dimension === "distance"
                          ? { participation: "Client Participation Status" }
                          : {}),
                      })
                        .filter(
                          ([key]) =>
                            key !== q.dimension &&
                            (q.dimension !== "distance" || key !== "block"),
                        )
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Programme domain
                    <select
                      aria-label="Patterns programme domain"
                      value={q.domain || ""}
                      onChange={(e) => update("domain", e.target.value)}
                    >
                      <option value="">All domains</option>
                      {report.domainsAvailable.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Attribute basis
                    <select
                      aria-label="Attribute basis"
                      value={q.basis}
                      onChange={(e) => update("basis", e.target.value)}
                    >
                      <option value="current">Current recorded profile</option>
                      <option value="dated">Dated profile at period end</option>
                    </select>
                  </label>
                </div>
                {q.dimension === "distance" &&
                  report.combined &&
                  !report.combined.suppressed && (
                    <label>
                      Focus secondary group
                      <select
                        aria-label="Focus secondary group"
                        value={q.stratum || ""}
                        onChange={(e) => update("stratum", e.target.value)}
                      >
                        <option value="">All supported groups</option>
                        {[
                          ...new Set(
                            report.combined.rows.map((r) => r.groups[1]),
                          ),
                        ].map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </label>
                  )}
                {report.combined &&
                  (report.combined.suppressed ? (
                    <p className="note">{denied}</p>
                  ) : (
                    <div className="work-table">
                      <table>
                        <thead>
                          <tr>
                            <th>First characteristic</th>
                            <th>Second characteristic</th>
                            <th>Registered</th>
                            <th>Participating</th>
                            <th>Rate (%)</th>
                            <th>Average sessions</th>
                            <th>Repeat (%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.combined.rows
                            .filter(
                              (r) => !q.stratum || r.groups[1] === q.stratum,
                            )
                            .map((r) => (
                              <tr key={r.groups.join("|")}>
                                <th>{r.groups[0]}</th>
                                <th>{r.groups[1]}</th>
                                <td>{fmt(r.registered)}</td>
                                <td>{fmt(r.unique)}</td>
                                <td>{fmt(r.rate)}</td>
                                <td>{fmt(r.averageSessions)}</td>
                                <td>{fmt(r.repeatRate)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
              </>
            )}
          </details>
          <details className="panel">
            <summary>Data coverage and limitations</summary>
            {report.limitations.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p>
              Delivered attendance available: {report.coverage.from || "None"}{" "}
              to {report.coverage.to || "None"}.
            </p>
          </details>
        </div>
      )}
      {printReport && (
        <Suspense fallback={<p role="status">Preparing report...</p>}>
          <PresentationFrame
            title="Participation Patterns & Insights"
            close={() => setPrintReport(null)}
          >
            <section className="report-slide">
              <h1>
                {printReport.dimension === "distance"
                  ? "Does Distance Affect Recorded Participation?"
                  : "Participation Patterns & Insights"}
              </h1>
              <p>
                {printReport.period.from} to {printReport.period.to} ·{" "}
                {dimensions[printReport.dimension]} · {printReport.group} ·{" "}
                {printReport.scope === "clients"
                  ? "Registered clients"
                  : "All attendees"}
              </p>
              <p>
                Population: {fmt(printReport.population)} · Selected group
                participation:{" "}
                {fmt(
                  printReport.groups.find((g) => g.label === printReport.group)
                    ?.rate,
                  "%",
                )}
              </p>
              {printReport.location && (
                <p>
                  Measure:{" "}
                  {printReport.location.metric === "straight"
                    ? "Straight-line distance (not a walking route)"
                    : printReport.location.metric === "time"
                      ? "Estimated walking-route time"
                      : "Walking-route distance"}
                  . Destination: {printReport.location.destination}. This is an
                  observed participation comparison, not a causal or
                  accessibility assessment.
                </p>
              )}
              <h2>
                {printReport.ratesAvailable
                  ? "Client participation rate (%)"
                  : "Unique participating people"}
              </h2>
              {printReport.comparisonSuppressed ? (
                <p>{denied}</p>
              ) : (
                <ReportBars
                  maxValue={printReport.ratesAvailable ? 100 : undefined}
                  rows={printReport.groups
                    .filter(
                      (g) =>
                        !g.suppressed &&
                        (!printReport.ratesAvailable || g.rate != null),
                    )
                    .map((g) => ({
                      label: g.label,
                      value:
                        (printReport.ratesAvailable ? g.rate : g.unique) ?? 0,
                      detail: `${fmt(g.unique)} participating / ${fmt(g.registered)} registered`,
                    }))}
                />
              )}
            </section>
            <section className="report-slide">
              <h2>Programmes and repeat engagement</h2>
              <Ranking report={printReport} printing />
              <p>
                Group repeat rate:{" "}
                {fmt(
                  printReport.groups.find((g) => g.label === printReport.group)
                    ?.repeatRate,
                  "%",
                )}
                .
              </p>
            </section>
            <section className="report-slide">
              <h2>Findings and planning implications</h2>
              {printReport.findings.slice(0, 3).map((f) => (
                <article key={f.title}>
                  <h3>{f.title}</h3>
                  <p>
                    {f.evidence} {f.interpretation}
                  </p>
                  <p>Investigate: {f.investigate}</p>
                  <p>Next step: {f.action}</p>
                </article>
              ))}
            </section>
            <section className="report-slide">
              <h2>Definitions and limitations</h2>
              {printReport.limitations.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </section>
          </PresentationFrame>
        </Suspense>
      )}
      {actionDraft && (
        <Suspense fallback={<p>Loading existing planning form...</p>}>
          <ActionEditor
            value={actionDraft}
            onClose={() => setActionDraft(null)}
            onSaved={() => {
              setActionDraft(null);
              setMessage(
                "Proposed location follow-up saved in the existing Detailed action tracker.",
              );
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
