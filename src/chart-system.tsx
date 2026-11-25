import { downloadRankingChart } from "./chart-download";
import { currentCentre } from "./api";
import { useChartMode } from "./display-settings";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";
import "./chart-system.css";
export const chartColours = {
  reach: "var(--chart-reach, #2563eb)",
  attendance: "var(--chart-attendance, #0f766e)",
  demographic: "var(--chart-demographic, #6d5ae6)",
  review: "#b45309",
  unknown: "#94a3b8",
};
const numberFormat = new Intl.NumberFormat("en-SG", {
  maximumFractionDigits: 1,
});
export const chartNumber = (value: number | null | undefined, suffix = "") =>
  value == null ? "Unavailable" : numberFormat.format(value) + suffix;
export function useChartWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth((old) => (old === next ? old : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function ChartHeader({
  title,
  description,
  toolbar,
}: {
  title: string;
  description?: string;
  toolbar?: ReactNode;
}) {
  return (
    <header className="chart-header">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {toolbar && <div className="chart-toolbar">{toolbar}</div>}
    </header>
  );
}
export function ChartCard({
  title,
  description,
  toolbar,
  children,
  footnote,
  className = "",
}: {
  title: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel analytics-card " + className}>
      <ChartHeader title={title} description={description} toolbar={toolbar} />
      <div className="chart-body">{children}</div>
      {footnote && <footer className="chart-footnote">{footnote}</footer>}
    </section>
  );
}
export function EmptyChartState({
  title = "No recorded values in this view.",
  detail = "Widen the reporting period or review the selected filters.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="chart-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function ChartLoadingState() {
  return (
    <div className="chart-skeleton" role="status" aria-label="Loading chart">
      <i />
      <i />
      <i />
      <span className="sr-only">Loading chart</span>
    </div>
  );
}
export function MetricCard({
  label,
  value,
  note,
  definition,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  definition?: string;
}) {
  return (
    <article className="metric-tile">
      <div className="metric-tile-label">
        {label}
        {definition && (
          <details className="metric-definition">
            <summary aria-label={"About " + label}>i</summary>
            <p>{definition}</p>
          </details>
        )}
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}
export type RankingRow = {
  label: string;
  value: number | null;
  detail?: string;
  displayValue?: string;
  colour?: string;
};
export function HorizontalRankingChart({
  rows,
  maxValue,
  limit = 5,
  unit = "",
  tone = "reach",
  onSelect,
  label = "Category comparison",
  denominator,
  chartId,
  context,
  hideOverride = false,
  allowChartActions = true,
  allowDownload = false,
}: {
  rows: RankingRow[];
  maxValue?: number;
  limit?: number;
  unit?: string;
  tone?: keyof typeof chartColours;
  onSelect?: (label: string) => void;
  label?: string;
  denominator?: number | null;
  chartId?: string;
  context?: string;
  hideOverride?: boolean;
  allowChartActions?: boolean;
  allowDownload?: boolean;
}) {
  const [mode, override, setOverride] = useChartMode(chartId);
  const percentage = denominator !== undefined && mode === "percentage";
  const chartRows = percentage
    ? rows.map((row) => ({
        ...row,
        detail: undefined,
        displayValue: undefined,
        value:
          row.value != null && denominator != null && denominator > 0
            ? (row.value / denominator) * 100
            : null,
      }))
    : rows;
  if (percentage) {
    unit = "%";
    maxValue = 100;
  }
  const [zoom, setZoom] = useState(false);
  const [table, setTable] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (zoom && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [zoom]);
  const [downloadError, setDownloadError] = useState("");
  const exportChart = (format: "png" | "svg") => {
    setDownloadError("");
    void downloadRankingChart(
      [currentCentre()?.name, label, context].filter(Boolean).join(" / "),
      expanded ? chartRows : chartRows.slice(0, limit),
      unit,
      denominator,
      format,
    ).catch(() =>
      setDownloadError("This browser could not create the chart image."),
    );
  };
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const numbers = chartRows.flatMap((r) => (r.value == null ? [] : [r.value])),
    min = Math.min(0, ...numbers),
    max = Math.max(maxValue || 1, ...numbers),
    range = max - min,
    zero = (-min / range) * 100;
  if (!rows.length) return <EmptyChartState />;
  const content = (suffix = "") => (
    <div
      className={"horizontal-ranking report-bars tone-" + tone}
      role="group"
      aria-label={label}
    >
      {denominator !== undefined && chartId && !hideOverride && (
        <label className="chart-mode">
          Values{" "}
          <select
            aria-label={label + " display"}
            value={override}
            onChange={(e) => setOverride(e.target.value)}
          >
            <option value="default">Use dashboard setting</option>
            <option value="number">Number</option>
            <option value="percentage">Percentage</option>
          </select>
        </label>
      )}
      {percentage && (
        <p className="chart-denominator">
          {denominator != null && denominator > 0
            ? "Share of the overall " +
              chartNumber(denominator) +
              " in this selection."
            : "Percentage unavailable for this selection."}
        </p>
      )}
      <div className="ranking-axis" aria-hidden="true">
        <span>{chartNumber(min, unit)}</span>
        <span>{chartNumber(max, unit)}</span>
      </div>
      <div
        className={"ranking-rows" + (!expanded ? " ranking-limited" : "")}
        style={{ "--ranking-visible": limit } as CSSProperties}
      >
        {chartRows.map((r, i) => (
          <div
            className={
              "ranking-row" + (i >= limit && !expanded ? " ranking-extra" : "")
            }
            key={r.label}
          >
            <div className="ranking-row-heading">
              {onSelect ? (
                <button
                  className="ranking-label"
                  onClick={() => onSelect(r.label)}
                  title={r.label}
                >
                  {r.label}
                </button>
              ) : (
                <span title={r.label}>{r.label}</span>
              )}
              <strong>{r.displayValue ?? chartNumber(r.value, unit)}</strong>
            </div>
            <div
              className={
                "ranking-track" + (r.value == null ? " unavailable" : "")
              }
              role="img"
              tabIndex={0}
              aria-label={
                r.label +
                ": " +
                (r.displayValue ?? chartNumber(r.value, unit)) +
                (r.detail ? ". " + r.detail : "")
              }
              aria-describedby={id + suffix + "-" + i}
            >
              {r.value != null && (
                <i
                  style={{
                    backgroundColor: r.colour,
                    left: Math.min(zero, ((r.value - min) / range) * 100) + "%",
                    width: (Math.abs(r.value) / range) * 100 + "%",
                  }}
                />
              )}
              {min < 0 && (
                <b className="ranking-zero" style={{ left: zero + "%" }} />
              )}
              <span
                className="chart-tooltip"
                id={id + suffix + "-" + i}
                role="tooltip"
              >
                {r.label}: {r.displayValue ?? chartNumber(r.value, unit)}
                {r.detail && <small>{r.detail}</small>}
              </span>
            </div>
          </div>
        ))}
      </div>
      {rows.length > limit && (
        <button
          className="ranking-expand text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer categories"
            : `View all ${rows.length} categories`}
        </button>
      )}
    </div>
  );
  return (
    <>
      {allowChartActions && (
        <div className="chart-actions">
          <button className="text-button" onClick={() => setZoom(true)}>
            Expand chart
          </button>
          {allowDownload && (
            <button className="text-button" onClick={() => exportChart("png")}>
              Download chart
            </button>
          )}
        </div>
      )}
      {content()}
      {!zoom && downloadError && <p role="alert">{downloadError}</p>}
      {zoom && (
        <dialog
          ref={dialog}
          className="expanded-dashboard-chart"
          aria-label={label}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setZoom(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
        >
          <header>
            <h2>{label}</h2>
            <p>
              {[currentCentre()?.name, context].filter(Boolean).join(" / ")}
            </p>
            <div className="work-actions">
              <button
                autoFocus
                className="button"
                onClick={() => setZoom(false)}
              >
                Close chart
              </button>
              <button className="button" onClick={() => setTable(!table)}>
                {table ? "Show chart" : "Show table"}
              </button>
              {allowDownload && (
                <button className="button" onClick={() => exportChart("svg")}>
                  Download SVG
                </button>
              )}
              {allowDownload && (
                <button className="button" onClick={() => exportChart("png")}>
                  Download PNG
                </button>
              )}
            </div>
          </header>
          {downloadError && <p role="alert">{downloadError}</p>}
          {table ? (
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {chartRows.map((row) => (
                    <tr key={row.label}>
                      <th>{row.label}</th>
                      <td>
                        {row.displayValue ?? chartNumber(row.value, unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            content("-expanded")
          )}
        </dialog>
      )}
    </>
  );
}
export function CompactTrend({
  rows,
  title,
}: {
  rows: { label: string; value: number | null }[];
  title: string;
}) {
  const { ref, width } = useChartWidth(600);
  const [active, setActive] = useState<number | null>(null);
  const w = Math.max(260, width),
    h = 220,
    left = 42,
    right = w - 18,
    bottom = 176,
    maximum = Math.max(
      1,
      ...rows.flatMap((r) => (r.value == null ? [] : [r.value])),
    );
  const x = (i: number) =>
      left + (i * (right - left)) / Math.max(1, rows.length - 1),
    y = (n: number) => bottom - (n / maximum) * 142;
  const paths: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value == null) {
      paths.push([]);
      continue;
    }
    if (!paths.length) paths.push([]);
    paths.at(-1)!.push(`${x(i)},${y(rows[i].value!)}`);
  }
  return (
    <div className="compact-trend" ref={ref}>
      {rows.length === 1 ? (
        <div
          role="img"
          aria-label={
            title + ": " + rows[0].label + ", " + chartNumber(rows[0].value)
          }
        >
          <HorizontalRankingChart rows={rows} label={title} />
          <p className="table-note">
            One recorded period; a trend cannot be inferred.
          </p>
        </div>
      ) : rows.length < 2 ? (
        <EmptyChartState
          title="Not enough history for a trend."
          detail={
            rows.length === 1
              ? rows[0].label + ": " + chartNumber(rows[0].value)
              : "Choose a period with at least two observations."
          }
        />
      ) : (
        <>
          <svg
            viewBox={`0 0 ${w} ${h}`}
            role="img"
            aria-label={
              title +
              ". Missing observations remain gaps. Exact values are available below."
            }
          >
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(maximum * v)}
                  y2={y(maximum * v)}
                  className="chart-gridline"
                />
                <text
                  x={left - 8}
                  y={y(maximum * v) + 4}
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {new Intl.NumberFormat("en-SG", {
                    notation: maximum > 9999 ? "compact" : "standard",
                    maximumFractionDigits: 1,
                  }).format(maximum * v)}
                </text>
              </g>
            ))}
            {paths
              .filter((p) => p.length > 1)
              .map((p, i) => (
                <polyline
                  key={i}
                  points={p.join(" ")}
                  fill="none"
                  stroke={chartColours.attendance}
                  strokeWidth="2.5"
                />
              ))}
            {rows.map((r, i) =>
              r.value == null ? null : (
                <g key={r.label}>
                  <circle
                    cx={x(i)}
                    cy={y(r.value)}
                    r={active === i ? 5 : 3.5}
                    fill={chartColours.attendance}
                    tabIndex={0}
                    aria-label={r.label + ": " + chartNumber(r.value)}
                    onFocus={() => setActive(i)}
                    onPointerEnter={() => setActive(i)}
                  >
                    <title>
                      {r.label}: {chartNumber(r.value)}
                    </title>
                  </circle>
                  {(i === 0 ||
                    i === rows.length - 1 ||
                    i %
                      Math.max(
                        1,
                        Math.ceil(rows.length / (w < 480 ? 3 : 6)),
                      ) ===
                      0) && (
                    <text
                      x={x(i)}
                      y={201}
                      textAnchor={
                        i === 0
                          ? "start"
                          : i === rows.length - 1
                            ? "end"
                            : "middle"
                      }
                      className="chart-axis-label"
                    >
                      {r.label}
                    </text>
                  )}
                </g>
              ),
            )}
          </svg>
          <p className="chart-readout" aria-live="polite">
            {active == null
              ? "Focus or hover a point to inspect its value."
              : rows[active]?.label + ": " + chartNumber(rows[active]?.value)}
          </p>
          <details className="chart-methodology">
            <summary>View exact trend values</summary>
            <div className="work-table">
              <table>
                <caption>{title}</caption>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      <td>{chartNumber(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
