// Shared by the browser and server. Transport input is validated strictly;
// legacy saved preferences alone are safely normalized into this contract.
export const populations = {
  clients: {
    label: "Registered clients",
    rates: true,
    registry: true,
    attendeesOnly: false,
    seniorOnly: false,
  },
  overall: {
    label: "All attendance participants (all ages)",
    rates: false,
    registry: false,
    attendeesOnly: true,
    seniorOnly: false,
  },
  attendingClients: {
    label: "Registered clients with attendance",
    rates: false,
    registry: true,
    attendeesOnly: true,
    seniorOnly: false,
  },
  seniors: {
    label: "Senior participants aged 60+",
    rates: false,
    registry: false,
    attendeesOnly: true,
    seniorOnly: true,
  },
};
export const analysisDimensions = {
  age: "Age Group",
  cfs: "CFS",
  risk: "Social Risk Factor",
  race: "Race",
  gender: "Gender",
  living: "Living Arrangement",
  block: "Residential block",
  distance: "Location & Distance",
  eventType: "Event Type",
};
export const patternKeys = [
  "dimension",
  "scope",
  "from",
  "to",
  "domain",
  "group",
  "ranking",
  "second",
  "page",
  "all",
  "programme",
  "basis",
  "distanceMetric",
  "destination",
  "blockPage",
  "blockSearch",
  "blockSort",
  "stratum",
];
export function compatibleAnalysis(scope, dimension, metric = "unique") {
  const population = populations[scope] || populations.clients;
  const location = ["block", "distance", "locationBlock"].includes(dimension);
  return {
    scope: location
      ? "clients"
      : Object.hasOwn(populations, scope)
        ? scope
        : "clients",
    metric: metric === "rate" && !population.rates ? "unique" : metric,
    notice:
      location && scope !== "clients"
        ? "Residential analysis uses the full registered-client population. Other attendance analyses remain available."
        : metric === "rate" && !population.rates
          ? "Showing unique participants; client participation rates require the full registered-client population."
          : "",
  };
}
export function normalizePatternPreferences(value = {}, today = "9999-12-31") {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const query = {
    dimension: "age",
    scope: "clients",
    ranking: "unique",
    basis: "current",
  };
  for (const key of patternKeys)
    if (typeof source[key] === "string" && source[key].length <= 500)
      query[key] = source[key];
  if (source.preset === "overall" && !source.scope) query.scope = "overall";
  if (!Object.hasOwn(analysisDimensions, query.dimension))
    query.dimension = "age";
  if (!Object.hasOwn(populations, query.scope)) query.scope = "clients";
  if (!["unique", "attendance", "repeat"].includes(query.ranking))
    query.ranking = "unique";
  if (!["current", "dated"].includes(query.basis)) query.basis = "current";
  for (const key of ["from", "to"])
    if (
      query[key] &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(query[key]) ||
        !Number.isFinite(Date.parse(query[key])) ||
        new Date(query[key]).toISOString().slice(0, 10) !== query[key] ||
        query[key] > today)
    )
      delete query[key];
  if (query.from && query.to && query.from > query.to) {
    delete query.from;
    delete query.to;
  }
  if (
    query.second &&
    (!Object.hasOwn(analysisDimensions, query.second) ||
      query.second === query.dimension ||
      query.second === "eventType")
  )
    delete query.second;
  for (const key of ["page", "blockPage"])
    if (
      query[key] &&
      (!/^\d{1,5}$/.test(query[key]) || Number(query[key]) > 10000)
    )
      delete query[key];
  if (query.all && query.all !== "1") delete query.all;
  if (
    query.distanceMetric &&
    !["walking", "straight", "time"].includes(query.distanceMetric)
  )
    delete query.distanceMetric;
  if (query.destination && !/^[a-zA-Z0-9-]{1,100}$/.test(query.destination))
    delete query.destination;
  if (
    query.blockSort &&
    !["low", "high", "noAttendance", "distance", "registered"].includes(
      query.blockSort,
    )
  )
    delete query.blockSort;
  query.scope = compatibleAnalysis(query.scope, query.dimension).scope;
  if (query.second)
    query.scope = compatibleAnalysis(query.scope, query.second).scope;
  // A saved younger-attendee selection must not be trapped in a client-only
  // denominator. This changes only the view, never a person's client status.
  if (query.dimension === 'age' && query.group === 'Below 60' && query.scope !== 'overall') {
    query.scope = 'overall';
    delete query.second;
    delete query.stratum;
    delete query.programme;
    delete query.page;
  }
  const changed = Object.entries(source).some(
    ([k, v]) => !patternKeys.includes(k) || query[k] !== v,
  );
  return { query, changed };
}
