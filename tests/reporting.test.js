import test from "node:test";
import assert from "node:assert/strict";
import { openDb, readData, saveImport } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  analytics,
  analyticsContext,
  defaults,
  HEADERS,
  inspectImport,
  parseRows,
} from "../server/domain.js";
import {
  registryHeaders,
  parseClientRegistry,
} from "../server/client-domain.js";

function fixture() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
    "fixture",
    "disabled",
    "admin",
  );
  const parsed = parseRows([
    HEADERS,
    ...Array.from({ length: 12 }, (_, i) => [
      `source-person-${i}`,
      i % 2 ? "FEMALE" : "MALE",
      "75",
      i % 2 ? "CHINESE" : "MALAY",
      "1-3",
      "YES",
      "YES",
      "Games",
      "Social",
      "2026-10-20, 09:00 AM - 10:00 AM",
    ]),
  ]);
  parsed.mode = "merge";
  saveImport(db, parsed, inspectImport(parsed, readData(db)), 1);
  return db;
}
test("lean overview and context preserve exact counts and prior comparisons without detailed programme data", () => {
  const db = fixture();
  try {
    const data = readData(db),
      f = { from: "2026-10-01", to: "2026-10-31", interval: "month" };
    const full = analytics(data, defaults, f, "2026-11-04"),
      lean = analytics(data, defaults, f, "2026-11-04", "overview"),
      context = analyticsContext(data, defaults, f, "2026-11-04");
    assert.deepEqual(lean.summary, full.summary);
    assert.deepEqual(lean.previous, full.previous);
    assert.deepEqual(lean.trends, full.trends);
    assert.deepEqual(lean.domains, full.domains);
    assert.deepEqual(context.summary, full.summary);
    assert.deepEqual(context.coverage, full.coverage);
    assert.equal(lean.programmes[0].unique, full.programmes[0].unique);
    assert.deepEqual(lean.programmes[0].sessionList, []);
    assert.deepEqual(context.programmes, []);
    assert.ok(JSON.stringify(lean).length < JSON.stringify(full).length);
    for (const filters of [
      {},
      { gender: "MALE" },
      { programme: "absent" },
      { from: "2026-11-01" },
    ]) {
      const selected = analytics(
        data,
        defaults,
        filters,
        "2026-11-04",
        true,
        true,
      );
      assert.equal(
        selected.size,
        analytics(data, defaults, filters, "2026-11-04", true).summary.allAges,
      );
    }
  } finally {
    db.close();
  }
});
test("both explicit registry header formats preserve exact IDs, blocks and duplicate header safeguards", () => {
  const headers = Object.values(registryHeaders),
    row = [
      "001-A",
      "MALE",
      "Alone",
      "75",
      "MALAY",
      "1-3",
      "0",
      "Yes",
      "Yes",
      "012A",
    ];
  const plain = parseClientRegistry([headers, row]);
  const prefixed = parseClientRegistry([
    headers.map((h) =>
      [
        "Member ID",
        "Age",
        "Race",
        "CFS",
        "Current Living Arrangement",
        "Social Risk Factor(s)",
        "Block / Building No.",
      ].includes(h)
        ? "Name/" + h
        : h,
    ),
    row,
  ]);
  assert.deepEqual(prefixed, plain);
  assert.equal(plain.rows[0].memberId, "001-A");
  assert.equal(plain.rows[0].blockRaw, "012A");
  assert.throws(
    () =>
      parseClientRegistry([
        [...headers, "Name/Member ID"],
        [...row, "001-A"],
      ]),
    /unique/,
  );
});
test("management briefing is read-only and excludes identities, clinical distributions and action notes", async () => {
  const db = fixture(),
    app = createApp(db, { authRequired: false });
  db.prepare("INSERT INTO needs_actions VALUES(?,?,?,?,?,?,?)").run(
    "action",
    "planning",
    1,
    JSON.stringify({
      status: "Approved",
      title: "source-person-0",
      notes: "private clinical note",
      owner: "private owner",
    }),
    "2026-11-04",
    "2026-11-04",
    1,
  );
  const before = JSON.stringify(readData(db));
  db.prepare("INSERT INTO decisions VALUES(?,?,?,?,?)").run(readData(db).programmes[0].id,"Review","PRIVATE DECISION NOTE","2026-11-04",1);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + "/api/reporting/briefing"),
      b = await r.json();
    assert.equal(r.status, 200);
    assert.equal(b.actions.total, 1);
    assert.equal(b.actions.stages.Approved, 1);
    const serialized = JSON.stringify(b);
    for (const privateValue of [
      "source-person-0",
      "private clinical note",
      "private owner",
      "livingRaw",
      "riskRaw",
      "memberId",
      "cfs",
    ])
      assert.equal(serialized.includes(privateValue), false);
    assert.equal(JSON.stringify(readData(db)), before);
    for(const view of ["overview","context"]){
      const lean=await (await fetch(base+"/api/dashboard?view="+view)).json();
      assert.deepEqual(lean.decisions,[]);
      assert.equal(JSON.stringify(lean).includes("PRIVATE DECISION NOTE"),false);
    }
    assert.equal(db.prepare("SELECT notes FROM decisions").get().notes,"PRIVATE DECISION NOTE");
    assert.equal(
      (await fetch(base + "/api/reporting/briefing?cfs=1-3")).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/reporting/briefing?from=bad-date")).status,
      400,
    );
    const filtered = await (
      await fetch(base + "/api/reporting/briefing?gender=MALE")
    ).json();
    assert.equal(filtered.clients, null);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});
