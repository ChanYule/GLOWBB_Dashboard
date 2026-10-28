import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  operationsReport,
  parseAssessmentTotals,
  assessmentHeaders,
  monthlyPlan,
} from "../server/operations.js";
import { defaults, readMatrix } from "../server/domain.js";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";

const now = "2026-10-28";
function data() {
  return {
    participants: [
      {
        id: "a",
        age: 65,
        gender: "MALE",
        race: "CHINESE",
        client: true,
        boundary: false,
      },
      {
        id: "b",
        age: 45,
        gender: "FEMALE",
        race: "MALAY",
        client: false,
        boundary: true,
      },
      {
        id: "c",
        age: null,
        gender: "UNKNOWN",
        race: "MISSING",
        client: null,
        boundary: null,
      },
    ],
    programmes: [
      { id: "p", name: "Programme", domain: "Social" },
      { id: "q", name: "Other", domain: "Physical" },
    ],
    sessions: ["2026-04-01", "2026-05-01", "2026-05-02", "2026-06-01"].map(
      (date, i) => ({
        id: `s${i}`,
        programmeId: i === 0 ? "q" : "p",
        date,
        start: 540,
        end: 600,
      }),
    ),
    attendance: [
      { id: "0", participantId: "a", sessionId: "s0" },
      { id: "1", participantId: "a", sessionId: "s1" },
      { id: "2", participantId: "a", sessionId: "s2" },
      { id: "3", participantId: "b", sessionId: "s1" },
      { id: "4", participantId: "b", sessionId: "s3" },
      { id: "5", participantId: "c", sessionId: "s2" },
    ],
  };
}
const ledger = [
  {
    id: 1,
    month: "2026-05",
    type: "SPPB",
    total: 10,
    reported_as_of: "2026-06-01",
    complete: 1,
  },
  {
    id: 2,
    month: "2026-05",
    type: "TANITA",
    total: 20,
    reported_as_of: "2026-06-01",
    complete: 1,
  },
];
test("IB and OB follow client status independently of boundary; all-age shares use unique people", () => {
  const r = operationsReport(
    data(),
    defaults,
    { from: "2026-05-01", to: "2026-06-30" },
    ledger,
    {},
    "month",
    now,
  );
  assert.equal(r.summary.unique, 3);
  assert.equal(r.summary.attendance, 5);
  assert.equal(r.summary.ib, 1);
  assert.equal(r.summary.ob, 1);
  assert.equal(r.summary.unknownClient, 1);
  for (const value of [r.summary.ibPct, r.summary.obPct, r.summary.malePct])
    assert.ok(Math.abs(value - 100 / 3) < 1e-10);
  assert.equal(r.summary.newIb, 0);
  assert.equal(r.summary.newOb, 1);
  assert.equal(r.summary.firstObserved, 2);
  assert.equal(r.summary.returning, 1);
  assert.equal(r.summary.sessions, 3);
  assert.equal(r.summary.programmes, 1);
  assert.equal(r.summary.average, 5 / 3);
  assert.ok(Math.abs(r.summary.repeatRate - 200 / 3) < 1e-10);
  assert.equal(
    r.monthly.reduce((n, m) => n + m.unique, 0),
    4,
  ); // Monthly people overlap; overall stays 3.
});

function screeningData() {
  const fixture = data();
  fixture.programmes[0].name = "GLOW - SPPB Assessment";
  fixture.programmes[1].name = "GLOW - Tanita Body Measurements";
  fixture.programmes.push({
    id: "briefing",
    name: "GLOW - SPPB Assessment briefing",
    domain: "Social",
  });
  fixture.sessions.push(
    {
      id: "tanitaMay",
      programmeId: "q",
      date: "2026-05-02",
      start: 600,
      end: 660,
    },
    {
      id: "tanitaJune",
      programmeId: "q",
      date: "2026-06-01",
      start: 600,
      end: 660,
    },
    {
      id: "briefing",
      programmeId: "briefing",
      date: "2026-05-02",
      start: 660,
      end: 720,
    },
    {
      id: "future",
      programmeId: "p",
      date: "2026-11-01",
      start: 600,
      end: 660,
    },
  );
  fixture.attendance.push(
    { id: "tm1", participantId: "b", sessionId: "tanitaMay" },
    { id: "tm2", participantId: "c", sessionId: "tanitaMay" },
    { id: "tj1", participantId: "c", sessionId: "tanitaJune" },
    { id: "brief", participantId: "a", sessionId: "briefing" },
    { id: "future", participantId: "a", sessionId: "future" },
  );
  return fixture;
}
test("screening activities count unique people daily and monthly, combining clients/non-clients and missing ages", () => {
  const r = operationsReport(
    screeningData(),
    defaults,
    { from: "2026-05-01", to: "2026-06-30" },
    [],
    {},
    "month",
    now,
  );
  assert.equal(r.activityScreening.sppb.people, 3);
  assert.equal(r.activityScreening.sppb.attendance, 5);
  assert.equal(r.activityScreening.tanita.people, 2);
  assert.equal(r.activityScreening.monthly[0].sppbPeople, 3);
  assert.equal(r.activityScreening.monthly[1].sppbPeople, 1);
  assert.equal(
    r.activityScreening.daily.find((d) => d.label === "2026-05-01").sppbPeople,
    2,
  );
  assert.equal(
    r.activityScreening.daily.find((d) => d.label === "2026-05-02").sppbPeople,
    2,
  );
  assert.equal(
    r.activityScreening.daily
      .filter((d) => d.label.startsWith("2026-05"))
      .reduce((sum, d) => sum + d.sppbPeople, 0),
    4,
  ); // Daily people are not summed into monthly people.
  assert.equal(
    r.activityScreening.daily.find((d) => d.label === "2026-05-02")
      .tanitaPeople,
    2,
  );
  assert.equal(r.summary.sppbPeople, 3);
  assert.equal(r.summary.sppb, null); // Reported assessment counts remain a separate source.
});
test("screening participant counts respect actual dates and filters without merging reported totals", () => {
  const r = operationsReport(
    screeningData(),
    defaults,
    { from: "2026-05-02", to: "2026-05-02" },
    ledger,
    {},
    "day",
    now,
  );
  assert.equal(r.activityScreening.sppb.people, 2);
  assert.equal(r.activityScreening.tanita.people, 2);
  assert.equal(r.activityScreening.daily.length, 1);
  assert.equal(r.activityScreening.monthly[0].sppbPeople, 2);
  const client = operationsReport(
    screeningData(),
    defaults,
    { from: "2026-05-01", to: "2026-06-30", client: "true" },
    ledger,
    {},
    "month",
    now,
  );
  assert.equal(client.activityScreening.sppb.people, 1);
  assert.equal(client.activityScreening.tanita.people, 0);
  const all = operationsReport(
    screeningData(),
    defaults,
    { from: "2026-05-01", to: "2026-12-31" },
    ledger,
    {},
    "month",
    now,
  );
  assert.equal(all.activityScreening.sppb.attendance, 5); // Future attendance and similarly named briefing are excluded.
  assert.equal(all.activityScreening.sppb.people, 3);
  assert.equal(all.summary.sppb, 10);
});
test("monthly assessment totals preserve unknown people, missing months and date granularity", () => {
  const f = { from: "2026-05-01", to: "2026-06-30" };
  const r = operationsReport(data(), defaults, f, ledger, {}, "month", now);
  assert.equal(r.summary.sppb, 10);
  assert.equal(r.health.sppb.reportedMonths, 1);
  assert.equal(r.health.selectedMonths, 2);
  assert.equal(r.monthly[1].sppb, null);
  assert.equal(r.health.uniqueSppb, null);
  assert.equal(r.health.both, null);
  assert.equal(r.health.neither, null);
  const daily = operationsReport(data(), defaults, f, ledger, {}, "day", now);
  assert.ok(daily.rows.every((d) => d.sppb === null && d.tanita === null));
  const weekly = operationsReport(data(), defaults, f, ledger, {}, "week", now);
  assert.ok(weekly.rows.every((d) => d.sppb === null));
  const annual = operationsReport(data(), defaults, f, ledger, {}, "year", now);
  assert.equal(annual.rows[0].sppb, 10);
  assert.equal(annual.rows[0].unique, 3);
  const partial = operationsReport(
    data(),
    defaults,
    { ...f, from: "2026-05-15" },
    ledger,
    {},
    "month",
    now,
  );
  assert.equal(partial.summary.sppb, null);
  const subset = operationsReport(
    data(),
    defaults,
    { ...f, client: "true" },
    ledger,
    {},
    "month",
    now,
  );
  assert.equal(subset.summary.unique, 1);
  assert.equal(subset.summary.sppb, null);
  assert.equal(subset.health.unsegmented, false);
});
test("inactivity is unconfigured by default; snapshots and distinct-person transitions use full matching history", () => {
  const fixture = data();
  fixture.participants = fixture.participants.slice(0, 1);
  fixture.sessions = ["2026-01-01", "2026-02-02", "2026-03-06"].map(
    (date, i) => ({
      id: `s${i}`,
      programmeId: "p",
      date,
      start: 540,
      end: 600,
    }),
  );
  fixture.attendance = fixture.sessions.map((s, i) => ({
    id: `a${i}`,
    participantId: "a",
    sessionId: s.id,
  }));
  const f = { from: "2026-01-01", to: "2026-03-31" };
  assert.equal(
    operationsReport(fixture, defaults, f, [], {}, "month", now).summary
      .inactive,
    null,
  );
  const r = operationsReport(
    fixture,
    defaults,
    f,
    [],
    { inactivityDays: 10 },
    "month",
    now,
  );
  assert.equal(r.summary.inactive, 1);
  assert.equal(r.summary.newlyInactive, 1);
  assert.equal(r.summary.reactivated, 1);
  assert.equal(
    r.monthly.reduce((n, m) => n + m.newlyInactive, 0),
    3,
  ); // One person can transition in several months.
  const february = operationsReport(
    fixture,
    defaults,
    { from: "2026-02-01", to: "2026-02-05" },
    [],
    { inactivityDays: 10 },
    "day",
    now,
  );
  assert.equal(february.summary.reactivated, 1);
  assert.equal(february.summary.inactive, 0);
});
test("returning on the threshold date does not create a fictitious inactive day", () => {
  const fixture = data();
  fixture.sessions = [
    { id: "1", date: "2026-01-01", programmeId: "p" },
    { id: "2", date: "2026-01-31", programmeId: "p" },
  ];
  fixture.attendance = [
    { id: "1", participantId: "a", sessionId: "1" },
    { id: "2", participantId: "a", sessionId: "2" },
  ];
  const r = operationsReport(
    fixture,
    defaults,
    { from: "2026-01-01", to: "2026-02-01" },
    [],
    { inactivityDays: 30 },
    "month",
    now,
  );
  assert.equal(r.summary.newlyInactive, 0);
  assert.equal(r.summary.reactivated, 0);
  assert.equal(r.summary.inactive, 0);
});
test("monthly import validates source percentages, zeros, final dates and never creates individual records", async () => {
  const parsed = parseAssessmentTotals(
    [
      [...assessmentHeaders, "Unique Participants", "IB", "OB", "IB %", "OB %"],
      ["2026-05", "0", "12", "2026-06-01", "YES", "11", "5", "6", "45", "65"],
    ],
    now,
  );
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].total, 0);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0].message, /OB percentage/);
  assert.equal(
    parseAssessmentTotals(
      [assessmentHeaders, ["2026-10", "10", "", "2026-10-28", "YES"]],
      now,
    ).issues.length,
    1,
  );
  assert.equal(
    parseAssessmentTotals(
      [assessmentHeaders, ["2026-05", "-1", "", "2026-06-01", "YES"]],
      now,
    ).issues.length,
    1,
  );
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Monthly report");
  sheet.addRow(assessmentHeaders);
  sheet.addRow(["2026-05", 12, 10, "2026-06-01", "YES"]);
  const matrix = await readMatrix(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "monthly.xlsx",
    assessmentHeaders,
  );
  assert.equal(parseAssessmentTotals(matrix, now).rows.length, 2);
  sheet.getCell("B2").value = { formula: "1+1", result: 2 };
  await assert.rejects(
    readMatrix(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "monthly.xlsx",
      assessmentHeaders,
    ),
    /Formula cells/,
  );
});
test("revisions require confirmation, retain history and repeat imports are idempotent", () => {
  const row = {
    month: "2026-05",
    type: "SPPB",
    total: 10,
    reported_as_of: "2026-06-01",
    complete: 1,
  };
  const initial = monthlyPlan([], [row]);
  assert.equal(initial.inserts.length, 1);
  const records = [{ ...initial.inserts[0], id: 1 }];
  assert.equal(monthlyPlan(records, [row]).duplicates, 1);
  assert.throws(
    () => monthlyPlan(records, [{ ...row, total: 12 }]),
    /Confirm a revision/,
  );
  assert.equal(
    monthlyPlan(records, [{ ...row, total: 12 }], true).inserts.length,
    1,
  );
  assert.equal(records[0].total, 10);
});

test("assessment comparisons require final adjacent months and do not depend on the other assessment being reported", () => {
  const records = [
    {
      id: 1,
      month: "2026-05",
      type: "SPPB",
      total: 20,
      reported_as_of: "2026-06-01",
      complete: 1,
    },
    {
      id: 2,
      month: "2026-06",
      type: "SPPB",
      total: 10,
      reported_as_of: "2026-07-01",
      complete: 1,
    },
  ];
  const filters = { from: "2026-05-01", to: "2026-06-30" };
  const final = operationsReport(
    data(),
    defaults,
    filters,
    records,
    {},
    "month",
    now,
  );
  assert.ok(
    final.insights.some((i) => i.title === "SPPB reported activity decreased"),
  );
  assert.equal(final.summary.tanita, null);
  const provisional = operationsReport(
    data(),
    defaults,
    filters,
    [{ ...records[0] }, { ...records[1], complete: 0 }],
    {},
    "month",
    now,
  );
  assert.equal(
    provisional.insights.some((i) => i.title.startsWith("SPPB")),
    false,
  );
});

test("SQLite operations API migrates additively, retains revisions, previews safely, and exports aggregate-only CSV", async () => {
  const db = openDb(":memory:"),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body, withOrigin = true) =>
    fetch(origin + path, {
      method,
      headers: {
        ...(withOrigin ? { Origin: origin } : {}),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  async function json(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }
  try {
    const before = db.prepare("SELECT count(*) AS n FROM users").get().n;
    await json(await request("/api/operations?from=2026-05-01&to=2026-06-30"));
    assert.equal(
      db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v,
      2,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, before);
    const entry = {
      month: "2026-05",
      sppb: "12",
      tanita: "0",
      reportedAsOf: "2026-06-01",
      final: true,
    };
    await json(
      await request("/api/operations/assessments", "POST", entry, false),
      403,
    );
    assert.equal(
      (await json(await request("/api/operations/assessments", "POST", entry)))
        .saved,
      2,
    );
    assert.equal(
      (await json(await request("/api/operations/assessments", "POST", entry)))
        .duplicates,
      2,
    );
    await json(
      await request("/api/operations/assessments", "POST", {
        ...entry,
        sppb: "13",
      }),
      400,
    );
    await json(
      await request("/api/operations/assessments", "POST", {
        ...entry,
        sppb: "13",
        revise: true,
      }),
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM assessment_monthly").get().n,
      3,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM participants").get().n,
      0,
    );
    await json(
      await request("/api/operations/settings", "PUT", { inactivityDays: 30 }),
    );
    await json(
      await request("/api/operations/targets", "POST", {
        month: "2026-05",
        metric: "sppb",
        value: 20,
      }),
    );
    const report = await json(
      await request("/api/operations?from=2026-05-01&to=2026-06-30"),
    );
    assert.equal(report.summary.sppb, 13);
    assert.equal(report.summary.tanita, 0);
    assert.equal(report.targets[0].actual, 13);
    assert.equal(report.targets[0].remaining, 7);
    const csv = [
        assessmentHeaders.join(","),
        "2026-06,15,10,2026-07-01,YES",
      ].join("\r\n"),
      form = new FormData();
    form.append("file", new Blob([csv]), "monthly.csv");
    const preview = await json(
      await request("/api/operations/assessments/preview", "POST", form),
    );
    await json(
      await request("/api/import/confirm", "POST", { id: preview.id }),
      400,
    ); // Wrong import kind must not consume the preview.
    await json(
      await request("/api/operations/assessments/confirm", "POST", {
        id: preview.id,
      }),
    );
    await json(
      await request("/api/operations/assessments/confirm", "POST", {
        id: preview.id,
      }),
      400,
    );
    const exported = await request(
      "/api/operations/export?from=2026-05-01&to=2026-06-30",
    );
    assert.equal(exported.status, 200);
    const text = await exported.text();
    assert.match(text, /SPPB reported assessments/);
    assert.equal(text.includes("IB clients"), false);
    await json(await request("/api/operations/export?client=true"), 400);
    await json(await request("/api/operations?grain=invalid"), 400);
    assert.equal(db.prepare("SELECT count(*) AS n FROM attendance").get().n, 0);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
