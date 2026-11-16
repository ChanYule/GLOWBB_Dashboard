export const DEFAULT_OUTREACH_RULES = Object.freeze({
  noHistoryPoints: 30,
  inactivePoints: 40,
  noneInViewPoints: 10,
  highCfsFrom: 7,
  cfsPoints: 10,
  alonePoints: 10,
  srfPoints: 10,
  gapPointsPer30: 2,
  maxGapPoints: 12,
  riskCodes: [],
  watchPercent: 80,
  fallbackWatchDays: 21,
  typicalMinDates: 4,
  recentRegistrationDays: 90,
});
export const OUTREACH_RULE_FIELDS = [
  ["noHistoryPoints", "No recorded history: base points", 0, 100],
  ["inactivePoints", "Existing inactive status: base points", 0, 100],
  ["noneInViewPoints", "No attendance matching this view: base points", 0, 100],
  ["highCfsFrom", "CFS support indicator starts at", 1, 8],
  ["cfsPoints", "Recorded CFS indicator: additional points", 0, 100],
  ["alonePoints", "Recorded living alone: additional points", 0, 100],
  ["srfPoints", "Approved SRF indicator: additional points", 0, 100],
  [
    "gapPointsPer30",
    "Points per complete 30-day gap (covered dates only)",
    0,
    100,
  ],
  ["maxGapPoints", "Maximum gap points", 0, 100],
  ["watchPercent", "Watchlist starts at this % of typical interval", 10, 100],
  ["fallbackWatchDays", "Watchlist fallback gap in days", 1, 3650],
  [
    "typicalMinDates",
    "Minimum distinct attendance dates for typical interval",
    3,
    30,
  ],
  [
    "recentRegistrationDays",
    "Recent-registration cohort length in days",
    30,
    365,
  ],
];
export const OUTREACH_EXPORT_COLUMNS = [
  "Member ID",
  "Recorded block",
  "Attendance flag",
  "Last recorded attendance",
  "Assigned staff",
  "Last contact date",
];
export function validOutreachRules(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => Object.hasOwn(DEFAULT_OUTREACH_RULES, k)) &&
    OUTREACH_RULE_FIELDS.every(
      ([key, , min, max]) =>
        Number.isInteger(value[key]) && value[key] >= min && value[key] <= max,
    ) &&
    Array.isArray(value.riskCodes) &&
    value.riskCodes.length <= 50 &&
    value.riskCodes.every(
      (c) => typeof c === "string" && !!c.trim() && c.length <= 100,
    )
  );
}
export function outreachRules(value) {
  return validOutreachRules(value)
    ? {
        ...value,
        riskCodes: [...new Set(value.riskCodes.map((c) => c.trim()))],
      }
    : { ...DEFAULT_OUTREACH_RULES, riskCodes: [] };
}
const missing = (value) =>
  value == null ||
  /^(unknown|missing|not recorded|not assessed|prefers not to say)?$/i.test(
    String(value).trim(),
  );
export function supportIndicators(person, settings, rules) {
  const indicators = [],
    missingFields = [];
  const assessed = person.profile?.health;
  const cfs =
    assessed?.cfs &&
    (!assessed.cfsAssessedOn || assessed.cfsAssessedOn <= person.asOf)
      ? assessed.cfs
      : person.cfs;
  const match = String(cfs ?? "")
    .replace(/^CFS\s*/i, "")
    .trim()
    .match(/^([1-8])(?:\s*(?:-|–|to)\s*([1-8]))?$/);
  if (match && (!match[2] || Number(match[2]) >= Number(match[1]))) {
    if (Number(match[1]) >= rules.highCfsFrom)
      indicators.push({
        key: "cfs",
        label: `Recorded CFS ${String(cfs)}`,
        points: rules.cfsPoints,
      });
    else if (match[2] && Number(match[2]) >= rules.highCfsFrom)
      missingFields.push("CFS band crosses the configured boundary");
  } else missingFields.push("CFS missing or not a standard numeric band");
  const living = settings.livingGroups?.[person.livingRaw] || person.livingRaw;
  if (living === "Alone")
    indicators.push({
      key: "alone",
      label: "Recorded living alone",
      points: rules.alonePoints,
    });
  else if (missing(living))
    missingFields.push("Living arrangement not recorded");
  const risk = person.profile?.social?.riskRaw ?? person.riskRaw;
  const mapping = settings.riskMappings?.[risk];
  if (missing(risk) || !mapping?.meaning?.trim())
    missingFields.push("SRF missing or not documented");
  if (
    rules.riskCodes.includes(String(risk)) &&
    mapping?.meaning?.trim() &&
    mapping.noRisk === false
  )
    indicators.push({
      key: "srf",
      label: `Recorded SRF ${risk} · ${mapping.label || "documented indicator"}`,
      points: rules.srfPoints,
    });
  return { indicators, missingFields };
}
export function priorityScore(person, settings, rules, historyCurrent) {
  const support = supportIndicators(person, settings, rules);
  const inactive = historyCurrent && person.status.startsWith("inactive");
  const noHistory = person.last === null;
  const noneInView = person.selectedSessions === 0;
  const reasons = [];
  if (inactive)
    reasons.push({
      key: "inactive",
      label: `Inactive ${person.days} days under existing rules`,
      points: rules.inactivePoints,
    });
  else if (noHistory)
    reasons.push({
      key: "noHistory",
      label: "No recorded attendance history",
      points: rules.noHistoryPoints,
    });
  else if (noneInView)
    reasons.push({
      key: "noneInView",
      label: "No recorded attendance matching this period/filter",
      points: rules.noneInViewPoints,
    });
  reasons.push(...support.indicators);
  if (historyCurrent && Number.isInteger(person.days) && person.days >= 30)
    reasons.push({
      key: "gap",
      label: `Recorded gap ${person.days} days`,
      points: Math.min(
        rules.maxGapPoints,
        Math.floor(person.days / 30) * rules.gapPointsPer30,
      ),
    });
  return {
    score: reasons.reduce((sum, r) => sum + r.points, 0),
    reasons,
    indicators: support.indicators.map((i) => i.key),
    missingFields: support.missingFields,
    inactive,
    noHistory,
    noneInView,
    eligible: inactive || noneInView,
  };
}
export function lapsingWatch(person, dates, rules, historyCurrent) {
  if (!historyCurrent || person.status !== "active" || person.days == null)
    return null;
  const unique = [...new Set(dates)].sort();
  const gaps = unique
    .slice(1)
    .map((date, i) => (Date.parse(date) - Date.parse(unique[i])) / 86400000)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const enough = unique.length >= rules.typicalMinDates;
  const mid = (gaps.length - 1) / 2;
  const typical =
    enough && gaps.length
      ? (gaps[Math.floor(mid)] + gaps[Math.ceil(mid)]) / 2
      : null;
  const threshold =
    typical == null
      ? rules.fallbackWatchDays
      : Math.max(1, Math.ceil((typical * rules.watchPercent) / 100));
  if (person.days < threshold) return null;
  return {
    typicalDays: typical,
    thresholdDays: threshold,
    label:
      typical == null
        ? `Active watchlist: ${person.days}-day gap; fixed ${threshold}-day fallback (insufficient repeated dates)`
        : `Active watchlist: ${person.days}-day gap; typical ${typical} days; threshold ${threshold} days`,
  };
}
