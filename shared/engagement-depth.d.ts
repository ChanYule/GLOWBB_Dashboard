export type EngagementOptions = { regularFrom: number };
export type EngagementCell = {
  id: string;
  label: string;
  count: number;
  percentage: number | null;
};
export type EngagementSummary = {
  population: number;
  depth: EngagementCell[];
  recency: EngagementCell[];
};
export type EngagementMetadata = EngagementOptions & {
  anchor: string | null;
  historyFrom: string | null;
};
export const DEFAULT_ENGAGEMENT: Readonly<EngagementOptions>;
export function engagementOptions(
  value?: Partial<EngagementOptions> | null,
): EngagementOptions;
export function recencyBucket(last: unknown, anchor: unknown): string;
export function depthSegment(
  sessions: unknown,
  last: unknown,
  anchor: unknown,
  options?: EngagementOptions,
): string;
export function engagementLabels(options?: EngagementOptions): {
  depth: { id: string; label: string }[];
  recency: { id: string; label: string }[];
};
export function summariseEngagement(
  records: { sessions?: number; last?: string | null }[],
  anchor: string | null,
  options?: EngagementOptions,
): EngagementSummary | null;
