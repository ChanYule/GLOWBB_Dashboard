import test from "node:test";
import assert from "node:assert/strict";
import { sppbParticipationAnalysis } from "../server/sppb-analysis.js";
const member = (id, total, extra = {}) => ({
  id,
  centres: ["a"],
  age: 75,
  cfs: "4",
  gender: "FEMALE",
  riskRaw: "0",
  livingRaw: "Alone",
  latestDate: "2026-10-31",
  latest: {
    date: "2026-10-31",
    sourceDefinition: "unverified",
    original: { total },
    standard: null,
  },
  previous: null,
  delta: null,
  ...extra,
});
function fixture() {
  const members = [
    member("person-a", 16),
    member("person-b", 6),
    member("person-c", 12, { centres: ["b"] }),
    member("person-d", 9, {
      latest: {
        date: "2026-10-31",
        sourceDefinition: "standard",
        original: { total: 9 },
        standard: { total: 9 },
      },
      previous: { date: "2026-04-01" },
      delta: 3,
    }),
    member("conflict", null, { latest: null }),
    member("undated", null, { latestDate: null, latest: null }),
    member("missing", null),
  ];
  const sessions = [
    ["early", "2026-01-01"],
    ["outside", "2026-04-29"],
    ["boundary", "2026-04-30"],
    ["learning", "2026-10-31"],
    ["after", "2026-11-01"],
  ].map(([id, date]) => ({
    id,
    date,
    programmeId: id === "learning" ? "learn" : "movement",
    optional:
      id === "learning"
        ? { aapDomainRaw: "Learning" }
        : { eventTypes: ["Cognitive & Social"] },
  }));
  const attendance = [
    "early",
    "outside",
    "boundary",
    "boundary",
    "learning",
    "after",
  ].map((sessionId) => ({ participantId: "person-a", sessionId }));
  attendance.push(
    { participantId: "person-d", sessionId: "boundary" },
    { participantId: "person-d", sessionId: "learning" },
  );
  const data = {
    participants: [],
    programmes: [
      { id: "movement", name: "Movement", domain: "Physical" },
      { id: "learn", name: "Learning", domain: "Physical" },
    ],
    sessions,
    attendance,
  };
  return {
    members,
    states: [
      { id: "a", settings: {}, data },
      {
        id: "b",
        settings: {},
        data: {
          participants: [],
          programmes: [],
          sessions: [],
          attendance: [],
        },
      },
    ],
  };
}
test("linked analysis keeps source scales separate and deduplicates six-month attendance with exact boundaries", () => {
  const { members, states } = fixture(),
    before = structuredClone(states),
    a = sppbParticipationAnalysis(members, states, "2026-11-19");
  assert.equal(a.population, 7);
  assert.equal(a.scored, 4);
  assert.deepEqual(a.exclusions, {
    noDatedAssessment: 1,
    ambiguousLatest: 1,
    missingTotal: 1,
  });
  assert.equal(a.historyUnavailable, 1);
  const raw = a.sourceGroups.find((g) => g.sourceDefinition === "unverified");
  assert.equal(raw.members, 3);
  assert.equal(raw.medianTotal, 12);
  assert.equal(raw.unvalidated, 3);
  const active = raw.cohorts.attendance.find(
    (c) => c.label === "Two or more sessions",
  );
  assert.equal(active.members, 1);
  assert.equal(active.medianSessions, 2);
  assert.equal(active.medianTotal, 16);
  assert.equal(
    raw.cohorts.attendance.find((c) => c.label === "None recorded")
      .medianSessions,
    0,
  );
  assert.equal(
    raw.cohorts.attendance.find((c) => c.label === "History unavailable")
      .medianSessions,
    null,
  );
  assert.deepEqual(
    raw.domains.map((d) => d.label),
    ["Physical", "Cognitive", "Learning", "Social", "Volunteerism"],
  );
  assert.equal(raw.domains[0].attended.members, 1);
  assert.equal(raw.domains[0].noRecordedAttendance.members, 1);
  assert.equal(raw.domains[2].attended.members, 1);
  assert.equal(raw.programmes.find((p) => p.name === "Movement").sessions, 1);
  assert.deepEqual(raw.changes, []);
  assert.deepEqual(
    a.sourceGroups.find((g) => g.sourceDefinition === "standard").changes,
    [{ label: "Two or more sessions", members: 1, medianChange: 3 }],
  );
  assert.equal(JSON.stringify(a).includes("person-a"), false);
  assert.deepEqual(states, before);
});
test("official programme exclusions apply without deleting assessments or making absent history zero", () => {
  const { members, states } = fixture();
  states[0].settings.reporting = {
    version: 1,
    rules: [
      {
        id: "excluded",
        enabled: true,
        status: "Approved",
        scope: "performance",
        approvedIds: ["movement"],
      },
    ],
  };
  const a = sppbParticipationAnalysis(members, states, "2026-11-19"),
    raw = a.sourceGroups.find((g) => g.sourceDefinition === "unverified");
  assert.equal(a.scored, 4);
  assert.equal(
    raw.cohorts.attendance.find((g) => g.label === "One session").members,
    1,
  );
  assert.equal(raw.domains[0].attended.members, 0);
  assert.equal(raw.programmes.length, 1);
  assert.equal(raw.programmes[0].name, "Learning");
});
test("current profile conflicts, literal SRF codes and missing profiles stay explicit; filtered cohorts use their own counts", () => {
  const { members, states } = fixture();
  members[0].profileConflicts = ["cfs"];
  members[1].cfs = null;
  members[1].age = 82;
  const a = sppbParticipationAnalysis(
      members.slice(0, 2),
      states,
      "2026-11-19",
    ),
    raw = a.sourceGroups[0];
  assert.equal(a.population, 2);
  assert.equal(
    raw.cohorts.cfs.find((g) => g.label === "Conflicting centre profiles")
      .members,
    1,
  );
  assert.equal(
    raw.cohorts.cfs.find((g) => g.label === "Not recorded").members,
    1,
  );
  assert.equal(raw.cohorts.age.find((g) => g.label === "80+").members, 1);
  assert.equal(raw.cohorts.srf[0].label, "0");
  assert.ok(raw.cohorts.cfs.every((c) => c.smallSample));
  const empty = sppbParticipationAnalysis([], states, "2026-11-19");
  assert.deepEqual(empty.sourceGroups, []);
  assert.equal(empty.scored, 0);
});

test("combined-centre analysis counts people once and includes attendance only within their current affiliations", () => {
  const { members, states } = fixture();
  states[1] = { ...structuredClone(states[0]), id: "b" };
  const selected = [members[0]];
  const single = sppbParticipationAnalysis(selected, states, "2026-11-19");
  assert.equal(single.sourceGroups[0].medianSessions, 2);
  selected[0] = { ...selected[0], centres: ["a", "b"] };
  const combined = sppbParticipationAnalysis(selected, states, "2026-11-19");
  assert.equal(combined.scored, 1);
  assert.equal(combined.sourceGroups[0].members, 1);
  assert.equal(combined.sourceGroups[0].medianSessions, 4);
  assert.equal(combined.sourceGroups[0].domains[0].attended.members, 1);
  assert.deepEqual(
    [
      ...new Set(combined.sourceGroups[0].programmes.map((p) => p.centre)),
    ].sort(),
    ["a", "b"],
  );
});
