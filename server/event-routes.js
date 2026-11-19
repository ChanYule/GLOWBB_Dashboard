import { randomUUID } from "node:crypto";
import {staffAnalysisState} from './staff-analysis.js';
import { dataTransaction } from "./data-management.js";
import { hash } from "./domain.js";
import { eventTypeInventory } from "./event-types.js";
import { eventTypeReport, programmeDomainReport, validateEventQuery } from "./event-report.js";
import { ensureLocations, locationRow } from "./location-store.js";
import { decodeLocations } from "./location-model.js";
const fail = (status, message) => Object.assign(Error(message), { status });
export function mountEventTypes(app, { db, storage }) {
  const allowed = (req) => {
    if (!["admin", "planner"].includes(req.user.role))
      throw fail(
        403,
        "Programme type analysis is restricted to authorised staff.",
      );
  };
  async function report(query,user,combined=false) {
    validateEventQuery(query);
    if (query.factor === "distance") await ensureLocations(db);
    return dataTransaction(
      db,
      function* (tx) {
        const state = storage.readPlanningState
          ? yield storage.readPlanningState(tx)
          : {
              data: yield storage.readData(tx),
              settings: yield storage.getSettings(tx),
              registry: yield tx.prepare("SELECT * FROM member_registry").all(),
              profiles: yield tx
                .prepare("SELECT * FROM participant_profiles")
                .all(),
              feedback: yield tx
                .prepare("SELECT * FROM participant_feedback")
                .all(),
            };
        if (query.factor === "distance")
          state.locations = decodeLocations(yield locationRow(tx));
        return (combined?programmeDomainReport:eventTypeReport)(staffAnalysisState(state,user), query);
      },
      true,
    );
  }
  app.get("/api/event-types/report", async (req, res) => {
    allowed(req);
    res.json(await report(req.query,req.user));
  });
  app.get('/api/programme-domains/report',async(req,res)=>{allowed(req);res.json(await report(req.query,req.user,true));});
  app.get('/api/programme-domains/export',async(req,res)=>{
    allowed(req);const q=validateEventQuery(req.query);
    if(['factor','group','gender','race','cfs','ageBand','client','boundary'].some(key=>q[key])||['male','minority'].includes(q.target))throw fail(403,'Reset participant-group filters before sharing this domain report.');
    res.json(await report(req.query,req.user,true));
  });
  app.put("/api/event-types/preferences", async (req, res) => {
    allowed(req);
    validateEventQuery(req.body);
    await dataTransaction(
      db,
      function* (tx) {
        const row = yield tx
          .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
          .get(req.user.id);
        const existing = row ? JSON.parse(row.value) : {};
        yield tx
          .prepare(
            "INSERT INTO staff_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
          )
          .run(
            req.user.id,
            JSON.stringify({ ...existing, eventTypes: req.body }),
          );
      },
      false,
      ["staff_preferences"],
    );
    res.json({ ok: true });
  });
  app.put("/api/programme-domains/preferences", async (req, res) => {
    allowed(req);
    validateEventQuery(req.body);
    await dataTransaction(
      db,
      function* (tx) {
        const row = yield tx
          .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
          .get(req.user.id);
        const existing = row ? JSON.parse(row.value) : {};
        yield tx
          .prepare(
            "INSERT INTO staff_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
          )
          .run(
            req.user.id,
            JSON.stringify({ ...existing, programmeDomains: req.body }),
          );
      },
      false,
      ["staff_preferences"],
    );
    res.json({ ok: true });
  });
  app.get("/api/event-types/export", async (req, res) => {
    allowed(req);
    const q = validateEventQuery(req.query);
    if (
      q.factor ||
      q.group ||
      q.gender ||
      q.race ||
      q.cfs ||
      q.ageBand ||
      q.client ||
      q.boundary ||
      ["male", "minority"].includes(q.target)
    )
      throw fail(
        403,
        "Reset sensitive participant comparisons before sharing a programme-mix report.",
      );
    res.json(await report(req.query,req.user));
  });
  app.get("/api/event-types/mappings", async (req, res) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
    const settings = await storage.getSettings(db);
    res.json({
      rows: eventTypeInventory(await storage.readData(db), settings),
      fingerprint: hash(settings.eventTypeMappings || {}),
    });
  });
  app.post("/api/event-types/mappings/preview", async (req, res) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
    const settings = await storage.getSettings(db),
      inventory = eventTypeInventory(await storage.readData(db), settings),
      known = new Set(inventory.map((t) => t.raw));
    if (!Array.isArray(req.body?.rows) || req.body.rows.length > 200)
      throw fail(400, "Review up to 200 imported labels.");
    const mappings = Object.create(null);
    for (const row of req.body.rows) {
      if (!known.has(row.raw) || Object.hasOwn(mappings, row.raw))
        throw fail(400, "Review distinct imported source labels.");
      const value = {};
      for (const key of ["label", "parent", "secondary"]) {
        const text = row[key] ?? "";
        if (
          typeof text !== "string" ||
          text.length > 150 ||
          [...text].some((c) => c.charCodeAt(0) < 32)
        )
          throw fail(400, "Use plain display labels up to 150 characters.");
        value[key] = text.trim();
      }
      if (!value.label) throw fail(400, "A display label is required.");
      mappings[row.raw] = value;
    }
    const id = randomUUID(),
      payload = {
        kind: "event-type-mappings",
        mappings,
        fingerprint: hash(settings.eventTypeMappings || {}),
        inventory: hash(inventory.map((t) => t.raw)),
        before: settings.eventTypeMappings || {},
      };
    await db
      .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
      .run(id, req.user.id, Date.now() + 1200000, JSON.stringify(payload));
    res.json({
      id,
      rows: inventory.map((r) => ({
        ...r,
        proposed: mappings[r.raw] ||
          settings.eventTypeMappings?.[r.raw] || {
            label: r.raw,
            parent: "",
            secondary: "",
          },
      })),
      note: "Only reporting labels change. Raw source values and historical session identities remain intact. Parent/secondary metadata does not split combined labels.",
    });
  });
  app.post("/api/event-types/mappings/confirm", async (req, res) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
    if (req.body?.reviewed !== true)
      throw fail(400, "Review and confirm the mapping preview.");
    await dataTransaction(
      db,
      function* (tx) {
        const row = yield tx
          .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
          .get(req.body.id, req.user.id);
        if (!row || row.expires < Date.now())
          throw fail(409, "Mapping preview expired.");
        const p = JSON.parse(row.payload);
        if (p.kind !== "event-type-mappings")
          throw fail(400, "Choose the mapping preview.");
        const settings = yield storage.getSettings(tx),
          data = yield storage.readData(tx);
        if (
          p.fingerprint !== hash(settings.eventTypeMappings || {}) ||
          p.inventory !==
            hash(eventTypeInventory(data, settings).map((t) => t.raw))
        )
          throw fail(
            409,
            "Source labels or mappings changed. Review a fresh preview.",
          );
        settings.eventTypeMappings = {
          ...settings.eventTypeMappings,
          ...p.mappings,
        };
        settings.eventTypeMappingHistory = [
          ...(settings.eventTypeMappingHistory || []),
          {
            before: p.before,
            after: settings.eventTypeMappings,
            at: new Date().toISOString(),
          },
        ];
        yield tx
          .prepare("UPDATE settings SET value=? WHERE id=1")
          .run(JSON.stringify(settings));
        yield storage.audit(tx, req.user.id, "event-types.mappings.reviewed", {
          count: Object.keys(p.mappings).length,
        });
        yield tx
          .prepare("DELETE FROM import_previews WHERE id=?")
          .run(req.body.id);
      },
      false,
      ["settings", "import_previews"],
    );
    res.json({ ok: true });
  });
}
