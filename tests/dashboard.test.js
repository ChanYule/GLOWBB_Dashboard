import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  HEADERS,
  parseRows,
  parseSession,
  readFile,
  inspectImport,
  analytics,
  defaults,
} from "../server/domain.js";
import { openDb, readData, saveImport, passwordHash } from "../server/db.js";
import { createApp } from "../server/app.js";
const row = (
  id = "a",
  name = "Movement",
  detail = "2026-05-04, 09:00 AM - 09:45 AM",
  overrides = {},
) =>
  HEADERS.map(
    (h) =>
      ({
        ...{
          "Name/Member ID": id,
          Gender: "MALE",
          "Name/Age": "60",
          "Name/Race": "MALAY",
          "Name/CFS": "Unconfirmed",
          "Is Client": "YES",
          "Within Boundary": "NO",
          "Activity Name": name,
          "AAP Domain": "Physical",
          "Session Detail": detail,
        },
        ...overrides,
      })[h],
  );
const source = (rows) => parseRows([HEADERS, ...rows]);
function database() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
    "admin",
    passwordHash("test-password-long"),
    "admin",
  );
  return db;
}
function importRows(db, rows) {
  const parsed = source(rows);
  return saveImport(db, parsed, inspectImport(parsed, readData(db)), 1);
}
const now = "2026-10-26";
test("exact headers, CSV quoting and XLSX parsing", async () => {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("Attendance");
  s.addRow(HEADERS);
  s.addRow(row());
  const parsed = await readFile(
    Buffer.from(await wb.xlsx.writeBuffer()),
    "attendance.xlsx",
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].session.start, 540);
  const csv = [HEADERS, row("a", "A, B")]
    .map((r) =>
      r.map((x) => '"' + String(x).replaceAll('"', '""') + '"').join(","),
    )
    .join("\r\n");
  assert.equal(
    (await readFile(Buffer.from(csv), "file.csv")).rows[0].programme.name,
    "A, B",
  );
  assert.throws(() => parseRows([["Wrong"]]));
});
test("strict valid dates, noon, midnight, invalid time and end order", () => {
  assert.equal(parseSession("2026-05-04, 12:00 AM - 12:00 PM").start, 0);
  assert.equal(parseSession("2026-05-04, 12:00 AM - 12:00 PM").end, 720);
  for (const s of [
    "2026-02-30, 09:00 AM - 10:00 AM",
    "2026-05-04, 13:00 PM - 02:00 PM",
    "2026-05-04, 10:00 AM - 09:00 AM",
    "04/05/2026",
    "2026-05-04, 09:65 AM - 10:00 AM",
  ])
    assert.throws(() => parseSession(s));
});
test("age eligibility, subgroups, unknown denominators, all-age attendance", () => {
  const db = database();
  importRows(db, [
    row("a"),
    row("b", "Movement", undefined, { "Name/Age": "59" }),
    row("c", "Movement", undefined, {
      Gender: "FEMALE",
      "Name/Race": "UNKNOWN",
      "Name/Age": "80",
    }),
    row("d", "Movement", undefined, {
      Gender: "",
      "Name/Race": "CHINESE",
      "Name/Age": "",
    }),
  ]);
  const r = analytics(readData(db), defaults, {}, now);
  assert.equal(r.summary.unique, 2);
  assert.equal(r.summary.male, 1);
  assert.equal(r.summary.minority, 1);
  assert.equal(r.summary.malePct, 50);
  assert.equal(r.summary.minorityPct, 100);
  assert.equal(r.summary.unknownRace, 1);
  assert.equal(r.summary.attendance, 4);
  assert.equal(r.quality.missingAge, 1);
  assert.equal(
    analytics(readData(db), { ...defaults, seniorAge: 70 }, {}, now).summary
      .unique,
    1,
  );
  db.close();
});
test("distinct reach across programmes and months; separate same-day sessions; repeats", () => {
  const db = database();
  importRows(db, [
    row(),
    row("a", "Movement", "2026-05-04, 10:00 AM - 10:45 AM"),
    row("a", "Learning", "2026-06-04, 09:00 AM - 09:45 AM"),
    row("b", "Learning", "2026-06-04, 09:00 AM - 09:45 AM"),
  ]);
  const r = analytics(readData(db), defaults, {}, now);
  assert.equal(r.summary.unique, 2);
  assert.equal(r.summary.attendance, 4);
  assert.equal(r.summary.sessions, 3);
  assert.equal(r.summary.repeat, 1);
  assert.equal(
    r.programmes.reduce((n, p) => n + p.unique, 0),
    3,
  );
  assert.equal(r.trends.find((t) => t.label === "2026-05").unique, 1);
  assert.equal(r.trends.find((t) => t.label === "2026-06").unique, 2);
  assert.equal(r.programmes[0].name, "Learning");
  db.close();
});
test("idempotence, exact duplicates and persistent data preservation", () => {
  const db = database();
  let result = importRows(db, [row(), row()]);
  assert.equal(result.imported, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.exactDuplicates, 1);
  result = importRows(db, [row()]);
  assert.equal(result.imported, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(readData(db).attendance.length, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM imports").get().n, 2);
  db.close();
});
test("conflicts skipped and programme variants remain distinct", () => {
  const db = database();
  importRows(db, [row()]);
  const p = source([
    row("a", "Movement", "2026-06-04, 09:00 AM - 09:45 AM", {
      "Name/Race": "INDIAN",
    }),
    row("b", "movement"),
    row("c", "Movement", undefined, { "AAP Domain": "Learning" }),
  ]);
  const inspected = inspectImport(p, readData(db));
  assert.equal(inspected.conflicts.length, 2);
  assert.equal(inspected.fresh.length, 1);
  assert.ok(inspected.variants.length > 0);
  saveImport(db, p, inspected, 1);
  assert.equal(
    readData(db).participants.find(
      (p) => p.id === source([row()]).rows[0].participant.id,
    ).race,
    "MALAY",
  );
  assert.equal(readData(db).programmes.length, 2);
  db.close();
});
test("global filters update summaries, charts, rankings and recommendations", () => {
  const db = database();
  importRows(db, [
    row(),
    row("b", "Talk", "2026-06-04, 01:00 PM - 02:00 PM", {
      Gender: "FEMALE",
      "AAP Domain": "Social",
    }),
    row("a", "Talk", "2026-06-04, 01:00 PM - 02:00 PM", {
      "AAP Domain": "Social",
    }),
  ]);
  for (const f of [
    { domain: "Physical" },
    { from: "2026-05-01", to: "2026-05-31" },
    { gender: "FEMALE" },
    { target: "minority" },
    { client: "true" },
    { boundary: "false" },
  ]) {
    const r = analytics(readData(db), defaults, f, now);
    assert.equal(
      r.summary.attendance,
      r.domains.reduce((n, d) => n + d.attendance, 0),
    );
    assert.equal(
      r.summary.attendance,
      r.programmes.reduce((n, d) => n + d.attendance, 0),
    );
    assert.equal(r.recommendations.length, r.programmes.length);
  }
  const june = analytics(
    readData(db),
    defaults,
    { from: "2026-06-01", to: "2026-06-30" },
    now,
  );
  assert.equal(june.summary.firstObserved, 1);
  assert.equal(june.summary.unique, 2);
  const female = analytics(readData(db), defaults, { gender: "FEMALE" }, now);
  assert.equal(female.summary.unique, 1);
  assert.equal(female.programmes[0].name, "Talk");
  db.close();
});
test("partial periods, weekly/quarterly grouping, missing months and future attendance", () => {
  const db = database();
  importRows(db, [
    row(),
    row("a", "Movement", "2026-10-26, 09:00 AM - 09:45 AM"),
    row("b", "Movement", "2026-11-01, 09:00 AM - 09:45 AM"),
  ]);
  const r = analytics(readData(db), defaults, {}, now);
  assert.equal(r.trends.find((t) => t.label === "2026-10").partial, true);
  assert.equal(r.trends.find((t) => t.label === "2026-07").unique, 0);
  assert.equal(r.summary.attendance, 2);
  assert.equal(r.quality.futureSessions, 1);
  assert.match(
    analytics(readData(db), defaults, { interval: "quarter" }, now).trends[0]
      .label,
    /Q/,
  );
  assert.equal(
    analytics(readData(db), defaults, { interval: "week" }, now).trends[0]
      .label,
    "2026-05-04",
  );
  db.close();
});
test("empty data, small samples, invalid ages, missing IDs and unsupported files", async () => {
  const db = database();
  const r = analytics(readData(db), defaults, {}, now);
  assert.equal(r.summary.unique, 0);
  assert.equal(r.summary.malePct, null);
  assert.deepEqual(r.recommendations, []);
  const p = source([
    row("", "Talk"),
    row("x", "Talk", undefined, { "Name/Age": "not an age" }),
  ]);
  assert.equal(p.issues.length, 2);
  importRows(db, [row()]);
  const rec = analytics(readData(db), defaults, {}, now).recommendations[0];
  assert.equal(rec.category, "Review");
  assert.equal(rec.evidence, "Limited");
  assert.match(rec.figures, /1 unique seniors · 1 sessions/);
  await assert.rejects(readFile(Buffer.from("not a file"), "bad.xlsx"));
  await assert.rejects(readFile(Buffer.from("anything"), "bad.xls"));
  db.close();
});
test("formula cells and ambiguous workbooks rejected", async () => {
  const wb = new ExcelJS.Workbook(),
    s = wb.addWorksheet("A");
  s.addRow(HEADERS);
  s.addRow(row());
  s.getCell("C2").value = { formula: "60+1", result: 61 };
  await assert.rejects(
    readFile(Buffer.from(await wb.xlsx.writeBuffer()), "a.xlsx"),
  );
  s.getCell("C2").value = 61;
  wb.addWorksheet("B").addRow(HEADERS);
  await assert.rejects(
    readFile(Buffer.from(await wb.xlsx.writeBuffer()), "a.xlsx"),
  );
});
test("dashboard opens without login; origin checks, import confirmation and persistence remain intact", async () => {
  const db = openDb(":memory:");
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
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
  try {
    assert.equal((await request("/api/dashboard")).status, 200);
    const me = await request("/api/me");
    assert.equal(me.headers.has("set-cookie"), false);
    assert.equal((await me.json()).username, "Local workspace");
    assert.equal((await request("/api/login", "POST", {})).status, 404);
    assert.equal((await request("/api/logout", "POST", {})).status, 404);
    assert.equal(
      (await request("/api/settings", "PUT", defaults, false)).status,
      403,
    );
    const csv = [HEADERS, row()]
      .map((r) => r.map((x) => '"' + x + '"').join(","))
      .join("\r\n");
    const form = new FormData();
    form.append("file", new Blob([csv]), "attendance.csv");
    const response = await request("/api/import/preview", "POST", form);
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.ready, 1);
    assert.equal(readData(db).attendance.length, 0);
    assert.equal(
      (await request("/api/import/confirm", "POST", { id: preview.id })).status,
      200,
    );
    assert.equal(readData(db).attendance.length, 1);
    assert.equal(
      (await request("/api/import/confirm", "POST", { id: preview.id })).status,
      400,
    );
    const imported = db.prepare("SELECT user_id FROM imports").get();
    assert.equal(
      imported.user_id,
      (await (await request("/api/me")).json()).id,
    );
    assert.equal((await request("/api/quality")).status, 200);
    assert.equal(
      (
        await request("/api/targets", "POST", {
          metric: "male",
          value: 10,
          start: "2026-05-01",
          end: "2026-10-26",
        })
      ).status,
      200,
    );
    let dashboard = await (
      await request("/api/dashboard?gender=FEMALE")
    ).json();
    assert.equal(dashboard.summary.unique, 0);
    assert.equal(dashboard.targets[0].current, 1);
    const programmeId = readData(db).programmes[0].id;
    assert.equal(
      (
        await request("/api/decisions/" + programmeId, "PUT", {
          status: "Approved for planning",
          notes: "Check resources.",
        })
      ).status,
      200,
    );
    const exported = await request("/api/export/csv");
    assert.equal(exported.status, 200);
    assert.equal((await exported.text()).includes("Male reach"), false);
    assert.equal(
      (await request("/api/export/csv?target=minority")).status,
      400,
    );
    const report = await (await request("/api/export/report")).text();
    assert.equal(report.includes("Check resources."), false);
    assert.equal(
      (
        await request("/api/settings", "PUT", {
          ...defaults,
          seniorAge: 70,
          ageBands: [80, 90],
        })
      ).status,
      200,
    );
    dashboard = await (await request("/api/dashboard")).json();
    assert.equal(dashboard.summary.unique, 0);
    assert.equal(readData(db).attendance.length, 1);
    createApp(db);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM users WHERE username='__local_workspace__'",
        )
        .get().n,
      1,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test("missing race remains distinct from UNKNOWN and neither inflates known denominators", () => {
  const db = database();
  importRows(db, [
    row("a"),
    row("b", "Movement", undefined, { "Name/Race": "" }),
    row("c", "Movement", undefined, { "Name/Race": "UNKNOWN" }),
    row("d", "Movement", undefined, {
      Gender: "OTHER",
      "Name/Race": "CHINESE",
    }),
  ]);
  const r = analytics(readData(db), defaults, {}, now);
  assert.equal(r.summary.knownRace, 2);
  assert.equal(r.summary.minorityPct, 50);
  assert.equal(r.summary.unknownRace, 2);
  assert.equal(r.summary.recordedUnknownRace, 1);
  assert.equal(r.summary.missingRace, 1);
  assert.ok(r.race.some((r) => r.label === "MISSING"));
  assert.ok(r.race.some((r) => r.label === "UNKNOWN"));
  assert.equal(r.summary.knownGender, 3);
  db.close();
});
test("duplicate identity still flags changed demographics, and invalid CSV errors contain no source data", async () => {
  const db = database();
  importRows(db, [row()]);
  const check = inspectImport(
    source([row("a", "Movement", undefined, { "Name/Age": "61" })]),
    readData(db),
  );
  assert.equal(check.conflicts.length, 1);
  assert.equal(check.duplicates.length, 0);
  await assert.rejects(
    readFile(Buffer.from('private-member,too,many\n"broken'), "file.csv"),
    (e) =>
      !e.message.includes("private-member") &&
      e.message.startsWith("CSV could not"),
  );
  await assert.rejects(readFile(Buffer.from([0xff, 0xfe, 0x01]), "file.csv"));
  db.close();
});
test("recommendation rules yield Expand, Maintain, Improve and Review from measured evidence only", () => {
  const db = database(),
    rows = [];
  // A broad recurring programme: 20 seniors, three sessions.
  for (let i = 0; i < 20; i++)
    for (const day of ["04", "11", "18"])
      rows.push(
        row("b" + i, "Broad reach", `2026-05-${day}, 09:00 AM - 10:00 AM`),
      );
  // A smaller consistent programme: five seniors, below 25% of overall reach.
  for (let i = 0; i < 5; i++)
    for (const day of ["04", "11", "18"])
      rows.push(row("s" + i, "Steady", `2026-05-${day}, 11:00 AM - 12:00 PM`));
  // Complete May/June months, sufficient sessions each, declining unique reach.
  for (let i = 0; i < 10; i++)
    for (const day of ["04", "11", "18"])
      rows.push(
        row("d" + i, "Declining", `2026-05-${day}, 01:00 PM - 02:00 PM`),
      );
  for (let i = 0; i < 5; i++)
    for (const day of ["04", "11", "18"])
      rows.push(
        row("d" + i, "Declining", `2026-06-${day}, 01:00 PM - 02:00 PM`),
      );
  rows.push(row("x", "Single workshop"));
  rows.push(
    row("young", "No eligible seniors", undefined, { "Name/Age": "59" }),
  );
  importRows(db, rows);
  const r = analytics(
    readData(db),
    defaults,
    { from: "2026-05-01", to: "2026-06-30" },
    now,
  );
  const rec = (name) => r.recommendations.find((x) => x.programme === name);
  assert.equal(rec("Broad reach").category, "Expand");
  assert.equal(rec("Steady").category, "Maintain");
  assert.equal(rec("Declining").category, "Improve");
  assert.equal(rec("Single workshop").category, "Review");
  assert.equal(rec("No eligible seniors").evidence, "Insufficient");
  assert.match(rec("Declining").figures, /10 unique seniors · 6 sessions/);
  const partial = analytics(
    readData(db),
    defaults,
    { from: "2026-05-15", to: "2026-06-30" },
    now,
  );
  assert.notEqual(
    partial.recommendations.find((x) => x.programme === "Declining").category,
    "Improve",
  );
  db.close();
});
test("equal elapsed-day prior comparison is withheld when history does not cover its start", () => {
  const db = database();
  importRows(db, [
    row("a", "Movement", "2026-04-01, 09:00 AM - 10:00 AM"),
    row("a", "Movement", "2026-05-10, 09:00 AM - 10:00 AM"),
    row("b", "Movement", "2026-06-10, 09:00 AM - 10:00 AM"),
  ]);
  const r = analytics(
    readData(db),
    defaults,
    { from: "2026-06-01", to: "2026-06-30" },
    "2026-06-15",
  );
  assert.equal(r.previous.from, "2026-05-17");
  assert.equal(r.previous.to, "2026-05-31");
  assert.equal(r.previous.unique, 0);
  assert.equal(
    analytics(
      readData(db),
      defaults,
      { from: "2026-04-01", to: "2026-04-30" },
      now,
    ).previous,
    null,
  );
  db.close();
});
test("SQLite startup migrations preserve records and decisions through a real file reopen", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "glowbb-test-"));
  const path = join(directory, "test.sqlite");
  try {
    let db = openDb(path);
    db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
      "test",
      passwordHash("long-test-password"),
      "admin",
    );
    importRows(db, [row()]);
    db.close();
    db = openDb(path);
    assert.equal(readData(db).attendance.length, 1);
    assert.equal(readData(db).participants.length, 1);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM schema_version").get().n,
      1,
    );
    assert.equal(importRows(db, [row()]).imported, 0);
    db.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
test("pilot planning persistence, report escaping, spreadsheet formula protection and input validation", async () => {
  const db = database();
  importRows(db, [
    row("a", "<script>alert(1)</script>"),
    row("b", '=HYPERLINK("example")'),
  ]);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, method = "GET", body) =>
    fetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const t = await (
      await req("/api/targets", "POST", {
        metric: "male",
        value: 20,
        start: "2026-05-01",
        end: "2026-12-31",
      })
    ).json();
    assert.equal(
      (
        await req("/api/decisions/target-" + t.id, "PUT", {
          status: "In progress",
          notes: "Check pilot resources.",
        })
      ).status,
      200,
    );
    const d = await (await req("/api/dashboard")).json();
    assert.equal(
      d.decisions.find((x) => x.id === "target-" + t.id).status,
      "In progress",
    );
    assert.equal(
      (
        await req("/api/decisions/target-9999", "PUT", {
          status: "In progress",
          notes: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/api/settings", "PUT", {
          ...defaults,
          minority: ["unknown"],
        })
      ).status,
      400,
    );
    const html = await (await req("/api/export/report")).text();
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.ok(html.includes("&lt;script&gt;"));
    const csv = await (await req("/api/export/csv")).text();
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.equal(csv.includes("Check pilot resources."), false);
    assert.equal((await req("/api/dashboard?from=2026-02-30")).status, 400);
    assert.equal((await req("/api/dashboard?domain=a&domain=b")).status, 400);
    await req("/api/targets/" + t.id, "DELETE");
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM opportunity_decisions").get().n,
      0,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
