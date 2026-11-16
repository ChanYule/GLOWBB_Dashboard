// Reliability is separate from staff visibility and privacy permissions.
export const DEFAULT_RELIABILITY = Object.freeze({
  cautionMinimum: 20,
  comparisonFloor: 10,
});
export const CFS_ORDER = [
  "CFS 1 to 3",
  "CFS 4",
  "CFS 5",
  "CFS 6",
  "CFS 7 to 8",
];
const AGE_ORDER = ["Below 60", "60 to 69", "70 to 79", "80 and above"];
const fmt = (n) =>
  new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);

export function reliabilityOptions(value = {}) {
  const cautionMinimum =
    Number.isInteger(value.cautionMinimum) &&
    value.cautionMinimum >= 2 &&
    value.cautionMinimum <= 1000
      ? value.cautionMinimum
      : DEFAULT_RELIABILITY.cautionMinimum;
  const comparisonFloor =
    Number.isInteger(value.comparisonFloor) &&
    value.comparisonFloor >= 1 &&
    value.comparisonFloor <= cautionMinimum
      ? value.comparisonFloor
      : Math.min(DEFAULT_RELIABILITY.comparisonFloor, cautionMinimum);
  return { cautionMinimum, comparisonFloor };
}

// Two-sided 95% Wilson score interval, with z = normal quantile(0.975).
// https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
// Counts are exact recorded values, not estimates. The interval is a model-based
// indication of instability; it does not correct incomplete/biased attendance.
export function participationProportion(n_participating, n_registered) {
  const valid =
    Number.isSafeInteger(n_registered) &&
    n_registered >= 0 &&
    Number.isSafeInteger(n_participating) &&
    n_participating >= 0 &&
    n_participating <= n_registered;
  if (!valid)
    return {
      n_registered: null,
      n_participating: null,
      rate: null,
      lower: null,
      upper: null,
    };
  if (!n_registered)
    return {
      n_registered,
      n_participating,
      rate: null,
      lower: null,
      upper: null,
    };
  const z = 1.959963984540054,
    z2 = z * z,
    p = n_participating / n_registered;
  const divisor = 1 + z2 / n_registered;
  const centre = (p + z2 / (2 * n_registered)) / divisor;
  const half =
    (z *
      Math.sqrt((p * (1 - p)) / n_registered + z2 / (4 * n_registered ** 2))) /
    divisor;
  return {
    n_registered,
    n_participating,
    rate: p * 100,
    lower: n_participating === 0 ? 0 : Math.max(0, (centre - half) * 100),
    upper:
      n_participating === n_registered
        ? 100
        : Math.min(100, (centre + half) * 100),
  };
}

export function unknownGroup(label) {
  // A recorded block number with an unverified-address suffix is still a known
  // block category. It must not be mistaken for an unknown residential address.
  return /^(missing|unknown|not assessed|not recorded|not available|unmapped|invalid age|distance unknown|unverified residential address|age not recorded|block unknown|block missing)(\b|$)/i.test(
    label.trim(),
  );
}

export function reliableGroup(group, options = DEFAULT_RELIABILITY) {
  const { cautionMinimum, comparisonFloor } = reliabilityOptions(options);
  const stats = participationProportion(
    group.suppressed || group.rate == null ? null : group.unique,
    group.suppressed ? null : group.registered,
  );
  return {
    ...group,
    ...stats,
    small: stats.n_registered != null && stats.n_registered < cautionMinimum,
    eligible:
      !unknownGroup(group.label) &&
      stats.rate != null &&
      stats.n_registered >= comparisonFloor,
  };
}

export function sortGroups(groups, order = "label", dimension = "") {
  const natural = (a, b) => {
    const sequence =
      dimension === "age" ? AGE_ORDER : dimension === "cfs" ? CFS_ORDER : [];
    const ai = sequence.indexOf(a.label),
      bi = sequence.indexOf(b.label);
    return (
      (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) ||
      a.label.localeCompare(b.label, "en", { numeric: true })
    );
  };
  return [...groups].sort(
    (a, b) =>
      (order === "rate"
        ? (b.rate ?? -Infinity) - (a.rate ?? -Infinity)
        : order === "size"
          ? (b.registered ?? -Infinity) - (a.registered ?? -Infinity)
          : 0) || natural(a, b),
  );
}

// Only disjoint, single-characteristic groups may be pooled. Do not call this
// for overlapping Event Types, programme audiences or combined-cell marginals.
// Original groups remain unchanged and available separately.
export function poolSmallGroups(groups, options = DEFAULT_RELIABILITY) {
  const config = reliabilityOptions(options);
  const small = groups
    .map((g) => reliableGroup(g, config))
    .filter(
      (g) =>
        !g.suppressed &&
        !unknownGroup(g.label) &&
        g.rate != null &&
        g.n_registered > 0 &&
        g.n_registered < config.cautionMinimum,
    );
  if (small.length < 2) return null;
  const registered = small.reduce((n, g) => n + g.n_registered, 0);
  const unique = small.reduce((n, g) => n + g.n_participating, 0);
  return {
    label: "Other (small groups combined)",
    registered,
    unique,
    rate: participationProportion(unique, registered).rate,
    suppressed: false,
    pooled: true,
    sourceLabels: small.map((g) => g.label),
  };
}

export function comparisonInsight(
  groups,
  { dimension = "", options = DEFAULT_RELIABILITY, pool = false } = {},
) {
  const config = reliabilityOptions(options);
  const original = groups.map((g) => reliableGroup(g, config));
  const pooled = poolSmallGroups(groups, config);
  const candidates =
    pool && pooled
      ? [
          ...original.filter((g) => !pooled.sourceLabels.includes(g.label)),
          reliableGroup(pooled, config),
        ]
      : original;
  // A pooled CFS bucket has no ordinal interpretation; compare it descriptively.
  const orderedCfs = dimension === "cfs" && !(pool && pooled);
  const eligible = candidates.filter(
    (g) => g.eligible && (!orderedCfs || CFS_ORDER.includes(g.label)),
  );
  const excluded = {
    belowFloor: original.filter(
      (g) =>
        !g.suppressed &&
        g.rate != null &&
        !unknownGroup(g.label) &&
        g.n_registered > 0 &&
        g.n_registered < config.comparisonFloor,
    ).length,
    cautious: original.filter(
      (g) =>
        !g.suppressed &&
        g.rate != null &&
        !unknownGroup(g.label) &&
        g.n_registered > 0 &&
        g.n_registered < config.cautionMinimum,
    ).length,
    unknown: original.filter((g) => unknownGroup(g.label)).length,
    unavailable: original.filter(
      (g) => !unknownGroup(g.label) && (g.suppressed || g.rate == null),
    ).length,
    unrecognised: orderedCfs
      ? original.filter(
          (g) =>
            !unknownGroup(g.label) &&
            g.rate != null &&
            !CFS_ORDER.includes(g.label),
        ).length
      : 0,
  };
  const reasons = `${excluded.belowFloor} of ${original.length} groups have fewer than ${config.comparisonFloor} registered clients; ${excluded.cautious} have fewer than ${config.cautionMinimum}. ${excluded.unknown} unknown, ${excluded.unavailable} unavailable/withheld${orderedCfs ? `, ${excluded.unrecognised} non-standard CFS` : ""} groups are excluded from automatic comparisons.`;
  const note = `${reasons} All original groups remain available. Counts describe the available records. Plausible ranges are 95% model-based ranges, not corrections for missing history or a test of causes. Comparing the extremes of many groups can exaggerate differences.${dimension === 'cfs' && pool && pooled ? ' Combined CFS groups have no ordered meaning; this pooled comparison does not establish whether participation falls as CFS rises.' : ''}`;
  if (eligible.length < 2)
    return {
      answer: `Not enough comparable groups: ${eligible.length} meet the comparison rules. ${reasons}`,
      note,
      rows: original,
      eligibleCount: eligible.length,
      poolAvailable: !!pooled,
      pooled,
      overlap: null,
    };
  const ranked = orderedCfs
    ? sortGroups(eligible, "label", "cfs")
    : [...eligible].sort(
        (a, b) =>
          a.rate - b.rate ||
          a.label.localeCompare(b.label, "en", { numeric: true }),
      );
  const low = ranked[0],
    high = ranked.at(-1);
  const overlap =
    Math.max(low.lower, high.lower) <= Math.min(low.upper, high.upper);
  const evidence = (g) =>
    `${g.label}: ${g.n_participating} of ${g.n_registered} (${fmt(g.rate)}%; plausible range ${fmt(g.lower)}–${fmt(g.upper)}%)`;
  const gap = Math.round((high.rate - low.rate) * 10) / 10;
  const comparison = orderedCfs
    ? `${evidence(high)}, compared with ${evidence(low)} (${fmt(Math.abs(gap))} percentage points ${gap < 0 ? "lower" : gap > 0 ? "higher" : "difference"}). This compares the lowest and highest available CFS bands; it does not establish a trend or cause.`
    : `${evidence(low)}${low.rate === high.rate ? `. All ${eligible.length} comparable groups have the same recorded participation rate (${fmt(low.rate)}%).` : ` has the lowest recorded participation, compared with ${evidence(high)} (${fmt(Math.abs(gap))} percentage points apart).`}`;
  const confidence = overlap
    ? "Their plausible ranges overlap: the recorded difference is too uncertain to distinguish clearly."
    : "Their plausible ranges do not overlap: a clearer observed difference, not proof of a cause or a formal significance test.";
  return {
    answer: `${comparison} ${confidence}${low.small || high.small ? " Small group, interpret with caution." : ""}`,
    note,
    rows: original,
    eligibleCount: eligible.length,
    poolAvailable: !!pooled,
    pooled,
    overlap,
  };
}
