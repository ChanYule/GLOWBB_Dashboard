import { useEffect, useState } from "react";
import { api } from "./api";
import type { Dashboard, Filters } from "./types";
import { meetingPeriod } from "./meeting-layouts";

export function PreviousPeriod({
  data,
  filters,
  revision,
}: {
  data: Dashboard;
  filters: Filters;
  revision: number;
}) {
  const [mode, setMode] = useState("none");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [applied, setApplied] = useState(custom);
  const [result, setResult] = useState<{ key: string; data: Dashboard } | null>(
    null,
  );
  const [error, setError] = useState("");
  const periodEnd = filters.from || filters.to || data.period.to;
  const canCompare = (from: string, to: string) =>
    !!data.coverage.from &&
    !!data.coverage.to &&
    from >= data.coverage.from &&
    to <= data.coverage.to &&
    from <= to;
  const month = meetingPeriod("month", { from: "", to: "" }, periodEnd);
  const quarter = meetingPeriod("quarter", { from: "", to: "" }, periodEnd);
  const lastYearDay = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const [year, month, day] = value.split("-").map(Number);
    return new Date(
      Date.UTC(
        year - 1,
        month - 1,
        Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate()),
      ),
    )
      .toISOString()
      .slice(0, 10);
  };
  const lastYear = {
    from: lastYearDay(filters.from),
    to: lastYearDay(filters.to || data.period.to),
  };
  const range =
    mode === "custom"
      ? applied
      : mode === "month"
        ? month
        : mode === "quarter"
          ? quarter
          : mode === "year"
            ? lastYear
            : null;
  const valid = !!(range?.from && range.to && canCompare(range.from, range.to));
  const key = valid
    ? new URLSearchParams({
        ...filters,
        ...range,
        view: "overview",
        includeTargets: "0",
      }).toString()
    : "";
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    setError("");
    api<Dashboard>("/api/dashboard?" + key, {
      signal: abort.signal,
      reuseForMs: 15000,
    })
      .then((value) => {
        if (!abort.signal.aborted) setResult({ key, data: value });
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      });
    return () => abort.abort();
  }, [key, revision]);
  const prior =
    mode === "equivalent"
      ? data.previous
      : result && result.key === key
        ? result.data.summary
        : null;
  const metrics = [
    ["unique", "Unique seniors"],
    ["attendance", "Attendance entries"],
    ["sessions", "Delivered sessions"],
    ["programmes", "Programmes"],
  ] as const;
  const fmt = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });
  return (
    <details className="panel">
      <summary>Compare reporting periods <small>Last 6 months vs available history</small></summary>
      <label>
        Comparison{" "}
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="none">No comparison</option>
          {data.previous && (
            <option value="equivalent">Previous equivalent period</option>
          )}
          {canCompare(month.from, month.to) && (
            <option value="month">Previous completed month</option>
          )}
          {canCompare(quarter.from, quarter.to) && (
            <option value="quarter">Previous completed quarter</option>
          )}
          {canCompare(lastYear.from, lastYear.to) && (
            <option value="year">Same period last year</option>
          )}
          {data.coverage.from && (
            <option value="custom">Custom comparison period</option>
          )}
        </select>
      </label>
      {mode === "custom" && (
        <form
          className="work-actions"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(custom);
          }}
        >
          <label>
            Comparison start{" "}
            <input
              type="date"
              required
              value={custom.from}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
          </label>
          <label>
            Comparison end{" "}
            <input
              type="date"
              required
              value={custom.to}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </label>
          <button className="button">Apply comparison</button>
        </form>
      )}
      {mode !== "none" &&
        (prior ? (
          <div className="work-table">
            <table>
              <caption>
                {mode === "equivalent" && data.previous
                  ? data.previous.from + " to " + data.previous.to
                  : range?.from + " to " + range?.to}
              </caption>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Current</th>
                  <th>Comparison</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(([metric, label]) => {
                  const current = data.summary[metric],
                    before = prior[metric],
                    change = current - before;
                  return (
                    <tr key={metric}>
                      <th>{label}</th>
                      <td>{fmt.format(current)}</td>
                      <td>{fmt.format(before)}</td>
                      <td>
                        {change > 0 ? "+" : ""}
                        {fmt.format(change)}
                        {before > 0
                          ? " (" + fmt.format((change / before) * 100) + "%)"
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : key ? (
          <p role="status">Loading comparison...</p>
        ) : (
          <p>Choose dates within the recorded attendance coverage.</p>
        ))}
    </details>
  );
}
