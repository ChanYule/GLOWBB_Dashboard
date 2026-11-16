import {
  clientPopulation,
  clientFollowupRows,
  validDay,
} from "./client-domain.js";
import {
  locationDefaults,
  locatedPerson,
  validCoordinates,
} from "./location-model.js";
export const qualityFields = {
  age: "Age",
  gender: "Gender",
  race: "Race",
  cfs: "CFS",
  living: "Living arrangement",
  block: "Recorded block",
  registration: "Registration date",
  address: "Address verification",
};
const recorded = (v) =>
  ["string", "number"].includes(typeof v) &&
  !/^\s*(unknown|missing|not recorded|not assessed|prefers not to say|unmapped|invalid age)?\s*$/i.test(
    String(v),
  );
export function fieldKnown(p, field, locations, asOf) {
  if (field === "address")
    return !!locatedPerson(p, locations || locationDefaults()).verified;
  if (field === "age")
    return (
      p.age !== null &&
      p.age !== "" &&
      typeof p.age !== "boolean" &&
      Number.isInteger(Number(p.age)) &&
      Number(p.age) >= 0 &&
      Number(p.age) <= 120
    );
  if (field === "registration")
    return validDay(p.registrationDate) && p.registrationDate <= asOf;
  if (field === "cfs") {
    const band = String(p.cfs ?? "")
      .trim()
      .match(/^(?:CFS\s*)?([1-8])(?:\s*(?:-|–|to)\s*([1-8]))?$/i);
    return (
      !!band &&
      (!band[2] || Number(band[1]) <= Number(band[2])) &&
      (!p.profile?.health?.cfsAssessedOn ||
        p.profile.health.cfsAssessedOn <= asOf)
    );
  }
  return recorded(
    p[{ living: "livingRaw", block: "blockRaw" }[field] || field],
  );
}
export function dataQualitySummary(people, locations, asOf) {
  const total = people.length,
    store = locations || locationDefaults();
  const rows = Object.entries(qualityFields).map(([field, label]) => {
    const known = people.filter((p) =>
      fieldKnown(p, field, store, asOf),
    ).length;
    return {
      field,
      label,
      total,
      known,
      missing: total - known,
      knownPercent: total ? (known / total) * 100 : null,
      missingPercent: total ? ((total - known) / total) * 100 : null,
    };
  });
  const address = rows.find((r) => r.field === "address");
  return {
    asOf,
    total,
    rows,
    verified: address.known,
    verifiedPercent: address.knownPercent,
    distanceReady:
      address.known > 0 &&
      store.centre.status === "Verified" &&
      validCoordinates(store.centre),
  };
}
export function dataQualityReport(state, input = {}, now) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !["asOf", "missingField", "page"].includes(k),
    )
  )
    throw Object.assign(Error("Choose supported data completeness filters."), {
      status: 400,
    });
  const { asOf = now, missingField = "", page = 0 } = input;
  if (
    !validDay(asOf) ||
    typeof missingField !== "string" ||
    asOf > now ||
    (missingField && !Object.hasOwn(qualityFields, missingField)) ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000
  )
    throw Object.assign(
      Error("Choose a valid completeness field, reporting date and page."),
      { status: 400 },
    );
  const people = clientPopulation(state, asOf),
    summary = dataQualitySummary(people, state.locations, asOf);
  const missingIds = new Set(
    missingField
      ? people
          .filter((p) => !fieldKnown(p, missingField, state.locations, asOf))
          .map((p) => p.id)
      : [],
  );
  const followups = missingField
    ? clientFollowupRows(state, { asOf }, now)
    : null;
  const rows = followups
    ? followups.rows.filter((p) => missingIds.has(p.id))
    : [];
  return {
    summary,
    missingField,
    page,
    pageSize: 25,
    total: rows.length,
    rows: rows.slice(page * 25, page * 25 + 25),
  };
}
