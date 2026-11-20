// Repeatable synthetic, in-memory API/bundle measurements. No browser timings
// or hosted claims; no saved workspaces or personal data are read or changed.
import {
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { centreQaFixture } from "./centre-qa-fixture.mjs";
import {
  HEADERS,
  parseRows,
  inspectImport,
  hash,
  defaults,
} from "../server/domain.js";
import { readData, saveImport } from "../server/db.js";
import { CLIENT_SNAPSHOT } from "../server/client-domain.js";
import { tsImport } from "tsx/esm/api";
import {parseSppb,sppbHeaders} from '../server/sppb-domain.js';
const f = await centreQaFixture();
const actor = f.control
  .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
  .get().id;
const source = [];
for (let month = 1; month <= 10; month++)
  for (let day = 1; day <= 21; day += 4)
    for (let n = 0; n < 40; n++) {
      const person = (n + day * 7 + month * 11) % 300;
      source.push([
        "QA-" + person,
        person % 3 ? "FEMALE" : "MALE",
        60 + (person % 30),
        person % 4 ? "CHINESE" : "MALAY",
        "4",
        "YES",
        "YES",
        "Programme " + ((day + month) % 24),
        "Physical",
        `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}, 09:00 AM - 10:00 AM`,
      ]);
    }
const parsed = parseRows([HEADERS, ...source]);
saveImport(f.db, parsed, inspectImport(parsed, readData(f.db)), actor);
for (let n = 0; n < 400; n++) {
  const id = hash(["QA-" + n]);
  f.db
    .prepare("INSERT OR IGNORE INTO participants VALUES(?,?)")
    .run(id, JSON.stringify({ age: 60 + (n % 30), client: true, cfs: "4" }));
  f.db
    .prepare("INSERT INTO member_registry VALUES(?,?,?)")
    .run(
      id,
      CLIENT_SNAPSHOT,
      JSON.stringify({
        memberId: "QA-" + n,
        age: 60 + (n % 30),
        cfs: "4",
        client: true,
        membershipStatus: "Active",
      }),
    );
}
f.db
  .prepare("UPDATE settings SET value=? WHERE id=1")
  .run(
    JSON.stringify({
      ...defaults,
      centreId: "glow_bukit_batok",
      registry: {
        type: "clients",
        snapshot: CLIENT_SNAPSHOT,
        complete: true,
        asOf: "2026-11-19",
      },
    }),
  );
const assessments=parseSppb([sppbHeaders,...Array.from({length:666},(_,i)=>['QA-'+(i%400),i<400?'2026-04-01':'2026-10-01',2,2,i%5,4+i%5])]);
for(const record of assessments.rows)f.control.prepare('INSERT INTO sppb_records VALUES(?,?,?)').run(record.id,record.memberKey,JSON.stringify(record));
const server = f.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port,
  centre = "centre=glow_bukit_batok";
const paths = [
  "/api/me",
  "/api/dashboard?view=context&" + centre,
  "/api/dashboard?view=overview&" + centre,
  "/api/dashboard?" + centre,
  "/api/reporting/briefing?" + centre,
  "/api/programme-domains/report?" + centre,
  "/api/participation-patterns?scope=clients&dimension=age&" + centre,
  "/api/sppb/overview?" + centre,
];
try {
  const api = [];
  for (const path of paths) {
    const times = [];
    let bytes;
    for (let i = 0; i < 10; i++) {
      const start = performance.now(),
        res = await fetch(origin + path),
        body = await res.text();
      if (!res.ok) throw Error(path + ": " + res.status + " " + body);
      if (i) {
        times.push(performance.now() - start);
      }
      bytes = Buffer.byteLength(body);
    }
    times.sort((a, b) => a - b);
    api.push({
      path,
      samples: times.length,
      medianMs: +times[4].toFixed(2),
      p95Ms: +times.at(-1).toFixed(2),
      bytes,
    });
  }
  const {
    api: clientApi,
    setCentreContext,
    invalidateReadCache,
  } = await tsImport("../src/api.ts", import.meta.url);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const clientReuse = [];
  try {
    setCentreContext({
      id: "glow_bukit_batok",
      name: "GLOW Bukit Batok",
      location: "Bukit Batok",
      classification: "GLOW",
    });
    globalThis.fetch = (path, options) => {
      calls++;
      return originalFetch(origin + path, options);
    };
    for(const readPath of ['/api/dashboard?view=overview','/api/sppb/overview'])for (const reuse of [false, true]) {
      invalidateReadCache();
      calls = 0;
      const timings = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await clientApi(readPath, {
          reuseForMs: reuse ? 15000 : 0,
        });
        timings.push(performance.now() - start);
      }
      const warm = timings.slice(1).sort((a, b) => a - b);
      clientReuse.push({
        path:readPath,
        mode: reuse ? "15-second isolated reuse" : "uncached control",
        calls: 5,
        networkRequests: calls,
        warmMedianMs: +((warm[1] + warm[2]) / 2).toFixed(3),
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    setCentreContext(null);
  }
  const assets = existsSync("dist/assets")
    ? readdirSync("dist/assets")
        .filter((n) => /\.(css|js)$/.test(n))
        .map((name) => {
          const path = "dist/assets/" + name;
          return {
            name,
            bytes: statSync(path).size,
            gzipBytes: gzipSync(readFileSync(path)).length,
          };
        })
    : [];
  const result = {
    generatedAt: new Date().toISOString(),
    fixture: {
      sourceRows: source.length,
      registry: 400,
      assessments:assessments.rows.length,
      centre: "glow_bukit_batok",
    },
    environment:
      "Local loopback, SQLite in-memory, synthetic data; excludes browser render, initial API count, navigation, network and hosted latency.",
    api,
    clientReuse,
    bundle: {
      entry: assets.filter((a) => /^index-.*\.js$/.test(a.name)),
      javascript: assets
        .filter((a) => a.name.endsWith(".js"))
        .reduce((n, a) => n + a.bytes, 0),
      css: assets
        .filter((a) => a.name.endsWith(".css"))
        .reduce((n, a) => n + a.bytes, 0),
    },
  };
  const output = process.argv[2];
  if (output) writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await f.close();
}
