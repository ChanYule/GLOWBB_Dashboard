export type RegistrationContext = {
  coverageStart: string;
  n_registered: number | null;
  n_participating: number | null;
  rate: number | null;
  lower: number | null;
  upper: number | null;
  excludedUnknown: number;
  excludedAfterStart: number;
};
export function registrationContext<
  T extends { registrationDate?: string | null },
>(
  people: T[],
  attended: (p: T) => boolean,
  coverageStart: string | null,
  available: boolean,
): RegistrationContext | null;
