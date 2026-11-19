import {ProgrammeDomainAnalysis} from './programme-domains-ui';
import { useEffect, useState, lazy, Suspense } from "react";
import { api } from "./api";
import {activityDomains} from '../shared/activity-domains.js';
import { ReportBars } from "./management";
import type { User } from "./types";
import { ProgrammeClassificationTable, type ProgrammeClassificationRow } from "./programme-classification-table";
import "./patterns.css";
import {populations} from '../shared/participation-compat.js';
import { EngagementPanel } from './engagement-panel';
import type { EngagementSummary, EngagementMetadata } from '../shared/engagement-depth.js';
const PresentationFrame = lazy(() =>
  import("./presentation").then((m) => ({ default: m.PresentationFrame })),
);
type Row = {
  engagement?: EngagementSummary | null;
  label: string;
  sessions: number;
  programmes: number;
  unique: number | null;
  attendance: number | null;
  repeat: number | null;
  opportunity: number | null;
  repeatRate: number | null;
  averageSessions: number | null;
  average: number | null;
  multiProgramme: number | null;
  multiDomain: number | null;
  rate: number | null;
  male: number | null;
  minority: number | null;
  suppressed: boolean;
};
export type EventReport = {
  engagement?: EngagementMetadata;
  period: { from: string | null; to: string | null };
  scope: string;
  target: string;
  minimum: number;
  ratesAvailable: boolean;
  registered: number | null;
  total: Row;
  domains: Row[];
  types: Row[];
  matrix: (Row & { domain: string })[];
  programmeClassifications: ProgrammeClassificationRow[];
  rankings: {
    rows: (Row & { id: string; domain: string; eventTypes: string[] })[];
    total: number;
    page: number;
    limit: number;
  };
  options: { domains: string[]; eventTypes: string[]; groups: string[] };
  findings: {
    finding: string;
    evidence: string;
    implication: string;
    investigate: string;
    action: string;
  }[];
  alignment: string;
  alignmentRows?: {
    label: string;
    respondents: number;
    sessions: number;
    reached: number | null;
  }[];
  limitations: string[];
};
const fmt = (v: number | null | undefined) =>
  v == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(v);
const factors = {
  age: "Age Group",
  gender: "Gender",
  race: "Race",
  cfs: "CFS",
  risk: "Social Risk Factor",
  living: "Living Arrangement",
  distance: "Distance",
  participation: "Participation Status",
  block: "Residential Area",
};
export function RawClassificationAudit({
  user,
  revision = 0,
  initial = {},
  onProgramme,
  patterns = false,
}: {
  user: User;
  revision?: number;
  initial?: Record<string, string>;
  onProgramme?: (id: string) => void;
  patterns?: boolean;
}) {
  const [q, setQ] = useState<Record<string, string>>({
      scope: initial.scope || (patterns ? "clients" : "overall"),
      target: initial.target || (patterns ? "all" : "senior"),
      ranking: "unique",
    }),
    [report, setReport] = useState<EventReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [view, setView] = useState("event"),
    [measure, setMeasure] = useState("sessions"),
    [matrixOpen, setMatrixOpen] = useState(false),
    [compare, setCompare] = useState(false),
    [admin, setAdmin] = useState(false),
    [localRevision, setLocalRevision] = useState(0),
    [print, setPrint] = useState<EventReport | null>(null),
    [message, setMessage] = useState("");
  const base = JSON.stringify(initial);
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    api<{ eventTypes?: Record<string, string> }>("/api/preferences", {
      signal: c.signal,
    })
      .then((p) => {
        if (p.eventTypes && !c.signal.aborted)
          setQ((old) => ({
            ...old,
            ...Object.fromEntries(
              Object.entries(p.eventTypes!).filter(([key]) =>
                [
                  "scope",
                  "target",
                  "ranking",
                  "eventType",
                  "factor",
                  "group",
                  "distanceMetric",
                ].includes(key),
              ),
            ),
          }));
      })
      .catch(() => {});
    return () => c.abort();
  }, [user.role]);
  const query = new URLSearchParams({
    ...JSON.parse(base),
    ...q,
    ...(patterns?{scope:initial.scope||q.scope,from:initial.from||'',to:initial.to||''}:{}),
    ...(!compare ? { factor: "", group: "" } : {}),
  }).toString();
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<EventReport>("/api/event-types/report?" + query, { signal: c.signal })
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
  }, [query, revision, localRevision, user.role]);
  const update = (k: string, v: string) =>
    setQ((old) => ({
      ...old,
      [k]: v,
      page: "0",
      ...(k === "factor" ? { group: "" } : {}),
      ...(k === "factor" && v === "distance" ? { scope: "clients" } : {}),
    }));
  if (user.role === "viewer")
    return (
      <section className="panel">
        <h2>Programme classifications</h2>
        <p>
          Detailed programme-type comparisons require authorised staff access.
        </p>
      </section>
    );
  const rows = report ? (view === "event" ? report.types : report.domains) : [],
    denominator =
      report?.total[measure as "sessions" | "programmes" | "unique"];
  return (
    <div className="patterns-page event-insights" aria-busy={loading}>
      <section className="panel">
        <h2>Raw source classification audit</h2>
        <p className="note">
          Primary AAP Domain and secondary Event Types describe programme
          objectives. They do not establish achieved outcomes.
        </p>
        <div className="patterns-filter-grid">
          <label>
            AAP Domain
            <select
              aria-label="Event analysis AAP Domain"
              value={q.domain ?? initial.domain ?? ""}
              onChange={(e) => update("domain", e.target.value)}
            >
              <option value="">All AAP Domains</option>
              {report?.options.domains.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Event Type
            <select
              aria-label="Event Type filter"
              value={q.eventType || ""}
              onChange={(e) => update("eventType", e.target.value)}
            >
              <option value="">All Event Types</option>
              {report?.options.eventTypes.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Participant group
            <select
              aria-label="Event participant group"
              value={q.target}
              onChange={(e) => update("target", e.target.value)}
            >
              <option value="senior">Seniors (configured age threshold)</option>
              <option value="all">All recorded ages</option>
              <option value="male">Male seniors</option>
              <option value="minority">Minority seniors</option>
            </select>
          </label>
          {!patterns&&<label>
            Population
            <select
              aria-label="Event population"
              value={q.scope}
              onChange={(e) => update("scope", e.target.value)}
            >
              {Object.entries(populations).map(([v,p])=><option key={v} value={v}>{p.label}</option>)}
            </select>
          </label>}
        </div>
        <div className="work-actions">
          <button
            className="button"
            disabled={loading}
            onClick={async () => {
              try {
                const r = await api<EventReport>(
                  "/api/event-types/export?" + query,
                );
                setPrint(r);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Presentation / PDF
          </button>
          <button
            className="button"
            onClick={async () => {
              try {
                await api("/api/event-types/preferences", {
                  method: "PUT",
                  body: JSON.stringify({ ...JSON.parse(base), ...q }),
                });
                setMessage(
                  "Programme-type view saved; other dashboard preferences preserved.",
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save programme-type view
          </button>
        </div>
        {loading && <p role="status">Updating programme analysis…</p>}
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {report && (
          <p className="note">
            {report.period.from || "No attendance"} to{" "}
            {report.period.to || "No attendance"} ·{" "}
            {q.target === "all" ? "All ages" : "Senior reach"} ·{" "}
            {report.ratesAvailable
              ? `${fmt(report.registered)} eligible registered clients; coverage uses this population.`
              : "Reach describes recorded attendance; no client participation rate is inferred."}
          </p>
        )}
      </section>
      {report && (
        <>
          <section className="panel">
            <div className="report-section-heading">
              <h2>How Is Our Programme Mix Distributed?</h2>
              <label>
                View By
                <select
                  aria-label="Programme mix view"
                  value={view}
                  onChange={(e) => setView(e.target.value)}
                >
                  <option value="domain">AAP Domain</option>
                  <option value="event">Event Type</option>
                </select>
              </label>
              <label>
                Measure
                <select
                  aria-label="Programme mix measure"
                  value={measure}
                  onChange={(e) => setMeasure(e.target.value)}
                >
                  <option value="programmes">Programmes</option>
                  <option value="sessions">Delivered Sessions</option>
                  <option value="unique">Unique Participants Reached</option>
                </select>
              </label>
            </div>
            <ReportBars
              rows={rows
                .filter(
                  (r) =>
                    r[measure as "sessions" | "programmes" | "unique"] != null,
                )
                .sort((a,b)=>(b[measure as 'sessions'|'programmes'|'unique']||0)-(a[measure as 'sessions'|'programmes'|'unique']||0)||a.label.localeCompare(b.label))
                .map((r) => ({
                  label: r.label,
                  value:
                    r[measure as "sessions" | "programmes" | "unique"] || 0,
                  detail: `${denominator ? Math.round(((r[measure as "sessions" | "programmes" | "unique"] || 0) / denominator) * 1000) / 10 + "% of distinct total" : "Percentage unavailable"} · ${r.sessions} sessions · ${r.programmes} programmes`,
                }))}
            />
            <p className="note">
              Event Types overlap: one session, programme or person can appear
              under several labels. Category totals and percentages must not be
              added. Combined labels containing &amp; stay intact. Missing
              participant information is not zero.
            </p>
          </section>
          <EngagementPanel groups={report.types} metadata={report.engagement} dimension="eventType" populationLabel={populations[report.scope]?.label || report.scope} overlap />
          <section className="panel">
            <details
              open={matrixOpen}
              onToggle={(e) => setMatrixOpen(e.currentTarget.open)}
            >
              <summary>
                What Additional Engagement Types Do Our Programmes Offer?
              </summary>
              {matrixOpen && (
                <div className="work-table">
                  <table>
                    <caption>
                      AAP Domain × Event Type · selected mix measure;
                      overlapping classifications
                    </caption>
                    <thead>
                      <tr>
                        <th>AAP Domain</th>
                        {report.types.map((t) => (
                          <th key={t.label}>{t.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.domains.map((d) => (
                        <tr key={d.label}>
                          <th>{d.label}</th>
                          {report.types.map((t) => {
                            const cell = report.matrix.find(
                              (c) =>
                                c.domain === d.label && c.label === t.label,
                            );
                            return (
                              <td
                                key={t.label}
                                title={`${d.label} / ${t.label}: ${cell ? fmt(cell[measure as "sessions" | "programmes" | "unique"]) : "No classified sessions"}`}
                                style={{
                                  background: cell
                                    ? "rgba(13,148,136,0.08)"
                                    : undefined,
                                }}
                              >
                                {cell
                                  ? fmt(
                                      cell[
                                        measure as
                                          "sessions" | "programmes" | "unique"
                                      ],
                                    )
                                  : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </section>
          <section className="panel">
            <h2>Top Programmes</h2>
            <label>
              Ranking Metric
              <select
                aria-label="Event programme ranking"
                value={q.ranking}
                onChange={(e) => update("ranking", e.target.value)}
              >
                <option value="unique">Unique participants reached</option>
                <option value="attendance">Total attendance entries</option>
                <option value="repeat">Repeat participants</option>
                <option value="average">Average attendance per session</option>
              </select>
            </label>
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Programme</th>
                    <th>Domains</th>
                    <th>Sessions</th>
                    <th>Unique</th>
                    <th>Attendance</th>
                    <th>Repeat</th>
                    <th>Average / session</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rankings.rows.map((p) => (
                    <tr key={p.id}>
                      <th>
                        {onProgramme ? (
                          <button
                            className="link"
                            onClick={() => onProgramme(p.id)}
                          >
                            {p.label}
                          </button>
                        ) : (
                          p.label
                        )}
                      </th>
                      <td>{activityDomains(p.domain,p.eventTypes).join(', ')}</td>
                      <td>{p.sessions}</td>
                      <td>{fmt(p.unique)}</td>
                      <td>{fmt(p.attendance)}</td>
                      <td>{fmt(p.repeat)}</td>
                      <td>{fmt(p.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="work-actions">
              <button
                className="button"
                onClick={() =>
                  setQ((old) => ({
                    ...old,
                    all: old.all ? "" : "1",
                    page: "0",
                  }))
                }
              >
                {q.all ? "Show top five" : "View All"}
              </button>
              {q.all && (
                <>
                  <button
                    className="button"
                    disabled={!Number(q.page)}
                    onClick={() =>
                      setQ((old) => ({
                        ...old,
                        page: String(Number(old.page || 0) - 1),
                      }))
                    }
                  >
                    Previous programmes
                  </button>
                  <span>Page {report.rankings.page + 1}</span>
                  <button
                    className="button"
                    disabled={
                      (report.rankings.page + 1) * report.rankings.limit >=
                      report.rankings.total
                    }
                    onClick={() =>
                      setQ((old) => ({
                        ...old,
                        page: String(Number(old.page || 0) + 1),
                      }))
                    }
                  >
                    Next programmes
                  </button>
                </>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>Are We Offering the Right Mix of Programmes?</h2>
            <ProgrammeClassificationTable rows={report.programmeClassifications || []} reachLabel={report.target === "all" ? "Unique participants" : "Unique seniors"} onProgramme={onProgramme} />
            <p>{report.alignment}</p>
            {!!report.alignmentRows?.length && (
              <div className="work-table">
                <table>
                  <thead>
                    <tr>
                      <th>Reported interest</th>
                      <th>Respondents</th>
                      <th>Explicitly tagged sessions offered</th>
                      <th>Respondents reached</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.alignmentRows.map((r) => (
                      <tr key={r.label}>
                        <th>{r.label}</th>
                        <td>{r.respondents}</td>
                        <td>{r.sessions}</td>
                        <td>{fmt(r.reached)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel">
            <details
              open={compare}
              onToggle={(e) => setCompare(e.currentTarget.open)}
            >
              <summary>
                Compare Event Type with one participant characteristic
              </summary>
              {compare && (
                <div className="patterns-filter-grid">
                  <label>
                    Comparison characteristic
                    <select
                      aria-label="Event comparison characteristic"
                      value={q.factor || ""}
                      onChange={(e) => update("factor", e.target.value)}
                    >
                      <option value="">Choose a characteristic</option>
                      {Object.entries(factors).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Participant segment
                    <select
                      aria-label="Event comparison segment"
                      value={q.group || ""}
                      onChange={(e) => update("group", e.target.value)}
                    >
                      <option value="">All groups</option>
                      {report.options.groups.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  {q.factor === "distance" && (
                    <label>
                      Distance measure
                      <select
                        value={q.distanceMetric || "walking"}
                        onChange={(e) =>
                          update("distanceMetric", e.target.value)
                        }
                      >
                        <option value="walking">Walking-route distance</option>
                        <option value="straight">
                          Straight-line distance (not walking)
                        </option>
                        <option value="time">Estimated walking duration</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </details>
          </section>
          <section className="panel">
            <h2>What This Means for Programme Planning</h2>
            {report.findings.length ? (
              report.findings.map((f, i) => (
                <article className="callout" key={i}>
                  <div>
                    <h3>{f.finding}</h3>
                    <p>
                      <strong>Evidence:</strong> {f.evidence}
                    </p>
                    <p>
                      <strong>Implication:</strong> {f.implication}
                    </p>
                    <p>
                      <strong>What to investigate:</strong> {f.investigate}
                    </p>
                    <p>
                      <strong>Suggested action:</strong> {f.action}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <p>
                No supported participant findings in this view. Review data
                coverage and participant feedback before changing provision.
              </p>
            )}
          </section>
        </>
      )}
      {user.role === "admin" && (
        <section className="panel">
          <details
            open={admin}
            onToggle={(e) => setAdmin(e.currentTarget.open)}
          >
            <summary>Administrator Event Type label review</summary>
            {admin && (
              <MappingEditor onSaved={() => setLocalRevision((n) => n + 1)} />
            )}
          </details>
        </section>
      )}
      {print && (
        <Suspense fallback={<p>Preparing report…</p>}>
          <PresentationFrame
            title="Programme Mix and Engagement Types"
            close={() => setPrint(null)}
          >
            <EventTypePresentation report={print} />
          </PresentationFrame>
        </Suspense>
      )}
    </div>
  );
}
export function EventTypePresentation({ report }: { report: EventReport }) {
  const rows = [...(report.programmeClassifications || [])].sort((a, b) => a.primaryDomain.localeCompare(b.primaryDomain) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const pages = Array.from({ length: Math.max(1, Math.ceil(rows.length / 8)) }, (_, index) => rows.slice(index * 8, (index + 1) * 8));
  return (
    <>
      {pages.map((page, index) => <section className="report-slide programme-classification-slide" key={index}>
        <h1>Programme Mix and Engagement Types</h1>
        <p>{report.period.from} to {report.period.to} | {report.target === "all" ? "All recorded ages" : "Senior reach"} | Programme table {index + 1} of {pages.length}</p>
        <ProgrammeClassificationTable rows={page} reachLabel={report.target === "all" ? "Unique participants" : "Unique seniors"} print />
      </section>)}
      {report.engagement && <section className="report-slide"><EngagementPanel groups={report.types} metadata={report.engagement} dimension="eventType" populationLabel={populations[report.scope]?.label || report.scope} overlap printing /></section>}
      <section className="report-slide">
        <h1>Programme planning considerations</h1>
        {report.findings.slice(0, 3).map((f, i) => (
          <article key={i}>
            <h2>{f.finding}</h2>
            <p>{f.evidence}</p>
            <p>{f.action}</p>
          </article>
        ))}
        <p>{report.alignment}</p>
        <p>{report.limitations.join(" ")}</p>
      </section>
    </>
  );
}
type Mapping = {
  raw: string;
  label: string;
  parent: string;
  secondary: string;
  sessions: number;
  review: boolean;
  proposed?: { label: string; parent: string; secondary: string };
};
function MappingEditor({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<Mapping[]>([]),
    [preview, setPreview] = useState<{
      id: string;
      rows: Mapping[];
      note: string;
    } | null>(null),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<{ rows: Mapping[] }>("/api/event-types/mappings", { signal: c.signal })
      .then((v) => setRows(v.rows))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  return (
    <>
      <p className="note">
        Rename or merge reporting labels only after review. Raw source labels
        remain unchanged. Parent and secondary fields annotate the mapping; they
        never split an &amp; label automatically.
      </p>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      <div className="work-table">
        <table>
          <thead>
            <tr>
              <th>Original label</th>
              <th>Display label</th>
              <th>Parent</th>
              <th>Secondary</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.raw}>
                <th>
                  {r.raw}
                  {r.review && <small> · Spelling review required</small>}
                </th>
                {(["label", "parent", "secondary"] as const).map((k) => (
                  <td key={k}>
                    <input
                      aria-label={`${r.raw} ${k}`}
                      value={r[k]}
                      disabled={busy || !!preview}
                      onChange={(e) =>
                        setRows((old) =>
                          old.map((v, j) =>
                            j === i ? { ...v, [k]: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </td>
                ))}
                <td>{r.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!preview ? (
        <button
          className="button"
          disabled={busy || !rows.length}
          onClick={async () => {
            setBusy(true);
            try {
              setPreview(
                await api("/api/event-types/mappings/preview", {
                  method: "POST",
                  body: JSON.stringify({ rows }),
                }),
              );
              setReviewed(false);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Preview label mappings
        </button>
      ) : (
        <div>
          <p>{preview.note}</p>
          <ul>
            {preview.rows.map((r) => (
              <li key={r.raw}>
                {r.raw} → {r.proposed?.label}{" "}
                {r.proposed?.parent
                  ? `(parent: ${r.proposed.parent}; secondary: ${r.proposed.secondary || "none"})`
                  : ""}
              </li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed the proposed reporting mappings and equivalent-label
            merges.
          </label>
          <div className="work-actions">
            <button
              className="button primary"
              disabled={!reviewed || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/api/event-types/mappings/confirm", {
                    method: "POST",
                    body: JSON.stringify({ id: preview.id, reviewed }),
                  });
                  setPreview(null);
                  setDone(
                    "Reviewed mappings saved. Source classifications are preserved.",
                  );
                  onSaved();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Apply reviewed mappings
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Discard mapping preview
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export const EventTypeInsights=ProgrammeDomainAnalysis;
