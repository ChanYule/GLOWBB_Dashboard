import {combinedDomainData,sessionDomains,domainMatches,programmeDomains,PROGRAMME_DOMAINS} from './programme-domains.js';
import {performanceData} from './reporting-policy.js';
import { defaults, todaySG } from "./domain.js";
import {populations} from '../shared/participation-compat.js';
import { clientPopulation, validDay } from "./client-domain.js";
import { materializeProfiles } from "./needs-domain.js";
import { patternLabel } from "./patterns.js";
import { engagementOptions, summariseEngagement } from '../shared/engagement-depth.js';
import { locationDefaults, locatedPerson } from "./location-model.js";
import { sessionEventTypes, UNCLASSIFIED } from "./event-types.js";
const fail = (m) => Object.assign(Error(m), { status: 400 });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
export function validateEventQuery(input = {}) {
  const allowed = [
    "from",
    "to",
    "domain",
    "eventType",
    "factor",
    "group",
    "scope",
    "target",
    "gender",
    "race",
    "ageBand",
    "cfs",
    "client",
    "boundary",
    "programme",
    "ranking",
    "page",
    "all",
    "distanceMetric",
    "destination",
    "selectedDomain",
  ];
  for (const [k, v] of Object.entries(input))
    if (!allowed.includes(k) || typeof v !== "string" || v.length > 500)
      throw fail("Choose supported programme-type filters.");
  const q = { scope: "overall", target: "senior", ranking: "unique", ...input };
  for (const key of ["from", "to"])
    if (q[key] && (!validDay(q[key]) || q[key] > todaySG()))
      throw fail("Choose a delivered reporting period.");
  if (q.from && q.to && q.from > q.to)
    throw fail("Reporting dates are reversed.");
  if (
    !Object.hasOwn(populations,q.scope) ||
    !["senior", "all", "male", "minority"].includes(q.target) ||
    !["unique", "attendance", "repeat", "average"].includes(q.ranking)
  )
    throw fail("Choose supported population and ranking options.");
  if (
    q.factor &&
    ![
      "age",
      "gender",
      "race",
      "cfs",
      "risk",
      "living",
      "distance",
      "participation",
      "block",
    ].includes(q.factor)
  )
    throw fail("Choose one supported comparison factor.");
  if (
    q.distanceMetric &&
    !["walking", "straight", "time"].includes(q.distanceMetric)
  )
    throw fail("Choose a supported distance measure.");
  if (q.destination && !/^[a-zA-Z0-9-]{1,100}$/.test(q.destination))
    throw fail("Choose a verified destination.");
  if (q.page && (!/^\d+$/.test(q.page) || Number(q.page) > 10000))
    throw fail("Choose a valid page.");
  if (q.all && q.all !== "1") throw fail("Choose a valid list size.");
  return q;
}
export function eventTypeReport(state, input = {}, now = todaySG(), combined = false) {
  state={...state,data:performanceData(state.data)};
  if(combined)state={...state,data:combinedDomainData(state.data,state.settings)};
  const q = validateEventQuery(input),
    settings = { ...defaults, ...state.settings },
    minimum = settings.staffAnalysisFull ? 0 : Math.max(5, settings.privacyMinimum || 5);
  const data = materializeProfiles(state.data, state.profiles || []);
  const clients = clientPopulation(
    {
      ...state,
      feedback: state.feedback || [],
      profiles: state.profiles || [],
    },
    q.to || now,
  );
  const people = new Map(data.participants.map((p) => [p.id, p]));
  for (const p of clients) people.set(p.id, p);
  const programmes = new Map(data.programmes.map((p) => [p.id, p]));
  const allSessions = new Map(
    data.sessions
      .filter((s) => s.date <= now && programmes.has(s.programmeId))
      .map((s) => [s.id, s]),
  );
  const sourceLabels=s=>combined?sessionDomains(s,programmes.get(s.programmeId),settings):sessionEventTypes(s,settings);
  const labelsFor=s=>{const labels=sourceLabels(s);return labels.length?labels:combined?[]:[UNCLASSIFIED];};
  const rankDomain=q.selectedDomain||PROGRAMME_DOMAINS[0];
  if(combined&&!PROGRAMME_DOMAINS.includes(rankDomain))throw fail("Choose one of the five Programme Domains.");
  const history = new Map(),
    attendees = new Set(),
    seen = new Set();
  for (const a of data.attendance) {
    if (!allSessions.has(a.sessionId) || !people.has(a.participantId)) continue;
    const key = a.participantId + ":" + a.sessionId;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!history.has(a.participantId)) history.set(a.participantId, new Set());
    history.get(a.participantId).add(a.sessionId);
  }
  const sessions = [...allSessions.values()].filter(
    (s) =>
      (!q.from || s.date >= q.from) &&
      (!q.to || s.date <= q.to) &&
      (combined?domainMatches(q.domain,s,programmes.get(s.programmeId),settings):!q.domain || programmes.get(s.programmeId).domain === q.domain) &&
      (!q.programme || s.programmeId === q.programme),
  );
  const historyDates = [...allSessions.values()].map(s => s.date).sort();
  const engagementConfig = engagementOptions(settings.engagement);
  const engagementAnchor = historyDates.at(-1) || null;
  const lastHistory = new Map([...history].map(([id, ids]) => [id, [...ids].reduce((last, sid) => !last || allSessions.get(sid).date > last ? allSessions.get(sid).date : last, null)]));
  const selectedSessions = new Set(
    sessions
      .filter(
        (s) =>
          !q.eventType ||
          labelsFor(s).includes(q.eventType),
      )
      .map((s) => s.id),
  );
  for (const [id, ids] of history)
    if ([...ids].some((s) => selectedSessions.has(s))) attendees.add(id);
  const locationStore = state.locations || locationDefaults();
  const factorLabel = (p) =>
    q.factor === "distance"
      ? locatedPerson(p, locationStore, q).band
      : q.factor === "participation"
        ? attendees.has(p.id)
          ? "With recorded attendance"
          : "No recorded attendance"
        : patternLabel(p, q.factor || "age", settings);
  let base = ['clients','attendingClients'].includes(q.scope) ? clients : [...people.values()];
  if(q.scope==='attendingClients')base=base.filter(p=>attendees.has(p.id));
  if(q.scope==='seniors')base=base.filter(p=>typeof p.age==='number'&&p.age>=60);
  const audience = (p) => {
    if (q.target !== "all" && !(p.age >= settings.seniorAge)) return false;
    if ((q.target === "male" || q.gender === "MALE") && p.gender !== "MALE")
      return false;
    if (q.target === "minority" && !settings.minority.includes(p.race))
      return false;
    if (q.gender && p.gender !== q.gender) return false;
    if (q.race && p.race !== q.race) return false;
    if (q.cfs && p.cfs !== q.cfs) return false;
    if (q.client && String(p.client) !== q.client) return false;
    if (q.boundary && String(p.boundary) !== q.boundary) return false;
    if (q.ageBand) {
      const range = q.ageBand.match(/^(\d+)-(\d+)$/);
      if (
        range
          ? !(
              p.age != null &&
              p.age >= Number(range[1]) &&
              p.age <= Number(range[2])
            )
          : patternLabel(p, "age", settings) !== q.ageBand
      )
        return false;
    }
    return !q.factor || !q.group || factorLabel(p) === q.group;
  };
  const cohort = base.filter(audience),
    cohortIds = new Set(cohort.map((p) => p.id));
  const sensitive = !!(
    q.factor ||
    q.gender ||
    q.race ||
    q.cfs ||
    q.ageBand ||
    q.client ||
    q.boundary ||
    ["male", "minority"].includes(q.target)
  );
  // Full-history characteristic atoms prevent differencing through overlapping
  // labels, arbitrary dates and successive sensitive comparison requests.
  const atoms = new Map();
  if (sensitive && !settings.staffAnalysisFull)
    for (const p of base) {
      const key = JSON.stringify(
        ["age", "gender", "race", "cfs", "risk", "living", "block"]
          .map((d) => patternLabel(p, d, settings))
          .concat([[...(history.get(p.id) || [])].sort()]),
      );
      atoms.set(key, (atoms.get(key) || 0) + 1);
    }
  const blocked = sensitive && [...atoms.values()].some((n) => n < minimum);
  const ratesAvailable =
    q.scope === "clients" &&
    settings.registry?.complete === true &&
    settings.registry?.type === "clients" &&
    settings.registry?.asOf <= now &&
    allSessions.size > 0;
  function bucket(label) {
    return {
      label,
      sessionIds: new Set(),
      programmeIds: new Set(),
      delivered: new Map(),
      people: new Map(),
    };
  }
  const domainBuckets = new Map(),
    typeBuckets = new Map(),
    matrix = new Map(),
    ranks = new Map();
  const total = bucket("Total");
  if(combined)for(const domain of PROGRAMME_DOMAINS){domainBuckets.set(domain,bucket(domain));typeBuckets.set(domain,bucket(domain));}
  const addSession = (b, s) => {
    b.sessionIds.add(s.id);
    b.programmeIds.add(s.programmeId);
    b.delivered.set(s.programmeId, (b.delivered.get(s.programmeId) || 0) + 1);
  };
  for (const s of sessions) {
    const programme=programmes.get(s.programmeId), domain=programme.domain;
    const domains=combined?sourceLabels(s):[domain], labels=labelsFor(s);
    if(!selectedSessions.has(s.id))continue;
    addSession(total,s);
    for(const label of domains){if(!domainBuckets.has(label))domainBuckets.set(label,bucket(label));addSession(domainBuckets.get(label),s);}
    if(!combined||domains.includes(rankDomain)){
      if(!ranks.has(s.programmeId))ranks.set(s.programmeId,{...bucket(programme.name),id:s.programmeId,domain,eventTypes:new Set()});
      const rank=ranks.get(s.programmeId);addSession(rank,s);for(const label of labels)rank.eventTypes.add(label);
    }
    for(const label of labels){
      if(!typeBuckets.has(label))typeBuckets.set(label,bucket(label));addSession(typeBuckets.get(label),s);
      if(!combined){if(!matrix.has(domain))matrix.set(domain,new Map());if(!matrix.get(domain).has(label))matrix.get(domain).set(label,bucket(label));addSession(matrix.get(domain).get(label),s);}
    }
  }
  const attach = (b, pid, s) => {
    if (!b.people.has(pid)) b.people.set(pid, new Map());
    const pg = b.people.get(pid);
    if (!pg.has(s.programmeId)) pg.set(s.programmeId, new Set());
    pg.get(s.programmeId).add(s.id);
  };
  for (const [pid, ids] of history) {
    if (!cohortIds.has(pid)) continue;
    for (const sid of ids) {
      if (!selectedSessions.has(sid)) continue;
      const s=allSessions.get(sid),domain=programmes.get(s.programmeId).domain;
      const domains=combined?sourceLabels(s):[domain], labels=labelsFor(s);
      attach(total,pid,s);
      for(const label of domains)attach(domainBuckets.get(label),pid,s);
      if(!combined||domains.includes(rankDomain))attach(ranks.get(s.programmeId),pid,s);
      for(const label of labels){attach(typeBuckets.get(label),pid,s);if(!combined)attach(matrix.get(domain).get(label),pid,s);}
    }
  }
  const small = (n) => n > 0 && n < minimum;
  const stats = (b, includeEngagement = false) => {
    let attendance = 0,
      repeat = 0,
      opportunity = 0,
      multiProgramme = 0,
      multiDomain = 0,
      male = 0,
      minority = 0;
    for (const [pid, pgs] of b.people) {
      let again = false,
        eligible = false;
      const domains = new Set();
      for (const [pg, ids] of pgs) {
        attendance += ids.size;
        again ||= ids.size >= 2;
        eligible ||= (b.delivered.get(pg) || 0) >= 2;
        if(combined)for(const sid of ids)for(const domain of sourceLabels(allSessions.get(sid)))domains.add(domain);
        else domains.add(programmes.get(pg).domain);
      }
      repeat += Number(again);
      opportunity += Number(eligible);
      multiProgramme += Number(pgs.size >= 2);
      multiDomain += Number(domains.size >= 2);
      male += Number(people.get(pid).gender === "MALE");
      minority += Number(settings.minority.includes(people.get(pid).race));
    }
    const unique = b.people.size,
      suppressed =
        blocked ||
        small(unique) ||
        small(total.people.size - unique) ||
        (ratesAvailable && small(cohort.length - unique));
    const repeatSafe =
      !suppressed && !small(repeat) && !small(opportunity - repeat);
    return {
      label: b.label,
      engagement: includeEngagement && settings.staffAnalysisFull && !suppressed
        ? summariseEngagement((q.scope === 'clients' ? cohort : cohort.filter(p => b.people.has(p.id))).map(p => ({
          sessions: [...(b.people.get(p.id)?.values() || [])].reduce((n, ids) => n + ids.size, 0),
          last: lastHistory.get(p.id) ?? null,
        })), engagementAnchor, engagementConfig) : null,
      sessions: b.sessionIds.size,
      programmes: b.programmeIds.size,
      suppressed,
      unique: suppressed ? null : unique,
      attendance: suppressed ? null : attendance,
      rate: ratesAvailable && !suppressed ? pct(unique, cohort.length) : null,
      repeat: repeatSafe ? repeat : null,
      opportunity: repeatSafe ? opportunity : null,
      repeatRate: repeatSafe ? pct(repeat, opportunity) : null,
      averageSessions: suppressed
        ? null
        : unique
          ? Math.round((attendance / unique) * 10) / 10
          : null,
      average: suppressed
        ? null
        : b.sessionIds.size
          ? Math.round((attendance / b.sessionIds.size) * 10) / 10
          : null,
      multiProgramme:
        !suppressed && !small(multiProgramme) && !small(unique - multiProgramme)
          ? multiProgramme
          : null,
      multiDomain:
        !suppressed && !small(multiDomain) && !small(unique - multiDomain)
          ? multiDomain
          : null,
      male: !suppressed && !small(male) && !small(unique - male) ? male : null,
      minority:
        !suppressed && !small(minority) && !small(unique - minority)
          ? minority
          : null,
    };
  };
  const protect = (bs, includeEngagement = false) => {
    const rows = [...bs.values()].map(b => stats(b, includeEngagement));
    // Withhold other additive cells when one suppressed cell could be recovered.
    if (rows.some((r) => r.suppressed))
      for (const r of rows) {
        r.unique = null;
        r.attendance = null;
        r.rate = null;
        r.repeat = null;
        r.opportunity = null;
        r.repeatRate = null;
        r.average = null;
        r.averageSessions = null;
        r.multiProgramme = null;
        r.multiDomain = null;
        r.male = null;
        r.minority = null;
        r.suppressed = true;
        r.engagement = null;
      }
    return rows;
  };
  const domains = protect(domainBuckets),
    types = protect(typeBuckets, true),
    rankRows = protect(ranks)
      .map((r, i) => {
        const source = [...ranks.values()][i];
        return {
          ...r,
          id: source.id,
          domain: combined?programmeDomains([...source.sessionIds].map(id=>allSessions.get(id)),programmes.get(source.id),settings).join(" & "):source.domain,
          sourceDomain:source.domain,
          combinedDomains:combined?programmeDomains([...source.sessionIds].map(id=>allSessions.get(id)),programmes.get(source.id),settings):undefined,
          eventTypes: [...source.eventTypes].sort(),
        };
      })
      .sort(
        (a, b) =>
          (b[q.ranking] || 0) - (a[q.ranking] || 0) ||
          a.label.localeCompare(b.label),
      );
  const cells = [];
  for (const [domain, bs] of matrix)
    for (const row of protect(bs)) cells.push({ domain, ...row });
  const totalStats = stats(total);
  if (types.some((t) => t.suppressed))
    for (const key of [
      "unique",
      "attendance",
      "repeat",
      "opportunity",
      "repeatRate",
      "rate",
      "male",
      "minority",
      "multiProgramme",
      "multiDomain",
      "average",
      "averageSessions",
    ])
      totalStats[key] = null;
  const findings = [];
  const evidenceMinimum=Math.max(5,settings.minParticipants||5);
  const strongest = [...types]
    .filter((t) => t.unique >= evidenceMinimum)
    .sort((a, b) => b.unique - a.unique)[0];
  if (strongest)
    findings.push({
      finding: `${strongest.label} has the broadest recorded reach in this view.`,
      evidence: `${strongest.unique} unique participants across ${strongest.sessions} sessions and ${strongest.programmes} programmes.`,
      implication:
        "Classification describes recorded programme objectives, not achieved outcomes.",
      investigate:
        "Compare session frequency, capacity and participant feedback.",
      action: "Review resources and interest before considering another cycle.",
    });
  const recurring = [...types]
    .filter((t) => t.repeat >= evidenceMinimum && t.opportunity >= evidenceMinimum)
    .sort((a, b) => b.repeatRate - a.repeatRate)[0];
  if (recurring)
    findings.push({
      finding: `${recurring.label} supports recorded same-programme repeat engagement.`,
      evidence: `${recurring.repeat} repeat participants among ${recurring.opportunity} with repeat opportunity (${recurring.repeatRate}%).`,
      implication:
        "Returning to the same programme differs from trying different programmes with this label.",
      investigate:
        "Check whether delivery frequency and intake favour regular attendees.",
      action:
        "Discuss a new-participant intake alongside continuing provision.",
    });
  const overlap = cells
    .filter((c) => c.label !== UNCLASSIFIED && c.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions)[0];
  if (overlap)
    findings.push({
      finding: `${overlap.domain} includes secondary ${overlap.label} classifications.`,
      evidence: `${overlap.sessions} delivered sessions carry this domain/label combination.`,
      implication:
        "The primary domain alone does not describe all recorded engagement objectives.",
      investigate:
        "Review overlapping labels against intended objectives and sourced interests.",
      action:
        "Use both classifications in the next portfolio review; do not add overlapping totals.",
    });
  if (types.some((t) => t.label === UNCLASSIFIED))
    findings.push({
      finding: "Some delivered sessions have no recorded Event Type.",
      evidence: `${types.find((t) => t.label === UNCLASSIFIED).sessions} sessions remain unclassified.`,
      implication: "Older exports do not establish secondary classifications.",
      investigate: "Check the original programme/session records.",
      action:
        "Use a reviewed metadata merge where a reliable source is available.",
    });
  if(combined){
    const delivery=[...types].filter(t=>t.sessions>0).sort((a,b)=>b.sessions-a.sessions)[0];
    if(delivery)findings.unshift({finding:`${delivery.label} has the most delivered sessions.`,evidence:`${delivery.sessions} of ${totalStats.sessions} overall sessions carry this domain.`,implication:'Multi-domain sessions appear in each applicable domain, while the overall total counts each session once.',investigate:'Review whether the programme mix matches centre objectives and recorded interests.',action:'Discuss the balance of provision; session volume alone is not programme effectiveness.'});
    const male=[...types].filter(t=>t.male>=evidenceMinimum).sort((a,b)=>b.male-a.male)[0];
    if(male)findings.push({finding:`${male.label} reaches ${male.male} distinct male participants in this selection.`,evidence:`${male.unique} unique participants across ${male.sessions} delivered sessions.`,implication:'This describes the selected recorded population, not the reason people chose to attend.',investigate:'Compare session availability and participant-reported preferences before planning outreach.',action:'Review the domain programme ranking and relevant feedback.'});
  }
  const unclassifiedSessions=combined?sessions.filter(s=>selectedSessions.has(s.id)&&!sourceLabels(s).length):[];
  const breadth=new Map();
  if(combined)for(const [pid,ids]of history){if(!cohortIds.has(pid))continue;const selectedIds=[...ids].filter(id=>selectedSessions.has(id));if(!selectedIds.length)continue;const count=new Set(selectedIds.flatMap(id=>sourceLabels(allSessions.get(id)))).size;breadth.set(count,(breadth.get(count)||0)+1);}
  const breadthBlocked=blocked||types.some(t=>t.suppressed)||[...breadth.values()].some(n=>small(n)||small(total.people.size-n));
  const groups = q.factor ? [...new Set(base.map(factorLabel))].sort() : [];
  const page = Number(q.page || 0),
    limit = q.all === "1" ? 20 : 5;
  const latestPreferences = new Map();
  for (const feedback of [...(state.feedback || [])]
    .filter((f) => f.date <= (q.to || now))
    .sort((a, b) =>
      (a.date + (a.created || "")).localeCompare(b.date + (b.created || "")),
    )) {
    const prefs = JSON.parse(feedback.details).preferences;
    if (prefs && (prefs.responded || prefs.interests?.length))
      latestPreferences.set(feedback.participant_id, prefs.interests || []);
  }
  for (const p of cohort)
    if (
      p.profile?.preferences?.responded ||
      p.profile?.preferences?.interests?.length
    )
      latestPreferences.set(p.id, p.profile.preferences.interests || []);
  const interests = new Map();
  for (const [id, labels] of latestPreferences)
    if (cohortIds.has(id))
      for (const label of new Set(labels)) {
        if (!interests.has(label)) interests.set(label, new Set());
        interests.get(label).add(id);
      }
  const alignmentRows = [];
  for (const [label, ids] of interests) {
    if (blocked || small(ids.size) || small(cohort.length - ids.size)) continue;
    const tagged = new Set(
      [...programmes.values()]
        .filter((p) => p.optional?.interestCategories?.includes(label))
        .map((p) => p.id),
    );
    const offered = sessions.filter(
      (s) => selectedSessions.has(s.id) && tagged.has(s.programmeId),
    );
    const offeredIds = new Set(offered.map((s) => s.id)),
      reached = [...ids].filter((id) =>
        [...(history.get(id) || [])].some((s) => offeredIds.has(s)),
      ).length;
    alignmentRows.push({
      label,
      respondents: ids.size,
      sessions: offered.length,
      reached: small(reached) || small(ids.size - reached) ? null : reached,
    });
  }
  return {
    rankingMetric:q.ranking,
    classificationMode:combined?"Combined five-domain classification":"Raw source classification audit",
    selectedDomain:combined?rankDomain:null,
    unclassified: {sessions:unclassifiedSessions.length,programmes:new Set(unclassifiedSessions.map(s=>s.programmeId)).size},
    domainBreadth:combined&&!breadthBlocked?[...breadth].sort((a,b)=>a[0]-b[0]).map(([domains,members])=>({domains,members})):[],
    period: {
      from: q.from || sessions.map((s) => s.date).sort()[0] || null,
      to:
        q.to ||
        sessions
          .map((s) => s.date)
          .sort()
          .at(-1) ||
        null,
    },
    scope: q.scope,
    engagement: { ...engagementConfig, anchor: engagementAnchor, historyFrom: historyDates[0] || null },
    target: q.target,
    minimum,
    ratesAvailable,
    registered:
      ratesAvailable && !blocked && !small(cohort.length)
        ? cohort.length
        : null,
    total: totalStats,
    domains,
    types,
    matrix: cells,
    programmeClassifications: rankRows.map(r => ({
      id: r.id, name: r.label, primaryDomain: r.sourceDomain||r.domain, subDomains: r.eventTypes,combinedDomains:r.combinedDomains,
      sessions: r.sessions, attendance:r.attendance, unique: r.unique, repeat: r.repeat, averageSessions: r.averageSessions,
      opportunity: r.opportunity, repeatRate: r.repeatRate, rate: r.rate,
    })),
    rankings: {
      rows: rankRows.slice(page * limit, page * limit + limit),
      total: rankRows.length,
      page,
      limit,
    },
    options: {
      domains: combined?[...PROGRAMME_DOMAINS]:[...new Set(data.programmes.map((p) => p.domain))].sort(),
      eventTypes: combined?[...PROGRAMME_DOMAINS]:[
        ...new Set(
          data.sessions.flatMap((s) => {
            const labels = sourceLabels(s);
            return labels.length ? labels : [UNCLASSIFIED];
          }),
        ),
      ].sort(),
      groups,
    },
    findings: findings.slice(0, 5),
    alignment: alignmentRows.length
      ? "Reported interests are compared only with explicitly staff-tagged programme interests; Event Type names are not treated as preference mappings."
      : "More participant feedback is required to assess programme alignment.",
    alignmentRows,
    limitations: [
      ...(combined?["Programmes may belong to more than one domain. Domain totals may overlap. Raw AAP Domain and Event Type remain unchanged; only recognised domains and approved exact aliases contribute."]:[]),
      "Engagement depth counts distinct sessions in this period/filter within each Event Type. Registered-client depth includes the eligible client cohort for each type; attendance-only depth includes attendees of that type. Event Types overlap; neither their counts nor segment totals can be added across types. No recorded history is not proof that someone never attended. Recency uses full-history latest attendance through the coverage end date, independent of the selected period or Event Type, and does not change active/inactive rules.",
      "Event Type totals overlap; do not sum category totals.",
      "Unique reach counts Member IDs attending qualifying delivered sessions.",
      "Repeat means at least two distinct sessions of the same programme; opportunity requires at least two delivered sessions of that programme.",
      "Programme counts and sessions describe supply, even when no selected-group attendance is recorded.",
      "A label is not proof of health, learning or social outcomes; popularity is not programme effectiveness.",
      settings.staffAnalysisFull?'Current recorded profiles are used. Staff analysis displays all recorded group counts.':'Current recorded profiles are used. Small sensitive groups and reconstructable comparisons are withheld.',
      "A non-attender has no inferred Event Type preference.",
    ],
  };
}

export function programmeDomainReport(state,input={},now=todaySG()){return eventTypeReport(state,input,now,true);}
