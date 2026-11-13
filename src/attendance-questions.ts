import type { Report } from "./patterns-ui";

export const attendanceQuestions = [
  { dimension: "cfs", question: "Do clients with higher CFS attend less?", action: "Review accessibility and support needs with clients before adapting activities." },
  { dimension: "block", question: "Does participation differ by residential block?", action: "Prioritise outreach in blocks with low participation; ask about access and transport barriers." },
  { dimension: "living", question: "Which living-arrangement groups are we reaching less?", action: "Check contact and support needs with these clients. Living alone does not establish loneliness." },
  { dimension: "risk", question: "Which social-risk groups are we reaching less?", action: "Review the recorded risk definitions and follow up on individual needs; codes are not an ordered risk scale." },
] as const;

const orderedCfs = ["CFS 1 to 3", "CFS 4", "CFS 5", "CFS 6", "CFS 7 to 8"];
const number = (n: number) => new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
const unknown = /missing|unknown|unverified|not assessed|not recorded|not available|unmapped|invalid/i;

// Use the existing protected aggregate report; never reconstruct withheld cells.
export function attendanceAnswer(report: Report) {
  const empty = (answer: string) => ({ answer, rows: [] as Report["groups"], note: "" });
  if (!report.registryComplete)
    return empty("Not yet answerable. Import and verify a complete client registry, including clients with no attendance.");
  if (!report.ratesAvailable)
    return empty("Not yet answerable. Recorded attendance history and a valid registered-client denominator are needed.");
  if (report.comparisonSuppressed)
    return empty("This comparison is unavailable under the current data-access rules. Withheld values are not zero.");
  const minimum = Math.max(5, report.minimum);
  const eligible = report.groups.filter(g => !g.suppressed && !unknown.test(g.label) &&
    (report.dimension !== "cfs" || orderedCfs.includes(g.label)) &&
    g.registered != null && g.registered >= minimum && g.rate != null && g.unique != null);
  const excluded = report.groups.length - eligible.length;
  const note = `Only known groups with at least ${minimum} registered clients are compared.${excluded ? ` ${excluded} group(s) excluded because records are missing, unrecognised, too small or withheld.` : ""} Differences are descriptive; age, programme mix and support needs may differ.`;
  if (eligible.length < 2)
    return { ...empty("Not enough comparable groups to answer reliably. Review missing profiles or use a broader period."), note };
  if (report.dimension === "cfs") {
    const rows = [...eligible].sort((a, b) => orderedCfs.indexOf(a.label) - orderedCfs.indexOf(b.label));
    const low = rows[0], high = rows[rows.length - 1];
    const gap = Math.round((high.rate! - low.rate!) * 10) / 10;
    return {
      answer: `${high.label} participation is ${number(high.rate!)}%, compared with ${number(low.rate!)}% for ${low.label}${gap === 0 ? " (equal recorded rates)." : ` (${number(Math.abs(gap))} percentage points ${gap < 0 ? "lower" : "higher"}).`} This compares the lowest and highest available CFS bands; it does not establish a trend or cause.`,
      rows,
      note,
    };
  }
  const rows = [...eligible].sort((a, b) => a.rate! - b.rate! || a.label.localeCompare(b.label));
  const low = rows[0], high = rows[rows.length - 1];
  return {
    answer: low.rate === high.rate
      ? `All ${rows.length} comparable groups have the same recorded participation rate (${number(low.rate!)}%).`
      : `${low.label} has the lowest recorded participation (${number(low.rate!)}%; ${low.unique} of ${low.registered} clients), compared with ${number(high.rate!)}% for ${high.label}. Review the group sizes before prioritising follow-up.`,
    rows,
    note,
  };
}
