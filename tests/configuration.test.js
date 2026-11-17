import test from "node:test";
import assert from "node:assert/strict";
import { centreQaFixture } from "../scripts/centre-qa-fixture.mjs";
import { readData, openDb, passwordHash } from "../server/db.js";
import { defaults, hash, HEADERS } from "../server/domain.js";
import { CLIENT_SNAPSHOT } from "../server/client-domain.js";
import { createPlatformApp } from "../server/platform.js";
const A = hash(["GLOW Internal Admin"]),
  B = hash(["GLOW Public Movement"]);
function seed(db) {
  for (const id of ["p1", "p2", "p3", "p4"]) {
    const p = {
      age: 65,
      gender: "MALE",
      race: "MALAY",
      cfs: "4",
      riskRaw: "0",
      client: true,
      boundary: true,
      livingRaw: "Alone",
    };
    db.prepare("INSERT INTO participants VALUES(?,?)").run(
      hash([id]),
      JSON.stringify(p),
    );
    db.prepare("INSERT INTO member_registry VALUES(?,?,?)").run(
      hash([id]),
      CLIENT_SNAPSHOT,
      JSON.stringify({ ...p, memberId: id }),
    );
  }
  for (const [id, name, date] of [
    [A, "GLOW Internal Admin", "2026-05-01"],
    [B, "GLOW Public Movement", "2026-11-10"],
  ]) {
    db.prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)").run(
      id,
      name,
      id === A ? "Others" : "Physical",
    );
    const sid = hash([id, date, 540, 600, null]);
    db.prepare(
      "INSERT INTO sessions(id,programme_id,date,start,end,optional) VALUES(?,?,?,?,?,?)",
    ).run(
      sid,
      id,
      date,
      540,
      600,
      JSON.stringify({
        eventTypeRaw: id === A ? "Administrative" : "Social",
        eventTypes: [id === A ? "Administrative" : "Social"],
        centreClassification: { centreId: "glow_bukit_batok", service: "glow" },
      }),
    );
    for (const person of id === A ? ["p1", "p2"] : ["p1", "p3"])
      db.prepare(
        "INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)",
      ).run(
        hash([hash([person]), sid]),
        hash([person]),
        sid,
        date + ", 09:00 AM - 10:00 AM",
      );
  }
  db.prepare("UPDATE settings SET value=? WHERE id=1").run(
    JSON.stringify({
      ...defaults,
      centreId: "glow_bukit_batok",
      staffAnalysisFull: true,
      registry: {
        type: "clients",
        complete: true,
        snapshot: CLIENT_SNAPSHOT,
        asOf: "2026-04-01",
      },
    }),
  );
}
async function fixture(auth = false) {
  let f;
  if (!auth) f = await centreQaFixture();
  else {
    const control = openDb(":memory:"),
      stores = [];
    for (const [name, role] of [
      ["admin", "admin"],
      ["planner", "planner"],
      ["viewer", "viewer"],
    ])
      control
        .prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
        .run(name, passwordHash("fixture-password-long"), role);
    const app = createPlatformApp(control, {
      authRequired: true,
      openWorkspace: () => {
        const db = openDb(":memory:");
        stores.push(db);
        return db;
      },
    });
    await app.platform.ready;
    const db = await app.platform.workspaces.get("glow_bukit_batok");
    f = {
      app,
      db,
      control,
      async close() {
        for (const db of stores) db.close();
        control.close();
      },
    };
  }
  seed(f.db);
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (path, body, method, headers = {}) =>
    fetch(
      origin +
        path +
        (path.includes("?") ? "&" : "?") +
        "centre=glow_bukit_batok",
      {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          Origin: origin,
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      },
    );
  const json = async (path, body, method, headers) => {
    const r = await request(path, body, method, headers),
      value = await r.json();
    assert.equal(r.status, 200, JSON.stringify(value));
    return value;
  };
  const preview = async (rule, extra = {}, headers) => {
    const current = await json(
      "/api/configuration",
      undefined,
      undefined,
      headers,
    );
    return json(
      "/api/configuration/preview",
      {
        operation: "rule",
        version: current.configuration.version,
        reason: "Reviewed centre reporting arrangement",
        rule,
        ...extra,
      },
      undefined,
      headers,
    );
  };
  const approve = (p, headers) =>
    json(
      "/api/configuration/confirm",
      { id: p.id, confirmed: true, bulkConfirmed: true },
      undefined,
      headers,
    );
  return {
    ...f,
    origin,
    request,
    json,
    preview,
    approve,
    async login(username) {
      const r = await request("/api/login", {
        username,
        password: "fixture-password-long",
      });
      assert.equal(r.status, 200);
      return { cookie: r.headers.get("set-cookie").split(";")[0] };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await f.close();
    },
  };
}
test("official exclusions recompute overlapping unique people, client denominators, repeat counts and exports without deleting source rows", async () => {
  const f = await fixture();
  try {
    const p = await f.preview({ scope: "official", selector: { ids: [A] } });
    assert.equal(p.impact.before.summary.unique, 3);
    assert.equal(p.impact.after.summary.unique, 2);
    assert.equal(p.impact.before.summary.repeat, 1);
    assert.equal(p.impact.after.summary.repeat, 0);
    assert.equal(p.impact.after.clientMetrics.registered, 4);
    assert.equal(p.impact.after.clientMetrics.attending, 2);
    await f.approve(p);
    const r = await f.json("/api/dashboard");
    assert.equal(r.summary.unique, 2);
    assert.equal(r.summary.attendance, 2);
    assert.equal(r.reporting.version, 2);
    assert.equal(r.metadata.reporting.version, 2);
    assert.equal(readData(f.db).attendance.length, 4);
    assert.equal(
      (await f.json("/api/clients/report", {})).summary.registered,
      4,
    );
    const csv = await (await f.request("/api/export/csv")).text();
    assert.match(csv, /Configuration version/);
    assert.match(csv, /Official reporting/);
    const explore = await f.json(
      "/api/dashboard?reportingMode=exploratory&includeExcluded=1",
    );
    assert.equal(explore.summary.unique, 3);
    assert.equal(explore.reporting.mode, "exploratory");
    assert.equal((await f.json("/api/dashboard")).summary.unique, 2);
  } finally {
    await f.close();
  }
});
test("performance-only exclusions retain centre-wide participation but remove programme, domain, Event Type and ranking results", async () => {
  const f = await fixture();
  try {
    const p = await f.preview({ scope: "performance", selector: { ids: [A] } });
    assert.equal(p.impact.before.summary.unique, p.impact.after.summary.unique);
    await f.approve(p);
    const dashboard = await f.json("/api/dashboard");
    assert.equal(dashboard.summary.attendance, 4);
    assert.deepEqual(
      dashboard.programmes.map((p) => p.id),
      [B],
    );
    assert.equal(
      dashboard.domains.some((d) => d.label === "Others"),
      false,
    );
    const patterns = await f.json(
      "/api/participation-patterns?scope=clients&dimension=age",
    );
    assert.equal(
      patterns.groups.reduce((sum, g) => sum + (g.unique || 0), 0),
      3,
    );
    assert.equal(
      patterns.rankings.rows.some((p) => p.id === A),
      false,
    );
    const needs = await f.json("/api/needs/overview");
    assert.equal(needs.summary.attendance, 4);
    assert.equal(
      needs.alignment.some((d) => d.label === "Others"),
      false,
    );
    const types = await f.json("/api/event-types/report");
    assert.equal(
      types.rankings.rows.some((p) => p.id === A),
      false,
    );
  } finally {
    await f.close();
  }
});
test("effective dates, centre scope and exact identities are retained; restoration creates a new audited version", async () => {
  const f = await fixture();
  try {
    const p = await f.preview({
      scope: "official",
      selector: { ids: [A] },
      from: "2026-06-01",
    });
    await f.approve(p);
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 4);
    const second = await f.preview({
      scope: "official",
      selector: { ids: [B] },
    });
    await f.approve(second);
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 2);
    const other = await f.app.platform.workspaces.get("glow_nanyang");
    seed(other);
    const r = await fetch(f.origin + "/api/dashboard?centre=glow_nanyang");
    assert.equal((await r.json()).summary.attendance, 4);
    const cfg = await f.json("/api/configuration");
    const restored = await f.json("/api/configuration/preview", {
      operation: "restoreActivities",
      ids: [B],
      version: cfg.configuration.version,
      reason: "Approved activity restored to normal reporting",
    });
    await f.approve(restored);
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 4);
    const history = await f.json("/api/configuration/history");
    assert.equal(
      history.rows.filter((r) => r.action === "configuration.approved").length,
      3,
    );
    const rollback = await f.json("/api/configuration/preview", {
      operation: "restoreVersion",
      restoreVersion: 3,
      version: 4,
      reason: "Restore previous reviewed reporting policy",
    });
    await f.approve(rollback);
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 2);
    assert.equal(readData(f.db).attendance.length, 4);
  } finally {
    await f.close();
  }
});
test("new advanced-rule matches are included until reviewed and raw imports still detect excluded duplicates", async () => {
  const f = await fixture();
  try {
    await f.approve(
      await f.preview({
        scope: "official",
        selector: { type: "prefix", value: "GLOW Internal" },
      }),
    );
    const row = [
      "p1",
      "MALE",
      65,
      "MALAY",
      "4",
      "Yes",
      "Yes",
      "GLOW Internal Admin",
      "Others",
      "2026-05-01, 09:00 AM - 10:00 AM",
      "Tzu Chi SEEN @ Bukit Batok",
    ];
    const form = new FormData();
    form.append(
      "file",
      new Blob([
        [...HEADERS, "Centres"].join(",") +
          "\r\n" +
          row.map((v) => '"' + v + '"').join(","),
      ]),
      "same.csv",
    );
    const repeated = await f.json("/api/import/preview?mode=merge", form);
    assert.equal(repeated.ready, 0);
    assert.equal(repeated.duplicates, 1);
    f.db
      .prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)")
      .run("new", "GLOW Internal New", "Others");
    f.db
      .prepare(
        "INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)",
      )
      .run("new", "new", "2026-11-11", 540, 600);
    f.db
      .prepare(
        "INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)",
      )
      .run("new", hash(["p4"]), "new", "synthetic");
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 3);
    const list = await f.json("/api/configuration/activities");
    assert.equal(
      list.rows.find((p) => p.id === "new").status,
      "Review Required",
    );
    const cfg = await f.json("/api/configuration"),
      p = await f.json("/api/configuration/preview", {
        operation: "approveMatches",
        ruleId: cfg.configuration.rules[0].id,
        version: cfg.configuration.version,
        reason: "Reviewed newly matching source activity",
      });
    await f.approve(p);
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 2);
    assert.equal(readData(f.db).attendance.length, 5);
  } finally {
    await f.close();
  }
});
test("staff requests cannot change approved settings; administrator approval and viewer restrictions are enforced", async () => {
  const f = await fixture(true);
  try {
    const planner = await f.login("planner"),
      admin = await f.login("admin"),
      viewer = await f.login("viewer");
    const p = await f.preview(
      { scope: "official", selector: { ids: [A] } },
      {},
      planner,
    );
    const submitted = await f.approve(p, planner);
    assert.equal(submitted.status, "Pending approval");
    assert.equal(
      (await f.json("/api/dashboard", undefined, undefined, admin)).summary
        .attendance,
      4,
    );
    assert.equal(
      (await f.request("/api/configuration", undefined, undefined, viewer))
        .status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/api/configuration/preview",
          {
            operation: "definitions",
            version: 1,
            reason: "Unauthorised official definition change",
            values: { seniorAge: 70 },
          },
          undefined,
          planner,
        )
      ).status,
      403,
    );
    const pending = await f.json(
      "/api/configuration/requests",
      undefined,
      undefined,
      admin,
    );
    const reviewed = await f.json(
      "/api/configuration/preview",
      {
        operation: "approveRequest",
        requestId: pending.rows[0].id,
        version: 1,
        reason: "Administrator reviewed the requested exclusion",
      },
      undefined,
      admin,
    );
    await f.approve(reviewed, admin);
    assert.equal(
      (await f.json("/api/dashboard", undefined, undefined, admin)).summary
        .attendance,
      2,
    );
    assert.equal(
      (
        await f.request(
          "/api/dashboard?reportingMode=exploratory&includeExcluded=1",
          undefined,
          undefined,
          viewer,
        )
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});
test("stale previews reject source changes, and personal display/sync preferences cannot alter official definitions", async () => {
  const f = await fixture();
  try {
    const p = await f.preview({ scope: "official", selector: { ids: [A] } });
    f.db
      .prepare("UPDATE programmes SET domain=? WHERE id=?")
      .run("Learning", A);
    assert.equal(
      (
        await f.request("/api/configuration/confirm", {
          id: p.id,
          confirmed: true,
        })
      ).status,
      409,
    );
    await f.json(
      "/api/configuration/personal",
      {
        kpis: ["male"],
        charts: [
          { id: "age-chart", group: "ages", metric: "unique", type: "bar" },
        ],
        layout: "Outreach Analysis",
        dimension: "cfs",
        from: "2026-05-01",
        columns: ["name", "unique"],
      },
      "PUT",
    );
    assert.equal((await f.json("/api/configuration")).configuration.version, 1);
    assert.equal((await f.json("/api/preferences")).draft.kpis[0], "male");
    assert.equal(
      (await f.request("/api/configuration/personal", { seniorAge: 18 }, "PUT"))
        .status,
      400,
    );
    const sync = await f.json("/api/configuration/preview", {
      operation: "sync",
      version: 1,
      reason: "Draft retrieval preferences reviewed",
      values: { categories: ["attendance", "clients"], mode: "all" },
    });
    await f.approve(sync);
    const config = await f.json("/api/configuration");
    assert.equal(config.caritaHub.connected, false);
    assert.equal(config.configuration.sync.connected, false);
    assert.equal(readData(f.db).attendance.length, 4);
  } finally {
    await f.close();
  }
});
test("report snapshots retain the configuration version and exploratory report exclusions do not change official KPIs", async () => {
  const f = await fixture();
  try {
    const report = await f.json("/api/configuration/reports/preview", {
      template: "Monthly Centre Performance",
      mode: "official",
      sections: ["trends", "programmes"],
    });
    await f.approve(
      await f.preview({ scope: "official", selector: { ids: [A] } }),
    );
    const html = await (
      await f.request(
        "/api/configuration/reports/" + report.id + "/export?format=html",
      )
    ).text();
    assert.match(html, /Configuration version 1/);
    assert.match(html, /GLOW Bukit Batok/);
    assert.equal((await f.json("/api/dashboard")).reporting.version, 2);
    const exploratory = await f.json("/api/configuration/reports/preview", {
      template: "Programme Effectiveness",
      mode: "exploratory",
      includeExcluded: true,
      excludedIds: [B],
    });
    assert.equal(exploratory.kpis.attendance, 2);
    assert.equal(exploratory.reporting.mode, "exploratory");
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 2);
    assert.equal(
      (
        await f.request("/api/configuration/reports/preview", {
          template: "Programme Effectiveness",
          mode: "official",
          excludedIds: [B],
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});

test("bulk review, exact versus keyword matches, unknown classifications and review-only rules are explicit", async () => {
  const f = await fixture();
  try {
    const exact = await f.preview({
      scope: "official",
      selector: { type: "name", value: "GLOW Internal" },
    });
    assert.equal(exact.matched.length, 0);
    const keyword = await f.preview({
      scope: "official",
      selector: { type: "contains", value: "GLOW" },
    });
    assert.equal(keyword.matched.length, 2);
    assert.equal(
      (
        await f.request("/api/configuration/confirm", {
          id: keyword.id,
          confirmed: true,
        })
      ).status,
      400,
    );
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 4);
    const idsWin = await f.preview({
      scope: "review",
      selector: { ids: [A], type: "contains", value: "Public" },
    });
    assert.deepEqual(
      idsWin.matched.map((p) => p.id),
      [A],
    );
    await f.approve(idsWin);
    const list = await f.json("/api/configuration/activities");
    assert.equal(list.rows.find((p) => p.id === A).status, "Review Required");
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 4);
    const unknown = await f.preview({
      scope: "official",
      selector: { type: "eventType", value: "Unrecognised classification" },
    });
    assert.equal(unknown.matched.length, 0);
    assert.equal(
      (
        await f.request("/api/configuration/preview", {
          operation: "definitions",
          version: 2,
          reason: "Documented mapping review",
          values: { cfsMappings: null },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/configuration/preview", {
          operation: "definitions",
          version: 2,
          reason: "Documented mapping review",
          values: { cfsMappings: { 4: { label: "Vulnerable" } } },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/configuration/requests/123/reject", {
          reason: "Request reviewed and rejected",
        })
      ).status,
      404,
    );
  } finally {
    await f.close();
  }
});

test("all activities excluded retain source coverage, valid zero reach and registry denominators; client recency uses eligible history", async () => {
  const f = await fixture();
  try {
    await f.approve(
      await f.preview({ scope: "official", selector: { ids: [B] } }),
    );
    const clients = await f.json("/api/clients/report", { asOf: "2026-11-10" });
    assert.equal(clients.summary.attending, 2);
    assert.equal(clients.summary.inactive, 2);
    await f.approve(
      await f.preview({ scope: "official", selector: { ids: [A] } }),
    );
    const dashboard = await f.json("/api/dashboard");
    assert.equal(dashboard.summary.unique, 0);
    assert.equal(dashboard.coverage.from, "2026-05-01");
    assert.equal(dashboard.coverage.to, "2026-11-10");
    const context = await f.json("/api/dashboard?view=context");
    assert.equal(context.coverage.to, "2026-11-10");
    const patterns = await f.json(
      "/api/participation-patterns?scope=clients&dimension=age",
    );
    assert.equal(patterns.coverage.to, "2026-11-10");
    assert.equal(
      patterns.groups.reduce((n, g) => n + (g.unique || 0), 0),
      0,
    );
    const all = await f.json("/api/clients/report", { asOf: "2026-11-10" });
    assert.equal(all.summary.registered, 4);
    assert.equal(all.summary.attending, 0);
    assert.equal(readData(f.db).attendance.length, 4);
  } finally {
    await f.close();
  }
});

test("selected-report rules leave centre KPIs unchanged and report exports retain full configuration and selected columns", async () => {
  const f = await fixture();
  try {
    const p = await f.preview({
      scope: "report",
      selector: { ids: [A] },
      reportId: "management-monthly",
    });
    assert.equal(p.impact.after.summary.attendance, 4);
    assert.equal(p.impact.report.after.summary.attendance, 2);
    await f.approve(p);
    assert.equal((await f.json("/api/dashboard")).summary.attendance, 4);
    const r = await f.json("/api/configuration/reports/preview", {
      template: "Quarterly Management Review",
      reportId: "management-monthly",
      sections: ["programmes", "demographics", "needs", "clients"],
      columns: ["name", "attendance"],
      ranking: "attendance",
    });
    assert.equal(r.kpis.attendance, 2);
    assert.deepEqual(r.columns, ["name", "attendance"]);
    assert.equal(r.configurationSnapshot.reporting.version, 2);
    const csv = await (
      await f.request(
        "/api/configuration/reports/" + r.id + "/export?format=csv",
      )
    ).text();
    assert.match(csv, /Attendance entries/);
    const exports = f.db
      .prepare(
        "SELECT details FROM audit WHERE action='configuration.report.exported'",
      )
      .all()
      .map((r) => JSON.parse(r.details));
    assert.equal(exports[0].configurationSnapshot.reporting.version, 2);
    assert.equal(exports[0].inclusion.reportId, "management-monthly");
  } finally {
    await f.close();
  }
});

test("shared approvals are centre-scoped and resumable, and cross-centre comparison uses each official configuration", async () => {
  const f = await fixture();
  try {
    const other = await f.app.platform.workspaces.get("glow_nanyang");
    seed(other);
    const p = await f.json("/api/centres/configuration/preview", {
      centreIds: ["glow_bukit_batok", "glow_nanyang"],
      operation: "rule",
      rule: {
        scope: "official",
        selector: { type: "name", value: "GLOW Internal Admin" },
      },
      reason: "Management reviewed shared attendance policy",
    });
    assert.equal(p.targets.length, 2);
    const results = await f.json("/api/centres/configuration/confirm", {
      id: p.id,
      confirmed: true,
      bulkConfirmed: true,
    });
    assert.equal(results.results.length, 2);
    const retry = await f.json("/api/centres/configuration/confirm", {
      id: p.id,
      confirmed: true,
      bulkConfirmed: true,
    });
    assert.ok(retry.results.every((r) => r.status === "Already approved"));
    assert.equal(readData(other).attendance.length, 4);
    const compare = await (
      await fetch(
        f.origin +
          "/api/centres/compare?centreIds=glow_bukit_batok,glow_nanyang",
      )
    ).json();
    for (const row of compare.rows.filter((r) =>
      ["glow_bukit_batok", "glow_nanyang"].includes(r.id),
    )) {
      assert.equal(row.reporting.version, 2);
      assert.equal(row.attendance, 2);
    }
  } finally {
    await f.close();
  }
});
