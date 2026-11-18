import { useId } from "react";
import {MetricHelp} from './metric-help';
import type { Report } from "./patterns-ui";
import "./participation-group-summary.css";

export type SessionDistribution = {
  participants: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  mean: number | null;
  bins: { label: string; count: number }[];
};
export type OverallContext = {
  registered: number | null;
  unique: number | null;
  attendance: number | null;
  programmes: number | null;
  rate: number | null;
  sessionDistribution: SessionDistribution | null;
};
const fmt = (n: number | null | undefined, suffix = "") =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n) +
      suffix;
const middle = (d: SessionDistribution | null | undefined) =>
  d?.q1 == null || d.q3 == null
    ? "Unavailable"
    : `${fmt(d.q1)}–${fmt(d.q3)} sessions`;

export function ParticipationGroupSummary({ report }: { report: Report }) {
  const histogramId = useId();
  const selected = report.groups.find((g) => g.label === report.group);
  const withheld = !!selected?.suppressed;
  const group = withheld ? undefined : selected;
  const d = group?.sessionDistribution;
  const groupUnique = report.coverage.from ? group?.unique : undefined;
  const groupAttendance = report.coverage.from ? group?.attendance : undefined;
  const groupProgrammes = report.coverage.from ? group?.programmes : undefined;
  const overall = report.overallContext;
  const overallRegistered =
    overall?.registered ??
    report.reliability?.overall?.n_registered ??
    (report.scope === "clients" ? report.population : undefined);
  const overallUnique =
    overall?.unique ?? report.reliability?.overall?.n_participating;
  const overallRate = overall?.rate ?? report.reliability?.overall?.rate;
  const clients = report.scope === "clients";
  const scopeLabel = clients
    ? "Overall registry"
    : report.scope === "seniors"
      ? "All selected senior attendees"
      : report.scope === "attendingClients"
        ? "All selected client attendees"
        : "All selected attendees";
  const value = (n: number | null | undefined, suffix = "") =>
    withheld ? "Withheld" : fmt(n, suffix);
  const cards = clients
    ? [
        {
          title: "Group registered clients",
          value: value(group?.registered),
          detail: `Eligible registered clients in ${report.group || "the selected group"}, including those with no attendance.`,
          overall: `${scopeLabel}: ${fmt(overallRegistered)} registered clients.`,
        },
        {
          title: "Group participants",
          value: value(groupUnique),
          detail: !report.coverage.from
            ? "Attendance history is unavailable; participating counts cannot be determined."
            : withheld
              ? "Group counts are withheld under the existing access rules."
              : `${value(groupUnique)} of ${value(group?.registered)} group registered clients attended at least once.`,
          overall: `${scopeLabel}: ${fmt(overallUnique)} of ${fmt(overallRegistered)} attended.`,
        },
        {
          title: "Group participation rate",
          value: value(report.ratesAvailable ? group?.rate : undefined, "%"),
          detail: !report.ratesAvailable
            ? "A verified complete registry and attendance history are needed for a client participation rate."
            : withheld
              ? "Group counts are withheld under the existing access rules."
              : `${value(groupUnique)} participating ÷ ${value(group?.registered)} group registered clients. Not a session attendance rate.`,
          overall: `${scopeLabel}: ${fmt(overallRate, "%")} (${fmt(overallUnique)} of ${fmt(overallRegistered)}).`,
        },
      ]
    : [
        {
          title: "Group participants",
          value: value(groupUnique),
          detail:
            "Distinct attendees in this group; no registered-client denominator applies.",
          overall: `${scopeLabel}: ${fmt(report.coverage.from ? (overall?.unique ?? report.population) : undefined)} participants.`,
        },
        {
          title: "Group attendance entries",
          value: value(groupAttendance),
          detail:
            "Distinct person-session pairs for this group in the selected period.",
          overall: `${scopeLabel}: ${fmt(overall?.attendance)} attendance entries.`,
        },
        {
          title: "Group programmes",
          value: value(groupProgrammes),
          detail:
            "Distinct programmes attended by this group in the selected period.",
          overall: `${scopeLabel}: ${fmt(overall?.programmes)} programmes.`,
        },
      ];
  return (
    <section
      className="participation-group-summary"
      aria-label="Selected group and overall context"
    >
      <p>
        <strong>Selected group: {report.group || "Unavailable"}.</strong> All
        primary figures below refer to this group; muted lines show the overall
        population for the same period and domain.
      </p>
      <p className="table-note">
        Known characteristic: {fmt(report.completeness, "%")} of this overall
        population. Missing registration dates do not establish historical membership;
        attendance coverage is limited to the records available.
      </p>
      <div className="patterns-kpis">
        {cards.map((card) => (
          <article className="panel" key={card.title} aria-label={card.title}>
            <span>{card.title}</span><MetricHelp label={card.title} definition={card.detail+' Selected reporting period and programme-domain filter apply. Muted overall lines use the same population basis.'}/>
            <strong>{card.value}</strong>

            <small className="patterns-kpi-overall">{card.overall}</small>
          </article>
        ))}
        <article className="panel" aria-label="Median sessions per participant">
          <span>Median sessions / participant</span>
          <strong
            title={`Mean sessions per group participant: ${value(d?.mean)}`}
          >
            {value(d?.median)}
          </strong>
          <p>Middle 50% (IQR): {withheld ? "Withheld" : middle(d)}.</p>
          <p>
            {d && !withheld
              ? `Among ${fmt(d.participants)} group participants who attended at least once.`
              : "Participating-person session counts are unavailable or withheld."}
          </p>
          <details>
            <summary aria-label="How median sessions per participant is calculated">
              Definition and mean
            </summary>
            <p>
              Median is the middle session count per attendee. The interquartile
              range (IQR) spans the middle 50%. Quartiles use linear
              interpolation. Each person-session counts once; nonattenders are
              excluded.
            </p>
            <p>Mean sessions / group participant: {value(d?.mean)}.</p>
          </details>
          <small className="patterns-kpi-overall">
            {scopeLabel} attendees: median{" "}
            {fmt(overall?.sessionDistribution?.median)}; IQR{" "}
            {middle(overall?.sessionDistribution)}.
          </small>
        </article>
      </div>
      <details className="histogram-disclosure"><summary>Detailed session distribution and median</summary><section
        className="panel session-distribution"
        aria-labelledby={histogramId}
      >
        <h3 id={histogramId}>
          Sessions per participant · {report.group || "selected group"}
        </h3>
        <p>
          Distinct sessions per person who attended in this period. Clients with
          no attendance remain in client-rate denominators and are excluded from
          this distribution.
        </p>
        {d && !withheld && d.participants > 0 ? (
          <ul
            className="session-histogram"
            aria-label="Session count distribution"
          >
            {d.bins.map((bin) => (
              <li key={bin.label}>
                <span>
                  {bin.label} {bin.label === "1" ? "session" : "sessions"}
                </span>
                <div className="session-histogram-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${(bin.count / Math.max(...d.bins.map((b) => b.count), 1)) * 100}%`,
                    }}
                  />
                </div>
                <span>
                  {bin.count} participants (
                  {fmt((bin.count / d.participants) * 100, "%")})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">
            {withheld
              ? "This group is withheld under the existing access rules."
              : d?.participants === 0
                ? "No participants in this group have recorded attendance in this period. A median is not applicable."
                : "Session distribution unavailable: recorded attendance or authorised aggregate detail is missing. Missing is not zero."}
          </p>
        )}
      </section></details>
    </section>
  );
}
