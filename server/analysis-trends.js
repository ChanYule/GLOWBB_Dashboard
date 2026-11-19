import {domainMatches} from './programme-domains.js';
import { clientPopulation, validDay } from "./client-domain.js";
import {
  participationProportion,
  reliabilityOptions,
  unknownGroup,
} from "../shared/participation-reliability.js";
const shift = (day, n) =>
  new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
export function comparisonWindow(q, coverage) {
  const from = q.from || coverage.from,
    to = q.to && q.to < coverage.to ? q.to : coverage.to;
  if (!from || !to || from > to)
    return {
      available: false,
      reason: "Choose a period within available attendance coverage.",
    };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const previousTo = shift(from, -1),
    previousFrom = shift(from, -days);
  return {
    available: from >= coverage.from && previousFrom >= coverage.from,
    from,
    to,
    previousFrom,
    previousTo,
    days,
    reason:
      previousFrom < coverage.from
        ? "The previous equivalent period starts before attendance coverage; no comparison is made."
        : null,
  };
}
export function periodChanges(current, previous, window, reliability) {
  const config = reliabilityOptions(reliability);
  const base = {
    ...window,
    minimum: config.cautionMinimum,
    increases: [],
    decreases: [],
    excluded: 0,
  };
  if (
    !window.available ||
    !previous ||
    !current.ratesAvailable ||
    !previous.ratesAvailable
  )
    return {
      ...base,
      available: false,
      reason:
        window.reason ||
        "Complete registered-client denominators and two covered periods are required.",
    };
  const prior = new Map(previous.groups.map((g) => [g.label, g]));
  const changes = [];
  for (const g of current.groups) {
    const p = prior.get(g.label);
    if (
      !p ||
      g.suppressed ||
      p.suppressed ||
      unknownGroup(g.label) ||
      [g, p].some((r) => r.registered < config.cautionMinimum || r.rate == null)
    ) {
      base.excluded++;
      continue;
    }
    const currentStats = participationProportion(g.unique, g.registered),
      previousStats = participationProportion(p.unique, p.registered);
    if (currentStats.rate == null || previousStats.rate == null) {
      base.excluded++;
      continue;
    }
    changes.push({
      label: g.label,
      current: currentStats,
      previous: previousStats,
      differencePoints: currentStats.rate - previousStats.rate,
      overlap:
        Math.max(currentStats.lower, previousStats.lower) <=
        Math.min(currentStats.upper, previousStats.upper),
    });
  }
  return {
    ...base,
    available: true,
    increases: changes
      .filter((c) => c.differencePoints > 0)
      .sort(
        (a, b) =>
          b.differencePoints - a.differencePoints ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 3),
    decreases: changes
      .filter((c) => c.differencePoints < 0)
      .sort(
        (a, b) =>
          a.differencePoints - b.differencePoints ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 3),
  };
}
export function monthlyClientTrends(state, domain, now) {
  if (!state.settings.staffAnalysisFull)
    return {
      available: false,
      rows: [],
      reason:
        "Monthly client detail is unavailable under the conservative privacy projection.",
    };
  const programmes = new Map(state.data.programmes.map((p) => [p.id, p]));
  const sessions = new Map(
    state.data.sessions
      .filter(
        (s) =>
          validDay(s.date) && s.date <= now && programmes.has(s.programmeId),
      )
      .map((s) => [s.id, s]),
  );
  const dates = [...sessions.values()].map((s) => s.date).sort(),
    from = dates[0],
    to = dates.at(-1);
  if (!from)
    return {
      available: false,
      rows: [],
      reason: "No delivered attendance coverage.",
    };
  const people = clientPopulation(state, to),
    histories = new Map();
  for (const a of state.data.attendance) {
    const s = sessions.get(a.sessionId);
    if (!s) continue;
    if (!histories.has(a.participantId))
      histories.set(a.participantId, new Map());
    histories.get(a.participantId).set(s.id, s);
  }
  const rows = [];
  let cursor = from.slice(0, 7) + "-01";
  while (cursor <= to && rows.length < 1200) {
    const next = new Date(cursor + "T00:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + 1);
    const end = shift(next.toISOString().slice(0, 10), -1),
      anchor = end < to ? end : to,
      start = cursor < from ? from : cursor;
    const eligible = people.filter(
      (p) => !p.registrationDate || p.registrationDate <= anchor,
    );
    let active = 0,
      firstObserved = 0,
      returning = 0;
    for (const p of eligible) {
      const history = [...(histories.get(p.id)?.values() || [])]
        .filter((s) => s.date <= anchor)
        .sort((a, b) => a.date.localeCompare(b.date));
      const last = history.at(-1)?.date;
      if (
        last &&
        (Date.parse(anchor) - Date.parse(last)) / 86400000 <=
          (state.settings.inactivityBands?.[0] || 30)
      )
        active++;
      const attended = history.some(
        (s) =>
          s.date >= start &&
          domainMatches(domain,s,programmes.get(s.programmeId),state.settings),
      );
      if (attended) {
        if (history[0].date >= start) firstObserved++;
        else returning++;
      }
    }
    rows.push({
      month: cursor.slice(0, 7),
      from: start,
      to: anchor,
      partial: start !== cursor || anchor !== end,
      registered: eligible.length,
      active,
      firstObserved,
      returning,
      participants: firstObserved + returning,
      sessions: [...sessions.values()].filter(
        (s) =>
          s.date >= start &&
          s.date <= anchor &&
          domainMatches(domain,s,programmes.get(s.programmeId),state.settings),
      ).length,
    });
    cursor = next.toISOString().slice(0, 10);
  }
  return {
    available: true,
    from,
    to,
    activeThroughDays: state.settings.inactivityBands?.[0] || 30,
    rows,
    reason: null,
  };
}
