import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { User } from "./types";
import type { OutreachRules } from "../shared/outreach-priority-rules.js";
import {
  OUTREACH_RULE_FIELDS,
  OUTREACH_EXPORT_COLUMNS,
} from "../shared/outreach-priority-rules.js";
import "./outreach-priorities.css";

export type PriorityClient = {
  id: string;
  memberId: string;
  age: number | null;
  living: string;
  block: string;
  last: string | null;
  status: string;
  attendance: number;
  followUp: string;
  assigned: string;
  lastContact: string | null;
  profileRevision: number;
  membershipRevision: number;
  days: number | null;
  score: number;
  reasons: { key: string; label: string; points: number }[];
  missingFields: string[];
  watch: null | {
    label: string;
    typicalDays: number | null;
    thresholdDays: number;
  };
};
type Conversion = {
  anchor: string | null;
  from: string | null;
  days: number;
  totalClients: number;
  unknownRegistration: number;
  outsideRecentCohort: number | null;
  recentRegistered: number | null;
  recordedBeforeRegistration: number | null;
  windows: {
    days: number;
    eligible: number;
    attendedWithin: number;
    notWithin: number;
    attendedLater: number;
    noRecordedAfterRegistration: number;
    pending: number;
    startNotCovered: number;
    rate: number | null;
  }[];
};
type Report = {
  view: string;
  period: { from: string | null; to: string; asOf: string };
  coverage: { from: string | null; to: string | null };
  available: boolean;
  historyCurrent: boolean;
  historyNote: string;
  rules: OutreachRules;
  inactiveAfterDays: number;
  activeThroughDays: number;
  summary: {
    matchedClients: number;
    followup: number | null;
    noHistory: number | null;
    noneInView: number | null;
    inactive: number | null;
    supportFlagged: number | null;
    missingIndicators: number | null;
    watch: number | null;
  };
  people: {
    rows: PriorityClient[];
    total: number;
    page: number;
    pageSize: number;
  };
  conversion: Conversion;
  options: { blocks: string[]; ages: string[]; interests: string[] };
  export: { enabled: false; columns: string[] };
  limitations: string[];
};
const fmt = (n: number | null | undefined, suffix = "") =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n) +
      suffix;

function ExportReview({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Review personal-data CSV"
      className="priority-export-review"
      onCancel={onClose}
    >
      <h2>Review personal-data CSV</h2>
      <p>
        This proposed file would contain identifiable client data for {count}{" "}
        clients in the filtered list, across all pages. Use it only for
        authorised follow-up, store it securely and do not share it as a
        management report.
      </p>
      <p>Proposed columns: {OUTREACH_EXPORT_COLUMNS.join(", ")}.</p>
      <p>
        CFS, SRF, living arrangement, priority scores, free-text notes and
        unnecessary identifiers are excluded.
      </p>
      <label>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />{" "}
        I understand this file contains personal data and is for authorised
        follow-up only.
      </label>
      <p role="status">
        Personal-data downloads are disabled under the current export policy.
        Aggregate centre-summary exports remain available in Client
        participation.
      </p>
      <div className="work-actions">
        <button
          className="button"
          disabled
          title="Identifiable CSV export is disabled by policy"
        >
          Download CSV
        </button>
        <button className="button" onClick={onClose}>
          Close export review
        </button>
      </div>
    </dialog>
  );
}

export function OutreachPriorities({
  user,
  dates,
  revision,
  onDates,
  onReview,
}: {
  user: User;
  dates: Record<string, string>;
  revision: number;
  onDates: (dates: Record<string, string>) => void;
  onReview: (row: PriorityClient) => void;
}) {
  const [view, setView] = useState("priorities"),
    [indicator, setIndicator] = useState("all"),
    [recency, setRecency] = useState("all"),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(0),
    [retry, setRetry] = useState(0),
    [exportOpen, setExportOpen] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    data?: Report;
    error?: string;
  } | null>(null);
  const body = JSON.stringify({
    view,
    indicator,
    recency,
    page,
    filters: {
      from: dates.from || "",
      to: dates.to || "",
      asOf: dates.asOf,
      ...filters,
    },
  });
  const key = `${body}:${revision}:${retry}`;
  useEffect(() => {
    if (user.role === "viewer") return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      api<Report>("/api/clients/priorities", {
        method: "POST",
        body,
        signal: c.signal,
      })
        .then((data) => {
          if (!c.signal.aborted) setResult({ key, data });
        })
        .catch((e) => {
          if (!c.signal.aborted) setResult({ key, error: e.message });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [body, key, user.role]);
  if (user.role === "viewer")
    return <p>Follow-up priorities require authorised staff access.</p>;
  const current = result?.key === key ? result : null,
    report = current?.data;
  const update = (name: string, value: string) => {
    setPage(0);
    setFilters((old) => ({ ...old, [name]: value }));
  };
  return (
    <div className="outreach-priorities" aria-busy={!current}>
      <section className="panel">
        <h2>Follow-up priorities</h2>
        <p>
          Review clients with no recorded attendance matching this view or an
          existing inactive status. Scores show editable rules and recorded
          support indicators; they do not diagnose need, decide eligibility or
          send messages.
        </p>
        <div className="client-filter-grid">
          <label className="field">
            Priority view
            <select
              aria-label="Priority view"
              value={view}
              onChange={(e) => {
                setView(e.target.value);
                setPage(0);
              }}
            >
              <option value="priorities">Follow-up priorities</option>
              <option value="watch">Active clients · lapsing watchlist</option>
            </select>
          </label>
          <label className="field">
            Reporting date
            <input
              type="date"
              aria-label="Priority reporting date"
              value={dates.asOf || ""}
              onChange={(e) => {
                setPage(0);
                onDates({ ...dates, asOf: e.target.value });
              }}
            />
          </label>
          <label className="field">
            From
            <input
              type="date"
              aria-label="Priority attendance from"
              value={dates.from || ""}
              onChange={(e) => {
                setPage(0);
                onDates({ ...dates, from: e.target.value });
              }}
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              aria-label="Priority attendance to"
              value={dates.to || ""}
              onChange={(e) => {
                setPage(0);
                onDates({ ...dates, to: e.target.value });
              }}
            />
          </label>
          <label className="field">
            Recorded block
            <select
              aria-label="Priority block"
              value={filters.block || ""}
              onChange={(e) => update("block", e.target.value)}
            >
              <option value="">All blocks</option>
              {report?.options.blocks.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Age group
            <select
              aria-label="Priority age group"
              value={filters.ageGroup || ""}
              onChange={(e) => update("ageGroup", e.target.value)}
            >
              <option value="">All ages</option>
              {report?.options.ages.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Recorded indicator
            <select
              aria-label="Priority indicator"
              value={indicator}
              onChange={(e) => {
                setIndicator(e.target.value);
                setPage(0);
              }}
            >
              {[
                ["all", "All indicators"],
                ["any", "Any configured support indicator"],
                ["cfs", "Configured CFS indicator"],
                ["alone", "Recorded living alone"],
                ["srf", "Configured approved SRF indicator"],
                ["missing", "Profile information gaps"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Recency
            <select
              aria-label="Priority recency"
              value={recency}
              onChange={(e) => {
                setRecency(e.target.value);
                setPage(0);
              }}
            >
              {[
                ["all", "All recency"],
                ["within30", "Within 30 days"],
                ["days31to60", "31–60 days"],
                ["days61to90", "61–90 days"],
                ["over90", "More than 90 days"],
                ["noHistory", "No recorded history"],
                ["unavailable", "History limited / unavailable"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Recorded programme interest
            <select
              aria-label="Priority interest"
              value={filters.interest || ""}
              onChange={(e) => update("interest", e.target.value)}
            >
              <option value="">All recorded interests</option>
              {report?.options.interests.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="work-actions">
          <button
            className="button"
            onClick={() => {
              setFilters({});
              setIndicator("all");
              setRecency("all");
              setPage(0);
            }}
          >
            Reset priority filters
          </button>
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            Refresh priorities
          </button>
        </div>
      </section>
      {!current && <p role="status">Updating follow-up priorities…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {report && (
        <>
          <p>
            Attendance coverage: {report.coverage.from || "Unavailable"} to{" "}
            {report.coverage.to || "Unavailable"}. Reporting date:{" "}
            {report.period.asOf}.
          </p>
          {!report.historyCurrent && (
            <section className="panel">
              <p className="note">
                {report.historyNote} Inactive/watch counts and gap points are
                unavailable.
              </p>
              {report.coverage.to && (
                <button
                  className="button"
                  onClick={() => {
                    setPage(0);
                    onDates({
                      ...dates,
                      asOf: report.coverage.to!,
                      to: report.coverage.to!,
                      from:
                        (dates.from || "") > report.coverage.to!
                          ? ""
                          : dates.from || "",
                    });
                  }}
                >
                  Use last covered date · {report.coverage.to}
                </button>
              )}
            </section>
          )}
          <div className="client-kpis">
            {[
              ["Eligible clients in audience", report.summary.matchedClients],
              ["Follow-up candidates", report.summary.followup],
              [
                "Candidates with recorded support indicators",
                report.summary.supportFlagged,
              ],
              ["Active watchlist", report.summary.watch],
              [
                "Candidates with profile gaps",
                report.summary.missingIndicators,
              ],
            ].map(([label, count]) => (
              <article className="panel" key={String(label)}>
                <span>{label}</span>
                <strong>{fmt(count as number | null)}</strong>
              </article>
            ))}
          </div>
          <section className="panel">
            <h3>
              {view === "watch"
                ? "Active clients · lapsing watchlist"
                : "Prioritised follow-up list"}
            </h3>
            <p>
              Summary counts follow the audience filters; indicator, recency and
              view selectors affect the list only. Missing indicators are not
              evidence of no support needs. Click Review to open the existing
              staff review flow.
            </p>
            {!report.available && (
              <p className="note">
                Attendance history is unavailable; priorities cannot be
                determined from missing records.
              </p>
            )}
            <div
              className="work-table priority-table"
              role="region"
              aria-label="Follow-up priority results"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  Follow-up priorities · authorised staff only
                </caption>
                <thead>
                  <tr>
                    {[
                      "Member ID",
                      "Recorded block / age",
                      "Priority points",
                      "Why flagged",
                      "Recorded attendance",
                      "Follow-up",
                      "Review",
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.people.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.memberId}</th>
                      <td>
                        {row.block}
                        <br />
                        Age: {fmt(row.age)}
                      </td>
                      <td>
                        <strong>{row.score}</strong>
                      </td>
                      <td>
                        <ul className="priority-reasons">
                          {row.reasons.map((r, i) => (
                            <li key={`${r.key}-${i}`}>
                              {r.label} (+{r.points})
                            </li>
                          ))}
                          {row.watch && <li>{row.watch.label}</li>}
                        </ul>
                        {row.missingFields.length > 0 && (
                          <details>
                            <summary>
                              {row.missingFields.length} profile information
                              gap(s)
                            </summary>
                            <ul>
                              {row.missingFields.map((v) => (
                                <li key={v}>{v}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td>
                        Last: {row.last || "No recorded history"}
                        <br />
                        {row.days == null
                          ? "Covered-date gap unavailable"
                          : `${row.days} days since last attendance`}
                        <br />
                        {row.attendance} sessions in view
                      </td>
                      <td>
                        {row.followUp}
                        <br />
                        {row.assigned || "Unassigned"}
                        <br />
                        Last contact: {row.lastContact || "Not recorded"}
                      </td>
                      <td>
                        <button
                          className="button"
                          onClick={() => onReview(row)}
                        >
                          Review client / plan follow-up
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.people.total === 0 && report.available && (
              <p>No clients match this priority view and filters.</p>
            )}
            <div className="work-actions">
              <button
                className="button"
                disabled={report.people.page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                Previous priority page
              </button>
              <span>
                {report.people.total} clients · page {report.people.page + 1}
              </span>
              <button
                className="button"
                disabled={
                  (report.people.page + 1) * report.people.pageSize >=
                  report.people.total
                }
                onClick={() => setPage((n) => n + 1)}
              >
                Next priority page
              </button>
              <button className="button" onClick={() => setExportOpen(true)}>
                Review CSV export
              </button>
            </div>
          </section>
          <section className="panel">
            <h3>Recent registration → recorded attendance</h3>
            <p>
              Full eligible registry at{" "}
              {report.conversion.anchor || "Unavailable"}; recent cohort{" "}
              {report.conversion.from || "Unavailable"} to{" "}
              {report.conversion.anchor || "Unavailable"}. Independent of list
              filters and the selected attendance period/domain.
            </p>
            <p>
              {report.conversion.totalClients} clients;{" "}
              {report.conversion.unknownRegistration} excluded for
              missing/invalid registration dates;{" "}
              {fmt(report.conversion.outsideRecentCohort)} outside the recent
              cohort; {fmt(report.conversion.recentRegistered)} recent
              registrations. {fmt(report.conversion.recordedBeforeRegistration)}{" "}
              have attendance before registration (not counted as conversion).
            </p>
            {report.conversion.anchor ? (
              <div className="work-table">
                <table>
                  <caption>Completed registration follow-up windows</caption>
                  <thead>
                    <tr>
                      {[
                        "Window",
                        "Eligible",
                        "Attended within window",
                        "No attendance within window",
                        "Attended later",
                        "No recorded attendance after registration",
                        "Pending window",
                        "Start not covered",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.conversion.windows.map((w) => (
                      <tr key={w.days}>
                        <th>{w.days} days</th>
                        <td>{w.eligible}</td>
                        <td>
                          {w.attendedWithin} ({fmt(w.rate, "%")})
                        </td>
                        <td>{w.notWithin}</td>
                        <td>{w.attendedLater}</td>
                        <td>{w.noRecordedAfterRegistration}</td>
                        <td>{w.pending}</td>
                        <td>{w.startNotCovered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Conversion unavailable without attendance coverage.</p>
            )}
            <p className="table-note">
              Only known registration dates with a covered start and a completed
              14/30-day window enter each rate. Later attendance and no recorded
              attendance are subsets of no attendance within the window; do not
              add them again. Missing records do not prove someone never
              attended.
            </p>
          </section>
          <details className="panel">
            <summary>Scoring, watchlist rules and limits</summary>
            <p>
              One base applies in order: existing inactive status, no recorded
              history, otherwise no attendance matching this view. Additional
              indicator and covered-date gap points are added. Sort is score,
              then covered-date gap, then Member ID. Watchlist requires existing
              active status (through day {report.activeThroughDays}); inactive
              starts after day {report.inactiveAfterDays} under existing rules.
            </p>
            <ul>
              {OUTREACH_RULE_FIELDS.map(([key, label]) => (
                <li key={key}>
                  {label}: {report.rules[key]}
                </li>
              ))}
            </ul>
            <p>
              Selected SRF codes:{" "}
              {report.rules.riskCodes.join(", ") || "None configured"}.
              Configure in Dashboard Settings → Outreach follow-up priority
              rules.
            </p>
            {report.limitations.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </details>
          {exportOpen && (
            <ExportReview
              count={report.people.total}
              onClose={() => setExportOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
