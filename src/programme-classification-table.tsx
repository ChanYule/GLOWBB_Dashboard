import { useMemo, useState } from "react";

export type ProgrammeClassificationRow = {
  id: string;
  name: string;
  primaryDomain: string;
  subDomains: string[];
  sessions: number;
  unique: number | null;
  repeat: number | null;
  averageSessions: number | null;
  opportunity?: number | null;
  repeatRate?: number | null;
  rate?: number | null;
};
const fmt = (value: number | null) =>
  value == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(
        value,
      );

/** A programme has one metric row even when its sessions carry several secondary labels. */
export function ProgrammeClassificationTable({
  rows,
  reachLabel = "Unique seniors",
  onProgramme,
  print = false,
}: {
  rows: ProgrammeClassificationRow[];
  reachLabel?: string;
  onProgramme?: (id: string) => void;
  print?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            !search ||
            [row.name, row.primaryDomain, ...row.subDomains]
              .join(" ")
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            a.primaryDomain.localeCompare(b.primaryDomain) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        ),
    [rows, search],
  );
  const size = 20,
    current = Math.min(
      page,
      Math.max(0, Math.ceil(filtered.length / size) - 1),
    );
  const visible = print
    ? filtered
    : filtered.slice(current * size, (current + 1) * size);
  const opportunity = rows.some((row) => Object.hasOwn(row, "opportunity"));
  const coverage = rows.some((row) => Object.hasOwn(row, "rate"));
  return (
    <div className="programme-classifications">
      {!print && (
        <label className="classification-search">
          Find a programme, domain or sub-domain
          <input
            type="search"
            aria-label="Find programme classifications"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
      )}
      <div className="work-table">
        <table aria-label="Programme domains and sub-domains">
          <thead>
            <tr>
              <th>Programme</th>
              <th>Primary Domain</th>
              <th>Sub-domain / Event Type</th>
              <th>Delivered sessions</th>
              <th>{reachLabel}</th>
              <th>
                {opportunity
                  ? "Same-programme repeat / opportunity"
                  : "Same-programme repeat participants"}
              </th>
              {opportunity && <th>Repeat rate</th>}
              <th>Average sessions / person</th>
              {coverage && <th>Client coverage</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {onProgramme && !print ? (
                    <button
                      className="text-button"
                      onClick={() => onProgramme(row.id)}
                    >
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                </th>
                <td>{row.primaryDomain || "Unclassified / unknown"}</td>
                <td>
                  {row.subDomains.length
                    ? row.subDomains.map((label) => (
                        <div key={label}>{label}</div>
                      ))
                    : "Unclassified / unknown"}
                </td>
                <td>{fmt(row.sessions)}</td>
                <td>{fmt(row.unique)}</td>
                <td>
                  {fmt(row.repeat)}
                  {opportunity && <> / {fmt(row.opportunity ?? null)}</>}
                </td>
                {opportunity && (
                  <td>
                    {row.repeatRate == null
                      ? "Unavailable"
                      : `${fmt(row.repeatRate)}%`}
                  </td>
                )}
                <td>{fmt(row.averageSessions)}</td>
                {coverage && (
                  <td>
                    {row.rate == null ? "Unavailable" : `${fmt(row.rate)}%`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="muted">
            No programmes match the selected period and filters.
          </p>
        )}
      </div>
      {!print && filtered.length > size && (
        <div
          className="work-actions"
          aria-label="Programme classification pages"
        >
          <button
            className="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous classifications
          </button>
          <span role="status">
            {current * size + 1}–
            {Math.min((current + 1) * size, filtered.length)} of{" "}
            {filtered.length} programmes
          </span>
          <button
            className="button"
            disabled={(current + 1) * size >= filtered.length}
            onClick={() => setPage(current + 1)}
          >
            Next classifications
          </button>
        </div>
      )}
      <p className="muted">
        One row per programme. Primary Domain is its recorded AAP Domain;
        Sub-domain lists the Event Types recorded on its sessions in this
        reporting period. Multiple labels describe the same programme, not
        additional programmes. Each person is counted once per programme; people
        attending several programmes overlap, so do not add unique reach across
        rows. Classification does not establish achieved outcomes.
      </p>
    </div>
  );
}
