import test from "node:test";
import assert from "node:assert/strict";
import {
  dataQualitySummary,
  dataQualityReport,
  fieldKnown,
} from "../server/data-quality.js";
import { registrationContext } from "../shared/registration-context.js";
import { diagnosticFixture } from "./fixtures/programme-diagnostics-state.js";
import {
  participationPatterns,
  validatePatternQuery,
} from "../server/patterns.js";
import { clientPopulation } from "../server/client-domain.js";
import { createApp } from "../server/app.js";
import { openDb, passwordHash } from "../server/db.js";
import { analysisMetadata } from "../server/analysis-metadata.js";

test("source update stamps compare UTC instants and never use report generation as a data update", async () => {
  const db = {
    prepare: () => ({
      all: () => [
        { kind: "import", stamp: "2026-11-06 05:00:00" },
        { kind: "profile", stamp: "2026-11-06T04:00:00.000Z" },
      ],
    }),
  };
  const r = await analysisMetadata(db, {
    registry: { importedAt: "2026-11-06T03:00:00.000Z" },
  });
  assert.equal(r.lastUpdatedAt, "2026-11-06T05:00:00.000Z");
  assert.equal(r.lastImportAt, r.lastUpdatedAt);
  const empty = await analysisMetadata(
    { prepare: () => ({ all: () => [] }) },
    {},
  );
  assert.equal(empty.lastUpdatedAt, null);
  assert.ok(empty.generatedAt);
});

test("completeness counts valid recorded fields separately from verified bindings; empty populations have no fake percentages", () => {
  const s = diagnosticFixture(),
    people = clientPopulation(s, "2026-11-06");
  const r = dataQualitySummary(people, s.locations, "2026-11-06");
  assert.equal(r.total, 100);
  assert.equal(r.verified, 80);
  assert.equal(r.verifiedPercent, 80);
  assert.equal(r.distanceReady, true);
  assert.equal(r.rows.find((r) => r.field === "block").known, 100);
  assert.ok(r.rows.every((r) => r.known + r.missing === 100));
  assert.equal(fieldKnown({ age: false }, "age"), false);
  assert.equal(fieldKnown({ age: 0 }, "age"), true);
  assert.equal(fieldKnown({ cfs: "8-7" }, "cfs", null, "2026-11-06"), false);
  assert.equal(fieldKnown({ cfs: "7-8" }, "cfs", null, "2026-11-06"), true);
  assert.equal(fieldKnown({ gender: "Unknown" }, "gender"), false);
  assert.equal(
    fieldKnown(
      { registrationDate: "2026-02-30" },
      "registration",
      null,
      "2026-11-06",
    ),
    false,
  );
  const empty = dataQualitySummary([], null, "2026-11-06");
  assert.equal(empty.verifiedPercent, null);
  assert.ok(
    empty.rows.every(
      (r) => r.knownPercent === null && r.missingPercent === null,
    ),
  );
  assert.equal(empty.distanceReady, false);
});
test("known-registration comparison preserves original denominators and excludes unknown or late dates with exact boundary", () => {
  const people = [
    { id: "a", registrationDate: "2026-05-04" },
    { id: "b", registrationDate: "2026-05-03" },
    { id: "c", registrationDate: "2026-05-05" },
    { id: "d", registrationDate: null },
    { id: "e", registrationDate: "2026-02-30" },
  ];
  const r = registrationContext(
    people,
    (p) => p.id === "a",
    "2026-05-04",
    true,
  );
  assert.equal(r.n_registered, 2);
  assert.equal(r.n_participating, 1);
  assert.equal(r.rate, 50);
  assert.equal(r.excludedUnknown, 2);
  assert.equal(r.excludedAfterStart, 1);
  assert.equal(
    registrationContext(people, () => true, null, true),
    null,
  );
  assert.equal(
    registrationContext(people, () => true, "2026-05-04", false),
    null,
  );
  const s = diagnosticFixture();
  s.registry.forEach((r, i) => {
    const p = JSON.parse(r.details);
    p.registrationDate = i < 20 ? "2026-11-01" : null;
    r.details = JSON.stringify(p);
  });
  const report = participationPatterns(
    s,
    { scope: "clients", dimension: "age" },
    "2026-11-06",
  );
  assert.equal(report.population, 100);
  assert.equal(report.registrationContext.n_registered, 20);
  assert.equal(report.registrationContext.excludedUnknown, 80);
  assert.equal(report.reliability.overall.n_registered, 100);
  s.settings.staffAnalysisFull = false;
  assert.equal(
    participationPatterns(
      s,
      { scope: "clients", dimension: "age" },
      "2026-11-06",
    ).registrationContext,
    null,
  );
});
test("missing lists are paginated subsets of existing follow-up fields and preserve source state and legacy block queries", () => {
  const s = diagnosticFixture();
  s.registry.forEach((r, i) => {
    if (i < 30) {
      const p = JSON.parse(r.details);
      p.age = null;
      r.details = JSON.stringify(p);
    }
  });
  const before = JSON.stringify(s),
    r = dataQualityReport(
      s,
      { asOf: "2026-11-06", missingField: "age" },
      "2026-11-06",
    );
  assert.equal(r.total, 30);
  assert.equal(r.rows.length, 25);
  assert.equal(
    dataQualityReport(
      s,
      { asOf: "2026-11-06", missingField: "age", page: 1 },
      "2026-11-06",
    ).rows.length,
    5,
  );
  assert.equal(r.rows[0].cfs, undefined);
  assert.equal(r.rows[0].registrationDate, undefined);
  assert.equal(JSON.stringify(s), before);
  for (const input of [
    { missingField: "phone" },
    { page: -1 },
    { asOf: "2027-01-01" },
    { extra: "x" },
  ])
    assert.throws(
      () => dataQualityReport(s, input, "2026-11-06"),
      (e) => e.status === 400,
    );
  assert.equal(
    validatePatternQuery({
      dimension: "block",
      group: "Block 212 (unverified; address not assumed)",
    }).group,
    "Block 212",
  );
  const blocks = participationPatterns(
    s,
    { scope: "clients", dimension: "block" },
    "2026-11-06",
  );
  assert.ok(
    blocks.groups.every(
      (g) => !g.label.includes("unverified; address not assumed"),
    ),
  );
});
test("data-quality endpoint restricts viewers and audits only field/count/page", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)").run(
    "quality-viewer",
    passwordHash("fixture-password-long"),
    "viewer",
  );
  const server = createApp(db, { authRequired: true }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (path, body, cookie) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("/api/clients/data-quality", {})).status, 401);
    const login = await post("/api/login", {
      username: "quality-viewer",
      password: "fixture-password-long",
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await post("/api/clients/data-quality", {}, cookie)).status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
  const local = openDb(":memory:"),
    app = createApp(local).listen(0, "127.0.0.1");
  await new Promise((r) => app.once("listening", r));
  const url = "http://127.0.0.1:" + app.address().port;
  try {
    const response = await fetch(url + "/api/clients/data-quality", {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify({ asOf: "2026-11-06", missingField: "age" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.summary.total, 0);
    const row = local
      .prepare(
        "SELECT details FROM audit WHERE action='client.data-quality.viewed'",
      )
      .get();
    assert.deepEqual(JSON.parse(row.details), {
      field: "age",
      count: 0,
      page: 0,
    });
  } finally {
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
    local.close();
  }
});
