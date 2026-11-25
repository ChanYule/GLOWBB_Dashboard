import { useEffect, useState } from "react";
import { api, centreUrl } from "./api";

type Metrics = {
  residents: number;
  seniors: number;
  attendance: number;
  maleSeniors: number | null;
  minoritySeniors: number | null;
  repeatSeniors: number | null;
};
type Group = {
  id: string;
  label: string;
  summary: Metrics | null;
  trends: (Metrics & { month: string })[];
  programmes: (Metrics & {
    name: string;
    sessions: number;
    domains: string[];
  })[];
};
type Report = { groups: Group[]; unresolved: number | null; note: string };

export function ResidentialDistribution({
  from,
  to,
  revision,
}: {
  from: string;
  to: string;
  revision: number;
}) {
  type Row = {
    label: string;
    residents: number;
    seniors: number | null;
    attendance: number;
  };
  type Distribution = { streets: Row[]; buildings: Row[]; note: string };
  const [result, setResult] = useState<Distribution | null>(null);
  const [error, setError] = useState("");
  const [dimension, setDimension] = useState<"streets" | "buildings">(
    "streets",
  );
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    api<Distribution>(
      "/api/residential-distribution?" + new URLSearchParams({ from, to }),
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [from, to, revision]);
  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p role="status">Loading residential participation…</p>;
  return (
    <>
      <p>{result.note}</p>
      <label>
        Group by{" "}
        <select
          value={dimension}
          onChange={(event) =>
            setDimension(
              event.target.value === "buildings" ? "buildings" : "streets",
            )
          }
        >
          <option value="streets">Street</option>
          <option value="buildings">Block and street</option>
        </select>
      </label>
      {result[dimension].length ? (
        <div className="work-table">
          <table>
            <caption>Participation by residential area</caption>
            <thead>
              <tr>
                <th>Area</th>
                <th>Residents</th>
                <th>Seniors</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {result[dimension].map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  <td>{row.residents}</td>
                  <td>{row.seniors ?? "Withheld"}</td>
                  <td>{row.attendance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          No residential groups meet the reporting threshold for this period.
          A group is shown only when at least 5 people share one consistent
          recorded address. Addresses come only from the residential
          block/street columns in the attendance workbook — if those columns
          were not supplied, no groups can be shown.
        </p>
      )}
    </>
  );
}

export function ResidentialOutreach({
  from,
  to,
  revision,
}: {
  from: string;
  to: string;
  revision: number;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState("both");
  const query = new URLSearchParams({ from, to }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError("");
    api<Report>("/api/residential-outreach?" + query, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setReport(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [query, revision]);
  if (error) return <p role="alert">{error}</p>;
  if (!report) return <p role="status">Loading residential outreach…</p>;
  const groups = report.groups.filter(
    (group) => area === "both" || area === group.id,
  );
  const largestReach = Math.max(
    1,
    ...groups.map((group) => group.summary?.seniors ?? 0),
  );
  return (
    <>
      <p>{report.note}</p>
      <label>
        Residential area{" "}
        <select value={area} onChange={(event) => setArea(event.target.value)}>
          <option value="both">Compare both target areas</option>
          {report.groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        </select>
      </label>
      {groups.some((group) => group.summary) && (
        <figure>
          <figcaption>Unique seniors reached</figcaption>
          {groups.map(
            (group) =>
              group.summary && (
                <div key={group.id}>
                  <p>
                    {group.label} ·{" "}
                    {group.summary.seniors.toLocaleString("en-SG")}
                  </p>
                  <meter
                    aria-label={group.label + " senior reach"}
                    min={0}
                    max={largestReach}
                    value={group.summary.seniors}
                  />
                </div>
              ),
          )}
        </figure>
      )}
      <div className="work-table">
        <table>
          <caption>Residential outreach comparison</caption>
          <thead>
            <tr>
              <th>Area</th>
              <th>Residents</th>
              <th>Seniors</th>
              <th>Attendance</th>
              <th>Male seniors</th>
              <th>Minority seniors</th>
              <th>Repeat seniors</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ id, label, summary }) => (
              <tr key={id}>
                <th>{label}</th>
                {summary ? (
                  [
                    summary.residents,
                    summary.seniors,
                    summary.attendance,
                    summary.maleSeniors,
                    summary.minoritySeniors,
                    summary.repeatSeniors,
                  ].map((value, index) => (
                    <td key={index}>
                      {value?.toLocaleString("en-SG") ?? "Withheld"}
                    </td>
                  ))
                ) : (
                  <td colSpan={6}>No releasable results for this period</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.unresolved !== null && (
        <p>
          {report.unresolved} attendees have missing or unresolved address
          information.
        </p>
      )}
      <details>
        <summary>Monthly trends and top programmes</summary>
        {groups.map((group) => (
          <section key={group.id}>
            <h3>{group.label}</h3>
            <div className="work-table">
              <table>
                <caption>Monthly participation</caption>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Residents</th>
                    <th>Seniors</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {group.trends.map((row) => (
                    <tr key={row.month}>
                      <th>{row.month}</th>
                      <td>{row.residents}</td>
                      <td>{row.seniors}</td>
                      <td>{row.attendance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="work-table">
              <table>
                <caption>Top programmes by senior reach</caption>
                <thead>
                  <tr>
                    <th>Programme</th>
                    <th>Domains</th>
                    <th>Sessions</th>
                    <th>Seniors</th>
                  </tr>
                </thead>
                <tbody>
                  {group.programmes.map((row) => (
                    <tr key={row.name}>
                      <th>{row.name}</th>
                      <td>{row.domains.join(", ")}</td>
                      <td>{row.sessions}</td>
                      <td>{row.seniors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </details>
      <a
        className="button"
        href={centreUrl("/api/residential-outreach?" + query + "&format=print")}
        target="_blank"
        rel="noreferrer"
      >
        Print outreach report
      </a>
    </>
  );
}
