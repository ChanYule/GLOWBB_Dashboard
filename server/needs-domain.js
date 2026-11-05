import { analytics, defaults, hash, todaySG } from "./domain.js";
export const interests = [
  "Physical exercise",
  "Health and wellness",
  "Arts and crafts",
  "Music and performance",
  "Social gatherings",
  "Games",
  "Cognitive activities",
  "Technology and digital learning",
  "Cultural activities",
  "Cooking",
  "Volunteering",
  "Intergenerational activities",
  "Educational workshops",
  "Other",
];
export const needs = [
  "Mobility assistance",
  "Transport assistance",
  "Communication support",
  "Language support",
  "Caregiver involvement",
  "Accessibility",
  "Community support",
  "Other",
];
export const barrierThemes = {
  "Language and Communication": ["Language"],
  "Culture and Programme Relevance": [
    "Cultural familiarity",
    "Programme interests not matched",
  ],
  "Centre Awareness and Familiarity": [
    "Lack of programme awareness",
    "Unfamiliarity with the centre",
  ],
  "Social Networks and Inclusivity": [
    "Limited peer networks",
    "Not knowing other participants",
    "Discomfort in group settings",
  ],
  "Physical and Geographic Accessibility": [
    "Accessibility",
    "Distance and transport",
    "Mobility limitations",
  ],
  "Transport and route accessibility": [
    "Distance to centre",
    "Transport difficulties",
    "Mobility or route accessibility concerns",
    "Difficulty using public transport",
    "Requires assistance travelling",
    "Programme venue difficult to access",
    "Other reported accessibility concern",
    "No reported transport barrier",
  ],
  "Programme Availability and Suitability": [
    "Programme timing",
    "Caregiving responsibilities",
    "Limited programme choices",
  ],
  "Additional reported access and preferences": [
    "Does not know how to register",
    "Prefers a smaller group",
    "Uncomfortable attending alone",
    "Health-related participation limitations",
    "Prefers not to say",
  ],
  Other: ["Other"],
  Unknown: ["Unknown"],
};
export const barriers = Object.values(barrierThemes).flat();
export const informationSources = [
  "Participant-reported",
  "Caregiver-reported",
  "Staff-observed",
  "Unconfirmed",
];
export const needStates = [
  "Reported",
  "Assessed",
  "Not present",
  "Not assessed",
  "Unknown",
];
export const actionStates = [
  "Proposed",
  "Under Review",
  "Approved",
  "In Progress",
  "Completed",
  "Not Proceeding",
];
export const validDate = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString().slice(0, 10) === x;
const empty = (x) =>
  x == null ||
  x === "" ||
  ["UNKNOWN", "MISSING"].includes(String(x).toUpperCase());
const mapRows = (rows) =>
  new Map(
    rows.map((r) => [
      r.participant_id,
      { ...JSON.parse(r.details), updated: r.updated, revision: r.revision },
    ]),
  );
export function materializeProfiles(data, profiles = []) {
  const saved = mapRows(profiles);
  return {
    ...data,
    participants: data.participants.map((p) => {
      const profile = saved.get(p.id) || {};
      const result = { ...p, profile };
      for (const [key, value] of Object.entries(profile.basic || {}))
        if (
          !empty(value) &&
          [
            "age",
            "gender",
            "race",
            "preferredLanguage",
            "registrationDate",
            "livingRaw",
            "blockRaw",
            "client",
            "boundary",
          ].includes(key)
        )
          result[key] = value;
      return result;
    }),
  };
}
export function participantHistory(
  data,
  id,
  now = todaySG(),
  bands = [30, 60, 90],
  index,
) {
  const sessions =
      index?.sessions || new Map(data.sessions.map((s) => [s.id, s])),
    programmes =
      index?.programmes || new Map(data.programmes.map((p) => [p.id, p]));
  const rows = (
    index
      ? index.attendance.get(id) || []
      : data.attendance.filter((a) => a.participantId === id)
  )
    .map((a) => ({ ...a, session: sessions.get(a.sessionId) }))
    .filter((a) => a.session && a.session.date <= now)
    .map((a) => ({ ...a, programme: programmes.get(a.session.programmeId) }))
    .filter((a) => a.programme);
  const dates = rows.map((a) => a.session.date).sort();
  const last = dates.at(-1) || null,
    days = last
      ? Math.floor(
          (Date.parse(now + "T00:00:00Z") - Date.parse(last + "T00:00:00Z")) /
            86400000,
        )
      : null;
  return {
    attendance: rows.length,
    sessions: new Set(rows.map((a) => a.session.id)).size,
    programmes: new Set(rows.map((a) => a.programme.id)).size,
    domains: new Set(rows.map((a) => a.programme.domain)).size,
    first: dates[0] || null,
    last,
    daysSince: days,
    status:
      days === null
        ? "No recorded attendance"
        : days <= bands[0]
          ? `Within ${bands[0]} days`
          : days <= bands[1]
            ? `${bands[0] + 1}–${bands[1]} days`
            : days <= bands[2]
              ? `${bands[1] + 1}–${bands[2]} days`
              : `More than ${bands[2]} days`,
    repeat: new Set(rows.map((a) => a.session.id)).size > 1,
    rows: rows.sort((a, b) => b.session.date.localeCompare(a.session.date)),
  };
}
export function needsAnalysis(
  data,
  profiles = [],
  feedback = [],
  registry = [],
  configured = {},
  filters = {},
  now = todaySG(),
  briefingOnly = false,
) {
  const settings = { ...defaults, ...configured },
    effective = materializeProfiles(data, profiles),
    pmap = new Map(effective.participants.map((p) => [p.id, p]));
  const registryKnown = !!(
    settings.registry?.complete &&
    settings.registry?.snapshot &&
    settings.registry?.asOf &&
    settings.registry.asOf <= now
  );
  const members = registry
    .filter((r) => r.snapshot === settings.registry?.snapshot)
    .map((r) => ({ ...r, ...JSON.parse(r.details) }))
    .filter(
      (r) =>
        pmap.has(r.participant_id) &&
        r.membershipStatus !== "Archived" &&
        (settings.registry?.type !== "clients" || r.client === true) &&
        (!r.registrationDate || r.registrationDate <= now),
    );
  const memberIds = new Set(members.map((r) => r.participant_id));
  const qualityPeople = registryKnown
    ? effective.participants.filter((p) => memberIds.has(p.id))
    : effective.participants;
  const responsePopulation = qualityPeople.filter(
    (p) => p.age != null && p.age >= settings.seniorAge,
  );
  const responseScope = registryKnown
    ? "Senior members in the attested registry snapshot, including those without recorded attendance"
    : "Known senior profiles with recorded or staff-reviewed information; complete centre membership is not established";
  const report = briefingOnly
      ? null
      : analytics(effective, settings, filters, now),
    sessions = new Map(effective.sessions.map((s) => [s.id, s]));
  const allowedProgrammes = new Set(report?.programmes.map((p) => p.id) || []);
  // Reuse the same eligibility pass once, including every legacy filter.
  const selectedIds = analytics(effective, settings, filters, now, true, true);
  const allSelected = effective.participants.filter((p) =>
    selectedIds.has(p.id),
  );
  const selected = allSelected.filter(
    (p) => p.age != null && p.age >= settings.seniorAge,
  );
  const profilePopulation = registryKnown ? responsePopulation : selected;
  const minimum = settings.privacyMinimum;
  const demographicSeries = (items, denominator) => {
    const suppressed = items.some((r) => r.value > 0 && r.value < minimum);
    return {
      suppressed,
      denominator: suppressed ? null : denominator,
      values: suppressed
        ? []
        : items.map((r) => ({ label: r.label, unique: r.value })),
      note: suppressed
        ? "The whole breakdown and complementary values are withheld under the minimum subgroup rule."
        : "Distinct people in the selected reporting period. Unknown information is separate.",
    };
  };
  const ageValues = new Map();
  for (const p of allSelected) {
    const label =
      p.age == null
        ? "Unknown age"
        : p.age < settings.seniorAge
          ? "Below " + settings.seniorAge
          : p.age < settings.ageBands[0]
            ? `${settings.seniorAge}?${settings.ageBands[0] - 1}`
            : p.age < settings.ageBands[1]
              ? `${settings.ageBands[0]}?${settings.ageBands[1] - 1}`
              : `${settings.ageBands[1]}+`;
    ageValues.set(label, (ageValues.get(label) || 0) + 1);
  }

  const peopleStats = (members) => {
    const ids = new Set(members.map((p) => p.id)),
      rows = effective.attendance.filter((a) => {
        const s = sessions.get(a.sessionId);
        return (
          ids.has(a.participantId) &&
          s &&
          s.date <= now &&
          (!filters.from || s.date >= filters.from) &&
          (!filters.to || s.date <= filters.to) &&
          allowedProgrammes.has(s.programmeId)
        );
      });
    const counts = new Map();
    for (const a of rows) {
      if (!counts.has(a.participantId)) counts.set(a.participantId, new Set());
      counts.get(a.participantId).add(a.sessionId);
    }
    const repeat = [...counts.values()].filter((s) => s.size > 1).length,
      once = [...counts.values()].filter((s) => s.size === 1).length,
      noRecordedAttendance = members.length - counts.size;
    const unsafe = [repeat, once, noRecordedAttendance].some(
      (n) => n > 0 && n < minimum,
    );
    return {
      unique: members.length,
      attendance: unsafe ? null : rows.length,
      repeat: unsafe ? null : repeat,
      once: unsafe ? null : once,
      noRecordedAttendance: unsafe ? null : noRecordedAttendance,
      frequency:
        unsafe || !members.length ? null : rows.length / members.length,
      repeatRate:
        unsafe || !members.length ? null : (repeat / members.length) * 100,
    };
  };
  const distribution = (field, labelFn = (p) => p[field] || "Missing") => {
    const grouped = new Map();
    for (const p of profilePopulation) {
      const label = labelFn(p);
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(p);
    }
    const values = [...grouped].map(([label, people]) => ({
      label,
      ...peopleStats(people),
    }));
    const suppressed = values.some((v) => v.unique > 0 && v.unique < minimum);
    return {
      suppressed,
      denominator: profilePopulation.length,
      values: suppressed ? [] : values.sort((a, b) => b.unique - a.unique),
      note: suppressed
        ? `The whole breakdown is withheld because a subgroup is smaller than ${minimum}; complementary values are withheld too.`
        : registryKnown
          ? "Registered seniors in the attested snapshot, including those without recorded attendance. Latest-known profiles; attendance dates are not assessment dates."
          : "Participating seniors across available attendance. Latest-known profiles; attendance dates are not assessment dates.",
    };
  };
  // Sensitive distributions are fixed to the entire available cohort to block differencing.
  const sensitive =
    Object.keys(filters).some(
      (k) =>
        filters[k] &&
        !["interval", "target"].includes(k) &&
        !(k === "to" && filters[k] === now),
    ) ||
    (filters.target && filters.target !== "all");
  const protectedDistribution = (...args) =>
    sensitive && !settings.staffAnalysisFull
      ? {
          suppressed: true,
          denominator: null,
          values: [],
          note: "Reset global filters to view the fixed protected cohort. Sensitive cross-filters are restricted.",
        }
      : distribution(...args);
  const sourceFields = {
    age: "Age",
    gender: "Gender",
    race: "Race",
    cfs: "CFS",
    riskRaw: "Social Risk Factor (raw code coverage)",
    livingRaw: "Living arrangement",
    blockRaw: "Residential block",
    maritalRaw: "Marital status",
    preferredLanguage: "Preferred language",
  };
  const quality = Object.entries(sourceFields).map(([field, label]) => {
    const statuses = qualityPeople.map((p) =>
      p[field] == null ||
      p[field] === "" ||
      String(p[field]).toUpperCase() === "MISSING"
        ? "missing"
        : ["UNKNOWN"].includes(String(p[field]).toUpperCase())
          ? "unknown"
          : ["NOT ASSESSED", "NOT_ASSESSED"].includes(
                String(p[field]).toUpperCase(),
              )
            ? "notAssessed"
            : "known",
    );
    const completed = statuses.filter((v) => v === "known").length;
    return {
      field,
      label,
      completed,
      missing: statuses.filter((v) => v === "missing").length,
      unknown: statuses.filter((v) => v === "unknown").length,
      notAssessed: statuses.filter((v) => v === "notAssessed").length,
      total: qualityPeople.length,
      percent: qualityPeople.length
        ? (completed / qualityPeople.length) * 100
        : null,
      state: statuses.every((v) => v === "missing")
        ? "Not yet collected"
        : completed < qualityPeople.length
          ? "Collected but incomplete"
          : "Collected",
      source: "Latest-known imported or reviewed participant profile",
      updated: statuses.every((v) => v === "missing")
        ? null
        : profiles
            .map((p) => p.updated)
            .filter(Boolean)
            .sort()
            .at(-1) ||
          data.participants
            .map((p) => p.profileImportedAt)
            .filter(Boolean)
            .sort()
            .at(-1) ||
          null,
    };
  });
  const latestFeedback = new Map();
  for (const row of [...feedback].sort((a, b) =>
    (a.date + a.created).localeCompare(b.date + b.created),
  )) {
    const incoming = JSON.parse(row.details),
      old = latestFeedback.get(row.participant_id) || {
        preferences: {},
        barriers: [],
      };
    const preferences = { ...old.preferences };
    for (const [key, value] of Object.entries(incoming.preferences || {}))
      if (
        Array.isArray(value)
          ? value.length > 0 ||
            (key === "interests" && incoming.preferences.responded)
          : value !== "" && value != null
      )
        preferences[key] = value;
    const barrierMap = new Map(old.barriers.map((b) => [b.category, b]));
    for (const barrier of incoming.barriers || [])
      if (
        !barrierMap.has(barrier.category) ||
        !["Unknown", "Not assessed"].includes(barrier.status)
      )
        barrierMap.set(barrier.category, barrier);
    latestFeedback.set(row.participant_id, {
      ...incoming,
      preferences,
      barriers: [...barrierMap.values()],
      date: row.date,
    });
  }
  const responses = new Map();
  for (const p of effective.participants) {
    const fb = latestFeedback.get(p.id),
      profile = p.profile || {};
    responses.set(p.id, {
      preferences: {
        ...(fb?.preferences || {}),
        ...Object.fromEntries(
          Object.entries(profile.preferences || {}).filter(
            ([, v]) =>
              profile.preferences?.responded ||
              (Array.isArray(v) ? v.length : !!v),
          ),
        ),
      },
      needs: profile.needs || [],
      barriers: (() => {
        const current = new Map(
          (fb?.barriers || []).map((b) => [b.category, b]),
        );
        for (const b of profile.barriers || [])
          if (
            !current.has(b.category) ||
            !["Unknown", "Not assessed"].includes(b.status)
          )
            current.set(b.category, b);
        return [...current.values()];
      })(),
      responded:
        !!fb ||
        !!profile.preferences?.responded ||
        Object.values(profile.preferences || {}).some((v) =>
          Array.isArray(v) ? v.length > 0 : !!v,
        ) ||
        !!profile.needs?.length ||
        !!profile.barriers?.length,
      followUp: profile.followUp || {},
    });
  }
  const fixedIds = new Set(
    sensitive ? [] : responsePopulation.map((p) => p.id),
  );
  const responseMembers = [...responses].filter(
    ([id, r]) => fixedIds.has(id) && r.responded,
  );
  const aggregate = (entries, denominator) => {
    const counts = new Map();
    for (const [id, labels] of entries)
      for (const label of new Set(labels)) {
        if (!counts.has(label)) counts.set(label, new Set());
        counts.get(label).add(id);
      }
    const cells = [...counts].map(([label, ids]) => ({
      label,
      unique: ids.size,
      percent: denominator ? (ids.size / denominator) * 100 : null,
    }));
    const patterns = new Map();
    for (const [, labels] of entries) {
      const pattern = JSON.stringify([...new Set(labels)].sort());
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
    }
    const suppressed =
      sensitive ||
      [...patterns.values()].some((n) => n < minimum) ||
      cells.some((c) => c.unique > 0 && c.unique < minimum) ||
      (denominator > 0 && denominator < minimum);
    return {
      suppressed,
      denominator: suppressed ? null : denominator,
      values: suppressed ? [] : cells.sort((a, b) => b.unique - a.unique),
    };
  };
  const interestResponses = responseMembers.filter(
    ([, r]) => r.preferences.responded || r.preferences.interests?.length,
  );
  const interestSummary = aggregate(
    interestResponses.map(([id, r]) => [id, r.preferences.interests || []]),
    interestResponses.length,
  );
  // The management brief uses the exact same protected response aggregation,
  // then stops before building profiles, histories and programme comparisons.
  if (briefingOnly)
    return {
      generatedAt: new Date().toISOString(),
      responses: {
        respondents: sensitive ? null : responseMembers.length,
        eligible: sensitive ? null : responsePopulation.length,
        note: "Respondent-based percentages use distinct people who answered the relevant question. Multiple selections overlap; missing responses do not indicate no interests or needs.",
        interests: interestSummary,
      },
    };
  const needsRespondents = responseMembers.filter(([, r]) => r.needs.length),
    needsSummary = aggregate(
      needsRespondents.map(([id, r]) => [
        id,
        r.needs
          .filter(
            (n) =>
              ["Reported", "Assessed"].includes(n.status) &&
              n.source !== "Unconfirmed",
          )
          .map((n) => n.category),
      ]),
      needsRespondents.length,
    );
  const barrierRespondents = responseMembers.filter(([, r]) =>
      r.barriers.some((b) => b.category !== "Prefers not to say"),
    ),
    reported = (r) =>
      r.barriers.filter(
        (b) =>
          ["Reported", "Assessed"].includes(b.status) &&
          ["Participant-reported", "Caregiver-reported"].includes(b.source) &&
          b.category !== "Prefers not to say",
      );
  const barrierSummary = aggregate(
    barrierRespondents.map(([id, r]) => [
      id,
      reported(r).map(
        (b) =>
          Object.keys(barrierThemes).find((t) =>
            barrierThemes[t].includes(b.category),
          ) || "Other",
      ),
    ]),
    barrierRespondents.length,
  );
  const hypotheses = aggregate(
    barrierRespondents.map(([id, r]) => [
      id,
      r.barriers
        .filter(
          (b) =>
            ["Unknown", "Not assessed"].includes(b.status) ||
            (["Staff-observed", "Unconfirmed"].includes(b.source) &&
              b.status !== "Not present"),
        )
        .map((b) => b.category),
    ]),
    barrierRespondents.length,
  );
  const preferenceSummary = {};
  for (const field of ["languages", "days", "times", "programmeTypes"]) {
    const respondents = responseMembers.filter(
      ([, r]) => r.preferences[field]?.length,
    );
    preferenceSummary[field] = aggregate(
      respondents.map(([id, r]) => [id, r.preferences[field]]),
      respondents.length,
    );
  }
  for (const [field, label, key] of [
    ["needs", "Care and support needs", "needs"],
    ["interests", "Participant interests", "preferences"],
    ["barriers", "Reported barriers", "barriers"],
  ]) {
    const statuses = qualityPeople
      .map((p) => responses.get(p.id))
      .map((r) => {
        if (key === "preferences")
          return r.preferences.responded || r.preferences.interests?.length
            ? "known"
            : "missing";
        const items = r[key] || [];
        if (!items.length) return "missing";
        if (
          items.some(
            (n) =>
              ["Reported", "Assessed", "Not present"].includes(n.status) &&
              n.source !== "Unconfirmed",
          )
        )
          return "known";
        if (items.every((n) => n.status === "Not assessed"))
          return "notAssessed";
        return items.some(
          (n) => n.status === "Unknown" || n.source === "Unconfirmed",
        )
          ? "unknown"
          : "notAssessed";
      });
    const completed = statuses.filter((v) => v === "known").length;
    quality.push({
      field,
      label,
      completed,
      missing: statuses.filter((v) => v === "missing").length,
      unknown: statuses.filter((v) => v === "unknown").length,
      notAssessed: statuses.filter((v) => v === "notAssessed").length,
      total: qualityPeople.length,
      percent: qualityPeople.length
        ? (completed / qualityPeople.length) * 100
        : null,
      state: statuses.every((v) => v === "missing")
        ? "Not yet collected"
        : completed < qualityPeople.length
          ? "Collected but incomplete"
          : "Collected",
      source: "Voluntary feedback and reviewed staff profiles",
      updated: statuses.every((v) => v === "missing")
        ? null
        : feedback
            .map((f) => f.created)
            .sort()
            .at(-1) ||
          profiles
            .map((p) => p.updated)
            .sort()
            .at(-1) ||
          null,
    });
  }
  const historyIndex = {
    sessions,
    programmes: new Map(effective.programmes.map((p) => [p.id, p])),
    attendance: new Map(),
  };
  for (const a of effective.attendance) {
    if (!historyIndex.attendance.has(a.participantId))
      historyIndex.attendance.set(a.participantId, []);
    historyIndex.attendance.get(a.participantId).push(a);
  }
  const histories = effective.participants.map((p) => ({
    p,
    history: participantHistory(
      effective,
      p.id,
      now,
      settings.inactivityBands,
      historyIndex,
    ),
  }));
  const observedHistories = histories.filter(({ p, history }) =>
    registryKnown ? memberIds.has(p.id) : history.last,
  );
  const inactivity = [
    ...new Set(observedHistories.map((r) => r.history.status)),
  ].map((label) => ({
    label,
    unique: observedHistories.filter((r) => r.history.status === label).length,
  }));
  const noRecordedAttendance = registryKnown
    ? observedHistories.filter((r) => !r.history.last).length
    : null;
  const never =
    registryKnown && settings.registry?.historyComplete
      ? noRecordedAttendance
      : null;
  const inactive = registryKnown
    ? observedHistories.filter(
        (r) =>
          r.history.daysSince !== null &&
          r.history.daysSince > settings.inactivityBands[0],
      ).length
    : null;
  const groupedDomains = new Map();
  for (const d of report.domains) {
    const label = settings.domainGroups[d.label] || d.label;
    if (!groupedDomains.has(label)) groupedDomains.set(label, []);
    groupedDomains.get(label).push(d.label);
  }
  const alignment = [...groupedDomains].map(([label, domains]) => {
    const pg = report.programmes.filter((p) => domains.includes(p.domain)),
      ids = new Set(pg.map((p) => p.id));
    const subset = analytics(
      effective,
      settings,
      { ...filters, domain: JSON.stringify(domains) },
      now,
    );
    return {
      label,
      rawDomains: domains,
      programmes: pg.length,
      sessions: subset.summary.sessions,
      unique: subset.summary.unique,
      attendance: subset.summary.attendance,
      average: subset.summary.average,
      repeat: subset.summary.repeat,
      sessionShare: report.summary.sessions
        ? (subset.summary.sessions / report.summary.sessions) * 100
        : null,
      programmeIds: [...ids],
    };
  });
  const coverage = [];
  for (const [kind, summary, tag, source] of [
    ["Interest", interestSummary, "interestCategories", interestResponses],
    ["Support need", needsSummary, "intendedNeeds", needsRespondents],
  ]) {
    if (summary.suppressed) continue;
    for (const item of summary.values) {
      const offered = effective.programmes.filter((p) =>
        p.optional?.[tag]?.includes(item.label),
      );
      const requestedIds = new Set(
        source
          .filter(([, r]) =>
            kind === "Interest"
              ? r.preferences.interests?.includes(item.label)
              : r.needs.some(
                  (n) =>
                    n.category === item.label &&
                    ["Reported", "Assessed"].includes(n.status) &&
                    n.source !== "Unconfirmed",
                ),
          )
          .map(([id]) => id),
      );
      const offeredIds = new Set(offered.map((p) => p.id));
      const reached = new Set(
        effective.attendance
          .filter((a) => {
            const session = sessions.get(a.sessionId);
            return (
              requestedIds.has(a.participantId) &&
              session &&
              offeredIds.has(session.programmeId) &&
              session.date <= now
            );
          })
          .map((a) => a.participantId),
      ).size;
      coverage.push({
        kind,
        interest: item.label,
        respondents: item.unique,
        denominator: summary.denominator,
        reached: [reached, item.unique - reached].some(
          (n) => n > 0 && n < minimum,
        )
          ? null
          : reached,
        programmes: offered.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.optional.offeringStatus || "Not confirmed",
          outcomes: p.optional.outcomes || "",
          accessibility: p.optional.accessibility || {},
        })),
        sessions: report.programmes
          .filter((p) => offeredIds.has(p.id))
          .reduce((n, p) => n + p.sessions, 0),
        review: offered.length
          ? "Review intended outcomes, accessibility and participant feedback; an explicit tag does not establish that a need is met."
          : "No explicitly tagged programme is recorded. Verify catalogue completeness before describing an unmet need.",
      });
    }
  }
  const findings = [];
  for (const q of quality
    .filter((q) => q.completed < q.total)
    .sort((a, b) => b.total - b.completed - (a.total - a.completed))
    .slice(0, 3))
    findings.push({
      id: "quality-" + q.field,
      category: "Review",
      title: `Improve ${q.label.toLowerCase()} coverage`,
      finding: `${q.total - q.completed} of ${q.total} observed profiles have missing, unknown or not-assessed ${q.label.toLowerCase()}.`,
      explanation:
        "Missing information does not mean no needs. Attendance records do not cover the whole membership population.",
      action:
        "Offer a voluntary profile review and record the source/date; do not repeatedly ask participants unnecessarily.",
      target: "Observed participant profiles",
      evidence: "Recorded data completeness",
      priority: settings.planningPriorities.quality,
      next: "Agree a staff owner and a proportionate collection approach.",
    });
  for (const c of coverage.filter(
    (c) => c.programmes.length === 0 && c.kind === "Interest",
  ))
    findings.push({
      id: "interest-" + hash(c.interest).slice(0, 16),
      category: "Pilot",
      title: `Review demand for ${c.interest.toLowerCase()}`,
      finding: `${c.respondents} of ${c.denominator} interest respondents selected this interest. No explicitly tagged offering is recorded.`,
      explanation:
        "Programme metadata may be incomplete; this is not proof that an appropriate activity is unavailable.",
      action:
        "Confirm available offerings and discuss a small pilot with respondents before allocating resources.",
      target: "Participants who explicitly expressed interest",
      evidence: "Voluntary stated interest; catalogue completeness unverified",
      priority: settings.planningPriorities.interest,
      next: "Check language, access requirements, staff and resources.",
    });
  for (const b of barrierSummary.values)
    findings.push({
      id: "barrier-" + hash(b.label).slice(0, 16),
      category: "Targeted Outreach",
      title: `Follow up ${b.label.toLowerCase()}`,
      finding: `${b.unique} of ${barrierSummary.denominator} barrier respondents reported this theme.`,
      explanation:
        "This finding uses participant/caregiver reports. It is not inferred from low attendance.",
      action:
        "Discuss the reported concern and agree an appropriate outreach or accessibility action.",
      target: "Respondents reporting this barrier",
      evidence:
        "Participant/caregiver-reported; voluntary response coverage is incomplete",
      priority: settings.planningPriorities.barrier,
      next: "Record the agreed action, owner, date and reported outcome.",
    });
  return {
    period: report.period,
    privacyMinimum: minimum,
    summary: Object.fromEntries(
      Object.entries(report.summary).filter(([key]) => !key.startsWith("risk")),
    ),
    generatedAt: new Date().toISOString(),
    registry: {
      available: registryKnown,
      total: registryKnown ? members.length : null,
      asOf: settings.registry?.asOf || null,
      neverAttended: never,
      noRecordedAttendance,
      inactive,
      inactivePct:
        registryKnown && members.length
          ? (inactive / members.length) * 100
          : null,
      note: registryKnown
        ? "Uses the administrator-attested complete registry snapshot. No recorded attendance is not proof of never attending before available history."
        : "No complete member registry is available. Attendance participants are not the whole membership population; member inactivity rates and never-attended membership totals are unavailable.",
    },
    engagement: {
      asOf: now,
      denominator: observedHistories.length,
      bands: settings.inactivityBands,
      values: inactivity,
      note: "Latest attendance across full available history, independent of reporting dates. This describes recorded activity, not willingness to participate.",
    },
    quality,
    qualityScope: registryKnown
      ? "Complete attested member registry snapshot (all ages)"
      : "Full known/imported profile database (all ages); membership completeness is not established",
    demographics: {
      gender: demographicSeries(report.gender, report.summary.unique),
      race: demographicSeries(report.race, report.summary.unique),
      ages: demographicSeries(
        [...ageValues].map(([label, value]) => ({ label, value })),
        allSelected.length,
      ),
      clients: demographicSeries(report.clients, report.summary.unique),
      boundary: demographicSeries(report.boundary, report.summary.unique),
    },
    profiles: {
      cfs: protectedDistribution(
        "cfs",
        (p) => settings.cfsMappings[p.cfs]?.label || p.cfs || "Missing",
      ),
      living: protectedDistribution(
        "livingRaw",
        (p) => settings.livingGroups[p.livingRaw] || p.livingRaw || "Missing",
      ),
      marital: protectedDistribution("maritalRaw"),
      livingAlone: sensitive
        ? null
        : (() => {
            const count = profilePopulation.filter(
              (p) => p.livingRaw === "Alone",
            ).length;
            return [count, profilePopulation.length - count].some(
              (n) => n > 0 && n < minimum,
            )
              ? null
              : count;
          })(),
    },
    responses: {
      respondents: sensitive ? null : responseMembers.length,
      eligible: sensitive ? null : responsePopulation.length,
      scope: responseScope,
      note: "Respondent-based percentages use distinct people who answered the relevant question. Multiple selections overlap; missing responses do not indicate no interests or needs.",
      interests: interestSummary,
      needs: needsSummary,
      barriers: barrierSummary,
      hypotheses,
      preferences: preferenceSummary,
    },
    alignment,
    coverage,
    findings,
    limitations: [
      "Current/latest-known profiles are used; no historical assessments are inferred.",
      registryKnown
        ? "Registry completeness is staff-attested. Historical membership, assessment codebooks and verified programme capacity/cost are not inferred."
        : "No complete membership registry is attested. Historical membership, assessment codebooks and verified programme capacity/cost are not inferred.",
      "Living alone does not establish loneliness. CFS and social risk codes do not establish diagnoses or programme eligibility.",
    ],
  };
}

export async function readEffectiveData(db, storage) {
  if (db.transaction)
    return db.transaction((tx) => readEffectiveData(tx, storage), {
      readOnly: true,
    });
  const raw = await storage.readData(db);
  const profiles = await db.prepare("SELECT * FROM participant_profiles").all();
  return materializeProfiles(raw, profiles);
}
