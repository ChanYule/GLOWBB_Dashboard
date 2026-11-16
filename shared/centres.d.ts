export type Centre = {
  id: string;
  name: string;
  location: string;
  classification: string;
};
export const CENTRES: readonly Centre[];
export function centreById(id: string): Centre | null;
export function classifyCentre(
  location: unknown,
  activity: unknown,
  override?: { centreId: string; reason: string },
): {
  centreId: string | null;
  reason: string | null;
  overridden?: boolean;
  locationRaw: unknown;
  activityRaw: unknown;
};
