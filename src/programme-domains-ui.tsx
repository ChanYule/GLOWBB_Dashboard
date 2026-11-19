import { lazy, Suspense, useEffect, useState } from "react";
import { api, currentCentre } from "./api";
import type { Dashboard, Programme, User } from "./types";
import type { EventReport } from "./event-types-ui";
import { PROGRAMME_DOMAINS } from "../shared/activity-domains.js";
import { populations } from "../shared/participation-compat.js";
import { ProgrammeClassificationTable } from "./programme-classification-table";
import { ReportBars } from "./management";
import "./patterns.css";
const RawAudit = lazy(() =>
  import("./event-types-ui").then((m) => ({
    default: m.RawClassificationAudit,
  })),
);
const ProgrammeDialog = lazy(() =>
  import("./main").then((m) => ({ default: m.ProgrammeDialog })),
);
const PresentationFrame = lazy(() =>
  import("./presentation").then((m) => ({ default: m.PresentationFrame })),
);
type Report = EventReport & {
  rankingMetric: string;
  selectedDomain: string;
  unclassified: { sessions: number; programmes: number };
  domainBreadth: { domains: number; members: number }[];
};
type Props = {
  user: User;
  revision?: number;
  initial?: Record<string, string>;
  onProgramme?: (id: string) => void;
  patterns?: boolean;
};
const colours: Record<string, string> = {
  Physical: "#0f766e",
  Cognitive: "#7c3aed",
  Learning: "#2563eb",
  Social: "#a16207",
  Volunteerism: "#15803d",
};
const fmt = (v: number | null | undefined) =>
  v == null
    ? "Unavailable"
    : v.toLocaleString("en-SG", { maximumFractionDigits: 1 });
const factors: Record<string, string> = {
  age: "Age group",
  gender: "Gender",
  race: "Race",
  cfs: "CFS",
  risk: "Social risk factor",
  living: "Living arrangement",
  participation: "Client participation status",
  distance: "Distance",
  block: "Residential area",
};
export function ProgrammeDomainAnalysis({
  user,
  revision = 0,
  initial = {},
  onProgramme,
  patterns = false,
}: Props) {
  const [q, setQ] = useState<Record<string, string>>({
    scope: initial.scope || (patterns ? "clients" : "overall"),
    target: initial.target || (patterns ? "all" : "senior"),
    selectedDomain: "Physical",
    ranking: "unique",
  });
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [measure, setMeasure] = useState<
      "programmes" | "sessions" | "unique" | "attendance"
    >("sessions"),
    [loading, setLoading] = useState(false),
    [audit, setAudit] = useState(false),
    [print, setPrint] = useState<Report | null>(null),
    [detail, setDetail] = useState<{
      programme: Programme;
      data: Dashboard;
    } | null>(null);
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    api<{
      programmeDomains?: Record<string, string>;
      eventTypes?: Record<string, string>;
    }>("/api/preferences", { signal: c.signal })
      .then((p) => {
        if (c.signal.aborted) return;
        if (p.programmeDomains)
          setQ((old) => ({
            ...old,
            ...Object.fromEntries(
              Object.entries(p.programmeDomains!).filter(([key]) =>
                [
                  "scope",
                  "target",
                  "selectedDomain",
                  "ranking",
                  "factor",
                  "group",
                  "distanceMetric",
                ].includes(key),
              ),
            ),
          }));
        else if (p.eventTypes)
          setMessage(
            "Your previous Event Type view is available under Raw source audit. This view uses the five combined Programme Domains.",
          );
      })
      .catch(() => {});
    return () => c.abort();
  }, [user.role]);
  const query = new URLSearchParams({
    ...q,
    ...initial,
    ...(patterns
      ? {
          scope: initial.scope || q.scope,
          from: initial.from || "",
          to: initial.to || "",
        }
      : {}),
  }).toString();
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    setLoading(true);
    api<Report>("/api/programme-domains/report?" + query, {
      signal: c.signal,
      reuseForMs: 15000,
    })
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [query, revision, user.role]);
  const update = (key: string, value: string) =>
    setQ((old) => ({
      ...old,
      [key]: value,
      page: "0",
      ...(key === "factor"
        ? { group: "", ...(value === "distance" ? { scope: "clients" } : {}) }
        : {}),
    }));
  async function openProgramme(id: string) {
    if (onProgramme) {
      onProgramme(id);
      return;
    }
    try {
      const search = new URLSearchParams({
        programme: id,
        from: initial.from || q.from || "",
        to: initial.to || q.to || "",
        domain: q.selectedDomain,
      });
      const data = await api<Dashboard>("/api/dashboard?" + search);
      const programme = data.programmes.find((p) => p.id === id);
      if (programme) setDetail({ programme, data });
      else
        setError("No programme detail is available in the current selection.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    try {
      await api("/api/programme-domains/preferences", {
        method: "PUT",
        body: JSON.stringify({ ...initial, ...q }),
      });
      setMessage("Programme Domain view saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function present() {
    try {
      setPrint(await api<Report>("/api/programme-domains/export?" + query));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const body = (r: Report, printing = false) => (
    <>
      <h2>What Types of Programmes Are We Offering?</h2>
      <p className="note">
        {currentCentre()?.name || "Current centre"} ·{" "}
        {r.period.from || "No recorded period"} –{" "}
        {r.period.to || "No recorded period"} ·{" "}
        {populations[r.scope as keyof typeof populations]?.label || r.scope} ·{" "}
        {r.target === "senior"
          ? "Age 60+"
          : r.target === "all"
            ? "All ages"
            : r.target}
        . {fmt(r.total.unique)} unique participants; {fmt(r.total.attendance)}{" "}
        attendance records.
      </p>
      <ReportBars
        rows={r.domains.map((d) => ({
          label: d.label,
          value: d[measure],
          colour: colours[d.label],
          detail: `${fmt(d[measure])} ${measure === "unique" ? "unique participants" : measure}`,
        }))}
      />
      <p className="note">
        Programmes may belong to more than one domain. Domain totals may
        overlap. Overall totals count each attendance record and participant
        once.
      </p>
      <h3>Which {r.selectedDomain} Programmes Attract the Most Seniors?</h3>
      <p className="note">
        Ranked by{" "}
        {r.rankingMetric === "repeat"
          ? "same-programme repeat participants"
          : r.rankingMetric === "attendance"
            ? "attendance records"
            : "unique participants"}
        . Only sessions classified as {r.selectedDomain} contribute to this
        ranking.
      </p>
      <ol className="domain-programme-ranking">
        {r.rankings.rows.slice(0, 5).map((p) => (
          <li key={p.id}>
            <button
              className="text-button"
              disabled={printing}
              onClick={() => void openProgramme(p.id)}
            >
              {p.label}
            </button>{" "}
            <strong>
              {fmt(p[r.rankingMetric as "unique" | "attendance" | "repeat"])}
            </strong>{" "}
            <small>
              {fmt(p.sessions)} sessions · {fmt(p.unique)} unique ·{" "}
              {fmt(p.repeat)} repeat
            </small>
          </li>
        ))}
      </ol>
      {!r.rankings.rows.length && (
        <p>No qualifying programmes in this selection.</p>
      )}
      <h3>Who Does Each Domain Reach?</h3>
      <div className="work-table">
        <table>
          <thead>
            <tr>
              <th>Programme Domain</th>
              <th>Programmes</th>
              <th>Sessions</th>
              <th>Unique participants</th>
              <th>Attendance</th>
              <th>Repeat</th>
              <th>Repeat opportunity</th>
              <th>Male reach</th>
              <th>Minority reach</th>
            </tr>
          </thead>
          <tbody>
            {r.domains.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td>{fmt(d.programmes)}</td>
                <td>{fmt(d.sessions)}</td>
                <td>{fmt(d.unique)}</td>
                <td>{fmt(d.attendance)}</td>
                <td>{fmt(d.repeat)}</td>
                <td>{fmt(d.opportunity)}</td>
                <td>{fmt(d.male)}</td>
                <td>{fmt(d.minority)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Repeat means attendance at two or more distinct sessions of the same
        programme in this period and domain. Opportunity counts participants
        attending a programme with at least two qualifying delivered sessions.
        Missing or protected counts are unavailable, not zero.
      </p>
      <h3>How Broad Is Participation?</h3>
      <p>
        {r.domainBreadth.length
          ? r.domainBreadth
              .map(
                (d) =>
                  `${fmt(d.members)} participants attended ${d.domains} recognised domain${d.domains === 1 ? "" : "s"}`,
              )
              .join(" · ")
          : "Domain breadth is unavailable for this selection."}
      </p>
      <h3>Planning Insights</h3>
      {r.findings.length ? (
        r.findings.slice(0, 5).map((f, i) => (
          <article key={i}>
            <strong>{f.finding}</strong>
            <p>
              {f.evidence} {f.implication}
            </p>
            <p>
              {f.action} {f.investigate}
            </p>
          </article>
        ))
      ) : (
        <p>
          More recorded attendance is needed for an evidence-based planning
          insight.
        </p>
      )}
      <p className="note">
        {fmt(r.unclassified.sessions)} sessions have no recognised domain. They
        remain in overall totals and are excluded from the five-domain charts.
        Review their original labels in the source audit or administrator
        configuration.
      </p>
      {printing ? (
        <ProgrammeClassificationTable rows={r.programmeClassifications} print />
      ) : (
        <details>
          <summary>
            Programme domain details ({r.rankings.total} programmes in{" "}
            {r.selectedDomain})
          </summary>
          <ProgrammeClassificationTable
            rows={r.programmeClassifications}
            onProgramme={(id) => void openProgramme(id)}
          />
        </details>
      )}
    </>
  );
  if (user.role === "viewer")
    return (
      <section className="panel">
        <h2>Programme Domain Analysis</h2>
        <p>Detailed comparisons require authorised staff access.</p>
      </section>
    );
  return (
    <section className="panel programme-domain-analysis" aria-busy={loading}>
      <h2>Programme Domain Analysis</h2>
      <div className="patterns-filter-grid">
        <label>
          Population
          <select
            value={patterns ? initial.scope || q.scope : q.scope}
            disabled={patterns}
            onChange={(e) => update("scope", e.target.value)}
          >
            {Object.entries(populations).map(([value, p]) => (
              <option key={value} value={value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Age selection
          <select
            value={patterns ? initial.target || q.target : q.target}
            disabled={patterns}
            onChange={(e) => update("target", e.target.value)}
          >
            <option value="senior">Age 60+</option>
            <option value="all">All ages</option>
          </select>
        </label>
        <label>
          Domain mix measure
          <select
            value={measure}
            onChange={(e) => setMeasure(e.target.value as typeof measure)}
          >
            <option value="programmes">Programmes</option>
            <option value="sessions">Sessions</option>
            <option value="unique">Unique participants</option>
            <option value="attendance">Attendance</option>
          </select>
        </label>
        <label>
          Programme Domain
          <select
            value={q.selectedDomain}
            onChange={(e) => update("selectedDomain", e.target.value)}
          >
            {PROGRAMME_DOMAINS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Programme ranking
          <select
            value={q.ranking}
            onChange={(e) => update("ranking", e.target.value)}
          >
            <option value="unique">Unique participants</option>
            <option value="attendance">Attendance</option>
            <option value="repeat">Repeat participants</option>
          </select>
        </label>
        <label>
          Compare participant group
          <select
            value={q.factor || ""}
            onChange={(e) => update("factor", e.target.value)}
          >
            <option value="">All selected participants</option>
            {Object.entries(factors).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {q.factor && (
          <label>
            Group
            <select
              value={q.group || ""}
              onChange={(e) => update("group", e.target.value)}
            >
              <option value="">All groups</option>
              {report?.options.groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="work-actions">
        <button className="button" onClick={() => void save()}>
          Save domain view
        </button>
        <button
          className="button"
          onClick={() => void present()}
          disabled={!report || loading || !!error}
        >
          Present / export domain report
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">Updating domain analysis…</p>}
      {report && !loading && !error && body(report)}
      <details onToggle={(e) => setAudit(e.currentTarget.open)}>
        <summary>Raw source audit — AAP Domain and Event Type</summary>
        <p>
          Original source labels are shown separately for audit. This is not the
          combined Programme Domain analysis.
        </p>
        {audit && (
          <Suspense fallback={<p>Loading source audit…</p>}>
            <RawAudit
              user={user}
              revision={revision}
              initial={initial}
              onProgramme={(id) => void openProgramme(id)}
              patterns={patterns}
            />
          </Suspense>
        )}
      </details>
      {print && (
        <Suspense fallback={null}>
          <PresentationFrame
            title="Programme Domain Analysis"
            close={() => setPrint(null)}
          >
            {body(print, true)}
          </PresentationFrame>
        </Suspense>
      )}
      {detail && (
        <Suspense fallback={null}>
          <ProgrammeDialog {...detail} onClose={() => setDetail(null)} />
        </Suspense>
      )}
    </section>
  );
}
