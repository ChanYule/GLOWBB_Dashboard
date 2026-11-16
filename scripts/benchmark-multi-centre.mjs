// Reproducible local HTTP comparison; synthetic records, no saved database.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import { centreQaFixture } from "./centre-qa-fixture.mjs";
import { diagnosticFixture } from "../tests/fixtures/programme-diagnostics-state.js";
const state = diagnosticFixture();
function seed(db, centreId) {
  for (const p of state.data.programmes)
    db.prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)").run(
      p.id,
      p.name,
      p.domain,
    );
  for (const s of state.data.sessions)
    db.prepare(
      "INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)",
    ).run(s.id, s.programmeId, s.date, 540, 600);
  for (let group = 0; group < 10; group++) {
    for (const p of state.data.participants) {
      const id = group + "-" + p.id;
      db.prepare("INSERT INTO participants VALUES(?,?)").run(
        id,
        JSON.stringify({ ...p, id }),
      );
    }
    for (const r of state.registry)
      db.prepare("INSERT INTO member_registry VALUES(?,?,?)").run(
        group + "-" + r.participant_id,
        r.snapshot,
        r.details,
      );
    state.data.attendance.forEach((a, i) =>
      db
        .prepare(
          "INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)",
        )
        .run(
          group + "-" + i,
          group + "-" + a.participantId,
          a.sessionId,
          "Synthetic benchmark",
        ),
    );
  }
  db.prepare("UPDATE settings SET value=?").run(
    JSON.stringify({ ...state.settings, ...(centreId ? { centreId } : {}) }),
  );
}
const baseline = openDb(":memory:"),
  old = createApp(baseline),
  fixture = await centreQaFixture();
seed(baseline);
seed(fixture.db, "glow_bukit_batok");
// Open all four workspace stores, but request only the selected centre.
for (const id of ["seen_bukit_batok", "glow_nanyang", "seen_nanyang"])
  await fixture.app.platform.workspaces.get(id);
const servers = [];
try {
  const results = {};
  for (const [label, app, suffix] of [
    ["before", old, ""],
    ["after", fixture.app, "&centre=glow_bukit_batok"],
  ]) {
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise((r) => server.once("listening", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    results[label] = {};
    for (const [name, path] of [
      ["overview", "/api/dashboard?view=overview&interval=month&target=all"],
      ["patterns", "/api/participation-patterns?dimension=age&scope=clients"],
    ]) {
      const samples = [];
      let bytes;
      for (let i = 0; i < 10; i++) {
        const start = performance.now(),
          response = await fetch(origin + path + suffix),
          text = await response.text();
        if (!response.ok) throw Error(label + " " + text);
        bytes = Buffer.byteLength(text);
        if (i >= 3) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      results[label][name] = {
        medianMs: Number(samples[3].toFixed(2)),
        bytes,
        samples: 7,
      };
    }
  }
  const report = {
    syntheticOnly: true,
    environment: "Local Windows Node " + process.version,
    participants: 1000,
    entries: state.data.attendance.length * 10,
    centresOpen: 4,
    method:
      "Same synthetic selected-centre records; legacy createApp versus platform; three warmups, seven HTTP samples. No hosted or concurrent-load claim.",
    results,
  };
  writeFileSync(
    "docs/MULTI-CENTRE-BENCHMARK.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  baseline.close();
  await fixture.close();
}
