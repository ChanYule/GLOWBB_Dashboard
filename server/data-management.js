import { randomUUID } from "node:crypto";
import { hash } from "./domain.js";
import { ensureOperations } from "./operations-routes.js";

const fail = (status, message) => Object.assign(Error(message), { status });
const admin = (req) => {
  if (req.user.role !== "admin")
    throw fail(403, "Administrator access is required.");
};
// Parent-first order for restoring exact source rows, including all foreign keys.
const tables = {
  participants: ["id", "details"],
  programmes: ["id", "name", "domain", "optional"],
  sessions: ["id", "programme_id", "date", "start", "end", "venue", "optional"],
  imports: ["id", "created", "user_id", "summary"],
  attendance: [
    "id",
    "participant_id",
    "session_id",
    "source_session",
    "import_id",
  ],
  targets: ["id", "metric", "value", "start", "end", "programme_id"],
  decisions: ["programme_id", "status", "notes", "updated", "user_id"],
  opportunity_decisions: ["target_id", "status", "notes", "updated", "user_id"],
  risk_observations: ["id", "participant_id", "raw", "imported"],
  participant_profiles: [
    "participant_id",
    "revision",
    "details",
    "updated",
    "user_id",
  ],
  profile_history: [
    "id",
    "participant_id",
    "details",
    "created",
    "effective_date",
    "source",
    "user_id",
  ],
  profile_observations: ["id", "participant_id", "field", "raw", "recorded"],
  participant_feedback: [
    "id",
    "participant_id",
    "date",
    "details",
    "created",
    "user_id",
  ],
  needs_actions: [
    "id",
    "kind",
    "revision",
    "details",
    "created",
    "updated",
    "user_id",
  ],
  member_registry: ["participant_id", "snapshot", "details"],
  assessment_monthly: [
    "id",
    "fingerprint",
    "month",
    "type",
    "total",
    "reported_as_of",
    "complete",
    "created",
    "user_id",
  ],
  operational_targets: ["id", "month", "metric", "value"],
};
const names = Object.keys(tables);
const reversed = [...names].reverse();
const backupKind = "workspace-data-v1";
// SQLite executes the whole generator synchronously, so another request cannot
// accidentally write inside its transaction. PostgreSQL awaits each statement.
function transaction(db, work, readOnly = false) {
  if (db.transaction)
    return db.transaction(
      async (tx) => {
        if (!readOnly)
          await tx
            .prepare(
              `LOCK TABLE ${[...names, "settings", "import_previews", "attendance_backups"].join(",")} IN SHARE ROW EXCLUSIVE MODE`,
            )
            .run();
        const iterator = work(tx);
        let step = iterator.next();
        while (!step.done) step = iterator.next(await step.value);
        return step.value;
      },
      { readOnly },
    );
  db.exec(readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
  try {
    const iterator = work(db);
    let step = iterator.next();
    while (!step.done) step = iterator.next(step.value);
    db.exec("COMMIT");
    return step.value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function* snapshot(db) {
  const data = {};
  for (const name of names) {
    const rows = yield db.prepare(`SELECT * FROM ${name}`).all();
    data[name] = rows
      .map((row) =>
        Object.fromEntries(tables[name].map((key) => [key, row[key] ?? null])),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  const settings = JSON.parse(
    (yield db.prepare("SELECT value FROM settings WHERE id=1").get()).value,
  );
  return {
    kind: backupKind,
    tables: data,
    registry: settings.registry ?? null,
  };
}
function summary(state) {
  const t = state.tables;
  const sessionMap = new Map(t.sessions.map((s) => [s.id, s]));
  const dates = t.attendance
    .map((a) => sessionMap.get(a.session_id)?.date)
    .filter(Boolean)
    .sort();
  return {
    attendance: t.attendance.length,
    participants: t.participants.length,
    programmes: t.programmes.length,
    sessions: t.sessions.length,
    profiles: t.participant_profiles.length,
    feedback: t.participant_feedback.length,
    actions: t.needs_actions.length,
    registryRows: t.member_registry.length,
    assessments: t.assessment_monthly.length,
    targets: t.targets.length + t.operational_targets.length,
    from: dates[0] || null,
    to: dates.at(-1) || null,
  };
}
function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function selection(input, state) {
  const scope = input?.scope;
  if (!["all-attendance", "date-range", "import", "reset"].includes(scope))
    throw fail(400, "Choose which data to delete.");
  if (
    scope === "date-range" &&
    (!validDate(input.from) || !validDate(input.to) || input.from > input.to)
  )
    throw fail(400, "Choose a valid start and end date.");
  if (
    scope === "import" &&
    (!Number.isSafeInteger(input.importId) ||
      !state.tables.imports.some((i) => i.id === input.importId))
  )
    throw fail(400, "Choose an existing import.");
  return {
    scope,
    ...(scope === "date-range" ? { from: input.from, to: input.to } : {}),
    ...(scope === "import" ? { importId: input.importId } : {}),
  };
}
function affected(state, filter) {
  const sessions = new Map(state.tables.sessions.map((s) => [s.id, s]));
  const rows = state.tables.attendance.filter((a) => {
    if (filter.scope === "import") return a.import_id === filter.importId;
    if (filter.scope === "date-range") {
      const date = sessions.get(a.session_id)?.date;
      return date >= filter.from && date <= filter.to;
    }
    return true;
  });
  const rowIds = new Set(rows.map((a) => a.id));
  const retained = new Set(
    state.tables.attendance
      .filter((a) => !rowIds.has(a.id))
      .map((a) => a.session_id),
  );
  const removedSessions = [...new Set(rows.map((a) => a.session_id))].filter(
    (id) => !retained.has(id),
  );
  return {
    rows,
    removedSessions,
    counts:
      filter.scope === "reset"
        ? summary(state)
        : {
            attendance: rows.length,
            sessions: removedSessions.length,
            participants: 0,
            programmes: 0,
            profiles: 0,
            feedback: 0,
            actions: 0,
            registryRows: 0,
            assessments: 0,
            targets: 0,
          },
    affectedPeople: new Set(rows.map((a) => a.participant_id)).size,
  };
}
function* backup(db, state, user, reason) {
  const id = randomUUID();
  yield db
    .prepare("INSERT INTO attendance_backups VALUES(?,?,?,?)")
    .run(
      id,
      new Date().toISOString(),
      user,
      JSON.stringify({ ...state, reason }),
    );
  return id;
}
function* registrySetting(db, registry) {
  const settings = JSON.parse(
    (yield db.prepare("SELECT value FROM settings WHERE id=1").get()).value,
  );
  settings.registry = registry || {
    complete: false,
    snapshot: null,
    asOf: null,
    source: null,
  };
  yield db
    .prepare("UPDATE settings SET value=? WHERE id=1")
    .run(JSON.stringify(settings));
}
function* writeAudit(db, user, action, details) {
  yield db
    .prepare(
      "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
    )
    .run(new Date().toISOString(), user, action, JSON.stringify(details));
}
function* readBackup(db, id) {
  const row = yield db
    .prepare("SELECT payload FROM attendance_backups WHERE id=?")
    .get(id);
  if (!row) throw fail(404, "Backup not found.");
  const state = JSON.parse(row.payload);
  if (
    state.kind !== backupKind ||
    names.some((name) => !Array.isArray(state.tables?.[name]))
  )
    throw fail(
      400,
      "This older backup supports download only. Use a data-management backup to restore here.",
    );
  return state;
}
export function mountDataManagement(app, { db }) {
  app.use("/api/data-management", async (req, _res, next) => {
    admin(req);
    await ensureOperations(db);
    next();
  });
  app.get("/api/data-management", async (req, res) => {
    admin(req);
    res.json(
      await transaction(
        db,
        function* (tx) {
          const state = yield* snapshot(tx);
          const backups = yield tx
            .prepare(
              "SELECT id,created,payload FROM attendance_backups ORDER BY created DESC",
            )
            .all();
          return {
            counts: summary(state),
            imports: [...state.tables.imports]
              .reverse()
              .slice(0, 100)
              .map((i) => ({
                id: i.id,
                created: i.created,
                imported: JSON.parse(i.summary).imported || 0,
                remaining: state.tables.attendance.filter(
                  (a) => a.import_id === i.id,
                ).length,
              })),
            backups: backups.map((b) => {
              const data = JSON.parse(b.payload);
              return {
                id: b.id,
                created: b.created,
                restorable: data.kind === backupKind,
                reason: data.reason || "Before attendance replacement",
                attendance:
                  data.kind === backupKind
                    ? data.tables.attendance.length
                    : data.attendance?.length || 0,
              };
            }),
          };
        },
        true,
      ),
    );
  });
  app.post("/api/data-management/preview", async (req, res) => {
    admin(req);
    res.json(
      await transaction(db, function* (tx) {
        const state = yield* snapshot(tx);
        const operation =
          req.body?.operation === "restore" ? "restore" : "delete";
        let scope, restoreState;
        if (operation === "restore") {
          restoreState = yield* readBackup(tx, req.body.backupId);
          scope = { backupId: req.body.backupId };
        } else scope = selection(req.body, state);
        const change = operation === "delete" ? affected(state, scope) : null;
        const counts = restoreState ? summary(restoreState) : change.counts;
        if (
          operation === "delete" &&
          (scope.scope === "reset"
            ? !names.some((name) => state.tables[name].length)
            : !change.rows.length)
        )
          throw fail(400, "There is no data to delete in this selection.");
        yield tx
          .prepare("DELETE FROM import_previews WHERE expires < ?")
          .run(Date.now());
        const id = randomUUID();
        const preview = {
          kind: "data-management",
          operation,
          selection: scope,
          fingerprint: hash(state),
          backupFingerprint: restoreState ? hash(restoreState) : null,
        };
        yield tx
          .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
          .run(id, req.user.id, Date.now() + 1200000, JSON.stringify(preview));
        return {
          id,
          operation,
          selection: scope,
          counts,
          current: summary(state),
          affectedPeople: change?.affectedPeople ?? 0,
          confirmation:
            operation === "restore"
              ? "RESTORE DATA"
              : scope.scope === "reset"
                ? "RESET DATA"
                : "DELETE ATTENDANCE",
        };
      }),
    );
  });
  app.post("/api/data-management/confirm", async (req, res) => {
    admin(req);
    res.json(
      await transaction(db, function* (tx) {
        const preview = yield tx
          .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
          .get(req.body?.id, req.user.id);
        if (!preview || preview.expires < Date.now())
          throw fail(409, "Preview expired. Review your selection again.");
        const p = JSON.parse(preview.payload);
        if (p.kind !== "data-management")
          throw fail(400, "This preview is for a different task.");
        const phrase =
          p.operation === "restore"
            ? "RESTORE DATA"
            : p.selection.scope === "reset"
              ? "RESET DATA"
              : "DELETE ATTENDANCE";
        if (req.body?.confirmation !== phrase)
          throw fail(400, `Type ${phrase} to confirm.`);
        const state = yield* snapshot(tx);
        if (hash(state) !== p.fingerprint)
          throw fail(
            409,
            "Saved data changed after this preview. Review a fresh preview before continuing.",
          );
        const restoreState =
          p.operation === "restore"
            ? yield* readBackup(tx, p.selection.backupId)
            : null;
        if (restoreState && hash(restoreState) !== p.backupFingerprint)
          throw fail(409, "The backup changed. Review it again.");
        const backupId = yield* backup(
          tx,
          state,
          req.user.id,
          p.operation === "restore"
            ? "Before restoring saved data"
            : p.selection.scope === "reset"
              ? "Before resetting programme data"
              : "Before deleting attendance",
        );
        let counts;
        if (p.operation === "restore" || p.selection.scope === "reset") {
          counts = restoreState ? summary(restoreState) : summary(state);
          for (const name of reversed)
            yield tx.prepare(`DELETE FROM ${name}`).run();
          if (restoreState)
            for (const name of names)
              for (const row of restoreState.tables[name])
                yield tx
                  .prepare(
                    `INSERT INTO ${name}(${tables[name].join(",")}) VALUES(${tables[name].map(() => "?").join(",")})`,
                  )
                  .run(...tables[name].map((key) => row[key]));
          yield* registrySetting(tx, restoreState?.registry);
        } else {
          const change = affected(state, p.selection);
          counts = change.counts;
          for (const row of change.rows)
            yield tx.prepare("DELETE FROM attendance WHERE id=?").run(row.id);
          for (const id of change.removedSessions)
            yield tx.prepare("DELETE FROM sessions WHERE id=?").run(id);
        }
        // Stale import/registry previews must never repopulate data after a reset.
        yield tx.prepare("DELETE FROM import_previews").run();
        yield* writeAudit(
          tx,
          req.user.id,
          p.operation === "restore" ? "data.restore" : "data.delete",
          { selection: p.selection, counts, backupId },
        );
        return { ok: true, operation: p.operation, counts, backupId };
      }),
    );
  });
  app.delete("/api/data-management/backups/:id", async (req, res) => {
    admin(req);
    if (req.body?.confirmation !== "DELETE BACKUP")
      throw fail(400, "Type DELETE BACKUP to permanently remove this backup.");
    res.json(
      await transaction(db, function* (tx) {
        const row = yield tx
          .prepare("SELECT id FROM attendance_backups WHERE id=?")
          .get(req.params.id);
        if (!row) throw fail(404, "Backup not found.");
        yield tx
          .prepare("DELETE FROM attendance_backups WHERE id=?")
          .run(req.params.id);
        yield* writeAudit(tx, req.user.id, "data.backup-delete", {
          id: req.params.id,
        });
        return { ok: true };
      }),
    );
  });
}
