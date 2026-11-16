import { clientContext, clientPopulation, validDay } from "./client-domain.js";
import { todaySG } from "./domain.js";
import {
  outreachRules,
  priorityScore,
  lapsingWatch,
  OUTREACH_EXPORT_COLUMNS,
} from "../shared/outreach-priority-rules.js";
import { recencyBucket } from "../shared/engagement-depth.js";
const fail = (message) => Object.assign(Error(message), { status: 400 });
const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const moveDay = (date, days) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

export function attendanceDates(data, cutoff) {
  const programmes = new Set(data.programmes.map((p) => p.id));
  const sessions = new Map(
    data.sessions
      .filter(
        (s) =>
          programmes.has(s.programmeId) && validDay(s.date) && s.date <= cutoff,
      )
      .map((s) => [s.id, s]),
  );
  const dates = new Map();
  for (const a of data.attendance) {
    const s = sessions.get(a.sessionId);
    if (!s) continue;
    if (!dates.has(a.participantId)) dates.set(a.participantId, new Set());
    dates.get(a.participantId).add(s.date);
  }
  return new Map([...dates].map(([id, values]) => [id, [...values].sort()]));
}

export function registrationConversion(
  people,
  history,
  coverage,
  anchor,
  recentDays,
) {
  const result = {
    anchor,
    from: anchor ? moveDay(anchor, -recentDays + 1) : null,
    days: recentDays,
    totalClients: people.length,
    unknownRegistration: 0,
    outsideRecentCohort: 0,
    recentRegistered: 0,
    recordedBeforeRegistration: 0,
    windows: [],
  };
  if (!anchor)
    return {
      ...result,
      unknownRegistration: people.filter((p) => !validDay(p.registrationDate))
        .length,
      outsideRecentCohort: null,
      recentRegistered: null,
      recordedBeforeRegistration: null,
    };
  const known = [];
  for (const p of people) {
    if (!validDay(p.registrationDate)) {
      result.unknownRegistration++;
      continue;
    }
    if (
      !anchor ||
      p.registrationDate < result.from ||
      p.registrationDate > anchor
    ) {
      result.outsideRecentCohort++;
      continue;
    }
    known.push(p);
  }
  result.recentRegistered = known.length;
  result.recordedBeforeRegistration = known.filter((p) =>
    (history.get(p.id) || []).some((date) => date < p.registrationDate),
  ).length;
  for (const days of [14, 30]) {
    const row = {
      days,
      eligible: 0,
      attendedWithin: 0,
      notWithin: 0,
      attendedLater: 0,
      noRecordedAfterRegistration: 0,
      pending: 0,
      startNotCovered: 0,
      rate: null,
    };
    for (const p of known) {
      if (!coverage.from || coverage.from > p.registrationDate) {
        row.startNotCovered++;
        continue;
      }
      if (moveDay(p.registrationDate, days) > anchor) {
        row.pending++;
        continue;
      }
      row.eligible++;
      const first = (history.get(p.id) || []).find(
        (date) => date >= p.registrationDate && date <= anchor,
      );
      if (first && daysBetween(p.registrationDate, first) <= days)
        row.attendedWithin++;
      else {
        row.notWithin++;
        if (first) row.attendedLater++;
        else row.noRecordedAfterRegistration++;
      }
    }
    row.rate = row.eligible
      ? Math.round((row.attendedWithin / row.eligible) * 1000) / 10
      : null;
    result.windows.push(row);
  }
  return result;
}

export function outreachPriorities(state, input = {}, now = todaySG()) {
  const {
    view = "priorities",
    indicator = "all",
    recency = "all",
    page = 0,
    pageSize = 25,
    filters = {},
  } = input;
  if (
    Object.keys(input).some(
      (k) =>
        ![
          "view",
          "indicator",
          "recency",
          "page",
          "pageSize",
          "filters",
        ].includes(k),
    ) ||
    !["priorities", "watch"].includes(view) ||
    !["all", "any", "cfs", "alone", "srf", "missing"].includes(indicator) ||
    ![
      "all",
      "within30",
      "days31to60",
      "days61to90",
      "over90",
      "noHistory",
      "unavailable",
    ].includes(recency) ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !filters ||
    typeof filters !== "object" ||
    Array.isArray(filters) ||
    filters.status
  )
    throw fail(
      "Choose supported priority filters, view and pagination. Attendance eligibility is defined by the priority rules.",
    );
  const ctx = clientContext(state, filters, now),
    rules = outreachRules(ctx.settings.outreachRules);
  const history = attendanceDates(state.data, ctx.q.asOf);
  const evaluated = ctx.comparison.map((p) => {
    const score = priorityScore(
      { ...p, asOf: ctx.q.asOf },
      ctx.settings,
      rules,
      ctx.historyCurrent,
    );
    const watch = lapsingWatch(
      p,
      history.get(p.id) || [],
      rules,
      ctx.historyCurrent,
    );
    const recent =
      p.last === null
        ? "noHistory"
        : ctx.historyCurrent
          ? recencyBucket(p.last, ctx.q.asOf)
          : "unavailable";
    return { p, ...score, watch, recency: recent };
  });
  const available = !!ctx.coverage.from;
  const candidates = available ? evaluated.filter((r) => r.eligible) : [];
  const watch = ctx.historyCurrent ? evaluated.filter((r) => r.watch) : [];
  const filtered = (view === "watch" ? watch : candidates)
    .filter(
      (r) =>
        (indicator === "all" ||
          (indicator === "any" && r.indicators.length > 0) ||
          (indicator === "missing" && r.missingFields.length > 0) ||
          r.indicators.includes(indicator)) &&
        (recency === "all" || recency === r.recency),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        (ctx.historyCurrent ? (b.p.days ?? -1) - (a.p.days ?? -1) : 0) ||
        String(a.p.memberId).localeCompare(String(b.p.memberId), "en", {
          numeric: true,
        }),
    );
  const rows = filtered
    .slice(page * pageSize, (page + 1) * pageSize)
    .map((r) => ({
      id: r.p.id,
      memberId: r.p.memberId || "ID not recorded",
      age: r.p.age ?? null,
      living: r.p.livingRaw || "Not recorded",
      block: r.p.blockRaw || "Not recorded",
      last: r.p.last,
      status: r.p.status,
      attendance: r.p.selectedSessions,
      followUp: r.p.contact?.outcome || "Not contacted",
      assigned: r.p.contact?.assigned || r.p.profile.followUp?.assigned || "",
      lastContact: r.p.contact?.date || null,
      profileRevision: r.p.profile.revision || 0,
      membershipRevision: r.p.revision || 0,
      days: ctx.historyCurrent ? r.p.days : null,
      score: r.score,
      reasons: r.reasons,
      missingFields: r.missingFields,
      watch: r.watch,
    }));
  const conversionAnchor = ctx.coverage.to
    ? ctx.q.asOf < ctx.coverage.to
      ? ctx.q.asOf
      : ctx.coverage.to
    : null;
  const conversionPeople = clientPopulation(
    state,
    conversionAnchor || ctx.q.asOf,
  );
  const conversion = registrationConversion(
    conversionPeople,
    history,
    ctx.coverage,
    conversionAnchor,
    rules.recentRegistrationDays,
  );
  return {
    view,
    period: {
      from: ctx.q.from || ctx.coverage.from,
      to: ctx.q.to || ctx.q.asOf,
      asOf: ctx.q.asOf,
    },
    coverage: ctx.coverage,
    available,
    historyCurrent: ctx.historyCurrent,
    historyNote: ctx.historyNote,
    rules,
    inactiveAfterDays: ctx.settings.inactivityBands[1],
    activeThroughDays: ctx.settings.inactivityBands[0],
    summary: {
      matchedClients: evaluated.length,
      followup: available ? candidates.length : null,
      noHistory: available ? evaluated.filter((r) => r.noHistory).length : null,
      noneInView: available
        ? evaluated.filter((r) => r.noneInView && !r.noHistory).length
        : null,
      inactive: ctx.historyCurrent
        ? evaluated.filter((r) => r.inactive).length
        : null,
      supportFlagged: available
        ? candidates.filter((r) => r.indicators.length > 0).length
        : null,
      missingIndicators: available
        ? candidates.filter((r) => r.missingFields.length > 0).length
        : null,
      watch: ctx.historyCurrent ? watch.length : null,
    },
    people: { rows, total: filtered.length, page, pageSize },
    conversion,
    options: {
      blocks: [
        ...new Set(ctx.members.map((p) => p.blockRaw).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
      ages: [...new Set(ctx.members.map((p) => p.ageGroup))],
      interests: [...new Set(ctx.members.flatMap((p) => p.interests))].sort(),
    },
    export: { enabled: false, columns: OUTREACH_EXPORT_COLUMNS },
    limitations: [
      "Current recorded profiles may not describe a past reporting date. Missing registration dates do not establish historical membership; attendance coverage is limited to the records available.",
      "Priority is an editable staff-review aid, not a clinical risk score, eligibility decision or an instruction to contact anyone. Nothing is sent or saved by viewing this list.",
      "One attendance base applies: existing inactive status first, otherwise no recorded history, otherwise no matching attendance in this view. Support-indicator and covered-date gap points are added. Missing indicators add no points; that is not evidence of no support needs.",
      "SRF points require an explicitly selected code with a documented non-no-risk mapping. Raw 0, 1 and >1 are not treated as an ordered scale. CFS and living-alone labels describe recorded profiles and do not establish a reason for non-participation.",
      "Active/inactive and the watchlist use the existing reporting-date rules. Beyond coverage, inactive/watch counts and gap points are unavailable; choose a covered reporting date. No recorded attendance does not mean never attended.",
      "Conversion ignores list filters and uses the eligible registry at the displayed conversion anchor (the earlier of reporting date and coverage end). Only known recent registration dates with covered starts and completed follow-up windows enter each rate; pending and excluded cohorts are separate. Attendance before registration is not conversion. No recorded attendance is not a claim that someone never attended.",
    ],
  };
}
