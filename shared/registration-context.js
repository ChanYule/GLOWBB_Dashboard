import { participationProportion } from "./participation-reliability.js";
export function registrationContext(
  people,
  attended,
  coverageStart,
  available,
) {
  if (!available || !coverageStart) return null;
  const known = (p) =>
    typeof p.registrationDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.registrationDate) &&
    Number.isFinite(Date.parse(p.registrationDate)) &&
    new Date(p.registrationDate).toISOString().slice(0, 10) ===
      p.registrationDate;
  const cohort = people.filter(
    (p) => known(p) && p.registrationDate <= coverageStart,
  );
  return {
    coverageStart,
    ...participationProportion(
      cohort.filter((p) => attended(p)).length,
      cohort.length,
    ),
    excludedUnknown: people.filter((p) => !known(p)).length,
    excludedAfterStart: people.filter(
      (p) => known(p) && p.registrationDate > coverageStart,
    ).length,
  };
}
