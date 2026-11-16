export type OutreachRules = {
  noHistoryPoints: number;
  inactivePoints: number;
  noneInViewPoints: number;
  highCfsFrom: number;
  cfsPoints: number;
  alonePoints: number;
  srfPoints: number;
  gapPointsPer30: number;
  maxGapPoints: number;
  riskCodes: string[];
  watchPercent: number;
  fallbackWatchDays: number;
  typicalMinDates: number;
  recentRegistrationDays: number;
};
export const DEFAULT_OUTREACH_RULES: Readonly<OutreachRules>;
export const OUTREACH_RULE_FIELDS: [
  Exclude<keyof OutreachRules, "riskCodes">,
  string,
  number,
  number,
][];
export const OUTREACH_EXPORT_COLUMNS: string[];
export function validOutreachRules(value: unknown): value is OutreachRules;
export function outreachRules(value?: Partial<OutreachRules>): OutreachRules;
export function supportIndicators(
  person: object,
  settings: object,
  rules: OutreachRules,
): {
  indicators: { key: string; label: string; points: number }[];
  missingFields: string[];
};
export function priorityScore(
  person: object,
  settings: object,
  rules: OutreachRules,
  historyCurrent: boolean,
): {
  score: number;
  reasons: { key: string; label: string; points: number }[];
  indicators: string[];
  missingFields: string[];
  inactive: boolean;
  noHistory: boolean;
  noneInView: boolean;
  eligible: boolean;
};
export function lapsingWatch(
  person: object,
  dates: string[],
  rules: OutreachRules,
  historyCurrent: boolean,
): { typicalDays: number | null; thresholdDays: number; label: string } | null;
