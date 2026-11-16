export type MatrixCell = {
  groups: string[];
  n_registered: number | null;
  n_participating: number | null;
  rate: number | null;
  lower: number | null;
  upper: number | null;
  small: boolean;
  unknown: boolean;
  eligible: boolean;
  belowOverall: boolean;
  supportIndicators: string[];
};
export type TwoFactorReport = {
  dimensions: string[];
  cautionMinimum: number;
  comparisonFloor: number;
  overall: {
    rate: number | null;
    lower: number | null;
    upper: number | null;
    n_registered: number | null;
    n_participating: number | null;
  } | null;
  status: "ready" | "withheld" | "unavailable";
  rows: string[];
  columns: string[];
  cells: MatrixCell[];
  findings: MatrixCell[];
  exclusions?: {
    small: number;
    belowFloor: number;
    unknown: number;
    unavailable: number;
  };
};
export function twoFactorAnalysis(input: {
  combined: null | {
    suppressed: boolean;
    rows: {
      groups: string[];
      unique?: number | null;
      registered?: number | null;
      rate?: number | null;
      supportIndicators?: string[];
    }[];
  };
  dimensions: string[];
  ratesAvailable: boolean;
  overall: TwoFactorReport["overall"];
  reliability?: { cautionMinimum?: number; comparisonFloor?: number };
}): TwoFactorReport | null;
