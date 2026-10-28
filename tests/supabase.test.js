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
      1,
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
      2,
    );
  } finally {
    await app.close();
    await db.close();
  }
});
