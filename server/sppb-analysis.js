import { PROGRAMME_DOMAINS, sessionDomains } from "./programme-domains.js";
import { projectReportingData, performanceData } from "./reporting-policy.js";

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length
    ? (v[Math.floor(v.length / 2)] + v[Math.floor((v.length - 1) / 2)]) / 2
    : null;
};
export function windowStart(date) {
  const d = new Date(date + "T00:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 6);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const profileLabel = (member, key) =>
  member.profileConflicts?.includes(key)
    ? "Conflicting centre profiles"
    : String(member[key] ?? "").trim() || "Not recorded";
const ageLabel = (m) =>
  m.profileConflicts?.includes("age")
    ? "Conflicting centre profiles"
    : m.age == null
      ? "Not recorded"
      : m.age < 60
        ? "Below 60"
        : m.age < 70
          ? "60–69"
          : m.age < 80
            ? "70–79"
            : "80+";
function metrics(rows) {
  const comparable = rows.filter((r) => r.member.delta != null);
  return {
    members: rows.length,
    medianTotal: median(rows.map((r) => r.member.latest.original.total)),
    medianSessions: median(
      rows.filter((r) => r.historyAvailable).map((r) => r.sessions.length),
    ),
    historyAvailable: rows.filter((r) => r.historyAvailable).length,
    windowSpanned: rows.filter((r) => r.windowSpanned).length,
    smallSample: rows.length > 0 && rows.length < 5,
    validatedPairs: comparable.length,
    medianValidatedChange: median(comparable.map((r) => r.member.delta)),
  };
}
/** One pass over permitted attendance; all score summaries stay within their recorded source definition. */
export function sppbParticipationAnalysis(members, states, asOf) {
  const allowed = new Set(members.map((m) => m.id)),
    attendance = new Map(),
    coverage = new Map();
  for (const state of states) {
    const rawSessions = new Map(state.data.sessions.map((s) => [s.id, s]));
    let first = null,
      last = null;
    for (const a of state.data.attendance) {
      const date = rawSessions.get(a.sessionId)?.date;
      if (!date || date > asOf) continue;
      if (!first || date < first) first = date;
      if (!last || date > last) last = date;
    }
    coverage.set(state.id, state.coverage||{ first, last });
    const data = performanceData(
        projectReportingData(state.data, {
          settings: state.settings,
          mode: "official",
        }),
      ),
      sessions = new Map(data.sessions.map((s) => [s.id, s])),
      programmes = new Map(data.programmes.map((p) => [p.id, p])),
      classifications = new Map(),
      seen = new Set();
    for (const a of data.attendance) {
      if (!allowed.has(a.participantId)) continue;
      const s = sessions.get(a.sessionId),
        p = programmes.get(s?.programmeId),
        key = a.participantId + ":" + a.sessionId;
      if (!s || !p || s.date > asOf || seen.has(key)) continue;
      seen.add(key);
      if (!classifications.has(s.id))
        classifications.set(s.id, sessionDomains(s, p, state.settings));
      if (!attendance.has(a.participantId)) attendance.set(a.participantId, []);
      attendance.get(a.participantId).push({
        id: state.id + ":" + s.id,
        centre: state.id,
        date: s.date,
        programme: state.id + ":" + p.id,
        name: p.name,
        domains: classifications.get(s.id),
      });
    }
  }
  const scored = [],
    exclusions = { noDatedAssessment: 0, ambiguousLatest: 0, missingTotal: 0 };
  for (const member of members) {
    if (!member.latestDate) {
      exclusions.noDatedAssessment++;
      continue;
    }
    if (!member.latest) {
      exclusions.ambiguousLatest++;
      continue;
    }
    if (!Number.isFinite(member.latest.original?.total)) {
      exclusions.missingTotal++;
      continue;
    }
    const from = windowStart(member.latestDate),
      centres = member.centres || [];
    const historyAvailable = centres.some(
      (c) =>
        coverage.get(c)?.first && coverage.get(c).first <= member.latestDate,
    );
    const windowSpanned =
      centres.length > 0 &&
      centres.every(
        (c) =>
          coverage.get(c)?.first <= from &&
          coverage.get(c)?.last >= member.latestDate,
      );
    const sessions = (attendance.get(member.id) || []).filter(
      (s) =>
        centres.includes(s.centre) &&
        s.date >= from &&
        s.date <= member.latestDate,
    );
    const between =
      member.previous && member.delta != null
        ? (attendance.get(member.id) || []).filter(
            (s) =>
              centres.includes(s.centre) &&
              s.date > member.previous.date &&
              s.date <= member.latestDate,
          )
        : null;
    const pairHistory =
      member.previous &&
      centres.some((c) => coverage.get(c)?.first <= member.previous.date);
    scored.push({
      member,
      sessions,
      historyAvailable,
      windowSpanned,
      between,
      pairHistory,
    });
  }
  const sources = new Map();
  for (const r of scored) {
    const source =
      r.member.latest.sourceDefinition || "Unspecified source definition";
    if (!sources.has(source)) sources.set(source, []);
    sources.get(source).push(r);
  }
  const sourceGroups = [...sources]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sourceDefinition, rows]) => {
      const factors = {
        attendance: (r) =>
          !r.historyAvailable
            ? "History unavailable"
            : r.sessions.length === 0
              ? "None recorded"
              : r.sessions.length === 1
                ? "One session"
                : "Two or more sessions",
        age: (r) => ageLabel(r.member),
        gender: (r) => profileLabel(r.member, "gender"),
        race: (r) => profileLabel(r.member, "race"),
        cfs: (r) => profileLabel(r.member, "cfs"),
        srf: (r) => profileLabel(r.member, "riskRaw"),
        living: (r) => profileLabel(r.member, "livingRaw"),
      };
      const cohorts = {};
      for (const [factor, label] of Object.entries(factors)) {
        const buckets = new Map();
        for (const row of rows) {
          const key = label(row);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(row);
        }
        cohorts[factor] = [...buckets].map(([label, items]) => ({
          label,
          ...metrics(items),
        }));
      }
      cohorts.attendance.sort(
        (a, b) =>
          [
            "None recorded",
            "One session",
            "Two or more sessions",
            "History unavailable",
          ].indexOf(a.label) -
          [
            "None recorded",
            "One session",
            "Two or more sessions",
            "History unavailable",
          ].indexOf(b.label),
      );
      cohorts.age.sort(
        (a, b) =>
          [
            "Below 60",
            "60–69",
            "70–79",
            "80+",
            "Not recorded",
            "Conflicting centre profiles",
          ].indexOf(a.label) -
          [
            "Below 60",
            "60–69",
            "70–79",
            "80+",
            "Not recorded",
            "Conflicting centre profiles",
          ].indexOf(b.label),
      );
      const domains = PROGRAMME_DOMAINS.map((label) => ({
        label,
        attended: metrics(
          rows.filter((r) => r.sessions.some((s) => s.domains.includes(label))),
        ),
        noRecordedAttendance: metrics(
          rows.filter(
            (r) =>
              r.historyAvailable &&
              !r.sessions.some((s) => s.domains.includes(label)),
          ),
        ),
      }));
      const programmes = new Map();
      for (const row of rows)
        for (const s of row.sessions) {
          if (!programmes.has(s.programme))
            programmes.set(s.programme, {
              name: s.name,
              centre: s.centre,
              rows: new Set(),
              sessions: new Set(),
            });
          const p = programmes.get(s.programme);
          p.rows.add(row);
          p.sessions.add(s.id);
        }
      const changes = [
        "None recorded",
        "One session",
        "Two or more sessions",
        "History unavailable",
      ]
        .map((label) => {
          const pairs = rows.filter(
            (r) =>
              r.between !== null &&
              (!r.pairHistory
                ? "History unavailable"
                : r.between.length === 0
                  ? "None recorded"
                  : r.between.length === 1
                    ? "One session"
                    : "Two or more sessions") === label,
          );
          return {
            label,
            members: pairs.length,
            medianChange: median(pairs.map((r) => r.member.delta)),
          };
        })
        .filter((g) => g.members);
      return {
        sourceDefinition,
        ...metrics(rows),
        unvalidated: rows.filter((r) => !r.member.latest.standard).length,
        domains,
        cohorts,
        changes,
        programmes: [...programmes]
          .map(([id, p]) => ({
            id,
            name: p.name,
            centre: p.centre,
            sessions: p.sessions.size,
            ...metrics([...p.rows]),
          }))
          .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name))
          .slice(0, 5),
      };
    });
  const findings = [];
  if (scored.length)
    findings.push({
      finding: `${scored.length} of ${members.length} selected clients have an unambiguous dated numeric score.`,
      meaning:
        "This is the linked analysis population, not a clinical outcome measure.",
      next: "Review missing dates or conflicting same-day records to improve coverage.",
    });
  const unavailable = scored.filter((r) => !r.historyAvailable).length,
    partial = scored.filter(
      (r) => r.historyAvailable && !r.windowSpanned,
    ).length;
  if (unavailable || partial)
    findings.push({
      finding: `${unavailable} scored clients lack prior attendance history; ${partial} have history that does not span the full six-month window.`,
      meaning: "No recorded attendance may reflect incomplete history.",
      next: "Check attendance coverage before planning follow-up or comparing groups.",
    });
  for (const source of sourceGroups) {
    const active = source.cohorts.attendance.find(
        (r) => r.label === "Two or more sessions",
      ),
      none = source.cohorts.attendance.find((r) => r.label === "None recorded");
    if (active?.members >= 5 && none?.members >= 5)
      findings.push({
        sourceDefinition: source.sourceDefinition,
        finding: `Within ${source.sourceDefinition}, the recorded median is ${active.medianTotal} for ${active.members} clients attending two or more sessions and ${none.medianTotal} for ${none.members} with none recorded.`,
        meaning:
          "These are different groups; scoring conventions, age, assessment timing, history gaps and other differences may explain the pattern.",
        next: "Review the age and CFS breakdowns and participant feedback; this comparison does not show programme impact.",
      });
  }
  return {
    population: members.length,
    scored: scored.length,
    exclusions,
    asOf,
    lookbackMonths: 6,
    historyUnavailable: unavailable,
    partialHistory: partial,
    sourceGroups,
    findings: findings.slice(0, 3),
    note: "Current verified clients only. Attendance counts distinct delivered sessions in the six calendar months (including the assessment day; within-day order is unknown) ending on each client’s latest assessment date, within their current authorised centre affiliations. Programme exclusions follow official reporting rules. Cohorts use current recorded profiles, not profiles verified at assessment time. Raw totals are descriptive within each source definition; they are not standardised scores or clinical improvement. Domain groups overlap. An association does not establish cause or programme effectiveness.",
  };
}
