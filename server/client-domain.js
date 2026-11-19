import {sourceCoverage} from "./reporting-policy.js";
import { defaults, hash, todaySG, matchesSelection } from "./domain.js";
import { registrationContext } from '../shared/registration-context.js';
import {
  materializeProfiles,
  interests,
  needs,
  barriers as barrierCatalogue,
} from "./needs-domain.js";

export const CLIENT_SNAPSHOT = "current-client-registry";
export const registryHeaders = {
  memberId: "Member ID",
  gender: "Gender",
  livingRaw: "Current Living Arrangement",
  age: "Age",
  race: "Race",
  cfs: "CFS",
  riskRaw: "Social Risk Factor(s)",
  client: "Is Client",
  boundary: "Within Boundary",
  blockRaw: "Block / Building No.",
};
export const clientFields = Object.keys(registryHeaders).filter(
  (f) => f !== "memberId",
);
export const contactOutcomes = [
  "Contact attempted",
  "Contact successful",
  "Participant not interested",
  "Participant interested",
  "Follow-up required",
  "Referral or support required",
  "Other approved outcome",
];
export const gapBarriers = [
  "Does not know how to register",
  "Prefers a smaller group",
  "Uncomfortable attending alone",
  "Health-related participation limitations",
  "Prefers not to say",
];
export const canonicalMemberId = (value) => String(value ?? "").trim();
export const missing = (v) =>
  v == null ||
  v === "" ||
  ["MISSING", "UNKNOWN"].includes(String(v).toUpperCase());
export const validDay = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const asBool = (v) =>
  ["YES", "TRUE", "1", "Y"].includes(v.toUpperCase())
    ? true
    : ["NO", "FALSE", "0", "N"].includes(v.toUpperCase())
      ? false
      : null;
export function parseClientRegistry(matrix) {
  const headers = (matrix[0] || []).map((v) => {
    const h = String(v ?? "").trim();
    return h.startsWith("Name/") &&
      Object.values(registryHeaders).includes(h.slice(5))
      ? h.slice(5)
      : h;
  });
  if (new Set(headers).size !== headers.length)
    throw fail("Registry headers must be unique.");
  const absent = Object.entries(registryHeaders)
    .filter(([field]) => !["client", "boundary"].includes(field))
    .map(([, header]) => header)
    .filter((h) => !headers.includes(h));
  if (absent.length)
    throw fail("Missing client registry headers: " + absent.join(", "));
  const rows = [],
    issues = [],
    ids = new Set();
  let duplicates = 0;
  for (let i = 1; i < matrix.length; i++) {
    const values = Object.fromEntries(
      headers.map((h, j) => [h, String(matrix[i][j] ?? "").trim()]),
    );
    if (Object.values(values).every((v) => !v)) continue;
    const memberId = canonicalMemberId(values[registryHeaders.memberId]);
    if (
      !memberId ||
      memberId.length > 200 ||
      [...memberId].some((character) => character.charCodeAt(0) < 32)
    ) {
      issues.push({ row: i + 1, message: "A valid Member ID is required." });
      continue;
    }
    const id = hash([memberId]);
    if (ids.has(id)) {
      duplicates++;
      issues.push({
        row: i + 1,
        message:
          "Duplicate Member ID; resolve it before importing the complete registry.",
      });
      continue;
    }
    ids.add(id);
    const age = values.Age ? Number(values.Age) : null;
    // Registry inclusion establishes membership when the legacy column is
    // absent. It provides no evidence about the service boundary.
    const client = headers.includes("Is Client")
        ? asBool(values["Is Client"] || "")
        : true,
      boundary = asBool(values["Within Boundary"] || "");
    const rawDate =
      values["Registration Date"] || values["Date of Admission (A)"];
    // ExcelJS exposes native Excel date cells as Date.toString() via cell.text.
    // Accept that form and ISO dates; do not guess ambiguous CSV dates.
    const excelDate =
      rawDate &&
      /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}(?: \(.+\))?$/.test(
        rawDate,
      )
        ? new Date(rawDate)
        : null;
    const registrationDate =
      excelDate && Number.isFinite(excelDate.getTime())
        ? excelDate.toISOString().slice(0, 10)
        : rawDate || null;
    if (
      (age != null && (!Number.isInteger(age) || age < 0 || age > 120)) ||
      (values["Is Client"] && client == null) ||
      (values["Within Boundary"] && boundary == null) ||
      (registrationDate && !validDay(registrationDate))
    ) {
      issues.push({
        row: i + 1,
        message: "Check age, Yes/No values and registration date.",
      });
      continue;
    }
    rows.push({
      id,
      memberId,
      row: i + 1,
      age,
      gender: values.Gender.toUpperCase() || null,
      race: values.Race.toUpperCase() || null,
      cfs: values.CFS || null,
      livingRaw: values["Current Living Arrangement"] || null,
      riskRaw: values["Social Risk Factor(s)"] || null,
      client,
      boundary,
      blockRaw: values["Block / Building No."] || null,
      registrationDate,
      preferredLanguage: values["Preferred Language"] || null,
    });
  }
  if (!rows.length) throw fail("No valid client registry rows were found.");
  return { rows, issues, duplicates };
}
export function currentClientRows(registry, settings) {
  const snapshot =
    settings.registry?.type === "clients"
      ? CLIENT_SNAPSHOT
      : settings.registry?.snapshot;
  return registry
    .filter((r) => r.snapshot === snapshot)
    .map((r) => ({ id: r.participant_id, ...JSON.parse(r.details) }));
}
export function inspectClientRegistry(parsed, state) {
  const existing = new Map(state.data.participants.map((p) => [p.id, p]));
  const current = new Map(
    currentClientRows(state.registry, state.settings).map((p) => [p.id, p]),
  );
  const reviewed = new Map(
    state.profiles.map((p) => [
      p.participant_id,
      JSON.parse(p.details).basic || {},
    ]),
  );
  const conflicts = [],
    incomingIds = new Set(parsed.rows.map((p) => p.id));
  let enrichments = 0;
  for (const row of parsed.rows) {
    const old = {
      ...(existing.get(row.id) || {}),
      ...(current.get(row.id) || {}),
    };
    for (const field of [
      ...clientFields,
      "registrationDate",
      "preferredLanguage",
    ]) {
      const value = row[field];
      if (missing(value)) continue;
      const override = reviewed.get(row.id)?.[field];
      const protectedReview = !missing(override) && override !== value;
      if (protectedReview || (!missing(old[field]) && old[field] !== value))
        conflicts.push({
          key: hash([row.id, field]),
          id: row.id,
          memberId: row.memberId,
          row: row.row,
          field,
          label: registryHeaders[field] || field,
          existing: protectedReview ? override : old[field],
          incoming: value,
          protectedReview,
          source: protectedReview
            ? "Staff-reviewed profile"
            : current.has(row.id)
              ? "Saved client registry"
              : "Attendance profile",
        });
      else if (missing(old[field])) enrichments++;
    }
  }
  return {
    conflicts,
    enrichments,
    matched: parsed.rows.filter((p) => existing.has(p.id)).length,
    newProfiles: parsed.rows.filter((p) => !existing.has(p.id)).length,
    omitted: [...current.values()].filter(
      (p) => p.membershipStatus !== "Archived" && !incomingIds.has(p.id),
    ).length,
  };
}
export function registryFingerprint(state) {
  return hash({
    participants: state.data.participants
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id)),
    profiles: state.profiles
      .slice()
      .sort((a, b) => a.participant_id.localeCompare(b.participant_id)),
    registry: state.registry
      .slice()
      .sort((a, b) =>
        (a.participant_id + a.snapshot).localeCompare(
          b.participant_id + b.snapshot,
        ),
      ),
    settings: state.settings.registry,
  });
}
export function clientPopulation(
  state,
  asOf = todaySG(),
  includeArchived = false,
) {
  const effective = materializeProfiles(state.data, state.profiles);
  const people = new Map(effective.participants.map((p) => [p.id, p]));
  const feedback = new Map();
  for (const row of [...state.feedback].sort((a, b) =>
    (a.date + a.created + a.id).localeCompare(b.date + b.created + b.id),
  )) {
    const detail = JSON.parse(row.details);
    if (row.date > asOf) continue;
    const previous = feedback.get(row.participant_id) || {
      interests: [],
      interestsResponded: false,
      languages: [],
      barriers: new Map(),
      contact: null,
    };
    if (detail.preferences?.responded) {
      previous.interests = detail.preferences.interests || [];
      previous.interestsResponded = true;
    }
    if (detail.preferences?.languages?.length)
      previous.languages = detail.preferences.languages;
    for (const barrier of detail.barriers || [])
      if (!["Not assessed", "Unknown"].includes(barrier.status))
        previous.barriers.set(barrier.category, barrier);
    if (detail.contact)
      previous.contact = {
        ...detail.contact,
        date: row.date,
        actor: detail.staff || "Staff",
        id: row.id,
      };
    feedback.set(row.participant_id, previous);
  }
  return currentClientRows(state.registry, state.settings)
    .filter(
      (r) =>
        (includeArchived || r.membershipStatus !== "Archived") &&
        r.client === true &&
        (!r.registrationDate || r.registrationDate <= asOf),
    )
    .map((r) => {
      const p = people.get(r.id) || { id: r.id },
        profile = p.profile || {},
        f = feedback.get(r.id);
      const result = { ...p, ...r, profile, sources: r.fieldSources || {} };
      for (const [key, value] of Object.entries(profile.basic || {}))
        if (!missing(value)) result[key] = value;
      const barrierMap = new Map(f?.barriers || []);
      for (const b of profile.barriers || [])
        if (!b.date || b.date <= asOf) barrierMap.set(b.category, b);
      result.reportedBarriers = [...barrierMap.values()].filter(
        (b) =>
          ["Reported", "Assessed"].includes(b.status) &&
          ["Participant-reported", "Caregiver-reported"].includes(b.source) &&
          b.category !== "Prefers not to say",
      );
      result.barriersAssessed = [...barrierMap.values()].some(
        (b) =>
          ["Reported", "Assessed", "Not present"].includes(b.status) &&
          ["Participant-reported", "Caregiver-reported"].includes(b.source) &&
          b.category !== "Prefers not to say",
      );
      result.interests = profile.preferences?.responded
        ? profile.preferences.interests || []
        : f?.interests || [];
      result.interestsAssessed = Boolean(
        profile.preferences?.responded || f?.interestsResponded,
      );
      result.supportNeeds = (profile.needs || []).filter(
        (n) =>
          ["Reported", "Assessed"].includes(n.status) &&
          n.source !== "Unconfirmed" &&
          (!n.date || n.date <= asOf),
      );
      result.preferredLanguage =
        profile.basic?.preferredLanguage ||
        (profile.preferences?.languages?.length
          ? profile.preferences.languages
          : null) ||
        r.preferredLanguage ||
        (f?.languages?.length ? f.languages : null) ||
        null;
      result.contact = f?.contact || null;
      return result;
    });
}
export function validateClientQuery(input = {}, now = todaySG()) {
  const q = { ...input },
    allowed = [
      "from",
      "to",
      "asOf",
      "programme",
      "domain",
      "status",
      "ageGroup",
      "ageMin",
      "ageMax",
      "gender",
      "race",
      "living",
      "cfs",
      "risk",
      "block",
      "zone",
      "client",
      "language",
      "interest",
      "barrier",
      "need",
      "followUp",
    ];
  if (Object.keys(q).some((k) => !allowed.includes(k)))
    throw fail("This client filter is not supported.");
  for (const key of ["from", "to", "asOf"])
    if (q[key] && !validDay(q[key]))
      throw fail("Choose valid reporting dates.");
  q.asOf ||= now;
  if (
    q.asOf > now ||
    (q.from && q.from > q.asOf) ||
    (q.to && q.to > q.asOf) ||
    (q.from && q.to && q.from > q.to)
  )
    throw fail(
      "The reporting period must end on or before the reporting date.",
    );
  for (const value of Object.values(q))
    if (typeof value !== "string" || value.length > 1000)
      throw fail("Check client filters.");
  for (const key of ["ageMin", "ageMax"])
    if (q[key] && (!/^\d{1,3}$/.test(q[key]) || Number(q[key]) > 120))
      throw fail("Choose valid age limits.");
  if (q.ageMin && q.ageMax && Number(q.ageMin) > Number(q.ageMax))
    throw fail("Age limits must be in order.");
  if (
    q.status &&
    ![
      "all",
      "attending",
      "no-attendance",
      "active",
      "recent",
      "inactive-61-90",
      "inactive-90",
      "inactive",
      "no-history",
    ].includes(q.status)
  )
    throw fail("Choose a valid participation status.");
  return q;
}
const ageGroup = (p, s) =>
  p.age == null
    ? "Missing age"
    : p.age < s.seniorAge
      ? `Below ${s.seniorAge}`
      : p.age < s.ageBands[0]
        ? `${s.seniorAge}–${s.ageBands[0] - 1}`
        : p.age < s.ageBands[1]
          ? `${s.ageBands[0]}–${s.ageBands[1] - 1}`
          : `${s.ageBands[1]}+`;
const rowStats = (rows) => {
  const attending = rows.filter((p) => p.selectedSessions > 0).length;
  return {
    registered: rows.length,
    attending,
    noAttendance: rows.length - attending,
    rate: rows.length ? (attending / rows.length) * 100 : null,
    averageSessions: attending
      ? rows.reduce((sum, p) => sum + p.selectedSessions, 0) / attending
      : null,
  };
};
export function clientContext(
  state,
  input = {},
  now = todaySG(),
  includeArchived = false,
) {
  const settings = { ...defaults, ...state.settings },
    q = validateClientQuery(input, now);
  const sessions = new Map(state.data.sessions.map((s) => [s.id, s])),
    programmes = new Map(state.data.programmes.map((p) => [p.id, p]));
  const byPerson = new Map(),
    allSelected = new Set(),
    dates = [];
  for (const a of state.data.attendance) {
    const s = sessions.get(a.sessionId),
      pg = programmes.get(s?.programmeId);
    if (!s || !pg || s.date > now) continue;
    dates.push(s.date);
    if (s.date > q.asOf) continue;
    if (!byPerson.has(a.participantId)) byPerson.set(a.participantId, []);
    byPerson.get(a.participantId).push({ ...s, domain: pg.domain });
    if (
      (!q.from || s.date >= q.from) &&
      (!q.to || s.date <= q.to) &&
      matchesSelection(q.programme, s.programmeId) &&
      matchesSelection(q.domain, pg.domain)
    )
      allSelected.add(a.participantId);
  }
  dates.sort();
  const coverage = sourceCoverage(state.data, now) || {from:dates[0]||null,to:dates.at(-1)||null};
  if (
    coverage.from &&
    ((q.from && q.from > coverage.to) || (q.to || q.asOf) < coverage.from)
  )
    throw fail(
      "The selected period does not overlap the available attendance coverage. Choose covered dates or import newer attendance.",
    );
  const historyCurrent = Boolean(coverage.to && q.asOf <= coverage.to);
  const historyNote = historyCurrent
    ? "Observed recency within the available attendance coverage."
    : "The chosen reporting date is beyond the available attendance coverage, or no history is available. Active/inactive classifications are unavailable; choose a covered date or import updated attendance.";
  const population = clientPopulation(state, q.asOf, includeArchived).filter(
    (p) => !p.registrationDate || p.registrationDate <= (q.to || q.asOf),
  );
  const currentIds = new Set(population.map((p) => p.id));
  const members = population.map((p) => {
    const rows = byPerson.get(p.id) || [],
      historyDates = rows.map((s) => s.date).sort(),
      last = historyDates.at(-1) || null;
    const days = last
      ? Math.floor((Date.parse(q.asOf) - Date.parse(last)) / 86400000)
      : null;
    const status =
      days == null
        ? "no-history"
        : !historyCurrent
          ? "history-limited"
          : days <= settings.inactivityBands[0]
            ? "active"
            : days <= settings.inactivityBands[1]
              ? "recent"
              : days <= settings.inactivityBands[2]
                ? "inactive-61-90"
                : "inactive-90";
    const selected = rows.filter(
      (s) =>
        (!q.from || s.date >= q.from) &&
        (!q.to || s.date <= q.to) &&
        matchesSelection(q.programme, s.programmeId) &&
        matchesSelection(q.domain, s.domain),
    );
    return {
      ...p,
      last,
      days,
      status,
      ageGroup: ageGroup(p, settings),
      zone: settings.clientZones?.[p.blockRaw] || "Unassigned zone",
      selectedSessions: new Set(selected.map((s) => s.id)).size,
      selectedDomains: [...new Set(selected.map((s) => s.domain))].sort(),
      selectedProgrammes: [...new Set(selected.map((s) => s.programmeId))],
      historySessionIds: [...new Set(rows.map((s) => s.id))].sort(),
    };
  });
  const matches = (p, ignoreStatus = false) => {
    if (!ignoreStatus && q.status && q.status !== "all") {
      if (
        q.status === "attending"
          ? !p.selectedSessions
          : q.status === "no-attendance"
            ? p.selectedSessions > 0
            : q.status === "inactive"
              ? !p.status.startsWith("inactive")
              : p.status !== q.status
      )
        return false;
    }
    for (const [key, field] of [
      ["ageGroup", "ageGroup"],
      ["gender", "gender"],
      ["race", "race"],
      ["living", "livingRaw"],
      ["cfs", "cfs"],
      ["risk", "riskRaw"],
      ["block", "blockRaw"],
      ["zone", "zone"],
      ["language", "preferredLanguage"],
    ])
      if (q[key]) {
        const raw = p[field] ?? "Missing";
        const grouped =
          key === "living"
            ? settings.livingGroups?.[raw]
            : key === "cfs"
              ? settings.cfsMappings?.[raw]?.label
              : key === "risk"
                ? settings.riskMappings?.[raw]?.label
                : null;
        if (
          String(raw) !== q[key] &&
          grouped !== q[key] &&
          !(key === "language" && Array.isArray(raw) && raw.includes(q[key]))
        )
          return false;
      }
    if (q.ageMin && (p.age == null || p.age < Number(q.ageMin))) return false;
    if (q.ageMax && (p.age == null || p.age > Number(q.ageMax))) return false;
    if (q.client && q.client !== "all" && q.client !== "true") return false;
    if (q.interest && !p.interests.includes(q.interest)) return false;
    if (q.barrier && !p.reportedBarriers.some((b) => b.category === q.barrier))
      return false;
    if (q.need && !p.supportNeeds.some((n) => n.category === q.need))
      return false;
    if (q.followUp && (p.contact?.outcome || "Not contacted") !== q.followUp)
      return false;
    return true;
  };
  return {
    settings,
    historyCurrent,
    historyNote,
    q,
    members,
    selected: members.filter((p) => matches(p)),
    comparison: members.filter((p) => matches(p, true)),
    coverage,
    otherAttenders: [...allSelected].filter((id) => !currentIds.has(id)).length,
    allSelected,
    programmes: [...programmes.values()],
    matches,
  };
}
// Rows and their complements are protected together. A second withheld category
// prevents subtracting a lone hidden row from the registered-population total.
export function protectClientRows(rows, minimum) {
  const unsafe = (r) =>
    [r.registered, r.attending, r.noAttendance].some(
      (n) => n > 0 && n < minimum,
    );
  const hidden = new Set(rows.filter(unsafe).map((r) => r.label));
  if (hidden.size === 1 && rows.length > 1) {
    const other = rows
      .filter((r) => !hidden.has(r.label))
      .sort((a, b) => a.registered - b.registered)[0];
    hidden.add(other.label);
  }
  return rows.map((r) =>
    hidden.has(r.label)
      ? {
          label: r.label,
          suppressed: true,
          registered: null,
          attending: null,
          noAttendance: null,
          rate: null,
          averageSessions: null,
          domains: [],
          lastPatterns: [],
        }
      : { ...r, suppressed: false },
  );
}
export function clientReport(
  state,
  input = {},
  now = todaySG(),
  coverageOnly = false,
) {
  const ctx = clientContext(state, input, now),
    { settings, q, members, selected } = ctx,
    minimum = settings.staffAnalysisFull ? 0 : Math.max(5, settings.privacyMinimum);
  const filteredKeys = Object.keys(q).filter(
    (k) =>
      !["from", "to", "asOf", "programme", "domain"].includes(k) &&
      q[k] &&
      q[k] !== "all",
  );
  // Exact attendance signatures prevent arbitrary date/programme slices from
  // splitting released atoms when combined profile filters are requested.
  const atoms = new Map();
  for (const p of members) {
    const signature = JSON.stringify([
      p.age,
      p.ageGroup,
      p.gender,
      p.race,
      p.livingRaw,
      p.cfs,
      p.riskRaw,
      p.blockRaw,
      p.zone,
      p.preferredLanguage,
      p.interests,
      p.reportedBarriers.map((b) => b.category).sort(),
      p.supportNeeds.map((n) => n.category).sort(),
      p.contact?.outcome,
      p.historySessionIds,
    ]);
    atoms.set(signature, (atoms.get(signature) || 0) + 1);
  }
  const arbitrarySlice = filteredKeys.length > 0 || q.programme || q.domain;
  const atomSafe = [...atoms.values()].every((n) => n >= minimum);
  const suppressed =
    Boolean(arbitrarySlice && !atomSafe) ||
    [selected.length, members.length - selected.length].some(
      (n) => n > 0 && n < minimum,
    );
  const group = (field, labeler = (p) => p[field] ?? "Missing") => {
    const customDates =
      (q.from && q.from !== ctx.coverage.from) ||
      (q.to && q.to !== ctx.coverage.to && q.to !== now) ||
      (q.asOf !== now && q.asOf !== ctx.coverage.to);
    if (
      suppressed ||
      !ctx.coverage.from ||
      (customDates &&
        !atomSafe &&
        ["livingRaw", "cfs", "riskRaw", "blockRaw", "zone"].includes(field))
    )
      return { suppressed: true, rows: [] };
    const buckets = new Map();
    for (const p of selected) {
      const label = String(labeler(p) || "Missing");
      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label).push(p);
    }
    const rows = [...buckets].map(([label, people]) => ({
      label,
      ...rowStats(people),
      domains: [...new Set(people.flatMap((p) => p.selectedDomains))]
        .sort()
        .map((label) => ({
          label,
          value: people.filter((p) => p.selectedDomains.includes(label)).length,
        })),
      lastPatterns: Object.entries(
        people.reduce(
          (s, p) => ((s[p.status] = (s[p.status] || 0) + 1), s),
          {},
        ),
      ).map(([label, value]) => ({ label, value })),
    }));
    // Secondary domain/status details may contain smaller groups even when the
    // main row is safe. Withhold these details independently of the main rate.
    return {
      suppressed: false,
      rows: protectClientRows(rows, minimum).map((r) => ({
        ...r,
        lastPatterns: r.lastPatterns.some(
          (s) => s.value > 0 && s.value < minimum,
        )
          ? []
          : r.lastPatterns,
        domains: r.domains.some(
          (d) =>
            d.value > 0 &&
            (d.value < minimum ||
              (r.registered - d.value > 0 && r.registered - d.value < minimum)),
        )
          ? []
          : r.domains,
      })),
    };
  };
  const rawSummary = {
    ...rowStats(selected),
    active: selected.filter((p) => p.status === "active").length,
    inactive: selected.filter((p) => p.status.startsWith("inactive")).length,
    otherAttenders: ctx.otherAttenders,
  };
  const metrics = {};
  for (const [key, value] of Object.entries(rawSummary))
    metrics[key] =
      suppressed ||
      (typeof value === "number" &&
        !["rate", "averageSessions"].includes(key) &&
        value > 0 &&
        value < minimum)
        ? null
        : value;
  if (!ctx.coverage.from)
    for (const key of [
      "attending",
      "noAttendance",
      "rate",
      "averageSessions",
      "otherAttenders",
      "active",
      "inactive",
    ])
      metrics[key] = null;
  if (
    [rawSummary.attending, rawSummary.noAttendance].some(
      (n) => n > 0 && n < minimum,
    )
  ) {
    metrics.attending = null;
    metrics.noAttendance = null;
    metrics.rate = null;
    metrics.averageSessions = null;
  }
  if (coverageOnly)
    return {
      available:
        state.settings.registry?.type === "clients" &&
        currentClientRows(state.registry, settings).length > 0,
      complete: state.settings.registry?.complete === true,
      attendanceAvailable: Boolean(ctx.coverage.from),
      summary: Object.fromEntries(
        ["registered", "attending", "noAttendance", "rate"].map((k) => [
          k,
          metrics[k],
        ]),
      ),
      populationNote:
        "Current registered-client population, all ages. Known registration dates are applied; missing registration dates do not establish historical membership. Attendance coverage is limited to the records available.",
      limitations: ctx.historyNote ? [ctx.historyNote] : [],
    };
  const gender = group("gender"),
    living = group(
      "livingRaw",
      (p) => settings.livingGroups?.[p.livingRaw] || p.livingRaw || "Missing",
    ),
    blocks = group("blockRaw"),
    cfs = group(
      "cfs",
      (p) => settings.cfsMappings?.[p.cfs]?.label || p.cfs || "Missing",
    );
  const minority = selected.filter((p) => settings.minority.includes(p.race));
  const protectedMinority = protectClientRows(
    [
      { label: "Configured minority", ...rowStats(minority) },
      {
        label: "Other / unknown race",
        ...rowStats(
          selected.filter((p) => !settings.minority.includes(p.race)),
        ),
      },
    ],
    minimum,
  )[0];
  const male = gender.rows.find((r) => r.label === "MALE"),
    alone = living.rows.find((r) => r.label === "Alone");
  metrics.maleRate = male?.rate ?? null;
  metrics.minorityRate = suppressed ? null : protectedMinority.rate;
  metrics.livingAloneNoAttendance = alone?.noAttendance ?? null;
  const statusLabels = ctx.historyCurrent
    ? ["active", "recent", "inactive-61-90", "inactive-90", "no-history"]
    : ["history-limited", "no-history"];
  const statusRows = statusLabels.map((label) => ({
    label,
    value: selected.filter((p) => p.status === label).length,
  }));
  const statusSuppressed =
    suppressed || statusRows.some((r) => r.value > 0 && r.value < minimum);
  if (statusSuppressed) {
    metrics.active = null;
    metrics.inactive = null;
  }
  if (!ctx.historyCurrent) {
    metrics.active = null;
    metrics.inactive = null;
  }
  const findings = [];
  const add = (id, title, finding, why, investigate, action) =>
    findings.push({
      id,
      title,
      finding,
      why,
      investigate,
      action,
      category: "Outreach review",
      evidence: `Current registry; attendance ${ctx.coverage.from || "unavailable"} to ${ctx.coverage.to || "unavailable"}`,
      target: title,
      priority: "Medium",
      next: "Review existing contact records and seek voluntary feedback.",
    });
  if (alone?.noAttendance >= Math.max(5,settings.minParticipants||5))
    add(
      "client-alone",
      "Clients living alone",
      `${alone.noAttendance} of ${alone.registered} registered clients living alone have no recorded attendance in the selected period.`,
      "This is an observed coverage gap, not a reason for non-participation.",
      "Voluntary information on awareness, interests, timing and support needs.",
      "Review existing contacts and invite feedback before choosing an outreach approach.",
    );
  const female = gender.rows.find((r) => r.label === "FEMALE");
  if (male?.rate != null && female?.rate != null && male.rate < female.rate)
    add(
      "client-gender",
      "Gender participation difference",
      `${male.attending} of ${male.registered} male clients attended (${male.rate.toFixed(1)}%), compared with ${female.rate.toFixed(1)}% of female clients.`,
      "A coverage difference can guide questions; its cause has not been established.",
      "Programme awareness, preferred activities, availability and participant-reported barriers.",
      "Collect feedback before selecting programmes or outreach; avoid gender stereotypes.",
    );
  const largest = blocks.rows
    .filter(
      (r) => !r.suppressed && r.registered >= 20 && r.noAttendance >= minimum,
    )
    .sort((a, b) => b.noAttendance - a.noAttendance)[0];
  if (largest)
    add(
      "client-block",
      "Residential participation review",
      `Block ${largest.label}: ${largest.attending} of ${largest.registered} clients attended.`,
      "Block identifiers show an observed grouping, not validated travel access.",
      "Programme awareness and confirmed accessibility or transport concerns.",
      "Review outreach coverage; do not infer distance or draw an unvalidated map.",
    );
  const unassessed = selected.filter((p) => !p.barriersAssessed).length;
  const barriers = new Map();
  let respondents = 0;
  for (const p of selected)
    if (p.barriersAssessed) {
      respondents++;
      for (const b of p.reportedBarriers)
        barriers.set(b.category, (barriers.get(b.category) || 0) + 1);
    }
  const barrierRows = [...barriers].map(([label, value]) => ({
    label,
    value,
    percent: respondents ? (value / respondents) * 100 : null,
  }));
  const barrierSuppressed =
    suppressed ||
    (() => {
      const patterns = new Map();
      for (const p of selected) {
        const key = JSON.stringify([
          p.barriersAssessed,
          p.reportedBarriers.map((b) => b.category).sort(),
        ]);
        patterns.set(key, (patterns.get(key) || 0) + 1);
      }
      return [...patterns.values()].some((n) => n > 0 && n < minimum);
    })() ||
    (respondents > 0 && respondents < minimum) ||
    (unassessed > 0 && unassessed < minimum) ||
    barrierRows.some(
      (r) =>
        r.value > 0 &&
        (r.value < minimum ||
          (respondents - r.value > 0 && respondents - r.value < minimum)),
    );
  const options = {};
  for (const [key, field] of [
    ["ageGroup", "ageGroup"],
    ["gender", "gender"],
    ["race", "race"],
    ["living", "livingRaw"],
    ["cfs", "cfs"],
    ["risk", "riskRaw"],
    ["block", "blockRaw"],
    ["zone", "zone"],
    ["language", "preferredLanguage"],
  ]) {
    const counts = new Map();
    for (const p of members) {
      const v = String(p[field] ?? "Missing");
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    options[key] = [...counts]
      .filter(([, count]) => count >= minimum)
      .map(([value]) => value)
      .sort();
  }
  options.interest = interests;
  options.barrier = barrierCatalogue;
  options.need = needs;
  const qualityFields = [
    "memberId",
    ...clientFields,
    "preferredLanguage",
    "reportedNeeds",
    "reportedInterests",
    "reportedBarriers",
  ];
  const quality = qualityFields.map((field) => {
    const known = (p) =>
      field === "reportedNeeds"
        ? p.supportNeeds.length > 0 ||
          (p.profile.needs || []).some((n) => n.status === "Not present")
        : field === "reportedInterests"
          ? p.interestsAssessed
          : field === "reportedBarriers"
            ? p.barriersAssessed
            : !missing(p[field]);
    const unknown = field.startsWith("reported")
      ? 0
      : members.filter(
          (p) => String(p[field] ?? "").toUpperCase() === "UNKNOWN",
        ).length;
    const absent = members.filter((p) => !known(p)).length - unknown;
    return {
      field,
      label:
        registryHeaders[field] ||
        {
          preferredLanguage: "Preferred language",
          reportedNeeds: "Reported support needs",
          reportedInterests: "Reported programme preferences",
          reportedBarriers: "Participation barriers",
        }[field],
      missing: absent >= minimum || absent === 0 ? absent : null,
      unknown: unknown >= minimum || unknown === 0 ? unknown : null,
      total: members.length,
      source: field.startsWith("reported")
        ? "Reviewed profile / participant feedback"
        : field === "preferredLanguage"
          ? "Optional registry field / reviewed profile"
          : "Client registry, with separately reviewed profile corrections",
    };
  });
  return {
    available:
      state.settings.registry?.type === "clients" &&
      currentClientRows(state.registry, state.settings).length > 0,
    complete: state.settings.registry?.complete === true,
    generatedAt: new Date().toISOString(),
    period: {
      from: q.from || ctx.coverage.from,
      to: q.to || q.asOf,
      asOf: q.asOf,
    },
    coverage: ctx.coverage,
    registry: {
      asOf: settings.registry?.asOf || null,
      source: settings.registry?.source || null,
    },
    summary: metrics,
    registrationContext: registrationContext(selected,p=>p.selectedSessions>0,ctx.coverage.from,settings.staffAnalysisFull && !suppressed && state.settings.registry?.complete===true),
    suppressed,
    minimum,
    privacyNote: settings.staffAnalysisFull?'Staff analysis displays all recorded group counts. Unknown fields and unavailable attendance history are identified separately.':suppressed
      ? "Combined or programme-filtered aggregate results are withheld because the available cohorts do not meet the privacy rule. Authorised staff can use the separate audited follow-up workspace."
      : "Small rows and a complementary category are withheld together. Identifiable follow-up is a separate authorised workflow; exports exclude sensitive breakdowns.",
    populationNote:
      "Current registered-client population, all ages. Known registration dates are applied; missing registration dates do not establish historical membership. Attendance coverage is limited to the records available.",
    groups: {
      gender,
      living,
      age: group("ageGroup"),
      race: group("race"),
      cfs,
      risk: group(
        "riskRaw",
        (p) =>
          settings.riskMappings?.[p.riskRaw]?.label || p.riskRaw || "Missing",
      ),
      block: blocks,
      zone: group("zone"),
    },
    statuses: {
      suppressed: statusSuppressed,
      rows: statusSuppressed ? [] : statusRows,
      bands: settings.inactivityBands,
      note: ctx.historyNote,
    },
    barriers: {
      suppressed: barrierSuppressed,
      respondents: barrierSuppressed ? null : respondents,
      unassessed: barrierSuppressed ? null : unassessed,
      rows: barrierSuppressed ? [] : barrierRows,
    },
    quality: suppressed ? [] : quality,
    findings: suppressed || !ctx.coverage.from ? [] : findings,
    attendanceAvailable: Boolean(ctx.coverage.from),
    options,
    programmes: ctx.programmes.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
    })),
    limitations: [
      "No attendance in this period does not mean never attended, unwilling or disengaged.",
      "CFS and SRF are recorded categories, not diagnoses or programme eligibility decisions.",
      "Block numbers are not geocoded addresses or evidence of distance or transport barriers.",
      "Missing feedback is not evidence of no barrier. Current profile data does not establish historical assessment status.",
    ],
  };
}
export function clientFollowupRows(
  state,
  input = {},
  now = todaySG(),
  membership = "Active",
) {
  const ctx = clientContext(state, input, now, membership !== "Active");
  return {
    ctx,
    rows: ctx.selected
      .filter(
        (p) =>
          membership === "All" ||
          (p.membershipStatus || "Active") === membership,
      )
      .map((p) => ({
        id: p.id,
        memberId: p.memberId || "ID not stored in legacy source",
        age: p.age,
        living: p.livingRaw || "Missing",
        block: p.blockRaw || "Missing",
        last: p.last,
        status: p.status,
        attendance: p.selectedSessions,
        followUp: p.contact?.outcome || "Not contacted",
        assigned: p.contact?.assigned || p.profile.followUp?.assigned || "",
        lastContact: p.contact?.date || null,
        profileRevision: p.profile.revision || 0,
        membershipRevision: p.revision || 0,
      })),
  };
}
