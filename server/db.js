import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { defaults } from "./domain.js";
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
  return JSON.parse(
    db.prepare("SELECT value FROM settings WHERE id=1").get().value,
  );
}
export function audit(db, user, action, details = {}) {
  db.prepare(
    "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
  ).run(new Date().toISOString(), user, action, JSON.stringify(details));
}
export function saveImport(db, parsed, inspection, user) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const summary = {
      raw: parsed.rawRows,
      imported: inspection.fresh.length,
      duplicates: inspection.duplicates.length,
      invalid: parsed.issues.length,
      skipped: inspection.conflicts.length,
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
        JSON.stringify(details),
      );
      db.prepare(
        "INSERT OR IGNORE INTO programmes(id,name,domain) VALUES(?,?,?)",
      ).run(r.programme.id, r.programme.name, r.programme.domain);
      db.prepare(
        "INSERT OR IGNORE INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)",
      ).run(
        r.session.id,
        r.programme.id,
        r.session.date,
        r.session.start,
        r.session.end,
      );
      db.prepare("INSERT OR IGNORE INTO attendance VALUES(?,?,?,?,?)").run(
        r.id,
        pid,
        r.session.id,
        r.sourceSession,
        id,
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
