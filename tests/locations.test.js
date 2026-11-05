import test from "node:test";
import assert from "node:assert/strict";
import { locationFixture } from "./fixtures/location-state.js";
import {
  buildingInput,
  validateLocation,
  distanceBand,
  locatedPerson,
  routeKey,
  transportResponses,
  straightDistance,
} from "../server/location-model.js";
import { participationPatterns } from "../server/patterns.js";
import { createOneMap } from "../server/onemap.js";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
const now = "2026-11-05";
test("building resolution requires full evidence and never guesses a street from a block", () => {
  assert.throws(() => buildingInput({ block: "212" }));
  assert.throws(() =>
    buildingInput({ block: "212", street: "Some street #01-123" }),
  );
  assert.throws(() => buildingInput({ postal: "123" }));
  assert.throws(() =>
    validateLocation({
      block: "212",
      street: "Synthetic street",
      status: "Verified",
      lat: 1.35,
      lon: 103.75,
      source: "review",
      confirm: false,
    }),
  );
  const s = locationFixture(),
    a = s.data.participants[0],
    b = s.data.participants[20];
  assert.equal(a.blockRaw, b.blockRaw);
  assert.notEqual(
    locatedPerson(a, s.locations).buildingId,
    locatedPerson(b, s.locations).buildingId,
  );
  delete s.locations.bindings[a.id];
  assert.equal(locatedPerson(a, s.locations).distance, null);
});
test("distance and walking-time boundaries are separate; unverified locations remain unknown", () => {
  const s = locationFixture();
  for (const [value, index] of [
    [0, 0],
    [500, 0],
    [500.01, 1],
    [1000, 1],
    [1000.01, 2],
    [2000, 2],
    [2000.01, 3],
    [null, 4],
  ])
    assert.equal(
      distanceBand(value, s.locations, "walking"),
      [
        "0 to 500 metres",
        "Over 500 to 1000 metres",
        "Over 1000 to 2000 metres",
        "Over 2000 metres",
        "Distance unknown",
      ][index],
    );
  assert.equal(distanceBand(5, s.locations, "time"), "0 to 5 minutes");
  assert.equal(distanceBand(5.01, s.locations, "time"), "Over 5 to 10 minutes");
  assert.equal(
    locatedPerson(s.data.participants[80], s.locations).status,
    "Ambiguous",
  );
  assert.equal(
    locatedPerson(s.data.participants[80], s.locations).distance,
    null,
  );
});
test("route fingerprints, source addresses, building addresses and cache age invalidate old walking distances", () => {
  const s = locationFixture(),
    p = s.data.participants[0],
    building = s.locations.buildings["building-0"];
  assert.equal(locatedPerson(p, s.locations).distance, 500);
  assert.equal(
    locatedPerson({ ...p, blockRaw: "999" }, s.locations).distance,
    null,
  );
  building.postal = "650999";
  assert.equal(locatedPerson(p, s.locations).verified, false);
  building.postal = "650100";
  s.locations.routes[routeKey(building, s.locations.centre)].calculatedAt =
    new Date(Date.now() - 31 * 86400000).toISOString();
  assert.equal(locatedPerson(p, s.locations).distance, null);
  assert.equal(
    locatedPerson(p, s.locations, { distanceMetric: "straight" }).distance,
    0,
  );
  s.locations.centre.lat += 0.001;
  assert.equal(locatedPerson(p, s.locations).distance, null);
  assert.ok(straightDistance(building, s.locations.centre) > 0);
});
test("distance rates include registered non-attenders, unknown addresses and genuine repeat sessions", () => {
  const s = locationFixture(),
    r = participationPatterns(s, { dimension: "distance" }, now);
  assert.equal(r.population, 100);
  assert.equal(r.location.verifiedClients, 80);
  assert.equal(r.location.attending, 50);
  assert.equal(r.location.noAttendance, 50);
  assert.equal(r.groups[0].registered, 20);
  assert.equal(r.groups[0].unique, 10);
  assert.equal(r.groups[0].rate, 50);
  assert.equal(r.groups[0].repeat, 10);
  assert.equal(r.groups[0].repeatRate, 100);
  assert.equal(
    r.groups.find((g) => g.label === "Distance unknown").registered,
    20,
  );
  assert.ok(!JSON.stringify(r).includes('"lat"'));
  assert.ok(!JSON.stringify(r).includes("MEMBER-"));
  assert.ok(!JSON.stringify(r).includes("Synthetic building"));
});
test("distance plus age, CFS, SRF, living, gender, race and participation status reuse protected denominators", () => {
  const s = locationFixture();
  for (const second of [
    "age",
    "cfs",
    "risk",
    "living",
    "gender",
    "race",
    "participation",
  ]) {
    const r = participationPatterns(s, { dimension: "distance", second }, now);
    assert.equal(r.combined.suppressed, false);
    assert.ok(r.combined.rows.length >= 5);
    if (second !== "participation") assert.equal(r.combined.rows[0].rate, 50);
  }
  s.data.participants[0].age = 85;
  const p = JSON.parse(s.registry[0].details);
  p.age = 85;
  s.registry[0].details = JSON.stringify(p);
  const protectedReport = participationPatterns(
    s,
    { dimension: "distance", second: "age" },
    now,
  );
  assert.equal(protectedReport.combined.suppressed, true);
  assert.deepEqual(protectedReport.combined.rows, []);
});
test("a reviewed programme venue uses its own target and exact recorded sessions", () => {
  const s = locationFixture();
  s.locations.venues.remote = {
    ...s.locations.centre,
    id: "remote",
    venueName: "Recorded venue B",
    lat: 1.36,
  };
  const r = participationPatterns(
    s,
    {
      dimension: "distance",
      destination: "remote",
      distanceMetric: "straight",
    },
    now,
  );
  assert.equal(
    r.groups.reduce((sum, g) => sum + (g.attendance || 0), 0),
    50,
  );
  assert.equal(r.rankings.rows.length, 1);
  assert.equal(r.rankings.rows[0].id, "b");
  assert.equal(r.rankings.rows[0].sessions, 1);
  assert.equal(r.rankings.rows[0].repeatRate, null);
  assert.match(r.location.note, /exact recorded venue/);
});
test("transport feedback requires dates and sources; unknown is not no barrier", () => {
  const s = locationFixture(),
    members = s.data.participants.slice(0, 20);
  for (let i = 0; i < 5; i++)
    s.feedback.push({
      participant_id: members[i].id,
      date: "2026-11-01",
      details: JSON.stringify({
        barriers: [
          {
            category: "Transport difficulties",
            status: "Reported",
            source: "Participant-reported",
            date: "2026-11-01",
          },
        ],
      }),
    });
  for (let i = 5; i < 10; i++)
    s.feedback.push({
      participant_id: members[i].id,
      date: "2026-11-01",
      details: JSON.stringify({
        barriers: [
          {
            category: "No reported transport barrier",
            status: "Not present",
            source: "Caregiver-reported",
            date: "2026-11-01",
          },
        ],
      }),
    });
  assert.deepEqual(transportResponses(members, s, now), {
    reported: 5,
    noReportedBarrier: 5,
    notAssessed: 10,
    staffObserved: 0,
  });
});
test("OneMap receives only building search fields and routing coordinates; metre and second summaries remain distinct", async () => {
  const calls = [];
  const provider = createOneMap({
    token: "TEST-ONLY",
    sleep: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json(
        String(url).includes("elastic")
          ? {
              found: 1,
              totalNumPages: 1,
              results: [
                {
                  BLK_NO: "212",
                  ROAD_NAME: "SYNTHETIC STREET",
                  POSTAL: "650212",
                  ADDRESS: "212 SYNTHETIC STREET",
                  LATITUDE: "1.35",
                  LONGITUDE: "103.75",
                },
              ],
            }
          : {
              status: 0,
              route_summary: { total_distance: 1234, total_time: 987 },
            },
      );
    },
  });
  const result = await provider.search({
    block: "212",
    street: "Synthetic street",
    memberId: "PRIVATE-MEMBER",
    cfs: "PRIVATE-CFS",
  });
  assert.equal(result.status, "Awaiting verification");
  assert.equal(result.candidates.length, 1);
  assert.ok(!JSON.stringify(calls).includes("PRIVATE-"));
  assert.match(calls[0].url, /searchVal=/);
  const route = await provider.walk(
    { lat: 1.35, lon: 103.75 },
    { lat: 1.36, lon: 103.76 },
  );
  assert.equal(route.walkingM, 1234);
  assert.equal(route.timeSeconds, 987);
  assert.ok(!calls[1].url.includes("Member"));
});
test("OneMap authentication failures, empty/ambiguous results, rate limits and timeouts fail safely", async () => {
  let calls = 0;
  const unavailable = createOneMap({
    token: "",
    email: "",
    password: "",
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(() => unavailable.search({ postal: "650212" }));
  assert.equal(calls, 0);
  const limited = createOneMap({
    token: "TEST",
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return Response.json({}, { status: 429 });
    },
  });
  await assert.rejects(
    () => limited.search({ postal: "650212" }),
    (e) => e.status === 429,
  );
  assert.equal(calls, 2);
  const auth = createOneMap({
    token: "TEST",
    sleep: async () => {},
    fetchImpl: async () =>
      Response.json({ error: "Authentication token expired" }),
  });
  await assert.rejects(
    () => auth.search({ postal: "650212" }),
    /authentication failed or expired/,
  );
  const offline = createOneMap({
    token: "TEST",
    sleep: async () => {},
    fetchImpl: async () => {
      throw Error("PRIVATE NETWORK DETAIL");
    },
  });
  await assert.rejects(
    () => offline.search({ postal: "650212" }),
    (e) =>
      /unavailable or timed out/.test(e.message) &&
      !e.message.includes("PRIVATE"),
  );
  const empty = createOneMap({
    token: "TEST",
    sleep: async () => {},
    fetchImpl: async () => Response.json({ results: [], totalNumPages: 1 }),
  });
  assert.equal(
    (await empty.search({ postal: "650212" })).status,
    "Unable to locate",
  );
  const many = createOneMap({
    token: "TEST",
    sleep: async () => {},
    fetchImpl: async () => Response.json({ results: [], totalNumPages: 2 }),
  });
  assert.equal((await many.search({ postal: "650212" })).status, "Ambiguous");
});
test("OneMap authentication renewal is cached server-side", async () => {
  let authCalls = 0;
  const provider = createOneMap({
    token: "",
    email: "test@example.invalid",
    password: "PRIVATE-PASSWORD",
    sleep: async () => {},
    fetchImpl: async (url) =>
      String(url).includes("getToken")
        ? (authCalls++,
          Response.json({
            access_token: "PRIVATE-TOKEN",
            expiry_timestamp: Math.floor(Date.now() / 1000) + 7200,
          }))
        : Response.json({ results: [] }),
  });
  await provider.search({ postal: "650212" });
  await provider.search({ postal: "650213" });
  assert.equal(authCalls, 1);
});
test("building search and route caches deduplicate clients, retain valid results on service failure and reject duplicate buildings", async () => {
  const db = openDb(":memory:");
  let searches = 0,
    routes = 0,
    failure = false;
  const provider = {
    configured: () => true,
    search: async () => {
      searches++;
      return {
        status: "Awaiting verification",
        candidates: [],
        checkedAt: new Date().toISOString(),
      };
    },
    walk: async () => {
      routes++;
      if (failure) throw Error("OneMap authentication failed");
      return {
        walkingM: 750,
        timeSeconds: 700,
        status: "Walking route available",
        source: "Synthetic provider",
        calculatedAt: new Date().toISOString(),
      };
    },
  };
  const server = createApp(db, {
    authRequired: false,
    locationService: provider,
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body) =>
    fetch(base + path, {
      method,
      headers: { origin: base, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    await request("/api/locations");
    const fixture = locationFixture();
    db.prepare("UPDATE location_store SET value=? WHERE id=1").run(
      JSON.stringify(fixture.locations),
    );
    const first = await (
      await request("/api/locations/search", "POST", {
        block: "212",
        street: "Synthetic street 0",
        postal: "650100",
      })
    ).json();
    const second = await (
      await request("/api/locations/search", "POST", {
        block: "212",
        street: "SYNTHETIC STREET 0",
        postal: "650100",
      })
    ).json();
    assert.equal(searches, 1);
    assert.equal(second.cached, true);
    assert.equal(first.revision, second.revision);
    const duplicate = await request(
      "/api/locations/buildings/duplicate",
      "PUT",
      {
        ...fixture.locations.buildings["building-0"],
        revision: first.revision,
        confirm: true,
      },
    );
    assert.equal(duplicate.status, 409);
    await request("/api/locations/refresh", "POST", {
      buildingIds: ["building-0"],
    });
    assert.equal(routes, 0);
    await request("/api/locations/refresh", "POST", {
      buildingIds: ["building-0"],
      force: true,
    });
    assert.equal(routes, 1);
    failure = true;
    const partial = await (
      await request("/api/locations/refresh", "POST", {
        buildingIds: ["building-0", "building-1"],
        force: true,
      })
    ).json();
    assert.equal(routes, 2);
    assert.deepEqual(partial.remaining, ["building-1"]);
    const current = await (await request("/api/locations")).json();
    const key = routeKey(
      fixture.locations.buildings["building-0"],
      fixture.locations.centre,
    );
    assert.equal(current.routes[key].walkingM, 750);
    assert.equal(current.routes[key].lastRefreshFailed, true);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
test("location API enforces roles, reviewed bindings, stale revisions and privacy-safe management exports", async () => {
  const db = openDb(":memory:"),
    app = createApp(db, { authRequired: false }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body) =>
    fetch(base + path, {
      method,
      headers: { origin: base, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const initial = await (await request("/api/locations")).json();
    assert.equal(initial.centre.status, "Awaiting verification");
    assert.equal(initial.centre.lat, null);
    const fixture = locationFixture();
    db.prepare("UPDATE settings SET value=? WHERE id=1").run(
      JSON.stringify(fixture.settings),
    );
    db.prepare("UPDATE location_store SET value=? WHERE id=1").run(
      JSON.stringify(fixture.locations),
    );
    for (const p of fixture.data.participants) {
      const { id, ...d } = p;
      db.prepare("INSERT INTO participants VALUES(?,?)").run(
        id,
        JSON.stringify(d),
      );
      const r = fixture.registry.find((r) => r.participant_id === id);
      db.prepare("INSERT INTO member_registry VALUES(?,?,?)").run(
        id,
        r.snapshot,
        r.details,
      );
    }
    assert.equal(
      (await request("/api/locations/search", "POST", { block: "212" })).status,
      400,
    );
    const clients = await (await request("/api/locations/clients")).json(),
      p = clients.rows[0];
    assert.equal(
      (
        await request("/api/locations/bind", "POST", {
          revision: 0,
          buildingId: "building-0",
          clients: [{ id: p.id, sourceKey: p.sourceKey }],
          confirm: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/locations/bind", "POST", {
          revision: 0,
          buildingId: "building-0",
          clients: [{ id: p.id, sourceKey: "STALE" }],
          confirm: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/locations/bind", "POST", {
          revision: 0,
          buildingId: "building-0",
          clients: [{ id: p.id, sourceKey: p.sourceKey }],
          confirm: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/locations/bind", "POST", {
          revision: 0,
          buildingId: "building-0",
          clients: [{ id: p.id, sourceKey: p.sourceKey }],
          confirm: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/participation-patterns/export?dimension=locationBlock",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/participation-patterns/export?dimension=distance"))
        .status,
      200,
    );
    const resetPreview = await (
      await request("/api/data-management/preview", "POST", { scope: "reset" })
    ).json();
    const reset = await (
      await request("/api/data-management/confirm", "POST", {
        id: resetPreview.id,
        confirmation: "RESET DATA",
      })
    ).json();
    assert.ok(reset.backupId);
    const cleared = await (await request("/api/locations")).json();
    assert.equal(Object.keys(cleared.bindings).length, 0);
    assert.equal(cleared.centre.status, "Verified");
    assert.equal(Object.keys(cleared.buildings).length, 5);
    assert.equal(
      (
        await request("/api/data-management/preview", "POST", {
          scope: "reset",
        })
      ).status,
      400,
    );
    const restore = await (
      await request("/api/data-management/preview", "POST", {
        operation: "restore",
        backupId: reset.backupId,
      })
    ).json();
    assert.equal(
      (
        await request("/api/data-management/confirm", "POST", {
          id: restore.id,
          confirmation: "RESTORE DATA",
        })
      ).status,
      200,
    );
    assert.equal(
      Object.keys((await (await request("/api/locations")).json()).bindings)
        .length,
      100,
    );
    const older = JSON.parse(
      db
        .prepare("SELECT payload FROM attendance_backups WHERE id=?")
        .get(reset.backupId).payload,
    );
    delete older.tables.location_store;
    db.prepare("UPDATE attendance_backups SET payload=? WHERE id=?").run(
      JSON.stringify(older),
      reset.backupId,
    );
    const current = JSON.parse(
      db.prepare("SELECT value FROM location_store WHERE id=1").get().value,
    );
    current.centre.source = "Keep later reviewed location";
    db.prepare("UPDATE location_store SET value=? WHERE id=1").run(
      JSON.stringify(current),
    );
    const legacy = await (
      await request("/api/data-management/preview", "POST", {
        operation: "restore",
        backupId: reset.backupId,
      })
    ).json();
    assert.equal(
      (
        await request("/api/data-management/confirm", "POST", {
          id: legacy.id,
          confirmation: "RESTORE DATA",
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await request("/api/locations")).json()).centre.source,
      "Keep later reviewed location",
    );
    const actor = db
      .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
      .get().id;
    db.prepare("UPDATE users SET role='planner' WHERE id=?").run(actor);
    assert.equal((await request("/api/locations")).status, 403);
    assert.equal(
      (await request("/api/participation-patterns?dimension=distance")).status,
      200,
    );
    db.prepare("UPDATE users SET role='viewer' WHERE id=?").run(actor);
    assert.equal(
      (await request("/api/participation-patterns?dimension=distance")).status,
      403,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM participants").get().n,
      100,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
