import { hash, todaySG } from "./domain.js";
import { validDay } from "./client-domain.js";

export const PENDING = "Imported SPPB score, scoring validation pending";
export const sppbDefaults = {
  revision: 1,
  intervalMonths: null,
  approachDays: 30,
  definitions: [],
};
export const sppbHeaders = [
  "Member ID",
  "Date of Assessment",
  "Total Balance Test Score",
  "Gait Speed Test score",
  "Chair Stand Test score",
  "Total Score",
];
export const sppbFail = (status, message) =>
  Object.assign(Error(message), { status });
export function assessmentDay(value, date1904 = false) {
  if (value == null || String(value).trim() === "") return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10)
      : null;
  const text = String(value).trim();
  if (validDay(text)) return text;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (
      serial < (date1904 ? 0 : 1) ||
      serial > 100000 ||
      (!date1904 && Math.floor(serial) === 60)
    )
      return null;
    return new Date(
      Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) +
        (Math.floor(serial) + (!date1904 && serial < 60 ? 1 : 0)) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  }
  if (
    /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}(?: \(.+\))?$/.test(
      text,
    )
  ) {
    const date = new Date(text);
    return Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : null;
  }
  return null;
}
const score = (value) =>
  value == null || String(value).trim() === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
export function standardScores(scores) {
  return (
    ["balance", "gait", "chair"].every(
      (k) => Number.isInteger(scores[k]) && scores[k] >= 0 && scores[k] <= 4,
    ) &&
    Number.isInteger(scores.total) &&
    scores.total >= 0 &&
    scores.total <= 12 &&
    scores.balance + scores.gait + scores.chair === scores.total
  );
}
export function parseSppb(
  matrix,
  {
    sourceDefinition = "caritahub-export-unverified",
    date1904 = false,
    now = todaySG(),
  } = {},
) {
  const headers = (matrix[0] || []).map((v) => String(v ?? "").trim());
  for (const h of sppbHeaders)
    if (headers.filter((v) => v === h).length !== 1)
      throw sppbFail(400, "Exactly one required SPPB column is needed: " + h);
  const rows = [],
    issues = [];
  for (let i = 1; i < matrix.length; i++) {
    const values = matrix[i];
    if (values.every((v) => v == null || String(v).trim() === "")) continue;
    const cell = (h) => values[headers.indexOf(h)];
    const memberId = String(cell("Member ID") ?? "").trim();
    const raw = headers.map((header, index) => ({
      column: index + 1,
      header,
      value: values[index] ?? "",
    }));
    const date = assessmentDay(cell("Date of Assessment"), date1904);
    const original = {
      balance: score(cell("Total Balance Test Score")),
      gait: score(cell("Gait Speed Test score")),
      chair: score(cell("Chair Stand Test score")),
      total: score(cell("Total Score")),
    };
    const warnings = [];
    const validId =
      memberId.length > 0 &&
      memberId.length <= 200 &&
      ![...memberId].some((character) => character.charCodeAt(0) < 32);
    if (!validId) warnings.push("Invalid or missing Member ID");
    if (!date) warnings.push("Assessment date unavailable or invalid");
    if (date && date > now) warnings.push("Assessment date is in the future");
    if (Object.values(original).some((v) => v == null))
      warnings.push("Missing or invalid recorded score");
    if (!standardScores(original))
      warnings.push("Recorded scores do not meet standard SPPB ranges or sum");
    if (
      Object.values(original).every((v) => v != null) &&
      original.balance + original.gait + original.chair !== original.total
    )
      warnings.push("Recorded component sum differs from total");
    const identity = hash([memberId]);
    // ExcelJS date text includes the host timezone. Canonicalise it for
    // identity only; retain the original displayed source cells separately.
    const identityCells = raw.map((cell) => {
      const value = cell.value;
      const nativeDate =
        value instanceof Date ||
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}(?: \(.+\))?$/.test(
          String(value),
        );
      return nativeDate && Number.isFinite(new Date(value).getTime())
        ? { ...cell, value: new Date(value).toISOString() }
        : cell;
    });
    const fingerprint = hash(["sppb-v1", memberId, identityCells]);
    rows.push({
      id: fingerprint,
      memberKey: validId ? identity : null,
      memberId,
      date,
      original,
      sourceDefinition,
      importedSourceDefinition: sourceDefinition,
      location: "Unknown",
      raw,
      sourceRow: i + 1,
      warnings,
    });
    if (warnings.length) issues.push({ row: i + 1, warnings });
  }
  if (!rows.length)
    throw sppbFail(400, "No SPPB assessment records were found.");
  return { rows, issues };
}
export function conflictGroups(records) {
  const groups = new Map();
  for (const r of records)
    if (r.memberKey && r.date && r.review?.disposition !== "superseded") {
      const key = r.memberKey + ":" + r.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
  return [...groups.values()].filter(
    (rows) =>
      rows.length > 1 &&
      !rows.every((r) => r.review?.disposition === "separate"),
  );
}
export function scoredRecord(
  record,
  config,
  conflicts = new Set(),
  now = todaySG(),
) {
  const definition = config.definitions.find(
    (d) => d.sourceDefinition === record.sourceDefinition && d.approved,
  );
  let standard = null,
    version = null;
  if (
    definition &&
    record.review?.standard &&
    record.review.scoringVersion === definition.version &&
    standardScores(record.review.standard)
  ) {
    standard = record.review.standard;
    version = definition.version;
  } else if (
    definition?.method === "identity" &&
    standardScores(record.original)
  ) {
    standard = record.original;
    version = definition.version;
  }
  const blocked =
    !record.date ||
    record.date > now ||
    conflicts.has(record.id) ||
    record.review?.disposition === "superseded";
  return {
    ...record,
    standard: blocked ? null : standard,
    scoringVersion: blocked ? null : version,
    validation: conflicts.has(record.id)
      ? "Conflicting same-day assessments"
      : record.review?.disposition === "superseded"
        ? "Superseded source record"
        : blocked || !standard
          ? PENDING
          : "Validated standard SPPB score",
    conflict: conflicts.has(record.id),
  };
}
export function reassessment(
  date,
  config,
  now = todaySG(),
  hasRecords = false,
) {
  if (!date)
    return {
      status: hasRecords
        ? "Assessment date unavailable"
        : "No recorded assessment",
      due: null,
      days: null,
    };
  const days = Math.floor((Date.parse(now) - Date.parse(date)) / 86400000);
  if (config.intervalMonths == null)
    return { status: "Follow-up interval not configured", due: null, days };
  const start = new Date(date + "T00:00:00Z"),
    month = start.getUTCMonth() + config.intervalMonths;
  const end = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0));
  const due = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      month,
      Math.min(start.getUTCDate(), end.getUTCDate()),
    ),
  )
    .toISOString()
    .slice(0, 10);
  const until = Math.floor((Date.parse(due) - Date.parse(now)) / 86400000);
  return {
    status:
      until < 0
        ? "Overdue"
        : until === 0
          ? "Reassessment due"
          : until <= config.approachDays
            ? "Approaching reassessment date"
            : "Recently assessed",
    due,
    days,
  };
}
export function memberSummary(member, records, config, now = todaySG()) {
  const conflictIds = new Set(
    conflictGroups(records)
      .flat()
      .map((r) => r.id),
  );
  const all = records.map((r) => scoredRecord(r, config, conflictIds, now));
  const active = all.filter((r) => r.review?.disposition !== "superseded");
  const dated = active
    .filter((r) => r.date && r.date <= now)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const latestDate = dated[0]?.date || null;
  const latestDay = dated.filter((r) => r.date === latestDate);
  const latest = latestDay.length === 1 ? latestDay[0] : null;
  const comparable = dated.filter(
    (r) =>
      r.standard &&
      r.date < latestDate &&
      r.scoringVersion === latest?.scoringVersion,
  );
  // Multiple distinct tests on one date remain visible but have no ordering
  // without a verified time; choose neither for an automatic comparison.
  const previousDate = comparable[0]?.date;
  const previousDay = comparable.filter((r) => r.date === previousDate);
  const previous =
    latest?.standard && previousDay.length === 1 ? previousDay[0] : null;
  const delta =
    previous && latest?.standard
      ? latest.standard.total - previous.standard.total
      : null;
  return {
    ...member,
    count: records.length,
    distinctDates: new Set(dated.map((r) => r.date)).size,
    latestDate,
    latest,
    previous,
    delta,
    change:
      delta == null
        ? dated.some((r) => !r.standard) || latestDay.length > 1
          ? "Validation required"
          : "Insufficient comparable assessments"
        : delta > 0
          ? "Score increased"
          : delta < 0
            ? "Score decreased"
            : "No score change",
    followup: reassessment(latestDate, config, now, records.length > 0),
    reviewRequired: all.some(
      (r) => r.warnings.length || r.conflict || !r.standard,
    ),
    records: all,
  };
}
