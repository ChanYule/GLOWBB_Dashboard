import { hash } from "./domain.js";

export const centreAddress =
  "GLOW (Bukit Batok), Block 212 Bukit Batok Street 21, #01-237, Singapore 650212";
export const locationStatuses = [
  "Verified",
  "Awaiting verification",
  "Ambiguous",
  "Unable to locate",
];
export const transportCategories = [
  "Distance to centre",
  "Transport difficulties",
  "Mobility or route accessibility concerns",
  "Difficulty using public transport",
  "Requires assistance travelling",
  "Programme venue difficult to access",
  "Other reported accessibility concern",
  "No reported transport barrier",
];
export const locationDefaults = () => ({
  centre: {
    id: "centre",
    address: centreAddress,
    block: "212",
    street: "Bukit Batok Street 21",
    postal: "650212",
    status: "Awaiting verification",
    lat: null,
    lon: null,
    source: "Address supplied by GLOW BB; coordinates require verification",
  },
  bands: [500, 1000, 2000],
  timeBands: [5, 10, 20],
  buildings: {},
  bindings: {},
  routes: {},
  geocodes: {},
  venues: {},
});
export const decodeLocations = (row) => ({
  revision: row?.revision || 0,
  ...locationDefaults(),
  ...(row?.value ? JSON.parse(row.value) : {}),
});
export const addressKey = (p) =>
  hash([
    String(p.blockRaw || "").trim(),
    String(p.street || p.profile?.basic?.street || "").trim(),
    String(p.postalCode || p.profile?.basic?.postalCode || "").trim(),
  ]);
export const buildingAddressKey = (p) =>
  hash(
    p?.postal
      ? ["postal", p.postal]
      : [
          "address",
          String(p?.block || "")
            .trim()
            .toUpperCase(),
          String(p?.street || "")
            .trim()
            .toUpperCase()
            .replace(/\s+/g, " "),
        ],
  );
const error = (message, status = 400) =>
  Object.assign(Error(message), { status });
export function buildingInput(input) {
  const { block = "", street = "", postal = "" } = input || {};
  if (
    ![block, street, postal].every(
      (s) =>
        typeof s === "string" &&
        s.length <= 180 &&
        !s.includes("#") &&
        ![...s].some((c) => c.codePointAt(0) < 32),
    ) ||
    (postal && !/^\d{6}$/.test(postal)) ||
    (!postal && (!block.trim() || !street.trim()))
  )
    throw error(
      "Enter a building block and street, or a six-digit postal code. Block numbers alone are not unique addresses. Do not include unit numbers.",
    );
  return { block: block.trim(), street: street.trim(), postal: postal.trim() };
}
export function validCoordinates(p) {
  return (
    typeof p?.lat === "number" &&
    typeof p?.lon === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= 1.1 &&
    p.lat <= 1.5 &&
    p.lon >= 103.5 &&
    p.lon <= 104.2
  );
}
export function validateLocation(input) {
  const address = buildingInput(input);
  if (!locationStatuses.includes(input.status))
    throw error("Choose a supported verification status.");
  if (
    input.status === "Verified" &&
    (!validCoordinates(input) ||
      input.confirm !== true ||
      typeof input.source !== "string" ||
      !input.source.trim() ||
      input.source.length > 500)
  )
    throw error(
      "Review and confirm Singapore building coordinates and record the verification source.",
    );
  return {
    ...address,
    address: [
      address.block,
      address.street,
      address.postal ? "Singapore " + address.postal : "",
    ]
      .filter(Boolean)
      .join(" "),
    status: input.status,
    lat: input.status === "Verified" ? input.lat : null,
    lon: input.status === "Verified" ? input.lon : null,
    source: String(input.source || "").slice(0, 500),
    verifiedAt: input.status === "Verified" ? new Date().toISOString() : null,
  };
}
export function validateBands(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(
      (n, i) =>
        Number.isFinite(n) && n > 0 && n <= 100000 && (!i || n > value[i - 1]),
    )
  )
    throw error("Enter three increasing positive band limits.");
  return value;
}
export const locationFingerprint = (p) =>
  hash([p?.id || "", p?.lat, p?.lon, p?.status, p?.address]);
export const routeKey = (building, target) =>
  hash([locationFingerprint(building), locationFingerprint(target)]);
export function straightDistance(a, b) {
  if (!validCoordinates(a) || !validCoordinates(b)) return null;
  const rad = (v) => (v * Math.PI) / 180,
    dlat = rad(b.lat - a.lat),
    dlon = rad(b.lon - a.lon);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return Math.round(
    6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))),
  );
}
export function distanceLabels(store, metric = "walking") {
  const limits = metric === "time" ? store.timeBands : store.bands;
  const unit = metric === "time" ? "minutes" : "metres";
  return [
    `0 to ${limits[0]} ${unit}`,
    `Over ${limits[0]} to ${limits[1]} ${unit}`,
    `Over ${limits[1]} to ${limits[2]} ${unit}`,
    `Over ${limits[2]} ${unit}`,
    metric === "time" ? "Walking time unknown" : "Distance unknown",
  ];
}
export function distanceBand(value, store, metric) {
  const labels = distanceLabels(store, metric),
    limits = metric === "time" ? store.timeBands : store.bands;
  if (value == null || !Number.isFinite(value) || value < 0) return labels[4];
  return labels[
    value <= limits[0] ? 0 : value <= limits[1] ? 1 : value <= limits[2] ? 2 : 3
  ];
}
export function locatedPerson(
  p,
  store,
  { distanceMetric = "walking", destination = "centre" } = {},
  now = Date.now(),
) {
  const binding = store.bindings[p.id],
    building = binding && store.buildings[binding.buildingId];
  const verified =
    building?.status === "Verified" &&
    validCoordinates(building) &&
    binding.sourceKey === addressKey(p) &&
    binding.buildingAddressKey === buildingAddressKey(building);
  const target =
    destination === "centre" ? store.centre : store.venues[destination];
  const targetValid = target?.status === "Verified" && validCoordinates(target);
  const route =
    verified && targetValid ? store.routes[routeKey(building, target)] : null;
  const walkingCurrent =
    route?.walkingM != null &&
    route.calculatedAt &&
    now - Date.parse(route.calculatedAt) <= 30 * 86400000 &&
    now >= Date.parse(route.calculatedAt);
  const value =
    !verified || !targetValid
      ? null
      : distanceMetric === "straight"
        ? (route?.straightM ?? straightDistance(building, target))
        : walkingCurrent
          ? distanceMetric === "time"
            ? route.timeSeconds == null
              ? null
              : route.timeSeconds / 60
            : route.walkingM
          : null;
  return {
    verified,
    status: verified
      ? "Verified"
      : building &&
          (binding.sourceKey !== addressKey(p) ||
            binding.buildingAddressKey !== buildingAddressKey(building))
        ? "Awaiting verification"
        : building?.status || "Awaiting verification",
    buildingId: verified ? building.id : null,
    blockLabel: verified
      ? building.address
      : `Block ${p.blockRaw || "unknown"}`,
    distance: value,
    band: distanceBand(value, store, distanceMetric),
    method:
      distanceMetric === "straight"
        ? "Straight-line distance (not a walking route)"
        : distanceMetric === "time"
          ? "Estimated walking-route duration"
          : "Walking-route distance",
    routeStatus: route?.status || "Not refreshed",
    calculatedAt: walkingCurrent ? route.calculatedAt : null,
  };
}
export function refreshStraightCache(store) {
  for (const building of Object.values(store.buildings))
    for (const target of [store.centre, ...Object.values(store.venues)]) {
      if (
        building.status !== "Verified" ||
        target.status !== "Verified" ||
        !validCoordinates(building) ||
        !validCoordinates(target)
      )
        continue;
      const key = routeKey(building, target);
      if (!store.routes[key])
        store.routes[key] = {
          buildingId: building.id,
          targetId: target.id,
          straightM: straightDistance(building, target),
          walkingM: null,
          timeSeconds: null,
          status: "Walking route not refreshed",
          source: "WGS84 haversine; straight-line only",
          calculatedAt: new Date().toISOString(),
        };
    }
}

// Client geography is deliberately kept out of the general dashboard settings.
export function publicLocationSummary(store) {
  return {
    centre: { address: store.centre.address, status: store.centre.status },
    bands: store.bands,
    timeBands: store.timeBands,
    destinations: [
      { id: "centre", label: "Selected centre reference location" },
      ...Object.values(store.venues)
        .filter((p) => p.status === "Verified")
        .map((p) => ({ id: p.id, label: p.venueName })),
    ],
    note: "Centre distance compares participation across all recorded venues. A selected programme venue includes only sessions with that exact recorded venue. Distance bands are adjustable reporting categories, not accessibility thresholds. Walking duration is a planning estimate, not a senior's personal journey or an accessibility assessment.",
  };
}
export function transportResponses(members, state, cutoff) {
  const byPerson = new Map();
  for (const row of state.feedback || []) {
    if (row.date > cutoff) continue;
    const detail = JSON.parse(row.details);
    if (!byPerson.has(row.participant_id)) byPerson.set(row.participant_id, []);
    byPerson.get(row.participant_id).push(
      ...(detail.barriers || []).map((b) => ({
        ...b,
        date: b.date || row.date,
      })),
    );
  }
  const counts = {
    reported: 0,
    noReportedBarrier: 0,
    notAssessed: 0,
    staffObserved: 0,
  };
  for (const p of members) {
    const entries = [
      ...(byPerson.get(p.id) || []),
      ...(p.profile?.barriers || []),
    ]
      .filter(
        (b) =>
          transportCategories.includes(b.category) ||
          ["Distance and transport", "Mobility limitations"].includes(
            b.category,
          ),
      )
      .filter((b) => b.date && b.date <= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = new Map(entries.map((b) => [b.category, b])),
      values = [...latest.values()];
    const sourced = values.filter((b) =>
      ["Participant-reported", "Caregiver-reported"].includes(b.source),
    );
    const positive = sourced
      .filter(
        (b) =>
          b.category !== "No reported transport barrier" &&
          ["Reported", "Assessed"].includes(b.status),
      )
      .map((b) => b.date)
      .sort()
      .at(-1);
    const negative = sourced
      .filter(
        (b) =>
          b.category === "No reported transport barrier" &&
          b.status === "Not present",
      )
      .map((b) => b.date)
      .sort()
      .at(-1);
    if (positive && (!negative || positive > negative)) counts.reported++;
    else if (negative && (!positive || negative > positive))
      counts.noReportedBarrier++;
    else counts.notAssessed++;
    if (
      values.some(
        (b) =>
          b.source === "Staff-observed" &&
          ["Reported", "Assessed"].includes(b.status),
      )
    )
      counts.staffObserved++;
  }
  return counts;
}
