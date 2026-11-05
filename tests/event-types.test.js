import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  HEADERS,
  parseRows,
  readFile,
  inspectImport,
  defaults,
} from "../server/domain.js";
import {
  parseEventTypes,
  sessionEventTypes,
  EVENT_TYPE_HEADER,
} from "../server/event-types.js";
import { eventTypeReport } from "../server/event-report.js";
import { openDb, readData, saveImport } from "../server/db.js";
import { createApp } from "../server/app.js";
import { locationFixture } from "./fixtures/location-state.js";
const row = (
  id,
  day = "01",
  type = "Social & Cognitive, Learning",
  pg = "Programme A",
) => [
  id,
  "MALE",
  "75",
  "MALAY",
  "1-3",
  "YES",
  "YES",
  pg,
  "Physical",
  `2026-10-${day}, 09:00 AM - 10:00 AM`,
  type,
];
const parsed = (rows) => parseRows([[...HEADERS, EVENT_TYPE_HEADER], ...rows]);
function fixture() {
  const db = openDb(":memory:"),
    app = createApp(db),
    actor = db
      .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
      .get().id;
  return {
    db,
    app,
    actor,
    save(p, mode = "merge") {
      p.mode = mode;
      return saveImport(db, p, inspectImport(p, readData(db)), actor);
    },
    state() {
      return {
        data: readData(db),
        settings: defaults,
        registry: [],
        profiles: [],
        feedback: [],
      };
    },
  };
}
test("Event Type parser preserves combined ampersand labels, literal raw source, empty values and exact duplicate identity", () => {
  assert.deepEqual(
    parseEventTypes(" Social & Cognitive, Learning, Learning , "),
    ["Social & Cognitive", "Learning"],
  );
  const p = parsed([
    row("a"),
    row("a"),
    row("a", "02", "Social & Volunterism"),
  ]);
  assert.equal(p.exactDuplicates, 1);
  assert.equal(
    p.rows[0].session.optional.eventTypeRaw,
    "Social & Cognitive, Learning",
  );
  assert.deepEqual(p.rows[2].session.optional.eventTypes, [
    "Social & Volunterism",
  ]);
  assert.equal(
    parseRows([HEADERS, row("a").slice(0, 10)]).rows[0].session.optional,
    undefined,
  );
});
test("reviewed metadata merges enrich duplicate attendance without changing identities or rewriting other historical sessions", () => {
  const f = fixture();
  try {
    f.save(parseRows([HEADERS, row("a").slice(0, 10)]));
    const before = readData(f.db);
    const incoming = parsed([row("a"), row("a", "02", "Physical & Cognitive")]);
    const result = f.save(incoming);
    assert.equal(result.imported, 1);
    assert.equal(result.updatedSessions, 1);
    const after = readData(f.db);
    assert.equal(after.participants.length, 1);
    assert.equal(after.attendance.length, 2);
    assert.equal(after.sessions[0].id, before.sessions[0].id);
    assert.equal(after.sessions[0].optional.eventTypeHistory[0].raw, null);
    assert.deepEqual(
      after.sessions.map((s) => s.optional.eventTypes),
      [["Social & Cognitive", "Learning"], ["Physical & Cognitive"]],
    );
    f.save(parsed([row("a", "01", "Cognitive")]), "add");
    assert.equal(
      readData(f.db).sessions[0].optional.eventTypeRaw,
      "Social & Cognitive, Learning",
    );
    f.save(parsed([row("a", "01", "")]));
    assert.equal(
      readData(f.db).sessions[0].optional.eventTypeRaw,
      "Social & Cognitive, Learning",
    );
  } finally {
    f.db.close();
  }
});
test("conflicting classifications within a session remain unknown and preserve the conflicting source values", () => {
  const f = fixture();
  try {
    const p = parsed([row("a", "01", "Learning"), row("b", "01", "Cognitive")]);
    const i = inspectImport(p, readData(f.db));
    assert.ok(
      i.warnings.some((w) => w.message.includes("Conflicting Event Types")),
    );
    assert.equal(p.rows[0].session.optional.eventTypeRaw, "Learning");
    f.save(p);
    const s = readData(f.db).sessions[0];
    assert.deepEqual(s.optional.eventTypes, []);
    assert.deepEqual(s.optional.eventTypeConflicts, ["Learning", "Cognitive"]);
  } finally {
    f.db.close();
  }
});
test("overlapping mix and matrix use distinct sessions, programmes and participants; repeat opportunity excludes one-off programmes", () => {
  const f = fixture();
  try {
    f.save(
      parsed(
        Array.from({ length: 10 }, (_, i) => [
          row("p" + i),
          row("p" + i, "02"),
          row("p" + i, "03", "Learning", "One-off"),
        ]).flat(),
      ),
    );
    const r = eventTypeReport(f.state());
    assert.equal(r.total.unique, 10);
    assert.equal(r.total.sessions, 3);
    assert.equal(r.types.find((t) => t.label === "Learning").sessions, 3);
    assert.equal(r.types.find((t) => t.label === "Learning").unique, 10);
    assert.equal(
      r.types.find((t) => t.label === "Social & Cognitive").sessions,
      2,
    );
    assert.equal(r.types.find((t) => t.label === "Learning").repeat, 10);
    assert.equal(
      r.types.find((t) => t.label === "Learning").multiProgramme,
      10,
    );
    assert.equal(
      r.matrix.find((c) => c.domain === "Physical" && c.label === "Learning")
        .sessions,
      3,
    );
    const once = eventTypeReport(f.state(), {
      eventType: "Learning",
      programme: readData(f.db).programmes.find((p) => p.name === "One-off").id,
    });
    assert.equal(once.total.repeat, 0);
    assert.equal(once.total.opportunity, 0);
    assert.equal(once.total.repeatRate, null);
    assert.equal(r.rankings.rows.length, 2);
    assert.equal(r.findings.length <= 5, true);
  } finally {
    f.db.close();
  }
});
test("client denominators include nonattenders; one selected characteristic uses full-history protection and unknown values stay unknown", () => {
  const f = fixture();
  try {
    f.save(parsed(Array.from({ length: 10 }, (_, i) => row("p" + i))));
    const state = f.state();
    state.settings = {
      ...defaults,
      registry: { complete: true, type: "clients", asOf: "2026-10-01" },
    };
    state.registry = state.data.participants.map((p) => ({
      participant_id: p.id,
      snapshot: "clients",
      details: JSON.stringify({
        isClient: true,
        memberId: p.id,
        age: 75,
        gender: "MALE",
        race: "MALAY",
      }),
    }));
    const r = eventTypeReport(state, {
      scope: "overall",
      factor: "age",
      group: "80 and above",
    });
    assert.ok(r.types.every((t) => t.unique === 0 || t.unique === null));
    const small = structuredClone(state);
    small.data.participants[0].age = 85;
    assert.ok(
      eventTypeReport(small, {
        factor: "age",
        group: "80 and above",
      }).types.every((t) => t.suppressed),
    );
    assert.throws(
      () => eventTypeReport(state, { factor: "injected" }),
      /supported/,
    );
    assert.throws(
      () => eventTypeReport(state, { from: "2026-10-15", to: "2026-10-01" }),
      /reversed/,
    );
  } finally {
    f.db.close();
  }
});
test("administrator mappings require preview and review, preserve raw labels, reject stale changes and protect exports/preferences", async () => {
  const f = fixture();
  f.save(
    parsed(
      Array.from({ length: 10 }, (_, i) =>
        row("p" + i, "01", "Social & Volunterism"),
      ),
    ),
  );
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const req = async (path, body, method = body ? "POST" : "GET") => {
    const r = await fetch(origin + path, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    const source = (await req("/api/event-types/mappings")).body;
    assert.equal(source.rows[0].review, true);
    const draft = (
      await req("/api/event-types/mappings/preview", {
        rows: [
          {
            raw: "Social & Volunterism",
            label: "Social & Volunteerism",
            parent: "Community",
            secondary: "Volunteering",
          },
        ],
      })
    ).body;
    assert.equal(
      (
        await req("/api/event-types/mappings/confirm", {
          id: draft.id,
          reviewed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/api/event-types/mappings/confirm", {
          id: draft.id,
          reviewed: true,
        })
      ).status,
      200,
    );
    const settings = JSON.parse(
      f.db.prepare("SELECT value FROM settings").get().value,
    );
    assert.deepEqual(sessionEventTypes(readData(f.db).sessions[0], settings), [
      "Social & Volunteerism",
    ]);
    assert.equal(
      readData(f.db).sessions[0].optional.eventTypeRaw,
      "Social & Volunterism",
    );
    assert.equal(
      (
        await req("/api/event-types/mappings/confirm", {
          id: draft.id,
          reviewed: true,
        })
      ).status,
      409,
    );
    const r = (await req("/api/event-types/report")).body,
      e = (await req("/api/event-types/export")).body;
    assert.deepEqual(e.types, r.types);
    assert.equal((await req("/api/event-types/export?factor=cfs")).status, 403);
    assert.equal(
      (
        await req(
          "/api/event-types/preferences",
          { eventType: "Social & Volunteerism", target: "senior" },
          "PUT",
        )
      ).status,
      200,
    );
    const pref = (await req("/api/preferences")).body;
    assert.equal(pref.eventTypes.eventType, "Social & Volunteerism");
    assert.equal(JSON.stringify(r).includes("participantId"), false);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    f.db.close();
  }
});
const workbook =
  "C:/Users/CHANYULE/Downloads/member_attendances_20261105093446.xlsx";
test("complete registry coverage retains 50 nonattenders and supplies exact Event Type rate denominators", () => {
  const s = locationFixture();
  for (const session of s.data.sessions)
    session.optional = { eventTypeRaw: "Learning", eventTypes: ["Learning"] };
  const r = eventTypeReport(s, { scope: "clients", target: "all" });
  assert.equal(r.registered, 100);
  assert.equal(r.types[0].unique, 50);
  assert.equal(r.types[0].rate, 50);
  assert.equal(r.total.unique, 50);
  const c = eventTypeReport(s, {
    scope: "clients",
    target: "all",
    factor: "cfs",
    group: "CFS 4",
  });
  assert.equal(c.registered, 100);
  assert.equal(c.types[0].rate, 50);
});
test(
  "supplied 14-column workbook independently reconciles domain/type overlap and all reference totals",
  { skip: !existsSync(workbook) },
  async () => {
    const p = await readFile(readFileSync(workbook), workbook),
      f = fixture();
    try {
      assert.equal(p.rawRows, 3429);
      assert.equal(p.exactDuplicates, 1);
      f.save(p);
      const data = readData(f.db);
      assert.equal(data.attendance.length, 3428);
      assert.equal(data.participants.length, 417);
      assert.equal(data.programmes.length, 118);
      assert.equal(data.sessions.length, 357);
      const r = eventTypeReport(f.state());
      for (const [label, count] of Object.entries({
        "Social & Cognitive": 151,
        Learning: 145,
        Social: 55,
        Physical: 55,
        "Cognitive & Learning": 45,
      }))
        assert.equal(r.types.find((t) => t.label === label).sessions, count);
      for (const [domain, label, count] of [
        ["Physical", "Learning", 77],
        ["Physical", "Social & Cognitive", 69],
        ["Learning", "Social & Cognitive", 54],
      ])
        assert.equal(
          r.matrix.find((c) => c.domain === domain && c.label === label)
            .sessions,
          count,
        );
      assert.equal(
        new Set(data.sessions.map((s) => s.optional.eventTypeRaw)).size,
        20,
      );
      const changed = data.programmes.filter(
        (pg) =>
          new Set(
            data.sessions
              .filter((s) => s.programmeId === pg.id)
              .map((s) => s.optional.eventTypeRaw),
          ).size > 1,
      );
      assert.equal(changed.length, 1);
    } finally {
      f.db.close();
    }
  },
);
