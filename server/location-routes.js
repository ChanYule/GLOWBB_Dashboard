import { randomUUID } from "node:crypto";
import { dataTransaction } from "./data-management.js";
import { clientPopulation } from "./client-domain.js";
import {
  ensureLocations,
  locationRow,
  readLocations,
} from "./location-store.js";
import {
  decodeLocations,
  addressKey,
  buildingAddressKey,
  validateLocation,
  validateBands,
  buildingInput,
  refreshStraightCache,
  routeKey,
  straightDistance,
} from "./location-model.js";
import { createOneMap } from "./onemap.js";
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
export function mountLocations(app, { db, storage, oneMap = createOneMap() }) {
  app.use("/api/locations", async (req, _res, next) => {
    if (req.user.role !== "admin")
      throw fail(
        "Administrator access is required for residential verification and routing.",
        403,
      );
    await ensureLocations(db);
    next();
  });
  const update = (req, action, mutate, expected) =>
    dataTransaction(
      db,
      function* (tx) {
        const current = decodeLocations(yield locationRow(tx));
        if (expected != null && expected !== current.revision)
          throw fail(
            "Location records changed. Reload and review before saving.",
            409,
          );
        const value = mutate(current);
        const { revision, ...stored } = current;
        void revision;
        const saved = yield tx
          .prepare(
            "UPDATE location_store SET value=?,revision=revision+1 WHERE id=1 AND revision=?",
          )
          .run(JSON.stringify(stored), current.revision);
        if (!saved.changes)
          throw fail("Location records changed. Reload and review.", 409);
        yield storage.audit(tx, req.user.id, action, {
          count: Array.isArray(value) ? value.length : 1,
        });
        return { ok: true, revision: current.revision + 1, result: value };
      },
      false,
      ["location_store"],
    );
  async function clients() {
    const state = storage.readPlanningState
      ? await storage.readPlanningState(db)
      : {
          data: await storage.readData(db),
          settings: await storage.getSettings(db),
          registry: await db.prepare("SELECT * FROM member_registry").all(),
          profiles: await db
            .prepare("SELECT * FROM participant_profiles")
            .all(),
          feedback: await db
            .prepare("SELECT * FROM participant_feedback")
            .all(),
        };
    return clientPopulation(state);
  }
  app.get("/api/locations", async (_req, res) => {
    const value = await readLocations(db),
      data = await storage.readData(db);
    res.json({
      ...value,
      serviceConfigured: oneMap.configured(),
      sessionVenues: [
        ...new Set(data.sessions.map((s) => s.venue).filter(Boolean)),
      ].sort(),
    });
  });
  app.put("/api/locations/settings", async (req, res) => {
    const b = req.body;
    if (!Number.isInteger(b?.revision))
      throw fail("Reload location settings before saving.");
    const centre = {
        ...validateLocation(b.centre),
        id: "centre",
        ...(typeof b.centre.address === "string" &&
        b.centre.address.trim() &&
        b.centre.address.length <= 400
          ? { address: b.centre.address.trim() }
          : {}),
      },
      bands = validateBands(b.bands),
      timeBands = validateBands(b.timeBands);
    res.json(
      await update(
        req,
        "locations.settings.reviewed",
        (s) => {
          s.centre = centre;
          s.bands = bands;
          s.timeBands = timeBands;
          refreshStraightCache(s);
          return null;
        },
        b.revision,
      ),
    );
  });
  app.put("/api/locations/buildings/:id", async (req, res) => {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id) ||
      !Number.isInteger(req.body?.revision)
    )
      throw fail("Reload building records before saving.");
    const building = { ...validateLocation(req.body), id: req.params.id };
    res.json(
      await update(
        req,
        "locations.building.reviewed",
        (s) => {
          if (
            Object.values(s.buildings).some(
              (b) =>
                b.id !== building.id &&
                buildingAddressKey(b) === buildingAddressKey(building),
            )
          )
            throw fail(
              "This building already has a saved record. Review that record instead of geocoding it again.",
              409,
            );
          s.buildings[building.id] = building;
          refreshStraightCache(s);
          return building.id;
        },
        req.body.revision,
      ),
    );
  });
  app.put("/api/locations/venues/:id", async (req, res) => {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id) ||
      req.params.id === "centre" ||
      !Number.isInteger(req.body?.revision) ||
      typeof req.body.venueName !== "string" ||
      !req.body.venueName.trim() ||
      req.body.venueName.length > 200
    )
      throw fail(
        "Choose an exact recorded venue name and reload before saving.",
      );
    const value = {
      ...validateLocation(req.body),
      id: req.params.id,
      venueName: req.body.venueName.trim(),
    };
    res.json(
      await update(
        req,
        "locations.venue.reviewed",
        (s) => {
          s.venues[value.id] = value;
          refreshStraightCache(s);
          return value.id;
        },
        req.body.revision,
      ),
    );
  });
  app.post("/api/locations/search", async (req, res) => {
    const query = buildingInput(req.body),
      key = buildingAddressKey(query),
      state = await readLocations(db),
      cached = state.geocodes[key];
    if (
      !req.body.force &&
      cached &&
      Date.now() - Date.parse(cached.checkedAt) < 7 * 86400000
    )
      return res.json({ ...cached, cached: true, revision: state.revision });
    const result = await oneMap.search(query);
    const saved = await update(req, "locations.building.searched", (s) => {
      s.geocodes[key] = result;
      const keys = Object.keys(s.geocodes);
      for (const k of keys.slice(0, Math.max(0, keys.length - 1000)))
        delete s.geocodes[k];
      return null;
    });
    res.json({ ...result, revision: saved.revision });
  });
  app.get("/api/locations/clients", async (req, res) => {
    const all = await clients(),
      state = await readLocations(db),
      search = String(req.query.search || "").toLowerCase();
    const rows = all
      .filter((p) =>
        [p.memberId, p.id, p.blockRaw].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(search),
        ),
      )
      .map((p) => ({
        id: p.id,
        memberId: p.memberId || "",
        block: p.blockRaw || "",
        sourceKey: addressKey(p),
        binding: state.bindings[p.id] || null,
      }));
    const page = /^\d+$/.test(req.query.page || "0")
      ? Number(req.query.page || 0)
      : 0;
    res.json({
      rows: rows.slice(page * 50, page * 50 + 50),
      total: rows.length,
      revision: state.revision,
    });
  });
  app.post("/api/locations/bind", async (req, res) => {
    const b = req.body;
    if (
      b?.confirm !== true ||
      !Number.isInteger(b.revision) ||
      !Array.isArray(b.clients) ||
      !b.clients.length ||
      b.clients.length > 200 ||
      b.clients.some(
        (p) => typeof p.id !== "string" || typeof p.sourceKey !== "string",
      )
    )
      throw fail(
        "Review up to 200 selected clients and confirm they share this verified building.",
      );
    const current = new Map((await clients()).map((p) => [p.id, p]));
    if (
      b.clients.some(
        (p) =>
          !current.has(p.id) || addressKey(current.get(p.id)) !== p.sourceKey,
      )
    )
      throw fail(
        "The registry address information changed. Reload the client selection.",
        409,
      );
    res.json(
      await update(
        req,
        "locations.client_building.reviewed",
        (s) => {
          if (!s.buildings[b.buildingId])
            throw fail("Select a reviewed residential building record.");
          for (const p of b.clients)
            s.bindings[p.id] = {
              buildingId: b.buildingId,
              sourceKey: p.sourceKey,
              buildingAddressKey: buildingAddressKey(s.buildings[b.buildingId]),
              verifiedAt: new Date().toISOString(),
            };
          return b.clients;
        },
        b.revision,
      ),
    );
  });
  app.post("/api/locations/refresh", async (req, res) => {
    const state = await readLocations(db),
      {
        destination = "centre",
        buildingIds = [],
        force = false,
      } = req.body || {},
      target =
        destination === "centre" ? state.centre : state.venues[destination];
    if (
      !target ||
      target.status !== "Verified" ||
      !Array.isArray(buildingIds) ||
      buildingIds.length < 1 ||
      buildingIds.length > 3 ||
      buildingIds.some((id) => state.buildings[id]?.status !== "Verified")
    )
      throw fail(
        "Choose a verified destination and one to three verified buildings.",
      );
    const completed = [];
    for (const id of [...new Set(buildingIds)]) {
      const building = state.buildings[id],
        key = routeKey(building, target),
        previous = state.routes[key];
      if (
        !force &&
        previous?.walkingM != null &&
        Date.now() >= Date.parse(previous.calculatedAt) &&
        Date.now() - Date.parse(previous.calculatedAt) < 30 * 86400000
      ) {
        completed.push({ id, status: "Using cached walking route" });
        continue;
      }
      let result = {
        buildingId: id,
        targetId: target.id,
        straightM: straightDistance(building, target),
        walkingM: null,
        timeSeconds: null,
        source: "Straight-line fallback only",
        calculatedAt: new Date().toISOString(),
        status: "Walking route unavailable",
      };
      try {
        result = { ...result, ...(await oneMap.walk(building, target)) };
      } catch (e) {
        result.status =
          e.status === 429
            ? "Rate limited"
            : !oneMap.configured()
              ? "OneMap not configured"
              : /authentication|token/i.test(e.message || "")
                ? "OneMap authentication unavailable"
                : /unavailable or timed out/i.test(e.message || "")
                  ? "OneMap temporarily unavailable"
                  : "Walking route not found";
        if (
          previous?.walkingM != null &&
          result.status !== "Walking route not found"
        )
          result = {
            ...previous,
            status: result.status,
            straightM: result.straightM,
            lastRefreshAttempt: new Date().toISOString(),
            lastRefreshFailed: true,
          };
      }
      await update(req, "locations.distance.refreshed", (s) => {
        s.routes[key] = result;
        const keys = Object.keys(s.routes);
        for (const k of keys.slice(0, Math.max(0, keys.length - 5000)))
          delete s.routes[k];
        return null;
      });
      completed.push({ id, status: result.status });
      if (
        [
          "Rate limited",
          "OneMap not configured",
          "OneMap authentication unavailable",
          "OneMap temporarily unavailable",
        ].includes(result.status)
      )
        break;
    }
    res.json({
      completed,
      remaining: buildingIds.filter(
        (id) => !completed.some((r) => r.id === id),
      ),
      batchId: randomUUID(),
    });
  });
}
