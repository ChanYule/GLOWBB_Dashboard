import { randomUUID } from "node:crypto";
import {
  dataTransaction,
  workspaceSnapshot,
  workspaceTables,
} from "./data-management.js";
import { hash, defaults } from "./domain.js";
import { CENTRES, centreById } from "../shared/centres.js";
const migrationNote = 'Choose explicit programme mappings based on source provenance. Completed allocations remain recorded; pending allocations can resume only into the reviewed centre. Source data stays in the protected legacy archive. The earlier registry is GLOW Bukit Batok only.';
const fail = (status, message) => Object.assign(Error(message), { status });
async function snapshot(db) {
  return dataTransaction(
    db,
    function* (tx) {
      const state = yield* workspaceSnapshot(tx);
      const settings = JSON.parse(
        (yield tx.prepare("SELECT value FROM settings WHERE id=1").get()).value,
      );
      const operationalSettings = (yield tx
        .prepare("SELECT value FROM operational_settings WHERE id=1")
        .get()).value;
      return { ...state, settings, operationalSettings };
    },
    true,
  );
}
export function mountCentreMigration(
  app,
  { control, workspaces, access, audit, mirror },
) {
  const admin = (req) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
  };
  app.get("/api/centres/migration", async (req, res) => {
    admin(req);
    if (control.dialect === "postgres") {
      const {rows:[result]} = await control.query(`WITH session_counts AS (
        SELECT programme_id,COUNT(*)::int AS sessions FROM glowbb.sessions GROUP BY programme_id
      ), attendance_counts AS (
        SELECT s.programme_id,COUNT(*)::int AS attendance
        FROM glowbb.attendance a JOIN glowbb.sessions s ON s.id=a.session_id GROUP BY s.programme_id
      ), catalogue AS (
        SELECT p.id,p.name,l.centre_id AS "assignedCentreId",l.status AS "assignmentStatus",
          COALESCE(s.sessions,0) AS sessions,COALESCE(a.attendance,0) AS attendance
        FROM glowbb.programmes p LEFT JOIN glowbb.legacy_allocations l ON l.programme_id=p.id
        LEFT JOIN session_counts s ON s.programme_id=p.id LEFT JOIN attendance_counts a ON a.programme_id=p.id
      )
      SELECT (SELECT COUNT(*)::int FROM glowbb.attendance) AS "legacyAttendance",
        (SELECT COUNT(*)::int FROM glowbb.participants) AS participants,
        (SELECT COUNT(*)::int FROM glowbb.member_registry) AS registry,
        (SELECT COALESCE(SUM(attendance),0)::int FROM catalogue WHERE "assignmentStatus" IS DISTINCT FROM 'Complete') AS attendance,
        (SELECT COALESCE(json_agg(c ORDER BY c.id),'[]') FROM catalogue c) AS programmes`);
      return res.json({...result,note: migrationNote});
    }
    const state = await snapshot(control),
      t = state.tables,
      allocations = await control
        .prepare("SELECT * FROM legacy_allocations")
        .all();
    res.json({
      fingerprint: hash(state),
      attendance: t.attendance.filter(
        (a) =>
          !t.sessions.some(
            (s) =>
              s.id === a.session_id &&
              allocations.some(
                (r) =>
                  r.programme_id === s.programme_id && r.status === "Complete",
              ),
          ),
      ).length,
      legacyAttendance: t.attendance.length,
      participants: t.participants.length,
      registry: t.member_registry.length,
      programmes: t.programmes.map((p) => ({
        id: p.id,
        name: p.name,
        assignedCentreId:
          allocations.find((r) => r.programme_id === p.id)?.centre_id || null,
        assignmentStatus:
          allocations.find((r) => r.programme_id === p.id)?.status || null,
        sessions: t.sessions.filter((s) => s.programme_id === p.id).length,
        attendance: t.attendance.filter((a) =>
          t.sessions.some(
            (s) => s.id === a.session_id && s.programme_id === p.id,
          ),
        ).length,
      })),
      note: migrationNote,
    });
  });
  app.post("/api/centres/migration/preview", async (req, res) => {
    admin(req);
    const {
        assignments = {},
        reason = "",
        includeGlowRegistry = false,
        configurationCentre = "",
      } = req.body || {},
      a = await access(req.user),
      state = await snapshot(control);
    if (
      !assignments ||
      typeof assignments !== "object" ||
      Array.isArray(assignments) ||
      typeof reason !== "string" ||
      reason.trim().length < 10 ||
      !Object.entries(assignments).every(
        ([id, c]) =>
          state.tables.programmes.some((p) => p.id === id) && a.ids.includes(c),
      ) ||
      (configurationCentre &&
        (!centreById(configurationCentre) ||
          !a.ids.includes(configurationCentre))) ||
      (includeGlowRegistry && !a.ids.includes(CENTRES[0].id))
    )
      throw fail(
        400,
        "Choose authorised programme mappings and record the provenance/review reason.",
      );
    const id = randomUUID(),
      payload = {
        kind: "centre-migration",
        fingerprint: hash(state),
        assignments,
        reason,
        includeGlowRegistry: includeGlowRegistry === true,
        configurationCentre,
      };
    await control
      .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
      .run(id, req.user.id, Date.now() + 1200000, JSON.stringify(payload));
    const completed = new Set(
      (
        await control
          .prepare(
            "SELECT programme_id FROM legacy_allocations WHERE status='Complete'",
          )
          .all()
      ).map((r) => r.programme_id),
    );
    res.json({
      id,
      centres: CENTRES.map((c) => ({
        ...c,
        programmes: Object.values(assignments).filter((id) => id === c.id)
          .length,
        sessions: state.tables.sessions.filter(
          (s) => assignments[s.programme_id] === c.id,
        ).length,
        registry:
          c.id === CENTRES[0].id && includeGlowRegistry
            ? state.tables.member_registry.length
            : 0,
      })),
      unassigned: state.tables.programmes.filter(
        (p) => !assignments[p.id] && !completed.has(p.id),
      ).length,
      confirmation: "MIGRATE REVIEWED RECORDS",
      note: "A full server-side recovery snapshot is created before copying. Existing centre data is never overwritten; a conflict stops the affected centre transaction. Legacy data is retained and excluded from centre analytics.",
    });
  });
  app.post("/api/centres/migration/confirm", async (req, res) => {
    admin(req);
    if (req.body.confirmation !== "MIGRATE REVIEWED RECORDS")
      throw fail(400, "Type MIGRATE REVIEWED RECORDS.");
    const row = await control
      .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
      .get(req.body.id, req.user.id);
    if (!row || row.expires < Date.now())
      throw fail(409, "Migration preview expired.");
    const p = JSON.parse(row.payload);
    if (p.kind !== "centre-migration") throw fail(400, "Wrong preview type.");
    const state = await snapshot(control);
    if (hash(state) !== p.fingerprint)
      throw fail(409, "Legacy data changed; review a fresh migration preview.");
    const a = await access(req.user);
    if (
      [
        ...Object.values(p.assignments),
        ...(p.includeGlowRegistry ? [CENTRES[0].id] : []),
        ...(p.configurationCentre ? [p.configurationCentre] : []),
      ].some((id) => !a.ids.includes(id))
    )
      throw fail(403, "Centre access changed.");
    const settings = (
      await control.prepare("SELECT value FROM settings WHERE id=1").get()
    ).value;
    const backupId = "centre-migration-" + req.body.id;
    await control
      .prepare("INSERT OR IGNORE INTO attendance_backups VALUES(?,?,?,?)")
      .run(
        backupId,
        new Date().toISOString(),
        req.user.id,
        JSON.stringify({
          ...state,
          settings: JSON.parse(settings),
          migration: p,
        }),
      );
    // Persist reviewed intent before copying. A failure/crash can be resumed but
    // cannot allocate the same source programme to a different centre.
    await dataTransaction(
      control,
      function* (tx) {
        for (const [programmeId, centreId] of Object.entries(p.assignments)) {
          const existing = yield tx
            .prepare("SELECT * FROM legacy_allocations WHERE programme_id=?")
            .get(programmeId);
          if (existing && existing.centre_id !== centreId)
            throw fail(
              409,
              "This source programme already has a reviewed centre allocation. It cannot be copied into another centre.",
            );
          if (!existing)
            yield tx
              .prepare("INSERT INTO legacy_allocations VALUES(?,?,?,?,?,?)")
              .run(
                programmeId,
                centreId,
                "Pending",
                req.body.id,
                p.reason,
                new Date().toISOString(),
              );
        }
      },
      false,
      ["legacy_allocations"],
    );
    const users = await control
        .prepare("SELECT id,username,role FROM users")
        .all(),
      preferences = await control
        .prepare("SELECT * FROM staff_preferences")
        .all(),
      results = {};
    for (const c of CENTRES) {
      const programmes = state.tables.programmes.filter(
          (r) => p.assignments[r.id] === c.id,
        ),
        registry =
          c.id === CENTRES[0].id && p.includeGlowRegistry
            ? state.tables.member_registry
            : [];
      if (
        !programmes.length &&
        !registry.length &&
        p.configurationCentre !== c.id
      )
        continue;
      const db = await workspaces.get(c.id);
      for (const user of users) await mirror(db, user);
      const sessions = state.tables.sessions.filter((r) =>
          programmes.some((pg) => pg.id === r.programme_id),
        ),
        attendance = state.tables.attendance.filter((r) =>
          sessions.some((s) => s.id === r.session_id),
        ),
        ids = new Set([
          ...attendance.map((r) => r.participant_id),
          ...registry.map((r) => r.participant_id),
        ]);
      const selected = {
        participants: state.tables.participants
          .filter((r) => ids.has(r.id))
          .map((r) => {
            const details = JSON.parse(r.details);
            details.sourceClientStatus = details.client;
            details.client = registry.some(
              (p) =>
                p.participant_id === r.id &&
                JSON.parse(p.details).client === true,
            )
              ? true
              : null;
            return { ...r, details: JSON.stringify(details) };
          }),
        programmes,
        sessions,
        imports: state.tables.imports.filter((r) =>
          attendance.some((a) => a.import_id === r.id),
        ),
        attendance,
        member_registry: registry,
      };
      for (const name of [
        "participant_profiles",
        "profile_history",
        "profile_observations",
        "participant_feedback",
        "risk_observations",
      ])
        selected[name] = state.tables[name]
          .filter((r) => ids.has(r.participant_id))
          .map((r) => {
            if (name !== "participant_profiles" && name !== "profile_history")
              return r;
            const details = JSON.parse(r.details);
            if (details.basic) delete details.basic.client;
            if (details.after?.basic) delete details.after.basic.client;
            return { ...r, details: JSON.stringify(details) };
          });
      selected.targets = state.tables.targets.filter((r) =>
        r.programme_id
          ? programmes.some((p) => p.id === r.programme_id)
          : p.configurationCentre === c.id,
      );
      selected.decisions = state.tables.decisions.filter((r) =>
        programmes.some((p) => p.id === r.programme_id),
      );
      selected.opportunity_decisions =
        state.tables.opportunity_decisions.filter((r) =>
          selected.targets.some((t) => t.id === r.target_id),
        );
      if (p.configurationCentre === c.id) {
        for (const name of [
          "needs_actions",
          "assessment_monthly",
          "operational_targets",
        ])
          selected[name] = state.tables[name];
        if (c.id === CENTRES[0].id)
          selected.location_store = state.tables.location_store;
      }
      results[c.id] = await dataTransaction(db, function* (tx) {
        const prior = yield tx
          .prepare(
            "SELECT details FROM audit WHERE action='centre.legacy.migrated' AND details=?",
          )
          .get(JSON.stringify({ migrationId: req.body.id }));
        if (prior) return { alreadyMigrated: true };
        if (p.configurationCentre === c.id) {
          const current = JSON.parse(
            (yield tx.prepare("SELECT value FROM settings WHERE id=1").get())
              .value,
          );
          delete current.centreId;
          if (hash(current) !== hash(defaults))
            throw fail(
              409,
              "Centre settings were already configured; migrate records without replacing configuration.",
            );
        }
        for (const [name, columns] of Object.entries(workspaceTables))
          for (const r of selected[name] || []) {
            const key =
              name === "member_registry"
                ? ["participant_id", "snapshot"]
                : ["participants", "programmes", "sessions"].includes(name)
                  ? ["id"]
                  : name === "decisions"
                    ? ["programme_id"]
                    : name === "participant_profiles"
                      ? ["participant_id"]
                      : name === "opportunity_decisions"
                        ? ["target_id"]
                        : ["id"];
            const old = yield tx
              .prepare(
                `SELECT * FROM ${name} WHERE ${key.map((k) => k + "=?").join(" AND ")}`,
              )
              .get(...key.map((k) => r[k]));
            if (name === "location_store" && old) {
              const value = JSON.parse(old.value);
              if (
                value.centre?.address ||
                Object.keys(value.buildings || {}).length
              )
                throw fail(
                  409,
                  "Existing verified location configuration is preserved; review separately.",
                );
              yield tx
                .prepare(
                  "UPDATE location_store SET revision=?,value=? WHERE id=1",
                )
                .run(r.revision, r.value);
              continue;
            }
            if (
              old &&
              JSON.stringify(columns.map((k) => old[k] ?? null)) !==
                JSON.stringify(columns.map((k) => r[k] ?? null))
            )
              throw fail(
                409,
                `Existing ${c.name} ${name} conflict. Source and target remain preserved; review separately.`,
              );
            if (!old)
              yield tx
                .prepare(
                  `INSERT INTO ${name}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
                )
                .run(...columns.map((k) => r[k] ?? null));
          }
        if (p.configurationCentre === c.id) {
          const value = { ...JSON.parse(settings), centreId: c.id };
          if (!registry.length)
            value.registry = {
              complete: false,
              snapshot: null,
              asOf: null,
              source: null,
            };
          yield tx
            .prepare("UPDATE settings SET value=? WHERE id=1")
            .run(JSON.stringify(value));
          const operation = (yield tx
            .prepare("SELECT value FROM operational_settings WHERE id=1")
            .get()).value;
          if (
            operation !== JSON.stringify({ inactivityDays: null }) &&
            operation !== state.operationalSettings
          )
            throw fail(
              409,
              "Existing operational settings are preserved; review separately.",
            );
          yield tx
            .prepare("UPDATE operational_settings SET value=? WHERE id=1")
            .run(state.operationalSettings);
          for (const pref of preferences)
            yield tx
              .prepare("INSERT OR IGNORE INTO staff_preferences VALUES(?,?)")
              .run(pref.user_id, pref.value);
        } else if (registry.length) {
          const current = JSON.parse(
            (yield tx.prepare("SELECT value FROM settings WHERE id=1").get())
              .value,
          );
          current.registry = JSON.parse(settings).registry;
          yield tx
            .prepare("UPDATE settings SET value=? WHERE id=1")
            .run(JSON.stringify(current));
        }
        yield tx
          .prepare(
            "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
          )
          .run(
            new Date().toISOString(),
            req.user.id,
            "centre.legacy.migrated",
            JSON.stringify({ migrationId: req.body.id }),
          );
        return { attendance: attendance.length, registry: registry.length };
      });
      for (const programme of programmes)
        await control
          .prepare(
            "UPDATE legacy_allocations SET status=?,updated=? WHERE programme_id=? AND centre_id=?",
          )
          .run("Complete", new Date().toISOString(), programme.id, c.id);
    }
    await audit(req.user, "centres.legacy.migration", {
      backupId,
      centres: Object.keys(results),
      reviewReasonRecorded: true,
    });
    res.json({ backupId, centres: results, legacyPreserved: true });
  });
  app.get("/api/centres/migration/backups", async (req, res) => {
    admin(req);
    res.json(
      await control
        .prepare(
          "SELECT id,created FROM attendance_backups ORDER BY created DESC",
        )
        .all(),
    );
  });
  app.get("/api/centres/migration/backups/:id", async (req, res) => {
    admin(req);
    const row = await control
      .prepare("SELECT payload FROM attendance_backups WHERE id=?")
      .get(req.params.id);
    if (!row) throw fail(404, "Legacy recovery snapshot not found.");
    await audit(req.user, "centres.legacy.backup.downloaded", {
      backupId: req.params.id,
    });
    res
      .type("application/json")
      .set(
        "Content-Disposition",
        'attachment; filename="unassigned-legacy-recovery.json"',
      )
      .send(row.payload);
  });
}
