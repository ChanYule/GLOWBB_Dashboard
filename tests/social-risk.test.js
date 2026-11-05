import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  HEADERS,
  RISK_HEADER,
  parseRows,
  readFile,
  inspectImport,
  analytics,
  defaults,
  riskState,
  hash,
} from "../server/domain.js";
import { openDb, readData, saveImport, passwordHash } from "../server/db.js";
import { sqlitePreviews } from "../server/previews.js";
import { createApp } from "../server/app.js";
const headers = [...HEADERS.slice(0, 5), RISK_HEADER, ...HEADERS.slice(5)];
const row = (id, risk = "0", day = "04", extra = {}) =>
  headers.map(
    (h) =>
      ({
        "Name/Member ID": id,
        Gender: "MALE",
        "Name/Age": "65",
        "Name/Race": "MALAY",
        "Name/CFS": "CFS1",
        "Is Client": "YES",
        "Within Boundary": "YES",
        "Activity Name": "Movement",
        "AAP Domain": "Physical",
        "Session Detail": `2026-05-${day}, 09:00 AM - 10:00 AM`,
        [RISK_HEADER]: risk,
        ...extra,
      })[h],
  );
const parse = (...rows) => parseRows([headers, ...rows]);
function dbFixture() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
    "admin",
    passwordHash("long-test-password"),
    "admin",
  );
  return db;
}
function save(db, parsed, mode = "merge") {
  parsed.mode = mode;
  const inspection = inspectImport(parsed, readData(db));
  return saveImport(db, parsed, inspection, 1);
}
test("11-column XLSX preserves literal numeric zero, blank, and full punctuation codes; 10-column exports remain valid", async () => {
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet("Attendance");
  sheet.addRow(headers);
  sheet.addRow(row("one", 0));
  sheet.addRow(row("two", ""));
  sheet.addRow(row("three", "A;B"));
  const parsed = await readFile(
    Buffer.from(await wb.xlsx.writeBuffer()),
    "new.xlsx",
  );
  assert.equal(parsed.rows[0].participant.riskRaw, "0");
  assert.equal(parsed.rows[1].participant.riskRaw, null);
  assert.equal(parsed.rows[2].participant.riskRaw, "A;B");
  const old = parseRows([
    HEADERS,
    HEADERS.map(
      (h) => Object.fromEntries(headers.map((h, i) => [h, row("old")[i]]))[h],
    ),
  ]);
  assert.equal(old.rows.length, 1);
  assert.equal("riskRaw" in old.rows[0].participant, false);
});
test("small export enriches existing profiles without replacing history, including duplicate attendance", () => {
  const db = dbFixture();
  try {
    save(
      db,
      parse(
        ...Array.from({ length: 28 }, (_, i) =>
          row("same", "", String(i + 1).padStart(2, "0")),
        ),
      ),
    );
    const update = parse(row("same", "0"));
    const before = inspectImport(update, readData(db), "merge");
    assert.equal(before.fresh.length, 0);
    assert.equal(before.updates.length, 1);
    assert.equal(before.matched, 1);
    assert.equal(before.resultingAttendance, 28);
    save(db, update);
    assert.equal(readData(db).attendance.length, 28);
    assert.equal(readData(db).participants[0].riskRaw, "0");
    assert.equal(save(db, parse(row("same", "0"))).updatedProfiles, 0);
    assert.equal(readData(db).attendance.length, 28);
    save(
      db,
      parse(
        row("same", "", "05", {
          Gender: "",
          "Name/Race": "",
          "Name/Age": "",
          "Name/CFS": "",
          "Is Client": "",
          "Within Boundary": "",
        }),
      ),
    );
    const p = readData(db).participants[0];
    assert.equal(p.riskRaw, "0");
    assert.equal(p.gender, "MALE");
    assert.equal(p.age, 65);
    assert.equal(p.cfs, "CFS1");
    assert.equal(p.client, true);
    assert.equal(
      db.prepare("SELECT count(*) n FROM risk_observations").get().n,
      29,
    );
  } finally {
    db.close();
  }
});
test("add mode retains profiles and skips conflicts while merge explicitly updates them", () => {
  const db = dbFixture();
  try {
    save(db, parse(row("same", "A")));
    const incoming = parse(row("same", "B", "05"));
    assert.equal(inspectImport(incoming, readData(db), "add").fresh.length, 0);
    save(db, incoming);
    assert.equal(readData(db).participants[0].riskRaw, "B");
    assert.equal(readData(db).attendance.length, 2);
  } finally {
    db.close();
  }
});
test("risk codes require explicit documented mappings; multiple factors are never split implicitly", () => {
  assert.equal(riskState({ riskRaw: "0" }, defaults).state, "unmapped");
  assert.equal(riskState({ riskRaw: null }).state, "missing");
  const s = {
    ...defaults,
    riskMappings: {
      0: { noRisk: true, categories: [] },
      "A;B": { noRisk: false, categories: ["Support A", "Support B"] },
    },
    multipleRiskFactors: true,
  };
  assert.equal(riskState({ riskRaw: "0" }, s).state, "no-risk");
  assert.deepEqual(riskState({ riskRaw: "A;B" }, s).categories, [
    "Support A",
    "Support B",
  ]);
  assert.equal(riskState({ riskRaw: "A" }, s).state, "unmapped");
});
test("analytics uses current profile classifications, distinct seniors, distinct sessions and AND filters", () => {
  const db = dbFixture();
  try {
    save(
      db,
      parse(
        row("a", "0"),
        row("a", "0", "05"),
        row("b", "", "04", { "Name/Age": "59" }),
        row("c", "", "04", { Gender: "FEMALE" }),
        row("d", "", "04", { "Name/Age": "" }),
      ),
    );
    const report = analytics(
      readData(db),
      defaults,
      {
        gender: "MALE",
        ageBand: "60-69",
        weekday: "1",
        timeSlot: "Morning",
        cfs: "CFS1",
      },
      "2026-11-03",
    );
    assert.equal(report.summary.unique, 1);
    assert.equal(report.summary.attendance, 1);
    assert.equal(report.summary.sessions, 1);
    assert.equal(report.summary.riskUnmapped, 1);
    assert.equal(report.programmes[0].unique, 1);
    assert.equal(report.domains[0].unique, 1);
    assert.equal(
      report.trends.reduce((n, t) => n + t.attendance, 0),
      1,
    );
    const empty = analytics(
      readData(db),
      defaults,
      { gender: "NO SUCH VALUE" },
      "2026-11-03",
    );
    assert.equal(empty.summary.unique, 0);
    assert.deepEqual(empty.insights, []);
  } finally {
    db.close();
  }
});
test("full replacement requires confirmation, rejects stale previews, and saves a restorable snapshot atomically", () => {
  const db = dbFixture();
  try {
    save(db, parse(row("old", "0"), row("old", "0", "05")));
    const previews = sqlitePreviews(db),
      parsed = parse(row("new", "A"));
    parsed.mode = "replace";
    parsed.fingerprint = hash(readData(db));
    previews.put("replace", parsed, 1);
    assert.throws(() => previews.confirm("replace", 1), /confirmation/);
    assert.equal(readData(db).attendance.length, 2);
    const result = previews.confirm("replace", 1, {
      confirmation: "REPLACE ATTENDANCE",
    });
    assert.equal(result.imported, 1);
    assert.equal(readData(db).attendance.length, 1);
    const backup = JSON.parse(
      db.prepare("SELECT payload FROM attendance_backups").get().payload,
    );
    assert.equal(backup.attendance.length, 2);
    assert.equal(
      backup.attendanceRows[0].source_session,
      "2026-05-04, 09:00 AM - 10:00 AM",
    );
    const stale = parse(row("other"));
    stale.mode = "replace";
    stale.fingerprint = hash(readData(db));
    previews.put("stale", stale, 1);
    save(db, parse(row("another")));
    assert.throws(
      () =>
        previews.confirm("stale", 1, { confirmation: "REPLACE ATTENDANCE" }),
      /fresh preview/,
    );
  } finally {
    db.close();
  }
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
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    close: () => new Promise((r) => server.close(r)),
  };
}
test("staff sessions enforce roles, isolate preferences and restrict raw risk details, exports and reconstruction queries", async () => {
  const db = dbFixture();
  db.prepare("INSERT INTO users VALUES(2,?,?,?)").run(
    "viewer",
    passwordHash("viewer-password-long"),
    "viewer",
  );
  db.prepare("INSERT INTO users VALUES(3,?,?,?)").run(
    "planner",
    passwordHash("planner-password-long"),
    "planner",
  );
  save(
    db,
    parse(
      ...Array.from({ length: 6 }, (_, i) => row("a" + i, i === 0 ? "" : "0")),
    ),
  );
  const app = await serve(db);
  try {
    assert.equal((await app.request("/api/dashboard")).status, 401);
    assert.equal((await app.request("/api/ready")).status, 200);
    const login = async (username, password) => {
      const r = await app.request("/api/login", "POST", { username, password });
      assert.equal(r.status, 200);
      assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
      return r.headers.get("set-cookie").split(";")[0];
    };
    const admin = await login("admin", "long-test-password"),
      viewer = await login("viewer", "viewer-password-long"),
      planner = await login("planner", "planner-password-long");
    assert.equal(
      (await app.request("/api/settings", "PUT", defaults, viewer)).status,
      403,
    );
    assert.equal(
      (await app.request("/api/import/confirm", "POST", { id: "x" }, planner))
        .status,
      403,
    );
    assert.equal(
      (await app.request("/api/risk-configuration", "GET", null, viewer))
        .status,
      403,
    );
    assert.equal(
      (await app.request("/api/social-risk", "GET", null, viewer)).status,
      403,
    );
    assert.equal(
      (await app.request("/api/export/csv", "GET", null, viewer)).status,
      403,
    );
    const pref = {
      views: [
        {
          id: "personal",
          name: "Male Outreach",
          kpis: ["male"],
          charts: [],
          filters: { gender: "MALE" },
        },
      ],
      active: "personal",
      template: "Overview",
    };
    assert.equal(
      (await app.request("/api/preferences", "PUT", pref, viewer)).status,
      200,
    );
    assert.deepEqual(
      await (await app.request("/api/preferences", "GET", null, viewer)).json(),
      pref,
    );
    assert.deepEqual(
      (
        await (
          await app.request("/api/preferences", "GET", null, planner)
        ).json()
      ).views,
      [],
    );
    const report = await (
      await app.request("/api/dashboard", "GET", null, admin)
    ).json();
    assert.equal(report.summary.riskMissing, undefined);
    assert.equal(report.socialRisk, undefined);
    assert.equal(report.settings.riskMappings, undefined);
    const risk = await (
      await app.request("/api/social-risk", "GET", null, planner)
    ).json();
    assert.equal(risk.suppressed, false);
    assert.ok(risk.states.length>0);
    assert.equal(
      (await app.request("/api/social-risk?gender=MALE", "GET", null, planner))
        .status,
      403,
    );
    assert.equal(
      (await app.request("/api/dashboard?risk=unmapped", "GET", null, admin))
        .status,
      403,
    );
    assert.equal(
      (await app.request("/api/export/csv?risk=unmapped", "GET", null, admin))
        .status,
      400,
    );
    const invalid = {
      ...defaults,
      riskMappings: {
        0: { label: "No risk", meaning: "", noRisk: true, categories: [] },
      },
    };
    assert.equal(
      (await app.request("/api/risk-configuration", "PUT", invalid, admin))
        .status,
      400,
    );
    const mapping = {
      ...defaults,
      riskMappings: {
        0: {
          label: "Approved source label",
          meaning: "Test source specification confirms code meaning",
          noRisk: true,
          categories: [],
        },
      },
    };
    assert.equal(
      (await app.request("/api/risk-configuration", "PUT", mapping, admin))
        .status,
      200,
    );
    assert.equal(
      (
        await app.request(
          "/api/analysis/export?group=programme&metric=unique",
          "GET",
          null,
          viewer,
        )
      ).status,
      403,
    );
    const generalExport = await app.request(
      "/api/analysis/export?group=programme&metric=unique",
      "GET",
      null,
      planner,
    );
    assert.equal(generalExport.status, 200);
    assert.match(await generalExport.text(), /Movement/);
    assert.equal(
      (
        await app.request(
          "/api/analysis/export?group=programme&metric=male",
          "GET",
          null,
          planner,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request(
          "/api/analysis/export?group=programme&metric=unique&gender=MALE",
          "GET",
          null,
          planner,
        )
      ).status,
      403,
    );
    const saved = {
      ...pref,
      views: [
        {
          ...pref.views[0],
          filters: {},
          kpis: ["unique", "male"],
          charts: [{ group: "programme", metric: "unique" }],
        },
      ],
    };
    await app.request("/api/preferences", "PUT", saved, planner);
    const savedExport = await app.request(
      "/api/analysis/view/personal/export",
      "GET",
      null,
      planner,
    );
    assert.equal(savedExport.status, 200);
    assert.match(await savedExport.text(), /Demographic and risk/);
    assert.equal(
      (
        await app.request(
          "/api/analysis/view/personal/export",
          "GET",
          null,
          admin,
        )
      ).status,
      404,
    );
    const config = await (
      await app.request("/api/risk-configuration", "GET", null, admin)
    ).json();
    assert.equal(config.values.find((r) => r.raw === "0").participants, 5);
    await app.request("/api/logout", "POST", {}, viewer);
    assert.equal(
      (await app.request("/api/preferences", "GET", null, viewer)).status,
      401,
    );
  } finally {
    await app.close();
    db.close();
  }
});

test("multi-programme/domain choices use OR within fields and AND across fields", () => {
  const db = dbFixture();
  try {
    save(
      db,
      parse(
        row("one", "0", "04"),
        row("two", "0", "05", {
          "Activity Name": "Learning",
          "AAP Domain": "Learning",
        }),
        row("three", "0", "06", {
          "Activity Name": "Social",
          "AAP Domain": "Social",
          Gender: "FEMALE",
        }),
      ),
    );
    const data = readData(db);
    const selected = data.programmes
      .filter((p) => ["Movement", "Learning"].includes(p.name))
      .map((p) => p.id);
    const r = analytics(
      data,
      defaults,
      {
        programme: JSON.stringify(selected),
        domain: JSON.stringify(["Physical", "Learning"]),
        gender: "MALE",
      },
      "2026-11-03",
    );
    assert.equal(r.summary.unique, 2);
    assert.equal(r.summary.sessions, 2);
    assert.equal(r.programmes.length, 2);
  } finally {
    db.close();
  }
});
test("conflicting profiles inside a single reviewed merge persist the final nonblank value", () => {
  const db = dbFixture();
  try {
    save(
      db,
      parse(row("same", "A"), row("same", "B", "05"), row("same", "", "06")),
    );
    assert.equal(readData(db).participants[0].riskRaw, "B");
    assert.equal(readData(db).attendance.length, 3);
    assert.equal(
      db.prepare("SELECT count(*) n FROM risk_observations").get().n,
      3,
    );
  } finally {
    db.close();
  }
});

test("protected risk snapshots allow programme, overlapping-category and demographic analysis only when every filterable cohort is sufficiently large", async () => {
  const { protectedRiskReport } = await import("../server/risk-report.js");
  const db = dbFixture();
  try {
    save(
      db,
      parse(
        ...Array.from({ length: 5 }, (_, i) => [
          row("a" + i, "A;B"),
          row("a" + i, "A;B", "05"),
        ]).flat(),
      ),
    );
    const settings = {
      ...defaults,
      multipleRiskFactors: true,
      riskMappings: {
        "A;B": {
          label: "Approved factors",
          meaning: "Validated fixture code",
          noRisk: false,
          categories: ["Factor A", "Factor B"],
        },
      },
    };
    const data = readData(db),
      r = protectedRiskReport(data, settings, "2026-11-03");
    assert.equal(r.suppressed, false);
    assert.equal(r.categories.length, 2);
    assert.equal(r.states[0].unique, 5);
    assert.equal(r.categories[0].unique, 5);
    assert.equal(r.programmes[0].unique, 5);
    assert.equal(r.programmes[0].sessions, 2);
    assert.equal(r.programmes[0].repeat, 5);
    assert.equal(r.completion.percent, 100);
    assert.ok(
      r.demographics.some(
        (d) => d.dimension === "Gender" && d.label === "MALE" && d.unique === 5,
      ),
    );
    assert.equal(JSON.stringify(r).includes(data.participants[0].id), false);
    const changed = {
      ...data,
      participants: data.participants.map((p, i) =>
        i === 0 ? { ...p, age: 66 } : p,
      ),
    };
    const hidden = protectedRiskReport(changed, settings, "2026-11-03");
    assert.equal(hidden.suppressed, true);
    assert.deepEqual(hidden.categories, []);
    assert.deepEqual(hidden.programmes, []);
    assert.deepEqual(hidden.demographics, []);
    assert.equal(hidden.completion, null);
  } finally {
    db.close();
  }
});
