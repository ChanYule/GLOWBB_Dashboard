export type ReliabilityOptions = {
  cautionMinimum: number;
  comparisonFloor: number;
};
export type Proportion = {
  n_registered: number | null;
  n_participating: number | null;
  rate: number | null;
  lower: number | null;
  upper: number | null;
};
export type ReliabilityGroup = {
  label: string;
  registered?: number | null;
  unique?: number;
  rate?: number | null;
  suppressed?: boolean;
  pooled?: boolean;
  sourceLabels?: string[];
};
export type ReliableGroup = ReliabilityGroup &
  Proportion & { small: boolean; eligible: boolean };
export const DEFAULT_RELIABILITY: Readonly<ReliabilityOptions>;
export const CFS_ORDER: string[];
export function reliabilityOptions(
  value?: Partial<ReliabilityOptions>,
): ReliabilityOptions;
export function participationProportion(
  participating: unknown,
  registered: unknown,
): Proportion;
export function unknownGroup(label: string): boolean;
export function reliableGroup(
  group: ReliabilityGroup,
  options?: ReliabilityOptions,
): ReliableGroup;
export function sortGroups<T extends ReliabilityGroup>(
  groups: T[],
  order?: string,
  dimension?: string,
): T[];
export function poolSmallGroups(
  groups: ReliabilityGroup[],
  options?: ReliabilityOptions,
): (ReliabilityGroup & { sourceLabels: string[] }) | null;
export function comparisonInsight(
  groups: ReliabilityGroup[],
  config?: { dimension?: string; options?: ReliabilityOptions; pool?: boolean },
): {
  answer: string;
  note: string;
  rows: ReliableGroup[];
  eligibleCount: number;
  poolAvailable: boolean;
  pooled: ReturnType<typeof poolSmallGroups>;
  overlap: boolean | null;
};
