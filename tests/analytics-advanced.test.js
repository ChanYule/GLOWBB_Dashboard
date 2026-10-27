import test from "node:test";
import assert from "node:assert/strict";
import {
  analytics,
  defaults,
  HEADERS,
  parseRows,
  inspectImport,
} from "../server/domain.js";

function source(records) {
  const parsed = parseRows([
    HEADERS,
    ...records.map(
      ({
        id,
        date,
        programme = "Movement",
        domain = "Physical",
        age = "65",
        gender = "MALE",
        race = "MALAY",
        start = "09:00 AM",
        end = "10:00 AM",
      }) => [
        id,
        gender,
        age,
        race,
        "",
        "YES",
        "YES",
        programme,
        domain,
        `${date}, ${start} - ${end}`,
      ],
    ),
  ]);
  assert.equal(parsed.issues.length, 0);
  const { fresh } = inspectImport(parsed, {
    participants: [],
    programmes: [],
    sessions: [],
    attendance: [],
  });
  return {
    participants: [
      ...new Map(fresh.map((r) => [r.participant.id, r.participant])).values(),
    ],
    programmes: [
      ...new Map(fresh.map((r) => [r.programme.id, r.programme])).values(),
    ],
    sessions: [
      ...new Map(
        fresh.map((r) => [
          r.session.id,
          { ...r.session, programmeId: r.programme.id },
        ]),
      ).values(),
    ],
    attendance: fresh.map((r) => ({
      id: r.id,
      participantId: r.participant.id,
      sessionId: r.session.id,
    })),
  };
}
test("daily, weekly and monthly first-observed counts use full history and each bucket's dates", () => {
  const data = source([
    { id: "old", date: "2026-04-01" },
    { id: "old", date: "2026-05-04", programme: "Social", domain: "Social" },
    { id: "new", date: "2026-05-04", programme: "Social", domain: "Social" },
    { id: "new", date: "2026-05-05", programme: "Social", domain: "Social" },
    { id: "later", date: "2026-06-01", programme: "Social", domain: "Social" },
  ]);
  const f = { from: "2026-05-01", to: "2026-06-01", domain: "Social" };
  const result = analytics(
    data,
    defaults,
    { ...f, interval: "day" },
    "2026-10-27",
  );
  assert.equal(result.summary.unique, 3);
  assert.equal(result.summary.firstObserved, 2);
  assert.equal(result.summary.returning, 1);
  assert.equal(
    result.trends.find((r) => r.label === "2026-05-04").firstObserved,
    1,
  );
  assert.equal(
    result.trends.find((r) => r.label === "2026-05-05").firstObserved,
    0,
  );
  assert.equal(
    result.trends.find((r) => r.label === "2026-05-05").returning,
    1,
  );
  assert.equal(
    result.trends.find((r) => r.label === "2026-05-06").attendance,
    0,
  );
  const month = analytics(data, defaults, f, "2026-10-27");
  assert.equal(month.trends[0].firstObserved, 1);
  assert.equal(month.trends[1].firstObserved, 1);
  const week = analytics(
    data,
    defaults,
    { ...f, interval: "week" },
    "2026-10-27",
  );
  assert.equal(
    week.trends.find((r) => r.label === "2026-05-04").firstObserved,
    1,
  );
});
test("engagement and portfolio counts deduplicate people while attendance stays additive", () => {
  const data = source([
    { id: "one", date: "2026-05-04" },
    { id: "one", date: "2026-05-04" },
    { id: "one", date: "2026-05-05", programme: "Coffee", domain: "Social" },
    { id: "two", date: "2026-05-05", programme: "Coffee", domain: "Social" },
    {
      id: "child",
      date: "2026-05-05",
      programme: "Coffee",
      domain: "Social",
      age: "45",
    },
  ]);
  const report = analytics(data, defaults, {}, "2026-10-27");
  assert.equal(report.summary.attendance, 4);
  assert.equal(report.summary.allAges, 3);
  assert.equal(report.summary.unique, 2);
  assert.equal(report.summary.repeatRate, 50);
  assert.equal(report.summary.multiProgramme, 1);
  assert.equal(report.summary.multiDomain, 1);
  assert.equal(report.summary.programmes, 2);
  assert.equal(
    report.domains.reduce((n, d) => n + d.attendance, 0),
    4,
  );
  assert.equal(
    report.domains.reduce((n, d) => n + d.unique, 0),
    3,
  );
});
test("empty datasets and missing demographics keep meaningful denominators", () => {
  const empty = analytics(source([]), defaults, {}, "2026-10-27");
  assert.equal(empty.summary.repeatRate, null);
  assert.deepEqual(empty.insights, []);
  const report = analytics(
    source([{ id: "missing", date: "2026-05-04", gender: "", race: "" }]),
    defaults,
    {},
    "2026-10-27",
  );
  assert.equal(report.summary.unique, 1);
  assert.equal(report.summary.malePct, null);
  assert.equal(report.summary.minorityPct, null);
  assert.ok(report.insights.some((i) => i.category === "quality"));
  assert.ok(report.insights.some((i) => i.title === "Build a clearer picture"));
  assert.ok(
    !report.insights.some((i) =>
      ["positive", "opportunity"].includes(i.category),
    ),
  );
});
test("timing insights require enough observations in at least two cells, and duration uses real session times", () => {
  const rows = [];
  for (const date of ["2026-05-04", "2026-05-11", "2026-05-18"])
    for (let i = 0; i < 5; i++)
      rows.push({ id: `person-${i}`, date, end: "09:30 AM" });
  rows.push({
    id: "person-0",
    date: "2026-05-05",
    start: "01:00 PM",
    end: "02:30 PM",
  });
  const limited = analytics(source(rows), defaults, {}, "2026-10-27");
  assert.ok(!limited.insights.some((i) => i.title.startsWith("Timing")));
  assert.equal(
    limited.duration.find((d) => d.label === "Under 45 min").average,
    5,
  );
  assert.equal(limited.duration.find((d) => d.label === "90+ min").sessions, 1);
  for (const date of ["2026-05-05", "2026-05-12", "2026-05-19"])
    for (let i = 0; i < 5; i++)
      rows.push({
        id: `person-${i}`,
        date,
        start: "01:00 PM",
        end: "02:30 PM",
      });
  const enough = analytics(source(rows), defaults, {}, "2026-10-27");
  assert.ok(
    enough.insights.some((i) => i.title === "Timing to explore, not a cause"),
  );
});
test("gaps between months do not generate adjacent-month decline recommendations", () => {
  const rows = [];
  for (const month of ["05", "07"])
    for (const day of ["04", "11", "18"])
      for (let i = 0; i < (month === "05" ? 10 : 5); i++)
        rows.push({ id: `person-${i}`, date: `2026-${month}-${day}` });
  const report = analytics(
    source(rows),
    defaults,
    { from: "2026-05-01", to: "2026-07-31" },
    "2026-10-27",
  );
  assert.notEqual(report.recommendations[0].category, "Improve");
});
test("summary-only calculations match full analytics for targets and comparisons", () => {
  const data = source([
    { id: "a", date: "2026-05-04" },
    { id: "a", date: "2026-05-05" },
  ]);
  assert.deepEqual(
    analytics(data, defaults, {}, "2026-10-27", true).summary,
    analytics(data, defaults, {}, "2026-10-27").summary,
  );
});
