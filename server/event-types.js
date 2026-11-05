export const EVENT_TYPE_HEADER = "Activity Name/Event Type";
export const UNCLASSIFIED = "Unclassified / unknown";
export function parseEventTypes(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function sessionEventTypes(session, settings = {}) {
  const source =
    session.optional?.eventTypes ||
    parseEventTypes(session.optional?.eventTypeRaw);
  return [
    ...new Set(
      source.map(
        (label) => settings.eventTypeMappings?.[label]?.label || label,
      ),
    ),
  ].sort();
}
export function eventTypeInventory(data, settings = {}) {
  const types = new Map();
  for (const s of data.sessions)
    for (const raw of s.optional?.eventTypes ||
      parseEventTypes(s.optional?.eventTypeRaw)) {
      if (!types.has(raw))
        types.set(raw, {
          raw,
          label: settings.eventTypeMappings?.[raw]?.label || raw,
          parent: settings.eventTypeMappings?.[raw]?.parent || "",
          secondary: settings.eventTypeMappings?.[raw]?.secondary || "",
          sessions: 0,
          review: /volunterism/i.test(raw),
        });
      types.get(raw).sessions++;
    }
  return [...types.values()].sort((a, b) => a.raw.localeCompare(b.raw));
}
