import test from "node:test";
import assert from "node:assert/strict";
import {
  depthSegment,
  recencyBucket,
  summariseEngagement,
  engagementOptions,
  engagementLabels,
} from "../shared/engagement-depth.js";
const anchor = "2026-11-06";
const before = (days) =>
  new Date(Date.parse(anchor) - days * 86400000).toISOString().slice(0, 10);

test("depth separates no recorded history, zero matching sessions, one-time, occasional and regular", () => {
  assert.equal(depthSegment(0, null, anchor), "noHistory");
  assert.equal(depthSegment(0, "2026-10-01", anchor), "outsideView");
  for (const n of [1, 2, 5, 6, 20])
    assert.equal(
      depthSegment(n, anchor, anchor),
      n === 1 ? "oneTime" : n < 6 ? "occasional" : "regular",
    );
  assert.equal(
    depthSegment(6, anchor, anchor, { regularFrom: 8 }),
    "occasional",
  );
  assert.equal(depthSegment(8, anchor, anchor, { regularFrom: 8 }), "regular");
  for (const n of [null, undefined, -1, 1.5, "1"])
    assert.equal(depthSegment(n, anchor, anchor), "unavailable");
  assert.equal(depthSegment(0, undefined, anchor), "unavailable");
  assert.equal(depthSegment(0, "bad", anchor), "unavailable");
  assert.equal(depthSegment(0, "2026-11-07", anchor), "unavailable");
  assert.equal(depthSegment(0, null, null), "unavailable");
});
test("recency is reproducible at coverage end with exact 30/60/90-day boundaries and separate missing history", () => {
  for (const [days, expected] of [
    [0, "within30"],
    [30, "within30"],
    [31, "days31to60"],
    [60, "days31to60"],
    [61, "days61to90"],
    [90, "days61to90"],
    [91, "over90"],
    [300, "over90"],
  ])
    assert.equal(recencyBucket(before(days), anchor), expected);
  assert.equal(recencyBucket(null, anchor), "noHistory");
  for (const last of [undefined, "", "2026-02-30", "2026-11-07"])
    assert.equal(recencyBucket(last, anchor), "unavailable");
  assert.equal(recencyBucket(null, null), "unavailable");
  assert.equal(recencyBucket("2024-02-29", "2024-03-30"), "within30");
});
test("summaries return only exhaustive aggregate counts/percentages, preserve missing values and never mutate records", () => {
  const records = [
    { sessions: 0, last: null },
    { sessions: 0, last: before(91) },
    { sessions: 1, last: before(31) },
    { sessions: 5, last: before(61) },
    { sessions: 6, last: before(30) },
    { sessions: undefined, last: undefined },
  ];
  const snapshot = JSON.stringify(records),
    summary = summariseEngagement(records, anchor);
  assert.equal(summary.population, 6);
  assert.ok(summary.depth.every((c) => c.count === 1));
  assert.equal(
    summary.depth.reduce((n, c) => n + c.count, 0),
    6,
  );
  assert.equal(
    summary.recency.reduce((n, c) => n + c.count, 0),
    6,
  );
  assert.equal(summary.depth[0].percentage, 16.7);
  assert.equal(JSON.stringify(records), snapshot);
  assert.equal(Object.hasOwn(summary, "records"), false);
  assert.equal(summariseEngagement(records, null), null);
  const empty = summariseEngagement([], anchor);
  assert.equal(empty.population, 0);
  assert.ok(empty.depth.every((c) => c.count === 0 && c.percentage === null));
  const inconsistent = summariseEngagement(
    [{ sessions: 1, last: null }],
    anchor,
  );
  assert.equal(
    inconsistent.recency.find((c) => c.id === "unavailable").count,
    1,
  );
});
test("configuration defaults and labels describe exactly the active thresholds", () => {
  assert.deepEqual(engagementOptions(), { regularFrom: 6 });
  assert.deepEqual(engagementOptions({ regularFrom: 2 }), { regularFrom: 6 });
  assert.deepEqual(engagementOptions({ regularFrom: 8 }), { regularFrom: 8 });
  assert.equal(
    engagementLabels({ regularFrom: 8 }).depth.find(
      (c) => c.id === "occasional",
    ).label,
    "Occasional (2–7 sessions)",
  );
  assert.equal(
    engagementLabels({ regularFrom: 3 }).depth.find(
      (c) => c.id === "occasional",
    ).label,
    "Occasional (2 sessions)",
  );
});
