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
