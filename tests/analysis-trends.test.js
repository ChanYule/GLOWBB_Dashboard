import test from "node:test";
import assert from "node:assert/strict";
import {
  monthlyClientTrends,
  comparisonWindow,
  periodChanges,
} from "../server/analysis-trends.js";
import { diagnosticFixture } from "./fixtures/programme-diagnostics-state.js";
import { participationPatterns } from "../server/patterns.js";
test("monthly trends use covered month anchors, existing active rules and distinct first-observed/returning clients", () => {
  const s = diagnosticFixture();
  s.data.sessions.push({ id: "oct", programmeId: "a", date: "2026-10-10" });
  s.data.attendance.push({
    participantId: s.data.participants[0].id,
    sessionId: "oct",
  });
  s.data.attendance.push({ ...s.data.attendance[0] });
  const before = JSON.stringify(s),
    r = monthlyClientTrends(s, "", "2026-11-06");
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].partial, true);
  assert.equal(r.rows[1].to, "2026-11-03");
  assert.equal(r.rows[1].firstObserved, 79);
  assert.equal(r.rows[1].returning, 1);
  assert.equal(r.rows[1].active, 80);
  assert.equal(r.rows[1].sessions, 6);
  assert.equal(JSON.stringify(s), before);
  const filtered = monthlyClientTrends(s, "Learning", "2026-11-06");
  assert.equal(
    filtered.rows[1].active,
    80,
    "active still uses full-history programmes",
  );
  assert.equal(filtered.rows[1].participants, 20);
  assert.equal(filtered.rows[1].sessions, 1);
  s.settings.staffAnalysisFull = false;
  assert.deepEqual(monthlyClientTrends(s, "", "2026-11-06").rows, []);
});
test("comparison windows use equal covered days and never fill missing prior history with zero", () => {
  const coverage = { from: "2026-10-01", to: "2026-11-03" };
  const w = comparisonWindow(
    { from: "2026-11-01", to: "2026-11-30" },
    coverage,
  );
  assert.equal(w.to, "2026-11-03");
  assert.equal(w.previousFrom, "2026-10-29");
  assert.equal(w.previousTo, "2026-10-31");
  assert.equal(w.days, 3);
  assert.equal(w.available, true);
  assert.equal(comparisonWindow({}, coverage).available, false);
  assert.equal(
    comparisonWindow({ from: "2026-12-01" }, coverage).available,
    false,
  );
  const g = (label, registered, unique) => ({
    label,
    registered,
    unique,
    rate: (unique / registered) * 100,
  });
  const current = {
      ratesAvailable: true,
      groups: [
        g("A", 20, 10),
        g("B", 20, 0),
        g("Small", 1, 1),
        g("Unknown", 40, 30),
      ],
    },
    previous = {
      ratesAvailable: true,
      groups: [
        g("A", 20, 0),
        g("B", 20, 10),
        g("Small", 1, 0),
        g("Unknown", 40, 0),
      ],
    };
  const result = periodChanges(current, previous, w);
  assert.equal(result.increases[0].differencePoints, 50);
  assert.equal(result.decreases[0].differencePoints, -50);
  assert.equal(result.excluded, 2);
  assert.equal(result.increases[0].current.n_registered, 20);
  assert.equal(periodChanges(current, null, w).available, false);
});
test("patterns attach trends only for client scope and avoid recursion; incomplete coverage stays explicit", () => {
  const s = diagnosticFixture();
  const r = participationPatterns(
    s,
    { scope: "clients", dimension: "age" },
    "2026-11-06",
  );
  assert.equal(r.trendAnalysis.monthly.rows.length, 1);
  assert.equal(r.trendAnalysis.changes.available, false);
  assert.equal(
    participationPatterns(
      s,
      { scope: "overall", dimension: "age" },
      "2026-11-06",
    ).trendAnalysis,
    null,
  );
  assert.equal(
    participationPatterns(
      s,
      { scope: "clients", dimension: "age" },
      "2026-11-06",
      { includeTrends: false },
    ).trendAnalysis,
    null,
  );
});
