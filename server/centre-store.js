import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { openDb } from "./db.js";
import { defaults } from "./domain.js";
import { CENTRES, centreById } from "../shared/centres.js";
import { ensureOperations } from "./operations-routes.js";
import { ensureLocations } from "./location-store.js";
import { locationDefaults } from "./location-model.js";
export async function setupCentres(control) {
  const sql = `CREATE TABLE IF NOT EXISTS centres(id TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT NOT NULL,classification TEXT NOT NULL,status TEXT NOT NULL,configuration TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS centre_access(user_id INTEGER NOT NULL REFERENCES users(id),centre_id TEXT NOT NULL REFERENCES centres(id),PRIMARY KEY(user_id,centre_id));
 CREATE TABLE IF NOT EXISTS platform_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id),preferred_centre TEXT,can_compare INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS legacy_allocations(programme_id TEXT PRIMARY KEY REFERENCES programmes(id),centre_id TEXT NOT NULL REFERENCES centres(id),status TEXT NOT NULL,migration_id TEXT NOT NULL,review_reason TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS platform_configuration(id INTEGER PRIMARY KEY,value TEXT NOT NULL);`;
  if (control.storage)
    await control.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(714219)");
      await tx.query(
        readFileSync(
          new URL(
            "../supabase/migrations/006_multi_centre.sql",
            import.meta.url,
          ),
          "utf8",
        ).replace(/^BEGIN;\s*|^COMMIT;\s*/gm, ""),
      );
    });
  else control.exec(sql);
  for (const c of CENTRES)
    await control
      .prepare("INSERT OR IGNORE INTO centres VALUES(?,?,?,?,?,?)")
      .run(c.id, c.name, c.location, c.classification, "Active", "{}");
  const configured = await control
    .prepare("SELECT value FROM platform_configuration WHERE id=1")
    .get();
  if (!configured) {
    for (const user of await control
      .prepare("SELECT id,role FROM users")
      .all()) {
      for (const c of user.role === "admin" ? CENTRES : [CENTRES[0]])
        await control
          .prepare("INSERT OR IGNORE INTO centre_access VALUES(?,?)")
          .run(user.id, c.id);
      await control
        .prepare(
          "INSERT OR IGNORE INTO platform_preferences(user_id,can_compare) VALUES(?,?)",
        )
        .run(user.id, user.role === "admin" ? 1 : 0);
    }
    await control
      .prepare("INSERT OR IGNORE INTO platform_configuration VALUES(1,?)")
      .run(JSON.stringify({ memberIdsVerifiedGlobal: false }));
  }
}
const mirrored = new WeakMap();
export async function mirrorUser(db, user) {
  const key = JSON.stringify([user.username, user.role]);
  if (mirrored.get(db)?.get(user.id) === key) return;
  await db
    .prepare(
      "INSERT INTO users(id,username,password,role) VALUES(?,?,'disabled',?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,role=excluded.role",
    )
    .run(
      user.id,
      user.username === "Local workspace"
        ? "__local_workspace__"
        : user.username,
      user.role,
    );
  if (!mirrored.has(db)) mirrored.set(db, new Map());
  mirrored.get(db).set(user.id, key);
}
export function centreStore(control, { directory, openWorkspace } = {}) {
  const stores = new Map();
  async function get(id) {
    if (!centreById(id))
      throw Object.assign(Error("Unknown centre."), { status: 400 });
    if (!stores.has(id))
      stores.set(
        id,
        (async () => {
          if (openWorkspace) {
            const db = await openWorkspace(id);
            const settings = await (db.storage
              ? db.storage.getSettings(db)
              : JSON.parse(
                  db.prepare("SELECT value FROM settings WHERE id=1").get()
                    .value,
                ));
            if (!settings.centreId) await initialize(db, id);
            return db;
          }
          let db;
          if (control.centreConnection) {
            db = control.centreConnection(id);
            await control.transaction(async (tx) => {
              await tx.query("SELECT pg_advisory_xact_lock($1)", [
                714220 + CENTRES.findIndex((c) => c.id === id),
              ]);
              const exists = await tx.query(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1",
                ["centre_" + id],
              );
              if (!exists.rows.length) {
                for (const file of [
                  "001_dashboard.sql",
                  "002_operations.sql",
                  "003_personal_analysis.sql",
                  "004_needs_based.sql",
                  "005_locations.sql",
                ])
                  await tx.query(
                    readFileSync(
                      new URL(
                        "../supabase/migrations/" + file,
                        import.meta.url,
                      ),
                      "utf8",
                    )
                      .replace(/\bglowbb\b/g, "centre_" + id)
                      .replace(/^BEGIN;\s*|^COMMIT;\s*/gm, ""),
                  );
                await tx.query(
                  `DELETE FROM centre_${id}.users WHERE username='__local_workspace__'`,
                );
                await tx.query(
                  `UPDATE centre_${id}.settings SET value=$1 WHERE id=1`,
                  [JSON.stringify({ ...defaults, centreId: id })],
                );
                await tx.query(
                  `UPDATE centre_${id}.location_store SET value=$1 WHERE id=1`,
                  [JSON.stringify(emptyLocations())],
                );
              }
            });
          } else {
            const path =
              directory ||
              process.env.CENTRE_DATA_DIR ||
              resolve(
                dirname(process.env.DB_PATH || resolve("data/glowbb.sqlite")),
                "centres",
              );
            db = openDb(join(path, id + ".sqlite"));
            const marker = JSON.parse(
              db.prepare("SELECT value FROM settings WHERE id=1").get().value,
            ).centreId;
            if (marker && marker !== id)
              throw Error(
                "Centre workspace marker does not match its assigned namespace.",
              );
            if (!marker) await initialize(db, id);
          }
          return db;
        })().catch((e) => {
          stores.delete(id);
          throw e;
        }),
      );
    return stores.get(id);
  }
  return { get, stores };
}
async function initialize(db, id) {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM attendance").get();
  if (count.n)
    throw Error(
      "Unassigned workspace contains attendance; administrator review is required before centre initialization.",
    );
  await ensureOperations(db);
  await ensureLocations(db);
  await db.prepare("UPDATE settings SET value=? WHERE id=1").run(
    JSON.stringify({
      ...defaults,
      centreId: id,
      registry: { complete: false, snapshot: null, asOf: null, source: null },
    }),
  );
  const store = emptyLocations();
  await db
    .prepare("UPDATE location_store SET value=? WHERE id=1")
    .run(JSON.stringify(store));
}
function emptyLocations() {
  const store = locationDefaults();
  store.centre = {
    id: "centre",
    address: "",
    block: "",
    street: "",
    postal: "",
    status: "Awaiting verification",
    lat: null,
    lon: null,
    source: "Centre address requires administrator verification",
  };
  return store;
}
