import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile, inspectImport, defaults } from "../server/domain.js";
import { participationPatterns } from "../server/patterns.js";
const source =
  "C:/Users/CHANYULE/Downloads/member_attendances_20261105093446.xlsx";
test(
  "supplied attendance workbook supports exact screenshot dates and all-age age analysis",
  { skip: !existsSync(source) },
  async () => {
    const parsed = await readFile(readFileSync(source), source),
      rows = inspectImport(parsed, {
        participants: [],
        programmes: [],
        sessions: [],
        attendance: [],
      }).fresh;
    const state = {
      settings: defaults,
      registry: [],
      profiles: [],
      feedback: [],
      data: {
        participants: [
          ...new Map(
            rows.map((r) => [r.participant.id, r.participant]),
          ).values(),
        ],
        programmes: [
          ...new Map(rows.map((r) => [r.programme.id, r.programme])).values(),
        ],
        sessions: [
          ...new Map(rows.map((r) => [r.session.id, r.session])).values(),
        ],
        attendance: rows.map((r) => ({
          participantId: r.participant.id,
          sessionId: r.session.id,
        })),
      },
    };
    const report = participationPatterns(
      state,
      {
        dimension: "age",
        scope: "overall",
        from: "2026-05-04",
        to: "2026-11-05",
      },
      "2026-11-05",
    );
    assert.equal(report.population, 417);
    assert.equal(report.comparisonSuppressed, false);
    assert.equal(report.ratesAvailable, false);
    assert.equal(
      report.groups.find((g) => g.label === "Below 60").unique,
      state.data.participants.filter((p) => p.age != null && p.age < 60).length,
    );
    assert.equal(
      report.groups.reduce((n, g) => n + (g.unique || 0), 0),
      417,
    );
    assert.ok(report.rankings.rows.length > 0);
    assert.ok(report.rankings.rows.length <= 5);
    assert.equal(
      report.groups.some((g) => g.registered != null || g.rate != null),
      false,
    );
  },
);
