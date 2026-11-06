import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  HEADERS,
  RISK_HEADER,
  OPTIONAL_PROFILE_HEADERS,
  parseRows,
  inspectImport,
  readFile,
  hash,
} from "../server/domain.js";
import { openDb, readData, saveImport, passwordHash } from "../server/db.js";
import { needsAnalysis, participantHistory } from "../server/needs-domain.js";
import { validateProfile } from "../server/needs-routes.js";
import { createApp } from "../server/app.js";
import { reconcileNeeds } from "../scripts/reconcile-needs.mjs";
const headers = [
  HEADERS[0],
  HEADERS[1],
  OPTIONAL_PROFILE_HEADERS.livingRaw,
  OPTIONAL_PROFILE_HEADERS.maritalRaw,
  ...HEADERS.slice(2, 5),
  RISK_HEADER,
  ...HEADERS.slice(5),
];
function row(member = "a", overrides = {}) {
  const values = {
    "Name/Member ID": member,
    Gender: "MALE",
    "Name/Age": "65",
    "Name/Race": "MALAY",
    "Name/CFS": "1-3",
    [RISK_HEADER]: "0",
    [OPTIONAL_PROFILE_HEADERS.livingRaw]: "Alone",
    [OPTIONAL_PROFILE_HEADERS.maritalRaw]: "SINGLE",
    "Is Client": "YES",
    "Within Boundary": "YES",
    "Activity Name": "Social Games",
    "AAP Domain": "Social",
    "Session Detail": "2026-05-04, 09:00 AM - 10:00 AM",
    ...overrides,
  };
  return headers.map((h) => values[h]);
}
const parse = (...rows) => parseRows([headers, ...rows]);
function database() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
    "admin",
    passwordHash("fixture-password-long"),
    "admin",
  );
  return db;
}
function save(db, parsed) {
  parsed.mode = "merge";
  return saveImport(db, parsed, inspectImport(parsed, readData(db)), 1);
}
const repeated = (count = 10) =>
  Array.from({ length: count }, (_, i) => [
    row("p" + i, {
      [OPTIONAL_PROFILE_HEADERS.livingRaw]: i < 5 ? "Alone" : "Family",
    }),
    row("p" + i, {
      [OPTIONAL_PROFILE_HEADERS.livingRaw]: i < 5 ? "Alone" : "Family",
      "Session Detail": "2026-10-20, 09:00 AM - 10:00 AM",
    }),
  ]).flat();
const referencePath =
  process.env.NEEDS_REFERENCE_WORKBOOK ||
  "C:/Users/CHANYULE/Downloads/member_attendances_20261103110958.xlsx";
test(
  "the supplied 13-column workbook reconciles independently and imports idempotently without writing user data",
  {
    skip: !existsSync(referencePath)
      ? "Reference workbook not present on this host"
      : false,
  },
  async () => {
    const r = await reconcileNeeds(referencePath);
    assert.equal(r.source.rawRows, 3344);
    assert.equal(r.source.participants, 405);
    assert.equal(r.source.seniors, 382);
    assert.equal(r.source.maleSeniors, 86);
    assert.equal(r.source.programmes, 116);
    assert.equal(r.source.sessions, 351);
    assert.equal(r.source.exactDuplicates, 1);
    assert.equal(r.source.from, "2026-05-04");
    assert.equal(r.source.to, "2026-11-03");
    assert.deepEqual(r.source.risk, { 0: 328, 1: 9, ">1": 2, "(missing)": 66 });
    assert.equal(r.source.living["(missing)"], 223);
    assert.deepEqual(r.source.domainSessions, {
      Cognitive: 60,
      Learning: 111,
      Others: 26,
      Physical: 98,
      Social: 42,
      "Social – Communal Dining": 8,
      Volunteerism: 6,
    });
    assert.equal(r.application.invalid, 0);
    assert.equal(r.application.deduplicatedAttendance, 3343);
    const db = database();
    try {
      const parsed = await readFile(readFileSync(referencePath), referencePath);
      save(db, parsed);
      assert.equal(save(db, parsed).imported, 0);
      const data = readData(db);
      assert.equal(data.attendance.length, 3343);
      assert.equal(data.participants.length, 405);
      const report = needsAnalysis(data, [], [], [], {}, {}, "2026-11-03");
      assert.equal(report.summary.unique, 382);
      assert.equal(report.summary.male, 86);
      assert.equal(report.summary.sessions, 351);
      assert.equal(
        report.quality.find((q) => q.field === "livingRaw").missing,
        223,
      );
      assert.equal(
        report.quality.find((q) => q.field === "riskRaw").missing,
        66,
      );
      assert.equal(report.quality.find((q) => q.field === "race").unknown, 2);
      assert.equal(report.quality.find((q) => q.field === "race").missing, 0);
      assert.equal(report.profiles.livingAlone, 37);
      assert.equal(report.registry.available, false);
      assert.equal(report.registry.inactive, null);
      assert.equal(report.responses.interests.denominator, 0);
      assert.deepEqual(report.responses.barriers.values, []);
      assert.ok(report.findings.every((f) => f.category === "Review"));
    } finally {
      db.close();
    }
  },
);
test("10/11/13-column imports preserve raw social values and blank updates retain completed profiles", () => {
  const db = database();
  try {
    const latest = parse(row());
    assert.equal(latest.rows[0].participant.livingRaw, "Alone");
    assert.equal(latest.rows[0].participant.maritalRaw, "SINGLE");
    save(db, latest);
    const incoming = parse(
      row("a", {
        [OPTIONAL_PROFILE_HEADERS.livingRaw]: "",
        [OPTIONAL_PROFILE_HEADERS.maritalRaw]: "",
        "Name/CFS": "",
        Gender: "",
        "Name/Age": "",
      }),
    );
    save(db, incoming);
    const p = readData(db).participants[0];
    assert.equal(p.livingRaw, "Alone");
    assert.equal(p.maritalRaw, "SINGLE");
    assert.equal(p.age, 65);
    assert.equal(p.cfs, "1-3");
    assert.equal(readData(db).attendance.length, 1);
    const object = Object.fromEntries(
      headers.map((h, i) => [h, row("old")[i]]),
    );
    const legacy = parseRows([HEADERS, HEADERS.map((h) => object[h])]);
    assert.equal(legacy.rows.length, 1);
    assert.equal("livingRaw" in legacy.rows[0].participant, false);
    const eleven = [...HEADERS, RISK_HEADER];
    assert.equal(
      parseRows([eleven, eleven.map((h) => object[h])]).rows.length,
      1,
    );
    assert.ok(
      db
        .prepare(
          "SELECT count(*) n FROM profile_observations WHERE field='livingRaw'",
        )
        .get().n >= 1,
    );
  } finally {
    db.close();
  }
});
test("programme domain grouping deduplicates reach and keeps programmes, sessions and original domains separate", () => {
  const db = database();
  try {
    save(
      db,
      parse(
        ...repeated(),
        row("p0", {
          "Activity Name": "Dining",
          "AAP Domain": "Social – Communal Dining",
        }),
      ),
    );
    const data = readData(db);
    const r = needsAnalysis(
      data,
      [],
      [],
      [],
      { domainGroups: { "Social – Communal Dining": "Social" } },
      {},
      "2026-11-03",
    );
    assert.equal(r.alignment.length, 1);
    assert.equal(r.alignment[0].unique, 10);
    assert.equal(r.alignment[0].sessions, 3);
    assert.equal(r.alignment[0].programmes, 2);
    assert.equal(r.alignment[0].sessionShare, 100);
    assert.equal(r.programmeClassifications.length, 2);
    const dining = r.programmeClassifications.find(p => p.name === "Dining");
    assert.equal(dining.primaryDomain, "Social \u2013 Communal Dining");
    assert.deepEqual(dining.subDomains, ["Unclassified / unknown"]);
    assert.equal(dining.sessions, 1);
    assert.equal(dining.unique, null); // Existing small-group protection also protects the complement.
    const staff = needsAnalysis(data, [], [], [], {staffAnalysisFull:true,privacyMinimum:0}, {}, "2026-11-03");
    const games = staff.programmeClassifications.find(p => p.name === "Social Games");
    assert.equal(games.sessions, 2);
    assert.equal(games.unique, 10);
    assert.equal(games.repeat, 10);
    assert.equal(games.averageSessions, 2);
    assert.ok(
      data.programmes.some((p) => p.domain === "Social – Communal Dining"),
    );
    assert.equal(
      r.profiles.living.values.find((v) => v.label === "Alone").unique,
      5,
    );
    assert.equal(r.profiles.livingAlone, 5);
  } finally {
    db.close();
  }
});
test("sensitive profile slices and complementary values are withheld for small groups and filter combinations", () => {
  const db = database();
  try {
    save(db, parse(...repeated(6)));
    const data = readData(db);
    const r = needsAnalysis(data, [], [], [], {}, {}, "2026-11-03");
    assert.equal(r.profiles.living.suppressed, true);
    assert.deepEqual(r.profiles.living.values, []);
    const filtered = needsAnalysis(
      data,
      [],
      [],
      [],
      {},
      { gender: "MALE" },
      "2026-11-03",
    );
    assert.equal(filtered.profiles.cfs.suppressed, true);
    assert.equal(filtered.profiles.living.denominator, null);
    assert.deepEqual(filtered.responses.interests.values, []);
    assert.equal(filtered.summary.riskMissing, undefined);
  } finally {
    db.close();
  }
});
test("attendance-only inactivity never invents membership or never-attended status; complete registry and history are separate evidence", () => {
  const db = database();
  try {
    save(
      db,
      parse(
        row("old"),
        row("recent", { "Session Detail": "2026-11-03, 09:00 AM - 10:00 AM" }),
      ),
    );
    const data = readData(db);
    data.participants.push({
      id: hash(["unseen"]),
      age: 70,
      gender: "FEMALE",
      race: "CHINESE",
      cfs: null,
      client: null,
      boundary: null,
    });
    const base = needsAnalysis(data, [], [], [], {}, {}, "2026-11-03");
    assert.equal(base.registry.total, null);
    assert.equal(base.registry.neverAttended, null);
    assert.equal(base.engagement.denominator, 2);
    const registry = data.participants.map((p) => ({
      participant_id: p.id,
      snapshot: "verified",
      details: JSON.stringify({ registrationDate: "2026-01-01" }),
    }));
    const settings = {
      registry: {
        complete: true,
        snapshot: "verified",
        asOf: "2026-11-03",
        historyComplete: false,
      },
    };
    const members = needsAnalysis(
      data,
      [],
      [],
      registry,
      settings,
      {},
      "2026-11-03",
    );
    assert.equal(members.registry.total, 3);
    assert.equal(members.registry.inactive, 1);
    assert.equal(members.registry.noRecordedAttendance, 1);
    assert.equal(members.registry.neverAttended, null);
    settings.registry.historyComplete = true;
    assert.equal(
      needsAnalysis(data, [], [], registry, settings, {}, "2026-11-03").registry
        .neverAttended,
      1,
    );
    assert.equal(
      participantHistory(data, hash(["recent"]), "2026-11-03").status,
      "Within 30 days",
    );
  } finally {
    db.close();
  }
});
test("stated preferences and reported barriers are distinct from attendance and staff hypotheses; overlap reporting is gated", () => {
  const db = database();
  try {
    save(db, parse(...repeated()));
    const data = readData(db);
    const feedback = data.participants.map((p, i) => ({
      participant_id: p.id,
      date: "2026-10-20",
      created: "2026-10-20T10:00:00Z",
      details: JSON.stringify({
        preferences: { responded: true, interests: ["Games"] },
        barriers: [
          {
            category: i < 5 ? "Language" : "Programme timing",
            status: "Reported",
            source: i < 5 ? "Participant-reported" : "Staff-observed",
            date: "2026-10-20",
          },
        ],
      }),
    }));
    let r = needsAnalysis(data, [], feedback, [], {}, {}, "2026-11-03");
    assert.equal(r.responses.interests.values[0].unique, 10);
    assert.equal(r.responses.barriers.values[0].unique, 5);
    assert.equal(r.responses.hypotheses.values[0].unique, 5);
    assert.ok(
      r.findings.some(
        (f) =>
          f.category === "Targeted Outreach" &&
          f.evidence.includes("Participant/caregiver"),
      ),
    );
    assert.equal(r.coverage[0].programmes.length, 0);
    data.programmes[0].optional = {
      interestCategories: ["Games"],
      intendedNeeds: [],
    };
    r = needsAnalysis(data, [], feedback, [], {}, {}, "2026-11-03");
    assert.equal(r.coverage[0].programmes.length, 1);
    assert.equal(r.coverage[0].reached, 10);
    assert.ok(!r.findings.some((f) => f.category === "Pilot"));
    feedback[0].details = JSON.stringify({
      preferences: {
        responded: true,
        interests: ["Games", "Music and performance"],
      },
    });
    const hidden = needsAnalysis(data, [], feedback, [], {}, {}, "2026-11-03");
    assert.equal(hidden.responses.interests.suppressed, true);
    assert.deepEqual(hidden.responses.interests.values, []);
  } finally {
    db.close();
  }
});
test("profile validation preserves optional states and rejects malformed dates, unsupported categories and automatic diagnoses", () => {
  assert.deepEqual(
    validateProfile({
      needs: [
        {
          category: "Transport assistance",
          status: "Not assessed",
          source: "Unconfirmed",
          date: "",
        },
      ],
      preferences: { interests: ["Games", "Arts and crafts"], responded: true },
    }).needs[0].status,
    "Not assessed",
  );
  assert.throws(() => validateProfile({ diagnosis: "Invented" }));
  assert.throws(() =>
    validateProfile({
      needs: [
        {
          category: "Transport assistance",
          status: "Reported",
          source: "Participant-reported",
          date: "2026-02-30",
        },
      ],
    }),
  );
  assert.throws(() => validateProfile({ basic: { age: 200 } }));
  assert.throws(() =>
    validateProfile({ preferences: { interests: ["Made-up classification"] } }),
  );
});
async function serve(db) {
  const server = createApp(db, { authRequired: true }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    request: (path, method = "GET", body, cookie) =>
      fetch(origin + path, {
        method,
        headers: {
          Origin: origin,
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body == null
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      }),
    close: () => new Promise((r) => server.close(r)),
  };
}
test("authorised profile editing, feedback, actions and exports enforce roles, source evidence and optimistic revisions", async () => {
  const db = database();
  save(db, parse(...repeated()));
  db.prepare("INSERT INTO users VALUES(2,?,?,?)").run(
    "planner",
    passwordHash("planner-password-long"),
    "planner",
  );
  db.prepare("INSERT INTO users VALUES(3,?,?,?)").run(
    "viewer",
    passwordHash("viewer-password-long"),
    "viewer",
  );
  const app = await serve(db);
  try {
    const login = async (username, password) => {
      const r = await app.request("/api/login", "POST", { username, password });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie").split(";")[0];
    };
    const planner = await login("planner", "planner-password-long"),
      viewer = await login("viewer", "viewer-password-long");
    const id = hash(["p0"]);
    assert.equal((await app.request("/api/needs/overview")).status, 401);
    assert.equal(
      (await app.request("/api/needs/overview", "GET", null, viewer)).status,
      403,
    );
    assert.equal(
      (await app.request("/api/participants/" + id, "GET", null, viewer))
        .status,
      403,
    );
    assert.equal(
      (
        await app.request(
          "/api/participants/lookup",
          "POST",
          { memberId: "p0" },
          viewer,
        )
      ).status,
      403,
    );
    assert.deepEqual(
      await (
        await app.request(
          "/api/participants/lookup",
          "POST",
          { memberId: "p0" },
          planner,
        )
      ).json(),
      { id },
    );
    const profile = {
      basic: { age: 59, preferredLanguage: "Malay" },
      needs: [
        {
          category: "Transport assistance",
          status: "Reported",
          source: "Participant-reported",
          date: "2026-10-20",
        },
      ],
      preferences: { responded: true, interests: ["Games", "Arts and crafts"] },
      followUp: { required: true, status: "Proposed", assigned: "Planner" },
    };
    assert.equal(
      (
        await app.request(
          "/api/participants/" + id + "/profile",
          "PUT",
          {
            revision: 0,
            details: profile,
            source: "Participant-reported",
            effectiveDate: "2026-10-20",
          },
          planner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request(
          "/api/participants/" + id + "/profile",
          "PUT",
          { revision: 0, details: profile, source: "Participant-reported" },
          planner,
        )
      ).status,
      409,
    );
    const detail = await (
      await app.request("/api/participants/" + id, "GET", null, planner)
    ).json();
    assert.equal(detail.base.age, 65);
    assert.equal(detail.current.age, 59);
    assert.equal(detail.revision, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM profile_history").get().n,
      1,
    );
    const dashboard = await (
      await app.request("/api/dashboard", "GET", null, planner)
    ).json();
    assert.equal(dashboard.summary.unique, 9);
    assert.equal(readData(db).attendance.length, 20);
    const fb = {
      id: "feedback-one",
      date: "2026-10-20",
      method: "survey",
      source: "Participant-reported",
      consent: false,
      preferences: { responded: true, interests: ["Games"] },
      barriers: [],
      comments: "Interested in games",
    };
    assert.equal(
      (
        await app.request(
          "/api/participants/" + id + "/feedback",
          "POST",
          fb,
          planner,
        )
      ).status,
      400,
    );
    fb.consent = true;
    assert.equal(
      (
        await app.request(
          "/api/participants/" + id + "/feedback",
          "POST",
          fb,
          planner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request(
          "/api/participants/" + id + "/feedback",
          "POST",
          fb,
          planner,
        )
      ).status,
      200,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM participant_feedback").get().n,
      1,
    );
    const action = {
      kind: "outreach",
      revision: 0,
      title: "Review transport request",
      priority: "High",
      status: "Proposed",
      owner: "Planner",
      start: "2026-11-03",
      due: "2026-12-03",
      contacted: 10,
      responded: 8,
      interested: 7,
      registered: 6,
      attended: 5,
      repeat: null,
      evidenceSource: "Reviewed outreach log",
    };
    assert.equal(
      (
        await app.request(
          "/api/needs/actions/test-outreach",
          "PUT",
          action,
          viewer,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request(
          "/api/needs/actions/test-outreach",
          "PUT",
          action,
          planner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request(
          "/api/needs/actions/test-outreach",
          "PUT",
          action,
          planner,
        )
      ).status,
      409,
    );
    const actions = await (
      await app.request("/api/needs/actions", "GET", null, planner)
    ).json();
    assert.equal(actions[0].attended, 5);
    assert.equal(
      (
        await app.request(
          "/api/needs/actions/test-outreach",
          "PUT",
          { ...action, revision: 1, responded: 11 },
          planner,
        )
      ).status,
      400,
    );
    assert.equal(
      (await app.request("/api/needs/settings", "PUT", {}, planner)).status,
      403,
    );
    assert.equal(
      (await app.request("/api/needs/export/csv", "GET", null, viewer)).status,
      403,
    );
    const csv = await app.request(
      "/api/needs/export/csv",
      "GET",
      null,
      planner,
    );
    assert.equal(csv.status, 200);
    const content = await csv.text();
    assert.match(content, /WHO ARE THEY/);
    assert.match(content, /WHAT ARE WE MISSING/);
    assert.match(content, /WHAT SHOULD WE DO/);
    assert.equal(content.includes(id), false);
    assert.equal(content.includes("Interested in games"), false);
    for (const path of [
      "/api/dashboard?cfs=1-3",
      "/api/operations?cfs=1-3",
      "/api/needs/overview?living=Alone",
      "/api/needs/overview?needs=Transport",
    ])
      assert.equal(
        (await app.request(path, "GET", null, planner)).status,
        403,
        path,
      );
  } finally {
    await app.close();
    db.close();
  }
});

test("registry previews require independent completeness evidence and keep existing attendance and known profile values", async () => {
  const db = database();
  save(db, parse(row("known")));
  const app = await serve(db);
  try {
    const login = await app.request("/api/login", "POST", {
      username: "admin",
      password: "fixture-password-long",
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const upload = () => {
      const f = new FormData();
      f.append(
        "file",
        new Blob([
          "Name/Member ID,Gender,Name/Age,Name/Race,Registration Date\r\nknown,FEMALE,66,CHINESE,2026-01-01\r\nunseen,FEMALE,75,CHINESE,2026-01-01\r\n",
        ]),
        "verified-members.csv",
      );
      return f;
    };
    const previewResponse = await app.request(
      "/api/registry/preview",
      "POST",
      upload(),
      cookie,
    );
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.rows, 2);
    assert.equal(preview.matched, 1);
    assert.equal(preview.newProfiles, 1);
    assert.equal(readData(db).participants.length, 1);
    assert.equal(
      (
        await app.request(
          "/api/import/confirm",
          "POST",
          { id: preview.id },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await app.request(
          "/api/registry/confirm",
          "POST",
          {
            id: preview.id,
            complete: true,
            asOf: "2026-11-03",
            historyComplete: false,
          },
          cookie,
        )
      ).status,
      200,
    );
    const data = readData(db);
    assert.equal(data.attendance.length, 1);
    assert.equal(data.participants.length, 2);
    assert.equal(
      data.participants.find((p) => p.id === hash(["known"])).gender,
      "MALE",
    );
    assert.equal(
      data.participants.find((p) => p.id === hash(["known"])).age,
      65,
    );
    assert.equal(
      data.participants.find((p) => p.id === hash(["known"])).registrationDate,
      "2026-01-01",
    );
    let r = await (
      await app.request("/api/needs/overview", "GET", null, cookie)
    ).json();
    assert.equal(r.registry.available, true);
    assert.equal(r.registry.total, 2);
    assert.equal(r.registry.noRecordedAttendance, 1);
    assert.equal(r.registry.neverAttended, null);
    const second = await (
      await app.request("/api/registry/preview", "POST", upload(), cookie)
    ).json();
    await app.request(
      "/api/registry/confirm",
      "POST",
      {
        id: second.id,
        complete: true,
        asOf: "2026-11-03",
        historyComplete: true,
      },
      cookie,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM member_registry").get().n,
      2,
    );
    r = await (
      await app.request("/api/needs/overview", "GET", null, cookie)
    ).json();
    assert.equal(r.registry.neverAttended, 1);
    assert.equal(readData(db).attendance.length, 1);
  } finally {
    await app.close();
    db.close();
  }
});

test("overlapping response categories cannot reconstruct a small intersection from large individual counts", () => {
  const db = database();
  try {
    save(db, parse(...repeated(6)));
    const data = readData(db);
    const feedback = data.participants.map((p, i) => ({
      participant_id: p.id,
      date: "2026-10-20",
      created: "2026-10-20T10:00:00Z",
      details: JSON.stringify({
        preferences: {
          responded: true,
          interests:
            i < 4
              ? ["Games", "Arts and crafts"]
              : i === 4
                ? ["Games"]
                : ["Arts and crafts"],
        },
        barriers: [],
      }),
    }));
    const report = needsAnalysis(data, [], feedback, [], {}, {}, "2026-11-03");
    assert.equal(report.responses.interests.suppressed, true);
    assert.deepEqual(report.responses.interests.values, []);
    assert.equal(report.responses.interests.denominator, null);
  } finally {
    db.close();
  }
});

test("later unanswered feedback retains known answers and reviewed not-present barriers replace earlier reports", () => {
  const db = database();
  try {
    save(db, parse(...repeated()));
    const data = readData(db),
      feedback = [],
      profiles = [];
    for (const p of data.participants) {
      feedback.push(
        {
          participant_id: p.id,
          date: "2026-05-04",
          created: "2026-05-04T10:00:00Z",
          details: JSON.stringify({
            source: "Participant-reported",
            preferences: { responded: true, interests: ["Games"] },
            barriers: [
              {
                category: "Language",
                status: "Reported",
                source: "Participant-reported",
                date: "2026-05-04",
              },
            ],
          }),
        },
        {
          participant_id: p.id,
          date: "2026-10-20",
          created: "2026-10-20T10:00:00Z",
          details: JSON.stringify({
            source: "Participant-reported",
            preferences: { languages: ["Malay"] },
            barriers: [],
          }),
        },
      );
      profiles.push({
        participant_id: p.id,
        revision: 1,
        updated: "2026-11-03T10:00:00Z",
        details: JSON.stringify({
          barriers: [
            {
              category: "Language",
              status: "Not present",
              source: "Participant-reported",
              date: "2026-11-03",
            },
          ],
        }),
      });
    }
    const r = needsAnalysis(data, profiles, feedback, [], {}, {}, "2026-11-03");
    assert.equal(r.responses.interests.values[0].unique, 10);
    assert.equal(r.responses.preferences.languages.values[0].unique, 10);
    assert.deepEqual(r.responses.barriers.values, []);
    assert.deepEqual(r.responses.hypotheses.values, []);
    assert.ok(!r.findings.some((f) => f.category === "Targeted Outreach"));
  } finally {
    db.close();
  }
});

test("verified members with no attendance are included in needs and interest analysis without inventing attendance", () => {
  const db = database();
  try {
    save(db, parse(...repeated()));
    const data = readData(db),
      profiles = [],
      registry = [];
    for (let i = 0; i < 5; i++) {
      const id = hash(["registered-not-attending-" + i]);
      data.participants.push({
        id,
        age: 75,
        gender: "FEMALE",
        race: "MALAY",
        cfs: null,
        livingRaw: "Alone",
        client: true,
        boundary: true,
      });
      registry.push({
        participant_id: id,
        snapshot: "complete",
        details: JSON.stringify({ registrationDate: "2026-01-01" }),
      });
      profiles.push({
        participant_id: id,
        revision: 1,
        updated: "2026-11-03T10:00:00Z",
        details: JSON.stringify({
          preferences: { responded: true, interests: ["Games"] },
          needs: [
            {
              category: "Transport assistance",
              status: "Reported",
              source: "Participant-reported",
              date: "2026-11-03",
            },
          ],
        }),
      });
    }
    const r = needsAnalysis(
      data,
      profiles,
      [],
      registry,
      {
        registry: {
          complete: true,
          snapshot: "complete",
          asOf: "2026-11-03",
          historyComplete: false,
        },
      },
      {},
      "2026-11-03",
    );
    assert.equal(r.summary.unique, 10);
    assert.equal(r.registry.total, 5);
    assert.equal(r.registry.noRecordedAttendance, 5);
    assert.equal(r.registry.neverAttended, null);
    assert.equal(r.responses.eligible, 5);
    assert.equal(r.profiles.livingAlone, 5);
    assert.equal(r.responses.interests.values[0].unique, 5);
    assert.equal(r.responses.needs.values[0].unique, 5);
    assert.equal(r.quality[0].total, 5);
    assert.match(r.responses.scope, /without recorded attendance/);
    assert.equal(data.attendance.length, 20);
  } finally {
    db.close();
  }
});
