// Derived reporting only: never rewrite source fields or match programme names.
export const PROGRAMME_DOMAINS = Object.freeze([
  "Physical",
  "Cognitive",
  "Learning",
  "Social",
  "Volunteerism",
]);
// Explicitly authorised source spelling in the user's classification brief.
export const DOMAIN_ALIASES = Object.freeze({ volunterism: "Volunteerism" });
const key = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-SG");
const canonical = new Map(PROGRAMME_DOMAINS.map((name) => [key(name), name]));
const parts = (value) =>
  String(value ?? "")
    .split(/[&,]/)
    .map((v) => v.trim())
    .filter(Boolean);
export function activityDomains(primary, secondary = [], settings = {}) {
  const found = new Set();
  for (const source of [
    primary,
    ...(Array.isArray(secondary) ? secondary : [secondary]),
  ]) {
    const exact =
      settings.domainGroups?.[source] ??
      settings.eventTypeMappings?.[source]?.label;
    for (const token of parts(exact ?? source)) {
      const mapped =
        settings.domainGroups?.[token] ??
        settings.eventTypeMappings?.[token]?.label;
      for (const final of parts(mapped ?? token)) {
        const name = canonical.get(key(final)) || DOMAIN_ALIASES[key(final)];
        if (name) found.add(name);
      }
    }
  }
  return PROGRAMME_DOMAINS.filter((name) => found.has(name));
}
export function validDomainMapping(value) {
  return (
    typeof value === "string" &&
    parts(value).length > 0 &&
    parts(value).every(
      (v) => canonical.has(key(v)) || Object.hasOwn(DOMAIN_ALIASES, key(v)),
    )
  );
}
