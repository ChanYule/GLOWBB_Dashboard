import {centreUrl} from "./api";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Download,
  HeartPulse,
  Info,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Target,
  Upload,
} from "lucide-react";
import { api } from "./api";
import type { Dashboard, Filters, Programme, User } from "./types";
import type {
  AssessmentPreview,
  OperationalRow,
  OperationsReport,
} from "./operations-types";
import "./operations.css";

const number = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(v);
const percent = (v: number | null | undefined) =>
  v == null ? "Share unavailable" : `${number(v)}% of unique participants`;
const metrics: Record<string, string> = {
  unique: "Unique participants",
  male: "Male participants",
  ib: "IB clients",
  ob: "OB non-clients",
  firstObserved: "First observed participants",
  sppb: "SPPB assessments",
  tanita: "Tanita assessments",
};
type Series = {
  key: keyof OperationalRow;
  label: string;
  color: string;
  percentKey?: "ibPct" | "obPct" | "malePct";
};

export function OperationalChart({
  title,
  rows,
  series,
  mode = "line",
  periodLabel = "months",
}: {
  title: string;
  rows: Partial<OperationalRow>[];
  series: Series[];
  mode?: "line" | "grouped" | "stacked";
  periodLabel?: "days" | "months";
}) {
  const selected = rows.slice(-6),
    values = selected.flatMap((r) =>
      series.map((s) =>
        typeof r[s.key] === "number" ? Number(r[s.key]) : null,
      ),
    );
  if (selected.length < 2 || values.every((v) => v === null))
    return (
      <div className="chart-empty">
        <CalendarDays size={28} />
        <strong>
          {values.every((v) => v === null)
            ? "No comparable records are available."
            : `Not enough ${periodLabel === "days" ? "daily" : "monthly"} history for a trend.`}
        </strong>
        <span>
          Reported zeros are shown as zero; unavailable records are not filled
          in.
        </span>
      </div>
    );
  const max = Math.max(
    1,
    ...selected.map((r) =>
      mode === "stacked"
        ? series.reduce((n, s) => n + (Number(r[s.key]) || 0), 0)
        : Math.max(...series.map((s) => Number(r[s.key]) || 0)),
    ),
  );
  const x = (i: number) => 62 + i * 92,
    y = (v: number) => 188 - (v / max) * 135;
  return (
    <>
      <div className="ops-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="ops-chart-scroll">
        <svg
          viewBox="0 0 600 235"
          role="img"
          aria-label={title}
          className="ops-chart"
        >
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line
                x1="35"
                x2="585"
                y1={y(v * max)}
                y2={y(v * max)}
                stroke="#e6eaf3"
              />
              <text
                x="29"
                y={y(v * max) + 4}
                textAnchor="end"
                className="ops-axis"
              >
                {number(v * max)}
              </text>
            </g>
          ))}
          {mode === "line" &&
            series.map((s, si) => (
              <g key={s.key}>
                <polyline
                  points={selected
                    .map((r, i) => `${x(i)},${y(Number(r[s.key]))}`)
                    .join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.5"
                />
                {selected.map((r, i) => (
                  <g key={i}>
                    <circle
                      cx={x(i)}
                      cy={y(Number(r[s.key]))}
                      r="4"
                      fill={s.color}
                      tabIndex={0}
                      aria-label={`${r.label}: ${s.label} ${number(Number(r[s.key]))}${s.percentKey ? `, ${percent(r[s.percentKey])}` : ""}`}
                    >
                      <title>
                        {r.label}: {s.label} {number(Number(r[s.key]))}
                        {s.percentKey ? ` (${percent(r[s.percentKey])})` : ""}
                      </title>
                    </circle>
                    <text
                      x={x(i)}
                      y={y(Number(r[s.key])) + (si ? 22 : -12)}
                      textAnchor="middle"
                      fill={s.color}
                      className="ops-value"
                    >
                      {number(Number(r[s.key]))}
                    </text>
                  </g>
                ))}
              </g>
            ))}
          {mode !== "line" &&
            selected.map((r, i) => {
              let height = 0;
              return (
                <g key={i}>
                  {series.map((s, si) => {
                    const raw = r[s.key],
                      missing = raw === null || raw === undefined,
                      value = Number(raw) || 0,
                      top = mode === "stacked" ? y(height + value) : y(value),
                      barHeight = (value / max) * 135;
                    const xPos =
                      mode === "stacked" ? x(i) - 21 : x(i) - 32 + si * 34;
                    height += value;
                    return (
                      <g key={s.key}>
                        <rect
                          x={xPos}
                          y={missing ? 178 : top}
                          width={mode === "stacked" ? 42 : 29}
                          height={missing ? 10 : Math.max(1, barHeight)}
                          rx="3"
                          fill={missing ? "#e7e9f0" : s.color}
                        >
                          <title>
                            {r.label}: {s.label}:{" "}
                            {missing ? "Unavailable" : number(value)}
                          </title>
                        </rect>
                        <text
                          x={xPos + (mode === "stacked" ? 21 : 14.5)}
                          y={
                            mode === "stacked" && barHeight > 22
                              ? top + barHeight / 2 + 4
                              : top - 8 - (mode === "stacked" ? si * 12 : 0)
                          }
                          textAnchor="middle"
                          className="ops-value"
                          fill={
                            mode === "stacked" && barHeight > 22
                              ? "white"
                              : s.color
                          }
                        >
                          {missing ? "—" : number(value)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          {selected.map((r, i) => (
            <text
              key={i}
              x={x(i)}
              y="218"
              textAnchor="middle"
              className="ops-axis"
            >
              {r.label}
            </text>
          ))}
        </svg>
      </div>
      <p className="table-note">
        Latest six selected {periodLabel}. Values are available below; people
        are deduplicated separately in each{" "}
        {periodLabel === "days" ? "day" : "month"}.
      </p>
      <details>
        <summary>View graph values</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Month</th>
                {series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {series.map((s) => (
                    <td key={s.key}>
                      {number(r[s.key] as number | null)}
                      {s.percentKey && (
                        <small className="ops-muted">
                          {percent(r[s.percentKey])}
                        </small>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Card({
  title,
  value,
  note,
  tone = "indigo",
}: {
  title: string;
  value: number | null;
  note: string;
  tone?: string;
}) {
  return (
    <section className={`metric-card tone-${tone}`}>
      <div className="metric-head">
        <span className="metric-icon">
          <Activity size={19} />
        </span>
        <span title={note}>
          <Info size={15} />
        </span>
      </div>
      <h3>{title}</h3>
      <strong className={value === null ? "ops-unavailable" : "metric-value"}>
        {number(value)}
      </strong>
      <p className="ops-muted">{note}</p>
    </section>
  );
}
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ActivityScreening({ report }: { report: OperationsReport }) {
  const [interval, setInterval] = useState<"day" | "month">("month"),
    [page, setPage] = useState(0);
  const source = report.activityScreening,
    rows = interval === "day" ? source.daily : source.monthly;
  const pageIndex = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 25) - 1),
  );
  return (
    <>
      <div className="callout">
        <HeartPulse size={28} />
        <div>
          <h2>Screening activity participation</h2>
          <p>
            Distinct people recorded in the two screening activities. Client and
            non-client attendance is combined; reporting dates and active
            filters apply.
          </p>
        </div>
      </div>
      <div className="ops-screening-cards">
        {(["sppb", "tanita"] as const).map((type) => (
          <section key={type} className={`panel screening-${type}`}>
            <div className="screening-title">
              <span className="metric-icon">
                {type === "sppb" ? (
                  <Activity size={23} />
                ) : (
                  <HeartPulse size={23} />
                )}
              </span>
              <h2>
                {type === "sppb" ? "SPPB participants" : "Tanita participants"}
              </h2>
            </div>
            <strong className="screening-total">
              {number(source[type].people)}
            </strong>
            <p>Unique people in the selected reporting period</p>
            <p className="table-note">Activity: {source.activityNames[type]}</p>
            <small className="ops-muted">
              {number(source[type].attendance)} attendance entries. Repeat
              visits do not increase the unique-person total.
            </small>
          </section>
        ))}
      </div>
      <Panel
        title="People attending screenings"
        subtitle="Count each person once per activity per day or month; monthly people are not the sum of daily people."
      >
        <div className="ops-toolbar">
          <label className="field">
            <span>Screening interval</span>
            <select
              value={interval}
              onChange={(e) => {
                setInterval(e.target.value as "day" | "month");
                setPage(0);
              }}
            >
              <option value="day">Daily</option>
              <option value="month">Monthly</option>
            </select>
          </label>
        </div>
        <OperationalChart
          title={`${interval === "day" ? "Daily" : "Monthly"} unique SPPB and Tanita participants`}
          rows={rows}
          mode="grouped"
          periodLabel={interval === "day" ? "days" : "months"}
          series={[
            { key: "sppbPeople", label: "SPPB people", color: "#8061bf" },
            { key: "tanitaPeople", label: "Tanita people", color: "#12918b" },
          ]}
        />
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              Screening activity unique people by {interval}
            </caption>
            <thead>
              <tr>
                <th scope="col">{interval === "day" ? "Date" : "Month"}</th>
                <th scope="col">SPPB people</th>
                <th scope="col">Tanita people</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(pageIndex * 25, pageIndex * 25 + 25).map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.sppbPeople}</td>
                  <td>{r.tanitaPeople}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="chart-empty">
            No screening activity attendance matches this view.
          </p>
        )}
        {rows.length > 25 && (
          <div className="table-pages">
            <button
              disabled={!pageIndex}
              onClick={() => setPage(pageIndex - 1)}
            >
              Previous
            </button>
            <span>
              Page {pageIndex + 1} of {Math.ceil(rows.length / 25)}
            </span>
            <button
              disabled={(pageIndex + 1) * 25 >= rows.length}
              onClick={() => setPage(pageIndex + 1)}
            >
              Next
            </button>
          </div>
        )}
        <p className="table-note">
          Daily rows list dates with recorded screening activity. Monthly rows
          include selected months with no matching records as zero. These
          figures track recorded participation, not clinical results or verified
          test completion. Manually reported monthly assessment totals are
          separate and are never added to these people counts.
        </p>
      </Panel>
    </>
  );
}

export function OperationsPage({
  filters,
  data,
  user,
  onProgramme,
}: {
  filters: Filters;
  data: Dashboard;
  user: User;
  onProgramme: (p: Programme) => void;
}) {
  const [report, setReport] = useState<OperationsReport | null>(null),
    [view, setView] = useState("summary"),
    [screeningSource, setScreeningSource] = useState("attendance"),
    [grain, setGrain] = useState("month"),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [entryOpen, setEntryOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [targetOpen, setTargetOpen] = useState(false),
    [preview, setPreview] = useState<AssessmentPreview | null>(null),
    [revise, setRevise] = useState(false),
    [page, setPage] = useState(0);
  const query = new URLSearchParams({ ...filters, grain }).toString();
  useEffect(() => {
    let live = true;
    setLoading(true);
    api<OperationsReport>("/api/operations?" + query)
      .then((result) => {
        if (live) {
          setReport(result);
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setReport(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [query, revision]);
  async function mutate(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(url, { method, body: JSON.stringify(body) });
      setRevision((n) => n + 1);
      setNotice("Saved. Operational figures have been refreshed.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function importPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget),
        file = form.get("file");
      if (file && typeof file !== "string" && file.size >= 4 * 1024 * 1024)
        throw Error("Choose a monthly report smaller than 4 MB.");
      setPreview(
        await api<AssessmentPreview>("/api/operations/assessments/preview", {
          method: "POST",
          body: form,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const admin = user.role === "admin",
    now = report?.period.now || data.period.now;
  const decline = data.recommendations.filter((r) => r.category === "Improve");
  const pageIndex = Math.min(
    page,
    Math.max(0, Math.ceil((report?.rows.length || 0) / 25) - 1),
  );
  const show = (next: string) => {
    setView(next);
    setNotice("");
  };
  return (
    <div className="operations-page">
      <div className="ops-toolbar">
        <div className="segmented" aria-label="Operational sections">
          {[
            ["summary", "Participation & outreach"],
            ["health", "Health Screening Overview"],
            ["report", "Operational report"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              className={view === key ? "active" : ""}
              onClick={() => show(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="button"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={15} />
          Refresh operations
        </button>
      </div>
      {loading && (
        <p role="status" className="ops-muted">
          Updating operational records…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ops-notice" role="status">
          {notice}
        </p>
      )}
      {report && (
        <div className={loading ? "updating" : ""} aria-busy={loading}>
          <p className="ops-scope">
            <ShieldCheck size={16} />
            {view === "health"
              ? "All ages · screening participants combined"
              : "All ages · IB = clients · OB = non-clients"}{" "}
            · {report.period.from} to {report.period.to}.
            {view !== "health" && " Unknown client status remains separate."}
          </p>
          {view === "summary" && (
            <>
              <div className="metric-grid ops-kpis">
                {[
                  [
                    "Unique participants",
                    report.summary.unique,
                    "Distinct people across all ages; not summed from daily totals.",
                    "indigo",
                  ],
                  [
                    "Total attendances",
                    report.summary.attendance,
                    "Deduplicated attendance entries, all ages.",
                    "teal",
                  ],
                  [
                    "Programme types conducted",
                    report.summary.programmes,
                    `${report.summary.sessions} separate recorded sessions; planned and cancelled sessions are not supplied.`,
                    "purple",
                  ],
                  [
                    "Average attendance / session",
                    report.summary.average,
                    "Attendance entries divided by distinct recorded sessions.",
                    "teal",
                  ],
                  [
                    "First observed participants",
                    report.summary.firstObserved,
                    "First attendance anywhere in available records during this period; not verified new centre clients.",
                    "purple",
                  ],
                  [
                    "Previously recorded participants",
                    report.summary.returning,
                    "Selected participants whose first recorded attendance precedes this period.",
                    "cyan",
                  ],
                  [
                    "Repeat participation rate",
                    report.summary.repeatRate,
                    "Percentage of unique participants attending two or more distinct sessions in this view.",
                    "indigo",
                  ],
                  [
                    "Inactive participants",
                    report.summary.inactive,
                    report.settings.inactivityDays
                      ? `No matching attendance for ${report.settings.inactivityDays} days, as of ${report.period.to}; observed cohort only.`
                      : "Configure the organisation-approved inactivity definition to calculate this.",
                    "amber",
                  ],
                ].map(([title, value, note, tone]) => (
                  <Card
                    key={String(title)}
                    title={String(title)}
                    value={value as number | null}
                    note={String(note)}
                    tone={String(tone)}
                  />
                ))}
              </div>
              <Panel
                title="Demographic outreach · all ages"
                subtitle="Percentages use all unique participants, including unknown status. IB/OB uses Is Client, independently of service boundary."
              >
                <div className="ops-outreach">
                  {[
                    [
                      "IB clients",
                      report.summary.ib,
                      percent(report.summary.ibPct),
                    ],
                    [
                      "OB non-clients",
                      report.summary.ob,
                      percent(report.summary.obPct),
                    ],
                    [
                      "Male participants",
                      report.summary.male,
                      percent(report.summary.malePct),
                    ],
                    [
                      "First observed IB",
                      report.summary.newIb,
                      "First recorded in available history",
                    ],
                    [
                      "First observed OB",
                      report.summary.newOb,
                      "First recorded in available history",
                    ],
                  ].map(([label, value, note]) => (
                    <div key={String(label)}>
                      <span>{label}</span>
                      <strong>{number(Number(value))}</strong>
                      <small>{note}</small>
                    </div>
                  ))}
                </div>
                <p className="table-note">
                  Unknown client status: {report.summary.unknownClient}. Male
                  percentage uses all selected unique participants; this differs
                  from the senior KPI's known-gender denominator.
                </p>
              </Panel>
              {report.settings.inactivityDays !== null && (
                <div className="ops-transition-cards">
                  <Card
                    title="Newly inactive participants"
                    value={report.summary.newlyInactive}
                    note="Distinct people entering recorded inactivity during this reporting interval, not the number of status changes."
                    tone="amber"
                  />
                  <Card
                    title="Reactivated participants"
                    value={report.summary.reactivated}
                    note="Distinct previously inactive people with later matching attendance during this interval."
                    tone="teal"
                  />
                </div>
              )}
              <div className="ops-graphs">
                <Panel
                  title="First observed versus previously recorded"
                  subtitle="Unique participants per month; first dates use the full available attendance history"
                >
                  <OperationalChart
                    title="Monthly first-observed and previously recorded participants"
                    rows={report.monthly}
                    mode="stacked"
                    series={[
                      {
                        key: "firstObserved",
                        label: "First observed",
                        color: "#7d62c5",
                      },
                      {
                        key: "returning",
                        label: "Previously recorded",
                        color: "#14958a",
                      },
                    ]}
                  />
                </Panel>
                <Panel
                  title="IB and OB participation trends"
                  subtitle="Client status; hover or focus a point for counts and shares"
                >
                  <OperationalChart
                    title="Monthly unique IB clients and OB non-clients"
                    rows={report.monthly}
                    series={[
                      {
                        key: "ib",
                        label: "IB clients",
                        color: "#5a55c7",
                        percentKey: "ibPct",
                      },
                      {
                        key: "ob",
                        label: "OB non-clients",
                        color: "#13978e",
                        percentKey: "obPct",
                      },
                    ]}
                  />
                </Panel>
                <Panel
                  title="Male participation over time"
                  subtitle="All-age unique male participants and their share of all unique participants"
                >
                  <OperationalChart
                    title="Monthly male participants"
                    rows={report.monthly}
                    series={[
                      {
                        key: "male",
                        label: "Male participants",
                        color: "#1e83a7",
                        percentKey: "malePct",
                      },
                    ]}
                  />
                </Panel>
                <Panel
                  title="Inactivity and reactivation"
                  subtitle={
                    report.settings.inactivityDays
                      ? `Distinct people with recorded status transitions per month · ${report.settings.inactivityDays}-day definition`
                      : "No inactivity threshold has been assumed"
                  }
                >
                  <OperationalChart
                    title="Monthly newly inactive and reactivated participants"
                    rows={report.monthly}
                    mode="grouped"
                    series={[
                      {
                        key: "newlyInactive",
                        label: "Became inactive",
                        color: "#bd873c",
                      },
                      {
                        key: "reactivated",
                        label: "Reactivated",
                        color: "#21988b",
                      },
                    ]}
                  />
                  <p className="table-note">{report.definitions?.inactivity}</p>
                  {admin && (
                    <button
                      className="text-button"
                      onClick={() => setSettingsOpen(!settingsOpen)}
                    >
                      <Settings2 size={15} />
                      Configure inactivity definition
                    </button>
                  )}
                </Panel>
              </div>
              {report.insights.some((i) => i.view === "summary") && (
                <Panel
                  title="Operational observations"
                  subtitle="Only supported, comparable periods are described"
                >
                  <div className="ops-insights">
                    {report.insights
                      .filter((i) => i.view === "summary")
                      .map((insight) => (
                        <article className="insight-card" key={insight.title}>
                          <h3>{insight.title}</h3>
                          <p>{insight.detail}</p>
                          <div className="suggestion">
                            <p>{insight.action}</p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => {
                              setGrain("month");
                              show("report");
                            }}
                          >
                            View supporting report
                            <ArrowRight size={14} />
                          </button>
                        </article>
                      ))}
                  </div>
                </Panel>
              )}
              <Panel
                title="Staff Attention Required"
                subtitle="Operational review prompts, not medical classifications"
              >
                <div className="ops-attention">
                  {report.attention.map((item) => (
                    <article key={item.title}>
                      <strong>{item.value}</strong>
                      <h3>{item.title}</h3>
                      <p>{item.detail}</p>
                      <button
                        className="text-button"
                        onClick={() => show(item.view)}
                      >
                        Review supporting view
                        <ArrowRight size={14} />
                      </button>
                    </article>
                  ))}
                  {decline.map((r) => (
                    <article key={r.id}>
                      <Activity size={19} />
                      <h3>Review programme attendance</h3>
                      <p>
                        {r.programme}: {r.reason}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => {
                          const p = data.programmes.find((p) => p.id === r.id);
                          if (p) onProgramme(p);
                        }}
                      >
                        View programme
                        <ArrowRight size={14} />
                      </button>
                    </article>
                  ))}
                </div>
                {!report.attention.length && !decline.length && (
                  <p className="ops-muted">
                    No additional review items were identified from the
                    available records. Missing eligibility and follow-up
                    schedules are not inferred.
                  </p>
                )}
              </Panel>
              {admin && settingsOpen && (
                <Panel title="Approved inactivity definition">
                  <form
                    className="ops-inline-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget),
                        raw = String(form.get("days") || "");
                      if (
                        await mutate(
                          "/api/operations/settings",
                          { inactivityDays: raw ? Number(raw) : null },
                          "PUT",
                        )
                      )
                        setSettingsOpen(false);
                    }}
                  >
                    <label className="field">
                      <span>Calendar days without matching attendance</span>
                      <input
                        name="days"
                        type="number"
                        min="1"
                        max="3650"
                        defaultValue={report.settings.inactivityDays ?? ""}
                        placeholder="Not configured"
                      />
                    </label>
                    <button className="button primary" disabled={busy}>
                      Save approved definition
                    </button>
                  </form>
                  <p className="table-note">
                    A participant is inactive at day end after this many days
                    since their last matching attendance. Reactivation requires
                    a later attendance after at least one inactive day. Leave
                    blank to disable. This applies to the observed cohort and
                    filtered scope, not the full registered-client roster.
                  </p>
                </Panel>
              )}
              <button
                className="button"
                onClick={() => {
                  setGrain("week");
                  show("report");
                }}
              >
                <ClipboardList size={16} />
                View weekly programme performance
              </button>
            </>
          )}
          {view === "health" && (
            <>
              <div
                className="segmented ops-toolbar"
                role="group"
                aria-label="Screening data source"
              >
                <button
                  className={screeningSource === "attendance" ? "active" : ""}
                  aria-pressed={screeningSource === "attendance"}
                  onClick={() => setScreeningSource("attendance")}
                >
                  Activity attendance
                </button>
                <button
                  className={screeningSource === "monthly" ? "active" : ""}
                  aria-pressed={screeningSource === "monthly"}
                  onClick={() => setScreeningSource("monthly")}
                >
                  Reported monthly totals
                </button>
              </div>
              {screeningSource === "attendance" ? (
                <ActivityScreening report={report} />
              ) : (
                <>
                  <div className="callout">
                    <HeartPulse size={28} />
                    <div>
                      <h2>Health Screening Overview</h2>
                      <p>
                        Reported monthly assessment counts only. These values do
                        not establish unique people, repeat assessments, scores,
                        eligibility or people overdue for screening.
                      </p>
                    </div>
                  </div>
                  {!report.health.unsegmented && (
                    <p className="warning">
                      Monthly totals are not split by programme or audience.
                      Reset programme, domain and demographic filters to view
                      assessment totals.
                    </p>
                  )}
                  <div className="ops-screening-cards">
                    {(["sppb", "tanita"] as const).map((type) => (
                      <section key={type} className={`panel screening-${type}`}>
                        <div className="screening-title">
                          <span className="metric-icon">
                            {type === "sppb" ? (
                              <Activity size={23} />
                            ) : (
                              <HeartPulse size={23} />
                            )}
                          </span>
                          <div>
                            <span className="eyebrow">
                              REPORTED ASSESSMENTS
                            </span>
                            <h2>
                              {type === "sppb"
                                ? "SPPB Assessment"
                                : "Tanita Assessment"}
                            </h2>
                          </div>
                        </div>
                        <strong className="screening-total">
                          {number(report.health[type].total)}
                        </strong>
                        <p>
                          Total reported across{" "}
                          {report.health[type].reportedMonths} of{" "}
                          {report.health.selectedMonths} selected months
                        </p>
                        <div className="screening-detail">
                          <div>
                            <span>Unique people assessed</span>
                            <strong>Unavailable</strong>
                          </div>
                          <div>
                            <span>Current month in selection</span>
                            <strong>
                              {number(report.health[type].thisMonth)}
                            </strong>
                          </div>
                        </div>
                        <p className="table-note">
                          Missing monthly records and partially selected
                          historical months are not counted as zero.
                        </p>
                      </section>
                    ))}
                  </div>
                  <Panel
                    title="SPPB and Tanita assessment trends"
                    subtitle="Reported monthly counts · incomplete or unavailable months remain distinct"
                  >
                    <OperationalChart
                      title="Monthly SPPB and Tanita assessment totals"
                      rows={report.monthly}
                      mode="grouped"
                      series={[
                        { key: "sppb", label: "SPPB", color: "#8061bf" },
                        { key: "tanita", label: "Tanita", color: "#12918b" },
                      ]}
                    />
                  </Panel>
                  {report.insights.some((i) => i.view === "health") && (
                    <div className="ops-insights">
                      {report.insights
                        .filter((i) => i.view === "health")
                        .map((insight) => (
                          <article className="insight-card" key={insight.title}>
                            <h3>{insight.title}</h3>
                            <p>{insight.detail}</p>
                            <div className="suggestion">
                              <p>{insight.action}</p>
                            </div>
                            <button
                              className="text-button"
                              onClick={() =>
                                document
                                  .getElementById("assessment-ledger")
                                  ?.scrollIntoView({ block: "nearest" })
                              }
                            >
                              View reporting ledger
                              <ArrowRight size={14} />
                            </button>
                          </article>
                        ))}
                    </div>
                  )}
                  {admin && (
                    <div className="ops-toolbar">
                      <button
                        className="button primary"
                        onClick={() => setEntryOpen(!entryOpen)}
                      >
                        <Plus size={16} />
                        Record monthly totals
                      </button>
                      <a
                        className="button"
                        href="/assessment-monthly-template.csv"
                        download
                      >
                        <Download size={16} />
                        Download monthly template
                      </a>
                    </div>
                  )}
                  {admin && entryOpen && (
                    <Panel
                      title="Record completed assessment totals"
                      subtitle="Leave unavailable values blank. Enter zero only when the report confirms zero assessments."
                    >
                      <form
                        className="form-stack"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = new FormData(e.currentTarget);
                          if (
                            await mutate("/api/operations/assessments", {
                              month: form.get("month"),
                              sppb: form.get("sppb"),
                              tanita: form.get("tanita"),
                              reportedAsOf: form.get("asOf"),
                              final: form.has("final"),
                              revise: form.has("revise"),
                            })
                          )
                            setEntryOpen(false);
                        }}
                      >
                        <div className="ops-form-grid">
                          <label className="field">
                            <span>Report month</span>
                            <input
                              name="month"
                              type="month"
                              max={now.slice(0, 7)}
                              defaultValue={report.period.to.slice(0, 7)}
                              required
                            />
                          </label>
                          <label className="field">
                            <span>Reported as of</span>
                            <input
                              name="asOf"
                              type="date"
                              max={now}
                              defaultValue={now}
                              required
                            />
                          </label>
                          <label className="field">
                            <span>SPPB completed assessments</span>
                            <input
                              name="sppb"
                              type="number"
                              min="0"
                              max="1000000"
                              placeholder="Unavailable"
                            />
                          </label>
                          <label className="field">
                            <span>Tanita completed assessments</span>
                            <input
                              name="tanita"
                              type="number"
                              min="0"
                              max="1000000"
                              placeholder="Unavailable"
                            />
                          </label>
                        </div>
                        <label className="ops-checkbox">
                          <input name="final" type="checkbox" />I confirm these
                          are final totals for the ended month.
                        </label>
                        <label className="ops-checkbox">
                          <input name="revise" type="checkbox" />
                          If values change an existing report, save a new
                          revision and retain earlier entries.
                        </label>
                        <button className="button primary" disabled={busy}>
                          Save reported totals
                        </button>
                      </form>
                      <details>
                        <summary>
                          Import monthly totals from CSV or Excel
                        </summary>
                        <p className="table-note">
                          Required headers: Month, SPPB, Tanita, Reported As Of,
                          Final. Month uses YYYY-MM, dates YYYY-MM-DD, and Final
                          YES/NO. Only assessment counts are imported;
                          attendance and participant totals remain calculated
                          from the attendance records.
                        </p>
                        <form
                          className="ops-inline-form"
                          onSubmit={importPreview}
                        >
                          <input
                            aria-label="Monthly assessment report"
                            type="file"
                            name="file"
                            accept=".csv,.xlsx"
                            required
                          />
                          <button className="button" disabled={busy}>
                            <Upload size={15} />
                            Preview monthly report
                          </button>
                        </form>
                      </details>
                      {preview && (
                        <div className="ops-preview">
                          <h3>
                            Review {preview.rows.length} assessment totals
                          </h3>
                          <p>{preview.message}</p>
                          {preview.warnings.map((w, i) => (
                            <p className="warning" key={i}>
                              Row {w.row}: {w.message}
                            </p>
                          ))}
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Month</th>
                                  <th>Assessment</th>
                                  <th>Total</th>
                                  <th>Reported as of</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.rows.map((r, i) => (
                                  <tr key={i}>
                                    <td>{r.month}</td>
                                    <td>{r.type}</td>
                                    <td>{r.total}</td>
                                    <td>{r.reported_as_of}</td>
                                    <td>
                                      {r.complete ? "Final" : "Provisional"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <label className="ops-checkbox">
                            <input
                              type="checkbox"
                              checked={revise}
                              onChange={(e) => setRevise(e.target.checked)}
                            />
                            Confirm revisions to existing totals; preserve
                            previous entries.
                          </label>
                          <div className="ops-toolbar">
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await mutate(
                                    "/api/operations/assessments/confirm",
                                    { id: preview.id, revise },
                                  )
                                ) {
                                  setPreview(null);
                                  setEntryOpen(false);
                                }
                              }}
                            >
                              Confirm reported totals
                            </button>
                            <button
                              className="button"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await mutate(
                                    "/api/import/preview/" + preview.id,
                                    undefined,
                                    "DELETE",
                                  )
                                )
                                  setPreview(null);
                              }}
                            >
                              Discard preview
                            </button>
                          </div>
                        </div>
                      )}
                    </Panel>
                  )}
                  <section className="panel" id="assessment-ledger">
                    <div className="panel-head">
                      <div>
                        <h2>Monthly assessment reporting ledger</h2>
                        <p className="muted">
                          Latest revision per month and assessment ·{" "}
                          {report.health.revisions} historical entries retained
                          · workspace totals
                        </p>
                      </div>
                    </div>
                    {report.health.history.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Month</th>
                              <th scope="col">Assessment</th>
                              <th scope="col">Completed count</th>
                              <th scope="col">Reported as of</th>
                              <th scope="col">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.health.history.map((r) => (
                              <tr key={r.month + r.type}>
                                <th scope="row">{r.month}</th>
                                <td>
                                  {r.type === "TANITA" ? "Tanita" : "SPPB"}
                                </td>
                                <td>{r.total}</td>
                                <td>{r.reported_as_of}</td>
                                <td>
                                  <span className="badge soft">
                                    {r.complete ? "Final" : "Provisional"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="chart-empty">
                        No assessment totals have been recorded. Nothing has
                        been inferred from attendance.
                      </p>
                    )}
                    {report.health.revisionHistory.length >
                      report.health.history.length && (
                      <details>
                        <summary>View retained reporting revisions</summary>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Month</th>
                                <th scope="col">Assessment</th>
                                <th scope="col">Count</th>
                                <th scope="col">Reported as of</th>
                                <th scope="col">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.health.revisionHistory.map((r, i) => (
                                <tr key={i}>
                                  <th scope="row">{r.month}</th>
                                  <td>{r.type}</td>
                                  <td>{r.total}</td>
                                  <td>{r.reported_as_of}</td>
                                  <td>
                                    {r.complete ? "Final" : "Provisional"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    <p className="table-note">
                      Both assessments, neither assessment, repeat assessments
                      and eligible-person coverage remain unavailable without
                      individual records and approved eligibility rules. No
                      clinical interpretation is generated.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          {view === "report" && (
            <Panel
              title="Monthly Operational Summary"
              subtitle="Switch day, week, month or year. Each period deduplicates participant identifiers across that entire period."
            >
              <div className="ops-toolbar">
                <label className="field">
                  <span>Report interval</span>
                  <select
                    value={grain}
                    onChange={(e) => {
                      setGrain(e.target.value);
                      setPage(0);
                    }}
                  >
                    {[
                      ["day", "Daily"],
                      ["week", "Weekly"],
                      ["month", "Monthly"],
                      ["year", "Yearly"],
                    ].map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {!["gender", "race", "client", "boundary", "ageBand"].some(
                  (k) => filters[k as keyof Filters],
                ) && filters.target === "all" ? (
                  <a
                    className="button"
                    href={centreUrl("/api/operations/export?" + query)}
                  >
                    <Download size={16} />
                    Export aggregate CSV
                  </a>
                ) : (
                  <p className="table-note">
                    Reset audience filters to export a shareable report.
                  </p>
                )}
              </div>
              <div className="table-scroll ops-report-table">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Period",
                        "Programme types",
                        "Sessions",
                        "Attendances",
                        "Unique people",
                        "Avg / session",
                        "IB clients",
                        "OB non-clients",
                        "Male",
                        "Inactive at period end",
                        "New IB*",
                        "New OB*",
                        "SPPB†",
                        "Tanita†",
                        "Became inactive",
                        "Reactivated",
                      ].map((h) => (
                        <th scope="col" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows
                      .slice(pageIndex * 25, pageIndex * 25 + 25)
                      .map((r) => (
                        <tr key={r.label}>
                          <th scope="row">{r.label}</th>
                          {[
                            r.programmes,
                            r.sessions,
                            r.attendance,
                            r.unique,
                            r.average,
                            r.ib,
                            r.ob,
                            r.male,
                            r.inactive,
                            r.newIb,
                            r.newOb,
                            r.sppb,
                            r.tanita,
                            r.newlyInactive,
                            r.reactivated,
                          ].map((v, i) => (
                            <td key={i}>{number(v)}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="table-pages">
                <button
                  disabled={!pageIndex}
                  onClick={() => setPage(pageIndex - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {pageIndex + 1} of{" "}
                  {Math.max(1, Math.ceil(report.rows.length / 25))}
                </span>
                <button
                  disabled={(pageIndex + 1) * 25 >= report.rows.length}
                  onClick={() => setPage(pageIndex + 1)}
                >
                  Next
                </button>
              </div>
              <p className="table-note">
                * First observed in available attendance history; not verified
                first-ever clients. † Known reported monthly totals only;
                daily/weekly and partial historical-month allocations are
                unavailable. Yearly totals sum available monthly records, which
                may be incomplete. Unknown client status is excluded from both
                IB and OB, while remaining in unique people. Inactive counts are
                snapshots; transition counts are distinct people, not summed
                events. Shared CSV omits demographic breakdowns under existing
                report privacy rules.
              </p>
            </Panel>
          )}
          <section className="panel ops-targets">
            <div className="panel-head">
              <div>
                <h2>Staff-defined monthly targets</h2>
                <p className="muted">
                  Workspace totals, using each target's own month. Global
                  filters do not redefine targets.
                </p>
              </div>
              {admin && (
                <button
                  className="button"
                  onClick={() => setTargetOpen(!targetOpen)}
                >
                  <Target size={16} />
                  Set operational target
                </button>
              )}
            </div>
            {report.targets.length ? (
              <div className="ops-target-grid">
                {report.targets.map((t) => (
                  <article className="target-card" key={t.id}>
                    <span className="eyebrow">{t.month}</span>
                    <h3>{t.label}</h3>
                    <div className="target-value">
                      <strong>{number(t.actual)}</strong>
                      <span>of {number(t.value)}</span>
                    </div>
                    {t.progress !== null ? (
                      <>
                        <progress
                          aria-label={`${t.label} target progress`}
                          value={Math.min(t.progress, 100)}
                          max="100"
                        />
                        <p>
                          {number(t.progress)}% achieved · {number(t.remaining)}{" "}
                          remaining
                        </p>
                      </>
                    ) : (
                      <p className="table-note">
                        Actual count is unavailable or the target month has not
                        started.
                      </p>
                    )}
                    {admin && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          mutate(
                            "/api/operations/targets/" + t.id,
                            undefined,
                            "DELETE",
                          )
                        }
                      >
                        Remove target
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="ops-muted">
                No operational targets have been set. No targets are generated
                automatically.
              </p>
            )}
            {admin && targetOpen && (
              <form
                className="ops-inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  if (
                    await mutate("/api/operations/targets", {
                      month: form.get("month"),
                      metric: form.get("metric"),
                      value: Number(form.get("value")),
                    })
                  )
                    setTargetOpen(false);
                }}
              >
                <label className="field">
                  <span>Target month</span>
                  <input
                    type="month"
                    name="month"
                    defaultValue={now.slice(0, 7)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Metric</span>
                  <select name="metric">
                    {Object.entries(metrics).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Approved target</span>
                  <input
                    type="number"
                    name="value"
                    min="1"
                    max="1000000"
                    required
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  Save staff target
                </button>
              </form>
            )}
            <p className="table-note">
              Assessment progress uses reported monthly totals and may remain
              provisional or incomplete. A target shortfall alone is not
              programme failure.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
