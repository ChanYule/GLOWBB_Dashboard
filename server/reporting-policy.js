import { AsyncLocalStorage } from "node:async_hooks";
import { sessionEventTypes } from "./event-types.js";
import { isReportingPath } from "../shared/reporting-paths.js";
export const reportingContext = new AsyncLocalStorage();
const POLICY = Symbol("reporting-policy"),
  LAYER = Symbol("reporting-layer");
export const reportingDefaults = () => ({
  version: 1,
  rules: [],
  qualityWarnings: {
    cfs: true,
    srf: true,
    living: true,
    domain: true,
    eventType: true,
  },
  sync: {
    connected: false,
    categories: ["attendance"],
    mode: "all",
    from: "",
    to: "",
  },
});
export const reportingConfiguration = (settings) => ({
  ...reportingDefaults(),
  ...settings?.reporting,
  rules: settings?.reporting?.rules || [],
});
export function matchesActivity(
  programme,
  sessions,
  selector = {},
  settings = {},
) {
  const text = String(selector.value || "")
      .trim()
      .toLocaleLowerCase("en-SG"),
    name = programme.name.trim().toLocaleLowerCase("en-SG");
  if (selector.ids?.length) return selector.ids.includes(programme.id);
  switch (selector.type) {
    case "name":
      return name === text;
    case "contains":
      return name.includes(text);
    case "prefix":
      return name.startsWith(text);
    case "domain":
      return programme.domain.toLocaleLowerCase("en-SG") === text;
    case "eventType":
      return sessions.some((s) =>
        sessionEventTypes(s, settings).some(
          (t) => t.toLocaleLowerCase("en-SG") === text,
        ),
      );
    case "service":
      return (
        settings.centreId?.startsWith(text + "_") ||
        sessions.some(
          (s) =>
            s.optional?.centreClassification?.service === text ||
            s.optional?.centreClassification?.centreId?.startsWith(text + "_"),
        )
      );
    case "flag":
      return (
        programme.optional?.reportingFlag === text ||
        sessions.some((s) => s.optional?.reportingFlag === text)
      );
    case "all":
      return true;
    default:
      return false;
  }
}
export function matchingActivities(data, selector, settings) {
  const sessions = new Map();
  for (const s of data.sessions) {
    if (!sessions.has(s.programmeId)) sessions.set(s.programmeId, []);
    sessions.get(s.programmeId).push(s);
  }
  return data.programmes.filter((p) =>
    matchesActivity(p, sessions.get(p.id) || [], selector, settings),
  );
}
function project(data, context, layer) {
  if (!context) return data;
  const config = reportingConfiguration(context.settings),
    byProgramme = new Map();
  for (const rule of config.rules) {
    if (
      rule.enabled === false ||
      rule.status !== "Approved" ||
      rule.scope === "review"
    )
      continue;
    if (rule.scope === "report" && rule.reportId !== context.reportId) continue;
    if (context.mode === "exploratory" && context.includeExcluded) continue;
    if (layer !== "performance" && rule.scope === "performance") continue;
    for (const id of rule.approvedIds || []) {
      if (!byProgramme.has(id)) byProgramme.set(id, []);
      byProgramme.get(id).push(rule);
    }
  }
  const custom = new Set(context.customExcludes || []),
    excluded = new Set();
  for (const s of data.sessions)
    if (
      custom.has(s.programmeId) ||
      (byProgramme.get(s.programmeId) || []).some(
        (r) => (!r.from || s.date >= r.from) && (!r.to || s.date <= r.to),
      )
    )
      excluded.add(s.id);
  const sessions = data.sessions.filter((s) => !excluded.has(s.id)),
    kept = new Set(sessions.map((s) => s.programmeId)),
    had = new Set(data.sessions.map((s) => s.programmeId));
  const attended = new Set(data.attendance.map((a) => a.sessionId)),
    dates = [
      ...new Set(
        data.sessions.filter((s) => attended.has(s.id)).map((s) => s.date),
      ),
    ].sort();
  const source = data[POLICY]?.source || {
    attendance: data.attendance.length,
    sessions: data.sessions.length,
    dates,
  };
  return {
    ...data,
    programmes: data.programmes.filter((p) => kept.has(p.id) || !had.has(p.id)),
    sessions,
    attendance: data.attendance.filter((a) => !excluded.has(a.sessionId)),
    [POLICY]: { ...context, source },
    [LAYER]: layer,
  };
}
export const projectReportingData = (
  data,
  context = reportingContext.getStore(),
) => project(data, context, "official");
export function performanceData(data) {
  const context = data[POLICY];
  return context &&
    data[LAYER] !== "performance" &&
    reportingConfiguration(context.settings).rules.some(
      (r) =>
        r.enabled !== false &&
        r.scope === "performance" &&
        r.approvedIds?.length,
    )
    ? project(data, context, "performance")
    : data;
}
export function sourceCoverage(
  data,
  now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
) {
  const source = data[POLICY]?.source;
  if (!source) return null;
  const dates = source.dates.filter((d) => d <= now);
  return { from: dates[0] || null, to: dates.at(-1) || null };
}
export function policySummary(context = reportingContext.getStore()) {
  if (!context) return null;
  return {
    version: reportingConfiguration(context.settings).version,
    mode: context.mode || "official",
    label:
      context.mode === "exploratory"
        ? "Custom exploratory analysis"
        : "Official reporting",
    reportId: context.reportId || null,
    note: "Reporting exclusions do not delete source records. Unique reach is recalculated from eligible attendance. No recorded attendance in reporting metrics means no eligible attendance in available history.",
  };
}
const mapResult = (value, map) => (value?.then ? value.then(map) : map(value));
export function reportingStorage(storage) {
  const wrapped = {
    ...storage,
    readData: (db) =>
      mapResult(storage.readData(db), (d) => projectReportingData(d)),
    getSettings: (db) =>
      reportingContext.getStore()?.settings || storage.getSettings(db),
  };
  if (storage.readPlanningState)
    wrapped.readPlanningState = (db) =>
      mapResult(storage.readPlanningState(db), (s) => ({
        ...s,
        data: projectReportingData(s.data),
        settings: reportingContext.getStore()?.settings || s.settings,
      }));
  return wrapped;
}
export function isReportingRequest(req) {
  return isReportingPath(req.path, req.method);
}
