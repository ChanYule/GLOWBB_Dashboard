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
export function classifyCentre(location, activity, override) {
  const name = String(activity ?? "").trim();
  if (!name)
    return {
      centreId: null,
      reason: "Activity Name is missing.",
      locationRaw: location ?? "",
      activityRaw: activity ?? "",
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
    };
  }
  const normalized = String(location ?? "")
    .trim()
    .toLowerCase();
  const place =
    normalized === "bukit batok"
      ? "bukit_batok"
      : normalized === "nanyang"
        ? "nanyang"
        : null;
  const brand = /^GLOW(?=$|[^\p{L}\p{N}_])/iu.test(name) ? "glow" : "seen";
  return {
    centreId: place ? brand + "_" + place : null,
    reason: place
      ? null
      : "Centres must be Bukit Batok or Nanyang; missing, unknown or ambiguous values require review.",
    locationRaw: location ?? "",
    activityRaw: activity,
  };
}
