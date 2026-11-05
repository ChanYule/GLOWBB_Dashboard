import { analytics, defaults, todaySG } from "./domain.js";

const monthEnd = (month) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
const earlier = (a, b) => (a < b ? a : b);
const later = (a, b) => (a > b ? a : b);

// Counts come only from delivered attendance. Registry absence and time-based
// inactivity are separate measures and are deliberately not used here.
export function participationReport(
  data,
  configured = {},
  filters = {},
  month = "",
  now = todaySG(),
) {
  const settings = { ...defaults, ...configured };
  const all = analytics(data, settings, {}, now, true, "rows");
  const selected = analytics(data, settings, filters, now, true, "rows");
  const dates = all.map((a) => a.s.date).sort();
  const from = filters.from || dates[0] || now.slice(0, 7) + "-01",
    to = earlier(filters.to || now, now);
  const months = [];
  let cursor = from.slice(0, 7);
  while (cursor <= to.slice(0, 7) && months.length < 1200) {
    months.push(cursor);
    const d = new Date(cursor + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 1);
    cursor = d.toISOString().slice(0, 7);
  }
  const chosen = months.includes(month)
    ? month
    : months.at(-1) || to.slice(0, 7);
  const history = new Map();
  const historyCutoff = dates.at(-1) || now;
  const programmesByPerson = new Map();
  for (const a of all) {
    if (!programmesByPerson.has(a.p.id))
      programmesByPerson.set(a.p.id, new Set());
    programmesByPerson.get(a.p.id).add(a.pg.id);
  }
  const inactive = new Set(
    [...programmesByPerson]
      .filter(([, programmes]) => programmes.size <= 2)
      .map(([id]) => id),
  );
  for (const a of selected) {
    const m = a.s.date.slice(0, 7);
    if (!history.has(m)) history.set(m, []);
    history.get(m).push(a);
  }
  function count(rows) {
    const people = [...new Map(rows.map((a) => [a.p.id, a.p])).values()];
    const unique = people.length,
      ib = people.filter((p) => p.client === true).length,
      ob = people.filter((p) => p.client === false).length,
      male = people.filter((p) => p.gender === "MALE").length,
      minority = people.filter((p) =>
        settings.minority.includes(p.race),
      ).length;
    return {
      programmes: new Set(rows.map((a) => a.pg.id)).size,
      sessions: new Set(rows.map((a) => a.s.id)).size,
      attendance: rows.length,
      unique,
      ib,
      ob,
      unknownClient: unique - ib - ob,
      male,
      minority,
      ibPct: unique ? (ib / unique) * 100 : null,
      obPct: unique ? (ob / unique) * 100 : null,
      malePct: unique ? (male / unique) * 100 : null,
      minorityPct: unique ? (minority / unique) * 100 : null,
      inactive: people.filter((p) => inactive.has(p.id)).length,
      asOf: historyCutoff,
    };
  }
  const monthRows = history.get(chosen) || [],
    byDay = new Map();
  for (const a of monthRows) {
    if (!byDay.has(a.s.date)) byDay.set(a.s.date, []);
    byDay.get(a.s.date).push(a);
  }
  const days = [];
  const first = new Date(chosen + "-01T00:00:00Z"),
    firstMonday = 1 + ((8 - first.getUTCDay()) % 7);
  for (let n = 1; n <= Number(monthEnd(chosen).slice(8)); n++) {
    const date = chosen + "-" + String(n).padStart(2, "0"),
      day = new Date(date + "T00:00:00Z").getUTCDay(),
      rows = byDay.get(date) || [];
    // Match the staff weekday sheet, retaining any recorded weekend activity.
    if ((day === 0 || day === 6) && !rows.length) continue;
    const status =
      date > now
        ? "future"
        : date < from || date > to
          ? "outside-period"
          : !dates.length || date < dates[0] || date > dates.at(-1)
            ? "outside-coverage"
            : rows.length
              ? "recorded"
              : "no-records";
    days.push({
      date,
      week: n < firstMonday ? null : Math.floor((n - firstMonday) / 7) + 1,
      status,
      counts: ["future", "outside-period", "outside-coverage"].includes(status)
        ? null
        : count(rows),
    });
  }
  const monthly = months.map((m) => ({
    month: m,
    from: later(m + "-01", from),
    to: earlier(monthEnd(m), to),
    ...count(history.get(m) || []),
  }));
  return {
    available: all.length > 0,
    period: { from, to, now },
    month: chosen,
    months,
    rows: days,
    monthSummary: count(monthRows),
    monthly,
    summary: count(selected),
    definitions: {
      cohort:
        "All recorded participants, including ages below the senior threshold and missing ages. The total unique participants card covers all ages; male and minority senior cards use the configured senior age threshold.",
      ib: "IB: existing clients; OB: non-clients. Unknown client status is excluded from both counts.",
      percentages:
        "IB, OB, male and minority percentages use distinct participants in that row. Unknown values remain in the overall unique denominator.",
      totals:
        "Monthly and period unique counts and programmes are deduplicated; do not add daily or monthly unique counts together.",
      days: "Blank cells mark future dates, dates outside the selected period, or dates outside available source coverage. Public holidays are not inferred.",
    },
  };
}
