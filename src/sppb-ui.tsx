import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "./types";
import { api, centreUrl, currentCentre } from "./api";
import { CENTRES } from "../shared/centres.js";
import "./sppb.css";
import { ChartCard } from "./chart-system";

type Scores = { balance: number; gait: number; chair: number; total: number };
type RecordRow = {
  id: string;
  memberId: string;
  date: string | null;
  original: Scores;
  standard: Scores | null;
  scoringVersion: string | null;
  validation: string;
  sourceDefinition: string;
  source: string;
  sourceRow: number;
  location: string;
  warnings: string[];
  conflict: boolean;
  matched?: boolean;
  raw: { column: number; header: string; value: unknown }[];
  review: { revision: number; disposition: string; reason?: string };
};
type Task = { assigned: string; status: string; revision: number };
type Member = {
  id: string;
  memberId: string;
  centres: string[];
  age?: number;
  cfs?: string;
  count: number;
  distinctDates: number;
  latestDate: string | null;
  latest: RecordRow | null;
  previous: RecordRow | null;
  delta: number | null;
  change: string;
  followup: { status: string; due: string | null; days: number | null };
  reviewRequired: boolean;
  followupTask: Task | null;
};
type Detail = Member & {
  records: RecordRow[];
  participation: {
    from: string | null;
    to: string | null;
    sessions: number;
    programmes: string[];
    domains: string[];
    eventTypes: string[];
  };
  note: string;
};
type Summary = {
  eligible: number;
  assessed: number;
  coverage: number | null;
  repeated: number;
  latest: string | null;
  due: number;
  comparable: number;
  increased: number;
  unchanged: number;
  decreased: number;
  review: number;
};
type Report = {
  recordedScores?: {
    sourceDefinition: string;
    total: number;
    members: number;
  }[];
  summary: Summary | null;
  rows: Member[];
  total: number;
  page: number;
  monthly: { month: string; members: number }[];
  intervalMonths: number | null;
  note: string;
  suppressed?: boolean;
};
type Definition = {
  sourceDefinition: string;
  version: string;
  method: string;
  approved: boolean;
};
type Config = {
  revision: number;
  intervalMonths: number | null;
  approachDays: number;
  definitions: Definition[];
};
type Review = {
  rows: RecordRow[];
  total: number;
  unmatchedMembers: number;
  conflicts: number;
  config: Config;
  batches: {
    id: string;
    source: string;
    created: string;
    inserted: number;
    matchedMembers: number;
    unmatchedMembers: number;
  }[];
};
type Preview = {
  id: string;
  rows: number;
  uniqueMembers: number;
  matchedMembers: number;
  unmatchedMembers: number;
  matchedRecords: number;
  newRecords: number;
  existingRecords: number;
  identicalDuplicates: number;
  conflicts: number;
  scoringWarnings: number;
  missingDates: number;
  reviewRecords: number;
  invalidMembers: number;
  matchedMemberIds: string[];
  unmatchedMemberIds: string[];
  note: string;
};
const day = (value: string | null | undefined) =>
  value
    ? new Date(value + "T00:00:00+08:00").toLocaleDateString("en-SG", {
        timeZone: "Asia/Singapore",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Unavailable";
const affiliations = (ids: string[]) =>
  ids.map((id) => CENTRES.find((c) => c.id === id)?.name || id).join(", ");
const pending = "Imported SPPB score, scoring validation pending";

export function SppbAssessments({
  user,
  initialSection = "Latest assessments",
}: {
  user: User & { canCompare?: boolean };
  initialSection?: string;
}) {
  const [section, setSection] = useState(initialSection),
    [scope, setScope] = useState("centre"),
    [filters, setFilters] = useState({
      from: "",
      to: "",
      asOf: "",
      status: "all",
      age: "",
      cfs: "",
      search: "",
      sort: "recent",
    }),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [member, setMember] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const query = new URLSearchParams(
    Object.entries({ ...filters, page: String(page) }).filter(([, v]) => v),
  );
  if (scope === "all") query.set("centre", "all");
  const queryText = user.role === "viewer" ? "" : query.toString();
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError("");
    api<Report>("/api/sppb/overview?" + queryText, { signal: abort.signal })
      .then(setReport)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [queryText, revision]);
  const change = (key: keyof typeof filters, value: string) => {
    setFilters((p) => ({ ...p, [key]: value }));
    setPage(1);
  };
  const refresh = () => setRevision((n) => n + 1);
  const summary = report?.summary;
  const [notice, setNotice] = useState("");
  return (
    <div className="sppb-page">
      <div className="sppb-intro">
        <div>
          <span className="eyebrow">PARTICIPANT NEEDS & ACCESSIBILITY</span>
          <h2>SPPB Assessments</h2>
          <p>
            Track physical performance assessments, latest results and changes
            over time.
          </p>
        </div>
        <span className="sppb-badge">
          {scope === "all"
            ? "All authorised centres"
            : currentCentre()?.name || "Select a centre"}
        </span>
        {user.role === "admin" && (
          <button
            className="button primary"
            onClick={() => setSection("Data quality & import")}
          >
            Import SPPB data
          </button>
        )}
      </div>
      {notice && (
        <p className="client-success" role="status">
          {notice}
        </p>
      )}
      {user.role !== "viewer" && (
        <section className="panel sppb-filters" aria-label="Assessment filters">
          {user.canCompare && (
            <label>
              Centre population
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPage(1);
                  setMember(null);
                }}
              >
                <option value="centre">Selected centre</option>
                <option value="all">
                  All authorised centres · unique members
                </option>
              </select>
            </label>
          )}
          <label>
            Assessment dates from
            <input
              type="date"
              value={filters.from}
              onChange={(e) => change("from", e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) => change("to", e.target.value)}
            />
          </label>
          <label>
            Assessment status
            <select
              value={filters.status}
              onChange={(e) => change("status", e.target.value)}
            >
              {[
                ["all", "All members"],
                ["repeated", "Repeated assessments"],
                ["due", "Reassessment due / overdue"],
                ["none", "No recorded assessment"],
                ["review", "Data-quality review"],
                ["increased", "Validated score increased"],
                ["decreased", "Validated score decreased"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>More filters</summary>
            <div className="sppb-filters">
              <label>
                Reporting date
                <input
                  type="date"
                  value={filters.asOf}
                  onChange={(e) => change("asOf", e.target.value)}
                />
              </label>
              <label>
                Age group
                <select
                  value={filters.age}
                  onChange={(e) => change("age", e.target.value)}
                >
                  <option value="">All ages</option>
                  <option value="below60">Below 60</option>
                  <option value="60to79">60–79</option>
                  <option value="80plus">80+</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>
                Recorded CFS
                <input
                  value={filters.cfs}
                  onChange={(e) => change("cfs", e.target.value)}
                  placeholder="Exact source category"
                />
              </label>
            </div>
          </details>
          <button
            className="button"
            onClick={() => {
              setFilters({
                from: "",
                to: "",
                asOf: "",
                status: "all",
                age: "",
                cfs: "",
                search: "",
                sort: "recent",
              });
              setPage(1);
            }}
          >
            Reset filters
          </button>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Updating assessment summary…</p>}
      {summary && (
        <>
          <div className="sppb-kpis">
            {[
              [summary.assessed, "Members with dated assessments"],
              [
                summary.coverage == null
                  ? "Unavailable"
                  : summary.coverage.toFixed(1) + "%",
                "Verified client coverage",
              ],
              [summary.repeated, "Members with repeated dates"],
              [day(summary.latest), "Most recent assessment"],
              [
                report?.intervalMonths == null ? "Not configured" : summary.due,
                "Reassessment due / overdue",
              ],
              [summary.review, "Members with records to review"],
            ].map(([value, label]) => (
              <article className="panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <div className="sppb-two">
            <section className="panel">
              <h3>Assessment coverage</h3>
              <p>
                {summary.assessed} assessed of {summary.eligible} current
                verified clients.
              </p>
              {summary.coverage != null ? (
                <>
                  <div
                    className="sppb-coverage"
                    role="img"
                    aria-label={`${summary.coverage.toFixed(1)} percent assessed`}
                  >
                    <span style={{ width: summary.coverage + "%" }} />
                  </div>
                  <p>
                    {summary.eligible - summary.assessed} without a dated
                    assessment in this selection.
                  </p>
                </>
              ) : (
                <p className="muted">
                  A complete, verified client registry is required for a
                  coverage percentage.
                </p>
              )}
            </section>
            <section className="panel">
              <h3>Recorded score analysis</h3>
              <p>
                Latest recorded totals, shown exactly as imported. No scoring
                setup is needed.
              </p>
              {report?.recordedScores?.length ? (
                <div className="sppb-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Source scoring definition</th>
                        <th>Recorded total</th>
                        <th>Members</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recordedScores.map((g) => (
                        <tr key={g.sourceDefinition + ":" + g.total}>
                          <td>{g.sourceDefinition}</td>
                          <td>{g.total}</td>
                          <td>{g.members}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>
                  No unambiguous latest scores in this selection. Open a member
                  to see all recorded results.
                </p>
              )}
              <p className="muted">
                Imported totals may use a different scoring scale. They are
                descriptive records, not clinical interpretations; conflicting
                same-day results stay separate.
              </p>
              {!!summary.comparable && (
                <details>
                  <summary>Validated score changes</summary>
                  <>
                    <p>
                      {summary.comparable} members with comparable assessments.
                      Comparison uses each member’s latest eligible pair through
                      the reporting date.
                    </p>
                    <p>
                      {summary.increased} increased · {summary.unchanged}{" "}
                      unchanged · {summary.decreased} decreased
                    </p>
                  </>
                </details>
              )}
            </section>
          </div>
        </>
      )}
      {report?.suppressed && (
        <section className="panel">
          <p>
            Assessment coverage is withheld because the selected population does
            not meet the reporting privacy rule.
          </p>
        </section>
      )}
      {user.role !== "viewer" && (
        <>
          <div className="sppb-tabs" role="tablist" aria-label="SPPB sections">
            {[
              "Latest assessments",
              "Reassessment follow-up",
              "Assessment activity",
              ...(user.role === "admin" ? ["Data quality & import"] : []),
            ].map((s) => (
              <button
                role="tab"
                aria-selected={section === s}
                className="button"
                key={s}
                onClick={() => setSection(s)}
              >
                {s === "Data quality & import" ? "Import data" : s}
              </button>
            ))}
          </div>
          {section === "Data quality & import" ? (
            <SppbAdministration
              onSaved={refresh}
              onImported={(message) => {
                setNotice(message);
                setSection("Latest assessments");
              }}
            />
          ) : section === "Assessment activity" ? (
            <section className="panel">
              <h3>Assessment activity over time</h3>
              <p>
                Distinct matched clients assessed each month. A client may
                appear in several months.
              </p>
              <div className="sppb-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Members assessed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report?.monthly.map((m) => (
                      <tr key={m.month}>
                        <td>{m.month}</td>
                        <td>{m.members}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="panel">
              <div className="sppb-toolbar">
                <h3>{section}</h3>
                <label>
                  Search Member ID
                  <input
                    type="search"
                    value={filters.search}
                    onChange={(e) => change("search", e.target.value)}
                  />
                </label>
                <label>
                  Sort by
                  <select
                    value={filters.sort}
                    onChange={(e) => change("sort", e.target.value)}
                  >
                    {[
                      ["recent", "Most recent date"],
                      ["oldest", "Oldest assessment date"],
                      ["count", "Number of assessments"],
                      ["increase", "Validated score increase"],
                      ["decline", "Validated score decline"],
                      ["review", "Data-quality issues"],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <a
                  className="button"
                  href={centreUrl("/api/sppb/export?format=xlsx&" + queryText)}
                >
                  Excel export
                </a>
                <a
                  className="button"
                  target="_blank"
                  rel="noreferrer"
                  href={centreUrl("/api/sppb/export?format=pdf&" + queryText)}
                >
                  Print / PDF
                </a>
              </div>
              {section === "Reassessment follow-up" && (
                <p>
                  Interval:{" "}
                  {report?.intervalMonths == null
                    ? "Awaiting administrator approval"
                    : `${report.intervalMonths} months`}
                  . Follow-up uses the latest valid date; missing dates and no
                  assessment remain separate statuses. Select a member to record
                  a reviewed follow-up.
                </p>
              )}
              <div className="sppb-scroll">
                <table>
                  <thead>
                    <tr>
                      {(section === "Reassessment follow-up"
                        ? [
                            "Member ID",
                            "Affiliation",
                            "Last assessment",
                            "Days since assessment",
                            "Due date",
                            "Status",
                            "Assigned staff",
                            "Follow-up",
                          ]
                        : [
                            "Member ID",
                            "Verified affiliation",
                            "Latest date",
                            "Imported total",
                            ...(summary?.comparable
                              ? [
                                  "Previous comparable total",
                                  "Validated difference",
                                ]
                              : []),
                            "Assessments",
                            "Reassessment status",
                          ]
                      ).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report?.rows.map((m) => (
                      <tr key={m.id}>
                        <th>
                          <button
                            className="text-button"
                            onClick={() => setMember(m.id)}
                          >
                            {m.memberId}
                          </button>
                        </th>
                        <td>{affiliations(m.centres)}</td>
                        <td>{day(m.latestDate)}</td>
                        {section === "Reassessment follow-up" ? (
                          <>
                            <td>{m.followup.days ?? "Unavailable"}</td>
                            <td>{day(m.followup.due)}</td>
                            <td>{m.followup.status}</td>
                            <td>{m.followupTask?.assigned || "Unassigned"}</td>
                            <td>{m.followupTask?.status || "Not started"}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              {m.latest?.original.total ??
                                (m.latestDate
                                  ? "Review same-day records"
                                  : "Unavailable")}
                              <small>
                                {(m.latest
                                  ? m.latest.standard
                                    ? "Validated score"
                                    : "Imported score"
                                  : null) || "No unambiguous latest result"}
                              </small>
                            </td>
                            {!!summary?.comparable && (
                              <>
                                <td>
                                  {m.previous?.standard?.total ?? "Unavailable"}
                                </td>
                                <td>
                                  {m.delta == null
                                    ? "Validation / comparison required"
                                    : `${m.delta > 0 ? "+" : ""}${m.delta}`}
                                  <small>{m.change}</small>
                                </td>
                              </>
                            )}
                            <td>
                              {m.count}
                              <small>{m.distinctDates} distinct dates</small>
                            </td>
                            <td>{m.followup.status}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!report?.rows.length && <p>No members match this selection.</p>}
              <div className="sppb-toolbar">
                <button
                  className="button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous members
                </button>
                <span>
                  Page {page} of{" "}
                  {Math.max(1, Math.ceil((report?.total || 0) / 25))} ·{" "}
                  {report?.total || 0} members
                </span>
                <button
                  className="button"
                  disabled={page * 25 >= (report?.total || 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next members
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <p className="muted">{report?.note}</p>
      {member && (
        <SppbMemberDialog
          id={member}
          allCentres={scope === "all"}
          onClose={() => setMember(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function HistoryChart({ records }: { records: RecordRow[] }) {
  const validated = records
    .filter((r) => r.standard && r.date)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  if (!validated.length) return <ImportedHistory records={records} />;
  const dates = validated.map((r) => Date.parse(r.date!)),
    min = Math.min(...dates),
    max = Math.max(...dates);
  const x = (date: string) =>
    55 + ((Date.parse(date) - min) / Math.max(86400000, max - min)) * 560;
  const y = (score: number) => 220 - (score / 12) * 185;
  const versions = [...new Set(validated.map((r) => r.scoringVersion))];
  const timeline = records
    .filter((r) => r.date && r.review?.disposition !== "superseded")
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const countDates = new Map<string, number>();
  for (const r of timeline)
    countDates.set(r.date!, (countDates.get(r.date!) || 0) + 1);
  return (
    <ChartCard
      title="SPPB score over time · validated records"
      description="Comparable approved scores only; source records remain in the timeline below."
    >
      <svg
        className="sppb-chart"
        viewBox="0 0 680 270"
        role="img"
        aria-label="Validated SPPB total scores over time, zero to twelve"
      >
        {[0, 4, 8, 12].map((n) => (
          <g key={n}>
            <line x1="50" x2="635" y1={y(n)} y2={y(n)} stroke="#dce5ec" />
            <text x="25" y={y(n) + 5}>
              {n}
            </text>
          </g>
        ))}
        {timeline.slice(1).map((r, index) => {
          const previous = timeline[index];
          return r.standard &&
            previous.standard &&
            r.scoringVersion === previous.scoringVersion &&
            countDates.get(r.date!) === 1 &&
            countDates.get(previous.date!) === 1 ? (
            <line
              key={"segment-" + r.id}
              x1={x(previous.date!)}
              y1={y(previous.standard.total)}
              x2={x(r.date!)}
              y2={y(r.standard.total)}
              stroke="#3869a8"
              strokeWidth="2"
            />
          ) : null;
        })}
        {versions.map((version) => {
          const points = validated.filter((r) => r.scoringVersion === version);
          return (
            <g key={version}>
              {points.map((r) => (
                <circle
                  key={r.id}
                  cx={x(r.date!)}
                  cy={y(r.standard!.total)}
                  r="5"
                  tabIndex={0}
                  aria-label={
                    day(r.date) +
                    ": " +
                    r.standard!.total +
                    " · " +
                    r.scoringVersion
                  }
                  fill="#3869a8"
                >
                  <title>
                    {day(r.date)}: {r.standard!.total} · {r.scoringVersion}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        <text x="50" y="255">
          {day(validated[0].date)}
        </text>
        <text x="500" y="255">
          {day(validated.at(-1)!.date)}
        </text>
      </svg>
      <p className="muted">
        Only records sharing an approved scoring version are connected. Exact
        values and definitions are in the timeline.
      </p>
    </ChartCard>
  );
}

function ImportedHistory({ records }: { records: RecordRow[] }) {
  const points = records
    .filter(
      (r) =>
        r.date &&
        r.original.total != null &&
        r.review?.disposition !== "superseded",
    )
    .sort((a, b) => a.date!.localeCompare(b.date!));
  if (!points.length)
    return <p>No dated scores to plot. All source records are listed below.</p>;
  const first = Date.parse(points[0].date!),
    last = Date.parse(points.at(-1)!.date!);
  const maximum = Math.max(12, ...points.map((r) => r.original.total));
  const x = (date: string) =>
    55 + ((Date.parse(date) - first) / Math.max(86400000, last - first)) * 560;
  const y = (total: number) => 220 - (total / maximum) * 185;
  return (
    <ChartCard
      title="Recorded scores over time"
      description="Original imported totals. Points show recorded results without clinical interpretation or rescaling."
    >
      <svg
        className="sppb-chart"
        viewBox="0 0 680 270"
        role="img"
        aria-label="Original imported SPPB scores over time"
      >
        {[0, maximum / 2, maximum].map((n) => (
          <g key={n}>
            <line x1="50" x2="635" y1={y(n)} y2={y(n)} stroke="#dce5ec" />
            <text x="25" y={y(n) + 5}>
              {n}
            </text>
          </g>
        ))}
        {points.map((r) => (
          <circle
            key={r.id}
            cx={x(r.date!)}
            cy={y(r.original.total)}
            r="5"
            fill="#3869a8"
            tabIndex={0}
            aria-label={`${day(r.date)}: imported total ${r.original.total}; ${r.sourceDefinition}${r.conflict ? "; same-day conflict" : ""}`}
          >
            <title>
              {day(r.date)}: {r.original.total} · {r.sourceDefinition}
              {r.conflict ? " · Same-day conflict" : ""}
            </title>
          </circle>
        ))}
        <text x="50" y="255">
          {day(points[0].date)}
        </text>
        <text x="500" y="255">
          {day(points.at(-1)!.date)}
        </text>
      </svg>
      <p className="muted">
        Scoring validation is pending. Different source definitions and same-day
        conflicts are identified in the timeline below.
      </p>
    </ChartCard>
  );
}
export function SppbMemberDialog({
  id,
  onClose,
  onSaved,
  allCentres = false,
}: {
  id: string;
  onClose: () => void;
  onSaved?: () => void;
  allCentres?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [assigned, setAssigned] = useState(""),
    [status, setStatus] = useState("Not started"),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    api<Detail>("/api/sppb/members/" + id + (allCentres ? "?centre=all" : ""), {
      signal: abort.signal,
    })
      .then((d) => {
        setDetail(d);
        setAssigned(d.followupTask?.assigned || "");
        setStatus(d.followupTask?.status || "Not started");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id, revision, allCentres]);
  return (
    <dialog
      ref={ref}
      className="sppb-dialog"
      aria-label="Member SPPB assessment history"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>Member assessment history</h2>
        <button className="button" onClick={onClose}>
          Close history
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!detail && !error && (
        <p role="status">Loading authorised assessment history…</p>
      )}
      {detail && (
        <>
          <h3>{detail.memberId}</h3>
          <p>
            {affiliations(detail.centres)} · {detail.count} source records ·
            latest date {day(detail.latestDate)}
          </p>
          <p>
            Latest recorded total:{" "}
            {detail.latest?.original.total ??
              (detail.latestDate
                ? "See same-day records below"
                : "Unavailable")}
          </p>
          {detail.previous?.standard && (
            <p>
              Validated latest total:{" "}
              {detail.latest?.standard?.total ?? "Unavailable"} · previous
              comparable total:{" "}
              {detail.previous?.standard?.total ?? "Unavailable"} · difference:{" "}
              {detail.delta ?? "Unavailable"}
            </p>
          )}
          <p>
            {detail.followup.status} · due {day(detail.followup.due)}
          </p>
          <HistoryChart records={detail.records} />
          <div className="sppb-components">
            {(["balance", "gait", "chair"] as const).map((k) => (
              <article className="panel" key={k}>
                <h4>
                  {k === "gait"
                    ? "Gait speed"
                    : k === "chair"
                      ? "Chair stand"
                      : "Balance"}
                </h4>
                <p>
                  Latest recorded: {detail.latest?.original[k] ?? "Unavailable"}
                </p>
                {detail.previous?.standard && (
                  <>
                    <p>
                      Previous:{" "}
                      {detail.previous?.standard?.[k] ?? "Unavailable"}
                    </p>
                    <p>
                      Validated difference:{" "}
                      {detail.latest?.standard && detail.previous?.standard
                        ? detail.latest.standard[k] -
                          detail.previous.standard[k]
                        : "Unavailable"}
                    </p>
                  </>
                )}
              </article>
            ))}
          </div>
          <h3>Assessment timeline</h3>
          <p className="muted">
            Component and total values below are original imported values.
            Validation status is shown separately.
          </p>
          <div className="sppb-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Date",
                    "Imported total",
                    "Balance",
                    "Gait",
                    "Chair",
                    "Status",
                    "Source details",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.records.map((r) => (
                  <tr key={r.id}>
                    <td>{day(r.date)}</td>
                    <td>{r.original.total ?? "Missing"}</td>
                    <td>{r.original.balance ?? "Missing"}</td>
                    <td>{r.original.gait ?? "Missing"}</td>
                    <td>{r.original.chair ?? "Missing"}</td>
                    <td>
                      {r.validation}
                      <small>{r.scoringVersion || r.sourceDefinition}</small>
                      {r.standard && (
                        <small>
                          Validated: {r.standard.balance} / {r.standard.gait} /{" "}
                          {r.standard.chair} · total {r.standard.total}
                        </small>
                      )}
                    </td>
                    <td>
                      <details>
                        <summary>Review original test details</summary>
                        <p>
                          {r.source} · row {r.sourceRow} · assessment location:{" "}
                          {r.location}
                        </p>
                        <p>{r.warnings.join("; ")}</p>
                        <dl>
                          {r.raw
                            .filter((c) => c.header && c.value !== "")
                            .map((c) => (
                              <div key={c.column}>
                                <dt>
                                  {c.header} (column {c.column})
                                </dt>
                                <dd>{String(c.value)}</dd>
                              </div>
                            ))}
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>
              Programme participation between comparable assessments
            </summary>
            {detail.participation.from ? (
              <>
                <p>
                  {day(detail.participation.from)} (exclusive) to{" "}
                  {day(detail.participation.to)} (inclusive):{" "}
                  {detail.participation.sessions} distinct centre programme
                  sessions.
                </p>
                <p>
                  Programmes:{" "}
                  {detail.participation.programmes.join(", ") ||
                    "None recorded"}
                </p>
                <p>
                  Programme Domains:{" "}
                  {detail.participation.domains.join(", ") || "None recorded"} ·
                  Source Event Types:{" "}
                  {detail.participation.eventTypes.join(", ") || "Unavailable"}
                </p>
              </>
            ) : (
              <p>Two comparable validated records are required.</p>
            )}
            <p>
              Attendance is observational and does not establish what caused a
              score change.
            </p>
          </details>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await api(
                  "/api/sppb/members/" +
                    id +
                    "/followup" +
                    (allCentres ? "?centre=all" : ""),
                  {
                    method: "POST",
                    body: JSON.stringify({
                      assigned,
                      status,
                      revision: detail.followupTask?.revision || 0,
                    }),
                  },
                );
                setRevision((n) => n + 1);
                onSaved?.();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <h3>Reviewed reassessment follow-up</h3>
            <label>
              Assigned staff
              <input
                value={assigned}
                maxLength={200}
                onChange={(e) => setAssigned(e.target.value)}
              />
            </label>
            <label>
              Follow-up status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {[
                  "Not started",
                  "Review required",
                  "Contact attempted",
                  "Follow-up agreed",
                  "Completed",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button className="button primary" disabled={saving}>
              Save reviewed follow-up
            </button>
            <p className="muted">
              Records an internal follow-up only. No assessment is scheduled or
              message sent.
            </p>
          </form>
        </>
      )}
    </dialog>
  );
}

export function SppbProfileSection({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <h3>SPPB Assessments</h3>
      <p>
        View linked assessment dates, imported scores, validated comparisons and
        reassessment status. Verified centre client affiliation is required.
      </p>
      <button className="button" onClick={() => setOpen(true)}>
        Open SPPB assessment history
      </button>
      {open && <SppbMemberDialog id={id} onClose={() => setOpen(false)} />}
    </section>
  );
}

function SppbAdministration({
  onSaved,
  onImported,
}: {
  onSaved: () => void;
  onImported: (message: string) => void;
}) {
  const [data, setData] = useState<Review | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    api<Review>("/api/sppb/review?page=" + page, { signal: abort.signal })
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [page, revision]);
  const refresh = () => {
    setRevision((n) => n + 1);
    onSaved();
  };
  return (
    <div className="form-stack">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="panel">
        <h3>Import SPPB Assessments</h3>
        <p>
          Supplementary assessments across all four centres. Member ID links to
          existing participants; unmatched rows remain protected. Importing
          never creates registered clients.
        </p>
        {!preview ? (
          <form
            className="form-stack"
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                setPreview(
                  await api<Preview>("/api/sppb/import/preview", {
                    method: "POST",
                    body: new FormData(e.currentTarget),
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              SPPB workbook
              <input type="file" name="file" accept=".xlsx,.csv" required />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? "Reading workbook…" : "Preview SPPB assessments"}
            </button>
          </form>
        ) : (
          <div className="form-stack">
            <div className="sppb-kpis">
              {[
                [preview.rows, "Assessment records"],
                [preview.matchedMembers, "Matched members"],
                [preview.unmatchedMembers, "Unmatched members"],
                [preview.newRecords, "New records"],
              ].map(([value, label]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{String(value)}</strong>
                </article>
              ))}
            </div>
            <p>
              {preview.conflicts} same-day groups to review ·{" "}
              {preview.scoringWarnings} source-score warnings ·{" "}
              {preview.missingDates} missing dates. Import keeps the original
              values.
            </p>
            <details>
              <summary>
                Matched Member IDs ({preview.matchedMemberIds.length})
              </summary>
              <p>{preview.matchedMemberIds.join(", ") || "None"}</p>
            </details>
            <details>
              <summary>
                Unmatched Member IDs ({preview.unmatchedMemberIds.length})
              </summary>
              <p>{preview.unmatchedMemberIds.join(", ") || "None"}</p>
            </details>
            <div className="sppb-toolbar">
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<{
                      inserted: number;
                      matchedMembers: number;
                      unmatchedMembers: number;
                    }>("/api/sppb/import/confirm", {
                      method: "POST",
                      body: JSON.stringify({ id: preview.id, confirmed: true }),
                    });
                    setMessage(
                      `Saved ${r.inserted} new assessment records; ${r.matchedMembers} matched members; ${r.unmatchedMembers} unmatched members retained.`,
                    );
                    setPreview(null);
                    refresh();
                    onImported(
                      `Imported ${r.inserted} new assessment records. ${r.matchedMembers} matched members; ${r.unmatchedMembers} unmatched members retained.`,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm SPPB import
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/api/sppb/import/preview/" + preview.id, {
                      method: "DELETE",
                    });
                    setPreview(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Discard preview
              </button>
            </div>
          </div>
        )}
      </section>
      {data && (
        <>
          <details className="panel">
            <summary>Optional settings</summary>
            <p>
              These settings are not required to import data or analyse recorded
              results.
            </p>
            <SppbSettings
              key={data.config.revision}
              config={data.config}
              onSaved={refresh}
            />
          </details>
          <details className="panel">
            <summary>Data-quality review and unmatched records</summary>
            <section>
              <h3>Data-quality review and unmatched staging</h3>
              <p>
                {data.unmatchedMembers} unmatched Member IDs · {data.conflicts}{" "}
                unresolved same-day groups · {data.total} records requiring
                review.
              </p>
              <p>
                {pending}. Original test data and superseded records are
                retained.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<{ linked: number; unmatched: number }>(
                      "/api/sppb/reprocess",
                      { method: "POST", body: "{}" },
                    );
                    setMessage(
                      `${r.linked} newly matched assessment records; ${r.unmatched} still unmatched.`,
                    );
                    refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reprocess after member imports
              </button>
              {data.rows.map((r) => (
                <SourceReview
                  key={r.id + ":" + r.review.revision}
                  record={r}
                  onSaved={refresh}
                />
              ))}
              <div className="sppb-toolbar">
                <button
                  className="button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous review records
                </button>
                <span>
                  Page {page} of {Math.max(1, Math.ceil(data.total / 25))}
                </span>
                <button
                  className="button"
                  disabled={page * 25 >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next review records
                </button>
              </div>
            </section>
          </details>
          <section className="panel">
            <h3>Recent assessment imports</h3>
            {data.batches.map((b) => (
              <p key={b.id}>
                {b.source} ·{" "}
                {new Date(b.created).toLocaleString("en-SG", {
                  timeZone: "Asia/Singapore",
                })}{" "}
                · {b.inserted} added · {b.matchedMembers} matched /{" "}
                {b.unmatchedMembers} unmatched members
              </p>
            ))}
            {!data.batches.length && <p>No SPPB imports recorded.</p>}
          </section>
        </>
      )}
    </div>
  );
}
function SppbSettings({
  config,
  onSaved,
}: {
  config: Config;
  onSaved: () => void;
}) {
  const [months, setMonths] = useState(
      config.intervalMonths == null ? "" : String(config.intervalMonths),
    ),
    [approach, setApproach] = useState(config.approachDays),
    [source, setSource] = useState(
      config.definitions[0]?.sourceDefinition || "caritahub-export-unverified",
    ),
    [version, setVersion] = useState(config.definitions[0]?.version || ""),
    [method, setMethod] = useState(config.definitions[0]?.method || "identity"),
    [approved, setApproved] = useState(
      config.definitions[0]?.approved || false,
    ),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const scoringChanged =
    source !==
      (config.definitions[0]?.sourceDefinition ||
        "caritahub-export-unverified") ||
    version !== (config.definitions[0]?.version || "") ||
    method !== (config.definitions[0]?.method || "identity") ||
    approved !== (config.definitions[0]?.approved || false);
  return (
    <section className="panel">
      <h3>Reassessment settings</h3>
      <p>
        Optional: set when members should be considered for another assessment.
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const definition = {
              sourceDefinition: source,
              version,
              method,
              approved,
            };
            const definitions = version
              ? [
                  ...config.definitions.filter(
                    (d) => d.sourceDefinition !== source,
                  ),
                  definition,
                ]
              : config.definitions;
            await api("/api/sppb/configuration", {
              method: "POST",
              body: JSON.stringify({
                revision: config.revision,
                intervalMonths: months === "" ? null : Number(months),
                approachDays: approach,
                definitions,
                reason:
                  reason ||
                  (scoringChanged
                    ? ""
                    : "Reassessment interval updated by administrator."),
              }),
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="sppb-filters">
          <label>
            Reassessment interval (months)
            <input
              type="number"
              min="1"
              max="120"
              placeholder="Not configured"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
          </label>
          <label>
            Approaching due date (days)
            <input
              type="number"
              min="0"
              max="365"
              value={approach}
              onChange={(e) => setApproach(Number(e.target.value))}
            />
          </label>
        </div>
        <details>
          <summary>Advanced scoring settings</summary>
          <div className="form-stack">
            <label>
              Source scoring definition
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label>
              Approved scoring version
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="Documented protocol / version"
              />
            </label>
            <label>
              Validation method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="identity">
                  Original standard-range scores only
                </option>
                <option value="reviewed">
                  Individually reviewed standard scores only
                </option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />{" "}
              I approve this scoring definition based on documented source
              evidence.
            </label>
            <label>
              Scoring approval evidence
              <textarea
                required={scoringChanged}
                minLength={10}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          Save settings
        </button>
      </form>
    </section>
  );
}
function SourceReview({
  record: r,
  onSaved,
}: {
  record: RecordRow;
  onSaved: () => void;
}) {
  const [disposition, setDisposition] = useState(r.review.disposition),
    [reason, setReason] = useState(""),
    [validate, setValidate] = useState(false),
    [standard, setStandard] = useState({
      balance: "",
      gait: "",
      chair: "",
      total: "",
    }),
    [version, setVersion] = useState(""),
    [sourceDefinition, setSourceDefinition] = useState(r.sourceDefinition),
    [corrected, setCorrected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="sppb-source">
      <summary>
        {r.memberId || "Invalid Member ID"} · {day(r.date)} · imported total{" "}
        {r.original.total ?? "Missing"} ·{" "}
        {r.matched ? "Matched existing participant" : "Unmatched staging"}
        {r.conflict ? " · Same-day conflict" : ""}
      </summary>
      <p>{r.warnings.join("; ")}</p>
      <p>
        Record reference: {r.id} · {r.source} · source row {r.sourceRow}
      </p>
      <details>
        <summary>Original test fields</summary>
        <dl>
          {r.raw
            .filter((c) => c.header && c.value !== "")
            .map((c) => (
              <div key={c.column}>
                <dt>
                  {c.header} (column {c.column})
                </dt>
                <dd>{String(c.value)}</dd>
              </div>
            ))}
        </dl>
      </details>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/sppb/records/" + r.id + "/review", {
              method: "POST",
              body: JSON.stringify({
                revision: r.review.revision,
                disposition,
                reason,
                sourceDefinition,
                scoringVersion: version,
                correctedRecordId: corrected || undefined,
                standard: validate
                  ? Object.fromEntries(
                      Object.entries(standard).map(([k, v]) => [k, Number(v)]),
                    )
                  : null,
              }),
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Resolution
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
          >
            <option value="unresolved">Keep unresolved</option>
            <option value="separate">
              Confirm separate assessment (document evidence)
            </option>
            <option value="superseded">Superseded source record</option>
          </select>
        </label>
        <label>
          Corrected assessment reference, if available
          <input
            value={corrected}
            onChange={(e) => setCorrected(e.target.value)}
          />
        </label>
        <label>
          Source scoring definition
          <input
            value={sourceDefinition}
            onChange={(e) => setSourceDefinition(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={validate}
            onChange={(e) => setValidate(e.target.checked)}
          />{" "}
          Record individually reviewed standard scores, retaining originals
        </label>
        {validate && (
          <>
            <label>
              Approved scoring version
              <input
                required
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </label>
            <div className="sppb-filters">
              {(["balance", "gait", "chair", "total"] as const).map((k) => (
                <label key={k}>
                  Reviewed {k}
                  <input
                    type="number"
                    required
                    min="0"
                    max={k === "total" ? 12 : 4}
                    step="1"
                    value={standard[k]}
                    onChange={(e) =>
                      setStandard((s) => ({ ...s, [k]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          </>
        )}
        <label>
          Evidence and reason
          <textarea
            required
            minLength={10}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          Save audited source review
        </button>
      </form>
    </details>
  );
}
