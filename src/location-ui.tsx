import { useEffect, useState } from "react";
import { api } from "./api";
import { ReportBars } from "./management";
import type { Report } from "./patterns-ui";
const fmt = (n: number | null | undefined) =>
  n == null
    ? "Unknown / withheld"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export function LocationBlocks({
  query,
  revision,
  onClients,
}: {
  query: Record<string, string>;
  revision: number;
  onClients?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [report, setReport] = useState<Report | null>(null),
    [detail, setDetail] = useState<Report | null>(null),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("noAttendance"),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(""),
    [factor, setFactor] = useState("age"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const base = new URLSearchParams({
    ...query,
    dimension: "locationBlock",
    second: "",
    group: "",
    blockSearch: search,
    blockSort: sort,
    blockPage: String(page),
  }).toString();
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Report>("/api/participation-patterns?" + base, { signal: c.signal })
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
    }, 180);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [base, open, revision]);
  const detailQuery = new URLSearchParams({
    ...query,
    dimension: "locationBlock",
    group: selected,
    second: factor,
  }).toString();
  useEffect(() => {
    if (!open || !selected) return;
    const c = new AbortController();
    api<Report>("/api/participation-patterns?" + detailQuery, {
      signal: c.signal,
    })
      .then(setDetail)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [detailQuery, open, selected, revision]);
  const rows = report?.location?.blockRows;
  return (
    <details className="panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Participation by Residential Block</summary>
      {open && (
        <>
          <p>
            All current registered clients, using the reporting dates above.
            Only privacy-safe building groups are shown; a source block alone is
            not a verified address. Building details are excluded from
            management reports.
          </p>
          <div className="patterns-filter-grid">
            <label>
              Find a residential building
              <input
                aria-label="Find a residential building"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Sort buildings
              <select
                aria-label="Sort residential buildings"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(0);
                }}
              >
                <option value="low">Lowest participation rate</option>
                <option value="high">Highest participation rate</option>
                <option value="noAttendance">
                  Most clients without attendance
                </option>
                <option value="distance">Distance (known first)</option>
                <option value="registered">
                  Largest registered population
                </option>
              </select>
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Updating residential comparison...</p>}
          <div className="work-table">
            <table>
              <thead>
                <tr>
                  <th>Residential building</th>
                  <th>Registered</th>
                  <th>Attended</th>
                  <th>No recorded attendance</th>
                  <th>Participation (%)</th>
                  <th>
                    {query.distanceMetric === "straight"
                      ? "Straight-line metres"
                      : query.distanceMetric === "time"
                        ? "Estimated walking minutes"
                        : "Walking-route metres"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows?.rows.map((r) => (
                  <tr key={r.label}>
                    <th>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected(r.label);
                          setDetail(null);
                        }}
                      >
                        {r.label}
                      </button>
                      <small>
                        {r.verified
                          ? "Reviewed building"
                          : "Awaiting location verification"}
                      </small>
                    </th>
                    <td>{fmt(r.registered)}</td>
                    <td>{fmt(r.unique)}</td>
                    <td>{fmt(r.noAttendance)}</td>
                    <td>{fmt(r.rate)}</td>
                    <td>{fmt(r.distance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows && !rows.rows.length && (
            <p>
              No releasable building groups in this view. Unverified clients
              remain included in Distance unknown.
            </p>
          )}
          <div className="work-actions">
            <button
              className="button"
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous buildings
            </button>
            <button
              className="button"
              disabled={(page + 1) * 20 >= (rows?.total || 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next buildings
            </button>
            {onClients && (
              <button className="button" onClick={onClients}>
                Open client follow-up
              </button>
            )}
          </div>
          {selected && (
            <section className="panel">
              <h3>{selected}</h3>
              <label>
                Inspect one participant characteristic
                <select
                  aria-label="Block demographic characteristic"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                >
                  <option value="age">Age</option>
                  <option value="cfs">CFS</option>
                  <option value="risk">SRF</option>
                  <option value="living">Living arrangement</option>
                  <option value="gender">Gender</option>
                  <option value="race">Race</option>
                </select>
              </label>
              {!detail ? (
                <p>Preparing protected block detail...</p>
              ) : detail.combined?.suppressed ? (
                <p className="note">
                  This block's combined demographic groups cannot be released
                  safely. Use the broader distance comparison or existing
                  authorised client follow-up.
                </p>
              ) : (
                <div className="work-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Characteristic group</th>
                        <th>Registered</th>
                        <th>Attended</th>
                        <th>Participation (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.combined?.rows
                        .filter((r) => r.groups[0] === selected)
                        .map((r) => (
                          <tr key={r.groups.join("|")}>
                            <th>{r.groups[1]}</th>
                            <td>{fmt(r.registered)}</td>
                            <td>{fmt(r.unique)}</td>
                            <td>{fmt(r.rate)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {detail && !detail.domains.suppressed && (
                <ReportBars
                  rows={detail.domains.rows.map((d) => ({
                    label: d.label,
                    value: d.unique,
                  }))}
                />
              )}
              {detail && (
                <p>
                  Review sourced feedback and full address evidence in the
                  existing client workspace before planning an outreach visit or
                  venue change.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </details>
  );
}
