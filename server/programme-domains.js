import {
  activityDomains,
  PROGRAMME_DOMAINS,
} from "../shared/activity-domains.js";
export { PROGRAMME_DOMAINS };
export function sourceClassification(session, programme) {
  const raw = session?.optional || {};
  return `AAP Domain: ${raw.aapDomainRaw ?? programme?.domain ?? "Not supplied"} | Event Type: ${raw.eventTypeRaw || "Not supplied"}`;
}
const DOMAIN_KEY = Symbol("programme-domain-definition");
const definitions = new WeakMap();
const definitionKey = (settings, refresh = false) => {
  const prior = definitions.get(settings);
  if (
    !refresh &&
    prior &&
    prior.domains === settings.domainGroups &&
    prior.types === settings.eventTypeMappings
  )
    return prior.key;
  const key = JSON.stringify([
    settings?.domainGroups || {},
    settings?.eventTypeMappings || {},
  ]);
  definitions.set(settings, {
    domains: settings.domainGroups,
    types: settings.eventTypeMappings,
    key,
  });
  return key;
};
export function sessionDomains(session, programme, settings = {}) {
  const version = definitionKey(settings);
  if (session?.[DOMAIN_KEY] === version) return session.combinedDomains;
  const raw = session?.optional || {};
  const primary = Object.hasOwn(raw, "aapDomainRaw")
    ? raw.aapDomainRaw
    : programme?.domain;
  return activityDomains(
    primary,
    raw.eventTypes ?? String(raw.eventTypeRaw ?? "").split(","),
    settings,
  );
}
export function combinedDomainData(data, settings = {}) {
  const version = definitionKey(settings, true);
  if (data[DOMAIN_KEY] === version) return data;
  const programmes = new Map(data.programmes.map((p) => [p.id, p]));
  const byProgramme = new Map();
  const sessions = data.sessions.map((s) => {
    const combinedDomains = sessionDomains(
      s,
      programmes.get(s.programmeId),
      settings,
    );
    if (!byProgramme.has(s.programmeId))
      byProgramme.set(s.programmeId, new Set());
    for (const domain of combinedDomains)
      byProgramme.get(s.programmeId).add(domain);
    return {
      ...s,
      combinedDomains,
      domainClassificationStatus: combinedDomains.length
        ? "Classified"
        : "Unclassified",
      [DOMAIN_KEY]: version,
    };
  });
  const value = {
    ...data,
    sessions,
    programmes: data.programmes.map((p) => ({
      ...p,
      combinedDomains: PROGRAMME_DOMAINS.filter((d) =>
        byProgramme.get(p.id)?.has(d),
      ),
    })),
    [DOMAIN_KEY]: version,
  };
  return value;
}
export function domainMatches(filter, session, programme, settings = {}) {
  if (!filter) return true;
  let values = filter;
  if (typeof values === "string" && values.startsWith("[")) {
    try {
      values = JSON.parse(values);
    } catch {
      return false;
    }
  }
  const selected = Array.isArray(values) ? values : [values];
  const domains = sessionDomains(session, programme, settings);
  return selected.some((value) =>
    activityDomains(value, [], settings).some((d) => domains.includes(d)),
  );
}
export function programmeDomains(sessions, programme, settings = {}) {
  const found = new Set(
    sessions.flatMap((s) => sessionDomains(s, programme, settings)),
  );
  return PROGRAMME_DOMAINS.filter((d) => found.has(d));
}
