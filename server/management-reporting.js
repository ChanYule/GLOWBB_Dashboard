import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { CENTRES, centreById } from "../shared/centres.js";
import { getSettings } from "./db.js";
import { analytics, todaySG } from "./domain.js";
import {
  CLIENT_SNAPSHOT,
  clientContext,
  clientPopulation,
} from "./client-domain.js";
import { materializeProfiles } from "./needs-domain.js";
import { sessionEventTypes } from "./event-types.js";
import { PROGRAMME_DOMAINS } from "./programme-domains.js";
import {
  operationsReport,
  operationMetrics,
  monthEnd,
  screeningActivityNames,
  latestMonthly,
} from "./operations.js";
import {
  reportingContext,
  projectReportingData,
  policySummary,
} from "./reporting-policy.js";
import { sqlDashboard } from "./sql-dashboard.js";
import { boundedAnalyticsCache } from "./analytics-cache.js";

const sourceSystem = "GlowBBDashboard";
const timezone = "Asia/Singapore";
const periodKeys = ["from", "to", "year", "month", "quarter"];
const segmentKeys = ["programme", "domain", "subdomain"];
const attendanceKeys = [...periodKeys, ...segmentKeys];
const invalid = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const digest = (value) => createHash("sha256").update(value).digest();
const shift = (day, days) =>
  new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10);
const validDay = (day) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day)) &&
  shift(day, 0) === day;

const reachMetrics = {
  male: [
    "Male senior attendees",
    "people",
    "Unique senior attendees with recorded male gender.",
  ],
  minority: [
    "Senior attendees in configured minority groups",
    "people",
    "Unique senior attendees in the centre's configured minority race groups.",
  ],
  malePct: [
    "Male share of known gender",
    "percent",
    "Male senior attendees divided by senior attendees with known gender, times 100.",
  ],
  minorityPct: [
    "Minority share of known race",
    "percent",
    "Senior attendees in configured minority groups divided by senior attendees with known race, times 100.",
  ],
  attendance: [
    "Attendance entries",
    "entries",
    "Count attendance rows across all ages.",
  ],
  allAges: [
    "Unique attendees, all ages",
    "people",
    "Distinct attendee IDs across the entire slice.",
  ],
  unique: [
    "Unique senior attendees",
    "people",
    "Distinct attendee IDs meeting the configured senior age threshold.",
  ],
  seniorAttendance: [
    "Senior attendance entries",
    "entries",
    "Count attendance rows for attendees meeting the configured senior age threshold.",
  ],
  firstObserved: [
    "First observed senior attendees",
    "people",
    "Senior attendees whose first eligible recorded attendance is within the slice.",
  ],
  returning: [
    "Returning senior attendees",
    "people",
    "Senior attendees first observed before the slice.",
  ],
  sessions: [
    "Recorded sessions",
    "sessions",
    "Distinct delivered session IDs with attendance.",
  ],
  programmes: [
    "Recorded programmes",
    "programmes",
    "Distinct programme IDs with attendance.",
  ],
  repeat: [
    "Repeat senior attendees",
    "people",
    "Senior attendees with at least two distinct sessions in the slice.",
  ],
  multiProgramme: [
    "Multi-programme senior attendees",
    "people",
    "Senior attendees with attendance in more than one programme.",
  ],
  multiDomain: [
    "Multi-domain senior attendees",
    "people",
    "Senior attendees with attendance across more than one combined domain.",
  ],
  repeatRate: [
    "Senior repeat attendance rate",
    "percent",
    "Repeat senior attendees divided by unique senior attendees, times 100.",
  ],
  frequency: [
    "Senior attendance frequency",
    "entries/person",
    "Senior attendance entries divided by unique senior attendees.",
  ],
  average: [
    "Average attendance per session",
    "entries/session",
    "All-age attendance entries divided by distinct sessions.",
  ],
};
const demographicMetrics = {
  gender: [
    "Gender distribution",
    "people",
    "Unique senior attendees by recorded gender.",
  ],
  race: [
    "Race distribution",
    "people",
    "Unique senior attendees by recorded race, including missing and unknown.",
  ],
  ages: [
    "Age distribution",
    "people",
    "Unique senior attendees using dashboard-configured age bands.",
  ],
  clients: [
    "Client status distribution",
    "people",
    "Unique senior attendees by recorded client status.",
  ],
  boundary: [
    "Boundary distribution",
    "people",
    "Unique senior attendees by recorded centre-boundary status.",
  ],
  language: [
    "Preferred language distribution",
    "people",
    "Latest recorded preferred language of unique senior attendees. Multiple recorded languages overlap.",
  ],
};
const attendanceMetrics = {
  ...reachMetrics,
  frequencyDistribution: [
    "Attendance frequency bands",
    "people",
    "Unique senior attendees grouped into the dashboard distinct-session bands.",
  ],
  retained: [
    "Returning from the previous equivalent period",
    "people",
    "Distinct senior attendees observed in both the current and previous equivalent period, with identical filters.",
  ],
  retentionRate: [
    "Previous-period attendee retention",
    "percent",
    "Senior attendees in both periods divided by senior attendees in the previous period, times 100.",
  ],
};
const membershipMetrics = {
  registered: [
    "Registered clients",
    "people",
    "Current verified client registry excluding archived members. A complete snapshot is required for the centre total.",
  ],
  newMembers: [
    "New registrations",
    "people",
    "Current registry members with a recorded registration day in the period. Requires a complete registry and known registration dates.",
  ],
  active: [
    "Active registered clients",
    "people",
    "Current registry members with active status under the Clients workspace recency rules.",
  ],
  inactive: [
    "Inactive registered clients",
    "people",
    "Current registry members with an inactive status under the Clients workspace recency rules.",
  ],
};
const healthMetrics = {
  reportedTotal: [
    "Reported monthly assessment total",
    "assessments",
    "Sum available monthly totals using the Operations latest-revision and whole-month selection rules.",
  ],
  screeningPeople: [
    "Screening activity participants",
    "people",
    "Distinct attendees of the exact screening activities recognised by Operations.",
  ],
  screeningAttendance: [
    "Screening activity attendance",
    "entries",
    "Attendance entries for the exact recognised screening activities.",
  ],
  eligible: [
    "Eligible SPPB clients",
    "people",
    "Current verified registered clients in the centre.",
  ],
  assessed: [
    "Clients assessed",
    "people",
    "Eligible clients with a linked dated assessment in the filtered cohort.",
  ],
  coverage: [
    "SPPB assessment coverage",
    "percent",
    "Assessed clients divided by eligible clients, times 100. Requires a verified complete registry.",
  ],
  records: [
    "Dated linked records",
    "assessments",
    "Count dated non-superseded linked records within the selected period.",
  ],
  repeated: [
    "Repeated SPPB assessments",
    "people",
    "Selected clients with assessments on two or more distinct dates through the reporting end.",
  ],
  scoreDistribution: [
    "Latest recorded SPPB totals",
    "people",
    "Count latest unambiguous recorded totals by score and source definition.",
  ],
  averageStandardScore: [
    "Average latest standard SPPB total",
    "points",
    "Average of latest unambiguous validated standard totals.",
  ],
  comparable: [
    "Matched SPPB assessments",
    "people",
    "Participants with a latest and previous unambiguous comparable standard score.",
  ],
  increased: [
    "Score increased",
    "people",
    "Matched participants whose latest validated standard score is higher.",
  ],
  unchanged: [
    "Score unchanged",
    "people",
    "Matched participants whose latest validated standard score is equal.",
  ],
  decreased: [
    "Score decreased",
    "people",
    "Matched participants whose latest validated standard score is lower.",
  ],
  previousScore: [
    "Mean previous matched score",
    "points",
    "Average of previous same-version standard scores for matched participants.",
  ],
  latestScore: [
    "Mean latest matched score",
    "points",
    "Average of latest same-version standard scores for matched participants.",
  ],
  baselineScore: [
    "Mean baseline SPPB score",
    "points",
    "Mean earliest unambiguous same-version validated total for baseline-matched participants.",
  ],
  baselineLatestScore: [
    "Mean latest SPPB score for baseline cohort",
    "points",
    "Mean latest validated total for the same participants as baselineScore.",
  ],
  baselineMatched: [
    "Baseline-matched SPPB participants",
    "people",
    "People with an unambiguous earlier baseline and latest standard score under the same scoring version.",
  ],
};
const endpoints = {
  summary: {
    filters: attendanceKeys,
    metrics: reachMetrics,
    source: "Attendance dashboard",
  },
  attendance: {
    filters: attendanceKeys,
    metrics: attendanceMetrics,
    source: "Attendance dashboard",
  },
  trends: {
    filters: [...attendanceKeys, "grain"],
    metrics: reachMetrics,
    source: "Attendance dashboard",
  },
  programmes: {
    filters: [...attendanceKeys, "page", "limit"],
    metrics: reachMetrics,
    source: "Programme performance and mapped event types",
  },
  demographics: {
    filters: attendanceKeys,
    metrics: demographicMetrics,
    source: "Attendance dashboard and latest recorded profiles",
  },
  membership: {
    filters: periodKeys,
    metrics: membershipMetrics,
    source: "Current client registry and Clients workspace",
  },
  "health-assessments": {
    filters: [...periodKeys, "assessmentType"],
    metrics: healthMetrics,
    source: "Operations monthly totals, screening attendance and linked SPPB",
  },
  kpis: {
    filters: periodKeys,
    metrics: {
      actual: [
        "KPI actual",
        "people or assessments",
        "Recalculate the stored KPI scope using the dashboard or Operations definition.",
      ],
      target: [
        "Stored KPI target",
        "people or assessments",
        "Configured target value.",
      ],
      attainment: [
        "KPI attainment",
        "percent",
        "Actual divided by stored target, times 100.",
      ],
    },
    source: "Dashboard targets and Operations targets",
  },
};
for (const [key, label] of [
  ["fitness", "Fitness"],
  ["hart", "H.ART"],
])
  endpoints[key] = {
    filters: [...attendanceKeys, "page", "limit"],
    metrics: reachMetrics,
    source: "Explicit " + label + " event type in the programme source",
  };

export function parseReportingQuery(query, endpoint, now) {
  const allowed = ["centre", ...(endpoints[endpoint]?.filters || [])];
  for (const [key, val] of Object.entries(query))
    if (
      !allowed.includes(key) ||
      typeof val !== "string" ||
      !val.trim() ||
      val.length > 150
    )
      throw invalid("Unsupported or invalid reporting filter.");
  const { year, month, quarter } = query;
  if (
    ((month || quarter) && !year) ||
    (month && quarter) ||
    (year && (query.from || query.to)) ||
    Boolean(query.from) !== Boolean(query.to)
  )
    throw invalid(
      "Choose from/to together, or a year with an optional month or quarter.",
    );
  if (
    (year &&
      (!/^\d{4}$/.test(year) ||
        Number(year) < 1900 ||
        year > now.slice(0, 4))) ||
    (month && !/^(0?[1-9]|1[0-2])$/.test(month)) ||
    (quarter && !/^[1-4]$/.test(quarter))
  )
    throw invalid("Invalid calendar period.");
  const startMonth = month
    ? Number(month)
    : quarter
      ? (Number(quarter) - 1) * 3 + 1
      : 1;
  const endMonth = month ? startMonth : quarter ? startMonth + 2 : 12;
  const calendarYear = year || now.slice(0, 4);
  const from =
    query.from ||
    calendarYear + "-" + String(startMonth).padStart(2, "0") + "-01";
  const end =
    query.to ||
    monthEnd(calendarYear + "-" + String(endMonth).padStart(2, "0"));
  const to = end > now && !query.to ? now : end;
  if (
    !validDay(from) ||
    !validDay(to) ||
    from < "1900-01-01" ||
    from > to ||
    to > now ||
    Date.parse(to) - Date.parse(from) > 3653 * 86400000
  )
    throw invalid(
      "Choose an inclusive Singapore period of up to ten years, ending no later than today.",
    );
  if (
    (query.domain && !PROGRAMME_DOMAINS.includes(query.domain)) ||
    (query.programme && !/^[a-zA-Z0-9_-]+$/.test(query.programme)) ||
    (query.grain && !["month", "quarter", "year"].includes(query.grain)) ||
    (query.assessmentType && !["SPPB", "TANITA"].includes(query.assessmentType))
  )
    throw invalid(
      "Choose a supported programme, domain, grain or assessment type.",
    );
  for (const [field, maximum] of [
    ["page", 10000],
    ["limit", 100],
  ])
    if (
      query[field] &&
      (!/^\d+$/.test(query[field]) ||
        Number(query[field]) < 1 ||
        Number(query[field]) > maximum)
    )
      throw invalid("Choose a supported page and limit.");
  return {
    from,
    to,
    ...Object.fromEntries(
      segmentKeys.filter((k) => query[k]).map((k) => [k, query[k]]),
    ),
  };
}

const cell = (
  value,
  unit,
  status = value == null ? "missing" : "available",
  extra = {},
) => ({ value: value ?? null, unit, status, ...extra });
const small = (n, min) => n > 0 && n < min;
const overlaps = (period, range) =>
  Boolean(
    range?.from &&
    range?.to &&
    period.from <= range.to &&
    period.to >= range.from,
  );
function reach(row, min, available) {
  const ratios = {
    repeatRate: ["repeat", "unique"],
    frequency: ["seniorAttendance", "unique"],
    average: ["attendance", "sessions"],
    malePct: ["male", "knownGender"],
    minorityPct: ["minority", "knownRace"],
  };
  const hidden = !row || small(row.allAges, min);
  const seniorHidden =
    !row || small(row.unique, min) || small(row.allAges - row.unique, min);
  const partitions = {
    firstObserved: row && small(row.returning, min),
    returning: row && small(row.firstObserved, min),
    repeat: row && small(row.unique - row.repeat, min),
    multiProgramme: row && small(row.unique - row.multiProgramme, min),
    multiDomain: row && small(row.unique - row.multiDomain, min),
    male:
      row &&
      (small(row.knownGender - row.male, min) ||
        small(row.unique - row.male, min)),
    minority:
      row &&
      (small(row.knownRace - row.minority, min) ||
        small(row.unique - row.minority, min)),
    knownGender: row && small(row.unknownGender, min),
    knownRace: row && small(row.unknownRace, min),
  };
  const statusFor = (key) =>
    !available || !row
      ? "missing"
      : hidden ||
          (!["attendance", "allAges", "sessions", "programmes"].includes(key) &&
            seniorHidden) ||
          (small(row[key], min) && !["sessions", "programmes"].includes(key)) ||
          partitions[key] ||
          (key === "seniorAttendance" &&
            small(row.attendance - row.seniorAttendance, min))
        ? "suppressed"
        : "available";
  return Object.fromEntries(
    Object.entries(reachMetrics).map(([key, [, unit]]) => {
      const parts = ratios[key];
      const status = parts
        ? !available || !row
          ? "missing"
          : parts.some((p) => statusFor(p) === "suppressed")
            ? "suppressed"
            : row[parts[1]]
              ? "available"
              : "missing"
        : statusFor(key);
      return [
        key,
        cell(
          status === "available" ? row[key] : null,
          unit,
          status,
          parts
            ? {
                numerator: status === "available" ? row[parts[0]] : null,
                denominator: status === "available" ? row[parts[1]] : null,
              }
            : {},
        ),
      ];
    }),
  );
}
function distribution(rows, min, available, denominator) {
  const unsafe =
    small(denominator, min) ||
    rows.some((r) => small(r.value, min) || small(denominator - r.value, min));
  return cell(
    available && !unsafe ? rows : null,
    "people",
    !available ? "missing" : unsafe ? "suppressed" : "available",
  );
}
function definitions(endpoint, ranges, scores) {
  const { metrics, source, filters } = endpoints[endpoint];
  return Object.entries(metrics)
    .filter(
      ([id]) =>
        endpoint !== "health-assessments" ||
        scores ||
        ["reportedTotal", "screeningPeople", "screeningAttendance"].includes(
          id,
        ),
    )
    .map(([id, [displayName, unit, methodology]]) => {
      const availableDateRange =
        endpoint === "health-assessments"
          ? id === "reportedTotal"
            ? ranges.monthly
            : id.startsWith("screening")
              ? ranges.screening
              : ranges.sppb
          : endpoint === "membership"
            ? ranges.registry
            : endpoint === "kpis"
              ? ranges.targets
              : ranges.attendance;
      return {
        id,
        displayName,
        description: methodology,
        unit,
        methodology,
        supportedFilters: filters,
        aggregation:
          unit === "percent"
            ? "Ratio of source counts"
            : unit === "people"
              ? "Distinct people within each scope and category"
              : unit.includes("/") || unit === "points"
                ? "Mean within the selected scope"
                : "Count or stored value within the selected scope",
        dataSource: source,
        availableDateRange: availableDateRange || emptyRange(),
        availability: availableDateRange?.from ? "source_present" : "missing",
      };
    });
}

async function attendanceRange(db, now) {
  return db
    .prepare(
      "SELECT MIN(s.date) AS from_date, MAX(s.date) AS to_date FROM sessions s WHERE s.date<=? AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id=s.id)",
    )
    .get(now);
}
const range = (row) => ({
  from: row?.from_date ?? null,
  to: row?.to_date ?? null,
});

async function readWindow(db, to) {
  // History to the end is needed for first-observed and recency. Only joined
  // attendance data and the profile fields used by these reports are read.
  const sessions = await db
    .prepare(
      "SELECT s.* FROM sessions s WHERE s.date<=? AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id=s.id)",
    )
    .all(to);
  const attendance = await db
    .prepare(
      "SELECT a.id,a.session_id,a.participant_id FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date<=?",
    )
    .all(to);
  const participants = await db
    .prepare(
      "SELECT p.* FROM participants p JOIN (SELECT DISTINCT a.participant_id FROM sessions s JOIN attendance a ON a.session_id=s.id WHERE s.date<=?) cohort ON cohort.participant_id=p.id",
    )
    .all(to);
  const programmes = await db
    .prepare(
      "SELECT p.* FROM programmes p WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.programme_id=p.id AND s.date<=?)",
    )
    .all(to);
  return {
    participants: participants.map((r) => ({
      id: r.id,
      ...JSON.parse(r.details),
    })),
    programmes: programmes.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      optional: JSON.parse(r.optional),
    })),
    sessions: sessions.map((r) => ({
      id: r.id,
      programmeId: r.programme_id,
      date: r.date,
      start: r.start,
      end: r.end,
      venue: r.venue,
      optional: JSON.parse(r.optional),
    })),
    attendance: attendance.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      participantId: r.participant_id,
    })),
  };
}

async function reportData(db, settings, filters, now, mode, rawData) {
  if (!filters.subdomain && (mode === "summary" || mode === "month")) {
    const fast = await sqlDashboard(db, settings, {
      ...filters,
      view: mode === "month" ? "overview" : "context",
    });
    if (fast) return fast;
  }
  return analytics(
    await rawData(),
    settings,
    { ...filters, interval: mode, _noPrevious: true },
    now,
    mode === "summary" ? true : "external-detail",
  );
}

function paginate(rows, query) {
  const page = Number(query.page || 1),
    limit = Number(query.limit || 50);
  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: rows.length },
  };
}

function programmeRows(rows, minimum, previous) {
  const safe = (row) =>
    row.allAges >= minimum &&
    !small(row.unique, minimum) &&
    !small(row.allAges - row.unique, minimum);
  const prior = new Map(
    previous?.filter(safe).map((row) => [row.id, row]) || [],
  );
  return rows.filter(safe).map((row, index) => {
    const metrics = reach(row, minimum, true);
    return {
      programme: row.id,
      name: row.name,
      rank: index + 1,
      primaryDomain: row.sourceDomain,
      domains: row.combinedDomains,
      subdomains: row.eventTypes,
      metrics,
      previous: prior.has(row.id)
        ? reach(prior.get(row.id), minimum, true)
        : null,
      monthly: row.trend.map((month) => ({
        month: month.label,
        metrics: reach(month, minimum, true),
      })),
    };
  });
}

async function assessmentData(
  db,
  data,
  settings,
  filters,
  scope,
  query,
  now,
  min,
  linkedSppb,
) {
  const records = await db
    .prepare(
      "SELECT id,month,type,total,reported_as_of,complete,created FROM assessment_monthly WHERE month>=? AND month<=?",
    )
    .all(filters.from.slice(0, 7), filters.to.slice(0, 7));
  const result = operationsReport(
    data,
    settings,
    filters,
    records,
    {},
    "month",
    now,
  );
  const revisions = latestMonthly(records);
  const output = {};
  for (const type of query.assessmentType
    ? [query.assessmentType]
    : ["SPPB", "TANITA"]) {
    const key = type.toLowerCase(),
      screening = result.activityScreening[key];
    const present =
      scope.screening[type]?.from && overlaps(filters, scope.screening[type]);
    const hidden = small(screening.people, min);
    const monthlyHidden = result.monthly.some((row) => small(row[key], min));
    const reportedStatus = (value) =>
      value == null ? "missing" : monthlyHidden ? "suppressed" : "available";
    const reported = (value) =>
      cell(
        reportedStatus(value) === "available" ? value : null,
        "assessments",
        reportedStatus(value),
      );
    output[type] = {
      metrics: {
        reportedTotal: reported(result.summary[key]),
        screeningPeople: cell(
          present && !hidden ? screening.people : null,
          "people",
          !present ? "missing" : hidden ? "suppressed" : "available",
        ),
        screeningAttendance: cell(
          present && !hidden ? screening.attendance : null,
          "entries",
          !present ? "missing" : hidden ? "suppressed" : "available",
        ),
      },
      monthly: result.monthly.map((row) => ({
        month: row.label,
        reportedTotal: reported(row[key]),
        final:
          row[key] == null
            ? null
            : revisions.get(row.label + "|" + type)?.complete === 1,
      })),
      reportedMonths: result.health[key].reportedMonths,
      selectedMonths: result.health.selectedMonths,
    };
  }
  if (output.SPPB && linkedSppb) {
    const r = linkedSppb;
    const s = r.summary,
      paired = r.selected.filter((p) => p.delta != null);
    const scored = r.selected.filter((p) => p.latest?.standard);
    const baselines = scored.flatMap((member) => {
      const candidates = member.records
        .filter(
          (record) =>
            record.standard &&
            record.review?.disposition !== "superseded" &&
            record.date < member.latest.date &&
            record.scoringVersion === member.latest.scoringVersion,
        )
        .sort((a, b) => a.date.localeCompare(b.date));
      const first = candidates[0];
      return first &&
        member.records.filter(
          (record) =>
            record.date === first.date &&
            record.review?.disposition !== "superseded",
        ).length === 1
        ? [{ first, latest: member.latest }]
        : [];
    });
    const avg = (rows, fn) =>
      rows.length
        ? rows.reduce((sum, row) => sum + fn(row), 0) / rows.length
        : null;
    const protectedCohort =
      s.eligible < 2 * min || s.assessed < min || s.eligible - s.assessed < min;
    const hasRecords = r.monthly.length > 0;
    const changesHidden = [s.increased, s.unchanged, s.decreased].some((n) =>
      small(n, min),
    );
    const value = (amount, unit, hidden = false) =>
      cell(
        !hasRecords || protectedCohort || hidden ? null : amount,
        unit,
        !hasRecords
          ? "missing"
          : protectedCohort || hidden
            ? "suppressed"
            : amount == null
              ? "missing"
              : "available",
      );
    output.SPPB.linked = {
      eligible: value(s.eligible, "people"),
      assessed: value(s.assessed, "people"),
      coverage: {
        ...value(s.coverage, "percent"),
        numerator:
          hasRecords && !protectedCohort && s.coverage != null
            ? s.assessed
            : null,
        denominator:
          hasRecords && !protectedCohort && s.coverage != null
            ? s.eligible
            : null,
      },
      records: value(
        r.monthly.reduce((sum, row) => sum + row.members, 0),
        "assessments",
      ),
      repeated: value(
        s.repeated,
        "people",
        small(s.repeated, min) || small(s.assessed - s.repeated, min),
      ),
      scoreDistribution: value(
        r.recordedScores.map(({ sourceDefinition, total, members }) => ({
          sourceDefinition,
          score: total,
          people: members,
        })),
        "people",
        r.recordedScores.some(
          (row) =>
            small(row.members, min) || small(s.assessed - row.members, min),
        ),
      ),
      averageStandardScore: value(
        avg(scored, (p) => p.latest.standard.total),
        "points",
        scored.length < min,
      ),
      comparable: value(
        s.comparable,
        "people",
        small(s.comparable, min) || small(s.assessed - s.comparable, min),
      ),
      ...Object.fromEntries(
        ["increased", "unchanged", "decreased"].map((key) => [
          key,
          value(
            s[key],
            "people",
            changesHidden ||
              s.comparable < min ||
              small(s.assessed - s.comparable, min),
          ),
        ]),
      ),
      previousScore: value(
        avg(paired, (p) => p.previous.standard.total),
        "points",
        paired.length < min,
      ),
      latestScore: value(
        avg(paired, (p) => p.latest.standard.total),
        "points",
        paired.length < min,
      ),
      baselineScore: value(
        avg(baselines, (p) => p.first.standard.total),
        "points",
        baselines.length < min,
      ),
      baselineLatestScore: value(
        avg(baselines, (p) => p.latest.standard.total),
        "points",
        baselines.length < min,
      ),
      baselineMatched: value(
        baselines.length,
        "people",
        small(baselines.length, min) ||
          small(s.assessed - baselines.length, min),
      ),
    };
    const participantsByMonth = new Map();
    for (const member of r.selected) {
      const months = new Set(
        member.records
          .filter(
            (record) =>
              record.date &&
              record.date >= filters.from &&
              record.date <= filters.to &&
              record.review?.disposition !== "superseded",
          )
          .map((record) => record.date.slice(0, 7)),
      );
      for (const month of months)
        participantsByMonth.set(
          month,
          (participantsByMonth.get(month) || 0) + 1,
        );
    }
    const hideMonthly = [...participantsByMonth.values()].some((n) =>
      small(n, min),
    );
    output.SPPB.linkedMonthly =
      !hasRecords || hideMonthly || protectedCohort
        ? null
        : r.monthly.map((row) => ({ month: row.month, records: row.members }));
  }
  return output;
}

const emptyRange = () => ({ from: null, to: null });
async function sourceRanges(db, settings, now, includeHealth, includeClasses) {
  const ranges = {
    attendance: range(await attendanceRange(db, now)),
    classifications: new Set(),
  };
  if (includeClasses) {
    const classes = await db
      .prepare(
        "SELECT optional, MIN(date) AS from_date, MAX(date) AS to_date FROM sessions s WHERE date<=? AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id=s.id) GROUP BY optional",
      )
      .all(now);
    ranges.classificationDates = {};
    for (const row of classes) {
      for (const label of sessionEventTypes(
        { optional: JSON.parse(row.optional) },
        settings,
      )) {
        ranges.classifications.add(label);
        if (!["Fitness", "Gym Tonic", "H.ART"].includes(label)) continue;
        const previous = ranges.classificationDates[label];
        ranges.classificationDates[label] = previous
          ? {
              from:
                previous.from < row.from_date ? previous.from : row.from_date,
              to: previous.to > row.to_date ? previous.to : row.to_date,
            }
          : range(row);
      }
    }
  }
  if (includeHealth) {
    ranges.screening = {};
    for (const [type, names] of Object.entries(screeningActivityNames)) {
      const placeholders = names.map(() => "?").join(",");
      ranges.screening[type.toUpperCase()] = range(
        await db
          .prepare(
            `SELECT MIN(s.date) AS from_date, MAX(s.date) AS to_date FROM sessions s JOIN programmes p ON p.id=s.programme_id
          WHERE s.date<=? AND TRIM(p.name) IN (${placeholders}) AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id=s.id)`,
          )
          .get(now, ...names),
      );
    }
    const monthlyRange = await db
      .prepare(
        "SELECT MIN(month) AS from_date,MAX(month) AS to_date FROM assessment_monthly",
      )
      .get();
    ranges.monthly = monthlyRange?.from_date
      ? {
          from: monthlyRange.from_date + "-01",
          to: monthEnd(monthlyRange.to_date),
        }
      : emptyRange();
  }
  return ranges;
}

async function membershipData(db, settings, data, period, ranges, now, min) {
  const snapshot = await db
    .prepare("SELECT * FROM member_registry WHERE snapshot=?")
    .all(CLIENT_SNAPSHOT);
  const profiles = await db.prepare("SELECT * FROM participant_profiles").all();
  const state = { data, settings, registry: snapshot, profiles, feedback: [] };
  const registry = settings.registry;
  const verified =
    registry?.type === "clients" && validDay(registry.asOf || "");
  const current = verified && registry.asOf <= period.to;
  const people = verified
    ? clientPopulation(state, current ? period.to : now)
    : [];
  const complete = verified && registry.complete === true;
  const datesComplete =
    complete && people.every((p) => validDay(p.registrationDate || ""));
  const newMembers = datesComplete
    ? people.filter(
        (p) =>
          p.registrationDate >= period.from && p.registrationDate <= period.to,
      ).length
    : null;
  const observed =
    overlaps(period, ranges.attendance) && period.to <= ranges.attendance.to;
  const ctx =
    current && observed
      ? clientContext(state, { ...period, asOf: period.to }, now)
      : null;
  const statusCount = (predicate) =>
    ctx?.historyCurrent
      ? ctx.selected.filter((p) => predicate(p.status)).length
      : null;
  const count = (n) => {
    const hidden = [people.length, n, people.length - n].some((value) =>
      small(value, min),
    );
    return cell(
      hidden ? null : n,
      "people",
      n == null ? "missing" : hidden ? "suppressed" : "available",
    );
  };
  return {
    registered: count(complete && current ? people.length : null),
    newMembers: count(newMembers),
    active: count(statusCount((status) => status === "active")),
    inactive: count(statusCount((status) => status.startsWith("inactive"))),
  };
}

async function kpiData(db, settings, period, now, min, rawData, coverage) {
  const targets = await db
    .prepare(
      "SELECT metric,value,start,end,programme_id FROM targets WHERE start<=? AND end>=? ORDER BY start,end,metric,id",
    )
    .all(period.to, period.from);
  const operationTargets = await db
    .prepare(
      "SELECT month,metric,value FROM operational_targets WHERE month>=? AND month<=? ORDER BY month,metric",
    )
    .all(period.from.slice(0, 7), period.to.slice(0, 7));
  const output = [],
    dashboardScopes = new Map(),
    operationScopes = new Map();
  function append(target, source, actual, status) {
    const unit = ["sppb", "tanita"].includes(target.metric)
      ? "assessments"
      : "people";
    output.push({
      metric: target.metric,
      source,
      from: target.start,
      to: target.end,
      programme: target.programme_id || null,
      metrics: {
        actual: cell(actual, unit, status),
        target: cell(target.value, unit),
        attainment: cell(
          actual == null ? null : (actual / target.value) * 100,
          "percent",
          status,
          { numerator: actual, denominator: target.value },
        ),
      },
    });
  }
  for (const target of targets) {
    const filter = {
      from: target.start,
      to: target.end < now ? target.end : now,
      programme: target.programme_id || undefined,
    };
    const key = JSON.stringify(filter);
    if (
      filter.from <= filter.to &&
      overlaps(filter, coverage) &&
      !dashboardScopes.has(key)
    )
      dashboardScopes.set(
        key,
        (await reportData(db, settings, filter, now, "summary", rawData))
          .summary,
      );
    const summary = dashboardScopes.get(key);
    const n = summary?.[target.metric];
    const hidden =
      summary &&
      (small(summary.unique, min) ||
        small(n, min) ||
        small(summary.unique - n, min));
    append(
      target,
      "dashboard",
      hidden ? null : (n ?? null),
      hidden ? "suppressed" : n == null ? "missing" : "available",
    );
  }
  for (const target of operationTargets) {
    if (!Object.hasOwn(operationMetrics, target.metric)) continue;
    const from = target.month + "-01",
      to = monthEnd(target.month);
    if (from <= now && !operationScopes.has(target.month)) {
      const records = await db
        .prepare(
          "SELECT id,month,type,total,reported_as_of,complete FROM assessment_monthly WHERE month=?",
        )
        .all(target.month);
      const report = operationsReport(
        await rawData(),
        settings,
        { from, to },
        records,
        {},
        "month",
        now,
      );
      operationScopes.set(target.month, report.summary);
    }
    const summary = operationScopes.get(target.month);
    const health = ["sppb", "tanita"].includes(target.metric);
    const n =
      health || overlaps({ from, to }, coverage)
        ? summary?.[target.metric]
        : null;
    const hidden =
      small(n, min) ||
      (!health &&
        summary &&
        (small(summary.unique, min) || small(summary.unique - n, min)));
    append(
      { ...target, start: from, end: to },
      "operations",
      hidden ? null : (n ?? null),
      hidden ? "suppressed" : n == null ? "missing" : "available",
    );
  }
  return output;
}

const explicitTypes = { fitness: ["Fitness", "Gym Tonic"], hart: ["H.ART"] };
async function execute(
  db,
  storage,
  endpoint,
  query,
  filters,
  now,
  scores,
  sppb,
) {
  const settings = await storage.getSettings(db);
  const minimum = Math.max(5, Number(settings.privacyMinimum) || 5);
  const catalogue = endpoint === "datasets";
  const ranges = await sourceRanges(
    db,
    settings,
    now,
    catalogue || endpoint === "health-assessments",
    catalogue || Boolean(explicitTypes[endpoint]),
  );
  const policy = { settings, mode: "official" };
  const historyThrough = endpoint === "kpis" ? now : filters.to;
  let data;
  const rawData = () =>
    (data ??= (async () => {
      const raw = await readWindow(db, historyThrough);
      const profiles = await db
        .prepare(
          "SELECT * FROM participant_profiles WHERE EXISTS (SELECT 1 FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.participant_id=participant_profiles.participant_id AND s.date<=?)",
        )
        .all(historyThrough);
      return materializeProfiles(projectReportingData(raw), profiles);
    })());
  const imported = await db
    .prepare("SELECT MAX(created) AS latest FROM imports")
    .get();
  const modified = await db
    .prepare(
      `SELECT MAX(created) AS latest FROM audit WHERE
    action IN ('definitions.updated','target.created','target.removed','client.registry.imported','client.membership.changed','client.reporting.settings.updated')
    OR action LIKE 'configuration.%' OR action LIKE 'operations.%' OR action LIKE 'data-management.%'`,
    )
    .get();
  const lastAssessment =
    catalogue || endpoint === "health-assessments" || endpoint === "kpis"
      ? await db
          .prepare("SELECT MAX(created) AS latest FROM assessment_monthly")
          .get()
      : null;
  const lastSppb = sppb?.selected
    .flatMap((member) => member.records)
    .flatMap((record) => [record.importedAt, record.review?.reviewedAt])
    .filter(Boolean)
    .sort()
    .at(-1);
  const asUpdated =
    [imported.latest, modified.latest, lastAssessment?.latest, lastSppb]
      .filter(Boolean)
      .sort()
      .at(-1) || null;

  return reportingContext.run(policy, async () => {
    const meta = {
      availableDateRange: ranges.attendance,
      dataLastUpdatedAt: asUpdated,
      reporting: policySummary(),
      privacyMinimum: minimum,
    };
    if (catalogue) {
      ranges.registry = settings.registry?.asOf
        ? { from: settings.registry.asOf, to: settings.registry.asOf }
        : emptyRange();
      const planned = range(
        await db
          .prepare(
            "SELECT MIN(start) AS from_date,MAX(end) AS to_date FROM targets",
          )
          .get(),
      );
      const operations = range(
        await db
          .prepare(
            "SELECT MIN(month) AS from_date,MAX(month) AS to_date FROM operational_targets",
          )
          .get(),
      );
      ranges.targets = {
        from:
          [planned.from, operations.from && operations.from + "-01"]
            .filter(Boolean)
            .sort()[0] || null,
        to:
          [planned.to, operations.to && monthEnd(operations.to)]
            .filter(Boolean)
            .sort()
            .at(-1) || null,
      };
      ranges.sppb = emptyRange();
      if (scores) {
        const report = sppb;
        const days = report.selected
          .flatMap((member) =>
            member.records
              .filter((r) => r.date && r.review?.disposition !== "superseded")
              .map((r) => r.date),
          )
          .sort();
        if (
          report.summary.eligible >= 2 * minimum &&
          report.summary.assessed >= minimum &&
          report.summary.eligible - report.summary.assessed >= minimum &&
          days.length
        )
          ranges.sppb = {
            from: days[0].slice(0, 7) + "-01",
            to: monthEnd(days.at(-1).slice(0, 7)),
          };
      }
      const screening = Object.values(ranges.screening);
      const screenFrom = screening
        .map((r) => r.from)
        .filter(Boolean)
        .sort()[0];
      const screenTo = screening
        .map((r) => r.to)
        .filter(Boolean)
        .sort()
        .at(-1);
      ranges.screening = { from: screenFrom || null, to: screenTo || null };
      return {
        ...meta,
        datasets: Object.keys(endpoints)
          .filter(
            (key) =>
              !explicitTypes[key] ||
              explicitTypes[key].some((label) =>
                ranges.classifications.has(label),
              ),
          )
          .map((id) => {
            const classifications = explicitTypes[id]?.filter((label) =>
              ranges.classifications.has(label),
            );
            const availableDateRange = classifications
              ? {
                  from: classifications
                    .map((label) => ranges.classificationDates[label].from)
                    .sort()[0],
                  to: classifications
                    .map((label) => ranges.classificationDates[label].to)
                    .sort()
                    .at(-1),
                }
              : ranges.attendance;
            return {
              id,
              supportedFilters: endpoints[id].filters,
              ...(classifications ? { classifications } : {}),
              metrics: definitions(
                id,
                { ...ranges, attendance: availableDateRange },
                scores,
              ),
            };
          }),
      };
    }

    const available = overlaps(filters, ranges.attendance);
    const days =
      (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000 + 1;
    const prior = {
      ...filters,
      from: shift(filters.from, -days),
      to: shift(filters.from, -1),
    };
    const previousFilters =
      available &&
      overlaps(prior, ranges.attendance) &&
      prior.from >= ranges.attendance.from
        ? prior
        : null;
    if (endpoint === "membership")
      return {
        ...meta,
        availableDateRange: settings.registry?.asOf
          ? { from: settings.registry.asOf, to: settings.registry.asOf }
          : emptyRange(),
        metrics: await membershipData(
          db,
          settings,
          await rawData(),
          filters,
          ranges,
          now,
          minimum,
        ),
      };
    if (endpoint === "health-assessments")
      return {
        ...meta,
        availableDateRange: ranges.monthly,
        assessments: await assessmentData(
          db,
          await rawData(),
          settings,
          filters,
          ranges,
          query,
          now,
          minimum,
          sppb,
        ),
      };
    if (endpoint === "kpis")
      return {
        ...meta,
        rows: await kpiData(
          db,
          settings,
          filters,
          now,
          minimum,
          rawData,
          ranges.attendance,
        ),
      };

    const labels = explicitTypes[endpoint];
    const label =
      labels &&
      (filters.subdomain ||
        labels.find((value) => ranges.classifications.has(value)));
    if (
      labels &&
      (!labels.includes(label) || !ranges.classifications.has(label))
    )
      throw invalid(
        "This explicit classification is unavailable in the centre source.",
        404,
      );
    const effective = label ? { ...filters, subdomain: label } : filters;
    const mode =
      endpoint === "trends"
        ? query.grain || "month"
        : endpoint === "summary"
          ? "summary"
          : "detail";
    const current = await reportData(
      db,
      settings,
      effective,
      now,
      mode,
      rawData,
    );
    const dataRange = label
      ? ranges.classificationDates[label]
      : ranges.attendance;
    const base = {
      ...meta,
      availableDateRange: dataRange,
      coverageStatus: !overlaps(filters, dataRange)
        ? "missing"
        : filters.from < dataRange.from || filters.to > dataRange.to
          ? "partial"
          : "within_observed_range",
      metrics: reach(current.summary, minimum, overlaps(filters, dataRange)),
    };
    if (label) base.classification = label;
    if (
      [
        "summary",
        "attendance",
        "programmes",
        "fitness",
        "hart",
        "trends",
      ].includes(endpoint)
    ) {
      const programmeList = ["programmes", "fitness", "hart"].includes(
        endpoint,
      );
      const prior = previousFilters
        ? await reportData(
            db,
            settings,
            {
              ...effective,
              from: previousFilters.from,
              to: previousFilters.to,
            },
            now,
            programmeList ? "detail" : "summary",
            rawData,
          )
        : null;
      base.previous =
        prior && overlaps(previousFilters, dataRange)
          ? {
              from: previousFilters.from,
              to: previousFilters.to,
              metrics: reach(prior.summary, minimum, true),
            }
          : null;
      if (programmeList) {
        const rows = programmeRows(
          current.programmes,
          minimum,
          prior?.programmes,
        );
        return { ...base, ...paginate(rows, query) };
      }
    }
    if (endpoint === "demographics") {
      const rows = analytics(
        await rawData(),
        settings,
        effective,
        now,
        false,
        "rows",
      );
      const languages = new Map();
      for (const p of new Map(
        rows
          .filter((a) => a.p.age != null && a.p.age >= settings.seniorAge)
          .map((a) => [a.p.id, a.p]),
      ).values()) {
        const labels = Array.isArray(p.preferredLanguage)
          ? p.preferredLanguage
          : [p.preferredLanguage];
        for (const label of new Set(labels.filter(Boolean)))
          if (typeof label === "string")
            languages.set(label, (languages.get(label) || 0) + 1);
      }
      return {
        ...meta,
        metrics: Object.fromEntries(
          Object.keys(demographicMetrics).map((key) => [
            key,
            distribution(
              key === "language"
                ? [...languages].map(([label, value]) => ({ label, value }))
                : current[key],
              minimum,
              available && (key !== "language" || languages.size > 0),
              current.summary.unique,
            ),
          ]),
        ),
      };
    }
    if (endpoint === "attendance") {
      base.metrics.frequencyDistribution = distribution(
        current.frequency,
        minimum,
        available,
        current.summary.unique,
      );
      const data = await rawData();
      const members = (scope) =>
        new Set(
          analytics(data, settings, scope, now, false, "rows")
            .filter((a) => a.p.age != null && a.p.age >= settings.seniorAge)
            .map((a) => a.p.id),
        );
      const previous = previousFilters
        ? members({
            ...effective,
            from: previousFilters.from,
            to: previousFilters.to,
          })
        : null;
      const currentMembers = previous ? members(effective) : null;
      const retained = previous
        ? [...previous].filter((id) => currentMembers.has(id)).length
        : null;
      const status = !previous?.size
        ? "missing"
        : [
              previous.size,
              currentMembers.size,
              retained,
              previous.size - retained,
              currentMembers.size - retained,
            ].some((n) => small(n, minimum))
          ? "suppressed"
          : "available";
      base.metrics.retained = cell(
        status === "available" ? retained : null,
        "people",
        status,
      );
      base.metrics.retentionRate = cell(
        status === "available" ? (retained / previous.size) * 100 : null,
        "percent",
        status,
        {
          numerator: status === "available" ? retained : null,
          denominator: status === "available" ? previous.size : null,
        },
      );
    }
    if (endpoint === "trends") {
      const grain = query.grain || "month";
      base.rows = current.trends.map((row) => {
        const year = row.label.slice(0, 4);
        const month =
          grain === "year"
            ? 1
            : grain === "quarter"
              ? (Number(row.label.at(-1)) - 1) * 3 + 1
              : Number(row.label.slice(-2));
        const boundary = (n) => year + "-" + String(n).padStart(2, "0");
        const start = boundary(month) + "-01",
          end = monthEnd(
            boundary(
              month + (grain === "year" ? 11 : grain === "quarter" ? 2 : 0),
            ),
          );
        const from = start < filters.from ? filters.from : start,
          to = end > filters.to ? filters.to : end;
        return {
          period: row.label,
          from,
          to,
          partial: from !== start || to !== end,
          metrics: reach(
            row,
            minimum,
            overlaps({ from, to }, ranges.attendance),
          ),
        };
      });
    }
    return base;
  });
}

export function mountManagementReporting(
  app,
  { ready, workspaces, control, getSppb, config },
) {
  const router = Router();
  const key = config?.key ?? process.env.MANAGEMENT_HUB_API_KEY ?? "";
  const centres = (config?.centres ?? process.env.MANAGEMENT_HUB_CENTRES ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const scores =
    config?.scores ?? process.env.MANAGEMENT_HUB_SPPB_AGGREGATES === "1";
  const enabled =
    key.length >= 32 && centres.length > 0 && centres.every(centreById);
  const cache = boundedAnalyticsCache({
    ttlMs: 30000,
    maxEntries: 48,
    maxPending: 12,
  });
  let concurrent = 0;
  router.use(async (req, res) => {
    res.set({ "Cache-Control": "no-store", Vary: "Authorization" });
    try {
      if (!enabled)
        throw invalid("Management Hub reporting is unavailable.", 503);
      const authorization = req.get("authorization") || "";
      const token = /^Bearer ([^\s,]+)$/i.exec(authorization)?.[1] || "";
      if (!token || !timingSafeEqual(digest(token), digest(key))) {
        res.set("WWW-Authenticate", 'Bearer realm="Management Hub reporting"');
        throw invalid("A valid reporting bearer token is required.", 401);
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.set("Allow", "GET, HEAD");
        throw invalid("Method not allowed.", 405);
      }
      const endpoint = req.path.replace(/^\/|\/$/g, "");
      if (
        endpoint !== "health" &&
        endpoint !== "datasets" &&
        !Object.hasOwn(endpoints, endpoint)
      )
        throw invalid("Reporting dataset not found.", 404);
      const now = todaySG(),
        query = req.query;
      const filters = parseReportingQuery(query, endpoint, now);
      const centre = centreById(
        query.centre || (centres.length === 1 ? centres[0] : ""),
      );
      if (!centre) throw invalid("Select a valid centre.");
      if (!centres.includes(centre.id))
        throw invalid("The token does not grant access to this centre.", 403);
      await ready;
      const active = await control
        .prepare("SELECT id FROM centres WHERE id=? AND status='Active'")
        .get(centre.id);
      if (!active) throw invalid("Reporting centre is unavailable.", 404);
      const envelope = {
        sourceSystem,
        centreId: centre.id,
        centreName: centre.name,
        dataset: endpoint,
        schemaVersion: "1.0",
        timezone,
        period: ["health", "datasets"].includes(endpoint)
          ? null
          : { from: filters.from, to: filters.to },
        appliedFilters: { ...query, centre: centre.id },
        dataRetrievedAt: new Date().toISOString(),
      };
      if (endpoint === "health") {
        const existing = await workspaces.withExisting(centre.id, (db) =>
          db.prepare("SELECT id FROM settings WHERE id=1").get(),
        );
        return res.json({
          ...envelope,
          status: "ready",
          workspaceAvailable: Boolean(existing),
          dataLastUpdatedAt: null,
        });
      }
      if (concurrent >= 12)
        throw invalid("Reporting is busy. Retry shortly.", 429);
      concurrent++;
      try {
        const cacheKey = JSON.stringify([
          centre.id,
          endpoint,
          now,
          filters,
          query.grain,
          query.assessmentType,
          Number(query.page || 1),
          Number(query.limit || 50),
        ]);
        const result = await cache.run(
          cacheKey,
          () => Math.floor(Date.now() / 30000),
          () =>
            workspaces.withExisting(centre.id, async (db) => {
              const storage = db.storage || { getSettings };
              const linked =
                scores &&
                (endpoint === "datasets" ||
                  (endpoint === "health-assessments" &&
                    query.assessmentType !== "TANITA"));
              const sppbResult = linked
                ? await getSppb()(
                    centre.id,
                    db,
                    endpoint === "datasets"
                      ? {}
                      : {
                          from: filters.from,
                          to: filters.to,
                          asOf: filters.to,
                        },
                  )
                : null;
              const work = (tx) =>
                execute(
                  tx,
                  storage,
                  endpoint,
                  query,
                  filters,
                  now,
                  scores,
                  sppbResult,
                );
              return db.transaction
                ? db.transaction(work, { readOnly: true })
                : work(db);
            }),
        );
        if (!result) {
          if (explicitTypes[endpoint])
            throw invalid(
              "This explicit classification is unavailable in the centre source.",
              404,
            );
          return res.json({
            ...envelope,
            status: "missing",
            reason: "No existing centre workspace.",
            dataLastUpdatedAt: null,
            ...(endpoint === "datasets"
              ? {
                  datasets: Object.keys(endpoints)
                    .filter((id) => !explicitTypes[id])
                    .map((id) => ({
                      id,
                      supportedFilters: endpoints[id].filters,
                      metrics: definitions(
                        id,
                        { screening: emptyRange() },
                        scores,
                      ),
                    })),
                }
              : {}),
          });
        }
        return res.json({ ...envelope, ...result });
      } finally {
        concurrent--;
      }
    } catch (error) {
      const status = [400, 401, 403, 404, 405, 429, 503].includes(error.status)
        ? error.status
        : 500;
      return res.status(status).json({
        error:
          status === 500
            ? "Reporting data could not be retrieved."
            : error.message,
      });
    }
  });
  app.use("/api/reporting/v1", router);
}

export const reportingSpec = {
  endpoints,
  periodKeys,
  centres: CENTRES.map((c) => c.id),
};
