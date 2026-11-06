import test from "node:test";
import assert from "node:assert/strict";
import { clientOutreach } from "../server/client-outreach.js";
import { needsAnalysis } from "../server/needs-domain.js";
import { validateProfile } from "../server/needs-routes.js";
import { locationFixture } from "./fixtures/location-state.js";
import { openDb, passwordHash } from "../server/db.js";
import { createApp } from "../server/app.js";
function fixture() {
  const s = locationFixture();
  s.data.participants.forEach((p, i) => {
    p.age = i < 20 ? 65 : 75;
    p.livingRaw = i < 40 ? "Alone" : "Family";
    p.race = i < 3 || i === 15 ? "MALAY" : "CHINESE";
    s.registry[i].details = JSON.stringify(p);
  });
  s.profiles = [
    {
      participant_id: s.data.participants[0].id,
      revision: 1,
      details: JSON.stringify({
        basic: {
          employmentStatus: "Working",
          employmentSource: "Participant reported",
          employmentRecordedOn: "2026-11-01",
        },
      }),
    },
  ];
  s.data.sessions.push({
    id: "old",
    programmeId: "a",
    date: "2026-08-01",
    start: 540,
    end: 600,
  });
  s.data.attendance = s.data.attendance.filter(
    (a) => a.participantId !== s.data.participants[4].id,
  );
  s.data.attendance.push({
    participantId: s.data.participants[4].id,
    sessionId: "old",
  });
  return s;
}
test("outreach endpoint requires staff permission and audits authorised access", async () => {
  const db = openDb(":memory:");
  for (const role of ["viewer", "planner"])
    db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)").run(
      role,
      passwordHash("fixture-password-long"),
      role,
    );
  const app = createApp(db, { authRequired: true }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (path, body, cookie) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await request("/api/clients/outreach", {})).status, 401);
    for (const role of ["viewer", "planner"]) {
      const login = await request("/api/login", {
        username: role,
        password: "fixture-password-long",
      });
      assert.equal(login.status, 200);
      const response = await request(
        "/api/clients/outreach",
        {},
        login.headers.get("set-cookie").split(";")[0],
      );
      assert.equal(response.status, role === "viewer" ? 403 : 200);
    }
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='client.outreach.viewed'",
        )
        .get().n,
      1,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});
const filters = { from: "2026-11-01", to: "2026-11-03", asOf: "2026-11-03" },
  now = "2026-11-06";
test("outreach covers the full client age profile and preserves denominators when the work list shows only nonattenders", () => {
  const s = fixture(),
    r = clientOutreach(s, { filters, cohort: "young" }, now);
  assert.equal(r.fullRegistry.registered, 100);
  assert.equal(
    r.ageProfile.reduce((n, row) => n + row.registered, 0),
    100,
  );
  assert.equal(r.summary.registered, 20);
  assert.equal(r.summary.attending, 9);
  assert.equal(r.summary.noAttendance, 11);
  assert.equal(r.summary.rate, 45);
  assert.equal(r.people.total, 11);
  assert.equal(
    r.people.rows.every((p) => p.attendance === 0),
    true,
  );
  const all = clientOutreach(
    s,
    { filters, cohort: "young", status: "all" },
    now,
  );
  assert.deepEqual(all.summary, r.summary);
  assert.equal(all.people.total, 20);
  assert.equal(
    r.blocks.reduce((n, b) => n + b.registered, 0),
    20,
  );
  assert.equal(
    r.blocks.reduce((n, b) => n + b.noAttendance, 0),
    11,
  );
});
test("minority, living-alone and inactive cohorts retain exact demographic and residence context", () => {
  const s = fixture(),
    minority = clientOutreach(s, { filters, cohort: "minority" }, now);
  assert.equal(minority.summary.registered, 4);
  assert.equal(minority.summary.noAttendance, 1);
  const alone = clientOutreach(s, { filters, cohort: "alone" }, now);
  assert.equal(alone.summary.registered, 40);
  assert.equal(alone.summary.attending, 19);
  const inactive = clientOutreach(
    s,
    { filters, cohort: "inactive", status: "all" },
    now,
  );
  assert.equal(inactive.people.total, 1);
  const p = inactive.people.rows[0];
  assert.equal(p.age, 65);
  assert.equal(p.block, "212");
  assert.equal(p.cfs, "4");
  assert.equal(p.risk, "0");
  assert.equal(p.last, "2026-08-01");
  assert.equal(p.employment, "Not recorded");
  assert.ok(p.days > 60);
  assert.throws(
    () =>
      clientOutreach(s, { cohort: "inactive", filters: { asOf: now } }, now),
    /coverage/,
  );
});
test("employment comes only from recorded profiles and never age; filter combinations and pagination stay bounded", () => {
  const s = fixture(),
    r = clientOutreach(
      s,
      { filters, cohort: "young", employment: "Working", status: "all" },
      now,
    );
  assert.equal(r.summary.registered, 1);
  assert.equal(r.people.rows[0].employmentSource, "Participant reported");
  assert.equal(r.people.rows[0].employmentRecordedOn, "2026-11-01");
  const unknown = clientOutreach(
    s,
    {
      filters,
      cohort: "all",
      employment: "Not recorded",
      status: "all",
      page: 0,
      pageSize: 10,
    },
    now,
  );
  assert.equal(unknown.summary.registered, 99);
  assert.equal(unknown.people.rows.length, 10);
  assert.throws(
    () => clientOutreach(s, { filters, pageSize: 1000 }, now),
    /pagination/,
  );
  assert.throws(
    () => validateProfile({ basic: { employmentStatus: "Working" } }),
    /source/,
  );
  assert.doesNotThrow(() =>
    validateProfile({
      basic: {
        employmentStatus: "Working",
        employmentSource: "Participant reported",
        employmentRecordedOn: "2026-11-01",
      },
    }),
  );
});
test("age profile uses every registered client while CFS continues to use programme participants", () => {
  const s = fixture();
  s.settings.staffAnalysisFull = true;
  s.settings.privacyMinimum = 0;
  const r = needsAnalysis(
    s.data,
    s.profiles,
    s.feedback,
    s.registry,
    s.settings,
    filters,
    now,
  );
  assert.equal(r.demographics.ages.population, "registry");
  assert.equal(r.demographics.ages.denominator, 100);
  assert.equal(r.profiles.cfs.population, "attendance");
  assert.equal(r.profiles.cfs.denominator, 49);
  assert.notEqual(r.demographics.ages.denominator, r.profiles.cfs.denominator);
});
