import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  participationPatterns,
  patternLabel,
  validatePatternQuery,
} from "../server/patterns.js";
import { defaults } from "../server/domain.js";
import { CLIENT_SNAPSHOT } from "../server/client-domain.js";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import {normalizePatternPreferences,compatibleAnalysis,populations,analysisDimensions} from '../shared/participation-compat.js';

function fixture() {
  const state = {
    settings: {
      ...defaults,
      registry: {
        complete: true,
        type: "clients",
        snapshot: CLIENT_SNAPSHOT,
        asOf: "2026-11-01",
      },
    },
    profiles: [],
    feedback: [],
    registry: [],
    data: {
      participants: [],
      programmes: [
        { id: "a", name: "Weekly movement", domain: "Physical", optional: {} },
        { id: "b", name: "One-off workshop", domain: "Learning", optional: {} },
      ],
      sessions: [
        { id: "prior", programmeId: "a", date: "2026-10-01" },
        { id: "a1", programmeId: "a", date: "2026-11-01" },
        { id: "a2", programmeId: "a", date: "2026-11-02" },
        { id: "b1", programmeId: "b", date: "2026-11-03" },
        { id: "future", programmeId: "a", date: "2026-11-10" },
      ],
      attendance: [],
    },
  };
  for (let g = 0; g < 4; g++)
    for (let i = 0; i < 20; i++) {
      const p = {
        id: `literal-${g}-${i}`,
        age: [55, 65, 75, 85][g],
        gender: "MALE",
        race: "CHINESE",
        cfs: ["1-3", "4", "5", "7-8"][g],
        livingRaw: "Alone",
        riskRaw: ["0", "1", ">1", null][g],
        client: true,
        blockRaw: "101",
      };
      state.data.participants.push(p);
      state.registry.push({
        participant_id: p.id,
        snapshot: CLIENT_SNAPSHOT,
        details: JSON.stringify(p),
      });
      for (const sessionId of i < 5
        ? ["a1", "a2", "b1"]
        : i < 10
          ? ["prior", "a1"]
          : ["future"])
        state.data.attendance.push({ participantId: p.id, sessionId });
    }
  return state;
}
const now = "2026-11-05",
  query = { from: "2026-11-01", to: "2026-11-03" };
test('below-60 selections use attendance without changing client totals or assigning client rates', () => {
  const s = fixture(); s.settings.staffAnalysisFull = true;
  const before = participationPatterns(s, { ...query, scope: 'clients' }, now);
  s.data.participants.push({ id: 'younger-nonclient', age: 59, client: false }, { id: 'unknown-age', age: null, client: false });
  for (const id of ['younger-nonclient', 'unknown-age'])
    for (const sessionId of ['a1', 'a2', 'a2', 'future']) s.data.attendance.push({ participantId: id, sessionId });
  const migrated = normalizePatternPreferences({ ...query, dimension: 'age', scope: 'clients', group: 'Below 60', second: 'distance', programme: 'a' }, now);
  assert.equal(migrated.changed, true); assert.equal(migrated.query.scope, 'overall');
  assert.equal(migrated.query.second, undefined); assert.equal(migrated.query.programme, undefined);
  const r = participationPatterns(s, migrated.query, now), below = r.groups.find(g => g.label === 'Below 60');
  // Existing 55-year-old attendance participants plus the new non-client.
  assert.equal(below.unique, 11); assert.equal(below.attendance, 22);
  assert.equal(below.registered, null); assert.equal(below.rate, null); assert.equal(r.ratesAvailable, false);
  assert.equal(r.rankings.rows.find(p => p.id === 'a').unique, 11);
  assert.equal(participationPatterns(s, { ...query, scope: 'clients' }, now).population, before.population);
  assert.equal(s.data.participants.find(p => p.id === 'younger-nonclient').client, false);
});
test('exact Overall Programme Planning scenario accepts all ages and releases canonical age aggregates even with distinct profile histories',()=>{
 const s=fixture();s.data.sessions.find(session=>session.id==='prior').date='2026-05-04';s.data.participants.push({id:'one-more',age:75,gender:'FEMALE',race:'CHINESE',cfs:'unknown'});s.data.attendance.push({participantId:'one-more',sessionId:'a1'});
 const q={scope:'overall',dimension:'age',from:'2026-05-04',to:'2026-11-05'};
 assert.doesNotThrow(()=>validatePatternQuery(q,now));const r=participationPatterns(s,q,now);assert.equal(r.population,41);assert.equal(r.ratesAvailable,false);assert.equal(r.comparisonSuppressed,false);assert.equal(r.groups.find(g=>g.label==='70 to 79').unique,11);assert.equal(r.groups[0].label,'Below 60');assert.ok(r.groups.every(g=>g.rate==null));
 const custom=participationPatterns(s,{...q,from:'2026-10-01'},now);assert.equal(custom.comparisonSuppressed,true,'custom slices retain differencing protection');
});
test('all four populations use explicit attendance or complete-registry denominators',()=>{const s=fixture();const all=participationPatterns(s,{scope:'overall'},now),clients=participationPatterns(s,{scope:'clients'},now),attending=participationPatterns(s,{scope:'attendingClients'},now),seniors=participationPatterns(s,{scope:'seniors'},now);assert.equal(all.population,40);assert.equal(clients.population,80);assert.equal(attending.population,40);assert.equal(seniors.population,30);assert.equal(clients.ratesAvailable,true);for(const r of [all,attending,seniors]){assert.equal(r.ratesAvailable,false);assert.ok(r.groups.every(g=>g.registered==null&&g.rate==null));}assert.equal(seniors.groups.some(g=>g.label==='Below 60'),false);assert.equal(attending.groups.some(g=>g.label==='Below 60'),true);});
test('shared compatibility and legacy preference migration cover every staff analysis without forwarding obsolete fields',()=>{
 for(const scope of Object.keys(populations))for(const dimension of Object.keys(analysisDimensions)){const compatible=compatibleAnalysis(scope,dimension,'rate');const q=normalizePatternPreferences({scope,dimension,from:'2026-05-04',to:'2026-11-05',preset:'retired',metric:'rate',path:['api','participation-patterns'],ranking:'obsolete'},now).query;assert.equal(q.scope,compatible.scope);assert.doesNotThrow(()=>validatePatternQuery(q,now));assert.equal('metric'in q,false);assert.equal('path'in q,false);assert.equal(q.dimension,dimension);if(!populations[scope].rates)assert.equal(compatible.metric,'unique');}
 const normalized=normalizePatternPreferences({dimension:'retired',scope:'wrong',page:'99999',to:'2026-02-30',basis:'broken'},now);assert.equal(normalized.changed,true);assert.equal(normalized.query.dimension,'age');assert.equal(normalized.query.page,undefined);assert.equal(normalized.query.to,undefined);assert.doesNotThrow(()=>validatePatternQuery(normalized.query,now));
});
test('each demographic dimension works across relevant populations; empty periods and missing records are explicit',()=>{for(const scope of Object.keys(populations))for(const dimension of ['age','cfs','risk','race','gender','living']){const r=participationPatterns(fixture(),{scope,dimension},now);assert.equal(r.dimension,dimension);assert.ok(r.groups.length>0);assert.ok(r.rankings.rows.length<=5);}const empty=participationPatterns(fixture(),{scope:'overall',from:'2026-09-01',to:'2026-09-30'},now);assert.equal(empty.population,0);assert.equal(empty.groups.reduce((n,g)=>n+(g.unique||0),0),0);});
test("exact age bands, invalid and missing ages, source CFS and approved SRF/living mappings remain distinct", () => {
  for (const [age, expected] of [
    [59, "Below 60"],
    [60, "60 to 69"],
    [69, "60 to 69"],
    [70, "70 to 79"],
    [79, "70 to 79"],
    [80, "80 and above"],
    [null, "Missing"],
    ["Unknown", "Unknown"],
    [-1, "Invalid age"],
    [121, "Invalid age"],
  ])
    assert.equal(patternLabel({ age }, "age"), expected);
  for (const [cfs, expected] of [
    [1, "CFS 1 to 3"],
    ["1-3", "CFS 1 to 3"],
    [4, "CFS 4"],
    [6, "CFS 6"],
    ["7-8", "CFS 7 to 8"],
    [null, "Missing"],
    ["Not assessed", "Not assessed"],
  ])
    assert.equal(patternLabel({ cfs }, "cfs"), expected);
  assert.equal(
    patternLabel({ cfs: "4" }, "cfs", {
      cfsMappings: { 4: { label: "Approved source group" } },
    }),
    "Approved source group",
  );
  assert.equal(patternLabel({ riskRaw: ">1" }, "risk"), ">1");
  assert.equal(
    patternLabel({ riskRaw: "0" }, "risk", {
      riskMappings: { 0: { label: "Approved category" } },
    }),
    "0 · Approved category",
  );
  assert.equal(
    patternLabel({ livingRaw: "Room-mate" }, "living", {
      livingGroups: { "Room-mate": "Shared home" },
    }),
    "Shared home",
  );
  assert.equal(patternLabel({ race: "OTHERS" }, "race"), "OTHERS");
});
test("registry denominators retain non-attenders, deduplicate person-sessions and exclude future records", () => {
  const s = fixture();
  s.data.attendance.push({ ...s.data.attendance[0] });
  const r = participationPatterns(s, query, now),
    g = r.groups[0];
  assert.equal(r.population, 80);
  assert.equal(g.registered, 20);
  assert.equal(g.unique, 10);
  assert.equal(g.noAttendance, 10);
  assert.equal(g.rate, 50);
  assert.equal(g.attendance, 20);
  assert.equal(g.averageSessions, 2);
  assert.equal(g.programmes, 2);
  assert.equal(g.domains, 2);
  assert.equal(g.repeat, 5);
  assert.equal(g.opportunity, 10);
  assert.equal(g.repeatRate, 50);
  assert.equal(g.firstObserved, 5);
  assert.equal(g.returning, 5);
  assert.equal(
    r.groups.reduce((n, row) => n + row.unique, 0),
    40,
  );
  assert.ok(!JSON.stringify(r).includes("literal-"));
});
test("overall scope retains non-clients and never divides by a client population", () => {
  const s = fixture();
  for (let i = 0; i < 5; i++) {
    s.data.participants.push({
      id: `other-${i}`,
      age: 55,
      gender: "MALE",
      race: "CHINESE",
      livingRaw: "Alone",
      cfs: "1-3",
      riskRaw: "0",
      blockRaw: "101",
      client: false,
    });
    s.data.attendance.push({ participantId: `other-${i}`, sessionId: "a1" });
  }
  const r = participationPatterns(s, { ...query, scope: "overall" }, now);
  assert.equal(r.population, 45);
  assert.equal(r.groups[0].unique, 15);
  assert.equal(r.groups[0].rate, null);
  assert.equal(r.groups[0].registered, null);
  assert.equal(participationPatterns(s, query, now).population, 80);
});
test("rankings switch metrics, distinguish delivery opportunity, paginate and protect programme breakdowns", () => {
  const s = fixture();
  for (const ranking of ["unique", "attendance", "repeat"]) {
    const r = participationPatterns(s, { ...query, ranking }, now);
    assert.equal(r.rankings.rows[0].id, "a");
    assert.equal(r.rankings.rows[0].sessions, 2);
    assert.equal(r.rankings.rows[0].repeatRate, 50);
    if (ranking !== "repeat")
      assert.equal(r.rankings.rows.find((p) => p.id === "b").repeatRate, null);
    else assert.equal(r.rankings.rows.length, 1);
  }
  const r = participationPatterns(
    s,
    { ...query, all: "1", programme: "a" },
    now,
  );
  assert.equal(r.rankings.limit, 20);
  assert.equal(r.programmeDetail.breakdown.length, 4);
  assert.equal(r.programmeDetail.breakdown[0].unique, 10);
  assert.equal(
    participationPatterns(s, { ...query, all: "1", page: "1" }, now).rankings
      .rows.length,
    0,
  );
});
test("top-five ranking limits and source programme identities remain exact", () => {
  const s = fixture();
  for (let pg = 0; pg < 8; pg++) {
    const id = `separate-${pg}`;
    s.data.programmes.push({
      id,
      name: "Same display name",
      domain: "Learning",
      optional: {},
    });
    s.data.sessions.push({ id, programmeId: id, date: "2026-11-03" });
    for (let g = 0; g < 4; g++)
      for (let i = 0; i < 5; i++)
        s.data.attendance.push({
          participantId: `literal-${g}-${i}`,
          sessionId: id,
        });
  }
  const top = participationPatterns(s, query, now),
    all = participationPatterns(s, { ...query, all: "1" }, now);
  assert.equal(top.rankings.rows.length, 5);
  assert.equal(
    all.rankings.rows.filter((p) => p.name === "Same display name").length,
    8,
  );
  assert.equal(
    new Set(all.rankings.rows.map((p) => p.id)).size,
    all.rankings.rows.length,
  );
});
test("a small category receives complementary suppression without hiding large safe groups", () => {
  const s = fixture();
  s.data.participants.push({ id: "unknown-person", age: null, client: true });
  s.registry.push({
    participant_id: "unknown-person",
    snapshot: CLIENT_SNAPSHOT,
    details: JSON.stringify({ age: null, client: true }),
  });
  const r = participationPatterns(s, {}, now);
  assert.equal(r.comparisonSuppressed, false);
  assert.equal(r.groups.filter((g) => g.suppressed).length, 2);
  assert.equal(
    r.groups.find((g) => g.label === "Missing").registered,
    undefined,
  );
  assert.equal(r.completeness, null);
});
test("additive totals and averages cannot reconstruct a hidden programme subgroup", () => {
  const s = fixture();
  s.data.programmes.push({
    id: "rare",
    name: "Protected programme",
    domain: "Rare domain",
    optional: {},
  });
  s.data.sessions.push({ id: "rare", programmeId: "rare", date: "2026-11-03" });
  s.data.attendance.push({ participantId: "literal-0-0", sessionId: "rare" });
  const r = participationPatterns(s, {}, now),
    group = r.groups.find((g) => g.label === "Below 60");
  assert.equal(group.unique, 10);
  assert.equal(group.attendance, null);
  assert.equal(group.averageSessions, null);
  assert.equal(group.repeatRate, null);
  assert.equal(group.averageDomains, null);
  assert.ok(!r.rankings.rows.some((p) => p.id === "rare"));
  assert.ok(
    r.rankings.rows.length <= 1,
    "another programme is withheld to protect subtraction from other available totals",
  );
});
test("missing classifications and partial registries do not become zero risk or verified participation rates", () => {
  const s = fixture();
  s.settings.registry.complete = false;
  const r = participationPatterns(s, { ...query, dimension: "risk" }, now);
  assert.ok(r.groups.find((g) => g.label === "Missing"));
  assert.equal(r.groups[0].rate, null);
  assert.equal(r.completeness, 75);
  assert.ok(r.limitations.some((note) => note.includes("No ordered SRF")));
});
test("combined comparisons retain proper denominators; small cells, complements and differencing slices are withheld", () => {
  const s = fixture();
  const r = participationPatterns(s, { ...query, second: "gender" }, now);
  assert.equal(r.combined.suppressed, false);
  assert.equal(r.combined.rows[0].registered, 20);
  assert.equal(r.combined.rows[0].rate, 50);
  s.data.participants[0].gender = "FEMALE";
  const details = JSON.parse(s.registry[0].details);
  details.gender = "FEMALE";
  s.registry[0].details = JSON.stringify(details);
  const unsafe = participationPatterns(s, { ...query, second: "gender" }, now);
  assert.equal(unsafe.comparisonSuppressed, true);
  assert.deepEqual(unsafe.combined.rows, []);
  assert.deepEqual(unsafe.rankings.rows, []);
  assert.equal(unsafe.population, null);
  assert.equal(unsafe.groups[0].registered, undefined);
  const noSlice = participationPatterns(s, {}, now);
  assert.equal(noSlice.comparisonSuppressed, false);
  assert.equal(
    participationPatterns(s, { domain: "Physical" }, now).comparisonSuppressed,
    true,
  );
});
test("dated profiles use only effective snapshots at period end, never current or future attributes", () => {
  const s = fixture();
  s.profileHistory = s.data.participants.map((p) => ({
    participant_id: p.id,
    id: p.id,
    created: "2026-10-01",
    effective_date: "2026-10-01",
    details: JSON.stringify({
      after: { basic: { age: 75 }, health: { cfs: "4" } },
    }),
  }));
  s.profileHistory.push({
    participant_id: "literal-0-0",
    id: "future-profile",
    created: "2026-11-04",
    effective_date: "2026-11-04",
    details: JSON.stringify({ after: { basic: { age: 90 } } }),
  });
  const r = participationPatterns(s, { ...query, basis: "dated" }, now);
  assert.deepEqual(
    r.groups.filter((g) => g.registered > 0).map((g) => g.label),
    ["70 to 79"],
  );
  assert.equal(r.groups.find((g) => g.label === "70 to 79").registered, 80);
  assert.equal(r.groups.find((g) => g.label === "Below 60").registered, 0);
  s.profileHistory = [];
  assert.equal(
    participationPatterns(s, { ...query, basis: "dated" }, now).groups.find(
      (g) => g.label === "Missing",
    ).registered,
    80,
  );
});
test("findings are calculated, do not force a CFS trend and do not invent barriers or causes", () => {
  const s = fixture(),
    r = participationPatterns(s, { ...query, dimension: "cfs" }, now);
  assert.ok(
    r.findings.some((f) =>
      f.evidence.includes("do not establish a consistent decreasing pattern"),
    ),
  );
  assert.deepEqual(r.reportedBarriers.rows, []);
  assert.ok(r.findings.length >= 3 && r.findings.length <= 5);
  assert.ok(r.findings.every((f) => f.evidence && f.action && f.investigate));
  const empty = participationPatterns(
    { ...s, data: { ...s.data, attendance: [], sessions: [] } },
    {},
    now,
  );
  assert.match(empty.findings[0].title, /Insufficient evidence/);
});
test("filters reject unsupported, sensitive arbitrary filters, invalid dates and future records", () => {
  for (const q of [
    { dimension: "unknown" },
    { cfs: "4" },
    { from: "2026-02-30" },
    { to: "2027-01-01" },
    { second: "age" },
    { page: "-1" },
    { dimension: ["age"] },
  ])
    assert.throws(() => validatePatternQuery(q, now));
});
test("API permissions, protected exports and staff preferences preserve other workspaces", async () => {
  const db = openDb(":memory:"),
    app = createApp(db, { authRequired: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const actor = db
    .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
    .get().id;
  const put = (path, value) =>
    fetch(base + path, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify(value),
    });
  try {
    db.prepare("INSERT INTO staff_preferences VALUES(?,?)").run(
      actor,
      JSON.stringify({
        views: [],
        clients: { draft: "retain" },
        template: "Overview",
      }),
    );
    assert.equal(
      (
        await put("/api/participation-patterns/preferences", {
          dimension: "cfs",
          scope: "clients",
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await fetch(base + "/api/preferences")).json()).clients.draft,
      "retain",
    );
    assert.equal(
      (await put("/api/preferences", { views: [], template: "Changed" }))
        .status,
      200,
    );
    assert.equal(
      (await (await fetch(base + "/api/preferences")).json()).patterns
        .dimension,
      "cfs",
    );
    const exported = await fetch(base + "/api/participation-patterns/export");
    assert.equal(exported.status, 200);
    assert.ok(!(await exported.text()).includes("participant_id"));
    assert.equal(
      (await fetch(base + "/api/participation-patterns?living=Alone")).status,
      403,
    );
    db.prepare("UPDATE users SET role='viewer' WHERE id=?").run(actor);
    for (const path of [
      "/api/participation-patterns",
      "/api/participation-patterns/export",
    ])
      assert.equal((await fetch(base + path)).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
test("selected-dimension calculation measurement uses only synthetic records", (t) => {
  const s = fixture(),
    times = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    participationPatterns(s, query, now);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  t.diagnostic(
    `80-client synthetic selected-dimension median: ${times[7].toFixed(2)} ms. Local calculation only; no hosted speed claim.`,
  );
});
