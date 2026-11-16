import { useState } from "react";
import {MetricHelp} from './metric-help';
import "./analysis-trends.css";
export type TrendAnalysis = {
  monthly: {
    available: boolean;
    reason?: string | null;
    from?: string;
    to?: string;
    activeThroughDays?: number;
    rows: {
      month: string;
      from: string;
      to: string;
      partial: boolean;
      registered: number;
      active: number;
      firstObserved: number;
      returning: number;
      participants: number;
      sessions: number;
    }[];
  };
  changes: {
    available: boolean;
    reason?: string | null;
    from?: string;
    to?: string;
    previousFrom?: string;
    previousTo?: string;
    minimum: number;
    excluded: number;
    increases: Change[];
    decreases: Change[];
  };
};
type Proportion = {
  n_registered: number | null;
  n_participating: number | null;
  rate: number | null;
  lower: number | null;
  upper: number | null;
};
type Change = {
  label: string;
  current: Proportion;
  previous: Proportion;
  differencePoints: number;
  overlap: boolean;
};
const fmt = (n: number | null) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export function AnalysisTrends({
  value,
  printing = false,
}: {
  value: TrendAnalysis;
  printing?: boolean;
}) {
  const [metric, setMetric] = useState<
    "active" | "firstObserved" | "returning" | "sessions"
  >("active");
  const labels = {
    active: "Active clients at month anchor",
    firstObserved: "First observed client participants",
    returning: "Returning client participants",
    sessions: "Delivered sessions",
  };
  const maximum = Math.max(1, ...value.monthly.rows.map((r) => r[metric]));
  return (
    <section className="panel analysis-trends">
      <h2>Monthly client trends</h2>
      <MetricHelp label="Monthly client metrics" definition="Active: eligible clients with a full-history visit within the configured active band of each monthly anchor. First observed/returning: eligible clients attending in that month, split by earliest available attendance. Sessions: distinct delivered sessions in that month's covered dates and domain. Counts are not rates and have no per-session denominator."/>
      <p>
        Full attendance coverage {value.monthly.from || "Unavailable"} to{" "}
        {value.monthly.to || "Unavailable"}, independent of selected
        dates/group. Active means a recorded visit within{" "}
        {value.monthly.activeThroughDays || 30} days of the displayed month
        anchor across all programmes, using existing rules. Participation and
        sessions follow the programme-domain filter. First observed means first
        in available history, not new to the centre.
      </p>
      {!value.monthly.available ? (
        <p>{value.monthly.reason}</p>
      ) : (
        <>
          {!printing && (
            <>
              <label>
                Monthly measure
                <select
                  aria-label="Monthly trend measure"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as typeof metric)}
                >
                  {Object.entries(labels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="monthly-bars"
                role="img"
                aria-label={
                  labels[metric] +
                  ": " +
                  value.monthly.rows
                    .map(
                      (r) =>
                        `${r.month}: ${r[metric]}${r.partial ? " (partial month)" : ""}`,
                    )
                    .join("; ")
                }
              >
                {value.monthly.rows.map((r) => (
                  <div key={r.month}>
                    <span>
                      {r.month}
                      {r.partial ? " · partial" : ""}
                    </span>
                    <i
                      style={{
                        width: Math.max(1, (r[metric] / maximum) * 100) + "%",
                      }}
                    />
                    <strong>{r[metric]}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="work-table">
            <table>
              <caption>Monthly registered-client counts and anchors</caption>
              <thead>
                <tr>
                  {[
                    "Month / anchor",
                    "Registered clients",
                    "Active clients",
                    "First observed",
                    "Returning",
                    "Participating clients",
                    "Sessions",
                  ].map((h) => (
                    <th scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {value.monthly.rows.map((r) => (
                  <tr key={r.month}>
                    <th scope="row">
                      {r.month}
                      {r.partial ? " (partial)" : ""}
                      <small>
                        {r.from} to {r.to}
                      </small>
                    </th>
                    {[
                      r.registered,
                      r.active,
                      r.firstObserved,
                      r.returning,
                      r.participants,
                      r.sessions,
                    ].map((n, i) => (
                      <td key={i}>{n}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h2>What changed this period?</h2>
      {!value.changes.available ? (
        <p>{value.changes.reason}</p>
      ) : (
        <>
          <p>
            {value.changes.from} to {value.changes.to}, compared with{" "}
            {value.changes.previousFrom} to {value.changes.previousTo}. Groups
            need at least {value.changes.minimum} registered clients in both
            periods; {value.changes.excluded} groups excluded. Changes are
            percentage points in participation, not percentage growth.
          </p>
          {[
            ["Largest increases", value.changes.increases],
            ["Largest decreases", value.changes.decreases],
          ].map(([heading, changes]) => (
            <div key={heading as string}>
              <h3>{heading as string}</h3>
              {(changes as Change[]).length ? (
                <ul>
                  {(changes as Change[]).map((c) => (
                    <li key={c.label}>
                      <strong>
                        {c.label}: {c.differencePoints > 0 ? "+" : ""}
                        {fmt(c.differencePoints)} percentage points
                      </strong>
                      . {c.previous.n_participating}/{c.previous.n_registered} (
                      {fmt(c.previous.rate)}%; plausible range{" "}
                      {fmt(c.previous.lower)}–{fmt(c.previous.upper)}%) →{" "}
                      {c.current.n_participating}/{c.current.n_registered} (
                      {fmt(c.current.rate)}%; plausible range{" "}
                      {fmt(c.current.lower)}–{fmt(c.current.upper)}%).{" "}
                      {c.overlap
                        ? "Ranges overlap; the difference remains uncertain."
                        : "Ranges do not overlap; this is not a formal significance test."}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No eligible changes in this direction.</p>
              )}
            </div>
          ))}
        </>
      )}
      <details open={printing}>
        <summary>Trend definitions and limits</summary>
        <p>
          Partial first/last months are not full-month totals. Active clients
          can differ from clients attending within that month. Current client
          records are not a historical census; known registration dates restrict
          monthly eligibility, while unknown dates do not establish past
          membership. Groups may change composition. Missing records, many
          comparisons and profile bias can affect observed changes; no cause is
          inferred. No campaign-marker table is available; event annotations
          remain future work.
        </p>
      </details>
    </section>
  );
}
