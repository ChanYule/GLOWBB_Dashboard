import { ParticipationSummary } from "./participation-summary";
import { useEffect, useState } from "react";
import { api } from "./api";
import { TrendChart } from "./analytics-ui";
import type { Dashboard, Filters } from "./types";
import type { ProtectedSeries } from "./needs-ui";

export type Briefing = {
  generatedAt?: string;
  registryOmitted?: boolean;
  clients: null | {
    available: boolean;
    attendanceAvailable: boolean;
    summary: Record<string, number | null>;
    populationNote: string;
    limitations: string[];
  };
  needs: null | {
    respondents: number | null;
    eligible: number | null;
    note: string;
    interests: ProtectedSeries;
  };
  actions: null | { total: number; stages: Record<string, number> };
};
const fmt = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export function useBriefing(
  filters: Filters,
  revision: number,
  enabled = true,
  includeRegistry = true,
) {
  const [value, setValue] = useState<{ key: string; data: Briefing } | null>(
      null,
    ),
    [error, setError] = useState("");
  const query = new URLSearchParams({
    ...filters,
    ...(includeRegistry ? {} : { includeRegistry: "0" }),
  }).toString();
  const key = query + ":" + revision;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api<Briefing>("/api/reporting/briefing?" + query, {
      signal: controller.signal,
    })
      .then((v) => {
        if (controller.signal.aborted) return;
        setValue({ key, data: v });
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query, key, enabled]);
  return { value: value?.data || null, error, pending: value?.key !== key };
}
export function ReportBars({
  rows,
}: {
  rows: { label: string; value: number; detail?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.length ? (
    <div className="report-bars">
      {rows.map((r) => (
        <div className="report-bar" key={r.label}>
          <span>{r.label}</span>
          <strong>{fmt(r.value)}</strong>
          <i
            aria-hidden="true"
            style={{ width: `${(r.value / max) * 100}%` }}
          />
          <small>{r.detail}</small>
        </div>
      ))}
    </div>
  ) : (
    <p className="empty">No recorded values in this period.</p>
  );
}
export function Cards({
  data,
  briefing,
  ready = true,
  compact = false,
}: {
  data: Dashboard;
  ready?: boolean;
  compact?: boolean;
  briefing: Briefing | null;
}) {
  const items = [
    [
      "Unique seniors",
      data.coverage.from ? data.summary.unique : null,
      `Age ${data.settings.seniorAge}+ · selected period`,
    ],
    [
      "Male seniors",
      data.coverage.from ? data.summary.male : null,
      `${fmt(data.summary.malePct)}% of ${fmt(data.summary.knownGender)} seniors with known gender`,
    ],
    [
      "Minority seniors",
      data.coverage.from ? data.summary.minority : null,
      `${fmt(data.summary.minorityPct)}% of ${fmt(data.summary.knownRace)} seniors with known race`,
    ],
    [
      "Programmes delivered",
      data.coverage.from ? data.summary.programmes : null,
      "Distinct programmes in the selected period",
    ],
    [
      "Sessions delivered",
      data.coverage.from ? data.summary.sessions : null,
      "Distinct delivered sessions · all ages",
    ],
    [
      "Attendance entries",
      data.coverage.from ? data.summary.attendance : null,
      "Recorded participation entries · all ages",
    ],
  ] as const;
  return (
    <div
      className={compact ? "management-kpis compact" : "management-kpis"}
      data-ready={!!briefing && ready}
    >
      {items
        .filter(
          ([label]) =>
            !compact ||
            !["Programmes delivered", "Sessions delivered"].includes(label),
        )
        .map(([label, n, note]) => (
          <article className="management-kpi" key={label}>
            <span>{label}</span>
            <strong>{fmt(n)}</strong>
            <small>{note}</small>
          </article>
        ))}
    </div>
  );
}
export function Coverage({ briefing }: { briefing: Briefing | null }) {
  const c = briefing?.clients;
  if (
    !c?.available ||
    !c.attendanceAvailable ||
    c.summary.attending == null ||
    c.summary.noAttendance == null
  )
    return (
      <p className="note">
        Client coverage requires a complete reviewed registry and attendance.
        Audience filters are reported separately from the full registry
        denominator.
      </p>
    );
  return (
    <>
      <div
        className="coverage-bar"
        aria-label={`${fmt(c.summary.attending)} attending; ${fmt(c.summary.noAttendance)} without recorded attendance`}
      >
        <span style={{ width: `${c.summary.rate || 0}%` }} />
        <i />
      </div>
      <div className="coverage-legend">
        <span>
          <b>{fmt(c.summary.attending)}</b> attended
        </span>
        <span>
          <b>{fmt(c.summary.noAttendance)}</b> no recorded attendance
        </span>
      </div>
      <p className="muted">{c.populationNote}</p>
    </>
  );
}
function Findings({
  data,
  briefing,
  navigate,
}: {
  data: Dashboard;
  briefing: Briefing | null;
  navigate: (tab: string) => void;
}) {
  const rows = [
    {
      title: "Review target-group outreach",
      evidence: data.coverage.from
        ? `${fmt(data.summary.male)} male seniors and ${fmt(data.summary.minority)} minority seniors reached in the selected period.`
        : "Import attendance to review target-group reach.",
      why: "Compare target-group reach with agreed outreach targets and programme delivery frequency.",
      next: "Review which programmes attract these groups and where delivery could be adapted.",
      tab: "Programme Performance",
    },
    {
      title: "Read reach alongside delivery",
      evidence: data.coverage.from
        ? `${fmt(data.summary.sessions)} sessions reached ${fmt(data.summary.unique)} distinct seniors across ${fmt(data.summary.programmes)} programmes.`
        : "Attendance data is required before comparing programme delivery and reach.",
      why: "A programme with more sessions has more opportunities to reach participants.",
      next: "Compare programme frequency, unique reach and average attendance.",
      tab: "Programme Performance",
    },
    {
      title: "Ask before planning",
      evidence:
        briefing?.needs?.respondents == null
          ? "Responses are unavailable or withheld under privacy rules."
          : `${fmt(briefing.needs.respondents)} people supplied recorded responses.`,
      why: "Attendance cannot establish preferences, accessibility needs or barriers.",
      next: "Review recorded interests and missing information before agreeing actions.",
      tab: "Participant Needs & Accessibility",
    },
  ];
  return (
    <div className="management-findings">
      {rows.map((r) => (
        <article className="panel" key={r.title}>
          <h3>{r.title}</h3>
          <p>
            <b>Evidence:</b> {r.evidence}
          </p>
          <p>{r.why}</p>
          <p>
            <b>Next step:</b> {r.next}
          </p>
          <button className="text-button" onClick={() => navigate(r.tab)}>
            View analysis →
          </button>
        </article>
      ))}
    </div>
  );
}
export function ManagementHome({
  data,
  filters,
  revision,
  navigate,
  present,
  updating = false,
}: {
  data: Dashboard;
  filters: Filters;
  revision: number;
  navigate: (tab: string) => void;
  present: (briefing: Briefing) => void;
  updating?: boolean;
}) {
  const { value, error, pending } = useBriefing(filters, revision, true, false);
  const [audience, setAudience] = useState<"unique" | "male" | "minority">(
    "unique",
  );
  return (
    <div className="management-home" data-report-from={data.period.from}>
      {!data.coverage.from && (
        <section className="panel">
          <h2>Make every connection count.</h2>
          <p>
            Import and review attendance to populate this dashboard. No sample
            statistics are shown.
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Cards
        data={data}
        briefing={value}
        ready={!pending && !updating}
        compact
      />
      <div className="report-section-heading">
        <h2>Past participation</h2>
        <label>
          Focus
          <select
            aria-label="Chart focus"
            value={audience}
            onChange={(e) => setAudience(e.target.value as typeof audience)}
          >
            <option value="unique">All seniors</option>
            <option value="male">Male seniors</option>
            <option value="minority">Minority seniors</option>
          </select>
        </label>
        <button
          className="button primary"
          onClick={() => value && present(value)}
          disabled={pending || updating || !!error}
        >
          Print summary
        </button>
      </div>
      <div className="management-chart-grid">
        <section className="panel">
          <h3>Reach over time</h3>
          <TrendChart rows={data.trends} metric={audience} />
        </section>
        <section className="panel">
          <h3>Top five programmes</h3>
          <ReportBars
            rows={[...data.programmes]
              .sort((a, b) => b[audience] - a[audience])
              .slice(0, 5)
              .map((p) => ({
                label: p.name,
                value: p[audience],
                detail: `${fmt(p.sessions)} sessions`,
              }))}
          />
        </section>
      </div>
      <ParticipationSummary
        filters={filters}
        revision={revision}
        available={!!data.coverage.from}
      />
      <section className="panel simple-next-step">
        <h2>Plan the next step</h2>
        <p>
          Review past programmes, choose what to run again or improve, and
          record an owner and review date.
        </p>
        <button
          className="button primary"
          onClick={() => navigate("Planning & Recommendations")}
        >
          Open Planning
        </button>
        <details>
          <summary>More planning notes</summary>
          <Findings data={data} briefing={value} navigate={navigate} />
        </details>
      </section>
    </div>
  );
}
export function DomainPortfolio({ data }: { data: Dashboard }) {
  const [metric, setMetric] = useState<"programmes" | "sessions" | "unique">(
    "sessions",
  );
  return (
    <section className="panel">
      <div className="report-section-heading">
        <h2>Programme portfolio by domain</h2>
        <label>
          Measure
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
          >
            <option value="programmes">Distinct programmes</option>
            <option value="sessions">Delivered sessions</option>
            <option value="unique">Unique seniors</option>
          </select>
        </label>
      </div>
      <ReportBars
        rows={data.domains.map((d) => ({ label: d.label, value: d[metric] }))}
      />
      <p className="muted">
        Unique reach overlaps between domains and cannot be added.
      </p>
    </section>
  );
}
