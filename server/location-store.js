import { readFileSync } from "node:fs";
import { decodeLocations } from "./location-model.js";
const setups = new WeakMap();
export function ensureLocations(db) {
  if (!setups.has(db))
    setups.set(
      db,
      (async () => {
        if (
          (
            await db
              .prepare("SELECT version FROM schema_version WHERE version=5")
              .get()
          )?.version === 5
        )
          return;
        if (db.transaction) {
          const sql = readFileSync(
            new URL(
              "../supabase/migrations/005_locations.sql",
              import.meta.url,
            ),
            "utf8",
          );
          await db.transaction(async (tx) => {
            await tx.query("SELECT pg_advisory_xact_lock(714205)");
            for (const s of sql
              .split(";")
              .map((s) => s.trim())
              .filter((s) => s && !/^(BEGIN|COMMIT)$/i.test(s)))
              await tx.query(s);
          });
        } else {
          db.exec("BEGIN IMMEDIATE");
          try {
            db.exec(
              "CREATE TABLE IF NOT EXISTS location_store(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,value TEXT NOT NULL); INSERT OR IGNORE INTO location_store VALUES(1,0,'{}'); INSERT OR IGNORE INTO schema_version VALUES(5);",
            );
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
        }
      })().catch((e) => {
        setups.delete(db);
        throw e;
      }),
    );
  return setups.get(db);
}
export const locationRow = (db) =>
  db.prepare("SELECT revision,value FROM location_store WHERE id=1").get();
export async function readLocations(db) {
  await ensureLocations(db);
  return decodeLocations(await locationRow(db));
}
