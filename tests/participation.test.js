import test from "node:test";
import assert from "node:assert/strict";
import { participationReport } from "../server/participation.js";
import { defaults, analytics } from "../server/domain.js";
const filters = { from: "2026-11-01", to: "2026-11-30" };
function fixture() {
  const participants = [
    { id: "PRIVATE-A", age: 75, gender: "MALE", race: "MALAY", client: true },
    {
      id: "PRIVATE-B",
      age: 75,
      gender: "FEMALE",
      race: "CHINESE",
      client: false,
    },
    { id: "PRIVATE-C", age: 19, gender: "MALE", race: "INDIAN", client: false },
    {
      id: "PRIVATE-D",
      age: 70,
      gender: "FEMALE",
      race: "UNKNOWN",
      client: null,
    },
    {
      id: "NEVER-ATTENDED",
      age: 70,
      gender: "MALE",
      race: "MALAY",
      client: true,
    },
  ];
  const programmes = [1, 2, 3].map((n) => ({
    id: "p" + n,
    name: "Programme " + n,
    domain: "Social",
    optional: {},
  }));
  const rows = [
    ["PRIVATE-A", 1, "2026-10-01"],
    ["PRIVATE-A", 2, "2026-10-02"],
    ["PRIVATE-A", 3, "2026-10-03"],
    ["PRIVATE-B", 1, "2026-10-01"],
    ["PRIVATE-A", 1, "2026-11-02"],
    ["PRIVATE-B", 1, "2026-11-02"],
    ["PRIVATE-B", 1, "2026-11-03"],
    ["PRIVATE-C", 2, "2026-11-03"],
    ["PRIVATE-D", 3, "2026-11-03"],
    ["PRIVATE-C", 1, "2026-11-05"],
    ["PRIVATE-C", 3, "2026-11-05"],
  ];
  const sessions = [
    ...new Map(
      rows.map(([, p, date]) => [
        p + date,
        { id: p + date, programmeId: "p" + p, date, start: 540, end: 600 },
      ]),
    ).values(),
  ];
  return {
    participants,
    programmes,
    sessions,
    attendance: rows.map(([id, p, date]) => ({
      id: id + p + date,
      participantId: id,
      sessionId: p + date,
    })),
  };
}
test("daily/monthly sheet uses client IB/OB, row denominators and deduplicated totals", () => {
  const data = fixture(),
    r = participationReport(data, defaults, filters, "2026-11", "2026-11-04");
  const second = r.rows.find((d) => d.date === "2026-11-02"),
    third = r.rows.find((d) => d.date === "2026-11-03");
  assert.equal(second.week, 1);
  assert.equal(r.rows.find((d) => d.date === "2026-11-09").week, 2);
  assert.equal(second.counts.unique, 2);
  assert.equal(second.counts.ib, 1);
  assert.equal(second.counts.ob, 1);
  assert.equal(second.counts.ibPct, 50);
  assert.equal(third.counts.unique, 3);
  assert.equal(third.counts.ob, 2);
  assert.equal(third.counts.unknownClient, 1);
  assert.equal(r.monthSummary.unique, 4);
  assert.equal(r.monthSummary.attendance, 5);
  assert.equal(r.monthSummary.programmes, 3);
  assert.equal(r.monthSummary.male, 2);
  assert.equal(r.monthSummary.malePct, 50);
  assert.equal(r.monthSummary.minority, 2);
  assert.equal(
    analytics(data, defaults, filters, "2026-11-04", true).summary.unique,
    3,
    "Senior headline excludes the 19-year-old while the daily sheet includes recorded ages",
  );
  for (const row of r.rows.filter((d) => d.date > "2026-11-04"))
    assert.equal(row.counts, null);
  assert.equal(JSON.stringify(r).includes("PRIVATE-"), false);
});
test("inactive is at most two distinct programmes across full history, with repeat visits and future records handled correctly", () => {
  const data = fixture(),
    r = participationReport(data, defaults, filters, "2026-11", "2026-11-04");
  assert.equal(r.rows.find((d) => d.date === "2026-11-02").counts.inactive, 1);
  assert.equal(r.rows.find((d) => d.date === "2026-11-03").counts.inactive, 3);
  assert.equal(
    r.monthSummary.inactive,
    3,
    "B is counted once in the monthly total and never-attended profiles are excluded",
  );
  const selected = participationReport(
    data,
    defaults,
    { ...filters, programme: "p1" },
    "2026-11",
    "2026-11-04",
  );
  assert.equal(selected.monthSummary.unique, 2);
  assert.equal(
    selected.monthSummary.inactive,
    1,
    "Filtering to one programme must not erase A's three-programme history",
  );
  const entire = participationReport(
    data,
    defaults,
    { from: "2026-10-01", to: "2026-11-04" },
    "2026-11",
    "2026-11-04",
  );
  assert.equal(entire.monthly[0].inactive, 1);
  assert.equal(entire.summary.inactive, 3);
  assert.equal(entire.summary.unique, 4);
});
test("selecting an earlier month or shorter period does not reset the all-history programme count", () => {
  const r = participationReport(
    fixture(),
    defaults,
    { from: "2026-10-01", to: "2026-10-02" },
    "2026-10",
    "2026-11-04",
  );
  assert.equal(r.summary.unique, 2);
  assert.equal(
    r.summary.inactive,
    1,
    "A's third programme on 3 October remains part of all available history even when the displayed period ends on 2 October",
  );
  assert.equal(r.summary.asOf, "2026-11-03");
});
