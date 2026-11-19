import {MAX_IMPORT_BYTES,UPLOAD_CHUNK_BYTES} from '../shared/upload-limits.js';
import ExcelJS from "exceljs";
import test from "node:test";
import assert from "node:assert/strict";
import { CENTRES, classifyCentre } from "../shared/centres.js";
import { classifyMatrix } from "../server/centre-imports.js";
import { openDb, readData, passwordHash } from "../server/db.js";
import { createPlatformApp } from "../server/platform.js";
import { HEADERS, hash, defaults } from "../server/domain.js";
import { CLIENT_SNAPSHOT } from "../server/client-domain.js";
const member = "VERIFIED-EXACT-001";
test('centre administration overview counts only granted workspaces and reports registry completeness without identities',async()=>{
 const f=await app();try{
  await importAll(f);
  const res=await f.request('/api/centres/status');assert.equal(res.status,200);const body=await res.json();
  assert.equal(body.rows.length,4);assert.deepEqual(body.rows.map(r=>r.id),CENTRES.map(c=>c.id));
  assert.ok(body.rows.every(r=>r.attendance===1&&r.sessions===1&&r.participants===1));assert.ok(body.rows.every(r=>r.registryComplete===false));
  assert.equal(JSON.stringify(body).includes(member),false);
 }finally{await f.close();}
});
const attendance = (name = "GLOW - Stretch & Flow") => [
  member,
  "MALE",
  65,
  "MALAY",
  "4",
  "Yes",
  "Yes",
  name,
  "Physical",
  "2026-11-01, 09:00 AM - 10:00 AM",
];
function matrix() {
  return [
    [...HEADERS, "Centres"],
    [...attendance(), "Bukit Batok"],
    [...attendance("Healthy Cooking"), "Bukit Batok"],
    [...attendance(), "Nanyang"],
    [...attendance("Healthy Cooking"), "Nanyang"],
  ];
}
function csv(rows) {
  return rows
    .map((row) =>
      row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
    )
    .join("\r\n");
}
async function app(options = {}) {
  const db = openDb(":memory:"),
    stores = new Map();
  if (options.seed) options.seed(db);
  const application = createPlatformApp(db, {
    ...(options.auth === undefined ? {} : { authRequired: options.auth }),
    production: !!options.production,
    openWorkspace: (id) => {
      const child = openDb(":memory:");
      stores.set(id, child);
      return child;
    },
  });
  await application.platform.ready;
  const server = application.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (path, body, headers = {}) =>
    fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        ...(!(body instanceof FormData) && body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  return {
    db,
    stores,
    application,
    origin,
    request,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      for (const child of stores.values()) child.close();
      db.close();
    },
  };
}
async function preview(f, rows = matrix()) {
  const data = new FormData();
  data.append("file", new Blob([csv(rows)]), "attendance.csv");
  const r = await f.request("/api/import/preview?mode=merge", data);
  const result = await r.json();
  assert.equal(r.status, 200, JSON.stringify(result));
  return result;
}
async function importAll(f) {
  const p = await preview(f);
  const r = await f.request("/api/import/confirm", {
    id: p.id,
    confirmed: true,
  });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.json();
}

test("centre classification uses exact verified locations and only a standalone initial GLOW prefix", () => {
  for (const [location, name, id] of [
    ["Bukit Batok", "GLOW - Stretch & Flow", "glow_bukit_batok"],
    ["Bukit Batok", "Healthy Cooking", "seen_bukit_batok"],
    ["Nanyang", "GLOW - Kopi Talk", "glow_nanyang"],
    ["Nanyang", "Art and Craft", "seen_nanyang"],
    ["  nAnYaNg  ", "  gLoW: Healthy Cooking  ", "glow_nanyang"],
    ["Nanyang", "GLOWING Stars", "seen_nanyang"],
    ["Nanyang", "A GLOW activity", "seen_nanyang"],
    ["Nanyang", "GLOW2", "seen_nanyang"],
    ["Tzu Chi SEEN @ Bukit Batok", "GLOW - Stretch & Flow", "glow_bukit_batok"],
    ["Tzu Chi SEEN @ Bukit Batok", "Stretch & Flow", "seen_bukit_batok"],
    ["Tzu Chi SEEN @ Nanyang", "GLOW - Kopi Talk", "glow_nanyang"],
    ["Tzu Chi SEEN @ Nanyang", "Kopi Talk", "seen_nanyang"],
    ["  tzu  chi seen@ nAnYaNg  ", "  glow_Healthy Cooking ", "glow_nanyang"],
    ["Tzu Chi SEEN @ Bukit Batok", "GLOWING", "seen_bukit_batok"],
    ["Tzu Chi SEEN @ Bukit Batok", "A GLOW activity", "seen_bukit_batok"],
  ])
    assert.equal(classifyCentre(location, name).centreId, id);
  for (const location of [
    null,
    "BB",
    "Bukit Batok / Nanyang",
    "",
    "Tzu Chi SEEN @ Bukit Batok / Nanyang",
    "Not Bukit Batok",
    "Tzu Chi SEEN @ Unknown",
  ])
    assert.equal(classifyCentre(location, "GLOW Kopi Talk").centreId, null);
  assert.equal(classifyCentre("Nanyang", "").centreId, null);
  assert.equal(
    classifyCentre("Nanyang", "GLOW - Name", {
      centreId: "seen_nanyang",
      reason: "Reviewed naming exception",
    }).centreId,
    "seen_nanyang",
  );
  const withBlank = matrix();
  withBlank.push(Array(withBlank[0].length).fill(""));
  assert.equal(classifyMatrix(withBlank).unclassified, 0);
  assert.throws(() => classifyMatrix([]), /empty/);
  const m = matrix();
  m[0][m[0].length - 1] = "Centre";
  assert.equal(classifyMatrix(m).counts.glow_nanyang, 1);
  assert.equal(classifyMatrix([HEADERS, attendance()]).unclassified, 1);
  const aliases = matrix();
  aliases[0].push("Centre");
  for (let i = 1; i < aliases.length; i++)
    aliases[i].push("Tzu Chi SEEN @ " + aliases[i].at(-1));
  assert.equal(classifyMatrix(aliases).unclassified, 0);
  aliases[1][aliases[1].length - 1] = "Nanyang";
  assert.equal(classifyMatrix(aliases).unclassified, 1);
});

test("mixed-centre imports preserve names, scope programme identity, prevent duplicates and do not infer client affiliation", async () => {
  const f = await app();
  try {
    assert.equal(f.stores.size, 0);
    assert.equal((await f.request("/api/dashboard")).status, 400);
    const first = await f.request("/api/dashboard?centre=glow_nanyang");
    assert.equal(first.status, 200);
    assert.deepEqual([...f.stores.keys()], ["glow_nanyang"]);
    const p = await preview(f);
    assert.equal(p.ready, 4);
    assert.equal(p.unclassified, 0);
    assert.deepEqual(
      p.centreCounts,
      Object.fromEntries(CENTRES.map((c) => [c.id, 1])),
    );
    const confirm = await f.request("/api/import/confirm", {
      id: p.id,
      confirmed: true,
    });
    assert.equal(confirm.status, 200);
    assert.equal((await confirm.json()).imported, 4);
    const retry = await f.request("/api/import/confirm", {
      id: p.id,
      confirmed: true,
    });
    assert.equal((await retry.json()).imported, 4);
    for (const c of CENTRES) {
      const db = f.stores.get(c.id),
        data = readData(db);
      assert.equal(data.attendance.length, 1);
      assert.equal(data.participants[0].client, null);
      assert.equal(data.participants[0].sourceClientStatus, true);
      assert.equal(
        data.sessions[0].optional.centreClassification.centreId,
        c.id,
      );
      assert.equal(
        data.programmes[0].name,
        c.classification === "GLOW"
          ? "GLOW - Stretch & Flow"
          : "Healthy Cooking",
      );
      const r = await (await f.request("/api/dashboard?centre=" + c.id)).json();
      assert.equal(r.centre.id, c.id);
      assert.equal(r.summary.unique, 1);
    }
    const second = await preview(f);
    assert.equal(second.duplicates, 4);
    assert.equal(second.ready, 0);
    assert.equal(
      readData(f.db).attendance.length,
      0,
      "Legacy archive is never an import target",
    );
  } finally {
    await f.close();
  }
});

test("unclassified rows block confirmation and require explicit evidenced overrides, including missing Centre column", async () => {
  const f = await app();
  try {
    const p = await preview(f, [HEADERS, attendance()]);
    assert.equal(p.unclassified, 1);
    assert.equal(
      (await f.request("/api/import/confirm", { id: p.id, confirmed: true }))
        .status,
      400,
    );
    const reviewed = await f.request("/api/centres/import/review", {
      id: p.id,
      overrides: [],
      unclassifiedCentre: "glow_bukit_batok",
      reason: "Verified source export from GLOW Bukit Batok",
    });
    assert.equal(reviewed.status, 200);
    assert.equal((await reviewed.json()).unclassified, 0);
    assert.equal(
      (await f.request("/api/import/confirm", { id: p.id, confirmed: true }))
        .status,
      200,
    );
    assert.equal(
      readData(f.stores.get("glow_bukit_batok")).attendance.length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("centre-specific registry denominators never cross scopes and combined reach requires global ID verification", async () => {
  const f = await app();
  try {
    await importAll(f);
    const db = f.stores.get("glow_bukit_batok");
    for (const id of [hash([member]), "registered-nonattender"]) {
      const p = {
        client: true,
        memberId: id,
        age: 65,
        gender: "MALE",
        race: "MALAY",
      };
      db.prepare("INSERT OR IGNORE INTO participants VALUES(?,?)").run(
        id,
        JSON.stringify(p),
      );
      db.prepare("INSERT INTO member_registry VALUES(?,?,?)").run(
        id,
        CLIENT_SNAPSHOT,
        JSON.stringify(p),
      );
    }
    db.prepare("UPDATE settings SET value=?").run(
      JSON.stringify({
        ...defaults,
        centreId: "glow_bukit_batok",
        registry: {
          type: "clients",
          snapshot: CLIENT_SNAPSHOT,
          complete: true,
          asOf: "2026-11-01",
        },
      }),
    );
    const glow = await (
      await f.request(
        "/api/participation-patterns?centre=glow_bukit_batok&scope=clients&dimension=age",
      )
    ).json();
    assert.equal(glow.population, 2);
    assert.equal(glow.reliability.overall.rate, 50);
    const other = await (
      await f.request(
        "/api/participation-patterns?centre=glow_nanyang&scope=clients&dimension=age",
      )
    ).json();
    assert.equal(other.ratesAvailable, false);
    assert.equal(other.reliability.overall, null);
    let compared = await (await f.request("/api/centres/compare")).json();
    assert.equal(compared.combined.unique, null);
    assert.equal(
      compared.rows.find((r) => r.id === "glow_bukit_batok").clientRate,
      50,
    );
    assert.equal(
      compared.rows.find((r) => r.id === "seen_bukit_batok").registered,
      null,
    );
    const policy = await fetch(f.origin + "/api/centres/identity-policy", {
      method: "PUT",
      headers: { Origin: f.origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        verified: true,
        reason: "Synthetic source confirms globally unique opaque Member IDs",
      }),
    });
    assert.equal(policy.status, 200);
    compared = await (await f.request("/api/centres/compare")).json();
    assert.equal(compared.combined.unique, 1);
    assert.equal(compared.combined.attendance, 4);
  } finally {
    await f.close();
  }
});

test("restricted centre access is enforced for reports, settings, client records, imports and cross-centre mode", async () => {
  const f = await app({
    auth: true,
    seed: (db) => {
      db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)").run(
        "staff-one",
        passwordHash("fixture-password-long"),
        "planner",
      );
    },
  });
  try {
    const login = await f.request("/api/login", {
      username: "staff-one",
      password: "fixture-password-long",
    });
    const headers = { cookie: login.headers.get("set-cookie").split(";")[0] };
    const me = await (await f.request("/api/me", undefined, headers)).json();
    assert.equal((await f.request('/api/centres/status',undefined,headers)).status,403);
    assert.deepEqual(
      me.centres.map((c) => c.id),
      ["glow_bukit_batok"],
    );
    assert.equal(
      (
        await f.request(
          "/api/dashboard?centre=glow_bukit_batok",
          undefined,
          headers,
        )
      ).status,
      200,
    );
    for (const path of [
      "/api/dashboard?centre=glow_nanyang",
      "/api/export/report?centre=glow_nanyang",
      "/api/clients/report?centre=glow_nanyang",
      "/api/needs/participants/other?centre=glow_nanyang",
    ])
      assert.equal((await f.request(path, undefined, headers)).status, 403);
    assert.equal(
      (await f.request("/api/centres/compare", undefined, headers)).status,
      403,
    );
    assert.equal(
      (await f.request("/api/centres/migration", undefined, headers)).status,
      403,
    );
    assert.equal(
      (await f.request("/api/import/preview", new FormData(), headers)).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/dashboard?centre=glow_bukit_batok", undefined, {
          ...headers,
          "x-centre-id": "seen_nanyang",
        })
      ).status,
      400,
    );
    f.db.prepare("DELETE FROM centre_access WHERE user_id=?").run(me.id);
    assert.equal(
      (
        await f.request(
          "/api/dashboard?centre=glow_bukit_batok",
          undefined,
          headers,
        )
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});

test("legacy allocation is previewed, backed up and idempotent; registry affiliation is GLOW Bukit Batok only", async () => {
  const f = await app();
  try {
    const pid = hash([member]),
      pg = hash(["Legacy activity"]),
      sid = "legacy-session";
    f.db
      .prepare("INSERT INTO participants VALUES(?,?)")
      .run(pid, JSON.stringify({ age: 65, client: true }));
    f.db
      .prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)")
      .run(pg, "Legacy activity", "Physical");
    f.db
      .prepare(
        "INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)",
      )
      .run(sid, pg, "2026-11-01", 540, 600);
    f.db
      .prepare(
        "INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)",
      )
      .run("legacy-attendance", pid, sid, "Source record");
    f.db
      .prepare("INSERT INTO member_registry VALUES(?,?,?)")
      .run(
        pid,
        CLIENT_SNAPSHOT,
        JSON.stringify({ client: true, memberId: member, age: 65 }),
      );
    f.db.prepare("UPDATE settings SET value=?").run(
      JSON.stringify({
        ...defaults,
        registry: {
          type: "clients",
          snapshot: CLIENT_SNAPSHOT,
          complete: true,
          asOf: "2026-11-01",
        },
      }),
    );
    const legacy = await (await f.request("/api/centres/migration")).json();
    assert.equal(legacy.attendance, 1);
    assert.equal(f.stores.size, 0);
    const p = await (
      await f.request("/api/centres/migration/preview", {
        assignments: { [pg]: "glow_bukit_batok" },
        reason:
          "Reviewed historical source explicitly identifies GLOW Bukit Batok",
        includeGlowRegistry: true,
        configurationCentre: "glow_bukit_batok",
      })
    ).json();
    assert.ok(p.id);
    assert.equal(
      (
        await f.request("/api/centres/migration/confirm", {
          id: p.id,
          confirmation: "wrong",
        })
      ).status,
      400,
    );
    const r = await f.request("/api/centres/migration/confirm", {
      id: p.id,
      confirmation: "MIGRATE REVIEWED RECORDS",
    });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    assert.equal(readData(f.db).attendance.length, 1);
    assert.equal(
      readData(f.stores.get("glow_bukit_batok")).attendance.length,
      1,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM attendance_backups").get().n,
      1,
    );
    assert.equal(
      (
        await f.request("/api/centres/migration/confirm", {
          id: p.id,
          confirmation: "MIGRATE REVIEWED RECORDS",
        })
      ).status,
      200,
    );
    const allocated = await (await f.request("/api/centres/migration")).json();
    assert.equal(allocated.attendance, 0);
    assert.equal(allocated.legacyAttendance, 1);
    assert.equal(allocated.programmes[0].assignmentStatus, "Complete");
    const wrong = await (
      await f.request("/api/centres/migration/preview", {
        assignments: { [pg]: "glow_nanyang" },
        reason: "A different allocation must be refused",
      })
    ).json();
    assert.equal(
      (
        await f.request("/api/centres/migration/confirm", {
          id: wrong.id,
          confirmation: "MIGRATE REVIEWED RECORDS",
        })
      ).status,
      409,
    );
    assert.equal(f.stores.has("glow_nanyang"), false);
    const stale = await (
      await f.request("/api/centres/migration/preview", {
        assignments: {},
        reason: "Fresh review before a concurrent source update",
      })
    ).json();
    f.db
      .prepare("UPDATE settings SET value=?")
      .run(JSON.stringify({ ...defaults, seniorAge: 61 }));
    assert.equal(
      (
        await f.request("/api/centres/migration/confirm", {
          id: stale.id,
          confirmation: "MIGRATE REVIEWED RECORDS",
        })
      ).status,
      409,
    );
    const backups = await (
      await f.request("/api/centres/migration/backups")
    ).json();
    assert.ok(backups.length);
    assert.equal(
      (await f.request("/api/centres/migration/backups/" + backups[0].id))
        .status,
      200,
    );

    const other = await (
      await f.request("/api/clients/report?centre=seen_nanyang", {})
    ).json();
    assert.equal(other.available, false);
  } finally {
    await f.close();
  }
});

test("settings, preferences, recovery identifiers and exported centre labels remain isolated", async () => {
  const f = await app();
  try {
    await importAll(f);
    const put = (path, body) =>
      fetch(f.origin + path, {
        method: "PUT",
        headers: { Origin: f.origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await put("/api/settings?centre=glow_bukit_batok", {
          ...defaults,
          seniorAge: 70,
          ageBands: [80, 90],
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await f.request("/api/dashboard?centre=glow_nanyang")).json())
        .settings.seniorAge,
      60,
    );
    assert.equal(
      (
        await put("/api/preferences?centre=glow_bukit_batok", {
          views: [],
          active: "",
          template: "Centre-specific",
        })
      ).status,
      200,
    );
    assert.notEqual(
      (await (await f.request("/api/preferences?centre=seen_nanyang")).json())
        .template,
      "Centre-specific",
    );
    const csv = await f.request("/api/export/csv?centre=glow_nanyang");
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /GLOW Nanyang/);
    assert.match(csv.headers.get("content-disposition"), /glow_nanyang/);
    const html = await (
      await f.request("/api/export/report?centre=seen_nanyang")
    ).text();
    assert.match(html, /<h1>SEEN Nanyang/);
    assert.equal(html.includes("GLOW Bukit Batok"), false);
  } finally {
    await f.close();
  }
});

test("Excel centre exports preview all four destinations and blank lines do not create unresolved records", async () => {
  const f = await app();
  try {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("Attendance");
    for (const row of matrix()) sheet.addRow(row);
    const data = new FormData();
    data.append(
      "file",
      new Blob([await workbook.xlsx.writeBuffer()]),
      "attendance.xlsx",
    );
    const r = await f.request("/api/import/preview?mode=merge", data),
      p = await r.json();
    assert.equal(r.status, 200, JSON.stringify(p));
    assert.deepEqual(
      p.centreCounts,
      Object.fromEntries(CENTRES.map((c) => [c.id, 1])),
    );
    assert.equal(p.ready, 4);
    assert.equal(p.unclassified, 0);
  } finally {
    await f.close();
  }
});

test("partial multi-centre failure resumes the same preview without duplicating committed centre attendance", async () => {
  const f = await app();
  try {
    const db = await f.application.platform.workspaces.get("seen_bukit_batok");
    db.exec(
      "CREATE TRIGGER fail_attendance BEFORE INSERT ON attendance BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    const p = await preview(f);
    assert.equal(
      (await f.request("/api/import/confirm", { id: p.id, confirmed: true }))
        .status,
      500,
    );
    assert.equal(
      readData(f.stores.get("glow_bukit_batok")).attendance.length,
      1,
    );
    assert.equal(readData(db).attendance.length, 0);
    db.exec("DROP TRIGGER fail_attendance");
    const retried = await f.request("/api/import/confirm", {
      id: p.id,
      confirmed: true,
    });
    assert.equal(
      retried.status,
      200,
      JSON.stringify(await retried.clone().json()),
    );
    for (const c of CENTRES)
      assert.equal(readData(f.stores.get(c.id)).attendance.length, 1);
  } finally {
    await f.close();
  }
});

test("production opens the shared four-centre workspace without login even with an old authentication environment setting", async () => {
  const previous = process.env.DASHBOARD_AUTH;
  process.env.DASHBOARD_AUTH = "1";
  const f = await app({ production: true });
  try {
    const response = await f.request("/api/me");
    assert.equal(response.status, 200);
    const me = await response.json();
    assert.equal(me.username, "Local workspace");
    assert.equal(me.role, "admin");
    assert.equal(me.centres.length, 4);
    assert.equal(me.canCompare, true);
    assert.equal(
      (await f.request("/api/dashboard?centre=seen_nanyang")).status,
      200,
    );
    assert.equal(
      (
        await f.request("/api/me", undefined, {
          cookie: "glow_session=" + "a".repeat(64),
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
    if (previous === undefined) delete process.env.DASHBOARD_AUTH;
    else process.env.DASHBOARD_AUTH = previous;
  }
});

test("centre preview actions reconcile all source rows and paginated inspection omits member IDs and enforces current grants", async () => {
  const f = await app();
  try {
    const m = [
      [...HEADERS, "Centres"],
      ...Array.from({ length: 28 }, () => [
        ...attendance("GLOW_Underscore source"),
        "Tzu Chi SEEN @ Bukit Batok",
      ]),
    ];
    const invalid = [
      ...attendance("GLOW Missing member"),
      "Tzu Chi SEEN @ Bukit Batok",
    ];
    invalid[0] = "";
    m.push(invalid);
    const badDate = [
      ...attendance("GLOW Invalid date"),
      "Tzu Chi SEEN @ Bukit Batok",
    ];
    badDate[9] = "not a session date";
    m.push(badDate);
    const p = await preview(f, m),
      summary = p.centreSummaries.glow_bukit_batok;
    assert.equal(p.rawRows, 30);
    assert.equal(p.ready, 1);
    assert.equal(p.duplicates, 27);
    assert.equal(p.invalid, 2);
    assert.equal(p.unclassified, 0);
    assert.equal(
      summary.ready + summary.duplicates + summary.invalid + summary.skipped,
      summary.rawRows,
    );
    const url =
        "/api/centres/import/rows?" +
        new URLSearchParams({
          id: p.id,
          centreId: "glow_bukit_batok",
          page: "2",
        }),
      r = await f.request(url),
      body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.total, 30);
    assert.equal(body.rows.length, 5);
    assert.equal(body.rows[0].row, 27);
    assert.equal(body.rows.at(-1).status, "invalid");
    assert.equal(body.rows[0].location, "Tzu Chi SEEN @ Bukit Batok");
    assert.equal(JSON.stringify(body).includes(member), false);
    assert.ok(
      p.issues.some((i) => i.message.startsWith("Duplicate attendance")),
    );
    assert.equal(
      (await f.request(url.replace("page=2", "page=3"))).status,
      400,
    );
    const actor = f.db
      .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
      .get();
    f.db
      .prepare("DELETE FROM centre_access WHERE user_id=? AND centre_id=?")
      .run(actor.id, "glow_bukit_batok");
    assert.equal((await f.request(url)).status, 403);
  } finally {
    await f.close();
  }
});


test('large imports assemble bounded chunks, reject missing or changed chunks, and preserve the reviewed import flow',async()=>{
 const f=await app();try{
  const body=Buffer.from(csv([[...HEADERS,'Centres','Source note'],...Array.from({length:520},(_,i)=>{const row=attendance('GLOW Large file');row[0]='large-synthetic-'+i;return [...row,'Tzu Chi SEEN @ Bukit Batok','x'.repeat(40000)];})]));assert.ok(body.length>19*1024*1024);assert.ok(body.length<MAX_IMPORT_BYTES);
  const rejected=await f.request('/api/centres/uploads',{name:'large.csv',size:MAX_IMPORT_BYTES+1,target:'/api/import/preview?mode=merge'});assert.equal(rejected.status,413);
  assert.equal((await f.request('/api/centres/uploads',{name:'large.csv',size:body.length,target:'/api/import/confirm'})).status,400);
  const begin=await f.request('/api/centres/uploads',{name:'large.csv',size:body.length,target:'/api/import/preview?mode=merge'}),session=await begin.json();assert.equal(begin.status,200,JSON.stringify(session));
  const put=(i,data)=>fetch(f.origin+'/api/centres/uploads/'+session.id+'/chunks/'+i,{method:'PUT',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({data:data.toString('base64')})});
  assert.equal((await f.request('/api/import/preview?mode=merge',{uploadId:session.id})).status,409);
  for(let offset=0,i=0;offset<body.length;offset+=UPLOAD_CHUNK_BYTES,i++){const bytes=body.subarray(offset,offset+UPLOAD_CHUNK_BYTES),r=await put(i,bytes);assert.equal(r.status,200,await r.text());if(i===0){assert.equal((await put(i,bytes)).status,200);assert.equal((await put(i,Buffer.alloc(bytes.length,120))).status,409);}}
  assert.equal((await f.request('/api/import/preview?mode=add',{uploadId:session.id})).status,409);
  const response=await f.request('/api/import/preview?mode=merge',{uploadId:session.id}),previewed=await response.json();assert.equal(response.status,200,JSON.stringify(previewed));assert.equal(previewed.ready,520);assert.equal(previewed.unclassified,0);assert.equal(readData(f.stores.get('glow_bukit_batok')).attendance.length,0);
  const cleanup=await fetch(f.origin+'/api/centres/uploads/'+session.id,{method:'DELETE',headers:{Origin:f.origin}});assert.equal(cleanup.status,200);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM import_previews WHERE id LIKE 'upload-%'").get().n,0);
  assert.equal((await f.request('/api/import/confirm',{id:previewed.id,confirmed:true})).status,200);assert.equal(readData(f.stores.get('glow_bukit_batok')).attendance.length,520);
 }finally{await f.close();}
});


test('temporary large uploads remain owner-scoped and expired uploads cannot be completed',async()=>{
 const f=await app({auth:true,seed:db=>{for(const username of ['uploader-one','uploader-two'])db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run(username,passwordHash('fixture-password-long'),'admin');}});try{
  const login=async username=>{const r=await f.request('/api/login',{username,password:'fixture-password-long'});return {cookie:r.headers.get('set-cookie').split(';')[0]};},one=await login('uploader-one'),two=await login('uploader-two');
  const begin=await f.request('/api/centres/uploads',{name:'small.csv',size:1,target:'/api/import/preview?mode=merge'},one),p=await begin.json();assert.equal(begin.status,200);
  assert.equal((await f.request('/api/import/preview?mode=merge',{uploadId:p.id},two)).status,409);
  const put=()=>fetch(f.origin+'/api/centres/uploads/'+p.id+'/chunks/0',{method:'PUT',headers:{Origin:f.origin,'Content-Type':'application/json',...one},body:JSON.stringify({data:'eA=='})});
  f.db.prepare('UPDATE import_previews SET expires=? WHERE id=?').run(Date.now()-1,p.id);assert.equal((await put()).status,409);
 }finally{await f.close();}
});

test('combined domains remain session-specific and isolated across all four centre imports and exports',async()=>{
 const f=await app();try{const rows=matrix();rows[0].push('Activity Name/Event Type');rows.slice(1).forEach((r,i)=>{r[8]='Others';r.push(i%2?'Social & Volunterism':'Physical & Cognitive');});const p=await preview(f,rows);const confirmation=await f.request('/api/import/confirm',{id:p.id,confirmed:true});assert.equal(confirmation.status,200);
 for(const centre of CENTRES){const response=await f.request('/api/programme-domains/report?selectedDomain=Cognitive',undefined,{'X-Centre-Id':centre.id});assert.equal(response.status,200);const report=await response.json();assert.equal(report.total.sessions,1);assert.equal(report.total.attendance,1);assert.deepEqual(report.domains.map(d=>d.label),['Physical','Cognitive','Learning','Social','Volunteerism']);const social=centre.id.startsWith('seen_');assert.equal(report.domains.find(d=>d.label==='Social').sessions,social?1:0);assert.equal(report.domains.find(d=>d.label==='Cognitive').sessions,social?0:1);const exported=await f.request('/api/programme-domains/export',undefined,{'X-Centre-Id':centre.id});assert.equal(exported.status,200);assert.deepEqual((await exported.json()).domains,report.domains);}
 }finally{await f.close();}
});
