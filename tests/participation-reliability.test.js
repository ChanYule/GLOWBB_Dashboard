import test from "node:test";
import assert from "node:assert/strict";
import {
  participationProportion,
  reliableGroup,
  reliabilityOptions,
  sortGroups,
  poolSmallGroups,
  comparisonInsight,
  unknownGroup,
} from "../shared/participation-reliability.js";
const group = (label, unique, registered) => ({
  label,
  unique,
  registered,
  rate: registered ? (unique / registered) * 100 : null,
  suppressed: false,
});
const close = (actual, expected, tolerance = 0.001) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} ~= ${expected}`,
  );

test("Wilson reference values and symmetric boundary cases preserve exact counts and valid zero rates", () => {
  const p = participationProportion(80, 100);
  assert.equal(p.n_registered, 100);
  assert.equal(p.n_participating, 80);
  assert.equal(p.rate, 80);
  close(p.lower, 71.117086);
  close(p.upper, 86.663325);
  assert.equal(participationProportion(0, 1).lower, 0);
  close(participationProportion(0, 1).upper, 79.345069);
  assert.equal(participationProportion(1, 1).upper, 100);
  close(participationProportion(1, 1).lower, 20.654931);
  const zero = participationProportion(0, 20);
  assert.equal(zero.rate, 0);
  assert.ok(zero.upper > 0);
  assert.equal(participationProportion(20, 20).rate, 100);
  assert.ok(participationProportion(20, 20).lower < 100);
  assert.ok(
    participationProportion(10, 100).upper -
      participationProportion(10, 100).lower <
      participationProportion(1, 10).upper -
        participationProportion(1, 10).lower,
  );
});

test("missing, invalid and zero denominators never become fabricated zero rates", () => {
  for (const [a, n] of [
    [null, 20],
    [0, null],
    [undefined, 3],
    [-1, 20],
    [21, 20],
    [1, 0],
    [1.5, 20],
    [1, "20"],
    [true, 1],
    [1, Infinity],
  ]) {
    const p = participationProportion(a, n);
    assert.equal(p.rate, null);
    assert.equal(p.lower, null);
    assert.equal(p.n_participating, null);
  }
  assert.deepEqual(participationProportion(0, 0), {
    n_registered: 0,
    n_participating: 0,
    rate: null,
    lower: null,
    upper: null,
  });
});

test("caution and comparison floor remain separate from exact visibility, with configurable boundaries", () => {
  for (const [n, eligible, small] of [
    [1, false, true],
    [9, false, true],
    [10, true, true],
    [19, true, true],
    [20, true, false],
  ]) {
    const g = reliableGroup(group("Known", 0, n));
    assert.equal(g.registered, n);
    assert.equal(g.eligible, eligible);
    assert.equal(g.small, small);
  }
  assert.equal(reliableGroup(group("Missing", 5, 20)).eligible, false);
  assert.equal(
    reliableGroup({ ...group("Hidden", 5, 20), suppressed: true }).rate,
    null,
  );
  assert.equal(
    reliableGroup(group("A", 2, 12), {
      comparisonFloor: 15,
      cautionMinimum: 30,
    }).eligible,
    false,
  );
  assert.deepEqual(reliabilityOptions(), {
    cautionMinimum: 20,
    comparisonFloor: 10,
  });
  assert.deepEqual(
    reliabilityOptions({ cautionMinimum: 5, comparisonFloor: 10 }),
    { cautionMinimum: 5, comparisonFloor: 5 },
  );
});

test("natural ordering handles numeric blocks, age bands and ordered CFS without sorting input in place", () => {
  const blocks = [
    group("Block 100", 2, 20),
    group("Block 9", 5, 30),
    group("Block 10", 8, 40),
  ];
  assert.deepEqual(
    sortGroups(blocks).map((g) => g.label),
    ["Block 9", "Block 10", "Block 100"],
  );
  assert.equal(blocks[0].label, "Block 100");
  assert.equal(sortGroups(blocks, "rate")[0].label, "Block 10");
  assert.equal(sortGroups(blocks, "size")[0].label, "Block 10");
  assert.deepEqual(
    sortGroups(
      ["80 and above", "Below 60", "70 to 79", "Missing", "60 to 69"].map(
        (label) => ({ label }),
      ),
      "label",
      "age",
    ).map((g) => g.label),
    ["Below 60", "60 to 69", "70 to 79", "80 and above", "Missing"],
  );
  assert.deepEqual(
    sortGroups(
      ["CFS 7 to 8", "CFS 4", "CFS 1 to 3", "CFS 6", "CFS 5"].map((label) => ({
        label,
      })),
      "label",
      "cfs",
    ).map((g) => g.label),
    ["CFS 1 to 3", "CFS 4", "CFS 5", "CFS 6", "CFS 7 to 8"],
  );
});

test("recorded unverified block labels are known categories; unknown locations remain separate", () => {
  assert.equal(
    unknownGroup("Block 212 (unverified; address not assumed)"),
    false,
  );
  for (const label of [
    "Missing",
    "Distance unknown",
    "Block unknown (unverified; address not assumed)",
    "Unverified residential address",
  ])
    assert.equal(unknownGroup(label), true);
  assert.equal(
    comparisonInsight(
      [
        group("Block 212 (unverified; address not assumed)", 5, 20),
        group("Block 213 (unverified; address not assumed)", 10, 40),
      ],
      { dimension: "block" },
    ).eligibleCount,
    2,
  );
});

test("pooling uses weighted disjoint counts, never hidden/unknown values, and keeps original records unchanged", () => {
  const groups = [
    group("A", 1, 3),
    group("B", 7, 17),
    group("C", 2, 40),
    group("Missing", 10, 15),
    { label: "Hidden", suppressed: true },
  ];
  const snapshot = JSON.stringify(groups),
    pooled = poolSmallGroups(groups);
  assert.equal(pooled.registered, 20);
  assert.equal(pooled.unique, 8);
  assert.equal(pooled.rate, 40);
  assert.deepEqual(pooled.sourceLabels, ["A", "B"]);
  assert.equal(JSON.stringify(groups), snapshot);
  assert.equal(poolSmallGroups([group("A", 0, 5), group("B", 1, 20)]), null);
  const insight = comparisonInsight(groups, { pool: true });
  assert.equal(insight.eligibleCount, 2);
  assert.equal(insight.rows.length, groups.length);
});

test("insight text explains tiny samples, exact exclusions, overlapping ranges and clearer non-causal differences", () => {
  const small = comparisonInsight([
    group("A", 0, 1),
    group("B", 2, 9),
    group("Missing", 1, 25),
  ]);
  assert.match(small.answer, /Not enough comparable groups: 0/);
  assert.match(small.answer, /2 of 3 groups have fewer than 10/);
  assert.equal(small.poolAvailable, true);
  const overlap = comparisonInsight([group("A", 2, 15), group("B", 19, 37)]);
  assert.equal(overlap.overlap, true);
  assert.match(overlap.answer, /ranges overlap/);
  assert.match(overlap.answer, /Small group, interpret with caution/);
  const clear = comparisonInsight([group("A", 10, 100), group("B", 90, 100)]);
  assert.equal(clear.overlap, false);
  assert.match(clear.answer, /do not overlap/);
  assert.match(
    clear.answer,
    /not proof of a cause or a formal significance test/,
  );
  assert.match(
    comparisonInsight([group("A", 0, 20), group("B", 0, 30)]).answer,
    /same recorded participation rate \(0%\)/,
  );
  assert.match(
    comparisonInsight(
      [
        group("CFS 1 to 3", 60, 100),
        group("CFS 5", 90, 100),
        group("CFS 7 to 8", 20, 100),
      ],
      { dimension: "cfs" },
    ).answer,
    /does not establish a trend or cause/,
  );
});
