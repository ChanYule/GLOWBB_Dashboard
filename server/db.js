import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { defaults, hash } from "./domain.js";
export function openDb(
  path = process.env.DB_PATH || resolve("data/glowbb.sqlite"),
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
 INSERT OR IGNORE INTO schema_version VALUES(1);
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','planner','viewer')));
 CREATE TABLE IF NOT EXISTS logins(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY,details TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS programmes(id TEXT PRIMARY KEY,name TEXT NOT NULL,domain TEXT NOT NULL,optional TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,programme_id TEXT NOT NULL REFERENCES programmes(id),date TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,venue TEXT,optional TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS attendance(id TEXT PRIMARY KEY,participant_id TEXT NOT NULL REFERENCES participants(id),session_id TEXT NOT NULL REFERENCES sessions(id),source_session TEXT NOT NULL,import_id INTEGER);
 CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY,created TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),summary TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS targets(id INTEGER PRIMARY KEY,metric TEXT NOT NULL,value INTEGER NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,programme_id TEXT REFERENCES programmes(id));
 CREATE TABLE IF NOT EXISTS decisions(programme_id TEXT PRIMARY KEY REFERENCES programmes(id),status TEXT NOT NULL,notes TEXT NOT NULL,updated TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS opportunity_decisions(target_id INTEGER PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,status TEXT NOT NULL,notes TEXT NOT NULL,updated TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,created TEXT NOT NULL,user_id INTEGER,action TEXT NOT NULL,details TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_date ON sessions(date);
 CREATE INDEX IF NOT EXISTS attendance_session ON attendance(session_id);`);
  db.exec(
    `CREATE TABLE IF NOT EXISTS import_previews(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires REAL NOT NULL,payload TEXT NOT NULL);`,
  );
  db.exec(`CREATE TABLE IF NOT EXISTS staff_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id),value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS risk_observations(id TEXT PRIMARY KEY,participant_id TEXT NOT NULL REFERENCES participants(id),raw TEXT,imported TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance_backups(id TEXT PRIMARY KEY,created TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),payload TEXT NOT NULL);
INSERT OR IGNORE INTO schema_version VALUES(3);`);
  db.exec(`CREATE TABLE IF NOT EXISTS participant_profiles(participant_id TEXT PRIMARY KEY REFERENCES participants(id),revision INTEGER NOT NULL,details TEXT NOT NULL,updated TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS profile_history(id TEXT PRIMARY KEY,participant_id TEXT NOT NULL REFERENCES participants(id),details TEXT NOT NULL,created TEXT NOT NULL,effective_date TEXT,source TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS profile_observations(id TEXT PRIMARY KEY,participant_id TEXT NOT NULL REFERENCES participants(id),field TEXT NOT NULL,raw TEXT,recorded TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participant_feedback(id TEXT PRIMARY KEY,participant_id TEXT NOT NULL REFERENCES participants(id),date TEXT NOT NULL,details TEXT NOT NULL,created TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS needs_actions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,revision INTEGER NOT NULL,details TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS member_registry(participant_id TEXT NOT NULL REFERENCES participants(id),snapshot TEXT NOT NULL,details TEXT NOT NULL,PRIMARY KEY(participant_id,snapshot));
CREATE INDEX IF NOT EXISTS feedback_participant ON participant_feedback(participant_id,date);
CREATE INDEX IF NOT EXISTS profile_history_participant ON profile_history(participant_id,created);
INSERT OR IGNORE INTO schema_version VALUES(4);`);
  db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(
    JSON.stringify(defaults),
  );
  return db;
}
export function readData(db) {
  return {
    participants: db
      .prepare("SELECT * FROM participants")
      .all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.details) })),
    programmes: db
      .prepare("SELECT * FROM programmes")
      .all()
      .map((r) => ({ ...r, optional: JSON.parse(r.optional) })),
    sessions: db
      .prepare("SELECT * FROM sessions")
      .all()
      .map((r) => ({
        id: r.id,
        programmeId: r.programme_id,
        date: r.date,
        start: r.start,
        end: r.end,
        venue: r.venue,
        optional: JSON.parse(r.optional),
      })),
    attendance: db
      .prepare("SELECT * FROM attendance")
      .all()
      .map((r) => ({
        id: r.id,
        participantId: r.participant_id,
        sessionId: r.session_id,
      })),
  };
}
export function getSettings(db) {
  return {
    ...defaults,
    ...JSON.parse(
      db.prepare("SELECT value FROM settings WHERE id=1").get().value,
    ),
  };
}
export function audit(db, user, action, details = {}) {
  db.prepare(
    "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
  ).run(new Date().toISOString(), user, action, JSON.stringify(details));
}
export function saveImport(db, parsed, inspection, user) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (inspection.mode === "replace") {
      db.prepare("INSERT INTO attendance_backups VALUES(?,?,?,?)").run(
        crypto.randomUUID(),
        new Date().toISOString(),
        user,
        JSON.stringify({
          ...readData(db),
          attendanceRows: db.prepare("SELECT * FROM attendance").all(),
        }),
      );
      db.prepare("DELETE FROM attendance").run();
    }
    for (const { id, ...details } of inspection.updates || [])
      db.prepare("UPDATE participants SET details=? WHERE id=?").run(
        JSON.stringify(details),
        id,
      );
    const summary = {
      updatedSessions: inspection.sessionUpdates?.length || 0,
      updatedProfiles: inspection.updates?.length || 0,
      mode: inspection.mode || "add",
      raw: parsed.rawRows,
      imported: inspection.fresh.length,
      duplicates: inspection.duplicates.length,
      invalid: parsed.issues.length,
      skipped: inspection.conflicts.filter((c) => c.action !== "update").length,
      exactDuplicates: parsed.exactDuplicates,
      warnings: inspection.warnings.length,
      invalidAgeCount: parsed.issues.filter((i) => i.code === "invalidAge")
        .length,
      invalidSessionCount: parsed.issues.filter(
        (i) => i.code === "invalidSession",
      ).length,
      namingVariantCount: inspection.variants.length,
    };
    const id = Number(
      db
        .prepare("INSERT INTO imports(created,user_id,summary) VALUES(?,?,?)")
        .run(new Date().toISOString(), user, JSON.stringify(summary))
        .lastInsertRowid,
    );
    for (const r of inspection.fresh) {
      const { id: pid, ...details } = r.participant;
      db.prepare("INSERT OR IGNORE INTO participants VALUES(?,?)").run(
        pid,
        JSON.stringify({
          ...details,
          profileImportedAt: new Date().toISOString(),
        }),
      );
      db.prepare(
        "INSERT OR IGNORE INTO programmes(id,name,domain) VALUES(?,?,?)",
      ).run(r.programme.id, r.programme.name, r.programme.domain);
      db.prepare(
        "INSERT OR IGNORE INTO sessions(id,programme_id,date,start,end,optional) VALUES(?,?,?,?,?,?)",
      ).run(
        r.session.id,
        r.programme.id,
        r.session.date,
        r.session.start,
        r.session.end,
        JSON.stringify(r.session.optional || {}),
      );
      db.prepare("INSERT OR IGNORE INTO attendance VALUES(?,?,?,?,?)").run(
        r.id,
        pid,
        r.session.id,
        r.sourceSession,
        id,
      );
    }
    for(const s of inspection.sessionUpdates||[])db.prepare('UPDATE sessions SET optional=? WHERE id=?').run(JSON.stringify(s.optional),s.id);
    for (const { id, ...details } of inspection.updates || [])
      db.prepare("UPDATE participants SET details=? WHERE id=?").run(
        JSON.stringify(details),
        id,
      );
    for (const r of parsed.rows)
      if (
        "riskRaw" in r.participant &&
        db
          .prepare("SELECT id FROM participants WHERE id=?")
          .get(r.participant.id)
      )
        db.prepare(
          "INSERT OR IGNORE INTO risk_observations VALUES(?,?,?,?)",
        ).run(
          hash([r.participant.id, r.session.id, r.participant.riskRaw]),
          r.participant.id,
          r.participant.riskRaw,
          new Date().toISOString(),
        );
    for (const r of parsed.rows)
      for (const field of [
        "age",
        "gender",
        "race",
        "client",
        "boundary",
        "livingRaw",
        "maritalRaw",
        "cfs",
        "riskRaw",
        "preferredLanguage",
        "registrationDate",
        "cfsAssessedOn",
      ]) {
        if (
          !(field in r.participant) ||
          !db
            .prepare("SELECT id FROM participants WHERE id=?")
            .get(r.participant.id)
        )
          continue;
        db.prepare(
          "INSERT OR IGNORE INTO profile_observations VALUES(?,?,?,?,?)",
        ).run(
          hash([r.participant.id, field, r.participant[field]]),
          r.participant.id,
          field,
          typeof r.participant[field] === "boolean"
            ? String(r.participant[field])
            : r.participant[field],
          new Date().toISOString(),
        );
      }
    audit(db, user, "attendance.import", summary);
    db.exec("COMMIT");
    return summary;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, stored) {
  try {
    const [salt, hex] = stored.split(":");
    const actual = scryptSync(password, salt, 64),
      expected = Buffer.from(hex, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
