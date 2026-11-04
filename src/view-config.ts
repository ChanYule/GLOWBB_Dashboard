import type { Filters, SavedView } from "./types";
export const metrics: Record<string, [string, string]> = {
  unique: [
    "Unique seniors reached",
    "Distinct Member IDs aged at least the configured senior threshold, counted once in the selected period.",
  ],
  male: [
    "Male seniors reached",
    "Distinct senior participants recorded as male. Percentage uses seniors with known gender.",
  ],
  minority: [
    "Minority seniors reached",
    "Distinct seniors matching the organisation's approved race mapping. Percentage uses known race.",
  ],
  attendance: [
    "Attendance entries",
    "Deduplicated attendance entries across all ages.",
  ],
  sessions: [
    "Delivered sessions",
    "Distinct programme, date and start/end time combinations, excluding future dates.",
  ],
  programmes: [
    "Active programmes",
    "Distinct exact programme names with delivered attendance in this view.",
  ],
  average: [
    "Average attendance per session",
    "All-age attendance divided by distinct delivered sessions.",
  ],
  firstObserved: [
    "First-observed seniors",
    "First seen in the full available attendance history during this period. Not necessarily new centre members.",
  ],
  returning: [
    "Previously observed seniors",
    "Seniors whose first recorded attendance predates this reporting period.",
  ],
  repeat: [
    "Repeat participants",
    "Distinct seniors attending at least two distinct sessions within this view.",
  ],
  clientReach: [
    "Existing clients reached",
    "Distinct seniors explicitly recorded as clients; missing status is excluded.",
  ],
  nonClientReach: [
    "Non-clients reached",
    "Distinct seniors explicitly recorded as non-clients.",
  ],
  inBoundary: [
    "Within service boundary",
    "Distinct seniors explicitly recorded within the boundary.",
  ],
  outBoundary: [
    "Outside service boundary",
    "Distinct seniors explicitly recorded outside the boundary.",
  ],
};
export function reportingFilters(view: SavedView, fallback: Filters): Filters {
  const f = { ...fallback, ...view.filters };
  if (!view.period || view.period === "Custom range") return f;
  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const y = Number(now.slice(0, 4)),
    m = Number(now.slice(5, 7));
  f.to = now;
  const iso = (month: number, day = 1) =>
    new Date(Date.UTC(y, month, day)).toISOString().slice(0, 10);
  f.from =
    view.period === "This month"
      ? now.slice(0, 7) + "-01"
      : view.period === "Last month"
        ? iso(m - 2)
        : view.period === "Last 3 months"
          ? iso(m - 3)
          : view.period === "Last 6 months"
            ? iso(m - 6)
            : view.period === "This year"
              ? y + "-01-01"
              : "";
  if (view.period === "Last month") f.to = iso(m - 1, 0);
  return f;
}
