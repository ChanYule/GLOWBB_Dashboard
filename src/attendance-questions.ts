import type { Report } from "./patterns-ui";
import {
  comparisonInsight,
  reliabilityOptions,
} from "../shared/participation-reliability.js";

export const attendanceQuestions = [
  {
    dimension: "cfs",
    question: "Do clients with higher CFS attend less?",
    action:
      "Review accessibility and support needs with clients before adapting activities.",
  },
  {
    dimension: "block",
    question: "Does participation differ by residential block?",
    action:
      "Prioritise outreach in blocks with low participation; ask about access and transport barriers.",
  },
  {
    dimension: "living",
    question: "Which living-arrangement groups are we reaching less?",
    action:
      "Check contact and support needs with these clients. Living alone does not establish loneliness.",
  },
  {
    dimension: "risk",
    question: "Which social-risk groups are we reaching less?",
    action:
      "Review the recorded risk definitions and follow up on individual needs; codes are not an ordered risk scale.",
  },
] as const;

// Use only released aggregate groups. Visibility and comparison eligibility differ.
export function attendanceAnswer(report: Report, pool = false) {
  const empty = (answer: string) => ({
    answer,
    rows: [] as ReturnType<typeof comparisonInsight>["rows"],
    note: "",
    eligibleCount: 0,
    poolAvailable: false,
    pooled: null,
    overlap: null,
  });
  if (!report.registryComplete)
    return empty(
      "Not yet answerable. Import and verify a complete client registry, including clients with no attendance.",
    );
  if (!report.ratesAvailable)
    return empty(
      "Not yet answerable. Recorded attendance history and a valid registered-client denominator are needed.",
    );
  if (report.comparisonSuppressed)
    return empty(
      "This comparison is unavailable under the current data-access rules. Withheld values are not zero.",
    );
  return comparisonInsight(report.groups, {
    dimension: report.dimension,
    options: reliabilityOptions(report.reliability),
    pool,
  });
}
