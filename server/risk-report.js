import {sessionDomains,programmeDomains} from './programme-domains.js';
import { defaults, riskState, todaySG } from "./domain.js";

// A fixed release uses equivalence classes across every profile/filter field and
// exact delivered-session membership. No permitted general filter can split an
// equivalence class. All protected tables are released or withheld together.
// This is deliberately conservative, not a claim of differential privacy.
export function protectedRiskReport(
  data,
  configured = defaults,
  now = todaySG(),
) {
  const settings = { ...defaults, ...configured };
  const people = new Map(data.participants.map((p) => [p.id, p]));
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const programmes = new Map(data.programmes.map((p) => [p.id, p]));
  const byPerson = new Map();
  for (const a of data.attendance) {
    const p = people.get(a.participantId),
      s = sessions.get(a.sessionId),
      pg = programmes.get(s?.programmeId);
    if (
      !p ||
      !s ||
      !pg ||
      s.date > now ||
      p.age == null ||
      p.age < settings.seniorAge
    )
      continue;
    if (!byPerson.has(p.id)) byPerson.set(p.id, []);
    byPerson.get(p.id).push({ ...a, p, s, pg });
  }
  const atoms = new Map();
  for (const [id, rows] of byPerson) {
    const p = people.get(id),
      risk = riskState(p, settings);
    const signature = JSON.stringify([
      p.age,
      p.gender,
      p.race,
      p.cfs ?? null,
      p.client,
      p.boundary,
      risk.state,
      [...risk.categories].sort(),
      [...new Set(rows.map((a) => a.s.id))].sort(),
    ]);
    atoms.set(signature, (atoms.get(signature) || 0) + 1);
  }
  const suppressed = [...atoms.values()].some(
    (n) => n < settings.privacyMinimum,
  );
  const limited = [...byPerson.keys()].every((id) =>
    ["missing", "unmapped"].includes(riskState(people.get(id), settings).state),
  );
  const note = settings.staffAnalysisFull?'Staff analysis includes all recorded group counts in the available delivered-attendance cohort. Categories can overlap and are not additive. Unknown codes require source review; classifications are not historical assessments.':
    "Latest-known profile classifications across the full available delivered-attendance cohort. Global filters do not apply. Categories may overlap and must not be added. All protected tables are withheld together unless each group sharing recorded profile fields and exact attendance membership meets the privacy minimum. Arbitrary risk queries and downloads are restricted. Updated imports can change this snapshot; this is not historical assessment data.";
  const base = {
    suppressed,
    limited,
    note,
    threshold: settings.privacyMinimum,
    categories: [],
    states: [],
    programmes: [],
    demographics: [],
    insights: [],
    completion: null,
  };
  if (suppressed) return base;
  const rows = [...byPerson.values()].flat();
  const stats = (items) => {
    const counts = new Map();
    for (const a of items) {
      if (!counts.has(a.p.id)) counts.set(a.p.id, new Set());
      counts.get(a.p.id).add(a.s.id);
    }
    const unique = counts.size,
      sessions = new Set(items.map((a) => a.s.id)).size,
      repeat = [...counts.values()].filter((s) => s.size > 1).length;
    return {
      unique,
      attendance: items.length,
      sessions,
      averagePerParticipant: unique ? items.length / unique : null,
      repeat,
      repeatRate: unique ? (repeat / unique) * 100 : null,
      once: unique - repeat,
    };
  };
  const states = ["recorded", "no-risk", "missing", "unmapped"].map(
    (label) => ({
      label,
      ...stats(rows.filter((a) => riskState(a.p, settings).state === label)),
    }),
  );
  const labels = [
    ...new Set(rows.flatMap((a) => riskState(a.p, settings).categories)),
  ].sort();
  const categories = labels.map((label) => ({
    label,
    ...stats(
      rows.filter((a) => riskState(a.p, settings).categories.includes(label)),
    ),
  }));
  const rankings = [],
    demographics = [],
    insights = [];
  const ageBand = (p) =>
    p.age < settings.ageBands[0]
      ? `${settings.seniorAge}–${settings.ageBands[0] - 1}`
      : p.age < settings.ageBands[1]
        ? `${settings.ageBands[0]}–${settings.ageBands[1] - 1}`
        : `${settings.ageBands[1]}+`;
  for (const category of labels) {
    const selected = rows.filter((a) =>
      riskState(a.p, settings).categories.includes(category),
    );
    const byProgramme = new Map();
    for (const a of selected) {
      if (!byProgramme.has(a.pg.id)) byProgramme.set(a.pg.id, []);
      byProgramme.get(a.pg.id).push(a);
    }
    for (const [id, items] of byProgramme)
      rankings.push({
        category,
        programme: programmes.get(id).name,
        domain: programmeDomains([...new Map(items.map(a=>[a.s.id,a.s])).values()],programmes.get(id),settings).join(', '),
        ...stats(items),
      });
    for (const [dimension, key] of Object.entries({
      Gender: (a) => a.p.gender,
      "Age band": (a) => ageBand(a.p),
      Race: (a) => a.p.race,
      "Client status": (a) =>
        a.p.client === null
          ? "Unknown"
          : a.p.client
            ? "Existing client"
            : "Non-client",
      "Service boundary": (a) =>
        a.p.boundary === null
          ? "Unknown"
          : a.p.boundary
            ? "Within boundary"
            : "Outside boundary",
      "Programme Domain": (a) => sessionDomains(a.s,a.pg,settings),
    })) {
      const grouped = new Map();
      for (const a of selected) {
        for(const label of [key(a)].flat()){
        if (!grouped.has(label)) grouped.set(label, []);
        grouped.get(label).push(a);
        }
      }
      for (const [label, items] of grouped)
        demographics.push({ category, dimension, label, ...stats(items) });
    }
    const s = stats(selected);
    if (
      s.sessions >= settings.minSessions &&
      s.unique >= settings.minParticipants
    )
      insights.push({
        category,
        action: s.repeatRate < 50 ? "Review" : "Maintain",
        figures: `${s.unique} seniors across ${s.sessions} recorded sessions; ${s.repeat} attended multiple sessions`,
        explanation:
          s.repeatRate < 50
            ? "Fewer than half attended multiple sessions in the available records. Check programme availability, access barriers and incomplete history before interpreting participation."
            : "At least half attended multiple sessions in the available records. Review participant feedback and programme availability alongside this observed engagement.",
        followUp:
          "Discuss interests, access needs and available resources with authorised staff; attendance is not a diagnosis or evidence of causation.",
      });
  }
  const completed = states
    .filter((s) => ["recorded", "no-risk"].includes(s.label))
    .reduce((n, s) => n + s.unique, 0);
  return {
    ...base,
    categories,
    states,
    programmes: rankings.sort((a, b) => b.unique - a.unique),
    demographics,
    insights,
    completion: {
      completed,
      total: byPerson.size,
      percent: byPerson.size ? (completed / byPerson.size) * 100 : null,
    },
  };
}
