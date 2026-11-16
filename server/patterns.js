import { defaults, todaySG } from "./domain.js";
import { twoFactorAnalysis } from '../shared/two-factor-analysis.js';
import { programmeDiagnostics, programmeRepresentation } from '../shared/programme-diagnostics.js';
import { monthlyClientTrends, comparisonWindow, periodChanges } from './analysis-trends.js';
import { dataQualitySummary } from './data-quality.js';
import { registrationContext } from '../shared/registration-context.js';
import { outreachRules, supportIndicators } from '../shared/outreach-priority-rules.js';
import { comparisonInsight, participationProportion, reliabilityOptions } from '../shared/participation-reliability.js';
import { sessionDistribution } from './session-distribution.js';
import { engagementOptions, summariseEngagement } from '../shared/engagement-depth.js';
import {sessionEventTypes} from './event-types.js';
import {
  populations,
  patternKeys,
  analysisDimensions,
} from "../shared/participation-compat.js";
import { clientPopulation, validDay } from "./client-domain.js";
import { materializeProfiles } from "./needs-domain.js";
import {
  locationDefaults,
  locatedPerson,
  distanceLabels,
  publicLocationSummary,
  transportResponses,
  addressKey,
} from "./location-model.js";

export const patternDimensions = {
  ...analysisDimensions,
  locationBlock: "Verified residential building",
  participation: "Client Participation Status",
  eventType: "Event Type",
};
const fail = (message) => Object.assign(Error(message), { status: 400 });
const raw = (v) => (v == null || v === "" ? "Missing" : String(v).trim());
const missing = (v) =>
  ["missing", "unknown", "not assessed", "invalid age"].includes(
    String(v).toLowerCase(),
  );
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const average = (a, b) => (b ? Math.round((a / b) * 10) / 10 : null);
const ageLabels = [
  "Below 60",
  "60 to 69",
  "70 to 79",
  "80 and above",
  "Missing",
  "Unknown",
  "Invalid age",
];
const cfsLabels = ["CFS 1 to 3", "CFS 4", "CFS 5", "CFS 6", "CFS 7 to 8"];
const weekdayFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  timeZone: "Asia/Singapore",
});
export function patternLabel(p, dimension, settings = {}) {
  if (dimension === "distance") return p.location?.band || "Distance unknown";
  if (dimension === "locationBlock")
    return p.location?.blockLabel || "Unverified residential address";
  if (dimension === "participation")
    return p.participationStatus || "No recorded attendance";
  if (dimension === "age") {
    if (p.age == null || p.age === "") return "Missing";
    if (String(p.age).toLowerCase() === "unknown") return "Unknown";
    if (typeof p.age === "boolean" || typeof p.age === "object")
      return "Invalid age";
    const n = Number(p.age);
    return !Number.isInteger(n) || n < 0 || n > 120
      ? "Invalid age"
      : ageLabels[n < 60 ? 0 : n < 70 ? 1 : n < 80 ? 2 : 3];
  }
  const value = raw(
    p[
      {
        cfs: "cfs",
        risk: "riskRaw",
        race: "race",
        gender: "gender",
        living: "livingRaw",
        block: "blockRaw",
      }[dimension]
    ],
  );
  if (dimension === "cfs") {
    if (settings.cfsMappings?.[value]?.label)
      return settings.cfsMappings[value].label;
    const n = value
      .replace(/^CFS\s*/i, "")
      .replace(/[–—]/g, "-")
      .replace(/\s+to\s+/i, "-");
    if (["1", "2", "3", "1-3"].includes(n)) return cfsLabels[0];
    if (["4", "5", "6"].includes(n)) return "CFS " + n;
    if (["7", "8", "7-8"].includes(n)) return cfsLabels[4];
  }
  if (dimension === "risk" && settings.riskMappings?.[value]?.label)
    return value + " · " + settings.riskMappings[value].label;
  if (dimension === "living") return settings.livingGroups?.[value] || value;
  if (dimension === "block")
    return p.location?.blockLabel || settings.clientZones?.[value] || value;
  return value;
}
export function validatePatternQuery(input = {}, now = todaySG()) {
  const allowed = patternKeys;
  if (
    Object.entries(input).some(
      ([k, v]) =>
        !allowed.includes(k) || typeof v !== "string" || v.length > 500,
    )
  )
    throw fail(
      "Participation filters contain unsupported settings. Reset this view or remove outdated saved parameters: " +
        Object.keys(input)
          .filter((k) => !allowed.includes(k) || typeof input[k] !== "string")
          .slice(0, 5)
          .join(", "),
    );
  const q = {
    dimension: "age",
    scope: "clients",
    ranking: "unique",
    basis: "current",
    ...input,
  };
  if (
    !Object.hasOwn(patternDimensions,q.dimension) ||
    (q.second && (!Object.hasOwn(patternDimensions,q.second) || q.second === q.dimension)) ||
    !Object.hasOwn(populations, q.scope) ||
    !["unique", "attendance", "repeat"].includes(q.ranking) ||
    !["current", "dated"].includes(q.basis)
  )
    throw fail("Choose a supported characteristic, scope and metric.");
  if (
    q.dimension === "participation" ||
    (q.second === "participation" &&
      !["distance", "locationBlock"].includes(q.dimension))
  )
    throw fail(
      "Participation status is available as a secondary location comparison only.",
    );
  if (
    [q.dimension, q.second].some((d) =>
      ["distance", "locationBlock", "block"].includes(d),
    ) &&
    q.scope !== "clients"
  )
    throw fail(
      "Location comparisons use registered clients; overall attendance remains available in other views.",
    );
  if (
    q.distanceMetric &&
    !["walking", "straight", "time"].includes(q.distanceMetric)
  )
    throw fail(
      "Choose walking-route distance, straight-line distance or walking time.",
    );
  if (q.destination && !/^[a-zA-Z0-9-]{1,100}$/.test(q.destination))
    throw fail("Choose a verified destination.");
  if (['block','locationBlock'].includes(q.dimension) && q.group)
    q.group = q.group.replace(/ \(unverified; address not assumed\)$/, '');
  if (
    q.blockPage &&
    (!/^\d+$/.test(q.blockPage) || Number(q.blockPage) > 10000)
  )
    throw fail("Choose a valid block results page.");
  if (
    q.blockSort &&
    !["low", "high", "noAttendance", "distance", "registered"].includes(
      q.blockSort,
    )
  )
    throw fail("Choose a supported block sort.");
  for (const k of ["from", "to"])
    if (q[k] && !validDay(q[k])) throw fail("Choose valid reporting dates.");
  if (
    (q.from && q.from > now) ||
    (q.to && q.to > now) ||
    (q.from && q.to && q.from > q.to)
  )
    throw fail(
      "Choose a delivered reporting period ending on or before today.",
    );
  if (q.page && (!/^\d+$/.test(q.page) || Number(q.page) > 10000))
    throw fail("Choose a valid results page.");
  if (q.all && q.all !== "1") throw fail("Choose a supported list size.");
  return q;
}

// One indexed attendance pass per requested dimension. No participant records
// or source attributes leave this calculation; all output is protected aggregate.
export function participationPatterns(state, input = {}, now = todaySG(), { includeTrends = true } = {}) {
  const q = validatePatternQuery(input, now),
    settings = { ...defaults, ...state.settings };
  const minimum = settings.staffAnalysisFull ? 0 : Math.max(5, settings.privacyMinimum || 5);
  const locationMode = [q.dimension, q.second].some((d) =>
    ["distance", "locationBlock", "block"].includes(d),
  );
  const locationStore = state.locations || locationDefaults();
  const destination =
    (q.destination || "centre") === "centre"
      ? locationStore.centre
      : Object.hasOwn(locationStore.venues, q.destination)
        ? locationStore.venues[q.destination]
        : null;
  if (locationMode && !destination)
    throw fail(
      "That destination is no longer configured. Choose the main centre or a verified venue.",
    );
  const effective = materializeProfiles(state.data, state.profiles || []);
  const clients = clientPopulation(
    {
      ...state,
      feedback: state.feedback || [],
      profiles: state.profiles || [],
    },
    q.to || now,
  );
  const peopleMap = new Map(effective.participants.map((p) => [p.id, p]));
  for (const p of clients) peopleMap.set(p.id, p);
  const programmes = new Map(state.data.programmes.map((p) => [p.id, p]));
  const sessionMap = new Map(
    state.data.sessions
      .filter((s) => s.date <= now && programmes.has(s.programmeId))
      .map((s) => [s.id, s]),
  );
  const dates = [...sessionMap.values()].map((s) => s.date).sort();
  const coverage = { from: dates[0] || null, to: dates.at(-1) || null };
  const histories = new Map(),
    selected = new Map(),
    delivered = new Map(),
    seen = new Set();
  for (const s of sessionMap.values())
    if (
      (!q.from || s.date >= q.from) &&
      (!q.to || s.date <= q.to) &&
      (!q.domain || programmes.get(s.programmeId).domain === q.domain) &&
      (!locationMode ||
        !q.destination ||
        q.destination === "centre" ||
        s.venue === destination.venueName)
    ) {
      if (!delivered.has(s.programmeId))
        delivered.set(s.programmeId, new Set());
      delivered.get(s.programmeId).add(s.id);
    }
  for (const a of state.data.attendance) {
    const s = sessionMap.get(a.sessionId),
      p = peopleMap.get(a.participantId);
    if (!s || !p) continue;
    const key = JSON.stringify([p.id, s.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!histories.has(p.id)) histories.set(p.id, []);
    histories.get(p.id).push(s);
    if (delivered.get(s.programmeId)?.has(s.id)) {
      if (!selected.has(p.id)) selected.set(p.id, []);
      selected.get(p.id).push(s);
    }
  }
  const snapshots = new Map();
  if (q.basis === "dated")
    for (const row of [...(state.profileHistory || [])]
      .filter((r) => r.effective_date && r.effective_date <= (q.to || now))
      .sort((a, b) =>
        (a.effective_date + a.created + a.id).localeCompare(
          b.effective_date + b.created + b.id,
        ),
      )) {
      snapshots.set(row.participant_id, JSON.parse(row.details).after || {});
    }
  let people = ["clients", "attendingClients"].includes(q.scope)
    ? clients
    : [...peopleMap.values()].filter((p) => selected.has(p.id));
  if (q.scope === "attendingClients")
    people = people.filter((p) => selected.has(p.id));
  people = people.map((p) => {
    const profile =
      q.basis === "dated" ? snapshots.get(p.id) || {} : p.profile || {};
    const base =
      q.basis === "dated"
        ? {
            ...p,
            age: null,
            gender: null,
            race: null,
            cfs: null,
            riskRaw: null,
            livingRaw: null,
            blockRaw: null,
          }
        : p;
    return {
      ...base,
      ...profile.basic,
      cfs:
        !profile.health?.cfsAssessedOn ||
        profile.health.cfsAssessedOn <=
          (q.basis === "dated" ? q.to || now : now)
          ? profile.health?.cfs || base.cfs
          : q.basis === "dated"
            ? null
            : base.cfs,
      riskRaw: profile.social?.riskRaw || base.riskRaw,
      profile,
    };
  });
  if (q.scope === "seniors")
    people = people.filter((p) => typeof p.age === "number" && p.age >= 60);
  if (locationMode) {
    const locationCache = new Map();
    people = people.map((p) => {
      const cacheKey = JSON.stringify([
        locationStore.bindings[p.id]?.buildingId,
        locationStore.bindings[p.id]?.sourceKey,
        locationStore.bindings[p.id]?.buildingAddressKey,
        addressKey(p),
      ]);
      if (!locationCache.has(cacheKey))
        locationCache.set(cacheKey, locatedPerson(p, locationStore, q));
      return {
        ...p,
        location: locationCache.get(cacheKey),
        participationStatus: selected.has(p.id)
          ? "With recorded attendance"
          : "No recorded attendance",
      };
    });
  }
  const registryComplete =
    settings.registry?.complete === true &&
    settings.registry?.type === "clients" &&
    settings.registry?.asOf <= now;
  const ratesAvailable =
    q.scope === "clients" && registryComplete && !!coverage.from;
  const nonzeroSmall = (n) => n > 0 && n < minimum;
  // Noncanonical slices and cross-characteristic releases require identical
  // full characteristic + attendance atoms, preventing repeated filter queries
  // from subtracting a small identifiable group out of a published total.
  const custom = Boolean(
    q.domain ||
    (locationMode && q.destination && q.destination !== "centre") ||
    q.second ||
    q.basis === "dated" ||
    (q.from && q.from !== coverage.from) ||
    (q.to && q.to !== coverage.to && q.to !== now),
  );
  // Date/domain/combined slices need safe atoms. Full-history single-dimension
  // attendee distributions retain category and complementary suppression below.
  const registrationSlice =
    populations[q.scope].registry &&
    q.to &&
    clientPopulation(
      {
        ...state,
        feedback: state.feedback || [],
        profiles: state.profiles || [],
      },
      now,
    ).length !== clients.length;
  let sliceBlocked=false;
  if(!settings.staffAnalysisFull&&(custom||registrationSlice)){
    const atoms=new Map();
    const atomDimensions=Object.keys(patternDimensions).filter(d=>d!=='eventType'&&(locationMode||!['distance','locationBlock','participation'].includes(d)));
    for(const p of people){const signature=JSON.stringify([atomDimensions.map(d=>patternLabel(p,d,settings)),(histories.get(p.id)||[]).map(s=>s.id).sort(),p.registrationDate||'']);atoms.set(signature,(atoms.get(signature)||0)+1);}
    sliceBlocked=[...atoms.values()].some(n=>n<minimum);
  }
  const engagementConfig = engagementOptions(settings.engagement);
  const engagementFacts = new Map(people.map(p => [p.id, {
    sessions: selected.get(p.id)?.length || 0,
    last: (histories.get(p.id) || []).reduce((last, s) => !last || s.date > last ? s.date : last, null),
  }]));
  const stats = (members) => {
    let attendance = 0,
      repeat = 0,
      opportunity = 0,
      firstObserved = 0,
      returning = 0,
      domainSum = 0;
    const ps = new Set(),
      domains = new Set();
    const attending = members.filter((p) => selected.has(p.id));
    for (const p of attending) {
      const rows = selected.get(p.id),
        byProgramme = new Map(),
        ownDomains = new Set();
      attendance += rows.length;
      for (const s of rows) {
        ps.add(s.programmeId);
        const domain = programmes.get(s.programmeId).domain;
        domains.add(domain);
        ownDomains.add(domain);
        byProgramme.set(
          s.programmeId,
          (byProgramme.get(s.programmeId) || 0) + 1,
        );
      }
      domainSum += ownDomains.size;
      if ([...byProgramme.keys()].some((id) => delivered.get(id).size > 1))
        opportunity++;
      if ([...byProgramme.values()].some((n) => n > 1)) repeat++;
      const earliest = (histories.get(p.id) || []).map((s) => s.date).sort()[0];
      if (earliest && earliest < (q.from || coverage.from)) returning++;
      else firstObserved++;
    }
    return {
      registered: q.scope === "clients" ? members.length : null,
      unique: attending.length,
      noAttendance:
        q.scope === "clients" && coverage.from
          ? members.length - attending.length
          : null,
      rate: ratesAvailable ? ratio(attending.length, members.length) : null,
      attendance,
      programmes: ps.size,
      domains: domains.size,
      averageDomains: average(domainSum, attending.length),
      averageSessions: average(attendance, attending.length),
      sessionDistribution: settings.staffAnalysisFull && coverage.from
        ? sessionDistribution(attending.map(p => selected.get(p.id).length)) : null,
      engagement: settings.staffAnalysisFull && coverage.to
        ? summariseEngagement(members.map(p => engagementFacts.get(p.id)), coverage.to, engagementConfig) : null,
      repeat,
      opportunity,
      repeatRate: ratio(repeat, opportunity),
      firstObserved,
      returning,
    };
  };
  const buckets = new Map();
  if (q.dimension === "age")
    for (const label of ageLabels.slice(q.scope === "seniors" ? 1 : 0, 4))
      buckets.set(label, []);
  if (q.dimension === "distance")
    for (const label of distanceLabels(
      locationStore,
      q.distanceMetric || "walking",
    ))
      buckets.set(label, []);
  for (const p of people) {
    const label = patternLabel(p, q.dimension, settings);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(p);
  }
  const labels = [...buckets.keys()].sort((a, b) => {
    const ordered =
      q.dimension === "distance"
        ? distanceLabels(locationStore, q.distanceMetric || "walking")
        : q.dimension === "age"
          ? ageLabels
          : q.dimension === "cfs"
            ? cfsLabels
            : [];
    return (
      (ordered.includes(a) ? ordered.indexOf(a) : 100) -
        (ordered.includes(b) ? ordered.indexOf(b) : 100) || a.localeCompare(b)
    );
  });
  const privacySafe = (members, s) =>
    ![
      members.length,
      people.length - members.length,
      s.unique,
      members.length - s.unique,
      s.repeat,
      s.opportunity - s.repeat,
      s.firstObserved,
      s.returning,
    ].some(nonzeroSmall);
  const rawGroups = labels.map((label) => ({
    label,
    ...stats(buckets.get(label)),
  }));
  const protectedLabels = new Set(
    rawGroups
      .filter((r) =>
        [
          buckets.get(r.label).length,
          people.length - buckets.get(r.label).length,
          r.unique,
          buckets.get(r.label).length - r.unique,
        ].some(nonzeroSmall),
      )
      .map((r) => r.label),
  );
  // Complementary suppression prevents recovering a lone hidden category from
  // the centre population or an independently published attendance total.
  if (protectedLabels.size === 1) {
    const secondary = rawGroups
      .filter(
        (r) => !protectedLabels.has(r.label) && buckets.get(r.label).length > 0,
      )
      .sort(
        (a, b) => buckets.get(a.label).length - buckets.get(b.label).length,
      )[0];
    if (secondary) protectedLabels.add(secondary.label);
  }
  const groups = rawGroups.map((r) => {
    if (sliceBlocked || protectedLabels.has(r.label))
      return { label: r.label, suppressed: true };
    const out = { ...r, suppressed: false };
    if ([r.repeat, r.opportunity - r.repeat].some(nonzeroSmall))
      for (const key of [
        "repeat",
        "opportunity",
        "repeatRate",
        "attendance",
        "averageSessions",
        "sessionDistribution",
        "engagement",
      ])
        out[key] = null;
    if ([r.firstObserved, r.returning].some(nonzeroSmall)) {
      out.firstObserved = null;
      out.returning = null;
    }
    return out;
  });
  const comparisonBlocked =
    sliceBlocked || (groups.length > 0 && groups.every((r) => r.suppressed));
  const group = labels.includes(q.group)
    ? q.group
    : [...groups]
        .filter((g) => !g.suppressed && g.unique > 0)
        .sort((a, b) => b.unique - a.unique)[0]?.label ||
      groups.find((g) => !g.suppressed && g.registered > 0)?.label ||
      labels[0] ||
      "";
  const selectedBlocked =
    comparisonBlocked || groups.find((g) => g.label === group)?.suppressed;
  const members = buckets.get(group) || [],
    memberIds = new Set(members.map((p) => p.id));
  const rankMap = new Map();
  for (const id of memberIds)
    for (const s of selected.get(id) || []) {
      if (!rankMap.has(s.programmeId)) rankMap.set(s.programmeId, new Map());
      const m = rankMap.get(s.programmeId);
      m.set(id, (m.get(id) || 0) + 1);
    }
  const rankRows = [...rankMap].map(([id, m]) => {
    const p = programmes.get(id),
      unique = m.size,
      repeat = [...m.values()].filter((n) => n > 1).length,
      sessions = delivered.get(id).size;
    return {
      id,
      name: p.name,
      domain: p.domain,
      eventTypes:[...new Set([...delivered.get(id)].flatMap(sid=>sessionEventTypes(sessionMap.get(sid),settings)))],
      sessions,
      unique,
      attendance: [...m.values()].reduce((a, b) => a + b, 0),
      repeat,
      repeatRate: sessions > 1 ? ratio(repeat, unique) : null,
      averageSessions: average(
        [...m.values()].reduce((a, b) => a + b, 0),
        unique,
      ),
    };
  });
  const programmeCounts = new Map(),
    programmeRepeats = new Map(),
    domainCounts = new Map();
  for (const p of people) {
    const label = patternLabel(p, q.dimension, settings),
      own = new Map(),
      ownDomains = new Set();
    for (const session of selected.get(p.id) || []) {
      own.set(session.programmeId, (own.get(session.programmeId) || 0) + 1);
      ownDomains.add(programmes.get(session.programmeId).domain);
    }
    for (const [id, visits] of own) {
      if (!programmeCounts.has(id)) {
        programmeCounts.set(id, new Map());
        programmeRepeats.set(id, new Map());
      }
      const counts = programmeCounts.get(id),
        repeats = programmeRepeats.get(id);
      counts.set(label, (counts.get(label) || 0) + 1);
      if (visits > 1) repeats.set(label, (repeats.get(label) || 0) + 1);
    }
    for (const domain of ownDomains) {
      if (!domainCounts.has(domain)) domainCounts.set(domain, new Map());
      const counts = domainCounts.get(domain);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  // Additive totals/averages must not reveal a protected programme or domain
  // by subtraction from the released children. Withhold the whole family.
  for (const g of groups.filter((r) => !r.suppressed)) {
    const hiddenProgramme = [...programmeCounts].some(([id, counts]) => {
      const n = counts.get(g.label) || 0,
        repeats = programmeRepeats.get(id).get(g.label) || 0;
      return [n, buckets.get(g.label).length - n, repeats, n - repeats].some(
        nonzeroSmall,
      );
    });
    if (hiddenProgramme)
      for (const key of [
        "attendance",
        "averageSessions",
        "sessionDistribution",
        "engagement",
        "repeat",
        "opportunity",
        "repeatRate",
      ])
        g[key] = null;
    if (
      [...domainCounts.values()].some((counts) => {
        const n = counts.get(g.label) || 0;
        return [n, buckets.get(g.label).length - n].some(nonzeroSmall);
      })
    ) {
      g.averageDomains = null;
      g.domains = null;
    }
  }
  let safeRankRows = rankRows
    .filter((r) => {
      const counts = labels.map((label) => ({
        label,
        count: programmeCounts.get(r.id)?.get(label) || 0,
      }));
      const total = counts.reduce((n, c) => n + c.count, 0);
      const hidden = new Set(
        counts
          .filter(
            (c) =>
              [
                c.count,
                total - c.count,
                buckets.get(c.label).length - c.count,
              ].some(nonzeroSmall) || protectedLabels.has(c.label),
          )
          .map((c) => c.label),
      );
      if (hidden.size === 1) {
        const secondary = counts
          .filter((c) => !hidden.has(c.label) && c.count > 0)
          .sort((a, b) => a.count - b.count)[0];
        if (secondary) hidden.add(secondary.label);
      }
      return !hidden.has(group);
    })
    .map((r) =>
      [r.repeat, r.unique - r.repeat].some(nonzeroSmall)
        ? {
            ...r,
            repeat: null,
            repeatRate: null,
            attendance: null,
            averageSessions: null,
          }
        : r,
    );
  if (rankRows.length - safeRankRows.length === 1 && safeRankRows.length) {
    const secondary = [...safeRankRows].sort(
      (a, b) => a.unique - b.unique || a.id.localeCompare(b.id),
    )[0];
    safeRankRows = safeRankRows.filter((r) => r.id !== secondary.id);
  }
  const rankingsBlocked = Boolean(
    selectedBlocked || (rankRows.length > 0 && !safeRankRows.length),
  );
  safeRankRows = safeRankRows.map(row => {
    const counts = programmeCounts.get(row.id);
    const total = [...counts.values()].reduce((a,b) => a+b,0);
    const representationSafe = ratesAvailable && !rankingsBlocked && !groups.some(g => g.suppressed) &&
      labels.every(label => ![counts.get(label)||0, total-(counts.get(label)||0), buckets.get(label).length-(counts.get(label)||0)].some(nonzeroSmall));
    return { ...row,
      diagnostics: programmeDiagnostics(row, settings.reliability),
      representation: representationSafe ? programmeRepresentation({groupAttendees:row.unique,programmeAttendees:total,groupRegistered:members.length,registered:people.length}) : null,
    };
  });
  const sorted = rankingsBlocked
    ? []
    : safeRankRows
        .filter((r) =>
          q.ranking === "repeat" ? r.repeatRate != null : r[q.ranking] != null,
        )
        .sort(
          (a, b) =>
            (q.ranking === "repeat"
              ? b.repeatRate - a.repeatRate
              : b[q.ranking] - a[q.ranking]) ||
            b.unique - a.unique ||
            a.name.localeCompare(b.name),
        );
  const limit = q.all === "1" ? 20 : 5,
    offset = q.all === "1" ? Number(q.page || 0) * 20 : 0;
  const domainRows = [
    ...new Set(
      members.flatMap((p) =>
        (selected.get(p.id) || []).map(
          (s) => programmes.get(s.programmeId).domain,
        ),
      ),
    ),
  ].map((label) => ({
    label,
    unique: members.filter((p) =>
      (selected.get(p.id) || []).some(
        (s) => programmes.get(s.programmeId).domain === label,
      ),
    ).length,
  }));
  const domainsBlocked =
    selectedBlocked ||
    domainRows.some((r) =>
      [r.unique, members.length - r.unique].some(nonzeroSmall),
    );
  const selectedGroup = groups.find(g => g.label === group);
  const mixEntries = new Map();
  for (const p of members) for (const session of selected.get(p.id) || []) {
    const domain = programmes.get(session.programmeId).domain;
    mixEntries.set(domain, (mixEntries.get(domain)||0)+1);
  }
  const domainMix = {
    suppressed: !!domainsBlocked, available: !!coverage.from,
    unique: domainsBlocked || !coverage.from ? null : selectedGroup?.unique ?? null,
    attendance: domainsBlocked || !coverage.from ? null : selectedGroup?.attendance ?? null,
    rows: domainsBlocked || !coverage.from ? [] : [...new Set(['Learning','Physical','Social','Cognitive',...domainRows.map(r=>r.label)])].map(label => ({
      label: label || 'Unclassified / unknown',
      unique: domainRows.find(r=>r.label===label)?.unique || 0,
      attendeeShare: ratio(domainRows.find(r=>r.label===label)?.unique || 0,selectedGroup?.unique),
      attendance: selectedGroup?.attendance == null ? null : mixEntries.get(label)||0,
      entryShare: selectedGroup?.attendance == null ? null : ratio(mixEntries.get(label)||0,selectedGroup.attendance),
    })),
  };
  let combined = null;
  if (q.second) {
    const crossed = new Map();
    for (const p of people) {
      const key = JSON.stringify([
        patternLabel(p, q.dimension, settings),
        patternLabel(p, q.second, settings),
      ]);
      if (!crossed.has(key)) crossed.set(key, []);
      crossed.get(key).push(p);
    }
    const supportRules = outreachRules(settings.outreachRules);
    const supportKeys = [
      ['cfs', 'cfs', 'Recorded CFS at or above ' + supportRules.highCfsFrom],
      ['living', 'alone', 'Recorded living alone'],
      ['risk', 'srf', 'Documented SRF indicator selected in settings'],
    ];
    const rows = [...crossed].map(([key, ms]) => ({
      groups: JSON.parse(key),
      ...stats(ms),
      supportIndicators: supportKeys.filter(([dimension, indicator]) =>
        [q.dimension, q.second].includes(dimension) && ms.length > 0 &&
        ms.every(p => supportIndicators({ ...p, asOf: q.basis === 'dated' ? q.to || now : now }, settings, supportRules).indicators.some(i => i.key === indicator))
      ).map(([, , label]) => label),
    }));
    const blocked =
      comparisonBlocked ||
      rows.some((r) => !privacySafe(crossed.get(JSON.stringify(r.groups)), r));
    combined = { suppressed: blocked, rows: blocked ? [] : rows };
  }
  const reportedBarriers = new Map();
  for (const p of members)
    for (const b of p.reportedBarriers || []) {
      if (!reportedBarriers.has(b.category))
        reportedBarriers.set(b.category, new Set());
      reportedBarriers.get(b.category).add(p.id);
    }
  const barrierRows = [...reportedBarriers].map(([label, ids]) => ({
    label,
    unique: ids.size,
  }));
  const barriersBlocked =
    selectedBlocked ||
    barrierRows.some((r) =>
      [r.unique, members.length - r.unique].some(nonzeroSmall),
    );
  const known = people.filter((p) =>
    q.dimension === "distance"
      ? p.location?.distance != null
      : !missing(patternLabel(p, q.dimension, settings)),
  ).length;
  const completeness =
    comparisonBlocked || [known, people.length - known].some(nonzeroSmall)
      ? null
      : ratio(known, people.length);
  const findings = [];
  const finding = (title, evidence, interpretation, investigate, action) =>
    findings.push({ title, evidence, interpretation, investigate, action });
  if (comparisonBlocked || !coverage.from || !groups.length)
    finding(
      "Insufficient evidence for a reliable conclusion.",
      comparisonBlocked
        ? `Small groups or filter combinations are protected under the minimum of ${minimum} people.`
        : "No delivered attendance is available for this comparison.",
      "Withheld or missing values cannot be treated as zero.",
      "Review coverage, missing fields and the chosen reporting period.",
      "Use a broader covered period and collect appropriate voluntary feedback.",
    );
  else {
    const reliabilityConfig = reliabilityOptions(settings.reliability);
    const insight = comparisonInsight(groups, { dimension: q.dimension, options: reliabilityConfig });
    finding(
      q.dimension === 'cfs' ? 'CFS comparison' : 'Participation comparison and uncertainty',
      ratesAvailable ? insight.answer : 'Client participation rates require a complete verified registry and recorded attendance history.',
      ratesAvailable ? insight.note : 'Attendance-only reach has no registered-client denominator. Missing values are not zero.',
      'Review group sizes, plausible ranges, programme opportunities and missing registration dates.',
      'Review sourced feedback before prioritising outreach; recorded differences do not establish causes.',
    );
    const g = groups.find((r) => r.label === group);
    const selectedInsightEligible = !selectedBlocked && members.length >= reliabilityConfig.comparisonFloor;
    finding(
      "Repeat engagement and delivery opportunity",
      selectedInsightEligible && g && !g.suppressed && g.repeat != null
        ? `${group}: ${g.repeat} repeat participants among ${g.opportunity} people attending programmes with more than one delivered session; ${g.repeatRate == null ? "Not applicable" : g.repeatRate + "%"}.`
        : `Repeat insight unavailable: this group is below the ${reliabilityConfig.comparisonFloor}-person comparison floor, or its figures are unavailable/withheld. Recorded figures remain in the group table.`,
      "A one-off workshop has no opportunity for same-programme repeat attendance.",
      "Compare delivery frequency and programme purpose before deciding what to expand.",
      "Review repeat engagement alongside unique reach and participant feedback.",
    );
    if (selectedInsightEligible && !rankingsBlocked && sorted.length && sorted[0].unique >= reliabilityConfig.comparisonFloor) {
      const p = sorted[0];
      finding(
        "Leading programme for the selected metric",
        `${p.name}: ${p.unique} unique participants, ${p.attendance == null ? "Withheld" : p.attendance} attendance entries, ${p.sessions} delivered sessions.`,
        "Observed attendance indicates reach; it does not establish preference or clinical suitability.",
        "Check delivery frequency, capacity and recorded accessibility information.",
        "Consider continuing or adapting this programme after reviewing interest and resources.",
      );
    }
    finding(
      "Missing information affects interpretation",
      completeness == null
        ? "Completeness is withheld under privacy rules."
        : `${completeness}% of this population has a known ${patternDimensions[q.dimension]} classification.`,
      "Missing values remain separate and are not assumed to be no risk or no need.",
      "Check the source and assessment dates of missing or current attributes.",
      "Update records through existing staff-reviewed profile and feedback workflows.",
    );

  }
  const selectedProgramme =
    !rankingsBlocked && q.programme
      ? safeRankRows.find((r) => r.id === q.programme)
      : null;
  let programmeDetail = null;
  if (selectedProgramme) {
    const breakdown = rawGroups.map((g) => ({
      label: g.label,
      unique: (buckets.get(g.label) || []).filter((p) =>
        (selected.get(p.id) || []).some((s) => s.programmeId === q.programme),
      ).length,
    }));
    const blocked =
      comparisonBlocked ||
      groups.some((g) => g.suppressed) ||
      breakdown.some((r) =>
        [r.unique, buckets.get(r.label).length - r.unique].some(nonzeroSmall),
      );
    const accessibility =
      programmes.get(q.programme).optional?.accessibility || {};
    // Release only the existing structured accessibility fields, never free text.
    programmeDetail = {
      ...selectedProgramme,
      diagnostics: blocked ? null : selectedProgramme?.diagnostics,
      representation: blocked ? null : selectedProgramme?.representation,
      breakdown: blocked ? [] : breakdown,
      suppressed: blocked,
      accessibilityFields: Object.keys(accessibility).filter(
        (key) =>
          [
            "physicalLevel",
            "mobilityRequirements",
            "seatedOption",
            "languages",
            "venueAccessibility",
            "transport",
            "groupSize",
            "equipment",
            "support",
          ].includes(key) &&
          typeof accessibility[key] === "string" &&
          accessibility[key].trim().length > 0,
      ),
    };
  }
  const minorityPeople = people.filter((p) =>
    settings.minority.includes(String(p.race || "").toUpperCase()),
  );
  const minorityStats = stats(minorityPeople);
  const minority =
    q.dimension === "race" &&
    !comparisonBlocked &&
    !groups.some((g) => g.suppressed) &&
    privacySafe(minorityPeople, minorityStats)
      ? {
          registered: minorityStats.registered,
          unique: minorityStats.unique,
          rate: minorityStats.rate,
        }
      : null;
  let location = null;
  let outputGroups = groups;
  if (locationMode) {
    const protect = (n, total = people.length) =>
      comparisonBlocked || [n, total - n].some(nonzeroSmall) ? null : n;
    const verified = people.filter((p) => p.location?.verified).length;
    const transport = transportResponses(members, state, q.to || now);
    const transportHidden =
      selectedBlocked ||
      Object.values(transport).some(nonzeroSmall) ||
      [members.length - transport.staffObserved].some(nonzeroSmall);
    location = {
      ...publicLocationSummary(locationStore),
      metric: q.distanceMetric || "walking",
      destination: destination.venueName || "Selected centre reference location",
      verifiedClients: protect(verified),
      registered: comparisonBlocked ? null : people.length,
      attending: comparisonBlocked
        ? null
        : protect(people.filter((p) => selected.has(p.id)).length),
      noAttendance: comparisonBlocked
        ? null
        : protect(people.filter((p) => !selected.has(p.id)).length),
      locationCompleteness:
        protect(verified) == null ? null : ratio(verified, people.length),
      selected: groups.find((g) => g.label === group && !g.suppressed) || null,
      transport: transportHidden
        ? null
        : { ...transport, denominator: members.length },
      blockRows: null,
    };
    const timings = new Map(),
      weekdays = new Map();
    for (const p of members)
      for (const session of selected.get(p.id) || []) {
        if (!weekdays.has(session.date))
          weekdays.set(
            session.date,
            weekdayFormatter.format(new Date(session.date + "T12:00:00+08:00")),
          );
        const weekday = weekdays.get(session.date);
        const slot = Number.isFinite(session.start)
          ? session.start < 720
            ? "Morning"
            : session.start < 1080
              ? "Afternoon"
              : "Evening"
          : "Time unknown";
        const label = weekday + " · " + slot;
        if (!timings.has(label)) timings.set(label, new Set());
        timings.get(label).add(p.id);
      }
    const timingRows = [...timings].map(([label, ids]) => ({
      label,
      unique: ids.size,
    }));
    location.timing =
      selectedBlocked ||
      timingRows.some((r) =>
        [r.unique, members.length - r.unique].some(nonzeroSmall),
      )
        ? null
        : timingRows;
    if (q.dimension === "locationBlock") {
      const safe = groups
        .filter((g) => !g.suppressed && g.registered > 0)
        .map((g) => ({
          ...g,
          distance: buckets.get(g.label)[0]?.location?.distance ?? null,
          method: buckets.get(g.label)[0]?.location?.method || "Unknown",
          verified: buckets.get(g.label)[0]?.location?.verified || false,
        }))
        .filter(
          (g) =>
            !q.blockSearch ||
            g.label.toLowerCase().includes(q.blockSearch.toLowerCase()),
        );
      const sort = q.blockSort || "low";
      safe.sort((a, b) =>
        sort === "distance"
          ? (a.distance ?? Infinity) - (b.distance ?? Infinity)
          : sort === "registered"
            ? b.registered - a.registered
            : sort === "noAttendance"
              ? b.noAttendance - a.noAttendance
              : sort === "high"
                ? (b.rate ?? -1) - (a.rate ?? -1)
                : (a.rate ?? Infinity) - (b.rate ?? Infinity),
      );
      const page = Number(q.blockPage || 0);
      location.blockRows = {
        rows: safe.slice(page * 20, page * 20 + 20),
        total: safe.length,
        page,
      };
      outputGroups = groups.filter((g) => !g.suppressed && g.label === group);
    }
    if (q.dimension === "distance" && !comparisonBlocked) {
      if (combined && !combined.suppressed) {
        const strata = [...new Set(combined.rows.map((r) => r.groups[1]))];
        const stratum = strata.includes(q.stratum) ? q.stratum : strata[0];
        const rows = combined.rows.filter(
          (r) =>
            r.groups[1] === stratum &&
            r.registered >= Math.max(minimum, reliabilityOptions(settings.reliability).comparisonFloor) &&
            r.rate != null,
        );
        const order = distanceLabels(
          locationStore,
          q.distanceMetric || "walking",
        ).slice(0, 4);
        rows.sort(
          (a, b) => order.indexOf(a.groups[0]) - order.indexOf(b.groups[0]),
        );
        const comparable = rows.filter((r) => order.includes(r.groups[0]));
        const withinInsight = comparisonInsight(comparable.map(r => ({ ...r, label: r.groups[0] })), { dimension: 'distance', options: reliabilityOptions(settings.reliability) });
        findings.unshift({
          title: `Distance within ${stratum || "the selected characteristic"}`,
          evidence: withinInsight.answer,
          interpretation: withinInsight.note,
          investigate:
            "Check missing addresses, programme opportunities, assessment dates and sourced feedback before interpreting the difference.",
          action:
            "Review feasible outreach options with staff and the affected group; do not assume a transport service or off-site programme is needed.",
        });
      }
      const ordered = distanceLabels(
        locationStore,
        q.distanceMetric || "walking",
      )
        .slice(0, 4)
        .map((label) => groups.find((g) => g.label === label))
        .filter(
          (g) =>
            g &&
            !g.suppressed &&
            g.registered >= Math.max(minimum, reliabilityOptions(settings.reliability).comparisonFloor) &&
            g.rate != null,
        );
      const distanceInsight = comparisonInsight(ordered, { dimension: 'distance', options: reliabilityOptions(settings.reliability) });
      findings.unshift({
        title: 'Distance group comparison and uncertainty',
        evidence: distanceInsight.answer,
        interpretation: distanceInsight.note,
        investigate:
          "Compare CFS or age within distance bands where sample sizes allow, and review sourced transport feedback.",
        action:
          "Review existing outreach records and ask for voluntary feedback before proposing transport assistance or off-site programmes.",
      });
      if (!verified || destination.status !== "Verified")
        findings.unshift({
          title: "Location verification is needed",
          evidence:
            "Unverified buildings or destinations remain in Distance unknown. No residential distance has been guessed.",
          interpretation:
            "Block numbers are not unique addresses. Unknown distance is not evidence of a travel barrier.",
          investigate:
            "Verify the centre coordinates, full residential building addresses and client-building matches.",
          action:
            "Ask an administrator to review locations. General participation analysis remains available.",
        });
    }
  }
  const reliabilityConfig = reliabilityOptions(settings.reliability);
  const overallSafe = ratesAvailable && !comparisonBlocked && !groups.some(g => g.suppressed) &&
    ![people.filter(p => selected.has(p.id)).length, people.filter(p => !selected.has(p.id)).length].some(nonzeroSmall);
  const overall = overallSafe ? participationProportion(people.filter(p => selected.has(p.id)).length, people.length) : null;
  // These new detail aggregates follow the deliberately enabled staff policy.
  // Conservative/default reports must not reveal a withheld child through a
  // histogram, quantile or overall total. Never return person-level counts.
  const overallStats = settings.staffAnalysisFull && !comparisonBlocked ? stats(people) : null;
  const overallContext = overallStats ? {
    registered: overallStats.registered,
    unique: coverage.from ? overallStats.unique : null,
    attendance: coverage.from ? overallStats.attendance : null,
    programmes: coverage.from ? overallStats.programmes : null,
    rate: overallStats.rate,
    sessionDistribution: overallStats.sessionDistribution,
  } : null;
  const reliabilityFinding = findings.find(f => ['CFS comparison', 'Participation comparison and uncertainty'].includes(f.title));
  if (reliabilityFinding) { findings.splice(findings.indexOf(reliabilityFinding), 1); findings.unshift(reliabilityFinding); }
  let trendAnalysis = null;
  if (includeTrends && q.scope === 'clients') {
    const window = comparisonWindow(q, coverage);
    const previous = window.available && settings.staffAnalysisFull ? participationPatterns(state, { ...q, from: window.previousFrom, to: window.previousTo, second: '', programme: '', group: '', page: '0' }, now, { includeTrends: false }) : null;
    trendAnalysis = { monthly: monthlyClientTrends({ ...state, settings }, q.domain, now), changes: periodChanges({ groups, ratesAvailable }, previous, window, settings.reliability) };
  }
  return {
    trendAnalysis,
    metadata: state.metadata,
    dataQuality: q.scope === 'clients' && settings.staffAnalysisFull ? dataQualitySummary(clients,state.locations,q.to||now) : null,
    registrationContext: registrationContext(people,p=>selected.has(p.id),coverage.from,ratesAvailable && settings.staffAnalysisFull && !comparisonBlocked),
    dimension: q.dimension,
    location,
    minority,
    scope: q.scope,
    basis: q.basis,
    group: q.dimension === "locationBlock" && !outputGroups.length ? "" : group,
    ranking: q.ranking,
    period: { from: q.from || coverage.from, to: q.to || coverage.to },
    coverage,
    minimum,
    ratesAvailable,
    registryComplete,
    reliability: { ...reliabilityConfig, overall },
    overallContext,
    engagement: { ...engagementConfig, anchor: coverage.to, historyFrom: coverage.from },
    population:
      comparisonBlocked || nonzeroSmall(people.length) ? null : people.length,
    completeness,
    comparisonSuppressed: comparisonBlocked,
    groups: outputGroups,
    rankings: {
      suppressed: rankingsBlocked,
      rows: sorted.slice(offset, offset + limit),
      total: rankingsBlocked ? null : sorted.length,
      page: Number(q.page || 0),
      limit,
    },
    domains: {
      suppressed: domainsBlocked,
      rows: domainsBlocked ? [] : domainRows,
    },
    domainMix,
    combined,
    twoFactor: twoFactorAnalysis({ combined, dimensions: [q.dimension, q.second], ratesAvailable, overall, reliability: reliabilityConfig }),
    programmeDetail,
    reportedBarriers: {
      suppressed: barriersBlocked,
      rows: barriersBlocked ? [] : barrierRows,
    },
    findings: findings.slice(0, 5),
    domainsAvailable: [
      ...new Set(state.data.programmes.map((p) => p.domain)),
    ].sort(),
    limitations: [
      "Engagement depth counts distinct sessions matching this reporting period/domain/venue. No recorded history is separate from no attendance matching this view. Recency uses each person's latest full-history attendance through the attendance coverage end date, regardless of the selected period/domain. It is not their status at a historical period end or today's date. Available history does not establish that someone never attended; these segments do not change existing active/inactive definitions.",
      "Session medians and the interquartile range (middle 50%) use participating people only, with linear interpolation for quartiles. The histogram uses distinct person-session counts; nonattenders remain in client-rate denominators and are excluded from this distribution. No attendance history means unavailable, not zero sessions.",
      "Plausible ranges are 95% model-based ranges around recorded client proportions. They indicate small-group instability, not missing-data bias or changes to exact counts; overlapping ranges are not a formal significance test. Group and overall rates are not independent. Differences do not prove cause.",
      ...(locationMode
        ? [
            "Residential verification and distance caches reflect current building information, not a historical journey. Unverified clients remain in the denominator with distance unknown.",
            publicLocationSummary(locationStore).note,
            "Walking routes are cached for up to 30 days; administrators refresh them manually. Straight-line distance is a separate measure, never a walking route. No public-transport journey times or unverified map markers are invented.",
          ]
        : []),
      "Current registered-client population; absence of a registration date does not establish historical membership. No recorded attendance does not mean never attended.",
      q.basis === "dated"
        ? "Only staff profile snapshots with an effective date at or before period end are used. Undated or unavailable historical attributes are missing."
        : "Current recorded attributes are used consistently, including for historical attendance. They do not establish age, CFS, SRF or living arrangement at each past session. Dates of birth are not available for age-at-attendance calculation.",
      "SRF raw values and approved labels are retained. No ordered SRF risk scale is assumed. Living alone is not evidence of loneliness, and race does not establish language or preference.",
      settings.staffAnalysisFull?'Staff analysis displays all recorded group counts without small-group suppression. Missing fields and invalid denominators remain unavailable.':`Small cells and their complementary groups below ${minimum} are withheld. Custom slices and combined comparisons require safe full-history cohorts; broaden the view if suppressed.`,
      "Unique participants are deduplicated by stored Member ID; duplicate person-session records count once. Repeat requires two distinct sessions of the same programme. One-session programmes have repeat rate Not applicable.",
      "Group repeat rate uses people attending at least one multi-session programme as its opportunity denominator. Programme repeat rate uses that programme's unique participants. First observed means first in available history, not new to the centre.",
      "Reported barriers include sourced participant/caregiver feedback only; attendance is not evidence of a reason or programme suitability.",
    ],
    metricsDefinition: {
      rate: "Participating registered clients / eligible current registered clients in the group",
      averageSessions:
        "Distinct person-session attendance entries / participating people",
      medianSessions: "Median distinct sessions per participating person in the selected period; IQR spans the 25th–75th percentiles using linear interpolation. Nonattenders are excluded.",
      repeatRate:
        "Same-programme repeat participants / people with a multi-session opportunity",
      diagnosticRepeatRate: "Programme participants with 2+ distinct sessions / unique programme participants, including zero for a one-session programme. Existing repeat-opportunity metrics are unchanged.",
      representation: "Selected group's share of registered-client programme attendees versus its share of the same complete eligible registry. All-age/non-client attendance is excluded from both shares.",
      domainMix: "Recorded primary-domain unique reach overlaps; primary-domain entry shares use the selected group's total entries. Event Types are not reassigned as primary domains.",
    },
  };
}
