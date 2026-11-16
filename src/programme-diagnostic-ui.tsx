import type {
  ProgrammeDiagnostic,
  Representation,
  DomainMix,
} from "../shared/programme-diagnostics.js";
import {MetricHelp} from './metric-help';
import "./programme-diagnostics.css";
const fmt = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export function ProgrammeDiagnosticLabels({
  diagnostics,
  representation,
  showRepresentation = false,
  audience = "people",
}: {
  diagnostics?: ProgrammeDiagnostic | null;
  representation?: Representation | null;
  showRepresentation?: boolean;
  audience?: string;
}) {
  if (!diagnostics) return <small>Programme diagnostics unavailable.</small>;
  return (
    <div className="programme-diagnostic-labels">
      <span>
        <strong>
          Repeat attendance:{" "}
          {diagnostics.repeatRate == null
            ? "Unavailable"
            : fmt(diagnostics.repeatRate) + "%"}
        </strong>{" "}
        · {audience} attending 2+ sessions ÷ unique {audience}
      </span>
      <MetricHelp label="Programme repeat attendance" definition="Unique programme attendees with two or more distinct sessions divided by all unique programme attendees in the selected reporting period and filters. The senior-based Programme Analysis table and the selected-group view retain their labelled audiences; one delivered session has limited repeat opportunity."/>
      {diagnostics.singleSession && (
        <small>One delivered session: repeat opportunity was limited.</small>
      )}
      {diagnostics.smallSample && (
        <small className="diagnostic-caution">
          Small sample · fewer than {diagnostics.smallReachBelow} unique{" "}
          {audience}. Counts do not establish popularity.
        </small>
      )}
      {diagnostics.oneOffDraw && (
        <small className="diagnostic-caution">
          One-off draw signal · {diagnostics.reasons.join("; ")}. Review
          delivery and attendance history; this is not a programme-quality
          judgement.
        </small>
      )}
      {diagnostics.oneOffDraw == null && (
        <small>
          One-off draw diagnostic unavailable; withheld values are not zero.
        </small>
      )}
      {showRepresentation &&
        (representation ? (
          <div className="programme-representation">
            <MetricHelp label="Representation" definition="The selected group's unique registered-client programme attendees divided by all eligible registered-client attendees of that programme, compared with the group's registered clients divided by the same eligible registry. The selected period/domain applies. Differences are percentage points; the ratio is not a causal or significance test."/>
            <strong>Representation</strong>: group is{" "}
            {representation.groupAttendees} /{" "}
            {representation.programmeAttendees} registered-client attendees (
            {fmt(representation.attendeeShare)}%), compared with{" "}
            {representation.groupRegistered} / {representation.registered}{" "}
            registered clients ({fmt(representation.registeredShare)}%).
            Difference: {fmt(representation.differencePoints)} percentage points
            {representation.ratio == null
              ? ""
              : `; ${fmt(representation.ratio)}× the registry share`}
            . Descriptive comparison, not evidence of a cause or unmet need.
          </div>
        ) : (
          <small>
            Representation unavailable: requires a complete registered-client
            population and releasable group/programme totals.
          </small>
        ))}
    </div>
  );
}

export function ProgrammeDomainMix({ mix }: { mix?: DomainMix | null }) {
  if (!mix) return null;
  return (
    <section className="programme-domain-mix">
      <h3>Selected group: primary domain mix</h3>
      {mix.suppressed ? (
        <p>
          Domain mix is withheld by the existing privacy rules. Missing and
          withheld values are not zero.
        </p>
      ) : !mix.available ? (
        <p>Domain mix is unavailable without attendance coverage.</p>
      ) : (
        <>
          <p>
            {fmt(mix.unique)} unique people attended; {fmt(mix.attendance)}{" "}
            attendance entries in this period/domain. A person may appear in
            several domains; do not add unique counts or attendee percentages.
            Entry shares use all group entries and sum to 100% when available.
          </p>
          <div className="work-table">
            <table>
              <caption>Recorded primary domains for the selected group</caption>
              <thead>
                <tr>
                  <th scope="col">Primary domain</th>
                  <th scope="col">Unique people</th>
                  <th scope="col">% of group attendees</th>
                  <th scope="col">Entries</th>
                  <th scope="col">% of group entries</th>
                </tr>
              </thead>
              <tbody>
                {mix.rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{r.unique}</td>
                    <td>
                      {r.attendeeShare == null
                        ? "Unavailable"
                        : fmt(r.attendeeShare) + "%"}
                    </td>
                    <td>{fmt(r.attendance)}</td>
                    <td>
                      {r.entryShare == null
                        ? "Unavailable"
                        : fmt(r.entryShare) + "%"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            Learning, Physical, Social and Cognitive are shown alongside other
            recorded primary-domain labels. Event Types are not reassigned or
            added as primary-domain entries. Zero means no matching recorded
            attendance, not no interest or no support need.
          </small>
        </>
      )}
    </section>
  );
}
