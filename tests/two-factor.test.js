import test from "node:test";
import assert from "node:assert/strict";
import { twoFactorAnalysis } from "../shared/two-factor-analysis.js";
import { participationProportion } from "../shared/participation-reliability.js";
import { participationPatterns } from "../server/patterns.js";
import { locationFixture } from "./fixtures/location-state.js";

const row = (
  n,
  unique,
  groups = ["CFS 7 to 8", "Alone"],
  supportIndicators = ["Recorded living alone"],
) => ({
  groups,
  registered: n,
  unique,
  rate: n ? (unique / n) * 100 : null,
  supportIndicators,
});
const matrix = (rows, extra = {}) =>
  twoFactorAnalysis({
    combined: { suppressed: false, rows },
    dimensions: ["cfs", "living"],
    ratesAvailable: true,
    overall: participationProportion(70, 100),
    ...extra,
  });

test("two-factor cells reuse exact counts and Phase 1 ranges; findings require support indicators and non-overlap", () => {
  const rows = [row(20, 0), row(80, 70, ["CFS 4", "Family"], [])],
    before = JSON.stringify(rows);
  const result = matrix(rows),
    cell = result.cells[0];
  assert.equal(cell.n_registered, 20);
  assert.equal(cell.rate, 0);
  assert.equal(cell.upper, participationProportion(0, 20).upper);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].groups, ["CFS 7 to 8", "Alone"]);
  assert.deepEqual(result.rows, ["CFS 4", "CFS 7 to 8"]);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(
    matrix([row(20, 10)]).findings.length,
    0,
    "overlapping ranges cannot be flagged",
  );
  assert.equal(
    matrix([row(20, 0, undefined, [])]).findings.length,
    0,
    "low attendance alone is not a need indicator",
  );
  assert.equal(
    matrix([row(20, 20)]).findings.length,
    0,
    "higher rates are not low-participation findings",
  );
});

test("small, unknown, invalid, empty and unavailable cells do not become outreach findings", () => {
  for (const r of [
    row(1, 0),
    row(0, 0),
    row(20, 21),
    row(20, 0, ["Unknown", "Alone"]),
    row(20, 0, ["Custom CFS category", "Alone"]),
    row(20, 0, ["CFS 7 to 8", "Prefers not to say"]),
  ])
    assert.equal(matrix([r]).findings.length, 0);
  assert.equal(matrix([row(1, 0)]).cells[0].small, true);
  assert.equal(
    matrix([row(20, 0)], {
      reliability: { cautionMinimum: 30, comparisonFloor: 10 },
    }).findings.length,
    0,
  );
  const unavailable = matrix([row(20, 0)], { ratesAvailable: false });
  assert.equal(unavailable.cells[0].n_registered, 20);
  assert.equal(unavailable.cells[0].rate, null);
  assert.equal(unavailable.cells[0].upper, null);
  assert.deepEqual(unavailable.findings, []);
  const attendance = matrix([{ ...row(null, 3), rate: null }], {
    ratesAvailable: false,
  });
  assert.equal(attendance.cells[0].n_registered, null);
  assert.equal(attendance.cells[0].n_participating, 3);
  assert.deepEqual(matrix([]).cells, []);
  assert.equal(matrix([row(20, 0)], { overall: null }).findings.length, 0);
});

test("withheld combinations cannot expose labels, counts, ranges, support flags or overall margins", () => {
  const r = matrix([], { combined: { suppressed: true, rows: [row(1, 0)] } });
  assert.equal(r.status, "withheld");
  assert.deepEqual(r.cells, []);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.columns, []);
  assert.deepEqual(r.findings, []);
  assert.equal(r.overall, null);
  assert.equal(matrix([], { combined: null }), null);
});

function fixture() {
  const s = locationFixture();
  s.settings.staffAnalysisFull = true;
  s.data.attendance = [];
  s.data.participants.forEach((p, i) => {
    p.cfs = i < 20 ? "7-8" : "4";
    p.livingRaw = i < 20 ? "Alone" : "Family";
    p.riskRaw = "0";
    s.registry[i].details = JSON.stringify(p);
    if (i >= 20 && i < 90)
      for (const sessionId of ["s1", "s1", "s2"])
        s.data.attendance.push({ participantId: p.id, sessionId });
  });
  return s;
}

test("two-factor report uses the full eligible registry and deduplicated participation, following period/domain/basis", () => {
  const s = fixture(),
    before = JSON.stringify(s),
    query = { scope: "clients", dimension: "cfs", second: "living" };
  const r = participationPatterns(s, query, "2026-11-06");
  assert.equal(r.twoFactor.overall.n_registered, 100);
  assert.equal(r.twoFactor.overall.n_participating, 70);
  assert.equal(r.twoFactor.findings.length, 1);
  assert.equal(
    r.twoFactor.cells.find((c) => c.groups[0] === "CFS 7 to 8").n_registered,
    20,
  );
  assert.deepEqual(r.twoFactor.findings[0].supportIndicators, [
    "Recorded CFS at or above 7",
    "Recorded living alone",
  ]);
  assert.equal(JSON.stringify(r.twoFactor).includes("client-"), false);
  assert.equal(JSON.stringify(r.twoFactor).includes("memberId"), false);
  const social = participationPatterns(
    s,
    { ...query, domain: "Social" },
    "2026-11-06",
  );
  assert.equal(social.twoFactor.overall.n_participating, 0);
  assert.equal(social.twoFactor.findings.length, 0);
  const period = participationPatterns(
    s,
    { ...query, from: "2026-11-03", to: "2026-11-03" },
    "2026-11-06",
  );
  assert.equal(period.twoFactor.overall.n_participating, 0);
  const dated = participationPatterns(
    s,
    { ...query, basis: "dated" },
    "2026-11-06",
  );
  assert.equal(dated.twoFactor.findings.length, 0);
  assert.ok(dated.twoFactor.cells.every((c) => c.unknown));
  const overall = participationPatterns(
    s,
    { ...query, scope: "overall" },
    "2026-11-06",
  );
  assert.equal(overall.twoFactor.status, "unavailable");
  assert.equal(overall.twoFactor.cells[0].n_registered, null);
  assert.equal(overall.twoFactor.cells[0].rate, null);
  const partial = structuredClone(s);
  partial.settings.registry.complete = false;
  assert.equal(
    participationPatterns(partial, query, "2026-11-06").twoFactor.status,
    "unavailable",
  );
  assert.equal(JSON.stringify(s), before);
});

test("support labels use actual profiles and selected factors, not age, unknown SRF ordering or unrelated individual indicators", () => {
  const s = fixture(),
    query = { scope: "clients", dimension: "age", second: "gender" };
  assert.ok(
    participationPatterns(s, query, "2026-11-06").twoFactor.cells.every(
      (c) => c.supportIndicators.length === 0,
    ),
  );
  for (const p of s.data.participants) {
    p.riskRaw = ">1";
    s.registry.find((r) => r.participant_id === p.id).details =
      JSON.stringify(p);
  }
  assert.ok(
    participationPatterns(
      s,
      { ...query, dimension: "risk" },
      "2026-11-06",
    ).twoFactor.cells.every((c) => c.supportIndicators.length === 0),
  );
  const protectedState = structuredClone(s);
  protectedState.settings.staffAnalysisFull = false;
  protectedState.data.participants[0].cfs = "6";
  protectedState.registry[0].details = JSON.stringify(
    protectedState.data.participants[0],
  );
  const protectedReport = participationPatterns(
    protectedState,
    { ...query, dimension: "cfs", second: "living" },
    "2026-11-06",
  );
  assert.equal(protectedReport.twoFactor.status, "withheld");
  assert.deepEqual(protectedReport.twoFactor.cells, []);
  assert.equal(protectedReport.twoFactor.overall, null);
});
