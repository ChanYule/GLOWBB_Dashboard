import {domainMatches} from './programme-domains.js';
import { hash, todaySG, defaults, matchesSelection } from "./domain.js";

export const assessmentHeaders = [
  "Month",
  "SPPB",
  "Tanita",
  "Reported As Of",
  "Final",
];
export const operationMetrics = {
  unique: "Unique participants",
  male: "Male participants",
  ib: "IB clients",
  ob: "OB non-clients",
  firstObserved: "First observed participants",
  sppb: "SPPB assessments",
  tanita: "Tanita assessments",
};
const dayMs = 86400000;
export const screeningActivities = {
  sppb: "GLOW - SPPB Assessment",
  tanita: "GLOW - Tanita Body Measurement",
};
export const screeningActivityNames = {
  sppb: [screeningActivities.sppb],
  tanita: [screeningActivities.tanita, "GLOW - Tanita Body Measurements"],
};
const screeningType = (name) =>
  Object.keys(screeningActivityNames).find((key) =>
    screeningActivityNames[key].includes(name?.trim()),
  );
const stamp = (day) => Date.parse(day + "T00:00:00Z");
const iso = (n) => new Date(n).toISOString().slice(0, 10);
export const validDay = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(stamp(s)) &&
  iso(stamp(s)) === s;
export const monthEnd = (month) =>
  iso(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
export const validMonth = (s) =>
  typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const fault = (message) => Object.assign(Error(message), { status: 400 });

export function parseAssessmentTotals(matrix, now = todaySG()) {
  if (matrix.length < 2 || matrix.length > 501)
    throw fault("Use 1 to 500 monthly report rows.");
  const headers = matrix[0].map((v) => String(v ?? "").trim());
  if (
    new Set(headers).size !== headers.length ||
    assessmentHeaders.some((h) => !headers.includes(h))
  )
    throw fault("Required headers: " + assessmentHeaders.join(", "));
  const rows = [],
    issues = [],
    warnings = [];
  matrix.slice(1).forEach((cells, index) => {
    if (cells.every((v) => !String(v ?? "").trim())) return;
    const row = index + 2,
      record = Object.fromEntries(
        headers.map((h, i) => [h, String(cells[i] ?? "").trim()]),
      );
    try {
      if (!validMonth(record.Month) || record.Month > now.slice(0, 7))
        throw fault(
          "Month must be YYYY-MM and not in the future. Overall and daily totals are not monthly records.",
        );
      if (
        !validDay(record["Reported As Of"]) ||
        record["Reported As Of"] > now ||
        record["Reported As Of"] < record.Month + "-01"
      )
        throw fault(
          "Reported As Of must be a real YYYY-MM-DD date from the report month through today.",
        );
      if (!["YES", "NO"].includes(record.Final.toUpperCase()))
        throw fault("Final must be YES or NO.");
      const complete = record.Final.toUpperCase() === "YES";
      if (complete && record["Reported As Of"] < monthEnd(record.Month))
        throw fault(
          "A month cannot be marked final before its last calendar day.",
        );
      for (const [column, type] of [
        ["SPPB", "SPPB"],
        ["Tanita", "TANITA"],
      ]) {
        if (record[column] === "") continue;
        if (!/^\d+$/.test(record[column]) || Number(record[column]) > 1000000)
          throw fault(
            "Assessment totals must be whole numbers from 0 to 1,000,000; leave unavailable totals blank.",
          );
        rows.push({
          month: record.Month,
          type,
          total: Number(record[column]),
          reported_as_of: record["Reported As Of"],
          complete: Number(complete),
        });
      }
      const total = Number(record["Unique Participants"]);
      if (
        record["Unique Participants"] &&
        Number.isFinite(total) &&
        total > 0
      ) {
        for (const key of ["IB", "OB", "Male"]) {
          const count = Number(record[key]),
            share = Number((record[key + " %"] || "").replace("%", ""));
          if (
            record[key] &&
            record[key + " %"] &&
            Number.isFinite(count) &&
            Number.isFinite(share) &&
            Math.abs(share - (count / total) * 100) > 1
          )
            warnings.push({
              row,
              message: `${key} percentage differs from its count divided by unique participants. Source percentage is not imported.`,
            });
        }
        if (
          record.IB &&
          record.OB &&
          Number(record.IB) + Number(record.OB) > total
        )
          warnings.push({
            row,
            message:
              "IB plus OB exceeds unique participants. Participation figures are not imported; reconcile source definitions.",
          });
      }
    } catch (e) {
      issues.push({ row, message: e.message });
    }
  });
  if (issues.length) return { rows: [], issues, warnings };
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.month}|${row.type}|${row.reported_as_of}`;
    const previous = seen.get(key);
    if (
      previous &&
      (previous.total !== row.total || previous.complete !== row.complete)
    )
      return {
        rows: [],
        issues: [
          {
            row: 0,
            message:
              "Conflicting totals for the same month, assessment and reporting date.",
          },
        ],
        warnings,
      };
    seen.set(key, row);
  }
  if (!seen.size)
    issues.push({
      row: 0,
      message:
        "Enter at least one assessment total. Blank means unavailable; zero means a reported zero.",
    });
  return { rows: [...seen.values()], issues, warnings };
}

export function latestMonthly(records) {
  const latest = new Map();
  for (const r of [...records].sort(
    (a, b) => a.reported_as_of.localeCompare(b.reported_as_of) || a.id - b.id,
  ))
    latest.set(`${r.month}|${r.type}`, r);
  return latest;
}
export function monthlyPlan(records, rows, revise = false) {
  const existing = new Set(records.map((r) => r.fingerprint));
  const current = latestMonthly(records),
    inserts = [];
  let duplicates = 0;
  for (const r of rows) {
    const fingerprint = hash([
      r.month,
      r.type,
      r.total,
      r.reported_as_of,
      r.complete,
    ]);
    if (existing.has(fingerprint)) {
      duplicates++;
      continue;
    }
    const old = current.get(`${r.month}|${r.type}`);
    if (
      old &&
      (old.total !== r.total || old.complete !== r.complete) &&
      !revise
    )
      throw fault(
        "A reported total already exists. Confirm a revision to change it; earlier entries will be retained.",
      );
    if (old && r.reported_as_of < old.reported_as_of)
      throw fault(
        "A revision cannot predate the current report. Use a later reporting date to correct it.",
      );
    const insert = { ...r, fingerprint };
    inserts.push(insert);
    existing.add(fingerprint);
    current.set(`${r.month}|${r.type}`, insert);
  }
  return { inserts, duplicates };
}

function bucket(day, grain) {
  if (grain === "day") return day;
  if (grain === "year") return day.slice(0, 4);
  if (grain === "week") {
    const d = new Date(stamp(day));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return iso(+d);
  }
  return day.slice(0, 7);
}
function bounds(label, grain) {
  if (grain === "month") return [label + "-01", monthEnd(label)];
  if (grain === "year") return [label + "-01-01", label + "-12-31"];
  return [label, grain === "week" ? iso(stamp(label) + 6 * dayMs) : label];
}
function matches(p, pg, f, settings, session) {
  return (
    domainMatches(f.domain,session,pg,settings) &&
    matchesSelection(f.programme, pg?.id) &&
    matchesSelection(f.gender, p.gender) &&
    matchesSelection(f.race, p.race) &&
    (!f.client || String(p.client) === f.client) &&
    (!f.boundary || String(p.boundary) === f.boundary) &&
    (!f.ageBand ||
      (p.age !== null &&
        p.age >= Number(f.ageBand.split("-")[0]) &&
        p.age <= Number(f.ageBand.split("-")[1]))) &&
    (!f.target ||
      f.target === "all" ||
      (p.age !== null &&
        p.age >= settings.seniorAge &&
        ((f.target === "male" && p.gender === "MALE") ||
          (f.target === "minority" && settings.minority.includes(p.race)))))
  );
}

export function operationsReport(
  data,
  definitions,
  filters = {},
  monthlyRecords = [],
  config = { inactivityDays: null },
  grain = "month",
  now = todaySG(),
) {
  definitions = { ...defaults, ...definitions };
  const people = new Map(data.participants.map((p) => [p.id, p])),
    programmes = new Map(data.programmes.map((p) => [p.id, p])),
    sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const first = new Map();
  const full = data.attendance
    .map((a) => ({
      ...a,
      p: people.get(a.participantId),
      s: sessions.get(a.sessionId),
    }))
    .filter((a) => a.p && a.s && a.s.date <= now);
  for (const a of full)
    if (!first.has(a.p.id) || a.s.date < first.get(a.p.id))
      first.set(a.p.id, a.s.date);
  const history = full.filter(
    (a) =>
      matches(a.p, programmes.get(a.s.programmeId), filters, definitions,a.s) &&
      matchesSelection(filters.cfs, a.p.cfs) &&
      (!filters.weekday ||
        String(new Date(a.s.date + "T00:00:00Z").getUTCDay()) ===
          filters.weekday) &&
      (!filters.timeSlot ||
        (a.s.start < definitions.timeBands[0]
          ? "Morning"
          : a.s.start < definitions.timeBands[1]
            ? "Afternoon"
            : "Evening") === filters.timeSlot) &&
      (!filters.observed ||
        (filters.observed === "first"
          ? !filters.from || first.get(a.p.id) >= filters.from
          : filters.from && first.get(a.p.id) < filters.from)),
  );
  const coverageStart = full.reduce(
    (v, a) => (a.s.date < v ? a.s.date : v),
    now,
  );
  const from =
      filters.from || (full.length ? coverageStart : now.slice(0, 7) + "-01"),
    to = filters.to && filters.to < now ? filters.to : now;
  if (!validDay(from) || !validDay(to) || from > to)
    throw fault("Choose a reporting period ending on or before today.");
  const unsegmented =
    ![
      "domain",
      "programme",
      "gender",
      "race",
      "client",
      "boundary",
      "ageBand",
      "cfs",
      "weekday",
      "timeSlot",
      "observed",
    ].some((k) => filters[k]) &&
    (!filters.target || filters.target === "all");
  const latest = latestMonthly(monthlyRecords);
  const dates = new Map();
  for (const a of history) {
    if (!dates.has(a.p.id)) dates.set(a.p.id, new Set());
    dates.get(a.p.id).add(a.s.date);
  }
  const events = { newlyInactive: [], reactivated: [] };
  const threshold =
    Number.isInteger(config.inactivityDays) && config.inactivityDays > 0
      ? config.inactivityDays
      : null;
  if (threshold)
    for (const [id, days] of dates) {
      const sorted = [...days].sort();
      sorted.forEach((date, i) => {
        const inactiveDate = iso(stamp(date) + threshold * dayMs),
          next = sorted[i + 1];
        if (inactiveDate <= to && (!next || next > inactiveDate))
          events.newlyInactive.push({ id, date: inactiveDate });
        if (next && stamp(next) - stamp(date) > threshold * dayMs)
          events.reactivated.push({ id, date: next });
      });
    }
  function row(start, end) {
    const observed = history.filter(
      (a) => a.s.date >= start && a.s.date <= end,
    );
    const persons = [...new Map(observed.map((a) => [a.p.id, a.p])).values()];
    const screeningPeople = (type) =>
      new Set(
        observed
          .filter(
            (a) =>
              screeningType(programmes.get(a.s.programmeId)?.name) === type,
          )
          .map((a) => a.p.id),
      ).size;
    const unique = persons.length,
      ib = persons.filter((p) => p.client === true).length,
      ob = persons.filter((p) => p.client === false).length,
      male = persons.filter((p) => p.gender === "MALE").length;
    const firstPeople = persons.filter(
      (p) => first.get(p.id) >= start && first.get(p.id) <= end,
    );
    const counts = new Map();
    for (const a of observed) {
      if (!counts.has(a.p.id)) counts.set(a.p.id, new Set());
      counts.get(a.p.id).add(a.s.id);
    }
    const recordedSessions = new Set(observed.map((a) => a.s.id)).size;
    const inactive = threshold
      ? [...dates.values()].filter((values) => {
          const last = [...values]
            .filter((d) => d <= end)
            .sort()
            .at(-1);
          return last && stamp(end) - stamp(last) >= threshold * dayMs;
        }).length
      : null;
    const transition = (key) =>
      threshold
        ? new Set(
            events[key]
              .filter((e) => e.date >= start && e.date <= end)
              .map((e) => e.id),
          ).size
        : null;
    return {
      from: start,
      to: end,
      programmes: new Set(observed.map((a) => a.s.programmeId)).size,
      sessions: recordedSessions,
      attendance: observed.length,
      sppbPeople: screeningPeople("sppb"),
      tanitaPeople: screeningPeople("tanita"),
      unique,
      average: recordedSessions ? observed.length / recordedSessions : 0,
      ib,
      ob,
      unknownClient: unique - ib - ob,
      ibPct: unique ? (ib / unique) * 100 : null,
      obPct: unique ? (ob / unique) * 100 : null,
      male,
      malePct: unique ? (male / unique) * 100 : null,
      unknownGender: persons.filter(
        (p) => !["MALE", "FEMALE"].includes(p.gender),
      ).length,
      missingAge: persons.filter((p) => p.age === null).length,
      firstObserved: firstPeople.length,
      returning: unique - firstPeople.length,
      newIb: firstPeople.filter((p) => p.client === true).length,
      newOb: firstPeople.filter((p) => p.client === false).length,
      repeatRate: unique
        ? ([...counts.values()].filter((v) => v.size > 1).length / unique) * 100
        : null,
      inactive,
      newlyInactive: transition("newlyInactive"),
      reactivated: transition("reactivated"),
    };
  }
  function healthForMonth(month, start, end) {
    const fullySelected =
      start <= month + "-01" &&
      (end >= monthEnd(month) || (month === now.slice(0, 7) && end === now));
    const value = (type) =>
      unsegmented && fullySelected
        ? (latest.get(`${month}|${type}`)?.total ?? null)
        : null;
    return {
      sppb: value("SPPB"),
      tanita: value("TANITA"),
      final: !!(
        latest.get(`${month}|SPPB`)?.complete &&
        latest.get(`${month}|TANITA`)?.complete
      ),
      fullySelected,
    };
  }
  const months = [];
  let cursor = from.slice(0, 7) + "-01";
  while (cursor <= to && months.length < 1200) {
    const month = cursor.slice(0, 7),
      start = cursor < from ? from : cursor,
      end = monthEnd(month) > to ? to : monthEnd(month);
    months.push({
      label: month,
      ...row(start, end),
      ...healthForMonth(month, start, end),
    });
    cursor = iso(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1),
    );
  }
  if (cursor <= to)
    throw fault("Choose a reporting range shorter than 100 years.");
  const sumHealth = (key, selected) => {
    const known = selected.filter((m) => m[key] !== null);
    return known.length ? known.reduce((n, m) => n + m[key], 0) : null;
  };
  const summary = {
    ...row(from, to),
    sppb: sumHealth("sppb", months),
    tanita: sumHealth("tanita", months),
  };
  const keys = [];
  for (let t = stamp(from); t <= stamp(to); t += dayMs) {
    const key = bucket(iso(t), grain);
    if (keys.at(-1) !== key) keys.push(key);
    if (keys.length > 730)
      throw fault(
        "This report has over 730 periods. Choose a coarser reporting interval or shorter date range.",
      );
  }
  const rows = keys.map((label) => {
    const [a, b] = bounds(label, grain),
      start = a < from ? from : a,
      end = b > to ? to : b;
    const selected = months.filter(
      (m) => m.label >= start.slice(0, 7) && m.label <= end.slice(0, 7),
    );
    return {
      label,
      ...row(start, end),
      sppb:
        grain === "month" || grain === "year"
          ? sumHealth("sppb", selected)
          : null,
      tanita:
        grain === "month" || grain === "year"
          ? sumHealth("tanita", selected)
          : null,
    };
  });
  const latestHistory = [...latest.values()].sort(
    (a, b) => b.month.localeCompare(a.month) || a.type.localeCompare(b.type),
  );
  const insights = [];
  for (const type of ["sppb", "tanita"]) {
    const complete = months.filter(
      (m) =>
        latest.get(`${m.label}|${type.toUpperCase()}`)?.complete === 1 &&
        m.to === monthEnd(m.label) &&
        m.from === m.label + "-01",
    );
    const last = complete.at(-1),
      prior = complete.at(-2);
    if (
      last &&
      prior &&
      last[type] !== null &&
      prior[type] !== null &&
      prior[type] !== last[type] &&
      iso(
        Date.UTC(
          Number(prior.label.slice(0, 4)),
          Number(prior.label.slice(5, 7)),
          1,
        ),
      ).slice(0, 7) === last.label
    )
      insights.push({
        title: `${type.toUpperCase()} reported activity ${last[type] > prior[type] ? "increased" : "decreased"}`,
        detail: `${prior.label}: ${prior[type]} assessments; ${last.label}: ${last[type]}. Both months are marked final.`,
        action:
          "Review the reporting ledger and delivery schedule; counts do not establish unique people or health outcomes.",
        view: "health",
      });
  }
  const missingMonths = months.filter(
    (m) => m.fullySelected && (m.sppb === null || m.tanita === null),
  ).length;
  const fullMonths = months.filter(
    (m) => m.from === m.label + "-01" && m.to === monthEnd(m.label),
  );
  const recent = fullMonths.slice(-3);
  const adjacent = (a, b) =>
    iso(
      Date.UTC(Number(a.label.slice(0, 4)), Number(a.label.slice(5, 7)), 1),
    ).slice(0, 7) === b.label;
  if (
    recent.length === 3 &&
    recent.every(
      (m) =>
        m.unique >= definitions.minParticipants &&
        m.sessions >= definitions.minSessions,
    ) &&
    adjacent(recent[0], recent[1]) &&
    adjacent(recent[1], recent[2]) &&
    recent[0].male < recent[1].male &&
    recent[1].male < recent[2].male
  )
    insights.push({
      title: "Male participation rose across three observed months",
      detail: recent
        .map(
          (m) =>
            `${m.label}: ${m.male} male participants (${Math.round(m.malePct * 10) / 10}% of all unique participants)`,
        )
        .join("; "),
      action:
        "Review programme mix and ask participants about outreach channels; these counts do not establish a cause.",
      view: "summary",
    });
  const latestPeriod = fullMonths.at(-1),
    previousPeriod = fullMonths.at(-2);
  if (
    threshold &&
    latestPeriod &&
    previousPeriod &&
    adjacent(previousPeriod, latestPeriod) &&
    coverageStart <= iso(stamp(previousPeriod.from) - threshold * dayMs) &&
    latestPeriod.newlyInactive >= definitions.minParticipants &&
    latestPeriod.newlyInactive > previousPeriod.newlyInactive
  )
    insights.push({
      title: "More recorded participants became inactive",
      detail: `${previousPeriod.label}: ${previousPeriod.newlyInactive} people; ${latestPeriod.label}: ${latestPeriod.newlyInactive} people, using the configured ${threshold}-day definition.`,
      action:
        "Review the matching attendance history and discuss appropriate outreach. Missing history and inactivity are not medical classifications.",
      view: "summary",
    });
  const attention = [
    ...(threshold && summary.inactive
      ? [
          {
            title: "Recorded inactivity",
            value: summary.inactive,
            detail: `People in the observed cohort with no matching attendance for ${threshold} days as of ${to}. Review the inactivity trend; this is not a medical assessment.`,
            view: "summary",
          },
        ]
      : []),
    ...(summary.unknownClient || summary.unknownGender || summary.missingAge
      ? [
          {
            title: "Check incomplete demographics",
            value:
              summary.unknownClient +
              summary.unknownGender +
              summary.missingAge,
            detail: `${summary.unknownClient} unknown client status, ${summary.unknownGender} unknown/other gender, ${summary.missingAge} missing age. These are field issues and can overlap on the same person.`,
            view: "summary",
          },
        ]
      : []),
    ...(unsegmented && missingMonths
      ? [
          {
            title: "Missing monthly assessment totals",
            value: missingMonths,
            detail:
              "Selected months with a missing SPPB or Tanita total. This is missing reporting data, not people overdue for screening.",
            view: "health",
          },
        ]
      : []),
  ];
  const current = months.find((m) => m.label === now.slice(0, 7)) || {
    sppb: null,
    tanita: null,
  };
  const screeningRows = history.filter(
    (a) =>
      a.s.date >= from &&
      a.s.date <= to &&
      screeningType(programmes.get(a.s.programmeId)?.name),
  );
  const screeningDays = [...new Set(screeningRows.map((a) => a.s.date))].sort();
  const dailyScreening = new Map(
    screeningDays.map((day) => [day, { sppb: new Set(), tanita: new Set() }]),
  );
  const entries = { sppb: 0, tanita: 0 };
  for (const a of screeningRows) {
    const type = screeningType(programmes.get(a.s.programmeId)?.name);
    dailyScreening.get(a.s.date)[type].add(a.p.id);
    entries[type]++;
  }
  return {
    period: { from, to, now },
    summary,
    rows,
    monthly: months,
    activityScreening: {
      activityNames: screeningActivities,
      sppb: { people: summary.sppbPeople, attendance: entries.sppb },
      tanita: { people: summary.tanitaPeople, attendance: entries.tanita },
      daily: screeningDays.map((label) => ({
        label,
        sppbPeople: dailyScreening.get(label).sppb.size,
        tanitaPeople: dailyScreening.get(label).tanita.size,
      })),
      monthly: months.map((m) => ({
        label: m.label,
        sppbPeople: m.sppbPeople,
        tanitaPeople: m.tanitaPeople,
      })),
    },
    health: {
      source: "Reported monthly assessment totals",
      unsegmented,
      sppb: {
        total: summary.sppb,
        reportedMonths: months.filter((m) => m.sppb !== null).length,
        thisMonth: current.sppb,
      },
      tanita: {
        total: summary.tanita,
        reportedMonths: months.filter((m) => m.tanita !== null).length,
        thisMonth: current.tanita,
      },
      selectedMonths: months.length,
      uniqueSppb: null,
      uniqueTanita: null,
      both: null,
      neither: null,
      history: latestHistory.map(
        ({ month, type, total, reported_as_of, complete }) => ({
          month,
          type,
          total,
          reported_as_of,
          complete,
        }),
      ),
      revisions: monthlyRecords.length,
      revisionHistory: [...monthlyRecords]
        .sort((a, b) => b.id - a.id)
        .map(({ month, type, total, reported_as_of, complete, created }) => ({
          month,
          type,
          total,
          reported_as_of,
          complete,
          created,
        })),
    },
    attention,
    insights,
    settings: config,
    definitions: {
      ib: "Is Client = YES",
      ob: "Is Client = NO",
      percentages:
        "All unique participants in the selected period, including unknown values",
      newParticipants:
        "First recorded attendance anywhere in the available dataset; not verified new centre clients",
      inactivity:
        "Observed cohort only; programme and audience filters limit matching attendance history. Unknown attendance outside the dataset is not inferred.",
    },
  };
}
