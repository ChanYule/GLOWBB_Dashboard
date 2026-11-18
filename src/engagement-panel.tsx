import {MetricHelp} from './metric-help';
import { useId, useState } from "react";
import { engagementLabels } from "../shared/engagement-depth.js";
import type {
  EngagementMetadata,
  EngagementSummary,
} from "../shared/engagement-depth.js";
import { sortGroups } from "../shared/participation-reliability.js";
import "./engagement-panel.css";

type Group = {
  label: string;
  suppressed?: boolean;
  engagement?: EngagementSummary | null;
};
const fmt = (n: number | null, suffix = "") =>
  n == null
    ? "Not applicable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n) +
      suffix;
export function EngagementPanel({
  groups,
  metadata,
  dimension,
  populationLabel,
  overlap = false,
  printing = false,
}: {
  groups: Group[];
  metadata?: EngagementMetadata;
  dimension: string;
  populationLabel: string;
  overlap?: boolean;
  printing?: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<"depth" | "recency">("depth");
  const [countsOpen, setCountsOpen] = useState(false);
  const modes: ("depth" | "recency")[] = printing
    ? ["depth", "recency"]
    : [mode];
  const labels = engagementLabels(metadata);
  const rows = sortGroups(groups, "label", dimension);
  return (
    <section className="panel engagement-panel" aria-labelledby={id}>
      <h2 id={id}>How often do participants return?</h2>
      <p className="muted">{populationLabel}. Each bar uses the eligible people in that group; n is shown beside it.</p>
      {overlap && (
        <p className="note">
          Event Types overlap: do not add group or segment totals across types.
          Registered-client bars include the eligible client cohort for each
          type; attendance-only bars include that type's attendees. A
          nonattender has no inferred Event Type preference.
        </p>
      )}
      {!printing && (
        <label className="engagement-mode">
          Show breakdown
          <select
            aria-label="Engagement breakdown"
            value={mode}
            onChange={(e) => setMode(e.target.value as "depth" | "recency")}
          >
            <option value="depth">Engagement Frequency</option>
            <option value="recency">Recent Participation</option>
          </select>
        </label>
      )}
      {modes.map((view) => {
        const title =
          view === "depth" ? "Session depth by group" : "Recency by group";
        const table = (
          <div
            className="work-table engagement-counts"
            role="region"
            aria-label={`${title} counts`}
            tabIndex={printing ? undefined : 0}
          >
            <table>
              <caption>{title} · counts and percentages</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">People (n)</th>
                  {labels[view].map((cell) => (
                    <th scope="col" key={cell.id}>
                      {cell.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const data = g.suppressed ? null : g.engagement;
                  return (
                    <tr key={g.label}>
                      <th scope="row">{g.label}</th>
                      <td>
                        {data ? fmt(data.population) : "Unavailable / withheld"}
                      </td>
                      {labels[view].map((cell) => {
                        const value = data?.[view].find(
                          (r) => r.id === cell.id,
                        );
                        return (
                          <td key={cell.id}>
                            {value
                              ? `${value.count} (${fmt(value.percentage, "%")})`
                              : "Unavailable / withheld"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        return (
          <div key={view} className="engagement-view">
            <h3>{title}</h3><MetricHelp label={title} definition="Depth: distinct sessions in the selected period/domain, as a count and percentage of this population. Recency: days since latest full-history attendance, anchored to coverage end. No recorded history and no matching attendance are separate; unavailable/withheld values are not zero."/>
            <ul className="engagement-legend" aria-label={`${title} legend`}>
              {labels[view].map((cell) => (
                <li key={cell.id}>
                  <i
                    className={`engagement-tone-${cell.id}`}
                    aria-hidden="true"
                  />
                  {cell.label}
                </li>
              ))}
            </ul>
            {rows.map((g) => {
              const data = g.suppressed ? null : g.engagement;
              return (
                <article className="engagement-group" key={g.label}>
                  <h4>
                    {g.label} · n=
                    {data ? fmt(data.population) : "Unavailable / withheld"}
                  </h4>
                  {data && data.population > 0 ? (
                    <>
                      <div
                        className="engagement-stack"
                        role="img"
                        aria-label={`${g.label}: ${data[view].map((cell) => `${cell.label}: ${cell.count} (${fmt(cell.percentage, "%")})`).join("; ")}`}
                      >
                        {data[view]
                          .filter((cell) => cell.count > 0)
                          .map((cell) => (
                            <span
                              key={cell.id}
                              className={`engagement-tone-${cell.id}`}
                              style={{width:`${(cell.count / data.population) * 100}%`}}
                              tabIndex={0}
                              aria-label={`${cell.label}: ${fmt(cell.count)} people, ${fmt(cell.percentage,'%')}`}
                            >{cell.percentage!=null&&cell.percentage>=12&&<b aria-hidden="true">{fmt(cell.count)}</b>}<span className="chart-tooltip" role="tooltip">{cell.label}: {fmt(cell.count)} people ({fmt(cell.percentage,'%')})</span></span>
                          ))}
                      </div>
                      <p>
                        {data[view]
                          .filter((cell) => cell.count > 0)
                          .map(
                            (cell) =>
                              `${cell.label}: ${cell.count} (${fmt(cell.percentage, "%")})`,
                          )
                          .join(" · ")}
                      </p>
                    </>
                  ) : (
                    <p className="note">
                      {data?.population === 0
                        ? "No people in this group; percentages are not applicable."
                        : "Breakdown unavailable: attendance history or authorised aggregate detail is missing/withheld. Missing is not zero."}
                    </p>
                  )}
                </article>
              );
            })}
            {!rows.length && <p>No recorded groups in this view.</p>}
            {printing ? (
              table
            ) : (
              <details
                open={countsOpen}
                onToggle={(e) => setCountsOpen(e.currentTarget.open)}
              >
                <summary>View all counts and percentages</summary>
                {countsOpen && table}
              </details>
            )}
          </div>
        );
      })}
      <details className="chart-methodology" open={printing}><summary>How frequency and recency are defined</summary>      <p>
        {populationLabel}. Depth counts distinct sessions matching the selected
        reporting period and filters. Each bar uses the eligible people in that
        group as its denominator; n is shown beside the group.
      </p>
      <p className="table-note">
        No recorded history means no attendance found anywhere in the available
        records; it does not mean never attended. None in this view means
        recorded history exists but no sessions match this period/filter.
        One-time = 1; Occasional = 2–{(metadata?.regularFrom ?? 6) - 1}; Regular
        = {metadata?.regularFrom ?? 6}+ sessions. These segments do not change
        active/inactive classifications.
      </p>
      <p className="table-note">
        Recency anchor: {metadata?.anchor || "Unavailable"} (attendance coverage
        end, not today). Full recorded history:{" "}
        {metadata?.historyFrom || "Unavailable"} to{" "}
        {metadata?.anchor || "Unavailable"}. Recency uses latest attendance
        across all programmes through that anchor, even outside this selected
        period/filter; it is not a historical period-end status. Missing
        registration dates do not establish historical membership.
      </p>
      </details>
      <p className="table-note">
        Counts describe only the records available. Known profiles and
        attendance differences do not prove causes or explain individual support
        needs. Segment percentages may differ slightly from 100% because of
        rounding.
      </p>
    </section>
  );
}
