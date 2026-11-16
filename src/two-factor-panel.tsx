import { useState } from "react";
import type {
  MatrixCell,
  TwoFactorReport,
} from "../shared/two-factor-analysis.js";
import "./two-factor-panel.css";
const titles: Record<string, string> = {
  age: "Age group",
  cfs: "CFS",
  living: "Living arrangement",
  risk: "Social risk factor",
  race: "Race",
  gender: "Gender",
  block: "Residential block",
  locationBlock: "Verified residential building",
  distance: "Distance",
  participation: "Participation status",
};
const fmt = (n: number | null) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
const range = (c: { lower: number | null; upper: number | null }) =>
  `${fmt(c.lower)}–${fmt(c.upper)}%`;

function Cell({
  cell,
  clientDenominator = false,
}: {
  cell?: MatrixCell;
  clientDenominator?: boolean;
}) {
  if (!cell)
    return (
      <>
        <strong>No recorded combination</strong>
        <small>
          n={clientDenominator ? "0" : "Unavailable"} · rate unavailable
        </small>
      </>
    );
  return (
    <>
      <strong>
        {cell.rate == null ? "Rate unavailable" : `${fmt(cell.rate)}%`}
      </strong>
      <small>
        n={fmt(cell.n_registered)} · {fmt(cell.n_participating)} participating
      </small>
      {cell.rate != null && <small>Plausible range {range(cell)}</small>}
      {cell.small && <small>Small group · interpret with caution</small>}
      {cell.unknown && (
        <small>Unknown/non-standard category · excluded from findings</small>
      )}
    </>
  );
}

export function TwoFactorPanel({
  report,
  printing = false,
}: {
  report: TwoFactorReport;
  printing?: boolean;
}) {
  const [rowPage, setRowPage] = useState(0),
    [columnPage, setColumnPage] = useState(0);
  const rowsPerPage = 12,
    columnsPerPage = 6;
  const rowIndex = Math.min(
    rowPage,
    Math.max(0, Math.ceil(report.rows.length / rowsPerPage) - 1),
  );
  const colIndex = Math.min(
    columnPage,
    Math.max(0, Math.ceil(report.columns.length / columnsPerPage) - 1),
  );
  const rows = report.rows.slice(
    rowIndex * rowsPerPage,
    (rowIndex + 1) * rowsPerPage,
  );
  const columns = report.columns.slice(
    colIndex * columnsPerPage,
    (colIndex + 1) * columnsPerPage,
  );
  const cells = new Map(report.cells.map((c) => [JSON.stringify(c.groups), c]));
  const clientDenominator = report.cells.some((c) => c.n_registered != null);
  const title = `${titles[report.dimensions[0]] || report.dimensions[0]} × ${titles[report.dimensions[1]] || report.dimensions[1]}`;
  if (report.status === "withheld")
    return (
      <section className="panel two-factor-panel">
        <h3>Two-factor participation</h3>
        <p>
          Combined cells are withheld by the existing privacy rules. No matrix,
          totals or review findings are released. Broaden the view.
        </p>
      </section>
    );
  return (
    <section className="panel two-factor-panel">
      <h3>Two-factor participation: {title}</h3>
      <p>
        Participation = clients attending at least once ÷ registered clients in
        each combination. Period, programme domain and profile basis follow this
        view. n is the registered-client denominator.
      </p>
      {report.status === "unavailable" && (
        <p role="status">
          Client participation rates require a complete registered-client
          population and attendance coverage. Attendance-only populations have
          no client-rate denominator.
        </p>
      )}
      <p className="matrix-key">
        Darker cells indicate higher participation. Hatched grey cells have
        fewer than {report.cautionMinimum} registered clients;
        unknown/unavailable cells are grey. All released counts remain visible.
        Small or unknown cells do not enter the review panel.
      </p>
      {!report.cells.length ? (
        <p>No recorded combinations in this population.</p>
      ) : printing ? (
        <div className="work-table">
          <table>
            <caption>{title} · all recorded combinations</caption>
            <thead>
              <tr>
                <th scope="col">{titles[report.dimensions[0]]}</th>
                <th scope="col">{titles[report.dimensions[1]]}</th>
                <th scope="col">Participation and denominator</th>
              </tr>
            </thead>
            <tbody>
              {report.cells.map((c) => (
                <tr key={JSON.stringify(c.groups)}>
                  <th scope="row">{c.groups[0]}</th>
                  <td>{c.groups[1]}</td>
                  <td className={c.small ? "matrix-small" : ""}>
                    <Cell cell={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            className="matrix-scroll"
            tabIndex={0}
            role="region"
            aria-label={`${title} matrix, scroll for all columns`}
          >
            <table className="participation-matrix">
              <caption>{title} · client participation rate and n</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {titles[report.dimensions[0]]} /{" "}
                    {titles[report.dimensions[1]]}
                  </th>
                  {columns.map((c) => (
                    <th scope="col" key={c}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r}>
                    <th scope="row">{r}</th>
                    {columns.map((c) => {
                      const cell = cells.get(JSON.stringify([r, c]));
                      const muted =
                        !cell ||
                        cell.small ||
                        cell.unknown ||
                        cell.rate == null;
                      return (
                        <td
                          key={c}
                          className={
                            cell?.small
                              ? "matrix-small"
                              : muted
                                ? "matrix-unavailable"
                                : ""
                          }
                          style={
                            !muted
                              ? {
                                  backgroundColor: `hsl(174 45% ${97 - cell.rate! * 0.3}%)`,
                                }
                              : undefined
                          }
                        >
                          <Cell
                            cell={cell}
                            clientDenominator={clientDenominator}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="matrix-pages">
            <button
              className="button"
              disabled={rowIndex === 0}
              onClick={() => setRowPage(rowIndex - 1)}
            >
              Previous matrix rows
            </button>
            <span>
              Rows {rowIndex * rowsPerPage + 1}–
              {Math.min((rowIndex + 1) * rowsPerPage, report.rows.length)} of{" "}
              {report.rows.length}
            </span>
            <button
              className="button"
              disabled={(rowIndex + 1) * rowsPerPage >= report.rows.length}
              onClick={() => setRowPage(rowIndex + 1)}
            >
              Next matrix rows
            </button>
            <button
              className="button"
              disabled={colIndex === 0}
              onClick={() => setColumnPage(colIndex - 1)}
            >
              Previous matrix columns
            </button>
            <span>
              Columns {colIndex * columnsPerPage + 1}–
              {Math.min((colIndex + 1) * columnsPerPage, report.columns.length)}{" "}
              of {report.columns.length}
            </span>
            <button
              className="button"
              disabled={
                (colIndex + 1) * columnsPerPage >= report.columns.length
              }
              onClick={() => setColumnPage(colIndex + 1)}
            >
              Next matrix columns
            </button>
          </div>
        </>
      )}
      <h3>Where need is high but participation is low</h3>
      <p>
        Recorded CFS, living-alone or documented SRF indicators are prompts to
        review support needs, not clinical assessments or explanations for
        attendance. An indicator must describe the entire cell and be one of the
        two selected characteristics.
      </p>
      {report.overall?.rate != null ? (
        <p>
          Overall, same population and period:{" "}
          {fmt(report.overall.n_participating)} /{" "}
          {fmt(report.overall.n_registered)} ({fmt(report.overall.rate)}%;
          plausible range {range(report.overall)}).
        </p>
      ) : (
        <p>Overall comparison unavailable; no automatic findings.</p>
      )}
      {report.findings.length ? (
        <ul className="matrix-findings">
          {report.findings.map((c) => (
            <li key={JSON.stringify(c.groups)}>
              <strong>{c.groups.join(" × ")}</strong>:{" "}
              {c.supportIndicators.join("; ")}. {fmt(c.n_participating)} /{" "}
              {fmt(c.n_registered)} participating ({fmt(c.rate)}%; plausible
              range {range(c)}), below the overall plausible range. Review
              recorded barriers and voluntary feedback before deciding on
              follow-up.
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No cells meet all review rules. This does not establish that support
          needs are absent.
        </p>
      )}
      <details open={printing}>
        <summary>Review rules and interpretation limits</summary>
        <p>
          Review rules: at least {report.cautionMinimum} registered clients,
          comparison floor {report.comparisonFloor}, known categories, a
          recorded support indicator, and the cell’s upper plausible limit below
          the overall lower limit. Small, unknown and unavailable counts may
          overlap: {report.exclusions?.small ?? 0} small cells,{" "}
          {report.exclusions?.belowFloor ?? 0} below the comparison floor,{" "}
          {report.exclusions?.unknown ?? 0} unknown and{" "}
          {report.exclusions?.unavailable ?? 0} without rates.
        </p>
        <p>
          Ranges follow Phase 1’s 95% method. Non-overlap is a cautious
          descriptive screen, not a formal significance test. Cells are part of
          the overall population; these comparisons are not independent.
          Reviewing many cells can exaggerate differences. Missing records and
          current profiles may bias comparisons. No cause or automatic outreach
          is inferred.
        </p>
      </details>
    </section>
  );
}
