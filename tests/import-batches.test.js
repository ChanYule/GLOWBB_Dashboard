import test from "node:test";
import assert from "node:assert/strict";
import { centreQaFixture } from "../scripts/centre-qa-fixture.mjs";
import { HEADERS, hash } from "../server/domain.js";
import { readData } from "../server/db.js";
const csv = (n) =>
  [
    HEADERS.concat("Centres").join(","),
    ...Array.from({ length: n }, (_, i) =>
      [
        "p" + i,
        "MALE",
        65,
        "MALAY",
        "4",
        "Yes",
        "Yes",
        "GLOW Batch Movement",
        "Physical",
        '"2026-11-01, 09:00 AM - 10:00 AM"',
        "Bukit Batok",
      ].join(","),
    ),
  ].join("\r\n");
async function fixture(n = 4501, source, seed) {
  const f = await centreQaFixture(),
    server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = async (path, body) => {
    const r = await fetch(origin + path, {
      method: "POST",
      headers: {
        Origin: origin,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  if (seed) seed(f.db);
  const form = new FormData();
  form.append("file", new Blob([source || csv(n)]), "batch.csv");
  const p = await request("/api/import/preview?mode=merge", form);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return {
    ...f,
    id: p.body.id,
    request,
    step: () =>
      request("/api/import/confirm", {
        id: p.body.id,
        confirmed: true,
        step: true,
      }),
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await f.close();
    },
  };
}
test("bounded import commits progress atomically and a lost response resumes without duplicate attendance", async () => {
  const f = await fixture();
  try {
    const first = await f.step();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.pending, true);
    assert.equal(first.body.processedRows, 2000);
    assert.equal(readData(f.db).attendance.length, 2000);
    const second = await f.step();
    assert.equal(second.body.processedRows, 4000);
    assert.equal(readData(f.db).attendance.length, 4000);
    const final = await f.step();
    assert.equal(final.status, 200, JSON.stringify(final.body));
    assert.equal(final.body.imported, 4501);
    assert.equal(readData(f.db).attendance.length, 4501);
    const retry = await f.step();
    assert.equal(retry.body.imported, 4501);
    assert.equal(readData(f.db).attendance.length, 4501);
    const summaries = f.db
      .prepare("SELECT summary FROM imports")
      .all()
      .map((r) => JSON.parse(r.summary));
    assert.equal(summaries.length, 3);
    assert.equal(
      summaries.reduce((n, s) => n + s.imported, 0),
      4501,
    );
    assert.equal(summaries.at(-1).platformTotals.imported, 4501);
  } finally {
    await f.close();
  }
});
test("a failed batch rolls back only that batch and preserves retry progress; external data changes require fresh review", async () => {
  const f = await fixture();
  try {
    await f.step();
    const target = hash(["p2000"]);
    f.db.exec(
      `CREATE TRIGGER fail_batch BEFORE INSERT ON attendance WHEN NEW.participant_id='${target}' BEGIN SELECT RAISE(ABORT,'batch failure'); END`,
    );
    const failed = await f.step();
    assert.equal(failed.status, 500);
    assert.equal(readData(f.db).attendance.length, 2000);
    f.db.exec("DROP TRIGGER fail_batch");
    f.db.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON import_previews BEGIN SELECT RAISE(ABORT,'progress failure'); END",
    );
    assert.equal((await f.step()).status, 500);
    assert.equal(readData(f.db).attendance.length, 2000);
    assert.equal(f.db.prepare("SELECT count(*) n FROM imports").get().n, 1);
    f.db.exec("DROP TRIGGER fail_progress");
    const retried = await f.step();
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.processedRows, 4000);
    const p = f.db
      .prepare("SELECT details FROM participants WHERE id=?")
      .get(hash(["p0"]));
    f.db
      .prepare("UPDATE participants SET details=? WHERE id=?")
      .run(JSON.stringify({ ...JSON.parse(p.details), age: 66 }), hash(["p0"]));
    const stale = await f.step();
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /changed between batches/);
    assert.equal(readData(f.db).attendance.length, 4000);
  } finally {
    await f.close();
  }
});

test("batched merge matches whole-file profile precedence, blank retention and session classifications", async () => {
  const rows = Array.from({ length: 4501 }, (_, i) =>
    [
      "p" + (i % 1000),
      "MALE",
      i % 1000 === 0 ? (i === 2000 ? "" : 65 + i / 1000) : 65,
      "MALAY",
      "4",
      "Yes",
      "Yes",
      "GLOW Batch Movement",
      "Physical",
      `"2026-11-0${1 + Math.floor(i / 1000)}, 09:00 AM - 10:00 AM"`,
      i === 0 ? "Alone" : "",
      i === 0 ? "Cognitive" : "Social",
      "Bukit Batok",
    ].join(","),
  );
  const source = [
    HEADERS.concat(
      "Name/Current Living Arrangement",
      "Activity Name/Event Type",
      "Centres",
    ).join(","),
    ...rows,
  ].join("\r\n");
  const f = await fixture(4501, source),
    whole = await fixture(4501, source);
  try {
    let step;
    do {
      step = await f.step();
      assert.equal(step.status, 200, JSON.stringify(step.body));
    } while (step.body.pending);
    const single = await whole.request("/api/import/confirm", {
      id: whole.id,
      confirmed: true,
    });
    assert.equal(single.status, 200, JSON.stringify(single.body));
    assert.equal(step.body.imported, single.body.imported);
    const a = readData(f.db),
      b = readData(whole.db),
      profile = (data) =>
        data.participants
          .map(({ id, age, cfs, livingRaw }) => ({ id, age, cfs, livingRaw }))
          .sort((x, y) => x.id.localeCompare(y.id));
    assert.deepEqual(profile(a), profile(b));
    assert.deepEqual(a.attendance, b.attendance);
    assert.deepEqual(
      a.sessions.map((s) => s.optional),
      b.sessions.map((s) => s.optional),
    );
    assert.equal(a.participants.find((p) => p.id === hash(["p0"])).age, 69);
    assert.equal(
      a.participants.find((p) => p.id === hash(["p0"])).livingRaw,
      "Alone",
    );
  } finally {
    await f.close();
    await whole.close();
  }
});

test("observations from skipped rows survive when their participant is first inserted in a later batch", async () => {
  const rejected = [
    "p0",
    "MALE",
    65,
    "MALAY",
    "5",
    "Yes",
    "Yes",
    "GLOW Batch Movement",
    "Physical",
    '"2026-11-01, 09:00 AM - 10:00 AM"',
    "Alone",
    "earlier-source",
    "Bukit Batok",
  ].join(",");
  const allowed = [
    "p0",
    "MALE",
    65,
    "MALAY",
    "4",
    "Yes",
    "Yes",
    "GLOW Allowed",
    "Physical",
    '"2026-11-02, 09:00 AM - 10:00 AM"',
    "",
    "later-source",
    "Bukit Batok",
  ].join(",");
  const source = [
    HEADERS.concat(
      "Name/Current Living Arrangement",
      "Name/Social Risk Factor(s)",
      "Centres",
    ).join(","),
    ...Array(2000).fill(rejected),
    allowed,
  ].join("\r\n");
  const f = await fixture(2001, source, (db) =>
    db
      .prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)")
      .run(hash(["GLOW Batch Movement"]), "GLOW Batch Movement", "Learning"),
  );
  try {
    const first = await f.step();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.pending, true);
    assert.equal(readData(f.db).participants.length, 0);
    const last = await f.step();
    assert.equal(last.status, 200, JSON.stringify(last.body));
    assert.equal(last.body.imported, 1);
    assert.equal(last.body.centres.glow_bukit_batok.skipped, 2000);
    assert.deepEqual(
      f.db
        .prepare("SELECT raw FROM risk_observations ORDER BY raw")
        .all()
        .map((r) => r.raw),
      ["earlier-source", "later-source"],
    );
    assert.ok(
      f.db
        .prepare(
          "SELECT id FROM profile_observations WHERE field='livingRaw' AND raw='Alone'",
        )
        .get(),
    );
  } finally {
    await f.close();
  }
});
