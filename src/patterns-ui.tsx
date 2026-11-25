import { useEffect, useState, lazy, Suspense } from "react";
import { api } from "./api";
import {activityDomains} from '../shared/activity-domains.js';
import { ReportBars } from "./management";
import type { User } from "./types";
import "./patterns.css";
import { PatternControls } from "./pattern-controls";
import { AttendanceQuestions } from "./attendance-questions-ui";
import { ParticipationRateChart } from "./participation-rate-chart";
import type { Reliability } from "./participation-rate-chart";
import { Under60Participants } from "./under60-participants";
import { TwoFactorPanel } from './two-factor-panel';
import type { TwoFactorReport } from '../shared/two-factor-analysis.js';
import { ProgrammeDiagnosticLabels, ProgrammeDomainMix } from './programme-diagnostic-ui';
import { AnalysisTrends } from './analysis-trends';
import type { TrendAnalysis } from './analysis-trends';
import { DataCompleteness, AddressVerification } from './data-completeness';
import type { QualitySummary } from './data-completeness';
import { RegistrationRate } from './registration-rate';
import type { RegistrationContext } from '../shared/registration-context.js';
import { AnalysisStamp } from './analysis-stamp';
import type { ProgrammeDiagnostic, Representation, DomainMix } from '../shared/programme-diagnostics.js';
import { ParticipationGroupSummary } from './participation-group-summary';
import type { SessionDistribution, OverallContext } from './participation-group-summary';
import { EngagementPanel } from './engagement-panel';
import type { EngagementSummary, EngagementMetadata } from '../shared/engagement-depth.js';
import {
  compatibleAnalysis,
  normalizePatternPreferences,
  populations,
  analysisDimensions,
} from "../shared/participation-compat.js";
const LocationAdmin = lazy(() =>
  import("./location-admin").then((m) => ({ default: m.LocationAdmin })),
);
const EventTypeInsights = lazy(() =>
  import("./programme-domains-ui").then((m) => ({ default: m.ProgrammeDomainAnalysis })),
);
const LocationBlocks = lazy(() =>
  import("./location-ui").then((m) => ({ default: m.LocationBlocks })),
);
type PlanningForm = typeof import("./needs-ui");
type OpenPlanningDraft = {
  value: ReturnType<PlanningForm["blankAction"]>;
  Editor: PlanningForm["ActionEditor"];
};
const PresentationFrame = lazy(() =>
  import("./presentation").then((m) => ({ default: m.PresentationFrame })),
);
const dimensions = analysisDimensions;
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
  sessionDistribution?: SessionDistribution | null;
  engagement?: EngagementSummary | null;
  repeat?: number;
  opportunity?: number;
  repeatRate?: number | null;
  firstObserved?: number;
  returning?: number;
};
type Programme = {
  diagnostics?: ProgrammeDiagnostic | null;
  representation?: Representation | null;
  id: string;
  name: string;
  domain: string;
  combinedDomains?:string[];
  eventTypes?:string[];
  sessions: number;
  unique: number;
  attendance: number | null;
  repeat: number | null;
  repeatRate: number | null;
  averageSessions: number | null;
};
export type Report = {
  metadata?: {lastUpdatedAt?:string|null;generatedAt?:string};
  dataQuality?: QualitySummary | null;
  registrationContext?: RegistrationContext | null;
  trendAnalysis?: TrendAnalysis | null;
  domainMix?: DomainMix;
  twoFactor?: TwoFactorReport | null;
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
  reliability?: Reliability;
  overallContext?: OverallContext | null;
  engagement?: EngagementMetadata;
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
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n) +
      suffix;
const denied =
  "Small groups or this filter combination are protected. Try the full available period without a domain filter. Missing and withheld values are not zero.";

export function Ranking({
  report,
  onProgramme,
  printing = false,
}: {
  report: Report;
  onProgramme?: (id: string) => void;
  printing?: boolean;
}) {
  if (report.rankings.suppressed) return <p className="note">{denied}</p>;
  if (!printing && report.rankings.rows.length)
    return (
      <ol
        className="patterns-ranking-list"
        aria-label={`Programme rankings for ${report.group}`}
      >
        {report.rankings.rows.map((p, i) => (
          <li key={p.id}>
            <span className="patterns-rank-number">
              {report.rankings.page * report.rankings.limit + i + 1}
            </span>
            <div>
              {onProgramme ? <button
                className="text-button"
                onClick={() => onProgramme?.(p.id)}
              >
                {p.name}
              </button> : <strong>{p.name}</strong>}
              <small>{(p.combinedDomains??activityDomains(p.domain,p.eventTypes)).join(', ')}</small>
              <dl>
                <div>
                  <dt>Unique</dt>
                  <dd>{fmt(p.unique)}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{fmt(p.sessions)}</dd>
                </div>
                <div>
                  <dt>Repeat</dt>
                  <dd>{fmt(p.repeat)}</dd>
                </div>
                <div>
                  <dt>Entries</dt>
                  <dd>{fmt(p.attendance)}</dd>
                </div>
              </dl>
              <ProgrammeDiagnosticLabels diagnostics={p.diagnostics} representation={p.representation} showRepresentation />
            </div>
          </li>
        ))}
      </ol>
    );
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
            <th>Programme diagnostics</th>
          </tr>
        </thead>
        <tbody>
          {report.rankings.rows.map((p) => (
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
                <small>{(p.combinedDomains??activityDomains(p.domain,p.eventTypes)).join(', ')}</small>
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
              <td><ProgrammeDiagnosticLabels diagnostics={p.diagnostics} representation={p.representation} showRepresentation /></td>
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
    scope:
      initialDimension === "distance" || initialDimension === "block"
        ? "clients"
        : "overall",
    ranking: "unique",
    basis: "current",
  });
  const [adminOpen, setAdminOpen] = useState(false),
    [retry, setRetry] = useState(0),
    [locationRevision, setLocationRevision] = useState(0),
    [actionDraft, setActionDraft] = useState<OpenPlanningDraft | null>(null);
  const [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false);
  const [comparisonSort, setComparisonSort] = useState("label");
  const [poolSmall, setPoolSmall] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState('');
  const [printComparison, setPrintComparison] = useState({ sort: "label", pool: false });
  const [metric, setMetric] = useState("rate"),
    [advanced, setAdvanced] = useState(false),
    [printReport, setPrintReport] = useState<Report | null>(null);
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    api<{ patterns?: Query }>("/api/preferences", { signal: c.signal })
      .then((p) => {
        if (p.patterns) {
          const normalized = normalizePatternPreferences(
            p.patterns,
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Singapore",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
          );
          if (normalized.changed)
            setMessage(
              "Your saved view was updated to compatible settings. Valid dates and analysis choices were retained.",
            );
          setQ({
            ...normalized.query,
            ...(initialDimension
              ? {
                  dimension: initialDimension,
                  scope: "clients",
                  group: "",
                  second: "",
                }
              : {}),
          });
        }
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
    if (user.role === "viewer" || !ready || q.dimension === "eventType") return;
    const c = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Report>("/api/participation-patterns?" + query, { signal: c.signal })
        .then((r) => {
          if (!c.signal.aborted) {
            setReport(r);
            setLoadedQuery(query);
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
  }, [query, revision, locationRevision, user.role, ready, q.dimension, retry]);
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
  const showUnder60 = () => {
    setQ(old => ({ from: old.from || "", to: old.to || "", domain: old.domain || "", basis: old.basis || "current", dimension: "age", scope: "overall", group: "Below 60", ranking: old.ranking || "unique" }));
    setMetric("unique");
    setAdvanced(false);
    setMessage("Showing attendance participants below 60. Registered-client totals and rates are unchanged.");
  };
  const update = (key: string, value: string) => {
    if (key === "group" && value === "Below 60" && q.dimension === "age" && q.scope !== "overall") {
      showUnder60();
      return;
    }
    setQ((old) => ({
      ...old,
      [key]: value,
      ...(key === "second" && value
        ? { scope: compatibleAnalysis(old.scope, value).scope }
        : {}),
      ...(key !== "page" ? { page: "0" } : {}),
      ...(["dimension", "scope", "from", "to", "domain", "basis"].includes(key)
        ? { group: "", programme: "" }
        : {}),
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
      setPrintComparison({ sort: comparisonSort, pool: poolSmall });
      setPrintReport(r);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const reset = () => {
    setAdvanced(false);
    setError("");
    setQ({
      dimension: "age",
      scope: "overall",
      ranking: "unique",
      basis: "current",
    });
  };
  const save = async () => {
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
      setMessage("Preferred analytical view saved.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const controls = (
    <PatternControls
      query={q}
      onNotice={setMessage}
      destinations={report?.location?.destinations}
      onChange={(next) => {
        const adjusted = compatibleAnalysis(next.scope, next.dimension, metric);
        setQ(next);
        setMetric(adjusted.metric);
        if (adjusted.notice) setMessage(adjusted.notice);
        setAdvanced(false);
      }}
      onPresent={q.dimension === "eventType" ? undefined : takeReport}
      presentDisabled={!!error || !report}
      onSave={save}
      onReset={reset}
      onRefresh={() => setRetry((n) => n + 1)}
      loading={q.dimension === "eventType" ? false : loading}
    />
  );
  if (q.dimension === "eventType")
    return (
      <div className="patterns-page">
        {controls}
        {message && <p role="status">{message}</p>}
        <Suspense fallback={<p>Loading programme classifications…</p>}>
          <EventTypeInsights
            user={user}
            revision={revision + retry}
            initial={{
              from: q.from || "",
              to: q.to || "",
              scope: q.scope,
              target: q.scope === "seniors" ? "senior" : "all",
              domain: q.domain || "",
            }}
            patterns
          />
        </Suspense>
      </div>
    );
  return (
    <div className="patterns-page" aria-busy={loading}>
      {controls}
      {message && (
        <p role="status" className="patterns-notice">
          {message}
        </p>
      )}
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
        <section role="alert" className="panel patterns-error">
          <h2>Participation data could not be loaded</h2>
          <p>{error}</p>
          <div className="work-actions">
            <button className="button" onClick={() => setRetry((n) => n + 1)}>
              Retry participation analysis
            </button>
            <button className="button" onClick={reset}>
              Reset filters
            </button>
          </div>
        </section>
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
            {populations[report.scope]?.label || report.scope}
            {report.scope === "attendingClients"
              ? " · Subset attending in this period"
              : ""}
            {report.scope !== "clients"
              ? " · Attendance-based metrics; no registered-client rate denominator"
              : ""}{" "}
            ·{" "}
            {report.basis === "dated"
              ? "Dated profile snapshots"
              : "Current recorded attributes"}
            {q.domain ? ` / Domain: ${q.domain}` : ""}
          </p>
          <AnalysisStamp metadata={report.metadata} coverage={report.coverage} />
          <ParticipationGroupSummary report={report} />
          {report.dataQuality && ['block','locationBlock','distance'].includes(report.dimension) && <AddressVerification summary={report.dataQuality} />}



          {report.dimension === 'distance' && report.location && <p className="note"><strong>Verified residential locations</strong>: {fmt(report.location.verifiedClients)} of {fmt(report.location.registered)} registered clients. Overall clients with attendance: {fmt(report.location.attending)}; no recorded attendance: {fmt(report.location.noAttendance)}.</p>}
          {!report.registryComplete && q.scope === "clients" && (
            <section className="panel patterns-prerequisite">
              <h2>
                Registered-client participation rates require client registry
                data
              </h2>
              <p>
                Import and verify the client registry in Client Engagement, or
                analyse attendance participants.
              </p>
              <button
                className="button"
                onClick={() =>
                  setQ((old) => ({
                    ...old,
                    scope: "overall",
                    dimension: ["block", "distance"].includes(old.dimension)
                      ? "age"
                      : old.dimension,
                    group: "",
                    second: "",
                  }))
                }
              >
                Use all attendance participants
              </button>
            </section>
          )}
          {report.population === 0 && (
            <section className="panel">
              <h2>No attendance records match this date range</h2>
              <button className="button" onClick={reset}>
                Reset filters
              </button>
            </section>
          )}
          {["block", "distance"].includes(q.dimension) &&
            report.location?.locationCompleteness === 0 && (
              <p className="note">
                Distance analysis requires verified residential addresses.
                Review locations below or select Age Group to continue other
                participation analysis.
              </p>
            )}
          {q.dimension === "risk" && (
            <p className="note">
              Recorded SRF codes are retained. Values without an approved
              administrator mapping remain raw/unmapped; they do not establish a
              level of need.
            </p>
          )}
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
          {q.dimension === "age" && q.scope === "clients" && <Under60Participants query={q} revision={`${revision}:${locationRevision}:${retry}`} onExplore={showUnder60} />}
          {report.dimension === "age" && report.scope === "overall" && report.group === "Below 60" && <p className="note">Below-60 results use recorded attendance, including people outside the client registry. No registered-client participation rate applies to this group.</p>}
          <div className="patterns-main-grid">
            <section className="panel patterns-comparison">
              <div className="report-section-heading">
                <h2>
                  {report.dimension === "distance"
                    ? "Participation by Distance"
                    : "Which groups participate most?"}
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
                    <option value="attendance">Attendance entries</option>
                    <option value="averageSessions">Average sessions</option>
                    <option value="repeatRate">Repeat engagement (%)</option>
                  </select>
                </label>
              </div>
              {!report.coverage.from ? (
                <p>
                  Import and review attendance to compare participation.
                  Registered clients without attendance remain in the
                  population.
                </p>
              ) : report.comparisonSuppressed ? (
                <p className="note">{denied}</p>
              ) : !report.groups.some(g=>g[comparisonMetric as keyof Group]!=null) ? (
                <div className="note"><p>This metric is unavailable or withheld for these groups. Unique participant reach remains available where privacy permits.</p><button className="button" onClick={()=>setMetric('unique')}>Show unique participants</button></div>
              ) : (
                <>
                  {comparisonMetric === 'rate' ? <ParticipationRateChart groups={report.groups} dimension={report.dimension} reliability={report.reliability} sort={comparisonSort} pool={poolSmall} onSort={setComparisonSort} onPool={setPoolSmall} /> : (
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
                        detail: `${fmt(g.unique)} participating${g.registered == null ? "" : ` / ${fmt(g.registered)} registered`}${report.ratesAvailable ? ` · ${fmt(g.rate, "%")} client rate` : ""}`,
                      }))}
                  />
                  )}
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
                        {report.scope==='clients'&&<th>Registered</th>}
                        <th>Participating</th>
                        {report.scope==='clients'&&<><th>No recorded attendance</th><th>Rate (%)</th></>}
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
                            ...(report.scope==='clients'?[g.registered]:[]),
                            g.unique,
                            ...(report.scope==='clients'?[g.noAttendance,g.rate]:[]),
                            g.attendance,
                            g.programmes,
                            g.domains,
                            g.averageSessions,
                            g.repeatRate,
                          ].map((n, i) => (
                            <td key={i}>
                              {g.suppressed ? "Withheld" : fmt(n)}
                            </td>
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
            <section className="panel">
              <h2>Which programmes attract this group?</h2>
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
                Recorded programme results for this group. Missing values are not zero.
                Small samples do not establish popularity. Diagnostic repeat attendance uses 2+ sessions divided by unique people; the existing opportunity-based group metric is unchanged.
              </p>
              <Ranking
                report={report}
                onProgramme={(id) => update("programme", id)}
              />
              <ProgrammeDomainMix mix={report.domainMix} />
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
          </div>
      {ready && <AttendanceQuestions query={q} revision={`${revision}:${locationRevision}:${retry}`} onReview={dimension => {
        setQ(old => ({ from: old.from || "", to: old.to || "", domain: old.domain || "", basis: old.basis || "current", scope: "clients", dimension, ranking: "unique" }));
        setMetric("rate");
        setAdvanced(false);
        setMessage("Showing the registered-client comparison used in the answer.");
      }} />}
          <EngagementPanel groups={report.groups} metadata={report.engagement} dimension={report.dimension} populationLabel={populations[report.scope]?.label || report.scope} />
          <details className="panel chart-methodology"><summary>Registration timing and attendance context</summary><RegistrationRate value={report.registrationContext} populationLabel="Overall eligible registry, across groups" /></details>
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
                      {fmt(selected?.firstObserved)}
                      {selected?.returning
                        ? ` / ${fmt(selected?.returning)}`
                        : " · 0 recorded before"}
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
                      const { blankAction, ActionEditor } = await import("./needs-ui");
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
                      setActionDraft({value:draft,Editor:ActionEditor});
                    }}
                  >
                    Record proposed location follow-up
                  </button>
                )}
              </article>
            ))}
          </section>
          {report.trendAnalysis && loadedQuery === query && !loading && !error && <details className="panel"><summary>Monthly participation trends and changes</summary><AnalysisTrends value={report.trendAnalysis} /></details>}
          {report.dataQuality && loadedQuery === query && !loading && !error && <DataCompleteness showVerification={!['block','locationBlock','distance'].includes(report.dimension)} user={user} asOf={report.dataQuality.asOf} summary={report.dataQuality} revision={revision+locationRevision} onDistance={()=>{setQ(old=>({...old,dimension:'distance',scope:'clients',group:'',second:'',programme:''}));}}/>}
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
                <p>Choose two characteristics to compare client participation in each combination.</p>
                <button className="button" onClick={() => {
                  setMetric('rate');
                  setQ(old => ({ ...old, dimension: 'cfs', second: 'living', scope: 'clients', group: '', programme: '', stratum: '', page: '0' }));
                }}>Compare CFS × living arrangement</button>
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
                            key !== "eventType" &&
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
                {report.twoFactor && loadedQuery === query && !loading && !error && <TwoFactorPanel key={report.twoFactor.dimensions.join('|')} report={report.twoFactor} />}
                {report.combined &&
                  (report.combined.suppressed ? (
                    <p className="note">{denied}</p>
                  ) : (
                    <details><summary>Additional combined measures</summary><div className="work-table">
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
                    </div></details>
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
                {populations[printReport.scope]?.label || printReport.scope}
              </p>
              <ParticipationGroupSummary report={printReport} />
              <AnalysisStamp metadata={printReport.metadata} coverage={printReport.coverage} />
              <RegistrationRate value={printReport.registrationContext} populationLabel="Overall eligible registry, across groups" printing />
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
                printReport.ratesAvailable ? <ParticipationRateChart groups={printReport.groups} dimension={printReport.dimension} reliability={printReport.reliability} sort={printComparison.sort} pool={printComparison.pool} printing /> : (
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
                      detail: `${fmt(g.unique)} participating${printReport.ratesAvailable?` / ${fmt(g.registered)} registered`:''}`,
                    }))}
                />
                )
              )}
            </section>
            <section className="report-slide">
              <h2>Programmes and repeat engagement</h2>
              <Ranking report={printReport} printing />
              <ProgrammeDomainMix mix={printReport.domainMix} />
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
            {printReport.engagement && <section className="report-slide"><EngagementPanel groups={printReport.groups} metadata={printReport.engagement} dimension={printReport.dimension} populationLabel={populations[printReport.scope]?.label || printReport.scope} printing /></section>}
            {printReport.twoFactor && <section className="report-slide"><TwoFactorPanel report={printReport.twoFactor} printing /></section>}
            {printReport.trendAnalysis && <section className="report-slide"><AnalysisTrends value={printReport.trendAnalysis} printing /></section>}
            {printReport.dataQuality && <section className="report-slide"><DataCompleteness user={user} asOf={printReport.dataQuality.asOf} summary={printReport.dataQuality} printing /></section>}
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
        <actionDraft.Editor
            value={actionDraft.value}
            onClose={() => setActionDraft(null)}
            onSaved={() => {
              setActionDraft(null);
              setMessage(
                "Proposed location follow-up saved in the existing Detailed action tracker.",
              );
            }}
          />
      )}
    </div>
  );
}
