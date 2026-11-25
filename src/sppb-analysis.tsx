import { useState } from "react";
import { HorizontalRankingChart } from "./chart-system";
import { CENTRES } from "../shared/centres.js";
export type ScoreCohort = {
  label: string;
  members: number;
  medianTotal: number | null;
  medianSessions: number | null;
  historyAvailable: number;
  windowSpanned: number;
  smallSample: boolean;
  validatedPairs: number;
  medianValidatedChange: number | null;
};
export type LinkedSppbAnalysis = {
  population: number;
  scored: number;
  asOf: string;
  historyUnavailable: number;
  partialHistory: number;
  exclusions: {
    noDatedAssessment: number;
    ambiguousLatest: number;
    missingTotal: number;
  };
  sourceGroups: (Omit<ScoreCohort, "label"> & {
    sourceDefinition: string;
    unvalidated: number;
    changes: { label: string; members: number; medianChange: number | null }[];
    cohorts: Record<string, ScoreCohort[]>;
    domains: {
      label: string;
      attended: ScoreCohort;
      noRecordedAttendance: ScoreCohort;
    }[];
    programmes: (ScoreCohort & {
      id: string;
      name: string;
      centre: string;
      sessions: number;
    })[];
  })[];
  findings: { finding: string; meaning: string; next: string }[];
  note: string;
};
const fmt = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : value.toLocaleString("en-SG", { maximumFractionDigits: 1 });
const factors = {
  attendance: "Recent programme participation",
  age: "Age group",
  gender: "Recorded gender",
  race: "Recorded race",
  cfs: "Recorded CFS",
  srf: "Recorded SRF source code",
  living: "Recorded living arrangement",
};
export function SppbLinkedAnalysis({
  analysis,
}: {
  analysis: LinkedSppbAnalysis;
}) {
  const [factor, setFactor] = useState("attendance"),
    [source, setSource] = useState("");
  const group =
    analysis.sourceGroups.find((g) => g.sourceDefinition === source) ||
    analysis.sourceGroups[0];
  const cohorts = group?.cohorts[factor] || [];
  return (
    <section
      className="panel sppb-linked-analysis"
      aria-labelledby="sppb-linked-heading"
    >
      <h3 id="sppb-linked-heading">SPPB scores and programme participation</h3>
      <p>
        {analysis.scored} of {analysis.population} selected clients have a
        dated, unambiguous numeric score. Attendance covers the six months
        ending on each client’s latest assessment date.
      </p>
      {!group ? (
        <p>
          No scores can be linked in this selection. Import assessments or check
          the client registry and assessment dates.
        </p>
      ) : (
        <>
          <div className="sppb-analysis-summary">
            <span>
              Latest recorded median (unvalidated imported totals){" "}
              <strong>{fmt(group.medianTotal)}</strong>
            </span>
            <span>
              Clients in this source group <strong>{fmt(group.members)}</strong>
            </span>
            <span>
              Scoring validation pending{" "}
              <strong>{fmt(group.unvalidated)}</strong>
            </span>
          </div>
          <p className="note">
            Source: {group.sourceDefinition}. Recorded totals are shown on their
            original scale; they are not standardised or clinical outcomes.
          </p>
          <div className="sppb-filters">
            <label>
              Compare scores by
              <select
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              >
                {Object.entries(factors).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {analysis.sourceGroups.length > 1 && (
              <label>
                Score source
                <select
                  value={group.sourceDefinition}
                  onChange={(e) => setSource(e.target.value)}
                >
                  {analysis.sourceGroups.map((g) => (
                    <option key={g.sourceDefinition}>
                      {g.sourceDefinition}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <HorizontalRankingChart
            label="Median recorded SPPB totals by selected group"
            allowChartActions={false}
            rows={cohorts.map((c) => ({
              label: `${c.label} (n=${c.members})`,
              value: c.medianTotal,
              detail: `Median recorded total ${fmt(c.medianTotal)}; median attendance ${fmt(c.medianSessions)} sessions. ${c.smallSample ? "Small sample; use caution." : ""}`,
            }))}
            limit={6}
          />
          {cohorts.some((c) => c.smallSample) && (
            <p className="note">
              Some groups contain fewer than five clients. Use the visible
              sample sizes and review the source records before interpreting a
              difference.
            </p>
          )}
          {!!group.changes?.length && (
            <details>
              <summary>
                Validated changes and attendance between assessments
              </summary>
              <p>
                Only approved, compatible assessment pairs contribute.
                Attendance is after the earlier assessment and on or before the
                latest assessment. These numerical differences do not establish
                programme impact.
              </p>
              <div className="sppb-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Sessions between assessments</th>
                      <th>Clients with validated pairs</th>
                      <th>Median numerical difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.changes.map((c) => (
                      <tr key={c.label}>
                        <th>{c.label}</th>
                        <td>{fmt(c.members)}</td>
                        <td>{fmt(c.medianChange)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <details>
            <summary>View group counts and attendance</summary>
            <div className="sppb-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Clients</th>
                    <th>Median recorded total</th>
                    <th>Median sessions</th>
                    <th>History spans full window</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((c) => (
                    <tr key={c.label}>
                      <th>
                        {c.label}
                        {c.smallSample && <small>Small sample</small>}
                      </th>
                      <td>{fmt(c.members)}</td>
                      <td>{fmt(c.medianTotal)}</td>
                      <td>{fmt(c.medianSessions)}</td>
                      <td>
                        {fmt(c.windowSpanned)} / {fmt(c.members)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Programme domains and popular programmes</summary>
            <p>
              Domains overlap. “None recorded” is based on available history and
              does not establish inactivity.
            </p>
            <div className="sppb-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Programme Domain</th>
                    <th>Attending clients</th>
                    <th>Their median score</th>
                    <th>None recorded</th>
                    <th>Their median score</th>
                  </tr>
                </thead>
                <tbody>
                  {group.domains.map((d) => (
                    <tr key={d.label}>
                      <th>{d.label}</th>
                      <td>{fmt(d.attended.members)}</td>
                      <td>{fmt(d.attended.medianTotal)}</td>
                      <td>{fmt(d.noRecordedAttendance.members)}</td>
                      <td>{fmt(d.noRecordedAttendance.medianTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4>Most attended programmes in the pre-assessment windows</h4>
            <div className="sppb-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Programme</th>
                    <th>Centre</th>
                    <th>Clients</th>
                    <th>Distinct sessions</th>
                    <th>Median recorded total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.programmes.map((p) => (
                    <tr key={p.id}>
                      <th>{p.name}</th>
                      <td>
                        {CENTRES.find((c) => c.id === p.centre)?.name ||
                          p.centre}
                      </td>
                      <td>{fmt(p.members)}</td>
                      <td>{fmt(p.sessions)}</td>
                      <td>{fmt(p.medianTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {!!analysis.findings.length && (
        <div className="sppb-findings">
          <h4>What to review</h4>
          {analysis.findings.map((f, i) => (
            <p key={i}>
              <strong>{f.finding}</strong> {f.meaning} {f.next}
            </p>
          ))}
        </div>
      )}
      <details>
        <summary>Data coverage and definitions</summary>
        <p>
          {analysis.exclusions.noDatedAssessment} clients without a dated
          assessment; {analysis.exclusions.ambiguousLatest} with conflicting
          latest-day records; {analysis.exclusions.missingTotal} without a
          numeric latest total. These clients remain in registry and assessment
          totals.
        </p>
        <p>
          {analysis.historyUnavailable} scored clients have unavailable
          attendance history; {analysis.partialHistory} have history that does
          not span the full window. Group counts below five need particular
          caution.
        </p>
        <p>{analysis.note}</p>
      </details>
    </section>
  );
}
