import { useEffect, useState } from "react";
import { api } from "./api";
import { ReportBars } from "./management";
import type { User } from "./types";
type Counts = {
  registered: number;
  attending: number | null;
  noAttendance: number | null;
  rate: number | null;
  inactive: number | null;
  working: number;
  employmentNotRecorded: number;
};
export type OutreachClient = {
  id: string;
  memberId: string;
  age: number | null;
  living: string;
  race: string;
  block: string;
  cfs: string;
  risk: string;
  employment: string;
  employmentSource: string;
  employmentRecordedOn: string | null;
  last: string | null;
  days: number | null;
  status: string;
  attendance: number;
  followUp: string;
  assigned: string;
  lastContact: string | null;
  profileRevision: number;
  membershipRevision: number;
};
type Report = {
  available: boolean;
  complete: boolean;
  registryAsOf: string | null;
  period: { from: string | null; to: string; asOf: string };
  coverage: { from: string | null; to: string | null };
  historyCurrent: boolean;
  historyNote: string;
  inactiveAfterDays: number;
  cohort: string;
  summary: Counts;
  fullRegistry: Counts;
  ageProfile: (Counts & { label: string })[];
  priorities: (Counts & { id: string; label: string })[];
  blocks: (Counts & { label: string })[];
  people: {
    rows: OutreachClient[];
    total: number;
    page: number;
    pageSize: number;
  };
  profiles: {
    cfs: (Counts & { label: string })[];
    risk: (Counts & { label: string })[];
    age: (Counts & { label: string })[];
  };
  options: { cfs: string[]; risk: string[]; blocks: string[] };
  note: string;
};
const fmt = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export function ClientOutreach({
  user,
  dates,
  revision,
  onDates,
  onReview,
}: {
  user: User;
  dates: Record<string, string>;
  revision: number;
  onDates: (q: Record<string, string>) => void;
  onReview: (p: OutreachClient) => void;
}) {
  const [cohort, setCohort] = useState("young"),
    [status, setStatus] = useState("no-attendance"),
    [employment, setEmployment] = useState(""),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(0),
    [blockLimit, setBlockLimit] = useState(20),
    [more, setMore] = useState(false),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const body = JSON.stringify({
    cohort,
    status,
    employment,
    page,
    filters: {
      from: dates.from || "",
      to: dates.to || "",
      asOf: dates.asOf,
      ...filters,
    },
  });
  useEffect(() => {
    if (user.role === "viewer") return;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      api<Report>("/api/clients/outreach", {
        method: "POST",
        body,
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) {
            setReport(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, revision, retry, user.role]);
  const update = (key: string, value: string) => {
    setPage(0);
    setBlockLimit(20);
    setFilters((old) => ({ ...old, [key]: value }));
  };
  if (user.role === "viewer")
    return <p>Outreach records require authorised staff access.</p>;
  return (
    <div className="client-outreach" aria-busy={busy}>
      <section className="panel">
        <h2>Who can we reach next?</h2>
        <p>
          Compare all registered clients with attendance, then review recorded
          blocks and individual profiles for staff-led follow-up.
        </p>
        <div className="client-filter-grid">
          <label className="field">
            Outreach group
            <select
              aria-label="Outreach group"
              value={cohort}
              onChange={(e) => {
                setCohort(e.target.value);
                setStatus(
                  e.target.value === "inactive" ? "all" : "no-attendance",
                );
                setPage(0);
                setFilters({});
              }}
            >
              {[
                ["all", "All registered clients"],
                ["young", "Young seniors · 60–69"],
                ["minority", "Minority seniors · configured races"],
                ["alone", "Seniors recorded living alone"],
                ["inactive", "Previously attended, now inactive"],
              ].map(([v, l]) => (
                <option
                  key={v}
                  value={v}
                  disabled={
                    v === "inactive" && !!report && !report.historyCurrent
                  }
                >
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Recorded block
            <select
              aria-label="Outreach block"
              value={filters.block || ""}
              onChange={(e) => update("block", e.target.value)}
            >
              <option value="">All blocks</option>
              <option value="Missing">Block not recorded</option>
              {report?.options.blocks.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Working status
            <select
              aria-label="Outreach working status"
              value={employment}
              onChange={(e) => {
                setEmployment(e.target.value);
                setPage(0);
              }}
            >
              {[
                ["", "All recorded statuses"],
                ["Working", "Working"],
                ["Not working", "Not working"],
                ["Retired", "Retired"],
                ["Unknown", "Unknown"],
                ["Not recorded", "Not recorded"],
                ["Prefers not to say", "Prefers not to say"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            More outreach filters
          </button>
        </div>
        {more && (
          <div className="client-filter-grid">
            <label className="field">
              Minimum age
              <input
                aria-label="Outreach minimum age"
                type="number"
                min="0"
                max="120"
                value={filters.ageMin || ""}
                onChange={(e) => update("ageMin", e.target.value)}
              />
            </label>
            <label className="field">
              Maximum age
              <input
                aria-label="Outreach maximum age"
                type="number"
                min="0"
                max="120"
                value={filters.ageMax || ""}
                onChange={(e) => update("ageMax", e.target.value)}
              />
            </label>
            <label className="field">
              Recorded CFS
              <select
                aria-label="Outreach CFS"
                value={filters.cfs || ""}
                onChange={(e) => update("cfs", e.target.value)}
              >
                <option value="">All CFS values</option>
                {report?.options.cfs.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Recorded SRF
              <select
                aria-label="Outreach SRF"
                value={filters.risk || ""}
                onChange={(e) => update("risk", e.target.value)}
              >
                <option value="">All SRF values</option>
                {report?.options.risk.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="work-actions">
          <button
            className="button"
            onClick={() => {
              setFilters({});
              setEmployment("");
              setPage(0);
              setStatus(cohort === "inactive" ? "all" : "no-attendance");
            }}
          >
            Reset outreach filters
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            Refresh outreach
          </button>
        </div>
        <p className="note">
          Employment is not included in the supplied workbooks. It stays Not
          recorded until staff save a sourced, dated update in the full
          participant profile. Young seniors defaults to 60–69; use All
          registered clients with age limits for another age range.
        </p>
        {busy && <p role="status">Updating outreach groups…</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      {report && (
        <>
          {!report.complete && (
            <section className="panel">
              <h3>Verify the complete client registry</h3>
              <p>
                Coverage describes loaded client records. Confirm the complete
                registry before interpreting it as centre-wide coverage.
              </p>
            </section>
          )}
          <section className="panel">
            <h2>Age profile · all registered clients</h2>
            <p>
              Registry snapshot: {report.registryAsOf || "Not verified"} ·{" "}
              {fmt(report.fullRegistry.registered)} clients. Attendance:{" "}
              {report.period.from || "No recorded history"} to{" "}
              {report.period.to}. This chart includes clients who have not
              attended.
            </p>
            <ReportBars
              rows={report.ageProfile.map((row) => ({
                label: row.label,
                value: row.registered,
                detail: `${fmt(row.attending)} attended · ${fmt(row.noAttendance)} no recorded attendance · ${row.rate == null ? "Rate unavailable" : row.rate + "% coverage"}`,
              }))}
            />
          </section>
          <section className="panel">
            <h2>Outreach gaps at a glance</h2>
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Registered group</th>
                    <th>Registered</th>
                    <th>Attended</th>
                    <th>No recorded attendance</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {report.priorities.map((row) => (
                    <tr key={row.id}>
                      <th>
                        <button
                          className="text-button"
                          disabled={
                            row.id === "inactive" && !report.historyCurrent
                          }
                          onClick={() => {
                            setCohort(row.id);
                            setStatus(
                              row.id === "inactive" ? "all" : "no-attendance",
                            );
                            setFilters({});
                            setPage(0);
                          }}
                        >
                          {row.label}
                        </button>
                      </th>
                      <td>
                        {row.id === "inactive" && !report.historyCurrent
                          ? "Unavailable"
                          : fmt(row.registered)}
                      </td>
                      <td>
                        {row.id === "inactive" && !report.historyCurrent
                          ? "Unavailable"
                          : fmt(row.attending)}
                      </td>
                      <td>
                        {row.id === "inactive" && !report.historyCurrent
                          ? "Unavailable"
                          : fmt(row.noAttendance)}
                      </td>
                      <td>
                        {row.rate == null ? "Unavailable" : `${row.rate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Coverage is unique attending clients divided by all registered
              clients in each group. Groups overlap; do not add the rows. Living
              alone is not evidence of loneliness or a reason for
              non-attendance.
            </p>
          </section>
          {!report.historyCurrent && (
            <section className="panel">
              <h3>Inactivity needs current attendance coverage</h3>
              <p>{report.historyNote}</p>
              {report.coverage.to && (
                <button
                  className="button"
                  onClick={() =>
                    onDates({
                      ...dates,
                      asOf: report.coverage.to!,
                      to: report.coverage.to!,
                      from:
                        (dates.from || "") > report.coverage.to!
                          ? ""
                          : dates.from || "",
                    })
                  }
                >
                  Use last covered date · {report.coverage.to}
                </button>
              )}
            </section>
          )}
          <div className="client-kpis">
            {[
              ["Registered in this group", report.summary.registered],
              ["Attended", report.summary.attending],
              ["No recorded attendance", report.summary.noAttendance],
              ["Coverage (%)", report.summary.rate],
            ].map(([label, n]) => (
              <article className="panel" key={String(label)}>
                <span>{label}</span>
                <strong>{fmt(n as number | null)}</strong>
              </article>
            ))}
          </div>
          <section className="panel">
            <h2>Which blocks have the largest gaps?</h2>
            <p>
              Counts describe the selected registered group. The attendance
              selector below affects the work list, so coverage denominators
              stay intact.
            </p>
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Recorded block</th>
                    <th>Registered</th>
                    <th>Attended</th>
                    <th>No attendance</th>
                    <th>Coverage</th>
                    <th>Inactive</th>
                    <th>Recorded working</th>
                    <th>Employment unknown/not recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {report.blocks.slice(0, blockLimit).map((row) => (
                    <tr key={row.label}>
                      <th>
                        <button
                          className="text-button"
                          onClick={() =>
                            update(
                              "block",
                              row.label === "Not recorded"
                                ? "Missing"
                                : row.label,
                            )
                          }
                        >
                          {row.label}
                        </button>
                      </th>
                      <td>{row.registered}</td>
                      <td>{fmt(row.attending)}</td>
                      <td>{fmt(row.noAttendance)}</td>
                      <td>
                        {row.rate == null ? "Unavailable" : row.rate + "%"}
                      </td>
                      <td>{fmt(row.inactive)}</td>
                      <td>{row.working}</td>
                      <td>{row.employmentNotRecorded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.blocks.length > blockLimit && (
              <button
                className="button"
                onClick={() => setBlockLimit((n) => n + 20)}
              >
                Show more blocks
              </button>
            )}
            <p className="note">
              These are source block labels. A block number alone does not
              establish a street or verified address.{" "}
              {fmt(report.summary.employmentNotRecorded)} selected clients have
              unknown or unrecorded employment.
            </p>
          </section>
          <section className="panel">
            <h2>Client outreach work list</h2>
            <label className="field">
              Show clients
              <select
                aria-label="Outreach list attendance"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="no-attendance">
                  No recorded attendance in this period
                </option>
                <option value="attending">Attended in this period</option>
                <option value="all">All clients in this group</option>
              </select>
            </label>
            <p>
              {report.cohort === "inactive"
                ? `Previously attended; over ${report.inactiveAfterDays} days since last attendance as of ${report.period.asOf}. `
                : ""}
              {fmt(report.people.total)} matching clients. Review contact
              preferences and recorded barriers before deciding the next step.
            </p>
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Member ID</th>
                    <th>Age</th>
                    <th>Race</th>
                    <th>Block</th>
                    <th>Living arrangement</th>
                    <th>Working status</th>
                    <th>CFS</th>
                    <th>SRF</th>
                    <th>Last attendance</th>
                    <th>Days since</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {report.people.rows.map((p) => (
                    <tr key={p.id}>
                      <th>{p.memberId}</th>
                      <td>{fmt(p.age)}</td>
                      <td>{p.race}</td>
                      <td>{p.block}</td>
                      <td>{p.living}</td>
                      <td
                        title={[p.employmentSource, p.employmentRecordedOn]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {p.employment}
                      </td>
                      <td>{p.cfs}</td>
                      <td>{p.risk}</td>
                      <td>{p.last || "No recorded history"}</td>
                      <td>{fmt(p.days)}</td>
                      <td>
                        <button className="button" onClick={() => onReview(p)}>
                          Review client / plan follow-up
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.people.rows.length && (
              <p>
                No matching client records. Adjust the outreach group or
                attendance selector.
              </p>
            )}
            <div className="work-actions">
              <button
                className="button"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                Previous clients
              </button>
              <span>Page {page + 1}</span>
              <button
                className="button"
                disabled={
                  (page + 1) * report.people.pageSize >= report.people.total
                }
                onClick={() => setPage((n) => n + 1)}
              >
                Next clients
              </button>
            </div>
          </section>
          <details className="panel">
            <summary>
              Recorded CFS, SRF and age within this outreach group
            </summary>
            {Object.entries(report.profiles).map(([key, rows]) => (
              <div key={key}>
                <h3>{key.toUpperCase()}</h3>
                <ReportBars
                  rows={rows.map((row) => ({
                    label: row.label,
                    value: row.registered,
                    detail: `${fmt(row.attending)} attended · ${fmt(row.noAttendance)} no recorded attendance`,
                  }))}
                />
              </div>
            ))}
          </details>
          <p className="note">{report.note}</p>
        </>
      )}
    </div>
  );
}
