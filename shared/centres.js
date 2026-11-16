export const CENTRES = Object.freeze([
  {
    id: "glow_bukit_batok",
    name: "GLOW Bukit Batok",
    location: "Bukit Batok",
    classification: "GLOW",
  },
  {
    id: "seen_bukit_batok",
    name: "SEEN Bukit Batok",
    location: "Bukit Batok",
    classification: "SEEN",
  },
  {
    id: "glow_nanyang",
    name: "GLOW Nanyang",
    location: "Nanyang",
    classification: "GLOW",
  },
  {
    id: "seen_nanyang",
    name: "SEEN Nanyang",
    location: "Nanyang",
    classification: "SEEN",
  },
]);
export function centreById(id) {
  return CENTRES.find((c) => c.id === id) || null;
}
// Verified source location labels. SEEN within a venue label is not a service.
const locationAliases = new Map([
  ["bukit batok", "bukit_batok"],
  ["tzu chi seen @ bukit batok", "bukit_batok"],
  ["nanyang", "nanyang"],
  ["tzu chi seen @ nanyang", "nanyang"],
]);
export function normalizeCentreLocation(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s*@\s*/gu, " @ ")
    .toLowerCase();
  return locationAliases.get(normalized) || null;
}
export function classifyCentre(location, activity, override) {
  const name = String(activity ?? "").trim();
  const place = normalizeCentreLocation(location);
  if (!name)
    return {
      centreId: null,
      reason: "Activity Name is missing.",
      locationRaw: location ?? "",
      activityRaw: activity ?? "",
      location: place,
      service: null,
    };
  if (override) {
    const c = centreById(override.centreId);
    if (
      !c ||
      typeof override.reason !== "string" ||
      override.reason.trim().length < 5
    )
      throw Error("A valid centre and review reason are required.");
    return {
      centreId: c.id,
      reason: override.reason.trim(),
      overridden: true,
      locationRaw: location ?? "",
      activityRaw: activity,
      location: c.location === "Bukit Batok" ? "bukit_batok" : "nanyang",
      service: c.classification.toLowerCase(),
    };
  }
  const brand = /^GLOW(?=$|[^\p{L}\p{N}])/iu.test(name) ? "glow" : "seen";
  return {
    centreId: place ? brand + "_" + place : null,
    reason: place
      ? null
      : "Centre location is missing, unknown or ambiguous. Choose a verified Bukit Batok or Nanyang location, or review the source row.",
    locationRaw: location ?? "",
    activityRaw: activity,
    location: place,
    service: brand,
  };
}
