import { useId, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  HeartHandshake,
  Info,
  Layers3,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type {
  Count,
  Dashboard,
  Filters,
  Programme,
  Stats,
  Trend,
} from "./types";

const fmt = (v: number) =>
  new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(v);
const colors: Record<string, string> = {
  unique: "#5551d9",
  allAges: "#5551d9",
  attendance: "#078579",
  male: "#097da1",
  minority: "#a44a97",
  firstObserved: "#8152c7",
  returning: "#b56d0a",
};

export function Sparkline({
  rows,
  metric,
}: {
  rows: Trend[];
  metric: keyof Stats;
}) {
  if (rows.length < 2) return null;
  const values = rows.map((r) => Number(r[metric]) || 0),
    max = Math.max(...values, 1);
  return (
    <svg className="sparkline" viewBox="0 0 110 28" aria-hidden="true">
      <polyline
        points={values
          .map(
            (v, i) =>
              `${(i * 110) / (values.length - 1)},${26 - (v / max) * 23}`,
          )
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function KpiDeck({ data }: { data: Dashboard }) {
  const items: {
    key: keyof Stats;
    title: string;
    note: string;
    icon: typeof Users;
    tone: string;
  }[] = [
    {
      key: "unique",
      title: "Unique seniors reached",
      note: `Distinct participants aged ${data.settings.seniorAge}+; each person counted once in this view.`,
      icon: Users,
      tone: "indigo",
    },
    {
      key: "attendance",
      title: "Attendance entries",
      note: "Deduplicated attendance across all ages. A person at two sessions contributes two entries.",
      icon: Activity,
      tone: "teal",
    },
    {
      key: "male",
      title: "Male seniors reached",
      note: `${data.summary.knownGender} seniors have known male/female gender. ${data.summary.malePct === null ? "Percentage unavailable." : fmt(data.summary.malePct) + "% are male."}`,
      icon: Users,
      tone: "cyan",
    },
    {
      key: "minority",
      title: "Minority seniors reached",
      note: `${data.summary.knownRace} seniors have known race. Configured groups: ${data.settings.minority.join(", ")}.`,
      icon: HeartHandshake,
      tone: "purple",
    },
    {
      key: "allAges",
      title: "Unique participants · all ages",
      note: "Different participant identifiers across all ages; includes those with missing age.",
      icon: Users,
      tone: "indigo",
    },
    {
      key: "programmes",
      title: "Active programmes",
      note: "Programmes with at least one attendance record in this filtered view. Not planned or cancelled sessions.",
      icon: Layers3,
      tone: "purple",
    },
    {
      key: "sessions",
      title: "Recorded sessions",
      note: "Distinct programme, date and time combinations with attendance. No cancellation status is supplied.",
      icon: CalendarDays,
      tone: "amber",
    },
    {
      key: "average",
      title: "Average attendance / session",
      note: "All-age attendance entries divided by distinct recorded sessions in this view.",
      icon: ChartNoAxesCombined,
      tone: "teal",
    },
  ];
  return (
    <div className="metric-grid">
      {items.map((item) => {
        const value = Number(data.summary[item.key]),
          prior = data.previous?.[item.key];
        const delta = typeof prior === "number" ? value - prior : null;
        return (
          <section
            className={`metric-card tone-${item.tone}`}
            key={item.key}
            aria-label={item.title}
          >
            <div className="metric-head">
              <span className="metric-icon">
                <item.icon size={19} />
              </span>
              <details className="metric-definition">
                <summary
                  aria-label={`How ${item.title.toLowerCase()} is calculated`}
                >
                  <Info size={16} />
                </summary>
                <p>{item.note}</p>
              </details>
            </div>
            <h2>{item.title}</h2>
            <div className="metric-value">
              {fmt(value)}
              <Sparkline rows={data.trends} metric={item.key} />
            </div>
            <div className="metric-comparison">
              {(item.key === "male" || item.key === "minority") && (
                <span className="metric-share">
                  {(item.key === "male"
                    ? data.summary.malePct
                    : data.summary.minorityPct) === null
                    ? "Share unavailable"
                    : `${fmt((item.key === "male" ? data.summary.malePct : data.summary.minorityPct)!)}% of known ${item.key === "male" ? "gender" : "race"}`}
                </span>
              )}
              {delta !== null && typeof prior === "number" ? (
                <>
                  <span
                    className={
                      delta < 0
                        ? "delta down"
                        : delta > 0
                          ? "delta up"
                          : "delta"
                    }
                  >
                    {delta < 0 ? (
                      <ArrowDownRight size={14} />
                    ) : (
                      <ArrowUpRight size={14} />
                    )}
                    {delta > 0 ? "+" : ""}
                    {fmt(delta)}
                    {prior > 0 &&
                      ` (${delta > 0 ? "+" : ""}${fmt((delta / prior) * 100)}%)`}
                  </span>
                  <span
                    title={`${data.previous!.from} to ${data.previous!.to}`}
                  >
                    vs previous period
                  </span>
                </>
              ) : (
                <span>Selected reporting period</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TrendChart({
  rows,
  metric = "unique",
}: {
  rows: Trend[];
  metric?:
    | "unique"
    | "male"
    | "minority"
    | "attendance"
    | "firstObserved"
    | "returning";
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null),
    [page, setPage] = useState(0);
  const id = useId().replaceAll(":", ""),
    color = colors[metric],
    max = Math.max(...rows.map((r) => r[metric]), 1);
  const w = 720,
    h = 245,
    left = 45,
    bottom = 205;
  const x = (i: number) =>
      left + (i / Math.max(rows.length - 1, 1)) * (w - left - 18),
    y = (n: number) => bottom - (n / max) * 172;
  const label =
    metric === "attendance"
      ? "attendance entries · all ages"
      : metric === "firstObserved"
        ? "seniors first recorded in this period"
        : metric === "returning"
          ? "seniors recorded before this period"
          : "unique seniors";
  if (rows.length < 2)
    return (
      <div className="chart-empty">
        <ChartNoAxesCombined size={30} />
        <strong>Not enough historical data to show a meaningful trend.</strong>
        <span>
          {rows.length
            ? `${fmt(rows[0][metric])} ${label} in the only observed period.`
            : "Import attendance or widen the date range."}
        </span>
      </div>
    );
  if (rows.length > 180)
    return (
      <div className="chart-empty">
        <CalendarDays size={30} />
        <strong>Choose a shorter range for this level of detail.</strong>
        <span>
          Use weekly or monthly periods, or a daily range of up to 180 days.
        </span>
      </div>
    );
  const points = rows.map((r, i) => `${x(i)},${y(r[metric])}`).join(" ");
  const active =
    activeIndex === null ? null : rows[Math.min(activeIndex, rows.length - 1)];
  // Keep the selected value and useful landmarks visible without overlapping
  // neighbouring labels, including at the larger mobile label size.
  const labelled = new Set<number>();
  const boxes: { left: number; right: number; top: number; bottom: number }[] =
    [];
  const values = rows.map((r) => r[metric]);
  const candidates = [
    ...new Set([
      ...(activeIndex === null ? [] : [Math.min(activeIndex, rows.length - 1)]),
      0,
      rows.length - 1,
      values.indexOf(Math.max(...values)),
      values.indexOf(Math.min(...values)),
      ...Array.from({ length: 8 }, (_, i) =>
        Math.round((i * (rows.length - 1)) / 7),
      ),
      ...rows.map((_, i) => i),
    ]),
  ];
  for (const i of candidates) {
    if (labelled.size >= 8) break;
    const width = fmt(rows[i][metric]).length * 14 + 12;
    const leftEdge =
      i === 0 ? x(i) : i === rows.length - 1 ? x(i) - width : x(i) - width / 2;
    const box = {
      left: leftEdge,
      right: leftEdge + width,
      top: y(rows[i][metric]) - 38,
      bottom: y(rows[i][metric]) - 8,
    };
    if (
      boxes.some(
        (other) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top,
      )
    )
      continue;
    boxes.push(box);
    labelled.add(i);
  }
  const tablePage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 30) - 1),
  );
  return (
    <div className="line-chart modern-chart">
      <div className="chart-legend">
        <span style={{ color }}>
          <i style={{ background: color }} />
          {label}
        </span>
        <small>Hollow point = period in progress</small>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${metric} participation over time. Exact figures are available in the table below.`}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".18" />
            <stop offset="100%" stopColor={color} stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={w - 18}
              y1={y(max * v)}
              y2={y(max * v)}
              stroke="#e7eaf2"
            />
            <text
              x={left - 9}
              y={y(max * v) + 4}
              textAnchor="end"
              className="axis"
            >
              {fmt(max * v)}
            </text>
          </g>
        ))}
        <polygon
          points={`${x(0)},${bottom} ${points} ${x(rows.length - 1)},${bottom}`}
          fill={`url(#${id})`}
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2.7"
          strokeLinejoin="round"
        />
        {rows.map((r, i) => (
          <g key={r.label}>
            {labelled.has(i) && (
              <text
                x={x(i)}
                y={y(r[metric]) - 13}
                textAnchor={
                  i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"
                }
                className="point-label"
                fill={color}
                aria-hidden="true"
              >
                {fmt(r[metric])}
              </text>
            )}
            <circle
              cx={x(i)}
              cy={y(r[metric])}
              r={activeIndex === i ? 6 : 3.5}
              fill={r.partial ? "white" : color}
              stroke={color}
              strokeWidth="2"
            />
            <circle
              cx={x(i)}
              cy={y(r[metric])}
              r="13"
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={`${r.label}: ${fmt(r[metric])} ${label}${r.partial ? ", period in progress" : ""}`}
              onFocus={() => setActiveIndex(i)}
              onPointerEnter={() => setActiveIndex(i)}
              onClick={() => setActiveIndex(i)}
              onKeyDown={(e) => {
                if (["Enter", " "].includes(e.key)) {
                  e.preventDefault();
                  setActiveIndex(i);
                }
              }}
            />
            {(i % Math.ceil(rows.length / 5) === 0 ||
              i === rows.length - 1) && (
              <text
                x={x(i)}
                y={233}
                textAnchor={
                  i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"
                }
                className="axis"
              >
                {r.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-readout" aria-live="polite">
        {active
          ? `${active.label} · ${fmt(active[metric])} ${label}${active.partial ? " · period in progress" : ""}`
          : "Hover or focus a point to explore the exact count."}
      </div>
      <label className="chart-point-picker">
        <span>Explore a period</span>
        <select
          aria-label="Explore chart period"
          value={activeIndex ?? ""}
          onChange={(e) =>
            setActiveIndex(
              e.target.value === "" ? null : Number(e.target.value),
            )
          }
        >
          <option value="">Choose a period</option>
          {rows.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}: {fmt(r[metric])}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>View chart figures</summary>
        <div className="trend-table">
          {rows.slice(tablePage * 30, tablePage * 30 + 30).map((r) => (
            <div key={r.label}>
              <span>
                {r.label}
                {r.partial ? " · in progress" : ""}
              </span>
              <strong>{fmt(r[metric])}</strong>
            </div>
          ))}
        </div>
        {rows.length > 30 && (
          <div className="table-pages">
            <button
              disabled={!tablePage}
              onClick={() => setPage(tablePage - 1)}
            >
              Previous
            </button>
            <span>
              Page {tablePage + 1} of {Math.ceil(rows.length / 30)}
            </span>
            <button
              disabled={(tablePage + 1) * 30 >= rows.length}
              onClick={() => setPage(tablePage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </details>
    </div>
  );
}

export function InsightCards({
  data,
  onProgramme,
}: {
  data: Dashboard;
  onProgramme: (p: Programme) => void;
}) {
  const icons = {
    positive: ChartNoAxesCombined,
    attention: Activity,
    opportunity: Lightbulb,
    pattern: Sparkles,
    quality: ShieldCheck,
  };
  return (
    <section className="insights-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FROM NUMBERS TO NEXT STEPS</span>
          <h2>Key Insights and Observations</h2>
        </div>
        <span className="badge soft">Sample sizes checked</span>
      </div>
      <div className="insight-grid">
        {data.insights.map((insight) => {
          const Icon = icons[insight.category],
            programme = data.programmes.find(
              (p) => p.id === insight.programmeId,
            );
          return (
            <article
              className={`insight-card insight-${insight.category}`}
              key={insight.title}
            >
              <div className="insight-label">
                <Icon size={17} />
                {insight.category === "quality"
                  ? "Data quality"
                  : insight.category === "attention"
                    ? "Worth a closer look"
                    : insight.category === "opportunity"
                      ? "Programme opportunity"
                      : insight.category === "positive"
                        ? "Positive trend"
                        : "Participation pattern"}
              </div>
              <h3>{insight.title}</h3>
              <strong className="insight-statistic">{insight.statistic}</strong>
              <p>{insight.explanation}</p>
              <div className="suggestion">
                <strong>Suggested next step</strong>
                <p>{insight.action}</p>
              </div>
              {programme && (
                <button
                  className="text-button"
                  onClick={() => onProgramme(programme)}
                >
                  View programme
                  <ArrowRight size={15} />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function Portfolio({
  data,
  onDomain,
}: {
  data: Dashboard;
  onDomain: (domain: string) => void;
}) {
  return (
    <section className="panel portfolio">
      <div className="panel-head">
        <div>
          <h2>Your programme portfolio</h2>
          <p className="muted">
            Where delivery is concentrated · select a domain to explore it
          </p>
        </div>
        <span className="metric-icon">
          <Layers3 size={20} />
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">
            Programme delivery and overlapping senior reach by AAP domain
          </caption>
          <thead>
            <tr>
              <th scope="col">AAP domain</th>
              <th scope="col">Programmes</th>
              <th scope="col">Sessions</th>
              <th scope="col">Attendance share</th>
              <th scope="col">Unique seniors</th>
              <th scope="col">Male / minority seniors</th>
            </tr>
          </thead>
          <tbody>
            {[...data.domains]
              .sort((a, b) => b.attendance - a.attendance)
              .map((d) => (
                <tr key={d.label}>
                  <th scope="row">
                    <button
                      className="domain-link"
                      onClick={() => onDomain(d.label)}
                    >
                      {d.label}
                      <ArrowRight size={14} />
                    </button>
                  </th>
                  <td>{fmt(d.programmes)}</td>
                  <td>{fmt(d.sessions)}</td>
                  <td>
                    <div className="share-cell">
                      <span>
                        {fmt(
                          data.summary.attendance
                            ? (d.attendance / data.summary.attendance) * 100
                            : 0,
                        )}
                        %
                      </span>
                      <progress
                        value={d.attendance}
                        max={Math.max(data.summary.attendance, 1)}
                        aria-label={`${d.label} share of attendance`}
                      />
                    </div>
                  </td>
                  <td>{fmt(d.unique)}</td>
                  <td>
                    {fmt(d.male)} / {fmt(d.minority)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Attendance share uses all-age entries. Senior reach overlaps across
        domains and must not be summed.
      </p>
    </section>
  );
}

export function DemographicBars({
  items,
  denominator,
  onSelect,
}: {
  items: Count[];
  denominator: number;
  onSelect?: (label: string) => void;
}) {
  const [percentage, setPercentage] = useState(false);
  if (!denominator || !items.length)
    return (
      <div className="chart-empty">
        Demographic information is not available for this reporting period.
      </div>
    );
  return (
    <>
      <div className="composition-control">
        <span>Unique seniors · including unknown values</span>
        <button
          className="text-button"
          aria-pressed={percentage}
          onClick={() => setPercentage(!percentage)}
        >
          {percentage ? "Show counts" : "Show percentages"}
        </button>
      </div>
      <div className="composition-bars">
        {[...items]
          .sort((a, b) => b.value - a.value)
          .map((item, i) => (
            <div className="composition-row" key={item.label}>
              <div>
                {onSelect ? (
                  <button
                    onClick={() => onSelect(item.label)}
                    className="domain-link"
                    aria-label={`Filter ${item.label}`}
                  >
                    {item.label}
                    <ArrowRight size={13} />
                  </button>
                ) : (
                  <span>{item.label}</span>
                )}
                <strong>
                  {percentage
                    ? `${fmt((item.value / denominator) * 100)}%`
                    : fmt(item.value)}
                  <small>
                    {percentage
                      ? `${fmt(item.value)} seniors`
                      : `${fmt((item.value / denominator) * 100)}%`}
                  </small>
                </strong>
              </div>
              <div className="bar-track">
                <div
                  className={`bar-fill composition-${i % 5}`}
                  style={{ width: `${(item.value / denominator) * 100}%` }}
                />
              </div>
            </div>
          ))}
      </div>
      <small className="composition-denominator">
        Percentages use all {fmt(denominator)} seniors in this view, including
        missing/unknown values.
      </small>
    </>
  );
}

export function TimingMatrix({ data }: { data: Dashboard }) {
  const eligible = data.timing.filter(
    (t) =>
      t.sessions >= data.settings.minSessions &&
      t.unique >= data.settings.minParticipants,
  );
  if (eligible.length < 2)
    return (
      <div className="chart-empty">
        <CalendarDays size={28} />
        <strong>Not enough comparable time slots yet.</strong>
        <span>
          At least {data.settings.minSessions} recorded sessions and{" "}
          {data.settings.minParticipants} seniors in each of two time slots are
          needed for a timing comparison.
        </span>
      </div>
    );
  const max = Math.max(...eligible.map((t) => t.average), 1);
  return (
    <div className="table-scroll">
      <table className="timing-matrix">
        <caption>Average all-age attendance per recorded session</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {["Morning", "Afternoon", "Evening"].map((t) => (
              <th scope="col" key={t}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ].map((day) => (
            <tr key={day}>
              <th scope="row">{day}</th>
              {["Morning", "Afternoon", "Evening"].map((slot) => {
                const cell = data.timing.find(
                    (t) => t.label === `${day} · ${slot}`,
                  ),
                  enough = cell && eligible.includes(cell);
                return (
                  <td key={slot}>
                    <div
                      className={
                        enough ? "heat-cell" : "heat-cell heat-limited"
                      }
                      style={
                        enough
                          ? {
                              background: `rgba(85,81,217,${0.08 + (cell.average / max) * 0.45})`,
                              color:
                                cell.average / max > 0.6 ? "#fff" : "#312e81",
                            }
                          : {}
                      }
                      title={
                        cell
                          ? `${cell.sessions} sessions; ${cell.unique} distinct seniors; ${cell.attendance} attendance entries${enough ? "" : "; insufficient observations for comparison"}`
                          : "No recorded sessions in this time slot"
                      }
                    >
                      {cell ? (
                        <>
                          <strong>
                            {enough ? fmt(cell.average) : "Limited"}
                          </strong>
                          <small>{cell.sessions} sessions</small>
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        Darker cells show higher averages only where the sample threshold is
        met. Limited cells are not ranked. Programme mix and frequency differ;
        timing is not a proven cause.
      </p>
    </div>
  );
}

export function ActiveFilters({
  filters,
  data,
  setFilters,
}: {
  filters: Filters;
  data: Dashboard | null;
  setFilters: (f: Filters) => void;
}) {
  const keys = [
    "domain",
    "programme",
    "target",
    "gender",
    "race",
    "client",
    "boundary",
    "ageBand",
    "cfs",
    "weekday",
    "timeSlot",
    "observed",
  ] as const;
  const names = {
    domain: "Domain",
    programme: "Programme",
    target: "Audience",
    gender: "Gender",
    race: "Race",
    client: "Client",
    boundary: "Boundary",
    ageBand: "Age",
    cfs: "CFS",
    weekday: "Day",
    timeSlot: "Time slot",
    observed: "Observed history",
  };
  const labels: Record<string, Record<string, string>> = {
    client: {
      true: "Existing client",
      false: "Other attendee",
      null: "Unknown",
    },
    boundary: {
      true: "Within boundary",
      false: "Outside boundary",
      null: "Unknown",
    },
    target: { male: "Male seniors", minority: "Minority seniors" },
  };
  return (
    <div className="active-filters">
      {keys
        .filter((k) => filters[k] && !(k === "target" && filters[k] === "all"))
        .map((k) => (
          <button
            key={k}
            onClick={() =>
              setFilters({ ...filters, [k]: k === "target" ? "all" : "" })
            }
            aria-label={`Remove ${names[k].toLowerCase()} filter`}
          >
            {names[k]}:{" "}
            {k === "programme"
              ? data?.options.programmes.find((p) => p.id === filters[k])
                  ?.name || "Selected programme"
              : labels[k]?.[filters[k] || ""] || filters[k]}{" "}
            <span aria-hidden="true">×</span>
          </button>
        ))}
    </div>
  );
}
