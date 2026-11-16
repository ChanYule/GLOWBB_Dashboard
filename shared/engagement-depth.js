export const DEFAULT_ENGAGEMENT = Object.freeze({ regularFrom: 6 });
export function engagementOptions(value = {}) {
  return {
    regularFrom:
      Number.isInteger(value?.regularFrom) &&
      value.regularFrom >= 3 &&
      value.regularFrom <= 1000
        ? value.regularFrom
        : DEFAULT_ENGAGEMENT.regularFrom,
  };
}
const day = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export function recencyBucket(last, anchor) {
  if (!day(anchor)) return "unavailable";
  if (last === null) return "noHistory";
  if (!day(last) || last > anchor) return "unavailable";
  const days = Math.round((Date.parse(anchor) - Date.parse(last)) / 86400000);
  return days <= 30
    ? "within30"
    : days <= 60
      ? "days31to60"
      : days <= 90
        ? "days61to90"
        : "over90";
}
export function depthSegment(
  sessions,
  last,
  anchor,
  options = DEFAULT_ENGAGEMENT,
) {
  if (!day(anchor) || !Number.isSafeInteger(sessions) || sessions < 0)
    return "unavailable";
  if (sessions === 0)
    return recencyBucket(last, anchor) === "unavailable"
      ? "unavailable"
      : last === null
        ? "noHistory"
        : "outsideView";
  return sessions === 1
    ? "oneTime"
    : sessions < engagementOptions(options).regularFrom
      ? "occasional"
      : "regular";
}
export function engagementLabels(options = DEFAULT_ENGAGEMENT) {
  const { regularFrom } = engagementOptions(options);
  return {
    depth: [
      { id: "noHistory", label: "No recorded history" },
      { id: "outsideView", label: "None in this view" },
      { id: "oneTime", label: "One-time (1 session)" },
      {
        id: "occasional",
        label:
          regularFrom === 3
            ? "Occasional (2 sessions)"
            : `Occasional (2–${regularFrom - 1} sessions)`,
      },
      { id: "regular", label: `Regular (${regularFrom}+ sessions)` },
      { id: "unavailable", label: "History/count unavailable" },
    ],
    recency: [
      { id: "within30", label: "Within 30 days" },
      { id: "days31to60", label: "31–60 days" },
      { id: "days61to90", label: "61–90 days" },
      { id: "over90", label: "More than 90 days" },
      { id: "noHistory", label: "No recorded history" },
      { id: "unavailable", label: "History unavailable" },
    ],
  };
}

// Server-side input: one deduplicated selected-session count and latest known
// full-history date per eligible person. Return aggregates only, never records.
export function summariseEngagement(
  records,
  anchor,
  options = DEFAULT_ENGAGEMENT,
) {
  if (!Array.isArray(records) || !day(anchor)) return null;
  const labels = engagementLabels(options);
  const depth = new Map(labels.depth.map((r) => [r.id, 0]));
  const recency = new Map(labels.recency.map((r) => [r.id, 0]));
  for (const record of records) {
    const d = depthSegment(record?.sessions, record?.last, anchor, options);
    const r =
      record?.sessions > 0 && record?.last === null
        ? "unavailable"
        : recencyBucket(record?.last, anchor);
    depth.set(d, depth.get(d) + 1);
    recency.set(r, recency.get(r) + 1);
  }
  const rows = (labels, counts) =>
    labels.map((row) => ({
      ...row,
      count: counts.get(row.id),
      percentage: records.length
        ? Math.round((counts.get(row.id) / records.length) * 1000) / 10
        : null,
    }));
  return {
    population: records.length,
    depth: rows(labels.depth, depth),
    recency: rows(labels.recency, recency),
  };
}
