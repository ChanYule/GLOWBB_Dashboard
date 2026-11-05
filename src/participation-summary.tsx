import { useEffect, useState } from "react";
import { api } from "./api";
import type { Filters } from "./types";

type Counts = {
  programmes: number;
  attendance: number;
  unique: number;
  ib: number;
  ob: number;
  unknownClient: number;
  male: number;
  minority: number;
  ibPct: number | null;
  obPct: number | null;
  malePct: number | null;
  minorityPct: number | null;
  asOf: string;
};
type Report = {
  available: boolean;
  month: string;
  months: string[];
  rows: {
    date: string;
    week: number | null;
    status: string;
    counts: Counts | null;
  }[];
  monthSummary: Counts;
  monthly: ({ month: string } & Counts)[];
  summary: Counts;
  definitions: Record<string, string>;
};
const numberFormat = new Intl.NumberFormat("en-SG");
const count = (n: number) => numberFormat.format(n);
const share = (n: number, p: number | null) =>
  `${count(n)}${p == null ? "" : ` (${p.toFixed(1).replace(/\.0$/, "")}%)`}`;
const dayFormat = new Intl.DateTimeFormat("en-SG", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Singapore",
});
const date = (value: string) =>
  dayFormat.format(new Date(value + "T00:00:00+08:00"));
const monthFormat = new Intl.DateTimeFormat("en-SG", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Singapore",
});
const monthName = (value: string) =>
  monthFormat.format(new Date(value + "-01T00:00:00+08:00"));
function Values({ value }: { value: Counts | null }) {
  return (
    <>
      {[
        value?.programmes,
        value?.attendance,
        value?.unique,
        value ? share(value.ib, value.ibPct) : null,
        value ? share(value.ob, value.obPct) : null,
        value ? share(value.male, value.malePct) : null,
        value ? share(value.minority, value.minorityPct) : null,
      ].map((v, i) => (
        <td key={i}>
          {v == null ? "—" : typeof v === "number" ? count(v) : v}
        </td>
      ))}
    </>
  );
}
export function ParticipationSummary({
  filters,
  revision,
  available,
}: {
  filters: Filters;
  revision: number;
  available: boolean;
}) {
  const [report, setReport] = useState<Report | null>(null),
    [month, setMonth] = useState(""),
    [view, setView] = useState("day"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const query = new URLSearchParams({ ...filters, month }).toString();
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    setLoading(true);
    api<Report>("/api/reporting/participation?" + query, {
      signal: controller.signal,
    })
      .then((r) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(r.rows) || !r.monthSummary)
          throw Error(
            "The attendance summary response was incomplete. Refresh to try again.",
          );
        setReport(r);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision, available]);
  return (
    <section className="panel participation-summary" aria-busy={loading}>
      <div className="report-section-heading">
        <div>
          <h2>Attendance summary</h2>
          <p className="muted">
            Daily and monthly delivery, reach and target-group participation.
          </p>
        </div>
        <div className="summary-controls">
          <div className="segmented" aria-label="Attendance summary interval">
            <button
              className={view === "day" ? "active" : ""}
              aria-pressed={view === "day"}
              onClick={() => setView("day")}
            >
              Daily
            </button>
            <button
              className={view === "month" ? "active" : ""}
              aria-pressed={view === "month"}
              onClick={() => setView("month")}
            >
              Monthly
            </button>
          </div>
          {report && view === "day" && (
            <label>
              Summary month
              <select
                aria-label="Summary month"
                value={loading && month ? month : report.month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {report.months.map((m) => (
                  <option value={m} key={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="muted">
          Updating attendance summary...
        </p>
      )}
      {!available ? (
        <p className="note">Import attendance to populate this summary.</p>
      ) : (
        report && (
          <>
            <p className="summary-scope">
              All recorded ages, with active dashboard filters applied.
              Percentages use each row’s unique participants. The total unique
              participants card covers all ages; male and minority senior cards
              use the configured senior age threshold.
            </p>
            <div className="participation-table-scroll">
              <table>
                <caption className="sr-only">
                  {view === "day"
                    ? monthName(report.month) +
                      " daily attendance and deduplicated monthly total"
                    : "Monthly attendance and deduplicated reporting-period total"}
                </caption>
                <thead>
                  <tr>
                    {view === "day" && <th scope="col">Week</th>}
                    <th scope="col">{view === "day" ? "Date" : "Month"}</th>
                    <th scope="col">Programmes</th>
                    <th scope="col">Attendances</th>
                    <th scope="col">Unique</th>
                    <th scope="col">
                      <abbr title="Existing clients, as a share of unique participants">
                        IB (%)
                      </abbr>
                    </th>
                    <th scope="col">
                      <abbr title="Non-clients, as a share of unique participants">
                        OB (%)
                      </abbr>
                    </th>
                    <th scope="col">Male (%)</th>
                    <th scope="col">Minority (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {view === "day"
                    ? report.rows.map((r) => (
                        <tr
                          key={r.date}
                          className={r.counts ? "" : "summary-unavailable"}
                        >
                          <td>{r.week ?? "—"}</td>
                          <th scope="row" title={r.status.replaceAll("-", " ")}>
                            {date(r.date)}
                          </th>
                          <Values value={r.counts} />
                        </tr>
                      ))
                    : report.monthly.map((r) => (
                        <tr key={r.month}>
                          <th scope="row">{monthName(r.month)}</th>
                          <Values value={r} />
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={view === "day" ? 2 : 1}>
                      {view === "day"
                        ? monthName(report.month) + " total"
                        : "Reporting period total"}
                    </th>
                    <Values
                      value={
                        view === "day" ? report.monthSummary : report.summary
                      }
                    />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted summary-total-note">
              Totals count each person once within that month or reporting
              period. Daily unique counts must not be added together.
            </p>
            <details>
              <summary>Definitions and data coverage</summary>
              {Object.values(report.definitions).map((note) => (
                <p key={note}>{note}</p>
              ))}
              <p>
                Selected month: {report.monthSummary.unknownClient} attendees
                have unknown client status.
              </p>
            </details>
          </>
        )
      )}
    </section>
  );
}
