export const PROGRAMME_DOMAINS: readonly string[];
export const DOMAIN_ALIASES: Readonly<Record<string, string>>;
export function activityDomains(
  primary?: string | null,
  secondary?: readonly string[] | string | null,
  settings?: {
    domainGroups?: Record<string, string>;
    eventTypeMappings?: Record<string, { label?: string }>;
  },
): string[];
export function validDomainMapping(value: unknown): boolean;
