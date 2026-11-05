export const populations: Record<
  string,
  {
    label: string;
    rates: boolean;
    registry: boolean;
    attendeesOnly: boolean;
    seniorOnly: boolean;
  }
>;
export const analysisDimensions: Record<string, string>;
export const patternKeys: string[];
export function compatibleAnalysis(
  scope: string,
  dimension: string,
  metric?: string,
): { scope: string; metric: string; notice: string };
export function normalizePatternPreferences(
  value?: unknown,
  today?: string,
): { query: Record<string, string>; changed: boolean };
