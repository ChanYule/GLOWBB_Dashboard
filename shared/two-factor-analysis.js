import {
  participationProportion,
  reliabilityOptions,
  sortGroups,
  unknownGroup,
  CFS_ORDER,
} from "./participation-reliability.js";

// Consume only already released aggregate cells. Never pool overlapping cells
// or reconstruct a withheld margin from its neighbours.
export function twoFactorAnalysis({
  combined,
  dimensions,
  ratesAvailable,
  overall,
  reliability,
}) {
  if (!combined) return null;
  const config = reliabilityOptions(reliability);
  const base = {
    dimensions,
    ...config,
    overall,
    rows: [],
    columns: [],
    cells: [],
    findings: [],
  };
  if (combined.suppressed)
    return { ...base, overall: null, status: "withheld" };
  const cells = combined.rows.map((row) => {
    const counts = participationProportion(row.unique, row.registered);
    const validRate = ratesAvailable && row.rate != null && counts.rate != null;
    const unknown = row.groups.some(
      (label, index) =>
        unknownGroup(label) ||
        /^prefers not to say$/i.test(label.trim()) ||
        (dimensions[index] === "cfs" && !CFS_ORDER.includes(label)),
    );
    const small =
      counts.n_registered != null &&
      counts.n_registered > 0 &&
      counts.n_registered < config.cautionMinimum;
    // Both reliability thresholds apply to this decision panel: keep every
    // released small cell visible, but do not promote it as an outreach finding.
    const eligible =
      validRate &&
      !unknown &&
      counts.n_registered >= config.cautionMinimum &&
      counts.n_registered >= config.comparisonFloor;
    return {
      groups: row.groups,
      ...counts,
      n_participating:
        row.registered == null && Number.isSafeInteger(row.unique)
          ? row.unique
          : counts.n_participating,
      rate: validRate ? counts.rate : null,
      lower: validRate ? counts.lower : null,
      upper: validRate ? counts.upper : null,
      small,
      unknown,
      eligible,
      supportIndicators: row.supportIndicators || [],
      belowOverall: !!(
        eligible &&
        overall?.lower != null &&
        counts.upper < overall.lower
      ),
    };
  });
  const labels = (index) =>
    sortGroups(
      [...new Set(cells.map((c) => c.groups[index]))].map((label) => ({
        label,
      })),
      "label",
      dimensions[index],
    ).map((g) => g.label);
  const findings = cells
    .filter((c) => c.belowOverall && c.supportIndicators.length)
    .sort(
      (a, b) =>
        a.rate - b.rate ||
        b.n_registered - a.n_registered ||
        JSON.stringify(a.groups).localeCompare(JSON.stringify(b.groups)),
    );
  return {
    ...base,
    status: ratesAvailable ? "ready" : "unavailable",
    rows: labels(0),
    columns: labels(1),
    cells,
    findings,
    exclusions: {
      small: cells.filter((c) => c.small).length,
      belowFloor: cells.filter(
        (c) => c.n_registered > 0 && c.n_registered < config.comparisonFloor,
      ).length,
      unknown: cells.filter((c) => c.unknown).length,
      unavailable: cells.filter((c) => c.rate == null).length,
    },
  };
}
