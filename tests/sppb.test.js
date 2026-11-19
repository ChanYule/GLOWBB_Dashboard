import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { PGlite } from "@electric-sql/pglite";
import { openDb } from "../server/db.js";
import { openPostgres } from "../server/postgres.js";
import { createPlatformApp } from "../server/platform.js";
import { hash, readMatrix } from "../server/domain.js";
import { CLIENT_SNAPSHOT } from "../server/client-domain.js";
import { CENTRES } from "../shared/centres.js";
import {
  assessmentDay,
  parseSppb,
  sppbHeaders,
  standardScores,
  conflictGroups,
  memberSummary,
  reassessment,
} from "../server/sppb-domain.js";
const matrix = (...rows) => [sppbHeaders, ...rows];
const row = (id = "0001", date = "2026-01-01", scores = [4, 4, 4, 12]) => [
  id,
  date,
  ...scores,
];
const source =
  "C:/Users/CHANYULE/Downloads/Short Physical Performance Battery (SPPB) (1).xlsx";
const config = {
  intervalMonths: 6,
  approachDays: 30,
  definitions: [
    {
      sourceDefinition: "caritahub-export-unverified",
      version: "approved-standard-v1",
      method: "identity",
      approved: true,
    },
  ],
};

test(
  "SPPB source workbook reconciles independently without modifying source or participant records",
  { skip: !existsSync(source) },
  async () => {
    const buffer = readFileSync(source),
      originalHash = hash(buffer.toString("base64"));
    const parsed = parseSppb(
      await readMatrix(buffer, source, [
        "Member ID",
        "Date of Assessment",
        "Total Score",
      ]),
    );
    const members = new Map();
    for (const r of parsed.rows) {
      if (!members.has(r.memberKey)) members.set(r.memberKey, new Set());
      if (r.date) members.get(r.memberKey).add(r.date);
    }
    assert.equal(parsed.rows.length, 666);
    assert.equal(members.size, 397);
    assert.equal([...members.values()].filter((d) => d.size >= 2).length, 189);
    assert.equal(conflictGroups(parsed.rows).length, 69);
    assert.equal(parsed.rows.filter((r) => r.original.total > 12).length, 124);
    assert.equal(parsed.rows.filter((r) => r.original.gait > 4).length, 139);
    assert.equal(parsed.rows.filter((r) => !r.date).length, 1);
    assert.ok(
      parsed.rows.every(
        (r) =>
          r.original.balance + r.original.gait + r.original.chair ===
          r.original.total,
      ),
    );
    assert.equal(hash(readFileSync(source).toString("base64")), originalHash);
  },
);
test("SPPB parsing retains duplicate source headings, exact identifiers, serial dates, original scores and failed-test details", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("SPPB");
  sheet.addRows(
    [
      ...matrix(
        row(" 0001 ", 46323, [4, 8, 4, 16]),
        row("abc", "2026-02-01"),
        row("ABC", "2026-02-02"),
        row("missing", ""),
      ),
    ].map((r, i) =>
      i === 0
        ? [...r, "Specify", "Specify"]
        : [...r, "Not attempted", "Walking aid"],
    ),
  );
  const parsed = parseSppb(
    await readMatrix(await workbook.xlsx.writeBuffer(), "sppb.xlsx", [
      "Member ID",
      "Date of Assessment",
      "Total Score",
    ]),
  );
  assert.equal(parsed.rows[0].memberId, "0001");
  assert.equal(parsed.rows[0].memberKey, hash(["0001"]));
  assert.notEqual(parsed.rows[1].memberKey, parsed.rows[2].memberKey);
  assert.deepEqual(parsed.rows[0].original, {
    balance: 4,
    gait: 8,
    chair: 4,
    total: 16,
  });
  assert.equal(parsed.rows[0].date, assessmentDay(46323));
  assert.deepEqual(
    parsed.rows[0].raw
      .filter((c) => c.header === "Specify")
      .map((c) => c.value),
    ["Not attempted", "Walking aid"],
  );
  assert.equal(parsed.rows[3].date, null);
  assert.ok(parsed.rows[3].warnings.some((w) => w.includes("date")));
  assert.equal(assessmentDay("2026-02-30"), null);
  assert.equal(assessmentDay("01/02/2026"), null);
  assert.equal(assessmentDay(60), null);
  assert.equal(assessmentDay(1), "1900-01-01");
  assert.equal(assessmentDay(0, true), "1904-01-01");
  assert.equal(assessmentDay(new Date("2026-10-28T00:00:00Z")), "2026-10-28");
  const utc = parseSppb(
    matrix(
      row(
        "stable",
        "Wed Oct 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)",
      ),
    ),
  ).rows[0];
  const sg = parseSppb(
    matrix(
      row(
        "stable",
        "Wed Oct 28 2026 08:00:00 GMT+0800 (Singapore Standard Time)",
      ),
    ),
  ).rows[0];
  assert.equal(utc.id, sg.id);
  assert.throws(
    () =>
      parseSppb([
        ["Member ID", "Total Score"],
        ["1", 2],
      ]),
    /required SPPB column/,
  );
});
test("SPPB comparisons require approved compatible scales, unambiguous dates and valid components without modifying imported values", () => {
  const rows = parseSppb(
    matrix(
      row("x", "2025-01-01", [2, 2, 2, 6]),
      row("x", "2026-01-01", [3, 3, 3, 9]),
    ),
  ).rows;
  const member = { id: hash(["x"]) };
  assert.equal(
    memberSummary(member, rows, { ...config, definitions: [] }, "2026-11-19")
      .delta,
    null,
  );
  const summary = memberSummary(member, rows, config, "2026-11-19");
  assert.equal(summary.delta, 3);
  assert.equal(summary.change, "Score increased");
  assert.equal(summary.previous.date, "2025-01-01");
  assert.equal(summary.latest.original.total, 9);
  const conflict = parseSppb(matrix(row("x", "2026-01-01", [4, 4, 4, 12])))
    .rows[0];
  const conflicted = memberSummary(
    member,
    [...rows, conflict],
    config,
    "2026-11-19",
  );
  assert.equal(conflicted.latest, null);
  assert.equal(conflicted.delta, null);
  assert.equal(conflictGroups([...rows, conflict]).length, 1);
  conflict.review = { disposition: "superseded" };
  assert.equal(
    memberSummary(member, [...rows, conflict], config, "2026-11-19").delta,
    3,
  );
  const incompatible = [rows[0], { ...rows[1], sourceDefinition: "other" }];
  assert.equal(
    memberSummary(
      member,
      incompatible,
      {
        ...config,
        definitions: [
          ...config.definitions,
          {
            sourceDefinition: "other",
            version: "v2",
            method: "identity",
            approved: true,
          },
        ],
      },
      "2026-11-19",
    ).delta,
    null,
  );
  assert.equal(
    standardScores({ balance: 4, gait: 8, chair: 4, total: 16 }),
    false,
  );
  assert.equal(
    standardScores({ balance: 4, gait: 4, chair: 4, total: 11 }),
    false,
  );
  const exceed = parseSppb(matrix(row("x", "2026-01-01", [4, 8, 4, 16])))
    .rows[0];
  assert.equal(
    memberSummary(member, [exceed], config, "2026-11-19").latest.standard,
    null,
  );
  assert.equal(exceed.original.total, 16);
  exceed.review = {
    standard: { balance: 4, gait: 4, chair: 4, total: 12 },
    scoringVersion: "approved-standard-v1",
  };
  assert.equal(
    memberSummary(member, [exceed], config, "2026-11-19").latest.standard.total,
    12,
  );
  assert.equal(exceed.original.total, 16);
});
test("reassessment intervals are explicit, calendar-month based and distinct from missing dates or no assessment", () => {
  assert.equal(
    reassessment("2026-08-31", { ...config, intervalMonths: 6 }, "2027-02-28")
      .due,
    "2027-02-28",
  );
  assert.equal(
    reassessment("2026-05-19", config, "2026-11-19").status,
    "Reassessment due",
  );
  assert.equal(
    reassessment("2026-05-18", config, "2026-11-19").status,
    "Overdue",
  );
  assert.equal(
    reassessment("2026-05-30", config, "2026-11-19").status,
    "Approaching reassessment date",
  );
  assert.equal(
    reassessment("2026-11-01", config, "2026-11-19").status,
    "Recently assessed",
  );
  assert.equal(
    reassessment(null, config, "2026-11-19", true).status,
    "Assessment date unavailable",
  );
  assert.equal(
    reassessment(null, config, "2026-11-19").status,
    "No recorded assessment",
  );
  assert.equal(
    reassessment(
      "2026-01-01",
      { ...config, intervalMonths: null },
      "2026-11-19",
    ).due,
    null,
  );
});

async function fixture(engine = "SQLite") {
  let control;
  if (engine === "PostgreSQL") {
    const pg = new PGlite();
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of [
      "001_dashboard.sql",
      "002_operations.sql",
      "003_personal_analysis.sql",
      "004_needs_based.sql",
      "005_locations.sql",
    ])
      await pg.exec(
        readFileSync(
          new URL("../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    const query = async (sql, values) => {
      if (!values && sql.includes(";")) {
        const r = await pg.exec(sql);
        return {
          rows: r.at(-1)?.rows || [],
          rowCount: r.at(-1)?.affectedRows || 0,
        };
      }
      const r = await pg.query(sql, values);
      return { rows: r.rows, rowCount: r.affectedRows };
    };
    let tail = Promise.resolve();
    const pool = {
      async connect() {
        let release;
        const next = new Promise((r) => (release = r)),
          old = tail;
        tail = next;
        await old;
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
    control = openPostgres(undefined, { pool });
  } else control = openDb(":memory:");
  for (const [username, role] of [
    ["admin", "admin"],
    ["planner", "planner"],
    ["viewer", "viewer"],
  ])
    await control
      .prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
      .run(username, "disabled", role);
  const children = new Map();
  const app = createPlatformApp(control, {
    authRequired: true,
    ...(engine === "SQLite"
      ? {
          openWorkspace: (id) => {
            const db = openDb(":memory:");
            children.set(id, db);
            return db;
          },
        }
      : {}),
  });
  await app.platform.ready;
  const tokens = {};
  for (const name of ["admin", "planner", "viewer"]) {
    const user = await control
      .prepare("SELECT * FROM users WHERE username=?")
      .get(name);
    tokens[name] = (name[0] === "a" ? "a" : name[0] === "p" ? "b" : "c").repeat(
      64,
    );
    await control
      .prepare("INSERT INTO logins VALUES(?,?,?)")
      .run(hash(tokens[name]), user.id, Date.now() + 3600000);
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (
    path,
    body,
    user = "admin",
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: "glow_session=" + tokens[user],
        ...(body !== undefined && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  const json = async (path, body, user) => {
    const r = await request(path, body, user);
    const result = await r.json();
    assert.equal(r.status, 200, JSON.stringify(result));
    return result;
  };
  const seed = async (
    centre,
    id,
    { registry = true, complete = true } = {},
  ) => {
    const db = await app.platform.workspaces.get(centre),
      pid = hash([id]);
    await db
      .prepare("INSERT OR IGNORE INTO participants VALUES(?,?)")
      .run(pid, JSON.stringify({ age: 75, cfs: "4" }));
    if (registry)
      await db
        .prepare("INSERT OR IGNORE INTO member_registry VALUES(?,?,?)")
        .run(
          pid,
          CLIENT_SNAPSHOT,
          JSON.stringify({
            memberId: id,
            client: true,
            membershipStatus: "Active",
          }),
        );
    const settings = JSON.parse(
      (await db.prepare("SELECT value FROM settings WHERE id=1").get()).value,
    );
    settings.registry = {
      type: "clients",
      snapshot: CLIENT_SNAPSHOT,
      complete,
    };
    await db
      .prepare("UPDATE settings SET value=? WHERE id=1")
      .run(JSON.stringify(settings));
    return db;
  };
  const upload = (rows) => {
    const data = new FormData();
    data.append(
      "file",
      new Blob([
        rows
          .map((r) =>
            r
              .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
              .join(","),
          )
          .join("\r\n"),
      ]),
      "sppb.csv",
    );
    return data;
  };
  const save = async (rows) => {
    const p = await json("/api/sppb/import/preview", upload(rows));
    return {
      preview: p,
      result: await json("/api/sppb/import/confirm", {
        id: p.id,
        confirmed: true,
      }),
    };
  };
  return {
    control,
    app,
    request,
    json,
    seed,
    save,
    upload,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      for (const db of children.values()) db.close();
      await control.close();
    },
  };
}
test(
  "the supplied XLSX imports once into isolated shared storage and retains every unmatched original",
  { skip: !existsSync(source) },
  async () => {
    const f = await fixture();
    try {
      const file = new FormData();
      file.append("file", new Blob([readFileSync(source)]), "sppb.xlsx");
      const p = await f.json("/api/sppb/import/preview", file);
      assert.equal(p.rows, 666);
      assert.equal(p.uniqueMembers, 397);
      assert.equal(p.matchedMembers, 0);
      assert.equal(p.unmatchedMembers, 397);
      assert.equal(p.conflicts, 69);
      assert.equal(p.missingDates, 1);
      const result = await f.json("/api/sppb/import/confirm", {
        id: p.id,
        confirmed: true,
      });
      assert.equal(result.inserted, 666);
      assert.equal(
        Number(
          (await f.control.prepare("SELECT count(*) n FROM sppb_records").get())
            .n,
        ),
        666,
      );
      const review = await f.json("/api/sppb/review");
      assert.equal(review.rows.length, 25);
      assert.equal(review.unmatchedMembers, 397);
      const overview = await f.json(
        "/api/sppb/overview?centre=" + CENTRES[0].id,
      );
      assert.equal(overview.summary.assessed, 0);
      assert.equal(overview.summary.coverage, null);
      const repeat = new FormData();
      repeat.append("file", new Blob([readFileSync(source)]), "renamed.xlsx");
      const p2 = await f.json("/api/sppb/import/preview", repeat);
      assert.equal(p2.existingRecords, 666);
      assert.equal(
        (
          await f.json("/api/sppb/import/confirm", {
            id: p2.id,
            confirmed: true,
          })
        ).inserted,
        0,
      );
      const discarded = new FormData();
      discarded.append("file", new Blob([readFileSync(source)]), "sppb.xlsx");
      const p3 = await f.json("/api/sppb/import/preview", discarded);
      const actor = await f.control
        .prepare("SELECT id FROM users WHERE username=?")
        .get("admin");
      assert.ok(
        await f.control
          .prepare("SELECT id FROM import_previews WHERE id=? AND user_id=?")
          .get(p3.id, actor.id),
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/import/preview/" + p3.id,
            undefined,
            "admin",
            "DELETE",
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await f.request("/api/sppb/import/confirm", {
            id: p3.id,
            confirmed: true,
          })
        ).status,
        409,
      );
    } finally {
      await f.close();
    }
  },
);
for (const engine of ["SQLite", "PostgreSQL"])
  test(`${engine}: shared SPPB imports, membership-scoped access, staging, rollback, scoring review and exports`, async () => {
    const f = await fixture(engine);
    const centre = CENTRES[0].id,
      second = CENTRES[1].id;
    try {
      await f.seed(centre, "0001");
      await f.seed(second, "0001");
      await f.seed(second, "private");
      await f.seed(centre, "attendance-only", { registry: false });
      for (const id of ["no-assessment", "date-missing"])
        await f.seed(centre, id);
      const rows = matrix(
        row("0001", "2026-01-01", [2, 2, 2, 6]),
        row("0001", "2026-10-01", [3, 3, 3, 9]),
        row("private"),
        row("unmatched"),
        row("attendance-only"),
        row("date-missing", ""),
        row("0001", "2026-10-01", [3, 3, 3, 9]),
      );
      const saved = await f.save(rows);
      assert.equal(saved.preview.rows, 7);
      assert.equal(saved.preview.uniqueMembers, 5);
      assert.equal(saved.preview.matchedMembers, 4);
      assert.equal(saved.preview.unmatchedMembers, 1);
      assert.equal(saved.preview.identicalDuplicates, 1);
      assert.equal(saved.result.inserted, 6);
      assert.equal((await f.save(rows)).result.inserted, 0);
      assert.equal(
        Number(
          (await f.control.prepare("SELECT count(*) n FROM sppb_records").get())
            .n,
        ),
        6,
      );
      const overview = await f.json("/api/sppb/overview?centre=" + centre);
      assert.equal(overview.summary.eligible, 3);
      assert.equal(overview.summary.assessed, 1);
      assert.equal(overview.summary.repeated, 1);
      assert.equal(overview.summary.comparable, 0);
      assert.deepEqual(overview.recordedScores, [
        {
          sourceDefinition: "caritahub-export-unverified",
          total: 9,
          members: 1,
        },
      ]);
      assert.equal(
        overview.rows.some((r) => r.memberId === "attendance-only"),
        false,
      );
      assert.equal(
        overview.rows.find((r) => r.memberId === "date-missing").followup
          .status,
        "Assessment date unavailable",
      );
      const combined = await f.json("/api/sppb/overview?centre=all");
      assert.equal(combined.summary.eligible, 4);
      assert.equal(combined.summary.assessed, 2);
      assert.equal(
        combined.rows.filter((r) => r.memberId === "0001").length,
        1,
      );
      assert.equal(
        combined.rows.find((r) => r.memberId === "0001").centres.length,
        2,
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/members/" +
              hash(["attendance-only"]) +
              "?centre=" +
              centre,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/members/" + hash(["private"]) + "?centre=" + centre,
            undefined,
            "planner",
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/members/" + hash(["private"]) + "?centre=" + second,
            undefined,
            "planner",
          )
        ).status,
        403,
      );
      assert.equal(
        (await f.request("/api/sppb/review", undefined, "planner")).status,
        403,
      );
      assert.equal(
        (await f.request("/api/sppb/import/preview", f.upload(rows), "planner"))
          .status,
        403,
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
            undefined,
            "viewer",
          )
        ).status,
        403,
      );
      const viewer = await f.json(
        "/api/sppb/overview?centre=" + centre,
        undefined,
        "viewer",
      );
      assert.equal(viewer.summary, null);
      assert.equal(viewer.rows, undefined);
      assert.equal(
        (
          await f.request(
            "/api/sppb/overview?centre=" + centre + "&search=0001",
            undefined,
            "viewer",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/export?centre=" + centre + "&format=xlsx",
            undefined,
            "viewer",
          )
        ).status,
        403,
      );
      const review = await f.json("/api/sppb/review");
      await f.json("/api/sppb/configuration", {
        revision: review.config.revision,
        intervalMonths: 6,
        approachDays: 30,
        definitions: config.definitions,
        reason:
          "Approved local scoring procedure and standard protocol evidence.",
      });
      const centreDb = await f.app.platform.workspaces.get(centre);
      await centreDb
        .prepare(
          "INSERT INTO programmes(id,name,domain,optional) VALUES(?,?,?,?)",
        )
        .run("programme", "Recorded movement programme", "Physical", "{}");
      await centreDb
        .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)")
        .run(
          "session",
          "programme",
          "2026-06-01",
          540,
          600,
          "Centre",
          JSON.stringify({ eventTypes: ["Exercise"] }),
        );
      await centreDb
        .prepare("INSERT INTO attendance VALUES(?,?,?,?,?)")
        .run("attendance", hash(["0001"]), "session", "source-session", null);
      const detail = await f.json(
        "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
      );
      assert.equal(detail.delta, 3);
      assert.equal(detail.latest.standard.total, 9);
      assert.equal(detail.count, 2);
      assert.equal(detail.participation.sessions, 1);
      assert.deepEqual(detail.participation.domains, ["Physical"]);
      assert.deepEqual(detail.participation.eventTypes, ["Exercise"]);
      await f.save(matrix(row("0001", "2024-01-01", [4, 8, 4, 16])));
      const outOfRange = (
        await f.json(
          "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
        )
      ).records.find((r) => r.original.total === 16);
      assert.equal(outOfRange.standard, null);
      assert.equal(
        (
          await f.request("/api/sppb/records/" + outOfRange.id + "/review", {
            revision: 0,
            disposition: "unresolved",
            reason: "Reviewed against approved source protocol evidence.",
            standard: { balance: 4, gait: 4, chair: 4, total: 12 },
            scoringVersion: "unapproved",
          })
        ).status,
        400,
      );
      await f.json("/api/sppb/records/" + outOfRange.id + "/review", {
        revision: 0,
        disposition: "unresolved",
        reason: "Reviewed against approved source protocol evidence.",
        standard: { balance: 4, gait: 4, chair: 4, total: 12 },
        scoringVersion: "approved-standard-v1",
      });
      const reviewedSource = (
        await f.json(
          "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
        )
      ).records.find((r) => r.id === outOfRange.id);
      assert.equal(reviewedSource.original.total, 16);
      assert.equal(reviewedSource.standard.total, 12);
      await f.json(
        "/api/sppb/members/" + hash(["0001"]) + "/followup?centre=" + centre,
        { assigned: "Staff member", status: "Review required", revision: 0 },
        "planner",
      );
      assert.equal(
        (
          await f.json(
            "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
          )
        ).followupTask.status,
        "Review required",
      );
      assert.equal(
        (
          await f.request(
            "/api/sppb/members/" +
              hash(["0001"]) +
              "/followup?centre=" +
              centre,
            { assigned: "Other", status: "Completed", revision: 0 },
          )
        ).status,
        409,
      );
      await f.save(matrix(row("0001", "2026-10-01", [4, 4, 4, 12])));
      const conflicted = await f.json(
        "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
      );
      assert.equal(conflicted.latest, null);
      assert.equal(conflicted.delta, null);
      assert.equal(conflicted.records.filter((r) => r.conflict).length, 2);
      const corrected = conflicted.records.find((r) => r.original.total === 12);
      await f.json("/api/sppb/records/" + corrected.id + "/review", {
        revision: 0,
        disposition: "superseded",
        reason: "Verified duplicate correction; retain original source record.",
      });
      assert.equal(
        (
          await f.json(
            "/api/sppb/members/" + hash(["0001"]) + "?centre=" + centre,
          )
        ).delta,
        3,
      );
      assert.equal(
        (
          await f.request("/api/sppb/records/" + corrected.id + "/review", {
            revision: 0,
            disposition: "separate",
            reason: "Stale update must be rejected.",
          })
        ).status,
        409,
      );
      await f.seed(second, "unmatched");
      const resolvedPreview = await f.json(
        "/api/sppb/import/preview",
        f.upload(matrix(row("0001", "2026-10-01", [4, 4, 4, 12]))),
      );
      assert.equal(resolvedPreview.conflicts, 0);
      const reprocessed = await f.json("/api/sppb/reprocess", {});
      assert.equal(reprocessed.linked, 1);
      assert.equal((await f.json("/api/sppb/review")).unmatchedMembers, 0);
      const xlsx = await f.request(
        "/api/sppb/export?centre=" + centre + "&format=xlsx",
      );
      assert.equal(xlsx.status, 200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
      assert.ok(
        wb.worksheets[0].getRow(1).values.includes("Validated standard total"),
      );
      assert.equal(wb.worksheets[0].rowCount, 4);
      const pdf = await f.request(
        "/api/sppb/export?centre=" + centre + "&format=pdf",
      );
      assert.equal(pdf.status, 200);
      assert.ok((await pdf.text()).includes("Print / Save as PDF"));
      const future = await f.request(
        "/api/sppb/overview?centre=" + centre + "&asOf=2099-01-01",
      );
      assert.equal(future.status, 400);
      const dated = await f.json(
        "/api/sppb/overview?centre=" +
          centre +
          "&from=2026-10-01&to=2026-10-31&status=repeated",
      );
      assert.equal(dated.total, 1);
      // A wrong preview kind cannot write assessments, even with a valid owner.
      await f.control
        .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
        .run(
          "wrong-kind",
          (
            await f.control
              .prepare("SELECT id FROM users WHERE username=?")
              .get("admin")
          ).id,
          Date.now() + 10000,
          JSON.stringify({ kind: "client-registry" }),
        );
      const before = Number(
        (await f.control.prepare("SELECT count(*) n FROM sppb_records").get())
          .n,
      );
      assert.equal(
        (
          await f.request("/api/sppb/import/confirm", {
            id: "wrong-kind",
            confirmed: true,
          })
        ).status,
        400,
      );
      assert.equal(
        Number(
          (await f.control.prepare("SELECT count(*) n FROM sppb_records").get())
            .n,
        ),
        before,
      );
      // Inject a persistence failure after record inserts: the entire import
      // must roll back, and its reviewed preview must remain retryable.
      const rollbackPreview = await f.json(
        "/api/sppb/import/preview",
        f.upload(matrix(row("rollback-only"))),
      );
      if (engine === "PostgreSQL")
        await f.control.query(
          "ALTER TABLE glowbb.sppb_batches ADD CONSTRAINT sppb_test_failure CHECK (id='never') NOT VALID",
        );
      else
        f.control.exec(
          "CREATE TRIGGER sppb_test_failure BEFORE INSERT ON sppb_batches BEGIN SELECT RAISE(ABORT,'Injected test failure'); END",
        );
      assert.equal(
        (
          await f.request("/api/sppb/import/confirm", {
            id: rollbackPreview.id,
            confirmed: true,
          })
        ).status,
        500,
      );
      assert.equal(
        Number(
          (await f.control.prepare("SELECT count(*) n FROM sppb_records").get())
            .n,
        ),
        before,
      );
      if (engine === "PostgreSQL")
        await f.control.query(
          "ALTER TABLE glowbb.sppb_batches DROP CONSTRAINT sppb_test_failure",
        );
      else f.control.exec("DROP TRIGGER sppb_test_failure");
      assert.equal(
        (
          await f.json("/api/sppb/import/confirm", {
            id: rollbackPreview.id,
            confirmed: true,
          })
        ).inserted,
        1,
      );
      for (const c of CENTRES.slice(2)) {
        await f.seed(c.id, "member-" + c.id);
        await f.save(matrix(row("member-" + c.id)));
        const scoped = await f.json("/api/sppb/overview?centre=" + c.id);
        assert.equal(scoped.summary.eligible, 1);
        assert.equal(scoped.summary.assessed, 1);
      }
      if (engine === "PostgreSQL") {
        const privileges = await f.control.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname IN ('sppb_records','sppb_batches','sppb_configuration')",
        );
        assert.ok(privileges.rows.every((r) => r.relrowsecurity));
      }
    } finally {
      await f.close();
    }
  });

for(const engine of ['SQLite','PostgreSQL'])test(`${engine}: 666-record SPPB import uses bulk writes and recovers an already committed receipt`,async()=>{
 const f=await fixture(engine);let bulkCalls=0,lookups=0,failSecond=false;
 const original=f.control.transaction?.bind(f.control);
 if(original)f.control.transaction=(work,options)=>original(async tx=>{
   const query=tx.query.bind(tx),prepare=tx.prepare.bind(tx);
   tx.query=(sql,values)=>{if(sql.startsWith('INSERT INTO glowbb.sppb_records')){bulkCalls++;if(failSecond&&bulkCalls===2)throw Error('Injected second bulk failure');}return query(sql,values);};
   tx.prepare=sql=>{if(/SELECT id FROM sppb_records WHERE id=/.test(sql))lookups++;return prepare(sql);};
   return work(tx);
 },options);
 try{
   const p=await f.json('/api/sppb/import/preview',f.upload(matrix(...Array.from({length:666},(_,i)=>row('bulk-'+i)))));
   if(engine==='PostgreSQL'){
     failSecond=true;assert.equal((await f.request('/api/sppb/import/confirm',{id:p.id,confirmed:true})).status,500);
     assert.equal(Number((await f.control.prepare('SELECT count(*) n FROM sppb_records').get()).n),0);
     assert.ok(await f.control.prepare('SELECT id FROM import_previews WHERE id=?').get(p.id));
     failSecond=false;bulkCalls=0;
   }
   const result=await f.json('/api/sppb/import/confirm',{id:p.id,confirmed:true});assert.equal(result.inserted,666);
   if(engine==='PostgreSQL'){assert.equal(bulkCalls,2);assert.equal(lookups,0);}
   const replay=await f.json('/api/sppb/import/confirm',{id:p.id,confirmed:true});assert.equal(replay.replayed,true);assert.equal(replay.inserted,666);assert.equal(replay.batch,result.batch);
   assert.equal(Number((await f.control.prepare('SELECT count(*) n FROM sppb_records').get()).n),666);
   assert.equal(Number((await f.control.prepare('SELECT count(*) n FROM sppb_batches').get()).n),1);
   const again=await f.save(matrix(...Array.from({length:666},(_,i)=>row('bulk-'+i))));assert.equal(again.result.inserted,0);
 }finally{await f.close();}
});
