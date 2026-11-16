import { useState } from "react";
import type { RegistrationContext } from "../shared/registration-context.js";
import { MetricHelp } from "./metric-help";
const fmt = (n: number | null) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export function RegistrationRate({
  value,
  printing = false,
  forceShow = false,
  populationLabel = "Current client view",
}: {
  value?: RegistrationContext | null;
  printing?: boolean;
  forceShow?: boolean;
  populationLabel?: string;
}) {
  const [show, setShow] = useState(false);
  if (!value) return null;
  return (
    <section className="registration-rate">
      {!printing && (
        <label>
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />{" "}
          Show known-registration comparison rate
        </label>
      )}
      {(show || printing || forceShow) && (
        <>
          <h3>Known registered by coverage start</h3>
          <strong>
            {value.rate == null ? "Unavailable" : fmt(value.rate) + "%"} ·{" "}
            {fmt(value.n_participating)} / {fmt(value.n_registered)} clients
          </strong>
          <p>
            Population: {populationLabel}. The original participation rate and
            its denominator remain unchanged.
          </p>
          <MetricHelp
            label="Known-registration comparison rate"
            definition={`Participating clients in the selected period/domain divided by clients with a valid registration date on or before ${value.coverageStart}. This is a separate comparison; the full-registry participation rate remains unchanged.`}
          />
          <p>
            Includes only known registration dates on/before{" "}
            {value.coverageStart}. Excluded: {value.excludedUnknown}{" "}
            missing/invalid dates and {value.excludedAfterStart} registrations
            after coverage start. Plausible range {fmt(value.lower)}–
            {fmt(value.upper)}%. Current registry records do not establish a
            historical census; this does not correct missing attendance or
            profile bias.
          </p>
        </>
      )}
    </section>
  );
}
