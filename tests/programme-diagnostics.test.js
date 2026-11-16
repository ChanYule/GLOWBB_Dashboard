import test from "node:test";
import assert from "node:assert/strict";
import {
  programmeDiagnostics,
  programmeRepresentation,
} from "../shared/programme-diagnostics.js";
import { participationPatterns } from "../server/patterns.js";
import { analytics } from "../server/domain.js";
import { diagnosticFixture } from "./fixtures/programme-diagnostics-state.js";

test("programme diagnostic repeat rate uses all unique people while retaining explicit single-session and sample caveats", () => {
  const one = programmeDiagnostics({ unique: 20, repeat: 0, sessions: 1 });
  assert.equal(one.repeatRate, 0);
  assert.equal(one.singleSession, true);
  assert.equal(one.oneOffDraw, false);
  const none = programmeDiagnostics({ unique: 20, repeat: 0, sessions: 3 });
  assert.equal(none.oneOffDraw, true);
  assert.match(none.reasons[0], /No repeated attendance/);
  const tiny = programmeDiagnostics({ unique: 1, repeat: 1, sessions: 2 });
  assert.equal(tiny.repeatRate, 100);
  assert.equal(tiny.oneOffDraw, true);
  assert.equal(tiny.smallSample, true);
  assert.match(tiny.reasons[0], /Very small reach/);
  const unavailable = programmeDiagnostics({
    unique: 20,
    repeat: null,
    sessions: 2,
  });
  assert.equal(unavailable.repeatRate, null);
  assert.equal(unavailable.oneOffDraw, null);
  assert.equal(
    programmeDiagnostics({ unique: 0, repeat: 0, sessions: 1 }).repeatRate,
    null,
  );
  assert.equal(
    programmeDiagnostics({ unique: 20, repeat: 21, sessions: 2 }).repeatRate,
    null,
  );
  assert.equal(
    programmeDiagnostics({ unique: 10, repeat: 1, sessions: 2 }).oneOffDraw,
    false,
  );
  assert.equal(
    programmeDiagnostics(
      { unique: 10, repeat: 1, sessions: 2 },
      { cautionMinimum: 12, comparisonFloor: 11 },
    ).oneOffDraw,
    true,
  );
});

test("representation compares matched counts, uses percentage points and refuses impossible or absent denominators", () => {
  const r = programmeRepresentation({
    groupAttendees: 10,
    programmeAttendees: 50,
    groupRegistered: 40,
    registered: 100,
  });
  assert.equal(r.attendeeShare, 20);
  assert.equal(r.registeredShare, 40);
  assert.equal(r.differencePoints, -20);
  assert.equal(r.ratio, 0.5);
  for (const counts of [
    {
      groupAttendees: 0,
      programmeAttendees: 0,
      groupRegistered: 20,
      registered: 100,
    },
    {
      groupAttendees: 3,
      programmeAttendees: 2,
      groupRegistered: 20,
      registered: 100,
    },
    {
      groupAttendees: 3,
      programmeAttendees: 30,
      groupRegistered: 2,
      registered: 100,
    },
    {
      groupAttendees: 3,
      programmeAttendees: 110,
      groupRegistered: 20,
      registered: 100,
    },
  ])
    assert.equal(programmeRepresentation(counts), null);
});

const query = { dimension: "age", scope: "clients", group: "60 to 69" };
test("programme diagnostics and representation use the selected client group and preserve existing opportunity metrics", () => {
  const s = diagnosticFixture(),
    before = JSON.stringify(s),
    r = participationPatterns(s, query, "2026-11-06");
  const a = r.rankings.rows.find((p) => p.id === "a"),
    b = r.rankings.rows.find((p) => p.id === "b"),
    c = r.rankings.rows.find((p) => p.id === "c"),
    d = r.rankings.rows.find((p) => p.id === "d");
  assert.equal(a.unique, 10);
  assert.equal(a.sessions, 2);
  assert.equal(a.attendance, 20);
  assert.equal(a.diagnostics.repeatRate, 100);
  assert.equal(a.representation.groupAttendees, 10);
  assert.equal(a.representation.programmeAttendees, 70);
  assert.equal(a.representation.groupRegistered, 20);
  assert.equal(a.representation.registered, 100);
  assert.equal(b.repeatRate, null, "legacy one-session metric is unchanged");
  assert.equal(b.diagnostics.repeatRate, 0);
  assert.equal(b.diagnostics.singleSession, true);
  assert.equal(c.diagnostics.oneOffDraw, true);
  assert.equal(d.diagnostics.oneOffDraw, true);
  assert.equal(
    r.groups.find((g) => g.label === "60 to 69").repeatRate,
    100,
    "existing group opportunity denominator remains unchanged",
  );
  const duplicated = structuredClone(s);
  duplicated.data.attendance.push({ ...duplicated.data.attendance[0] });
  assert.deepEqual(
    participationPatterns(duplicated, query, "2026-11-06").rankings,
    r.rankings,
    "duplicate person-session rows do not inflate diagnostics",
  );
  const main = analytics(s.data, s.settings, {}, "2026-11-06").programmes;
  assert.equal(
    main.find((p) => p.id === "a").diagnostics.repeatRate,
    (10 / 70) * 100,
  );
  assert.equal(main.find((p) => p.id === "b").diagnostics.repeatRate, 0);
  assert.equal(JSON.stringify(s), before);
  assert.equal(JSON.stringify(r.rankings).includes("memberId"), false);
});

test("domain mix shows all four primary domains, preserves overlap and uses entries for additive shares", () => {
  const s = diagnosticFixture(),
    r = participationPatterns(s, query, "2026-11-06"),
    mix = r.domainMix;
  assert.equal(mix.unique, 20);
  assert.equal(mix.attendance, 51);
  assert.deepEqual(
    mix.rows.map((r) => r.label),
    ["Learning", "Physical", "Social", "Cognitive"],
  );
  assert.equal(mix.rows.find((r) => r.label === "Learning").unique, 20);
  assert.equal(mix.rows.find((r) => r.label === "Physical").unique, 10);
  assert.equal(mix.rows.find((r) => r.label === "Physical").attendance, 30);
  assert.equal(mix.rows.find((r) => r.label === "Cognitive").attendance, 0);
  assert.equal(mix.rows.find((r) => r.label === "Cognitive").entryShare, 0);
  assert.equal(
    mix.rows.reduce((n, r) => n + r.unique, 0),
    31,
    "people overlap across domains",
  );
  assert.ok(
    Math.abs(mix.rows.reduce((n, r) => n + r.entryShare, 0) - 100) < 0.2,
  );
  const filtered = participationPatterns(
    s,
    { ...query, domain: "Learning" },
    "2026-11-06",
  );
  assert.equal(filtered.rankings.rows.length, 1);
  assert.equal(filtered.domainMix.attendance, 20);
  assert.equal(
    filtered.domainMix.rows.find((r) => r.label === "Learning").entryShare,
    100,
  );
  const empty = participationPatterns(
    s,
    { ...query, from: "2026-11-04" },
    "2026-11-06",
  );
  assert.equal(empty.domainMix.unique, 0);
  assert.equal(empty.domainMix.attendance, 0);
  assert.ok(empty.domainMix.rows.every((r) => r.entryShare === null));
  const noHistory = structuredClone(s);
  noHistory.data.sessions = [];
  noHistory.data.attendance = [];
  assert.equal(
    participationPatterns(noHistory, query, "2026-11-06").domainMix.available,
    false,
  );
});

test("incomplete/attendance-only registries and protected cells never gain representation or hidden domain totals", () => {
  for (const scope of ["overall", "seniors", "attendingClients"]) {
    const r = participationPatterns(
      diagnosticFixture(),
      { ...query, scope },
      "2026-11-06",
    );
    assert.ok(r.rankings.rows.every((p) => p.representation === null));
  }
  const partial = diagnosticFixture();
  partial.settings.registry.complete = false;
  assert.ok(
    participationPatterns(partial, query, "2026-11-06").rankings.rows.every(
      (p) => p.representation === null,
    ),
  );
  const protectedState = diagnosticFixture();
  protectedState.settings.staffAnalysisFull = false;
  const r = participationPatterns(
    protectedState,
    { ...query, second: "cfs" },
    "2026-11-06",
  );
  assert.equal(r.rankings.suppressed, true);
  assert.equal(r.domainMix.suppressed, true);
  assert.deepEqual(r.domainMix.rows, []);
  assert.equal(r.domainMix.attendance, null);
  const families = participationPatterns(protectedState, query, "2026-11-06");
  assert.equal(families.domainMix.suppressed, true);
  assert.equal(families.domainMix.attendance, null);
  assert.equal(families.domainMix.rows.length, 0);
});

test("released programme rows cannot expose a withheld registry margin or repeat count through representation/domain entries", () => {
  const s = diagnosticFixture();
  s.settings.staffAnalysisFull = false;
  s.data.participants[99].age = 85;
  s.registry[99].details = JSON.stringify(s.data.participants[99]);
  const protectedMargin = participationPatterns(
    s,
    { ...query, group: "70 to 79" },
    "2026-11-06",
  );
  assert.ok(protectedMargin.rankings.rows.length > 0);
  assert.ok(protectedMargin.groups.some((g) => g.suppressed));
  assert.ok(
    protectedMargin.rankings.rows.every((p) => p.representation === null),
  );
  const repeats = diagnosticFixture();
  repeats.settings.staffAnalysisFull = false;
  repeats.data.programmes = repeats.data.programmes.filter((p) =>
    ["a", "b"].includes(p.id),
  );
  repeats.data.sessions = repeats.data.sessions.filter((s) =>
    ["a", "b"].includes(s.programmeId),
  );
  repeats.data.attendance = [];
  repeats.data.participants.forEach((p, i) => {
    const ids =
      i < 20 ? ["a1", "b1", ...(i === 0 ? ["a2"] : [])] : i < 80 ? ["a1"] : [];
    ids.forEach((sessionId) =>
      repeats.data.attendance.push({ participantId: p.id, sessionId }),
    );
  });
  const r = participationPatterns(repeats, query, "2026-11-06");
  const programme = r.rankings.rows.find((p) => p.id === "a");
  assert.ok(programme);
  assert.equal(programme.repeat, null);
  assert.equal(programme.diagnostics.repeatRate, null);
  assert.equal(programme.diagnostics.oneOffDraw, null);
  assert.equal(r.domainMix.suppressed, false);
  assert.equal(r.domainMix.unique, 20);
  assert.equal(r.domainMix.attendance, null);
  assert.ok(
    r.domainMix.rows.every(
      (d) => d.attendance === null && d.entryShare === null,
    ),
  );
});
