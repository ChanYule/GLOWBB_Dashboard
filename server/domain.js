import {MAX_IMPORT_ROWS} from "../shared/upload-limits.js";
import {performanceData,sourceCoverage} from './reporting-policy.js';
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import unzipper from "unzipper";
import { parse } from "csv-parse/sync";
import { EVENT_TYPE_HEADER, parseEventTypes,sessionEventTypes } from './event-types.js';
import { DEFAULT_RELIABILITY } from '../shared/participation-reliability.js';
import { DEFAULT_ENGAGEMENT } from '../shared/engagement-depth.js';
import { DEFAULT_OUTREACH_RULES } from "../shared/outreach-priority-rules.js";
import { programmeDiagnostics } from '../shared/programme-diagnostics.js';
export const HEADERS = [
  "Name/Member ID",
  "Gender",
  "Name/Age",
  "Name/Race",
  "Name/CFS",
  "Is Client",
  "Within Boundary",
  "Activity Name",
  "AAP Domain",
  "Session Detail",
];
export const RISK_HEADER = "Name/Social Risk Factor(s)";
export const OPTIONAL_PROFILE_HEADERS = {
  livingRaw: "Name/Current Living Arrangement",
  maritalRaw: "Name/Marital Status",
  preferredLanguage: "Name/Preferred Language",
  registrationDate: "Name/Registration Date",
  cfsAssessedOn: "Name/CFS Assessment Date",
};
export const defaults = {
  seniorAge: 60,
  minority: ["MALAY", "INDIAN", "OTHERS"],
  ageBands: [70, 80],
  minSessions: 3,
  minParticipants: 5,
  privacyMinimum: 5,
  reliability: { ...DEFAULT_RELIABILITY },
  engagement: { ...DEFAULT_ENGAGEMENT },
  outreachRules: { ...DEFAULT_OUTREACH_RULES, riskCodes: [] },
  riskMappings: {},
  multipleRiskFactors: false,
  timeBands: [720, 1080],
  inactivityBands: [30, 60, 90],
  planningPriorities: {
    quality: "Medium",
    barrier: "High",
    interest: "Medium",
  },
  cfsMappings: {},
  livingGroups: {},
  domainGroups: {},
  registry: { complete: false, snapshot: null, asOf: null, source: null },
};
export const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
export const todaySG = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const str = (x) => String(x ?? "").trim();
const upper = (x) => str(x).toUpperCase();
export function parseSession(value) {
  const m = str(value).match(
    /^(\d{4}-\d{2}-\d{2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (!m)
    throw Error("Use YYYY-MM-DD, hh:mm AM - hh:mm PM for Session Detail.");
  const date = m[1];
  if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw Error("Session date does not exist.");
  const time = (h, min, ap) => {
    h = Number(h);
    min = Number(min);
    if (h < 1 || h > 12 || min > 59) throw Error("Invalid session time.");
    return ((h % 12) + (upper(ap) === "PM" ? 12 : 0)) * 60 + min;
  };
  const start = time(m[2], m[3], m[4]),
    end = time(m[5], m[6], m[7]);
  if (end <= start)
    throw Error("End time must be after start time on the same day.");
  return { date, start, end };
}
function boolean(x) {
  if (["YES", "TRUE", "1", "Y"].includes(upper(x))) return true;
  if (["NO", "FALSE", "0", "N"].includes(upper(x))) return false;
  return null;
}
export function parseRows(matrix) {
  if (!matrix.length) throw Error("The file is empty.");
  const headers = matrix[0].map(str);
  const missing = HEADERS.filter((x) => !headers.includes(x));
  if (missing.length)
    throw Error("Missing required headers: " + missing.join(", "));
  if (new Set(headers).size !== headers.length)
    throw Error("Duplicate column headers are not supported.");
  const rows = [],
    issues = [],
    seen = new Set();
  let exactDuplicates = 0,
    blank = 0;
  matrix.slice(1).forEach((values, i) => {
    const row = i + 2;
    if (values.every((x) => !str(x))) {
      blank++;
      return;
    }
    const raw = Object.fromEntries(headers.map((h, j) => [h, str(values[j])]));
    const signature = hash(
      [...HEADERS, RISK_HEADER, EVENT_TYPE_HEADER, ...Object.values(OPTIONAL_PROFILE_HEADERS), ...headers.filter(h=>/^(centre|centres)$/i.test(h))].map(
        (h) => raw[h],
      ),
    );
    if (seen.has(signature)) exactDuplicates++;
    seen.add(signature);
    try {
      const member = raw["Name/Member ID"];
      if (!member) throw Error("Member ID is required.");
      if (member.length > 200) throw Error("Member ID exceeds 200 characters.");
      const name = raw["Activity Name"];
      if (!name) throw Error("Activity Name is required.");
      if (name.length > 500)
        throw Error("Activity name exceeds 500 characters.");
      const session = parseSession(raw["Session Detail"]);
      const ageText = raw["Name/Age"];
      const age = ageText === "" ? null : Number(ageText);
      const warnings = [];
      if (age === null)
        warnings.push("Missing age: excluded from senior reach.");
      if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120))
        throw Error("Age must be a whole number from 0 to 120.");
      const gender = upper(raw.Gender) || "UNKNOWN",
        race = upper(raw["Name/Race"]) || "MISSING";
      if (!["MALE", "FEMALE"].includes(gender))
        warnings.push(
          "Gender is unknown or outside MALE/FEMALE; excluded from gender denominator.",
        );
      if (["UNKNOWN", "MISSING"].includes(race))
        warnings.push(
          "Race is " + race.toLowerCase() + "; excluded from race denominator.",
        );
      const client = boolean(raw["Is Client"]),
        boundary = boolean(raw["Within Boundary"]);
      if (client === null)
        warnings.push("Client status is missing or unrecognised.");
      if (boundary === null)
        warnings.push("Boundary status is missing or unrecognised.");
      const domain = raw["AAP Domain"] || "Unspecified";
      const programmeId = hash([name]);
      const sessionId = hash([
        programmeId,
        session.date,
        session.start,
        session.end,
        null,
      ]);
      const participant = {
        id: hash([member]),
        age,
        gender,
        race,
        cfs: raw["Name/CFS"] || null,
        ...(headers.includes(RISK_HEADER)
          ? { riskRaw: raw[RISK_HEADER] || null }
          : {}),
        ...Object.fromEntries(
          Object.entries(OPTIONAL_PROFILE_HEADERS)
            .filter(([, h]) => headers.includes(h))
            .map(([key, h]) => [key, raw[h] || null]),
        ),
        client,
        boundary,
      };
      rows.push({
        row,
        participant,
        programme: { id: programmeId, name, domain },
        session: { id: sessionId, programmeId, ...session,
          ...(headers.includes(EVENT_TYPE_HEADER) ? {optional:{eventTypeRaw:raw[EVENT_TYPE_HEADER],eventTypes:parseEventTypes(raw[EVENT_TYPE_HEADER])}} : {}) },
        id: hash([participant.id, sessionId]),
        warnings,
        sourceSession: raw["Session Detail"],
      });
    } catch (e) {
      const code = e.message.startsWith("Age must")
        ? "invalidAge"
        : /Session|session|time|date|End time/.test(e.message)
          ? "invalidSession"
          : "requiredField";
      issues.push({ row, message: e.message, code });
    }
  });
  return {
    rawRows: matrix.length - 1 - blank,
    rows,
    issues,
    exactDuplicates,
    blank,
  };
}
export async function readMatrix(buffer, name, requiredHeaders = HEADERS) {
  if (/\.csv$/i.test(name)) {
    let matrix;
    try {
      matrix = parse(
        new TextDecoder("utf-8", { fatal: true })
          .decode(buffer)
          .replace(/^\uFEFF/, ""),
        {
          bom: true,
          skip_empty_lines: true,
          relax_column_count: false,
          max_record_size: 65536,
        },
      );
    } catch {
      throw Error(
        "CSV could not be read. Check UTF-8 encoding, quoted fields and consistent column counts.",
      );
    }
    if (matrix.length > MAX_IMPORT_ROWS + 1) throw Error(`Maximum ${MAX_IMPORT_ROWS.toLocaleString("en-SG")} attendance rows per upload.`);
    return matrix;
  }
  if (!/\.xlsx$/i.test(name))
    throw Error("Upload an .xlsx workbook or UTF-8 .csv file.");
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
    throw Error("This is not a valid XLSX workbook.");
  const zip = await unzipper.Open.buffer(buffer);
  if (
    zip.files.length > 1000 ||
    zip.files.reduce((n, f) => n + f.uncompressedSize, 0) > 64 * 1024 * 1024
  )
    throw Error(
      "Workbook expands beyond the 64 MB safety limit. Export a smaller attendance file.",
    );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets.filter((s) =>
    requiredHeaders.every((h) =>
      (Array.isArray(h) ? h : [h]).some((label) =>
        s.getRow(1).values.slice(1).map(str).includes(label),
      ),
    ),
  );
  if (sheets.length !== 1)
    throw Error(
      "Exactly one worksheet must contain all attendance headers in row 1.",
    );
  const s = sheets[0];
  const columnCount = s.columnCount;
  if (columnCount > 100) throw Error("Maximum 100 columns per worksheet.");
  if (s.rowCount > MAX_IMPORT_ROWS + 1)
    throw Error(`Maximum ${MAX_IMPORT_ROWS.toLocaleString("en-SG")} attendance rows per upload.`);
  const matrix = [];
  s.eachRow({ includeEmpty: true }, (r) =>
    matrix.push(
      Array.from(
        { length: Math.max(requiredHeaders.length, columnCount) },
        (_, i) => {
          const c = r.getCell(i + 1);
          if (c.type === ExcelJS.ValueType.Formula)
            throw Error("Formula cells are not accepted. Export values only.");
          return c.text;
        },
      ),
    ),
  );
  return matrix;
}
export async function readFile(buffer, name) {
  return parseRows(await readMatrix(buffer, name));
}
export function inspectImport(parsed, existing, mode = parsed.mode || "add") {
  const updates = new Map();
  const eventSources = new Map(), eventRows = new Map();
  const missing = [];
  const original = existing;
  const originalAttendance = new Set(existing.attendance.map((a) => a.id));
  if (mode === "replace") existing = { ...existing, attendance: [] };
  const participants = new Map(existing.participants.map((p) => [p.id, p])),
    programmes = new Map(existing.programmes.map((p) => [p.id, p])),
    att = new Set(existing.attendance.map((a) => a.id));
  const fresh = [],
    duplicates = [],
    conflicts = [],
    warnings = [],
    variants = [];
  const names = new Map();
  for (const p of [
    ...existing.programmes,
    ...parsed.rows.map((r) => r.programme),
  ]) {
    const key = p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (names.has(key) && names.get(key) !== p.name)
      variants.push([names.get(key), p.name]);
    else names.set(key, p.name);
  }
  for (let r of parsed.rows) {
    const old = participants.get(r.participant.id),
      pg = programmes.get(r.programme.id);
    const fields = [
      "age",
      "gender",
      "race",
      "cfs",
      "client",
      "boundary",
      "riskRaw",
      ...Object.keys(OPTIONAL_PROFILE_HEADERS),
    ];
    const empty = (v) =>
      v === null ||
      v === undefined ||
      v === "" ||
      v === "UNKNOWN" ||
      v === "MISSING";
    const changes = old
      ? fields.filter(
          (k) => !empty(r.participant[k]) && old[k] !== r.participant[k],
        )
      : [];
    for (const k of fields)
      if (empty(r.participant[k])) missing.push({ row: r.row, field: k });
    const differences = changes.filter((k) => !empty(old[k]));
    if (
      (mode === "add" && differences.length) ||
      (pg && pg.domain !== r.programme.domain)
    ) {
      conflicts.push({
        row: r.row,
        message:
          "Member details or programme domain differ. Row skipped; existing details retained.",
      });
      continue;
    }
    if (old && changes.length && mode !== "add") {
      const next = { ...old };
      for (const k of changes) next[k] = r.participant[k];
      next.profileImportedAt = new Date().toISOString();
      if (changes.includes("riskRaw"))
        next.riskUpdatedAt = new Date().toISOString();
      updates.set(next.id, next);
      participants.set(next.id, next);
      if (differences.length)
        conflicts.push({
          row: r.row,
          action: "update",
          message:
            "Reviewed merge updates latest-known profile fields: " +
            differences.join(", "),
        });
    }
    if (r.session.optional && Object.hasOwn(r.session.optional, 'eventTypeRaw')) {
      if(!eventSources.has(r.session.id))eventSources.set(r.session.id,new Map());
      eventSources.get(r.session.id).set(JSON.stringify([...r.session.optional.eventTypes].sort()),r.session.optional);
      eventRows.set(r.session.id,r.row);
    }
    // Attendance identity never includes changing profile attributes.
    if (old) r = { ...r, participant: participants.get(old.id) };
    if (att.has(r.id)) {
      duplicates.push(r.row);
      continue;
    }
    participants.set(r.participant.id, r.participant);
    programmes.set(r.programme.id, r.programme);
    att.add(r.id);
    fresh.push(r);
    warnings.push(...r.warnings.map((message) => ({ row: r.row, message })));
  }
  const sessionUpdates=[];
  const oldSessions=new Map(original.sessions.map(s=>[s.id,s]));
  for(const [id, sources] of eventSources) {
    const old=oldSessions.get(id), values=[...sources.values()];
    if(values.length>1) {
      warnings.push({row:eventRows.get(id),message:'Conflicting Event Types within the same session. Classification retained or left unclassified; review the source before importing again.'});
      for(let i=0;i<fresh.length;i++)if(fresh[i].session.id===id)fresh[i]={...fresh[i],session:{...fresh[i].session,optional:old?.optional||{eventTypeRaw:null,eventTypes:[],eventTypeConflicts:values.map(v=>v.eventTypeRaw)}}};
      continue;
    }
    const next=values[0];
    if(!old)continue;
    if(!next.eventTypes.length)continue; // Blank/older exports never erase reviewed metadata.
    if(JSON.stringify(old.optional?.eventTypes||[])!==JSON.stringify(next.eventTypes)) {
      warnings.push({row:eventRows.get(id),message:mode==='merge'?'Reviewed merge will update this session’s Event Types; original source values remain in history.':'Existing session Event Types differ; use reviewed Merge to update metadata.'});
      if(mode==='merge')sessionUpdates.push({id,optional:{...old.optional,...next,eventTypeHistory:[...(old.optional?.eventTypeHistory||[]),{raw:old.optional?.eventTypeRaw??null,labels:old.optional?.eventTypes||[],recordedAt:new Date().toISOString()}]}});
    }
  }
  return {
    fresh,
    sessionUpdates,
    updates: [...updates.values()],
    missing,
    mode,
    matched: parsed.rows.filter((r) => originalAttendance.has(r.id)).length,
    resultingAttendance: existing.attendance.length + fresh.length,
    resultingParticipants: participants.size,
    fingerprint: hash(original),
    duplicates,
    conflicts,
    warnings,
    variants: [
      ...new Map(variants.map((v) => [JSON.stringify(v), v])).values(),
    ],
  };
}
const distinct = (arr, key) => new Set(arr.map(key)).size;
function buildInsights({
  summary: s,
  previous,
  programmes,
  timing,
  recommendations,
  settings,
}) {
  const insights = [];
  const sufficient = (x) =>
    x.sessions >= settings.minSessions && x.unique >= settings.minParticipants;
  const add = (category, title, statistic, explanation, action, programmeId) =>
    insights.push({
      category,
      title,
      statistic,
      explanation,
      action,
      ...(programmeId ? { programmeId } : {}),
    });
  if (!s.attendance) return [];
  if (s.unknownGender || s.unknownRace)
    add(
      "quality",
      "Keep demographic gaps in view",
      `${s.unknownGender} unknown gender · ${s.unknownRace} missing or UNKNOWN race`,
      "These seniors remain in overall reach. Known-demographic denominators are used for outreach percentages.",
      "Reconcile missing details through the approved member-record process.",
    );
  if (!sufficient(s)) {
    add(
      "attention",
      "Build a clearer picture",
      `${s.sessions} sessions · ${s.unique} unique seniors`,
      `Stronger observations require at least ${settings.minSessions} sessions and ${settings.minParticipants} seniors. Small counts describe the records, not programme success.`,
      "Gather more attendance and participant feedback before changing delivery.",
    );
    return insights;
  }
  if (previous && sufficient(previous) && previous.unique > 0) {
    const delta = s.unique - previous.unique;
    add(
      delta === 0 ? "pattern" : delta > 0 ? "positive" : "attention",
      delta === 0
        ? "Senior reach held steady"
        : delta > 0
          ? "Senior reach increased"
          : "Senior reach decreased",
      `${delta >= 0 ? "+" : ""}${delta} seniors (${Math.round((delta / previous.unique) * 1000) / 10}%)`,
      `Compared with the preceding ${previous.from} to ${previous.to} period of equal elapsed days. Recorded history may still be incomplete.`,
      "Check programme frequency and participant feedback alongside this change.",
    );
  }
  const top = programmes.find(sufficient);
  if (top)
    add(
      "opportunity",
      "Broadest observed programme reach",
      `${top.unique} seniors · ${top.sessions} sessions`,
      `${top.name} has the largest senior reach among programmes meeting the evidence threshold. Capacity and intended audience are not recorded.`,
      "Review interest and resources before considering another cycle.",
      top.id,
    );
  const newcomer = programmes
    .filter((p) => sufficient(p) && p.firstObserved >= settings.minParticipants)
    .sort((a, b) => b.firstObserved / b.unique - a.firstObserved / a.unique)[0];
  if (newcomer)
    add(
      "pattern",
      "A route to first-observed participants",
      `${newcomer.firstObserved} of ${newcomer.unique} seniors`,
      `${newcomer.name} includes participants first recorded anywhere in the available dataset during this period. This does not establish new centre clients.`,
      "Ask how participants heard about the programme before extending outreach.",
      newcomer.id,
    );
  const declining = recommendations.find((r) => r.category === "Improve");
  if (declining)
    add(
      "attention",
      "A change worth discussing",
      declining.figures,
      `${declining.programme}: ${declining.reason}`,
      declining.action,
      declining.id,
    );
  const eligibleTiming = timing
    .filter(sufficient)
    .sort((a, b) => b.average - a.average);
  if (eligibleTiming.length >= 2) {
    const best = eligibleTiming[0];
    add(
      "pattern",
      "Timing to explore, not a cause",
      `${Math.round(best.average * 10) / 10} attendances per session`,
      `${best.label} has the highest average among time slots with sufficient observations (${best.sessions} sessions). Programme mix also differs.`,
      "Compare similar formats and ask participants about access before changing schedules.",
    );
  }
  if (s.multiDomain)
    add(
      "pattern",
      "Engagement spans programme types",
      `${s.multiDomain} of ${s.unique} seniors`,
      "These seniors attended programmes in two or more AAP domains in the selected view. Domain reach is overlapping and must not be summed.",
      "Discuss which combinations participants value when planning the portfolio.",
    );
  return insights.slice(0, 6);
}
export function analytics(data,...args){
 const report=calculateAnalytics(data,...args);
 if(!report||!report.summary)return report;
 const performance=performanceData(data);
 if(performance!==data){const p=calculateAnalytics(performance,...args);for(const key of ['programmes','domains','recommendations'])if(p[key])report[key]=p[key];if(report.insights)report.insights=report.insights.filter(i=>!i.programmeId);}
 const coverage=sourceCoverage(data,args[2]);if(coverage){report.coverage=coverage;if(report.period&&!report.period.from)report.period.from=coverage.from||'';}
 return report;
}
function calculateAnalytics(
  data,
  settings = defaults,
  filters = {},
  now = todaySG(),
  summaryOnly = false,
  selectionOnly = false,
) {
  settings = { ...defaults, ...settings };
  const pmap = new Map(data.participants.map((p) => [p.id, p]));
  const pgmap = new Map(data.programmes.map((p) => [p.id, p]));
  const smap = new Map(data.sessions.map((s) => [s.id, s]));
  const all = data.attendance
    .map((a) => ({
      ...a,
      p: pmap.get(a.participantId),
      s: smap.get(a.sessionId),
    }))
    .filter((a) => a.p && a.s)
    .map((a) => ({ ...a, pg: pgmap.get(a.s.programmeId) }))
    .filter((a) => a.pg && a.s.date <= now);
  const first = new Map();
  for (const a of all) {
    if (!first.has(a.p.id) || a.s.date < first.get(a.p.id))
      first.set(a.p.id, a.s.date);
  }
  const isSenior = (p) => p.age !== null && p.age >= settings.seniorAge;
  const isMinority = (p) => settings.minority.includes(p.race);
  const base = all.filter(
    (a) =>
      (!filters.risk ||
        riskState(a.p, settings).categories.includes(filters.risk) ||
        riskState(a.p, settings).state === filters.risk) &&
      matchesSelection(filters.cfs, a.p.cfs) &&
      (!filters.weekday ||
        String(new Date(a.s.date + "T00:00:00Z").getUTCDay()) ===
          filters.weekday) &&
      (!filters.timeSlot ||
        (a.s.start < settings.timeBands[0]
          ? "Morning"
          : a.s.start < settings.timeBands[1]
            ? "Afternoon"
            : "Evening") === filters.timeSlot) &&
      (!filters.observed ||
        (filters.observed === "first"
          ? !filters.from || first.get(a.p.id) >= filters.from
          : filters.from && first.get(a.p.id) < filters.from)) &&
      (!filters.from || a.s.date >= filters.from) &&
      (!filters.to || a.s.date <= filters.to) &&
      matchesSelection(filters.domain, a.pg.domain) &&
      matchesSelection(filters.programme, a.pg.id) &&
      matchesSelection(filters.gender, a.p.gender) &&
      matchesSelection(filters.race, a.p.race) &&
      (!filters.client || String(a.p.client) === filters.client) &&
      (!filters.boundary || String(a.p.boundary) === filters.boundary) &&
      (!filters.ageBand ||
        (a.p.age !== null &&
          a.p.age >= Number(filters.ageBand.split("-")[0]) &&
          a.p.age <= Number(filters.ageBand.split("-")[1]))) &&
      (!filters.target ||
        filters.target === "all" ||
        (filters.target === "male" && isSenior(a.p) && a.p.gender === "MALE") ||
        (filters.target === "minority" && isSenior(a.p) && isMinority(a.p))),
  );
  if (selectionOnly === "rows") return base;
  if (selectionOnly) return new Set(base.map((a) => a.p.id));
  function stats(rows, scopeFrom = filters.from, scopeTo = filters.to) {
    const seniors = rows.filter((a) => isSenior(a.p)),
      people = [...new Map(seniors.map((a) => [a.p.id, a.p])).values()];
    const counts = new Map();
    for (const a of seniors) {
      if (!counts.has(a.p.id)) counts.set(a.p.id, new Set());
      counts.get(a.p.id).add(a.s.id);
    }
    const male = people.filter((p) => p.gender === "MALE").length,
      minority = people.filter(isMinority).length,
      knownGender = people.filter((p) =>
        ["MALE", "FEMALE"].includes(p.gender),
      ).length,
      knownRace = people.filter(
        (p) => !["UNKNOWN", "MISSING"].includes(p.race),
      ).length;
    const firstObserved = people.filter((p) => {
      const d = first.get(p.id);
      return (!scopeFrom || d >= scopeFrom) && (!scopeTo || d <= scopeTo);
    }).length;
    const participantProgrammes = new Map(),
      participantDomains = new Map();
    for (const a of seniors) {
      if (!participantProgrammes.has(a.p.id))
        participantProgrammes.set(a.p.id, new Set());
      if (!participantDomains.has(a.p.id))
        participantDomains.set(a.p.id, new Set());
      participantProgrammes.get(a.p.id).add(a.pg.id);
      participantDomains.get(a.p.id).add(a.pg.domain);
    }
    const repeat = [...counts.values()].filter((s) => s.size > 1).length;
    return {
      riskRecorded: people.filter(
        (p) => riskState(p, settings).state === "recorded",
      ).length,
      riskMissing: people.filter(
        (p) => riskState(p, settings).state === "missing",
      ).length,
      riskUnmapped: people.filter(
        (p) => riskState(p, settings).state === "unmapped",
      ).length,
      riskNoRisk: people.filter(
        (p) => riskState(p, settings).state === "no-risk",
      ).length,
      clientReach: people.filter((p) => p.client === true).length,
      nonClientReach: people.filter((p) => p.client === false).length,
      inBoundary: people.filter((p) => p.boundary === true).length,
      outBoundary: people.filter((p) => p.boundary === false).length,
      unique: people.length,
      male,
      minority,
      knownGender,
      knownRace,
      malePct: knownGender ? (male / knownGender) * 100 : null,
      minorityPct: knownRace ? (minority / knownRace) * 100 : null,
      unknownGender: people.length - knownGender,
      unknownRace: people.length - knownRace,
      missingRace: people.filter((p) => p.race === "MISSING").length,
      recordedUnknownRace: people.filter((p) => p.race === "UNKNOWN").length,
      attendance: rows.length,
      seniorAttendance: seniors.length,
      sessions: distinct(rows, (a) => a.s.id),
      repeat,
      firstObserved,
      returning: people.length - firstObserved,
      repeatRate: people.length ? (repeat / people.length) * 100 : null,
      multiProgramme: [...participantProgrammes.values()].filter(
        (s) => s.size > 1,
      ).length,
      multiDomain: [...participantDomains.values()].filter((s) => s.size > 1)
        .length,
      programmes: distinct(rows, (a) => a.pg.id),
      frequency: people.length ? seniors.length / people.length : 0,
      average: distinct(rows, (a) => a.s.id)
        ? rows.length / distinct(rows, (a) => a.s.id)
        : 0,
      allAges: distinct(rows, (a) => a.p.id),
    };
  }
  const summary = stats(base),
    seniors = base.filter((a) => isSenior(a.p));
  const previousFor = () => {
    let previous = null;
    if (!filters._noPrevious && filters.from && filters.to) {
      const from = new Date(filters.from + "T00:00:00Z"),
        to = new Date((filters.to < now ? filters.to : now) + "T00:00:00Z"),
        days = Math.round((to - from) / 86400000) + 1;
      const prevTo = new Date(+from - 86400000).toISOString().slice(0, 10),
        prevFrom = new Date(+from - days * 86400000).toISOString().slice(0, 10);
      if (all.some((a) => a.s.date <= prevFrom) && days > 0) {
        const prior = analytics(
          data,
          settings,
          { ...filters, from: prevFrom, to: prevTo, _noPrevious: true },
          now,
          true,
        );
        previous = { ...prior.summary, from: prevFrom, to: prevTo };
      }
    }
    return previous;
  };
  if (summaryOnly && summaryOnly !== "overview")
    return summaryOnly === "compare"
      ? { summary, previous: previousFor() }
      : { summary };
  const groupedRows = (rows, key) => {
    const map = new Map();
    for (const a of rows) {
      const k = key(a);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(a);
    }
    return map;
  };
  const group = (rows, key, unit) =>
    [...groupedRows(rows, key)].map(([label, r]) => {
      const bounds = unit
        ? periodBounds(label, unit)
        : [filters.from, filters.to];
      return { label, ...stats(r, ...bounds) };
    });
  const period = ["day", "week", "month", "quarter"].includes(filters.interval)
    ? filters.interval
    : "month";
  function periodBounds(label, unit) {
    const from =
      unit === "month"
        ? label + "-01"
        : unit === "quarter"
          ? `${label.slice(0, 4)}-${String((Number(label.at(-1)) - 1) * 3 + 1).padStart(2, "0")}-01`
          : label;
    const next = new Date(from + "T00:00:00Z");
    if (unit === "month" || unit === "quarter")
      next.setUTCMonth(next.getUTCMonth() + (unit === "quarter" ? 3 : 1));
    else next.setUTCDate(next.getUTCDate() + (unit === "week" ? 7 : 1));
    const to = new Date(+next - 86400000).toISOString().slice(0, 10);
    return [
      filters.from && filters.from > from ? filters.from : from,
      filters.to && filters.to < to ? filters.to : to,
    ];
  }
  const bucket = (date) => {
    if (period === "day") return date;
    if (period === "quarter")
      return date.slice(0, 4) + "-Q" + Math.ceil(Number(date.slice(5, 7)) / 3);
    if (period === "week") {
      const d = new Date(date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    return date.slice(0, 7);
  };
  let trends = group(base, (a) => bucket(a.s.date), period).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const start = filters.from || all.map((a) => a.s.date).sort()[0],
    end = filters.to && filters.to < now ? filters.to : now;
  if (start && start <= end) {
    const d = new Date(start + "T00:00:00Z");
    const keys = new Set(trends.map((t) => t.label));
    let guard = 0;
    while (d.toISOString().slice(0, 10) <= end && guard++ < 36600) {
      const key = bucket(d.toISOString().slice(0, 10));
      if (!keys.has(key)) {
        trends.push({ label: key, ...stats([]) });
        keys.add(key);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    trends.sort((a, b) => a.label.localeCompare(b.label));
  }
  trends = trends.map((t) => ({ ...t, partial: t.label === bucket(now) }));
  const programmes = [...groupedRows(base, (a) => a.pg.id)]
    .map(([label, r]) => {
      const g = { label, ...stats(r) },
        pg = pgmap.get(g.label),
        trend =
          summaryOnly === "overview"
            ? []
            : group(r, (a) => a.s.date.slice(0, 7), "month").sort((a, b) =>
                a.label.localeCompare(b.label),
              );
      const sessionList =
        summaryOnly === "overview"
          ? []
          : [...new Map(r.map((a) => [a.s.id, a.s])).values()].sort((a, b) =>
              a.date.localeCompare(b.date),
            ).map(s=>({...s,eventTypes:sessionEventTypes(s,settings)}));
      return {
        ...g,
        diagnostics: programmeDiagnostics(g, settings.reliability),
        id: pg.id,
        name: pg.name,
        domain: pg.domain,
        ...(summaryOnly==='overview'?{}:{eventTypes:[...new Set(sessionList.flatMap(s=>s.eventTypes||[]))]}),
        optional: pg.optional || {},
        trend,
        sessionList,
        recurring: g.sessions > 1,
      };
    })
    .sort((a, b) => b.unique - a.unique || a.name.localeCompare(b.name));
  if (summaryOnly === "overview")
    return {
      ...analyticsContext(data, settings, filters, now, summary),
      contextOnly: false,
      previous: previousFor(),
      trends,
      programmes: programmes.map((p) => ({ ...p, optional: {} })),
      domains: group(base, (a) => a.pg.domain),
    };
  const people = [...new Map(seniors.map((a) => [a.p.id, a.p])).values()];
  const breakdown = (fn) =>
    Object.entries(
      people.reduce((o, p) => {
        const k = fn(p);
        o[k] = (o[k] || 0) + 1;
        return o;
      }, {}),
    ).map(([label, value]) => ({ label, value }));
  const frequencies = new Map();
  for (const a of seniors) {
    if (!frequencies.has(a.p.id)) frequencies.set(a.p.id, new Set());
    frequencies.get(a.p.id).add(a.s.id);
  }
  const frequency = [
    {
      label: "Once · 1 session",
      value: [...frequencies.values()].filter((s) => s.size === 1).length,
    },
    {
      label: "Occasionally · 2–4 sessions",
      value: [...frequencies.values()].filter((s) => s.size >= 2 && s.size <= 4)
        .length,
    },
    {
      label: "Frequently · 5+ sessions",
      value: [...frequencies.values()].filter((s) => s.size >= 5).length,
    },
  ];
  const timing = group(
    base,
    (a) =>
      [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][new Date(a.s.date + "T00:00:00Z").getUTCDay()] +
      " · " +
      (a.s.start < settings.timeBands[0]
        ? "Morning"
        : a.s.start < settings.timeBands[1]
          ? "Afternoon"
          : "Evening"),
  );
  const recommendations = programmes.map((p) => {
    const evidence =
      p.sessions >= settings.minSessions && p.unique >= settings.minParticipants
        ? "Sufficient"
        : p.unique
          ? "Limited"
          : "Insufficient";
    // Only compare two fully observed calendar months, and require enough sessions in each.
    const full = p.trend.filter(
      (t) =>
        t.label < now.slice(0, 7) &&
        (!filters.from || filters.from <= t.label + "-01") &&
        (!filters.to ||
          filters.to >=
            new Date(
              Date.UTC(
                Number(t.label.slice(0, 4)),
                Number(t.label.slice(5, 7)),
                0,
              ),
            )
              .toISOString()
              .slice(0, 10)),
    );
    const recent = full.slice(-2);
    const decline =
      recent.length === 2 &&
      Number(recent[1].label.slice(0, 4)) * 12 +
        Number(recent[1].label.slice(5, 7)) -
        (Number(recent[0].label.slice(0, 4)) * 12 +
          Number(recent[0].label.slice(5, 7))) ===
        1 &&
      recent.every((t) => t.sessions >= settings.minSessions) &&
      recent[1].unique < recent[0].unique * 0.75;
    const demandConfirmed =
      p.optional.confirmedDemand === true &&
      typeof p.optional.demandSource === "string" &&
      p.optional.demandSource.trim() &&
      typeof p.optional.demandDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.optional.demandDate) &&
      Number.isFinite(Date.parse(p.optional.demandDate)) &&
      new Date(p.optional.demandDate).toISOString().slice(0, 10) ===
        p.optional.demandDate &&
      p.optional.demandDate <= now;
    const category =
      evidence !== "Sufficient"
        ? "Review"
        : decline
          ? "Improve"
          : p.unique >=
                Math.max(settings.minParticipants, summary.unique * 0.25) &&
              demandConfirmed
            ? "Expand"
            : "Maintain";
    const reason =
      evidence !== "Sufficient"
        ? "Evidence is limited; gather attendance and participant feedback before changing delivery."
        : decline
          ? "Reach fell by more than 25% between the last two complete observed months."
          : "Observed reach and repeat engagement support a planning discussion.";
    return {
      id: p.id,
      programme: p.name,
      category,
      target: "Seniors aged " + settings.seniorAge + "+",
      evidence,
      figures: `${p.unique} unique seniors · ${p.sessions} sessions · ${p.repeat} repeat participants`,
      reason,
      action:
        category === "Expand"
          ? "Assess an additional cycle or capacity."
          : category === "Improve"
            ? "Discuss attendance patterns and accessibility."
            : category === "Maintain"
              ? "Review continuing the current format."
              : "Collect more evidence before changing delivery.",
      next: "Check participant interest, staff availability and resources for the next 3–6 months.",
      limitations:
        "Attendance describes participation, not impact or causation. Cost, capacity, feedback and complete centre history are unavailable unless separately recorded.",
    };
  });
  const previous = previousFor();
  return {
    summary,
    socialRisk: {
      note: "Latest-known participant profile information; not historical assessments. Overlapping categories are not additive.",
      categories: [
        ...new Set(people.flatMap((p) => riskState(p, settings).categories)),
      ].map((label) => ({
        label,
        ...stats(
          base.filter((a) =>
            riskState(a.p, settings).categories.includes(label),
          ),
        ),
      })),
      states: ["recorded", "no-risk", "missing", "unmapped"].map((label) => ({
        label,
        ...stats(base.filter((a) => riskState(a.p, settings).state === label)),
      })),
    },
    previous,
    trends,
    programmes,
    domains: group(base, (a) => a.pg.domain),
    gender: breakdown((p) => p.gender),
    race: breakdown((p) => p.race),
    ages: breakdown((p) =>
      p.age < settings.ageBands[0]
        ? `${settings.seniorAge}–${settings.ageBands[0] - 1}`
        : p.age < settings.ageBands[1]
          ? `${settings.ageBands[0]}–${settings.ageBands[1] - 1}`
          : `${settings.ageBands[1]}+`,
    ),
    clients: breakdown((p) =>
      p.client === null
        ? "Unknown"
        : p.client
          ? "Existing client"
          : "Other attendee",
    ),
    boundary: breakdown((p) =>
      p.boundary === null
        ? "Unknown"
        : p.boundary
          ? "Within boundary"
          : "Outside boundary",
    ),
    frequency,
    timing,
    duration: group(base, (a) =>
      a.s.end - a.s.start < 45
        ? "Under 45 min"
        : a.s.end - a.s.start < 90
          ? "45–89 min"
          : "90+ min",
    ),
    insights: buildInsights({
      summary,
      previous,
      programmes,
      timing,
      recommendations,
      settings,
    }),
    recommendations,
    period: {
      from: filters.from || all.map((a) => a.s.date).sort()[0] || "",
      to: filters.to || now,
      now,
    },
    coverage: {
      from: all.map((a) => a.s.date).sort()[0] || null,
      to:
        all
          .map((a) => a.s.date)
          .sort()
          .at(-1) || null,
    },
    quality: {
      missingAge: data.participants.filter((p) => p.age === null).length,
      unknownGender: data.participants.filter(
        (p) => !["MALE", "FEMALE"].includes(p.gender),
      ).length,
      unknownRace: data.participants.filter((p) => p.race === "UNKNOWN").length,
      missingRace: data.participants.filter((p) => p.race === "MISSING").length,
      futureSessions: data.sessions.filter((s) => s.date > now).length,
      missingVenue: data.sessions.filter((s) => !s.venue).length,
    },
    options: {
      domains: [...new Set(data.programmes.map((p) => p.domain))].sort(),
      programmes: data.programmes.map((p) => ({ id: p.id, name: p.name })),
      races: [...new Set(data.participants.map((p) => p.race))].sort(),
      cfs: [
        ...new Set(data.participants.map((p) => p.cfs).filter(Boolean)),
      ].sort(),
    },
  };
}

// Codes are matched as complete strings. Multiple categories require an explicit mapping.
export function analyticsContext(
  data,
  settings = defaults,
  filters = {},
  now = todaySG(),
  summary,
) {
  settings = { ...defaults, ...settings };
  const sessionMap = new Map(data.sessions.map((s) => [s.id, s])),
    programmeIds = new Set(data.programmes.map((p) => p.id)),
    personIds = new Set(data.participants.map((p) => p.id));
  const dates = data.attendance
    .filter((a) => personIds.has(a.participantId))
    .map((a) => sessionMap.get(a.sessionId))
    .filter((s) => s && programmeIds.has(s.programmeId) && s.date <= now)
    .map((s) => s.date)
    .sort();
  return {
    ...(summary ? { summary } : analytics(data, settings, filters, now, true)),
    contextOnly: true,
    previous: null,
    trends: [],
    programmes: [],
    domains: [],
    gender: [],
    race: [],
    ages: [],
    clients: [],
    boundary: [],
    frequency: [],
    timing: [],
    duration: [],
    insights: [],
    recommendations: [],
    period: {
      from: filters.from || sourceCoverage(data, now)?.from || dates[0] || "",
      to: filters.to || now,
      now,
    },
    coverage: sourceCoverage(data, now) || { from: dates[0] || null, to: dates.at(-1) || null },
    quality: {
      missingAge: data.participants.filter((p) => p.age === null).length,
      unknownGender: data.participants.filter(
        (p) => !["MALE", "FEMALE"].includes(p.gender),
      ).length,
      unknownRace: data.participants.filter((p) => p.race === "UNKNOWN").length,
      missingRace: data.participants.filter((p) => p.race === "MISSING").length,
      futureSessions: data.sessions.filter((s) => s.date > now).length,
      missingVenue: data.sessions.filter((s) => !s.venue).length,
    },
    options: {
      domains: [...new Set(data.programmes.map((p) => p.domain))].sort(),
      programmes: data.programmes.map((p) => ({ id: p.id, name: p.name })),
      races: [...new Set(data.participants.map((p) => p.race))].sort(),
    },
  };
}
export function riskState(participant, settings = defaults) {
  const raw = participant.riskRaw;
  if (raw === undefined || raw === null || raw === "")
    return { state: "missing", categories: [] };
  const mapping = settings.riskMappings?.[raw];
  if (!mapping) return { state: "unmapped", categories: [] };
  if (mapping.noRisk) return { state: "no-risk", categories: [] };
  if (!mapping.categories?.length) return { state: "unmapped", categories: [] };
  return {
    state: "recorded",
    categories: settings.multipleRiskFactors
      ? [...new Set(mapping.categories)]
      : mapping.categories.slice(0, 1),
  };
}

export function matchesSelection(selected, value) {
  if (!selected) return true;
  if (!selected.startsWith("[")) return String(value) === selected;
  const choices = JSON.parse(selected);
  if (
    !Array.isArray(choices) ||
    choices.length > 50 ||
    choices.some((x) => typeof x !== "string")
  )
    throw Error("Invalid multi-select filter.");
  return choices.length === 0 || choices.includes(String(value));
}
