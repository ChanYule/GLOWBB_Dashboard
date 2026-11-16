import { useMemo } from "react";
import {
  comparisonInsight,
  poolSmallGroups,
  reliableGroup,
  reliabilityOptions,
  sortGroups,
} from "../shared/participation-reliability.js";
import type {
  Proportion,
  ReliabilityGroup,
  ReliabilityOptions,
} from "../shared/participation-reliability.js";
import "./participation-reliability.css";

export type Reliability = ReliabilityOptions & { overall: Proportion | null };
const fmt = (v: number | null | undefined) =>
  v == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(v);

export function ParticipationRateChart({
  groups,
  dimension,
  reliability,
  sort = "label",
  pool = false,
  onSort,
  onPool,
  printing = false,
}: {
  groups: ReliabilityGroup[];
  dimension: string;
  reliability?: Reliability;
  sort?: string;
  pool?: boolean;
  onSort?: (sort: string) => void;
  onPool?: (pool: boolean) => void;
  printing?: boolean;
}) {
  const options = useMemo(() => reliabilityOptions(reliability), [reliability]);
  const overall = reliability?.overall?.rate;
  const pooled = useMemo(
    () => poolSmallGroups(groups, options),
    [groups, options],
  );
  const rows = useMemo(
    () =>
      sortGroups(groups, sort, dimension).map((g) => reliableGroup(g, options)),
    [groups, sort, dimension, options],
  );
  const insight = useMemo(
    () => comparisonInsight(groups, { dimension, options, pool }),
    [groups, dimension, pool, options],
  );
  const displayed =
    pool && pooled ? [...rows, reliableGroup(pooled, options)] : rows;
  return (
    <div className="participation-reliability">
      {!printing && (
        <div className="reliability-controls">
          <label>
            Sort groups
            <select
              aria-label="Sort participation groups"
              value={sort}
              onChange={(e) => onSort?.(e.target.value)}
            >
              <option value="label">Label (natural order)</option>
              <option value="rate">Participation rate (highest first)</option>
              <option value="size">
                Registered group size (largest first)
              </option>
            </select>
          </label>
          {pooled && (
            <button
              className="button"
              aria-pressed={pool}
              onClick={() => onPool?.(!pool)}
            >
              {pool ? "Remove pooled comparison" : "Pool small groups"}
            </button>
          )}
        </div>
      )}
      <p className="table-note">
        {overall == null
          ? "Overall rate unavailable; it is not assumed to be zero."
          : `Dashed line: overall participation ${fmt(overall)}%.`}{" "}
        Dot: recorded rate. Whisker: 95% plausible range. n = registered
        clients.
      </p>
      <p className="table-note">
        Small group, interpret with caution: fewer than {options.cautionMinimum}{" "}
        registered clients. Groups below {options.comparisonFloor} remain
        visible and are excluded from automatic comparisons.
      </p>
      {displayed.map((g) => {
        const difference =
          g.rate != null && overall != null ? g.rate - overall : null;
        return (
          <article
            className={`reliability-row${g.small ? " reliability-small" : ""}${g.pooled ? " reliability-pooled" : ""}`}
            key={g.pooled ? "__pooled__" : g.label}
          >
            <div className="reliability-row-heading">
              <strong>{g.label}</strong>
              <span>
                {fmt(g.rate)}
                {g.rate == null ? "" : "%"} · n=
                {g.suppressed ? "Withheld" : fmt(g.registered)}
              </span>
            </div>
            {g.rate != null && g.lower != null && g.upper != null ? (
              <>
                <div
                  className="reliability-track"
                  role="img"
                  aria-label={`${g.label}: ${g.n_participating} of ${g.n_registered}, ${fmt(g.rate)}%; 95% plausible range ${fmt(g.lower)} to ${fmt(g.upper)}%${overall == null ? "" : `; overall ${fmt(overall)}%`}`}
                >
                  <span
                    className="reliability-fill"
                    style={{ width: `${g.rate}%` }}
                  />
                  <span
                    className="reliability-interval"
                    style={{
                      left: `${g.lower}%`,
                      width: `${g.upper - g.lower}%`,
                    }}
                  />
                  <span
                    className="reliability-dot"
                    style={{ left: `${g.rate}%` }}
                  />
                  {overall != null && (
                    <span
                      className="reliability-reference"
                      style={{ left: `${overall}%` }}
                    />
                  )}
                </div>
                <p>
                  {g.n_participating} participating / {g.n_registered}{" "}
                  registered · plausible range {fmt(g.lower)}–{fmt(g.upper)}%
                  {difference == null
                    ? ""
                    : ` · ${difference > 0 ? "+" : ""}${fmt(difference)} pp vs overall`}
                </p>
              </>
            ) : (
              <p>
                {g.suppressed
                  ? "Withheld under existing access rules."
                  : "No valid registered-client rate or denominator. Missing is not zero."}
              </p>
            )}
            {g.small && (
              <p className="reliability-warning">
                Small group, interpret with caution.
                {g.registered != null && g.registered < options.comparisonFloor
                  ? " Excluded from automatic highest/lowest comparisons."
                  : ""}
              </p>
            )}
            {g.pooled && (
              <p>
                Additional comparison combining {g.sourceLabels?.length}{" "}
                disjoint known groups below {options.cautionMinimum}. Original
                groups remain above; do not add this row to their totals.
              </p>
            )}
          </article>
        );
      })}
      <p className="table-note">{insight.note}</p>
      {pool && pooled && (
        <p>
          <strong>Pooled comparison:</strong> {insight.answer}
        </p>
      )}
      <p className="table-note">
        Participation means attending at least once in this reporting period,
        not a booked-session attendance rate. Counts are exact recorded values;
        plausible ranges indicate instability under a simple model. They do not
        repair missing history, establish historical membership or prove cause.
        Group and overall figures overlap, so the percentage-point difference is
        descriptive.
      </p>
    </div>
  );
}
