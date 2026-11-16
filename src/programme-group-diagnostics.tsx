import { useEffect, useState } from "react";
import type { User } from "./types";
import { api } from "./api";
import { Ranking } from "./patterns-ui";
import type { Report } from "./patterns-ui";
import { ProgrammeDomainMix } from "./programme-diagnostic-ui";

export function ProgrammeGroupDiagnostics({
  user,
  from,
  to,
  domain,
  revision,
}: {
  user: User;
  from: string;
  to: string;
  domain: string;
  revision: string;
}) {
  const [dimension, setDimension] = useState("age"),
    [group, setGroup] = useState(""),
    [ranking, setRanking] = useState("unique"),
    [page, setPage] = useState(0),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    report?: Report;
    error?: string;
  } | null>(null);
  const query = new URLSearchParams({
    scope: "clients",
    dimension,
    group,
    ranking,
    from,
    to,
    domain,
    all: "1",
    page: String(page),
    basis: "current",
  }).toString();
  const key = query + "|" + revision + "|" + retry;
  useEffect(() => {
    if (!["admin", "planner"].includes(user.role)) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      api<Report>("/api/participation-patterns?" + query, { signal: c.signal })
        .then((report) => {
          if (!c.signal.aborted) setResult({ key, report });
        })
        .catch((e) => {
          if (!c.signal.aborted) setResult({ key, error: e.message });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, key, user.role]);
  if (!["admin", "planner"].includes(user.role))
    return <p>Group diagnostics require authorised staff access.</p>;
  const report = result?.key === key ? result.report : null,
    error = result?.key === key ? result.error : null;
  return (
    <div className="programme-group-diagnostics">
      <p>
        Uses the full eligible registered-client population for these dates and
        programme domain. Other Programme Analysis filters do not apply. Current
        recorded profiles are used. No individual records are returned.
      </p>
      <div className="patterns-filter-grid">
        <label>
          Group characteristic
          <select
            aria-label="Programme diagnostic characteristic"
            value={dimension}
            onChange={(e) => {
              setDimension(e.target.value);
              setGroup("");
              setPage(0);
            }}
          >
            {Object.entries({
              age: "Age group",
              cfs: "CFS",
              living: "Living arrangement",
              gender: "Gender",
              race: "Race",
              risk: "Social risk factor",
            }).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Participant group
          <select
            aria-label="Programme diagnostic group"
            value={group || report?.group || ""}
            disabled={!report}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(0);
            }}
          >
            {!report && (
              <option value={group}>{group || "Loading groups…"}</option>
            )}
            {report?.groups.map((g) => (
              <option key={g.label} value={g.label}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ranking metric
          <select
            aria-label="Programme diagnostic ranking"
            value={ranking}
            onChange={(e) => {
              setRanking(e.target.value);
              setPage(0);
            }}
          >
            <option value="unique">Unique reach</option>
            <option value="attendance">Attendance entries</option>
            <option value="repeat">Existing repeat engagement ranking</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            Retry programme diagnostics
          </button>
        </p>
      ) : !report ? (
        <p role="status">Loading programme group diagnostics…</p>
      ) : (
        <>
          <h3>Recorded programme results: {report.group}</h3>
          <p>
            {report.period.from || "No coverage"} to{" "}
            {report.period.to || "No coverage"} · delivered coverage{" "}
            {report.coverage.from || "Unavailable"} to{" "}
            {report.coverage.to || "Unavailable"}. Counts and ranks do not
            establish popularity or programme suitability.
          </p>
          <Ranking report={report} />
          <div className="work-actions">
            <button
              className="button"
              disabled={!page}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous diagnostic programmes
            </button>
            <span>
              Page {page + 1} · {report.rankings.total ?? "Unavailable"}{" "}
              programmes
            </span>
            <button
              className="button"
              disabled={
                (page + 1) * report.rankings.limit >=
                (report.rankings.total || 0)
              }
              onClick={() => setPage((n) => n + 1)}
            >
              Next diagnostic programmes
            </button>
          </div>
          <ProgrammeDomainMix mix={report.domainMix} />
          <p>
            Representation compares this group’s share of registered-client
            programme attendees with its share of the same eligible registry.
            All-age and non-client attendees are excluded from both shares.
            Missing, incomplete or protected denominators remain unavailable.
          </p>
        </>
      )}
    </div>
  );
}
