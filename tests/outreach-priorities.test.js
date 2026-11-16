import test from "node:test";
import assert from "node:assert/strict";
import {
  outreachRules,
  validOutreachRules,
  priorityScore,
  lapsingWatch,
} from "../shared/outreach-priority-rules.js";
import {
  outreachPriorities,
  registrationConversion,
  attendanceDates,
} from "../server/outreach-priorities.js";
import { locationFixture } from "./fixtures/location-state.js";
import { openDb, passwordHash } from "../server/db.js";
import { createApp } from "../server/app.js";
import { defaults } from "../server/domain.js";
const person = {
  id: "test",
  asOf: "2026-11-03",
  status: "inactive-61-90",
  days: 74,
  last: "2026-08-21",
  selectedSessions: 0,
  cfs: "7-8",
  livingRaw: "Alone",
  riskRaw: "1",
  profile: {},
};
const settings = {
  riskMappings: {
    1: {
      label: "Documented indicator",
      meaning: "Recorded need",
      noRisk: false,
    },
  },
  livingGroups: {},
};

test("priority is a transparent sum with one attendance base, explicit approved indicators and capped covered-date gaps", () => {
  const rules = { ...outreachRules(), riskCodes: ["1"] };
  const r = priorityScore(person, settings, rules, true);
  assert.equal(r.score, 74);
  assert.deepEqual(
    r.reasons.map((r) => r.key),
    ["inactive", "cfs", "alone", "srf", "gap"],
  );
  assert.equal(
    r.score,
    r.reasons.reduce((n, r) => n + r.points, 0),
  );
  assert.equal(r.eligible, true);
  assert.equal(
    priorityScore(
      { ...person, age: 42, race: "ANY", gender: "ANY" },
      settings,
      rules,
      true,
    ).score,
    r.score,
    "age/race/gender never add points",
  );
  const limited = priorityScore(person, settings, rules, false);
  assert.equal(limited.inactive, false);
  assert.ok(!limited.reasons.some((r) => r.key === "gap"));
  assert.ok(!priorityScore(person, {}, rules, true).indicators.includes("srf"));
  assert.ok(
    !priorityScore(
      person,
      { riskMappings: { 1: { meaning: "No risk", noRisk: true } } },
      rules,
      true,
    ).indicators.includes("srf"),
  );
  assert.ok(
    !priorityScore(person, settings, outreachRules(), true).indicators.includes(
      "srf",
    ),
    "no SRF codes selected by default",
  );
  assert.equal(
    priorityScore({ ...person, days: 365 }, settings, rules, true).reasons.find(
      (r) => r.key === "gap",
    ).points,
    12,
  );
});
test("missing, future and straddling CFS profiles do not become invented support indicators", () => {
  const rules = outreachRules();
  const missing = priorityScore(
    {
      ...person,
      cfs: null,
      livingRaw: null,
      riskRaw: null,
      status: "no-history",
      last: null,
      days: null,
    },
    settings,
    rules,
    true,
  );
  assert.equal(missing.score, 30);
  assert.equal(missing.missingFields.length, 3);
  assert.equal(missing.indicators.length, 0);
  const future = priorityScore(
    {
      ...person,
      cfs: "4",
      profile: { health: { cfs: "8", cfsAssessedOn: "2026-12-01" } },
    },
    settings,
    rules,
    true,
  );
  assert.ok(!future.indicators.includes("cfs"));
  const straddled = priorityScore(
    person,
    settings,
    { ...rules, highCfsFrom: 8 },
    true,
  );
  assert.ok(!straddled.indicators.includes("cfs"));
  assert.ok(straddled.missingFields.some((v) => v.includes("crosses")));
  assert.equal(validOutreachRules({ ...rules, cfsPoints: -1 }), false);
  assert.equal(validOutreachRules({ ...rules, extra: true }), false);
  assert.equal(validOutreachRules({ ...rules, watchPercent: 0 }), false);
});
test("active watchlist uses median positive distinct-day intervals or an explicitly labelled fallback without redefining inactivity", () => {
  const rules = outreachRules(),
    p = { ...person, status: "active", days: 6 };
  const w = lapsingWatch(
    p,
    ["2026-10-01", "2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"],
    rules,
    true,
  );
  assert.equal(w.typicalDays, 7);
  assert.equal(w.thresholdDays, 6);
  assert.match(w.label, /typical 7 days/);
  assert.equal(
    lapsingWatch(
      { ...p, days: 5 },
      ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"],
      rules,
      true,
    ),
    null,
  );
  assert.equal(
    lapsingWatch({ ...p, days: 20 }, ["2026-10-01"], rules, true),
    null,
  );
  assert.match(
    lapsingWatch({ ...p, days: 21 }, ["2026-10-01"], rules, true).label,
    /fixed 21-day fallback/,
  );
  assert.equal(lapsingWatch(person, ["2026-10-01"], rules, true), null);
  assert.equal(
    lapsingWatch({ ...p, days: 25 }, ["2026-10-01"], rules, false),
    null,
  );
});
test("registration conversion separates completed windows, later attendance, unknown dates, pending windows and uncovered starts", () => {
  const people = [
    { id: "day14", registrationDate: "2026-10-01" },
    { id: "day15", registrationDate: "2026-10-01" },
    { id: "none", registrationDate: "2026-10-01" },
    { id: "young", registrationDate: "2026-11-15" },
    { id: "pending", registrationDate: "2026-11-25" },
    { id: "uncovered", registrationDate: "2026-09-02" },
    { id: "old", registrationDate: "2026-08-01" },
    { id: "unknown", registrationDate: null },
  ];
  const history = new Map([
    ["day14", ["2026-10-15"]],
    ["day15", ["2026-10-16"]],
    ["none", ["2026-09-30"]],
    ["young", ["2026-11-16"]],
  ]);
  const r = registrationConversion(
    people,
    history,
    { from: "2026-09-10", to: "2026-11-30" },
    "2026-11-30",
    90,
  );
  assert.equal(r.unknownRegistration, 1);
  assert.equal(r.outsideRecentCohort, 1);
  assert.equal(r.recentRegistered, 6);
  assert.equal(r.recordedBeforeRegistration, 1);
  const day14 = r.windows[0];
  assert.equal(day14.eligible, 4);
  assert.equal(day14.attendedWithin, 2);
  assert.equal(day14.notWithin, 2);
  assert.equal(day14.attendedLater, 1);
  assert.equal(day14.noRecordedAfterRegistration, 1);
  assert.equal(day14.pending, 1);
  assert.equal(day14.startNotCovered, 1);
  assert.equal(day14.rate, 50);
  const day30 = r.windows[1];
  assert.equal(day30.eligible, 3);
  assert.equal(day30.attendedWithin, 2);
  assert.equal(day30.pending, 2);
  assert.equal(
    registrationConversion(people, history, { from: null, to: null }, null, 90)
      .recentRegistered,
    null,
  );
});
test("priority reports preserve audience denominators, pagination and source records, use recorded interests and block exports", () => {
  const s = locationFixture();
  s.data.participants[0].cfs = "7-8";
  const d = JSON.parse(s.registry[0].details);
  d.cfs = "7-8";
  s.registry[0].details = JSON.stringify(d);
  const snapshot = JSON.stringify(s),
    filters = { from: "2026-11-01", to: "2026-11-03", asOf: "2026-11-03" };
  let r = outreachPriorities(s, { filters, pageSize: 5 }, "2026-11-06");
  assert.equal(r.summary.matchedClients, 100);
  assert.equal(r.summary.followup, 50);
  assert.equal(r.people.total, 50);
  assert.equal(r.people.rows.length, 5);
  assert.equal(r.export.enabled, false);
  assert.ok(r.people.rows.every((p) => p.last === null));
  assert.equal(r.conversion.unknownRegistration, 100);
  const page2 = outreachPriorities(
    s,
    { filters, pageSize: 5, page: 1 },
    "2026-11-06",
  );
  assert.ok(
    page2.people.rows.every((p) => !r.people.rows.some((a) => a.id === p.id)),
  );
  const limited = outreachPriorities(
    s,
    { filters: { ...filters, asOf: "2026-11-06" } },
    "2026-11-06",
  );
  assert.equal(limited.summary.inactive, null);
  assert.equal(limited.summary.watch, null);
  assert.ok(limited.people.rows.every((p) => p.days === null));
  assert.equal(
    outreachPriorities(
      s,
      { filters: { ...filters, asOf: "2026-11-06" }, recency: "noHistory" },
      "2026-11-06",
    ).people.total,
    50,
    "no recorded history remains a known record category even when elapsed recency is limited",
  );
  assert.equal(
    outreachPriorities(s, { filters, indicator: "missing" }, "2026-11-06")
      .summary.matchedClients,
    100,
  );
  assert.equal(JSON.stringify(s), snapshot);
  assert.throws(() =>
    outreachPriorities(
      s,
      { filters: { ...filters, status: "attending" } },
      "2026-11-06",
    ),
  );
  assert.throws(() => outreachPriorities(s, { all: true }, "2026-11-06"));
  assert.throws(() => outreachPriorities(s, { pageSize: 101 }, "2026-11-06"));
  const history = attendanceDates(
    { ...s.data, attendance: [...s.data.attendance, s.data.attendance[0]] },
    "2026-11-03",
  );
  assert.equal(history.get(s.data.attendance[0].participantId).length, 3);
});
test("report integrates existing inactivity with the active watchlist and recency filtering without changing source status rules", () => {
  const s = locationFixture(),
    [old, watch] = s.data.participants;
  s.data.attendance = s.data.attendance.filter(
    (a) => ![old.id, watch.id].includes(a.participantId),
  );
  for (const [i, date] of [
    "2026-08-21",
    "2026-09-19",
    "2026-09-26",
    "2026-10-03",
    "2026-10-10",
  ].entries()) {
    const id = "old-" + i;
    s.data.sessions.push({ id, programmeId: "a", date, start: 540, end: 600 });
    s.data.attendance.push({
      participantId: i === 0 ? old.id : watch.id,
      sessionId: id,
    });
  }
  const filters = { from: "2026-11-01", to: "2026-11-03", asOf: "2026-11-03" },
    snapshot = JSON.stringify(s);
  const r = outreachPriorities(s, { filters }, "2026-11-06");
  assert.equal(r.summary.inactive, 1);
  assert.equal(r.summary.watch, 1);
  assert.ok(
    r.people.rows
      .find((p) => p.id === old.id)
      .reasons.some((r) => r.key === "inactive" && r.label.includes("74 days")),
  );
  const w = outreachPriorities(s, { filters, view: "watch" }, "2026-11-06");
  assert.equal(w.people.total, 1);
  assert.equal(w.people.rows[0].id, watch.id);
  assert.equal(w.people.rows[0].watch.typicalDays, 7);
  const inactive = outreachPriorities(
    s,
    { filters, recency: "days61to90" },
    "2026-11-06",
  );
  assert.equal(inactive.people.total, 1);
  assert.equal(inactive.people.rows[0].id, old.id);
  assert.equal(JSON.stringify(s), snapshot);
});
test("administrators can edit validated priority rules; legacy settings saves preserve them and export policy remains closed", async () => {
  const db = openDb(":memory:"),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const save = (body) =>
    fetch(base + "/api/settings", {
      method: "PUT",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const originalDefaults = structuredClone(defaults);
    const dashboardResponse = await fetch(base + "/api/dashboard");
    assert.equal(dashboardResponse.status, 200);
    const publicReport = await dashboardResponse.json();
    assert.equal(publicReport.settings.outreachRules.riskCodes, undefined);
    assert.deepEqual(
      defaults,
      originalDefaults,
      "dashboard redaction must preserve nested defaults",
    );
    for (const value of [
      null,
      {},
      [],
      { ...outreachRules(), noHistoryPoints: -1 },
      { ...outreachRules(), riskCodes: [1] },
      { ...outreachRules(), riskCodes: Array(51).fill("1") },
    ])
      assert.equal(
        (await save({ ...defaults, outreachRules: value })).status,
        400,
      );
    const custom = {
      ...outreachRules(),
      highCfsFrom: 6,
      watchPercent: 90,
      riskCodes: ["1", "1"],
    };
    assert.equal(
      (await save({ ...defaults, outreachRules: custom })).status,
      200,
    );
    const savedBeforeRead = db
      .prepare("SELECT value FROM settings WHERE id=1")
      .get().value;
    assert.equal((await fetch(base + "/api/dashboard")).status, 200);
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE id=1").get().value,
      savedBeforeRead,
    );
    const savedRulesResponse = await fetch(base + "/api/settings/outreach-rules");
    assert.equal(savedRulesResponse.status, 200);
    assert.deepEqual((await savedRulesResponse.json()).riskCodes, ["1"]);
    const { outreachRules: _ignored, ...legacy } = defaults;
    void _ignored;
    assert.equal((await save(legacy)).status, 200);
    const stored = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE id=1").get().value,
    );
    assert.equal(stored.outreachRules.highCfsFrom, 6);
    assert.deepEqual(stored.outreachRules.riskCodes, ["1"]);
    assert.deepEqual(stored.inactivityBands, [30, 60, 90]);
    assert.equal(stored.staffAnalysisFull, undefined);
    assert.equal(
      (
        await fetch(base + "/api/clients/priorities/export", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        })
      ).status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});
test("priority endpoint enforces staff roles, logs only aggregate access metadata, and cannot enable personal CSV through request fields", async () => {
  const db = openDb(":memory:");
  for (const role of ["viewer", "planner"])
    db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)").run(
      role,
      passwordHash("fixture-password-long"),
      role,
    );
  const server = createApp(db, { authRequired: true }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (path, body, cookie) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await request("/api/clients/priorities", {})).status, 401);
    for (const role of ["viewer", "planner"]) {
      const login = await request("/api/login", {
        username: role,
        password: "fixture-password-long",
      });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal((await fetch(base + "/api/settings/outreach-rules", { headers: { cookie } })).status, 403);
      assert.equal(
        (await request("/api/clients/priorities", {}, cookie)).status,
        role === "viewer" ? 403 : 200,
      );
      assert.equal(
        (
          await request(
            "/api/clients/priorities/export",
            { confirmed: true, enabled: true },
            cookie,
          )
        ).status,
        403,
      );
      if (role === "planner") {
        const rules = { ...outreachRules(), highCfsFrom: 8 };
        const response = await fetch(base + "/api/settings", {
          method: "PUT",
          headers: { Origin: base, "Content-Type": "application/json", cookie },
          body: JSON.stringify({ ...defaults, outreachRules: rules }),
        });
        assert.equal(
          response.status,
          403,
          "planner cannot change organisation rules",
        );
      }
    }
    const audit = db
      .prepare(
        "SELECT details FROM audit WHERE action='client.priorities.viewed'",
      )
      .all();
    assert.equal(audit.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(audit[0].details)).sort(), [
      "count",
      "page",
      "view",
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});
