import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { openDb, passwordHash } from "../server/db.js";
import { openPostgres } from "../server/postgres.js";
import { createApp } from "../server/app.js";
import { ensureOperations } from "../server/operations-routes.js";
import { hash } from "../server/domain.js";

async function fixture(engine) {
  let db;
  if (engine === "PostgreSQL") {
    const pg = new PGlite();
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await pg.exec(
      await readFile(
        new URL("../supabase/setup-through-004.sql", import.meta.url),
        "utf8",
      ),
    );
    const query = async (sql, values) => {
      const r = values?.length
        ? await pg.query(sql, values)
        : (await pg.exec(sql)).at(-1);
      return { rows: r?.rows || [], rowCount: r?.affectedRows || 0 };
    };
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
        const c = await this.connect();
        try {
          return await c.query(sql, values);
        } finally {
          c.release();
        }
      },
      end: () => pg.close(),
    };
    db = openPostgres("test", { pool });
  } else db = openDb(":memory:");
  const app = createApp(db);
  await ensureOperations(db);
  const user = (
    await db
      .prepare("SELECT id FROM users WHERE username=?")
      .get("__local_workspace__")
  ).id;
  await db
    .prepare("INSERT INTO participants VALUES(?,?)")
    .run(
      "person-a",
      JSON.stringify({ age: 70, livingRaw: "Alone", riskRaw: "0" }),
    );
  await db
    .prepare("INSERT INTO participants VALUES(?,?)")
    .run("person-b", JSON.stringify({ age: 72 }));
  await db
    .prepare("INSERT INTO programmes VALUES(?,?,?,?)")
    .run(
      "programme",
      "Source programme",
      "Social",
      JSON.stringify({ seated: true }),
    );
  for (const [id, date] of [
    ["s1", "2026-05-01"],
    ["s2", "2026-05-02"],
    ["s3", "2026-05-03"],
  ])
    await db
      .prepare(
        "INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)",
      )
      .run(id, "programme", date, 540, 600);
  const first = (
    await db
      .prepare("INSERT INTO imports(created,user_id,summary) VALUES(?,?,?)")
      .run("2026-05-04T01:00:00Z", user, JSON.stringify({ imported: 2 }))
  ).lastInsertRowid;
  const second = (
    await db
      .prepare("INSERT INTO imports(created,user_id,summary) VALUES(?,?,?)")
      .run("2026-05-05T01:00:00Z", user, JSON.stringify({ imported: 2 }))
  ).lastInsertRowid;
  for (const [id, person, session, source] of [
    ["a1", "person-a", "s1", first],
    ["a2", "person-a", "s2", first],
    ["a3", "person-b", "s2", second],
    ["a4", "person-a", "s3", second],
  ])
    await db
      .prepare("INSERT INTO attendance VALUES(?,?,?,?,?)")
      .run(id, person, session, "original session text", source);
  const saved = JSON.stringify({
    needs: [{ category: "Transport assistance", status: "Reported" }],
  });
  await db
    .prepare("INSERT INTO participant_profiles VALUES(?,?,?,?,?)")
    .run("person-a", 1, saved, "2026-05-04", user);
  await db
    .prepare("INSERT INTO participant_feedback VALUES(?,?,?,?,?,?)")
    .run("feedback", "person-a", "2026-05-04", "{}", "2026-05-04", user);
  await db
    .prepare("INSERT INTO needs_actions VALUES(?,?,?,?,?,?,?)")
    .run("action", "outreach", 1, "{}", "2026-05-04", "2026-05-04", user);
  await db
    .prepare("INSERT INTO member_registry VALUES(?,?,?)")
    .run("person-b", "snapshot", "{}");
  const settings = JSON.parse(
    (await db.prepare("SELECT value FROM settings WHERE id=1").get()).value,
  );
  settings.registry = {
    complete: true,
    snapshot: "snapshot",
    asOf: "2026-05-04",
  };
  await db
    .prepare("UPDATE settings SET value=? WHERE id=1")
    .run(JSON.stringify(settings));
  await db
    .prepare(
      "INSERT INTO assessment_monthly(fingerprint,month,type,total,reported_as_of,complete,created,user_id) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "assessment",
      "2026-05",
      "SPPB",
      10,
      "2026-05-04",
      0,
      "2026-05-04",
      user,
    );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = async (
    path,
    body,
    method = body ? "POST" : "GET",
    cookie,
  ) => {
    const r = await fetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const count = async (name) =>
    Number((await db.prepare(`SELECT count(*) AS n FROM ${name}`).get()).n);
  return {
    db,
    request,
    origin,
    first: Number(first),
    user,
    count,
    close: async () => {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
for (const engine of ["SQLite", "PostgreSQL"]) {
  test(`${engine}: deleting one import previews exact effects, preserves profiles and shared sessions, and creates a downloadable recovery copy`, async () => {
    const f = await fixture(engine);
    try {
      const before = await f.request("/api/data-management");
      assert.equal(before.status, 200);
      assert.equal(before.body.counts.attendance, 4);
      const preview = await f.request("/api/data-management/preview", {
        scope: "import",
        importId: f.first,
      });
      assert.equal(preview.status, 200);
      assert.equal(preview.body.counts.attendance, 2);
      assert.equal(preview.body.counts.sessions, 1);
      assert.equal(preview.body.counts.participants, 0);
      assert.equal(await f.count("attendance"), 4);
      assert.equal(
        (
          await f.request("/api/data-management/confirm", {
            id: preview.body.id,
            confirmation: "wrong",
          })
        ).status,
        400,
      );
      const result = await f.request("/api/data-management/confirm", {
        id: preview.body.id,
        confirmation: "DELETE ATTENDANCE",
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(await f.count("attendance"), 2);
      assert.equal(await f.count("sessions"), 2);
      for (const [table, count] of [
        ["participants", 2],
        ["participant_profiles", 1],
        ["participant_feedback", 1],
        ["needs_actions", 1],
      ])
        assert.equal(await f.count(table), count);
      const backup = await f.request("/api/backups/" + result.body.backupId);
      assert.equal(backup.body.tables.attendance.length, 4);
      assert.equal(
        backup.body.tables.attendance[0].source_session,
        "original session text",
      );
      assert.equal(
        (
          await f.request("/api/data-management/confirm", {
            id: preview.body.id,
            confirmation: "DELETE ATTENDANCE",
          })
        ).status,
        409,
      );
      assert.equal(await f.count("attendance_backups"), 1);
      const inventory = (await f.request("/api/data-management")).body;
      assert.equal(
        inventory.imports.find((i) => i.id === f.first).remaining,
        0,
      );
      assert.equal(inventory.backups[0].restorable, true);
    } finally {
      await f.close();
    }
  });
  test(`${engine}: date-range deletion is inclusive, validates selection and rejects stale or wrong-kind previews`, async () => {
    const f = await fixture(engine);
    try {
      assert.equal(
        (
          await f.request("/api/data-management/preview", {
            scope: "date-range",
            from: "2026-02-30",
            to: "2026-05-01",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.request("/api/data-management/preview", {
            scope: "import",
            importId: 99999,
          })
        ).status,
        400,
      );
      assert.equal(
        (await f.request("/api/data-management/preview", { scope: "all" }))
          .status,
        400,
      );
      const p = (
        await f.request("/api/data-management/preview", {
          scope: "date-range",
          from: "2026-05-02",
          to: "2026-05-03",
        })
      ).body;
      assert.equal(p.counts.attendance, 3);
      await f.db
        .prepare(
          "UPDATE participant_profiles SET revision=2 WHERE participant_id=?",
        )
        .run("person-a");
      assert.equal(
        (
          await f.request("/api/data-management/confirm", {
            id: p.id,
            confirmation: "DELETE ATTENDANCE",
          })
        ).status,
        409,
      );
      assert.equal(await f.count("attendance_backups"), 0);
      const fresh = (
        await f.request("/api/data-management/preview", {
          scope: "date-range",
          from: "2026-05-02",
          to: "2026-05-03",
        })
      ).body;
      assert.equal(
        (
          await f.request("/api/data-management/confirm", {
            id: fresh.id,
            confirmation: "DELETE ATTENDANCE",
          })
        ).status,
        200,
      );
      assert.equal(await f.count("attendance"), 1);
      assert.equal(
        (
          await f.request("/api/data-management/preview", {
            scope: "date-range",
            from: "2026-05-02",
            to: "2026-05-03",
          })
        ).status,
        400,
      );
      const blank = (
        await f.request("/api/data-management/preview", {
          scope: "all-attendance",
        })
      ).body;
      assert.equal(
        (
          await f.request("/api/data-management/confirm", {
            id: blank.id,
            confirmation: "DELETE ATTENDANCE",
          })
        ).status,
        200,
      );
      assert.equal(await f.count("attendance"), 0);
      assert.equal(await f.count("participants"), 2);
    } finally {
      await f.close();
    }
  });
  test(`${engine}: reset and restore preserve exact source records, registry and configuration; backup deletion is separately confirmed`, async () => {
    const f = await fixture(engine);
    try {
      const p = (
        await f.request("/api/data-management/preview", { scope: "reset" })
      ).body;
      assert.equal(p.counts.participants, 2);
      assert.equal(p.counts.assessments, 1);
      const result = await f.request("/api/data-management/confirm", {
        id: p.id,
        confirmation: "RESET DATA",
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      for (const table of [
        "attendance",
        "sessions",
        "participants",
        "programmes",
        "participant_profiles",
        "participant_feedback",
        "needs_actions",
        "member_registry",
        "assessment_monthly",
        "imports",
      ])
        assert.equal(await f.count(table), 0, table);
      assert.equal(
        JSON.parse(
          (await f.db.prepare("SELECT value FROM settings WHERE id=1").get())
            .value,
        ).registry.complete,
        false,
      );
      assert.ok(await f.count("users"));
      const r = await f.request("/api/data-management/preview", {
        operation: "restore",
        backupId: result.body.backupId,
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.counts.attendance, 4);
      const restored = await f.request("/api/data-management/confirm", {
        id: r.body.id,
        confirmation: "RESTORE DATA",
      });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.equal(await f.count("attendance"), 4);
      assert.equal(await f.count("assessment_monthly"), 1);
      assert.equal(await f.count("participant_feedback"), 1);
      assert.equal(
        JSON.parse(
          (await f.db.prepare("SELECT details FROM participant_profiles").get())
            .details,
        ).needs[0].status,
        "Reported",
      );
      assert.equal(
        JSON.parse(
          (await f.db.prepare("SELECT value FROM settings WHERE id=1").get())
            .value,
        ).registry.complete,
        true,
      );
      assert.equal(await f.count("attendance_backups"), 2);
      const path = "/api/data-management/backups/" + result.body.backupId;
      assert.equal((await f.request(path, {}, "DELETE")).status, 400);
      assert.equal(
        (await f.request(path, { confirmation: "DELETE BACKUP" }, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await f.request("/api/backups/" + result.body.backupId)).status,
        404,
      );
      assert.equal(await f.count("attendance"), 4);
    } finally {
      await f.close();
    }
  });
  test(`${engine}: a failed restore rolls back removals and its safety backup`, async () => {
    const f = await fixture(engine);
    try {
      const p = (
        await f.request("/api/data-management/preview", {
          scope: "all-attendance",
        })
      ).body;
      const deleted = (
        await f.request("/api/data-management/confirm", {
          id: p.id,
          confirmation: "DELETE ATTENDANCE",
        })
      ).body;
      const row = await f.db
        .prepare("SELECT payload FROM attendance_backups WHERE id=?")
        .get(deleted.backupId);
      const payload = JSON.parse(row.payload);
      payload.tables.participant_profiles[0].user_id = 999999;
      await f.db
        .prepare("UPDATE attendance_backups SET payload=? WHERE id=?")
        .run(JSON.stringify(payload), deleted.backupId);
      const r = (
        await f.request("/api/data-management/preview", {
          operation: "restore",
          backupId: deleted.backupId,
        })
      ).body;
      const result = await f.request("/api/data-management/confirm", {
        id: r.id,
        confirmation: "RESTORE DATA",
      });
      assert.ok(result.status >= 400);
      assert.equal(await f.count("attendance"), 0);
      assert.equal(await f.count("participants"), 2);
      assert.equal(await f.count("participant_profiles"), 1);
      assert.equal(await f.count("attendance_backups"), 1);
      assert.equal(await f.count("needs_actions"), 1);
    } finally {
      await f.close();
    }
  });
}
test("data management enforces administrator permissions, origin checks, preview type and expiry", async () => {
  const f = await fixture("SQLite");
  try {
    for (const role of ["viewer", "planner"]) {
      await f.db
        .prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
        .run(role, passwordHash("fixture-password-long"), role);
      const id = f.db
        .prepare("SELECT id FROM users WHERE username=?")
        .get(role).id;
      const token = role === "viewer" ? "a".repeat(64) : "b".repeat(64);
      f.db
        .prepare("INSERT INTO logins VALUES(?,?,?)")
        .run(hash(token), id, Date.now() + 60000);
      for (const path of [
        "/api/data-management",
        "/api/data-management/preview",
        "/api/data-management/confirm",
        "/api/data-management/backups/missing",
      ])
        assert.equal(
          (
            await f.request(
              path,
              path.endsWith("management") ? undefined : { scope: "reset" },
              path.includes("backups/")
                ? "DELETE"
                : path.endsWith("management")
                  ? "GET"
                  : "POST",
              "glow_session=" + token,
            )
          ).status,
          403,
        );
    }
    const crossOrigin = await fetch(f.origin + "/api/data-management/preview", {
      method: "POST",
      headers: {
        Origin: "https://other.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scope: "reset" }),
    });
    assert.equal(crossOrigin.status, 403);
    const p = (
      await f.request("/api/data-management/preview", { scope: "reset" })
    ).body;
    f.db.prepare("UPDATE import_previews SET expires=0 WHERE id=?").run(p.id);
    assert.equal(
      (
        await f.request("/api/data-management/confirm", {
          id: p.id,
          confirmation: "RESET DATA",
        })
      ).status,
      409,
    );
    assert.equal(await f.count("attendance"), 4);
    const fresh = (
      await f.request("/api/data-management/preview", { scope: "reset" })
    ).body;
    f.db
      .prepare("UPDATE import_previews SET payload=? WHERE id=?")
      .run(JSON.stringify({ kind: "registry" }), fresh.id);
    assert.equal(
      (
        await f.request("/api/data-management/confirm", {
          id: fresh.id,
          confirmation: "RESET DATA",
        })
      ).status,
      400,
    );
    assert.equal(await f.count("attendance_backups"), 0);
  } finally {
    await f.close();
  }
});
