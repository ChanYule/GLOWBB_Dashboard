import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { openPostgres } from "../server/postgres.js";
import { createApp } from "../server/app.js";
import { createHostedHandler } from "../api/index.js";
import { HEADERS, defaults } from "../server/domain.js";

async function database() {
  const engine = new PGlite();
  await engine.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  const migration = await readFile(
    new URL("../supabase/migrations/001_dashboard.sql", import.meta.url),
    "utf8",
  );
  await engine.exec(migration);
  await engine.exec(migration); // Reapplying must preserve existing data.
  const analysisMigration = await readFile(
    new URL(
      "../supabase/migrations/003_personal_analysis.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await engine.exec(analysisMigration);
  await engine.exec(analysisMigration);
  const needsMigration = await readFile(
    new URL("../supabase/migrations/004_needs_based.sql", import.meta.url),
    "utf8",
  );
  await engine.exec(needsMigration);
  await engine.exec(needsMigration);
  const query = async (sql, values) => {
    if (!values && sql.trim().startsWith("BEGIN;")) {
      const results = await engine.exec(sql);
      return {
        rows: results.at(-1)?.rows || [],
        rowCount: results.at(-1)?.affectedRows,
      };
    }
    const r = await engine.query(sql, values);
    return { rows: r.rows, rowCount: r.affectedRows };
  };
  // Model pg's one-connection pool, including checkout exclusivity.
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      let release;
      const next = new Promise((r) => {
        release = r;
      });
      const previous = tail;
      tail = next;
      await previous;
      return { query, release };
    },
    async query(sql, values) {
      const client = await this.connect();
      try {
        return await client.query(sql, values);
      } finally {
        client.release();
      }
    },
    end: () => engine.close(),
  };
  return openPostgres(undefined, { pool });
}

test('PostgreSQL session Event Types survive reviewed duplicate-only merges, backups and reporting mappings',async()=>{
  const db=await database(),app=await serve(createApp(db));
  try{
    const first=await json(await app.request('/api/import/preview?mode=merge','POST',upload()));await json(await app.request('/api/import/confirm','POST',{id:first.id}));
    const form=new FormData();form.append('file',new Blob([[...HEADERS,'Activity Name/Event Type'].map(v=>JSON.stringify(v)).join(',')+'\r\n'+['test-member','MALE','65','MALAY','','YES','YES','Movement','Physical','2026-05-04, 09:00 AM - 09:45 AM','Social & Cognitive, Learning'].map(v=>JSON.stringify(v)).join(',')]),'new.csv');
    const preview=await json(await app.request('/api/import/preview?mode=merge','POST',form));assert.equal(preview.ready,0);assert.equal(preview.updatedSessions,1);const saved=await json(await app.request('/api/import/confirm','POST',{id:preview.id}));assert.equal(saved.updatedSessions,1);assert.equal((await db.prepare('SELECT count(*)::integer n FROM attendance').get()).n,1);
    const session=await db.prepare('SELECT optional FROM sessions').get();assert.deepEqual(JSON.parse(session.optional).eventTypes,['Social & Cognitive','Learning']);
    const report=await json(await app.request('/api/event-types/report'));assert.equal(report.types.find(t=>t.label==='Learning').sessions,1);assert.equal(report.types.find(t=>t.label==='Learning').unique,null);
    const mapping=await json(await app.request('/api/event-types/mappings/preview','POST',{rows:[{raw:'Learning',label:'Reviewed Learning',parent:'Education',secondary:''}]}));await json(await app.request('/api/event-types/mappings/confirm','POST',{id:mapping.id,reviewed:true}));assert.equal(JSON.parse((await db.prepare('SELECT optional FROM sessions').get()).optional).eventTypeRaw,'Social & Cognitive, Learning');
    const current=await json(await app.request('/api/event-types/report'));assert.equal(current.types.some(t=>t.label==='Reviewed Learning'),true);
    const management=await json(await app.request('/api/data-management'));assert.equal(management.counts.attendance,1);
  }finally{await app.close();await db.close();}
});

test("PostgreSQL participation patterns reuse protected snapshots, dated profiles and existing staff preferences", async () => {
  const db = await database();
  const app = await serve(createApp(db, { authRequired: false }));
  try {
    for (const path of [
      "/api/participation-patterns",
      "/api/participation-patterns?basis=dated",
      "/api/participation-patterns/export",
      "/api/participation-patterns?dimension=distance",
    ]) {
      const response = await app.request(path);
      assert.equal(response.status, 200);
      const report = await response.json();
      assert.ok(Array.isArray(report.groups));
      assert.equal(report.ratesAvailable, false);
    }
    const saved = await app.request(
      "/api/participation-patterns/preferences",
      "PUT",
      { dimension: "living", scope: "clients" },
    );
    assert.equal(saved.status, 200);
    const preferences = await (await app.request("/api/preferences")).json();
    assert.equal(preferences.patterns.dimension, "living");
    const locationSettings = await (await app.request("/api/locations")).json();
    assert.equal(locationSettings.centre.lat, null);
    assert.equal(
      (
        await db
          .prepare("SELECT version FROM schema_version WHERE version=5")
          .get()
      ).version,
      5,
    );
    assert.equal(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname='location_store'",
        )
      ).rows[0].relrowsecurity,
      true,
    );
    assert.ok(
      (
        await db
          .prepare(
            "SELECT count(*)::integer n FROM audit WHERE action='patterns.summary.exported'",
          )
          .get()
      ).n > 0,
    );
  } finally {
    await app.close();
    await db.close();
  }
});

async function serve(handler) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    request: (path, method = "GET", body, withOrigin = true) =>
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
      }),
    close: () => new Promise((r) => server.close(r)),
  };
}
function upload() {
  const form = new FormData();
  const csv = [
    HEADERS,
    [
      "test-member",
      "MALE",
      "65",
      "MALAY",
      "",
      "YES",
      "YES",
      "Movement",
      "Physical",
      "2026-05-04, 09:00 AM - 09:45 AM",
    ],
  ]
    .map((row) => row.map((v) => JSON.stringify(v)).join(","))
    .join("\r\n");
  form.append("file", new Blob([csv]), "attendance.csv");
  return form;
}
async function json(response, expected = 200) {
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

test("Supabase SQL and API: previews survive instances; imports, planning and exports persist", async () => {
  const db = await database();
  const first = await serve(
    createHostedHandler({
      databaseUrl: "test",
      loadApp: async () => createApp(db),
    }),
  );
  const second = await serve(
    createHostedHandler({
      databaseUrl: "test",
      loadApp: async () => createApp(db),
    }),
  );
  try {
    assert.equal((await json(await first.request("/api/ready"))).ready, true);
    await json(
      await first.request("/api/settings", "PUT", defaults, false),
      403,
    );
    const preview = await json(
      await first.request("/api/import/preview", "POST", upload()),
    );
    assert.equal(preview.ready, 1);
    const result = await json(
      await second.request("/api/import/confirm", "POST", { id: preview.id }),
    );
    assert.equal(result.imported, 1);
    await json(
      await first.request("/api/import/confirm", "POST", { id: preview.id }),
      400,
    );
    const duplicate = await json(
      await first.request("/api/import/preview", "POST", upload()),
    );
    assert.equal(
      (
        await json(
          await second.request("/api/import/confirm", "POST", {
            id: duplicate.id,
          }),
        )
      ).imported,
      0,
    );
    const report = await json(await second.request("/api/dashboard"));
    assert.equal(report.summary.unique, 1);
    const target = await json(
      await first.request("/api/targets", "POST", {
        metric: "male",
        value: 10,
        start: "2026-05-01",
        end: "2026-12-31",
      }),
    );
    await json(
      await first.request(`/api/decisions/target-${target.id}`, "PUT", {
        status: "In progress",
        notes: "Test resources",
      }),
    );
    const programmeId = report.options.programmes[0].id;
    await json(
      await first.request(`/api/decisions/${programmeId}`, "PUT", {
        status: "For review",
        notes: "Review timing",
      }),
    );
    await json(
      await first.request(`/api/decisions/${programmeId}`, "PUT", {
        status: "Completed",
        notes: "Reviewed",
      }),
    );
    const updated = await json(await second.request("/api/dashboard"));
    assert.equal(updated.targets[0].current, 1);
    assert.equal(updated.decisions.length, 2);
    assert.equal(
      (await json(await second.request("/api/quality"))).imports.length,
      2,
    );
    assert.match(
      await (await second.request("/api/export/csv")).text(),
      /Movement/,
    );
    assert.match(
      await (await second.request("/api/export/report")).text(),
      /Programme impact/,
    );
    await json(await second.request("/api/export/csv?gender=MALE"), 400);
    await json(
      await first.request("/api/settings", "PUT", {
        ...defaults,
        seniorAge: 70,
        ageBands: [80, 90],
      }),
    );
    assert.equal(
      (await json(await second.request("/api/dashboard"))).summary.unique,
      0,
    );
    await json(await second.request(`/api/targets/${target.id}`, "DELETE"));
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer AS n FROM opportunity_decisions")
          .get()
      ).n,
      0,
    );
    // No browser roles can access the private data schema, even if exposed accidentally.
    const permissions = await db.query(
      "SELECT has_schema_privilege('anon','glowbb','USAGE') AS access",
    );
    assert.equal(permissions.rows[0].access, false);
  } finally {
    await first.close();
    await second.close();
    await db.close();
  }
});

test("Supabase confirmation rolls back partial imports and retains the preview for retry", async () => {
  const db = await database();
  const app = await serve(createApp(db));
  try {
    const preview = await json(
      await app.request("/api/import/preview", "POST", upload()),
    );
    await db.query(
      "ALTER TABLE glowbb.attendance ADD CONSTRAINT fail_import CHECK (false)",
    );
    await json(
      await app.request("/api/import/confirm", "POST", { id: preview.id }),
      503,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer AS n FROM participants")
          .get()
      ).n,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT count(*)::integer AS n FROM imports").get()).n,
      0,
    );
    await db.query("ALTER TABLE glowbb.attendance DROP CONSTRAINT fail_import");
    assert.equal(
      (
        await json(
          await app.request("/api/import/confirm", "POST", { id: preview.id }),
        )
      ).imported,
      1,
    );
    const expired = await json(
      await app.request("/api/import/preview", "POST", upload()),
    );
    await db
      .prepare("UPDATE import_previews SET expires=0 WHERE id=?")
      .run(expired.id);
    await json(
      await app.request("/api/import/confirm", "POST", { id: expired.id }),
      400,
    );
  } finally {
    await app.close();
    await db.close();
  }
});

test("hosted handler fails clearly without DATABASE_URL and caches app initialization", async () => {
  const missing = await serve(createHostedHandler());
  try {
    assert.match(
      (await json(await missing.request("/api/ready"), 503)).error,
      /DATABASE_URL/,
    );
  } finally {
    await missing.close();
  }
  let loads = 0;
  const ready = await serve(
    createHostedHandler({
      databaseUrl: "configured",
      loadApp: async () => {
        loads++;
        return (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end('{"ready":true}');
        };
      },
    }),
  );
  try {
    await json(await ready.request("/api/ready"));
    await json(await ready.request("/api/ready"));
    assert.equal(loads, 1);
  } finally {
    await ready.close();
  }
});

test("Supabase operational migration, aggregate revisions, targets and preview confirmations remain atomic", async () => {
  const db = await database(),
    app = await serve(createApp(db));
  try {
    await json(
      await app.request("/api/operations?from=2026-05-01&to=2026-06-30"),
    );
    const entry = {
      month: "2026-05",
      sppb: "20",
      tanita: "10",
      reportedAsOf: "2026-06-01",
      final: true,
    };
    assert.equal(
      (
        await json(
          await app.request("/api/operations/assessments", "POST", entry),
        )
      ).saved,
      2,
    );
    assert.equal(
      (
        await json(
          await app.request("/api/operations/assessments", "POST", entry),
        )
      ).duplicates,
      2,
    );
    await json(
      await app.request("/api/operations/assessments", "POST", {
        ...entry,
        sppb: "21",
      }),
      400,
    );
    await json(
      await app.request("/api/operations/assessments", "POST", {
        ...entry,
        sppb: "21",
        revise: true,
      }),
    );
    const form = new FormData();
    form.append(
      "file",
      new Blob([
        "Month,SPPB,Tanita,Reported As Of,Final\r\n2026-06,30,20,2026-07-01,YES",
      ]),
      "monthly.csv",
    );
    const preview = await json(
      await app.request("/api/operations/assessments/preview", "POST", form),
    );
    await json(
      await app.request("/api/import/confirm", "POST", { id: preview.id }),
      400,
    );
    await db.query(
      "ALTER TABLE glowbb.assessment_monthly ADD CONSTRAINT test_rollback CHECK (total < 25)",
    );
    await json(
      await app.request("/api/operations/assessments/confirm", "POST", {
        id: preview.id,
      }),
      503,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer AS n FROM assessment_monthly")
          .get()
      ).n,
      3,
    );
    await db.query(
      "ALTER TABLE glowbb.assessment_monthly DROP CONSTRAINT test_rollback",
    );
    await json(
      await app.request("/api/operations/assessments/confirm", "POST", {
        id: preview.id,
      }),
    );
    await json(
      await app.request("/api/operations/targets", "POST", {
        month: "2026-06",
        metric: "sppb",
        value: 40,
      }),
    );
    await json(
      await app.request("/api/operations/settings", "PUT", {
        inactivityDays: 60,
      }),
    );
    const report = await json(
      await app.request("/api/operations?from=2026-05-01&to=2026-06-30"),
    );
    assert.equal(report.summary.sppb, 51);
    assert.equal(report.targets[0].actual, 30);
    assert.equal(report.settings.inactivityDays, 60);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer AS n FROM participants")
          .get()
      ).n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_schema_privilege('anon','glowbb','USAGE') AS access",
        )
      ).rows[0].access,
      false,
    );
  } finally {
    await app.close();
    await db.close();
  }
});

test("failed operational setup rolls back and can retry without poisoning the database connection", async () => {
  const db = await database(),
    app = await serve(createApp(db));
  try {
    await db.query(
      "CREATE TABLE glowbb.assessment_monthly(id integer PRIMARY KEY)",
    );
    await json(await app.request("/api/operations"), 503);
    assert.equal(
      (
        await db
          .prepare("SELECT MAX(version) AS version FROM schema_version")
          .get()
      ).version,
      4,
    );
    // This is a deliberately incompatible table in the isolated test engine.
    await db.query("DROP TABLE glowbb.assessment_monthly");
    const result = await json(await app.request("/api/operations"));
    assert.equal(result.summary.unique, 0);
    assert.equal(
      (
        await db
          .prepare("SELECT MAX(version) AS version FROM schema_version")
          .get()
      ).version,
      4,
    );
  } finally {
    await app.close();
    await db.close();
  }
});

test("PostgreSQL migration preserves attendance while merging profiles, isolating preferences and backing up replacement", async () => {
  const { parseRows, inspectImport, hash } =
    await import("../server/domain.js");
  const db = await database();
  try {
    const actor = (
      await db
        .prepare("SELECT id FROM users WHERE username=?")
        .get("__local_workspace__")
    ).id;
    const headers = [...HEADERS, "Name/Social Risk Factor(s)"];
    const source = (risk, member = "same", date = "04") =>
      parseRows([
        headers,
        [
          member,
          "MALE",
          "65",
          "MALAY",
          "CFS1",
          "YES",
          "YES",
          "Movement",
          "Physical",
          `2026-05-${date}, 09:00 AM - 10:00 AM`,
          risk,
        ],
      ]);
    const first = source("");
    first.mode = "merge";
    await db.previews.put("first", first, actor);
    await db.previews.confirm("first", actor);
    const update = source("0");
    update.mode = "merge";
    await db.previews.put("update", update, actor);
    const result = await db.previews.confirm("update", actor);
    assert.equal(result.imported, 0);
    assert.equal(result.updatedProfiles, 1);
    const data = await db.storage.readData(db);
    assert.equal(data.attendance.length, 1);
    assert.equal(data.participants[0].riskRaw, "0");
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer n FROM risk_observations")
          .get()
      ).n,
      2,
    );
    const duplicate = source("0");
    duplicate.mode = "merge";
    assert.equal(inspectImport(duplicate, data).fresh.length, 0);
    await db
      .prepare("INSERT INTO staff_preferences VALUES(?,?)")
      .run(actor, JSON.stringify({ views: [{ name: "Outreach" }] }));
    assert.match(
      (
        await db
          .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
          .get(actor)
      ).value,
      /Outreach/,
    );
    const replacement = source("A;B", "new", "05");
    replacement.mode = "replace";
    replacement.fingerprint = hash(data);
    await db.previews.put("replacement", replacement, actor);
    await assert.rejects(
      () => db.previews.confirm("replacement", actor),
      /confirmation/,
    );
    await db.previews.confirm("replacement", actor, {
      confirmation: "REPLACE ATTENDANCE",
    });
    const backup = JSON.parse(
      (await db.prepare("SELECT payload FROM attendance_backups").get())
        .payload,
    );
    assert.equal(backup.attendance.length, 1);
    assert.equal(
      backup.attendanceRows[0].source_session,
      "2026-05-04, 09:00 AM - 10:00 AM",
    );
    const after = await db.storage.readData(db);
    assert.equal(after.attendance.length, 1);
    assert.equal(after.participants.length, 2);
  } finally {
    await db.close();
  }
});

test("PostgreSQL needs profiles, voluntary feedback, accessibility reviews and action revisions survive API requests", async () => {
  const db = await database(),
    app = await serve(createApp(db));
  try {
    const preview = await json(
      await app.request("/api/import/preview", "POST", upload()),
    );
    await json(
      await app.request("/api/import/confirm", "POST", { id: preview.id }),
    );
    const participant = (await db.storage.readData(db)).participants[0];
    const p = await json(
      await app.request("/api/participants/" + participant.id),
    );
    assert.equal(p.revision, 0);
    const details = {
      basic: { preferredLanguage: "Malay" },
      preferences: { responded: true, interests: ["Games"] },
      needs: [
        {
          category: "Transport assistance",
          status: "Not assessed",
          source: "Unconfirmed",
          date: "",
        },
      ],
    };
    await json(
      await app.request(
        "/api/participants/" + participant.id + "/profile",
        "PUT",
        {
          revision: 0,
          details,
          source: "Participant-reported",
          effectiveDate: "2026-10-20",
        },
      ),
    );
    await json(
      await app.request(
        "/api/participants/" + participant.id + "/profile",
        "PUT",
        { revision: 0, details, source: "Participant-reported" },
      ),
      409,
    );
    const persisted = await json(
      await app.request("/api/participants/" + participant.id),
    );
    assert.equal(persisted.details.basic.preferredLanguage, "Malay");
    assert.equal(persisted.details.needs[0].status, "Not assessed");
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer n FROM profile_history")
          .get()
      ).n,
      1,
    );
    await json(
      await app.request(
        "/api/participants/" + participant.id + "/feedback",
        "POST",
        {
          id: "pg-feedback",
          consent: true,
          date: "2026-10-20",
          source: "Participant-reported",
          method: "survey",
          preferences: { interests: ["Games"], responded: true },
          barriers: [],
          comments: "",
        },
      ),
    );
    const programmes = await json(await app.request("/api/needs/programmes"));
    await json(
      await app.request(
        "/api/programmes/" + programmes[0].id + "/profile",
        "PUT",
        {
          revision: programmes[0].revision,
          outcomes: "Staff-reviewed social participation objective",
          offeringStatus: "Current offering",
          interestCategories: ["Games"],
          intendedNeeds: [],
          accessibility: { seatedOption: "Available by arrangement" },
        },
      ),
    );
    const action = {
      kind: "action",
      revision: 0,
      title: "Review stated demand",
      priority: "Medium",
      status: "Proposed",
      owner: "Planner",
      due: "2026-12-01",
    };
    await json(
      await app.request("/api/needs/actions/pg-action", "PUT", action),
    );
    const actions = await json(await app.request("/api/needs/actions"));
    assert.equal(actions[0].title, "Review stated demand");
    await json(
      await app.request("/api/needs/actions/pg-action", "PUT", {
        ...actions[0],
        id: undefined,
        status: "Under Review",
      }),
    );
    const report = await json(await app.request("/api/needs/overview"));
    assert.equal(report.registry.available, false);
    assert.equal(report.responses.interests.suppressed, true);
    assert.equal(report.summary.unique, 1);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*)::integer n FROM participant_feedback")
          .get()
      ).n,
      1,
    );
  } finally {
    await app.close();
    await db.close();
  }
});
