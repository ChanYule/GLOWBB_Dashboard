import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { openDb, readData, saveImport } from "../server/db.js";
import { openPostgres } from "../server/postgres.js";
import { createApp } from "../server/app.js";
import {
  HEADERS,
  defaults,
  hash,
  inspectImport,
  readMatrix,
  readFile as parseFile,
} from "../server/domain.js";
import {
  CLIENT_SNAPSHOT,
  parseClientRegistry,
  registryHeaders,
  clientContext,
  clientReport,
  protectClientRows,
} from "../server/client-domain.js";
import { reconcileClients } from "../scripts/reconcile-clients.mjs";
import { needsAnalysis } from "../server/needs-domain.js";
const headers = Object.values(registryHeaders);
const registryRow = (id, patch = {}) =>
  headers.map(
    (h) =>
      ({
        "Member ID": id,
        Gender: "MALE",
        "Current Living Arrangement": "Alone",
        Age: "75",
        Race: "MALAY",
        CFS: "1-3",
        "Social Risk Factor(s)": "0",
        "Is Client": "Yes",
        "Within Boundary": "Yes",
        "Block / Building No.": "101",
        ...patch,
      })[h],
  );
const registry = (...rows) => [headers, ...rows];
const revisedRegistry = (...rows) => {
  const kept = headers.filter(
    (h) => !["Is Client", "Within Boundary"].includes(h),
  );
  return [
    [...kept, "Date of Admission (A)", "Preferred Language"],
    ...rows.map((row) => [
      ...kept.map((h) => row[headers.indexOf(h)]),
      "2026-01-15",
      "Mandarin",
    ]),
  ];
};
const attendance = (id, date = "2026-10-20") => [
  id,
  "MALE",
  "75",
  "MALAY",
  "1-3",
  "YES",
  "YES",
  "Social games",
  "Social",
  `${date}, 09:00 AM - 10:00 AM`,
];
const upload = (matrix) => {
  const f = new FormData();
  f.append(
    "file",
    new Blob([
      matrix
        .map((row) =>
          row
            .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\r\n"),
    ]),
    "clients.csv",
  );
  return f;
};
async function fixture(engine = "SQLite") {
  const stats = { queries: 0, failObservations: false };
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
      stats.queries++;
      if (
        stats.failObservations &&
        sql.startsWith("INSERT INTO glowbb.profile_observations")
      ) {
        stats.failObservations = false;
        throw Object.assign(Error("Injected bulk failure"), {
          code: "TEST_FAILURE",
        });
      }
      const r = values?.length
        ? await pg.query(sql, values)
        : (await pg.exec(sql)).at(-1);
      return { rows: r?.rows || [], rowCount: r?.affectedRows || 0 };
    };
    let tail = Promise.resolve();
    const pool = {
      async connect() {
        let release;
        const next = new Promise((r) => (release = r)),
          previous = tail;
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
  const app = createApp(db),
    server = app.listen(0, "127.0.0.1");
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
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    const type = r.headers.get("content-type") || "";
    return {
      status: r.status,
      body: type.includes("application/json") ? await r.json() : await r.text(),
    };
  };
  const actor = (
    await db
      .prepare("SELECT id FROM users WHERE username=?")
      .get("__local_workspace__")
  ).id;
  const save = async (matrix, extra = {}) => {
    const p = await request("/api/client-registry/preview", upload(matrix));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const result = await request("/api/client-registry/confirm", {
      id: p.body.id,
      complete: true,
      asOf: "2026-11-03",
      ...extra,
    });
    return { preview: p.body, ...result };
  };
  const count = async (table) =>
    Number((await db.prepare(`SELECT count(*) n FROM ${table}`).get()).n);
  const importAttendance = async (matrix) => {
    const file = new FormData();
    file.append(
      "file",
      new Blob([
        matrix
          .map((row) => row.map((v) => JSON.stringify(v)).join(","))
          .join("\r\n"),
      ]),
      "attendance.csv",
    );
    const p = await request("/api/import/preview", file);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const result = await request("/api/import/confirm", { id: p.body.id });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  return {
    db,
    stats,
    request,
    actor,
    save,
    count,
    importAttendance,
    close: async () => {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
const registryPath =
  process.env.CLIENT_REFERENCE_WORKBOOK ||
  "C:/Users/CHANYULE/Downloads/Members (cth.user) (16).xlsx";
const attendancePath =
  process.env.NEEDS_REFERENCE_WORKBOOK ||
  "C:/Users/CHANYULE/Downloads/member_attendances_20261103110958.xlsx";

test("PostgreSQL: large attendance merges, reviewed deletion and recovery stay bounded and preserve exact records", async (t) => {
  const f = await fixture("PostgreSQL");
  try {
    await f.importAttendance([
      HEADERS,
      ...Array.from({ length: 620 }, (_, i) => attendance("performance-" + i)),
    ]);
    const rows = Array.from({ length: 620 }, (_, i) => {
      const row = attendance("performance-" + i);
      row[2] = "76";
      return row;
    });
    const preview = await f.request(
      "/api/import/preview?mode=merge",
      upload([HEADERS, ...rows]),
    );
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    f.stats.queries = 0;
    const merged = await f.request("/api/import/confirm", {
      id: preview.body.id,
    });
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    const mergeCalls = f.stats.queries;
    assert.ok(mergeCalls < 50, `${mergeCalls} calls for merge`);
    const data = await f.db.storage.readData(f.db);
    assert.equal(data.attendance.length, 620);
    assert.ok(data.participants.every((p) => p.age === 76));
    const normalize = (data) =>
      Object.fromEntries(
        Object.entries(data).map(([key, rows]) => [
          key,
          [...rows].sort((a, b) => a.id.localeCompare(b.id)),
        ]),
      );
    const before = normalize(data);
    const deletion = await f.request("/api/data-management/preview", {
      scope: "all-attendance",
    });
    assert.equal(deletion.status, 200, JSON.stringify(deletion.body));
    f.stats.queries = 0;
    const deleted = await f.request("/api/data-management/confirm", {
      id: deletion.body.id,
      confirmation: "DELETE ATTENDANCE",
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    const deleteCalls = f.stats.queries;
    assert.ok(deleteCalls < 100, `${deleteCalls} calls for deletion`);
    assert.equal(await f.count("attendance"), 0);
    assert.equal(await f.count("participants"), 620);
    const recovery = await f.request("/api/data-management/preview", {
      operation: "restore",
      backupId: deleted.body.backupId,
    });
    assert.equal(recovery.status, 200, JSON.stringify(recovery.body));
    f.stats.queries = 0;
    const restored = await f.request("/api/data-management/confirm", {
      id: recovery.body.id,
      confirmation: "RESTORE DATA",
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    const restoreCalls = f.stats.queries;
    assert.ok(restoreCalls < 150, `${restoreCalls} calls for recovery`);
    assert.deepEqual(normalize(await f.db.storage.readData(f.db)), before);
    t.diagnostic(
      `620-record merge: ${mergeCalls} calls; reviewed deletion: ${deleteCalls}; full recovery: ${restoreCalls}. No saved workspace data used.`,
    );
  } finally {
    await f.close();
  }
});

test("PostgreSQL: full-sized registry confirmation uses bounded bulk writes and a failed batch remains retryable", async (t) => {
  const f = await fixture("PostgreSQL");
  try {
    const matrix = existsSync(registryPath)
      ? await readMatrix(readFileSync(registryPath), registryPath, [
          ["Member ID", "Name/Member ID"],
        ])
      : registry(
          ...Array.from({ length: 1473 }, (_, i) => registryRow("bulk-" + i)),
        );
    const p = await f.request("/api/client-registry/preview", upload(matrix));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    f.stats.queries = 0;
    f.stats.failObservations = true;
    const body = { id: p.body.id, complete: true, asOf: "2026-11-04" };
    const failed = await f.request("/api/client-registry/confirm", body);
    assert.equal(failed.status, 503);
    assert.equal(await f.count("participants"), 0);
    assert.equal(await f.count("member_registry"), 0);
    assert.equal(await f.count("profile_observations"), 0);
    assert.equal(await f.count("import_previews"), 1);
    f.stats.queries = 0;
    const start = performance.now();
    const saved = await f.request("/api/client-registry/confirm", body);
    const queries = f.stats.queries;
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.created, p.body.rows);
    assert.ok(
      queries < 100,
      `Expected fewer than 100 database round trips, received ${queries}`,
    );
    assert.equal(await f.count("participants"), p.body.rows);
    assert.equal(await f.count("member_registry"), p.body.rows * 2);
    assert.equal(await f.count("attendance"), 0);
    assert.equal(await f.count("import_previews"), 0);
    t.diagnostic(
      `${p.body.rows} clients saved with ${queries} database calls; local in-process PostgreSQL elapsed ${Math.round(performance.now() - start)} ms. Source workbook and saved workspace database unchanged.`,
    );
    f.stats.queries = 0;
    const state = await f.db.storage.readPlanningState(f.db);
    assert.equal(
      f.stats.queries,
      3,
      "Planning state should require BEGIN, one snapshot statement and COMMIT",
    );
    assert.equal(state.data.participants.length, p.body.rows);
    assert.equal(state.registry.length, p.body.rows * 2);
    assert.deepEqual(state.data, await f.db.storage.readData(f.db));
  } finally {
    await f.close();
  }
});
test(
  "the supplied registry and attendance reconcile independently, including client denominators and literal SRF codes",
  { skip: !existsSync(registryPath) || !existsSync(attendancePath) },
  async () => {
    const r = await reconcileClients(registryPath, attendancePath);
    assert.equal(r.source.registryRows, 1473);
    assert.equal(r.source.uniqueClients, 1473);
    assert.equal(r.source.attending, 164);
    assert.equal(r.source.noAttendance, 1309);
    assert.equal(r.source.otherAttenders, 241);
    assert.equal(r.source.living.Alone, 207);
    assert.equal(r.source.livingAloneAttending, 30);
    assert.equal(r.source.gender.MALE, 590);
    assert.equal(r.source.maleAttending, 38);
    assert.equal(r.source.living.Missing, 450);
    assert.equal(r.source.blocks, 35);
    assert.equal(r.source.allClientsYes, true);
    assert.equal(r.source.allWithinBoundary, true);
    assert.equal(r.source.attendanceRaw, 3344);
    assert.equal(r.source.deduplicated, 3343);
    assert.equal(r.source.sessions, 351);
    assert.equal(r.source.programmes, 116);
    assert.equal(r.issues.length, 0);
    assert.equal(r.application.summary.registered, 1473);
    assert.equal(r.application.summary.attending, 164);
    assert.equal(r.application.summary.noAttendance, 1309);
    assert.equal(r.application.summary.otherAttenders, 241);
    assert.equal(r.application.summary.livingAloneNoAttendance, 177);
    assert.equal(r.application.summary.rate, (164 / 1473) * 100);
    assert.equal(
      r.application.living.find((r) => r.label === "Alone").attending,
      30,
    );
    assert.equal(
      r.application.gender.find((r) => r.label === "MALE").registered,
      590,
    );
    assert.deepEqual(r.application.coverage, {
      from: "2026-05-04",
      to: "2026-11-03",
    });
  },
);
test("client registry parser preserves exact canonical IDs, leading zeros and source categories; invalid and duplicate rows require review", () => {
  const p = parseClientRegistry(
    registry(
      registryRow(" 0001 "),
      registryRow("abc"),
      registryRow("ABC"),
      registryRow("0001"),
      registryRow("bad", { Age: "999" }),
      registryRow("zero", {
        "Social Risk Factor(s)": "0",
        "Current Living Arrangement": "Room-mate",
      }),
    ),
  );
  assert.equal(p.rows.length, 4);
  assert.equal(p.duplicates, 1);
  assert.equal(p.issues.length, 2);
  assert.equal(p.rows[0].memberId, "0001");
  assert.equal(p.rows[0].id, hash(["0001"]));
  assert.notEqual(p.rows[1].id, p.rows[2].id);
  assert.equal(p.rows[3].riskRaw, "0");
  assert.equal(p.rows[3].livingRaw, "Room-mate");
  assert.throws(
    () => parseClientRegistry([["Member ID"], ["a"]]),
    /Missing client registry headers/,
  );
});
test("revised registry supports native Excel admission dates without guessing boundary status", async () => {
  const matrix = revisedRegistry(registryRow("0001"));
  matrix[1][8] = new Date("2026-01-15T00:00:00Z");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Members").addRows(matrix);
  const parsed = parseClientRegistry(
    await readMatrix(await workbook.xlsx.writeBuffer(), "members.xlsx", [
      "Member ID",
    ]),
  );
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.rows[0].memberId, "0001");
  assert.equal(parsed.rows[0].client, true);
  assert.equal(parsed.rows[0].boundary, null);
  assert.equal(parsed.rows[0].registrationDate, "2026-01-15");
  assert.equal(parsed.rows[0].preferredLanguage, "Mandarin");
  matrix[1][8] = "01/02/2026";
  matrix.push([...matrix[1]]);
  matrix[2][0] = "valid";
  matrix[2][8] = "2026-02-01";
  assert.equal(parseClientRegistry(matrix).issues.length, 1);
  const legacy = parseClientRegistry(
    registry(
      registryRow("legacy", {
        "Is Client": "No",
        "Within Boundary": "No",
      }),
    ),
  );
  assert.equal(legacy.rows[0].client, false);
  assert.equal(legacy.rows[0].boundary, false);
});
for (const engine of ["SQLite", "PostgreSQL"]) {
  test(`${engine}: revised registry preserves saved boundary values and links new clients through review`, async () => {
    const f = await fixture(engine);
    try {
      await f.importAttendance([
        HEADERS,
        attendance("existing"),
        attendance("outsider"),
      ]);
      const result = await f.save(
        revisedRegistry(registryRow("existing"), registryRow("new")),
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.preview.clients, 2);
      assert.equal(
        result.preview.conflicts.some((c) => c.field === "boundary"),
        false,
      );
      const saved = await f.request(
        "/api/clients/" + hash(["existing"]) + "/source",
      );
      assert.equal(saved.body.current.boundary, true);
      assert.equal(saved.body.current.registrationDate, "2026-01-15");
      const added = await f.request(
        "/api/clients/" + hash(["new"]) + "/source",
      );
      assert.equal(added.body.current.boundary ?? null, null);
      assert.equal(added.body.current.client, true);
      const list = await f.request("/api/clients/followups", {
        filters: {},
        pageSize: 100,
      });
      assert.equal(list.body.total, 2);
      assert.equal(await f.count("attendance"), 2);
      const again = await f.save(
        revisedRegistry(registryRow("existing"), registryRow("new")),
      );
      assert.equal(again.body.changed, 0);
    } finally {
      await f.close();
    }
  });
  test(`${engine}: client registry links attendance, preserves other participants, enriches blanks and supports explicit conflict review and repeat imports`, async () => {
    const f = await fixture(engine);
    try {
      await f.importAttendance([
        HEADERS,
        attendance("registered"),
        attendance("outsider"),
      ]);
      const first = await f.save(
        registry(registryRow("registered"), registryRow("not-attending")),
      );
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.preview.matched, 1);
      assert.equal(first.body.created, 1);
      assert.equal(await f.count("attendance"), 2);
      assert.equal(await f.count("participants"), 3);
      const again = await f.save(
        registry(registryRow("registered"), registryRow("not-attending")),
      );
      assert.equal(again.body.created, 0);
      assert.equal(again.body.changed, 0);
      assert.equal(await f.count("participants"), 3);
      const p = await f.request(
        "/api/client-registry/preview",
        upload(
          registry(
            registryRow("registered", {
              Gender: "FEMALE",
              "Current Living Arrangement": "",
            }),
          ),
        ),
      );
      assert.equal(p.body.omitted, 1);
      assert.equal(
        p.body.conflicts.find((c) => c.field === "gender").existing,
        "MALE",
      );
      const updated = await f.request("/api/client-registry/confirm", {
        id: p.body.id,
        complete: true,
        asOf: "2026-11-03",
        approvedFields: [
          p.body.conflicts.find((c) => c.field === "gender").key,
        ],
      });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      const source = await f.request(
        "/api/clients/" + hash(["registered"]) + "/source",
      );
      assert.equal(source.body.current.gender, "FEMALE");
      assert.equal(source.body.current.livingRaw, "Alone");
      const list = await f.request("/api/clients/followups", {
        filters: {},
        pageSize: 100,
      });
      assert.equal(list.body.total, 2);
      assert.equal(
        list.body.rows.find((p) => p.memberId === "registered").attendance,
        1,
      );
      assert.equal(
        list.body.rows.find((p) => p.memberId === "not-attending").attendance,
        0,
      );
      assert.equal(await f.count("attendance"), 2);
      assert.equal(await f.count("participants"), 3);
      assert.ok((await f.request("/api/clients/imports")).body.length >= 3);
    } finally {
      await f.close();
    }
  });
  test(`${engine}: registry imports reject duplicates and stale previews, protect staff corrections and roll back a failed write`, async () => {
    const f = await fixture(engine);
    try {
      await f.save(registry(registryRow("first")));
      const duplicate = await f.request(
        "/api/client-registry/preview",
        upload(registry(registryRow("first"), registryRow("first"))),
      );
      assert.equal(
        (
          await f.request("/api/client-registry/confirm", {
            id: duplicate.body.id,
            complete: true,
            asOf: "2026-11-03",
          })
        ).status,
        400,
      );
      const stale = await f.request(
        "/api/client-registry/preview",
        upload(registry(registryRow("second"))),
      );
      await f.db
        .prepare("INSERT INTO participant_profiles VALUES(?,?,?,?,?)")
        .run(
          hash(["first"]),
          1,
          JSON.stringify({ basic: { gender: "FEMALE" } }),
          "2026-11-03",
          f.actor,
        );
      assert.equal(
        (
          await f.request("/api/client-registry/confirm", {
            id: stale.body.id,
            complete: true,
            asOf: "2026-11-03",
          })
        ).status,
        409,
      );
      const protectedP = await f.request(
        "/api/client-registry/preview",
        upload(registry(registryRow("first"))),
      );
      assert.equal(
        protectedP.body.conflicts.find((c) => c.field === "gender")
          .protectedReview,
        true,
      );
      assert.equal(
        (
          await f.request("/api/client-registry/confirm", {
            id: protectedP.body.id,
            complete: true,
            asOf: "2026-11-03",
            approvedFields: [protectedP.body.conflicts[0].key],
          })
        ).status,
        400,
      );
      const fresh = await f.request(
        "/api/client-registry/preview",
        upload(registry(registryRow("third"))),
      );
      if (engine === "SQLite")
        f.db.exec(
          "CREATE TRIGGER fail_client_audit BEFORE INSERT ON audit WHEN NEW.action='client.registry.imported' BEGIN SELECT RAISE(ABORT,'test rollback'); END;",
        );
      else
        await f.db.query(
          "ALTER TABLE glowbb.audit ADD CONSTRAINT fail_client_audit CHECK(action <> 'client.registry.imported') NOT VALID",
        );
      assert.ok(
        (
          await f.request("/api/client-registry/confirm", {
            id: fresh.body.id,
            complete: true,
            asOf: "2026-11-03",
          })
        ).status >= 400,
      );
      assert.equal(await f.count("participants"), 1);
      assert.equal(
        (
          await f.request("/api/clients/followups", {
            filters: {},
            pageSize: 100,
          })
        ).body.total,
        1,
      );
    } finally {
      await f.close();
    }
  });
  test(`${engine}: authorised follow-up supports pagination, sourced barriers, idempotent contact history, profile revisions and explicit archive/reactivation`, async () => {
    const f = await fixture(engine);
    try {
      await f.save(
        registry(
          ...Array.from({ length: 10 }, (_, i) => registryRow("member-" + i)),
        ),
      );
      const first = (
        await f.request("/api/clients/followups", {
          filters: { status: "no-attendance" },
          pageSize: 3,
        })
      ).body;
      assert.equal(first.total, 10);
      assert.equal(first.rows.length, 3);
      assert.equal(first.rows[0].memberId, "member-0");
      const p = first.rows[0],
        payload = {
          id: "contact-unique",
          profileRevision: 0,
          outcome: "Follow-up required",
          date: "2026-11-03",
          assigned: "Staff A",
          notes: "Participant requested programme information",
          nextDate: "2026-11-10",
          source: "Participant-reported",
          barriers: ["Lack of programme awareness"],
          permission: true,
        };
      assert.equal(
        (
          await f.request("/api/clients/" + p.id + "/contact", {
            ...payload,
            permission: false,
          })
        ).status,
        400,
      );
      assert.equal(
        (await f.request("/api/clients/" + p.id + "/contact", payload)).status,
        200,
      );
      assert.equal(
        (await f.request("/api/clients/" + p.id + "/contact", payload)).body
          .replayed,
        true,
      );
      assert.equal(await f.count("participant_feedback"), 1);
      assert.equal(
        (
          await f.request("/api/clients/" + p.id + "/contact", {
            ...payload,
            id: "new-contact",
            notes: "new",
          })
        ).status,
        409,
      );
      const profile = (await f.request("/api/participants/" + p.id)).body;
      assert.equal(profile.details.followUp.assigned, "Staff A");
      assert.equal(profile.details.followUp.required, true);
      assert.equal(profile.revision, 1);
      const filtered = (
        await f.request("/api/clients/followups", {
          filters: { barrier: "Lack of programme awareness" },
        })
      ).body;
      assert.equal(filtered.total, 1);
      assert.equal(filtered.rows[0].followUp, "Follow-up required");
      const source = (await f.request("/api/clients/" + p.id + "/source")).body;
      assert.equal(
        (
          await f.request("/api/clients/" + p.id + "/membership", {
            revision: source.current.revision,
            status: "Archived",
            reason: "Reviewed status",
            confirmation: "ARCHIVE CLIENT",
          })
        ).status,
        200,
      );
      assert.equal(
        (await f.request("/api/clients/followups", { filters: {} })).body.total,
        9,
      );
      const archived = (
        await f.request("/api/clients/followups", {
          filters: {},
          membership: "Archived",
        })
      ).body;
      assert.equal(archived.total, 1);
      assert.equal(
        (
          await f.request("/api/clients/" + p.id + "/membership", {
            revision: source.current.revision + 1,
            status: "Active",
            reason: "Verified current registration",
            confirmation: "RESTORE CLIENT",
          })
        ).status,
        200,
      );
      assert.equal(
        (await f.request("/api/clients/followups", { filters: {} })).body.total,
        10,
      );
    } finally {
      await f.close();
    }
  });
}
test("period-specific participation, historical status and current-population denominators stay separate; sensitive filters use protected aggregate cohorts", () => {
  const people = Array.from({ length: 20 }, (_, i) => ({
    id: hash(["p" + i]),
    memberId: "p" + i,
    age: 75,
    gender: i < 10 ? "MALE" : "FEMALE",
    race: "MALAY",
    cfs: "1-3",
    riskRaw: "0",
    livingRaw: "Alone",
    blockRaw: i < 10 ? "101" : "102",
    client: true,
    membershipStatus: "Active",
  }));
  const s = {
    data: {
      participants: people,
      programmes: [{ id: "social", name: "Social", domain: "Social" }],
      sessions: [
        {
          id: "may",
          programmeId: "social",
          date: "2026-05-04",
          start: 540,
          end: 600,
        },
        {
          id: "nov",
          programmeId: "social",
          date: "2026-11-03",
          start: 540,
          end: 600,
        },
      ],
      attendance: people.slice(0, 10).flatMap((p, i) => [
        {
          id: "a" + i,
          participantId: p.id,
          sessionId: i < 5 ? "may" : "nov",
        },
      ]),
    },
    settings: {
      ...defaults,
      registry: {
        type: "clients",
        complete: true,
        snapshot: CLIENT_SNAPSHOT,
        asOf: "2026-11-03",
      },
    },
    profiles: [],
    feedback: [],
    registry: people.map((p) => ({
      participant_id: p.id,
      snapshot: CLIENT_SNAPSHOT,
      details: JSON.stringify(p),
    })),
  };
  const full = clientReport(s, {}, "2026-11-03");
  assert.equal(full.summary.registered, 20);
  assert.equal(full.summary.attending, 10);
  assert.equal(full.summary.rate, 50);
  const period = clientContext(
    s,
    { from: "2026-11-01", to: "2026-11-03" },
    "2026-11-03",
  );
  assert.equal(period.selected.filter((p) => p.selectedSessions).length, 5);
  assert.equal(
    period.members.find((p) => p.memberId === "p0").last,
    "2026-05-04",
  );
  assert.equal(
    period.members.find((p) => p.memberId === "p0").status,
    "inactive-90",
  );
  assert.equal(
    period.members.find((p) => p.memberId === "p15").status,
    "no-history",
  );
  const combined = clientReport(
    s,
    { gender: "MALE", ageMin: "70", status: "no-attendance" },
    "2026-11-03",
  );
  assert.equal(combined.suppressed, false); // all exact membership atoms have five people
  s.data.participants[0].age = 76;
  s.registry[0].details = JSON.stringify({ ...people[0], age: 76 });
  const unsafe = clientReport(s, { gender: "MALE" }, "2026-11-03");
  assert.equal(unsafe.suppressed, true);
  assert.equal(unsafe.summary.registered, null);
  assert.equal(unsafe.groups.living.rows.length, 0);
  assert.equal(unsafe.findings.length, 0);
  assert.equal(unsafe.quality.length, 0);
  const later = clientReport(s, { asOf: "2026-11-04" }, "2026-11-04");
  assert.equal(later.summary.active, null);
  assert.equal(later.summary.inactive, null);
  assert.equal(
    clientContext(s, { asOf: "2026-11-04" }, "2026-11-04").members[0].status,
    "history-limited",
  );
  assert.throws(
    () =>
      clientContext(
        s,
        { from: "2026-11-04", asOf: "2026-11-04" },
        "2026-11-04",
      ),
    /coverage/,
  );
  const noAttendance = clientReport(
    { ...s, data: { ...s.data, attendance: [], sessions: [] } },
    {},
    "2026-11-03",
  );
  assert.equal(noAttendance.attendanceAvailable, false);
  assert.equal(noAttendance.summary.registered, 20);
  assert.equal(noAttendance.summary.rate, null);
  assert.equal(noAttendance.findings.length, 0);
  const protectedRows = protectClientRows(
    [
      { label: "small", registered: 1, attending: 0, noAttendance: 1 },
      { label: "safe", registered: 10, attending: 5, noAttendance: 5 },
    ],
    5,
  );
  assert.equal(
    protectedRows.every((r) => r.suppressed),
    true,
  );
});
test("client feedback retains explicit empty answers and assessed absent barriers, preserves languages across later blanks and uses reviewed living corrections", () => {
  const people = Array.from({ length: 20 }, (_, i) => ({
    id: "p" + i,
    memberId: "P" + i,
    age: 75,
    gender: "MALE",
    race: "MALAY",
    cfs: "1-3",
    riskRaw: "0",
    livingRaw: "Alone",
    blockRaw: "101",
    client: true,
  }));
  const feedback = people.slice(0, 10).flatMap((p, i) => [
    {
      id: "first" + i,
      participant_id: p.id,
      date: "2026-10-01",
      created: "2026-10-01",
      details: JSON.stringify({
        preferences: { responded: true, interests: [], languages: ["English"] },
        barriers: [
          {
            category: "Language",
            status: "Not present",
            source: "Participant-reported",
            date: "2026-10-01",
          },
        ],
      }),
    },
    {
      id: "later" + i,
      participant_id: p.id,
      date: "2026-11-03",
      created: "2026-11-03",
      details: JSON.stringify({ preferences: {}, barriers: [] }),
    },
  ]);
  const state = {
    data: {
      participants: people,
      programmes: [],
      sessions: [],
      attendance: [],
    },
    settings: {
      ...defaults,
      registry: {
        type: "clients",
        complete: true,
        snapshot: CLIENT_SNAPSHOT,
        asOf: "2026-11-03",
      },
    },
    registry: people.map((p) => ({
      participant_id: p.id,
      snapshot: CLIENT_SNAPSHOT,
      details: JSON.stringify(p),
    })),
    feedback,
    profiles: people.slice(0, 5).map((p) => ({
      participant_id: p.id,
      revision: 1,
      updated: "2026-11-03",
      details: JSON.stringify({
        basic: { livingRaw: "Family" },
        preferences: { languages: [] },
      }),
    })),
  };
  const context = clientContext(state, {}, "2026-11-03"),
    r = clientReport(state, {}, "2026-11-03");
  assert.deepEqual(context.members[0].preferredLanguage, ["English"]);
  assert.equal(context.members[0].livingRaw, "Family");
  assert.equal(context.members[0].interestsAssessed, true);
  assert.equal(context.members[0].reportedBarriers.length, 0);
  assert.equal(
    r.quality.find((q) => q.field === "reportedInterests").missing,
    10,
  );
  assert.equal(r.barriers.respondents, 10);
  assert.equal(r.barriers.unassessed, 10);
  assert.equal(r.barriers.rows.length, 0);
  const declined = [
    ...feedback,
    ...people.slice(10).map((p, i) => ({
      id: "declined" + i,
      participant_id: p.id,
      date: "2026-11-03",
      created: "2026-11-03",
      details: JSON.stringify({
        barriers: [
          {
            category: "Prefers not to say",
            status: "Reported",
            source: "Participant-reported",
            date: "2026-11-03",
          },
        ],
      }),
    })),
  ];
  const needsReport = needsAnalysis(
    state.data,
    state.profiles,
    declined,
    state.registry,
    state.settings,
    {},
    "2026-11-03",
  );
  assert.equal(needsReport.responses.barriers.denominator, 10);
  assert.equal(needsReport.responses.barriers.values.length, 0);
  assert.throws(
    () => clientContext(state, { from: "2026-12-01" }, "2026-11-03"),
    /reporting period/,
  );
});
test("client roles and exports are enforced server-side; personal client settings preserve other dashboard preferences", async () => {
  const f = await fixture();
  try {
    await f.save(
      registry(
        ...Array.from({ length: 10 }, (_, i) => registryRow("client-" + i)),
      ),
    );
    for (const role of ["viewer", "planner"]) {
      await f.db
        .prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
        .run(role, "disabled", role);
      const id = f.db
          .prepare("SELECT id FROM users WHERE username=?")
          .get(role).id,
        token = (role === "viewer" ? "a" : "b").repeat(64);
      f.db
        .prepare("INSERT INTO logins VALUES(?,?,?)")
        .run(hash(token), id, Date.now() + 60000);
      const cookie = "glow_session=" + token;
      const briefing = await f.request(
        "/api/reporting/briefing",
        undefined,
        "GET",
        cookie,
      );
      assert.equal(briefing.status, 200);
      const safeBriefing = briefing.body;
      if (role === "viewer")
        assert.deepEqual(safeBriefing, {
          clients: null,
          needs: null,
          actions: null,
        });
      else assert.equal(safeBriefing.clients.summary.registered, 10);
      assert.equal(
        (await f.request("/api/clients/report", {}, "POST", cookie)).status,
        role === "viewer" ? 403 : 200,
      );
      assert.equal(
        (await f.request("/api/clients/followups", {}, "POST", cookie)).status,
        role === "viewer" ? 403 : 200,
      );
      assert.equal(
        (
          await f.request(
            "/api/client-registry/preview",
            upload(registry(registryRow("c"))),
            "POST",
            cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await f.request("/api/clients/settings", undefined, "GET", cookie))
          .status,
        403,
      );
      assert.equal(
        (await f.request("/api/clients/export/csv", undefined, "GET", cookie))
          .status,
        role === "viewer" ? 403 : 200,
      );
    }
    const prefs = { views: [], active: "", template: "My existing overview" };
    assert.equal(
      (await f.request("/api/preferences", prefs, "PUT")).status,
      200,
    );
    const clientView = {
      views: [],
      draft: {
        id: "",
        name: "Client review",
        kpis: ["registered", "rate"],
        charts: ["living"],
        filters: { asOf: "2026-11-03" },
      },
    };
    assert.equal(
      (await f.request("/api/clients/preferences", clientView, "PUT")).status,
      200,
    );
    assert.equal(
      (await f.request("/api/preferences")).body.template,
      prefs.template,
    );
    assert.equal(
      (await f.request("/api/clients/preferences")).body.draft.name,
      "Client review",
    );
    const csv = await f.request("/api/clients/export/csv");
    assert.equal(
      (
        await f.request(
          "/api/preferences",
          { ...prefs, template: "Changed overview" },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/api/clients/preferences")).body.draft.name,
      "Client review",
    );
    assert.equal(
      (
        await f.request(
          "/api/clients/templates",
          { view: clientView.draft },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/api/clients/preferences")).body.sharedTemplates.length,
      1,
    );
    assert.equal(
      (await f.request("/api/clients/preferences", clientView, "PUT")).status,
      200,
    );
    assert.equal(
      (await f.request("/api/clients/preferences")).body.sharedTemplates.length,
      1,
    );
    assert.equal(csv.status, 200);
    assert.ok(!csv.body.includes("client-0"));
    assert.ok(!csv.body.includes("Block / Building"));
    assert.equal(
      (await f.request("/api/clients/export/csv?living=Alone")).status,
      403,
    );
    assert.equal((await f.request("/api/clients/export/report")).status, 200);
  } finally {
    await f.close();
  }
});
test(
  "the actual workbook can enrich a complete in-memory attendance import without rewriting source files or saving user data",
  { skip: !existsSync(registryPath) || !existsSync(attendancePath) },
  async () => {
    const f = await fixture();
    try {
      const parsed = await parseFile(
        readFileSync(attendancePath),
        attendancePath,
      );
      parsed.mode = "merge";
      saveImport(f.db, parsed, inspectImport(parsed, readData(f.db)), f.actor);
      const form = new FormData();
      form.append(
        "file",
        new Blob([readFileSync(registryPath)]),
        "Members.xlsx",
      );
      const p = await f.request("/api/client-registry/preview", form);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      assert.equal(p.body.rows, 1473);
      assert.equal(p.body.matched, 164);
      assert.equal(p.body.conflicts.length, 0);
      assert.equal(p.body.newProfiles, 1309);
      assert.equal(
        (
          await f.request("/api/client-registry/confirm", {
            id: p.body.id,
            complete: true,
            asOf: "2026-11-03",
          })
        ).status,
        200,
      );
      assert.equal(await f.count("attendance"), 3343);
      assert.equal(await f.count("participants"), 1714);
      const r = (await f.request("/api/clients/report", {})).body;
      assert.equal(r.summary.registered, 1473);
      assert.equal(r.summary.attending, 164);
      assert.equal(r.summary.noAttendance, 1309);
      assert.equal(r.summary.otherAttenders, 241);
      assert.equal(r.quality.find((q) => q.field === "livingRaw").missing, 450);
      assert.ok(
        (await f.request("/api/needs/overview")).body.findings.some(
          (r) => r.id === "client-alone",
        ),
      );
    } finally {
      await f.close();
    }
  },
);
