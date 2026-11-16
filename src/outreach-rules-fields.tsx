import { useState } from "react";
import {
  OUTREACH_RULE_FIELDS,
  DEFAULT_OUTREACH_RULES,
} from "../shared/outreach-priority-rules.js";
import type { OutreachRules } from "../shared/outreach-priority-rules.js";
export function OutreachRulesFields({
  value,
  onChange,
}: {
  value?: OutreachRules;
  onChange: (value: OutreachRules) => void;
}) {
  const rules = {
    ...DEFAULT_OUTREACH_RULES,
    ...value,
    riskCodes: value?.riskCodes || [],
  };
  const [codes, setCodes] = useState(rules.riskCodes.join(", "));
  return (
    <fieldset>
      <legend>Outreach follow-up priority rules</legend>
      <p>
        Editable review priorities, not clinical risk or eligibility. One
        attendance base applies; recorded support indicators and covered-date
        gap points are added. Viewing a priority never sends a message or saves
        an action.
      </p>
      <details>
        <summary>Configure score weights and watchlist rules</summary>
        <div className="form-row">
          {OUTREACH_RULE_FIELDS.map(([key, label, min, max]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                required
                value={rules[key]}
                onChange={(e) =>
                  onChange({ ...rules, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <label className="field">
          <span>SRF codes to prioritise (comma-separated)</span>
          <input
            value={codes}
            maxLength={5000}
            onChange={(e) => {
              setCodes(e.target.value);
              onChange({
                ...rules,
                riskCodes: e.target.value
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean),
              });
            }}
          />
        </label>
        <p>
          SRF points only apply to selected codes with an existing documented,
          non-no-risk mapping. Raw 0, 1 and &gt;1 have no assumed order. No
          codes are selected by default. Missing profiles are not evidence of no
          support needs. Watchlist uses existing active status and a median gap
          between distinct attendance dates; insufficient dates use the
          documented fallback.
        </p>
      </details>
    </fieldset>
  );
}
