import { participationPatterns } from "./patterns.js";
import { dataTransaction } from "./data-management.js";
import { todaySG } from "./domain.js";
import { ensureLocations, locationRow } from "./location-store.js";
import { decodeLocations } from "./location-model.js";
import { normalizePatternPreferences } from "../shared/participation-compat.js";

export function mountPatterns(app, { db, storage }) {
  const allowed = (req) => {
    if (!["admin", "planner"].includes(req.user.role))
      throw Object.assign(
        Error("Participation patterns are restricted to authorised staff."),
        { status: 403 },
      );
  };
  const report = async (query) => {
    if (query.dimension === "eventType" || query.second === "eventType")
      throw Object.assign(
        Error(
          "Use the programme-type aggregate analysis for overlapping Event Types.",
        ),
        { status: 400 },
      );
    if (
      [query.dimension, query.second].some((d) =>
        ["distance", "locationBlock", "block"].includes(d),
      )
    )
      await ensureLocations(db);
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
        if (query.basis === "dated")
          state.profileHistory = yield tx
            .prepare(
              "SELECT participant_id,details,effective_date,created,id FROM profile_history WHERE effective_date IS NOT NULL AND effective_date<=?",
            )
            .all(query.to || todaySG());
        if (
          [query.dimension, query.second].some((d) =>
            ["distance", "locationBlock", "block"].includes(d),
          )
        )
          state.locations = decodeLocations(yield locationRow(tx));
        return participationPatterns(state, query);
      },
      true,
    );
  };
  app.get("/api/participation-patterns", async (req, res) => {
    allowed(req);
    res.json(await report(req.query));
  });
  // Shared preferences table; partial updates preserve other staff workspaces.
  app.put("/api/participation-patterns/preferences", async (req, res) => {
    allowed(req);
    const { validatePatternQuery } = await import("./patterns.js");
    const value = normalizePatternPreferences(req.body, todaySG()).query;
    validatePatternQuery(value);
    await dataTransaction(
      db,
      function* (tx) {
        const row = yield tx
          .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
          .get(req.user.id);
        const existing = row
          ? JSON.parse(row.value)
          : { views: [], active: "", template: "Overview" };
        yield tx
          .prepare(
            "INSERT INTO staff_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
          )
          .run(req.user.id, JSON.stringify({ ...existing, patterns: value }));
        yield storage.audit(tx, req.user.id, "patterns.preferences.saved", {});
      },
      false,
      ["staff_preferences"],
    );
    res.json({ ok: true });
  });
  app.get("/api/participation-patterns/export", async (req, res) => {
    allowed(req);
    if (
      [req.query.dimension, req.query.second].some((d) =>
        ["block", "locationBlock"].includes(d),
      )
    )
      throw Object.assign(
        Error(
          "Residential building details are restricted to staff analysis and excluded from general management reports. Export distance bands instead.",
        ),
        { status: 403 },
      );
    const value = await report(req.query);
    if (value.location) {
      value.location.destinations = [];
      value.location.blockRows = null;
      value.location.destination =
        req.query.destination && req.query.destination !== "centre"
          ? "Selected verified programme venue"
          : "Main GLOW BB centre";
    }
    // Export exactly the same protected aggregate contract as the screen.
    await storage.audit(db, req.user.id, "patterns.summary.exported", {
      dimension: value.dimension,
      scope: value.scope,
    });
    res.json(value);
  });
}
