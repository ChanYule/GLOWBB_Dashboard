import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { createPlatformApp } from "../server/platform.js";
import { createProxy } from "../api/index.js";
import { CLIENT_SNAPSHOT } from "../server/client-domain.js";
import { readFileSync } from "node:fs";
import { reportingSpec } from "../server/management-reporting.js";

const centre = "glow_bukit_batok";
const key = "synthetic-integration-test-key-012345";
test("Management Hub reporting is scoped, read-only, privacy-protected and consistent with dashboard counts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "glowbb-reporting-"));
  const db = openDb(":memory:");
  const app = createPlatformApp(db, {
    directory,
    authRequired: true,
    managementReporting: { key, centres: centre, scores: true },
  });
  await app.platform.ready;
  // An authorized request checks availability without creating workspaces.
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const req = (path, token = key, method = "GET") =>
    fetch(origin + "/api/reporting/v1/" + path, {
      method,
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
  const get = async (path) => {
    const response = await req(path);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  let ws;
  try {
    assert.equal((await req("health", "")).status, 401);
    assert.equal((await req("health", "wrong")).status, 401);
    assert.equal((await req("health", key, "POST")).status, 405);
    assert.equal((await req("health?centre=seen_bukit_batok")).status, 403);
    assert.equal((await get("health")).workspaceAvailable, false);
    assert.equal((await req("hart")).status, 404);
    assert.equal(
      (await req("summary?year=2025&month=02&quarter=1")).status,
      400,
    );
    assert.equal(
      (await req("summary?from=2025-02-30&to=2025-03-01")).status,
      400,
    );
    assert.equal((await req("summary?year=2025&year=2026")).status, 400);
    assert.equal((await req("membership?programme=fitness")).status, 400);
    ws = await app.platform.workspaces.get(centre);
    ws.prepare(
      "INSERT INTO programmes(id,name,domain) VALUES('fitness','Synthetic fitness','Physical'),('rare','Synthetic small group','Social')",
    ).run();
    for (const [id, day, programme, label] of [
      ["first", "2025-01-01", "fitness", "Fitness"],
      ["second", "2025-02-02", "fitness", "Fitness"],
      ["other", "2025-02-04", "rare", "Social gathering"],
    ])
      ws.prepare("INSERT INTO sessions VALUES(?,?,?,600,660,NULL,?)").run(
        id,
        programme,
        day,
        JSON.stringify({ eventTypes: [label] }),
      );
    for (let i = 0; i < 10; i++) {
      const pid = "private-person-" + i;
      ws.prepare("INSERT INTO participants VALUES(?,?)").run(
        pid,
        JSON.stringify({
          age: 66,
          gender: "FEMALE",
          race: "CHINESE",
          memberId: pid,
          phone: "12345678",
        }),
      );
      for (const session of ["first", "second", ...(i === 0 ? ["other"] : [])])
        ws.prepare(
          "INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)",
        ).run(pid + session, pid, session, session);
    }
    const user = ws
      .prepare(
        "INSERT INTO users(username,password,role) VALUES('test','disabled','viewer')",
      )
      .run().lastInsertRowid;
    ws.prepare(
      "INSERT INTO assessment_monthly(fingerprint,month,type,total,reported_as_of,complete,created,user_id) VALUES('sample','2025-02','TANITA',0,'2025-02-28',1,'2025-03-01T00:00:00Z',?)",
    ).run(user);
    ws.prepare(
      "INSERT INTO targets(metric,value,start,end) VALUES('unique',20,'2025-02-01','2025-02-28')",
    ).run();
    const stats = await get("summary?year=2025&month=02");
    assert.equal(stats.metrics.attendance.value, 11);
    assert.equal(stats.metrics.unique.value, 10);
    assert.equal(stats.metrics.returning.value, 10);
    assert.equal(stats.previous.from, "2025-01-04"); // Equal 28-day period
    assert.equal(stats.previous.metrics.attendance.value, 0);
    const yearly = await get("trends?year=2025&grain=year");
    assert.equal(yearly.rows[0].metrics.unique.value, 10);
    assert.equal(yearly.rows[0].metrics.attendance.value, 21);
    const programmes = await get("programmes?year=2025");
    assert.equal(programmes.rows.length, 1);
    assert.deepEqual(programmes.rows[0].subdomains, ["Fitness"]);
    assert.equal((await get("fitness?year=2025")).metrics.attendance.value, 20);
    const suppressed = await get("summary?year=2025&programme=rare");
    assert.equal(suppressed.metrics.allAges.status, "suppressed");
    assert.equal(suppressed.metrics.attendance.value, null);
    assert.equal(
      (await get("summary?year=2024")).metrics.attendance.status,
      "missing",
    );
    const health = await get("health-assessments?year=2025&month=02");
    assert.equal(health.assessments.TANITA.metrics.reportedTotal.value, 0);
    assert.equal(
      health.assessments.SPPB.metrics.reportedTotal.status,
      "missing",
    );
    assert.equal(health.assessments.SPPB.linked.coverage.value, null);
    const settings = JSON.parse(
      ws.prepare("SELECT value FROM settings WHERE id=1").get().value,
    );
    settings.registry = {
      type: "clients",
      snapshot: CLIENT_SNAPSHOT,
      complete: true,
      asOf: "2025-02-04",
    };
    ws.prepare("UPDATE settings SET value=? WHERE id=1").run(
      JSON.stringify(settings),
    );
    db.prepare("UPDATE sppb_configuration SET details=? WHERE id=1").run(
      JSON.stringify({
        definitions: [
          {
            sourceDefinition: "Verified",
            version: "standard-v1",
            method: "identity",
            approved: true,
          },
        ],
      }),
    );
    for (let i = 0; i < 10; i++) {
      const id = "private-person-" + i;
      ws.prepare("INSERT INTO member_registry VALUES(?,?,?)").run(
        id,
        CLIENT_SNAPSHOT,
        JSON.stringify({
          client: true,
          memberId: id,
          registrationDate: "2025-01-01",
        }),
      );
      if (i < 5) {
        for (const [date, score] of [
          ["2025-01-01", 3],
          ["2025-02-01", 4],
        ]) {
          db.prepare("INSERT INTO sppb_records VALUES(?,?,?)").run(
            id + date,
            id,
            JSON.stringify({
              date,
              memberId: id,
              sourceDefinition: "Verified",
              warnings: [],
              original: {
                balance: score,
                gait: score,
                chair: score,
                total: 3 * score,
              },
            }),
          );
        }
      }
    }
    // A separate scope bypasses the short aggregate cache for the first read of the new records.
    const linked = (
      await get("health-assessments?year=2025&assessmentType=SPPB")
    ).assessments.SPPB.linked;
    assert.equal(linked.records.value, 10);
    assert.equal(linked.coverage.value, 50);
    assert.equal(linked.coverage.denominator, 10);
    assert.equal(linked.increased.value, 5);
    assert.equal(linked.baselineScore.value, 9);
    assert.equal(linked.baselineLatestScore.value, 12);
    assert(!JSON.stringify(linked).includes("private-person-"));
    assert.equal(
      (await get("membership?year=2025")).metrics.newMembers.value,
      10,
    );
    const historicalRegistry = await get("membership?year=2025&month=1");
    assert.equal(historicalRegistry.metrics.newMembers.value, 10);
    assert.equal(historicalRegistry.metrics.registered.status, "missing");
    const kpis = await get("kpis?year=2025");
    assert.equal(kpis.rows[0].metrics.attainment.value, 50);
    const datasets = await get("datasets");
    assert(datasets.datasets.some((dataset) => dataset.id === "fitness"));
    assert(!datasets.datasets.some((dataset) => dataset.id === "hart"));
    assert(
      !JSON.stringify([stats, programmes, health, datasets]).includes(
        "private-person-",
      ),
    );
  } finally {
    server.close();
    await once(server, "close");
    ws?.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("OpenAPI covers every reporting route and its supported query filters", () => {
  const spec = JSON.parse(
    readFileSync(
      new URL("../docs/management-hub-openapi.json", import.meta.url),
    ),
  );
  assert.deepEqual(
    Object.keys(spec.paths).sort(),
    ["health", "datasets", ...Object.keys(reportingSpec.endpoints)]
      .map((id) => "/" + id)
      .sort(),
  );
  for (const [id, definition] of Object.entries(reportingSpec.endpoints))
    assert.deepEqual(
      spec.paths["/" + id].parameters.map(
        (p) => p.name || p.$ref.split("/").at(-1),
      ),
      ["centre", ...definition.filters],
    );
});

test("Vercel proxy forwards the reporting credential only to the versioned reporting namespace", async () => {
  const actual = [];
  const handler = createProxy({
    backendUrl: "https://backend.example",
    fetchImpl: async (url, { headers }) => {
      actual.push([url.pathname, headers.get("authorization")]);
      return Response.json({});
    },
  });
  const server = (await import("node:http"))
    .createServer(handler)
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const endpoint of [
      "/api/reporting/v1/health",
      "/api/reporting/briefing",
      "/api/me",
    ])
      await (
        await fetch("http://127.0.0.1:" + server.address().port + endpoint, {
          headers: { Authorization: "Bearer " + key },
        })
      ).json();
    assert.deepEqual(actual, [
      ["/api/reporting/v1/health", "Bearer " + key],
      ["/api/reporting/briefing", null],
      ["/api/me", null],
    ]);
  } finally {
    server.close();
    await once(server, "close");
  }
});
