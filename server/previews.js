import { readData, saveImport } from "./db.js";
import { inspectImport } from "./domain.js";

export function expiredPreview() {
  return Object.assign(Error("Preview expired. Upload the file again."), {
    status: 400,
  });
}

export function sqlitePreviews(db) {
  return {
    put(id, parsed, user) {
      db.prepare("DELETE FROM import_previews WHERE expires < ?").run(
        Date.now(),
      );
      if (db.prepare("SELECT count(*) AS n FROM import_previews").get().n >= 5)
        throw Object.assign(
          Error(
            "Several previews are open. Confirm or wait 20 minutes before uploading another.",
          ),
          { status: 429 },
        );
      db.prepare("INSERT INTO import_previews VALUES(?,?,?,?)").run(
        id,
        user,
        Date.now() + 1200000,
        JSON.stringify(parsed),
      );
    },
    remove(id, user) {
      db.prepare("DELETE FROM import_previews WHERE id=? AND user_id=?").run(
        id,
        user,
      );
    },
    confirm(id, user) {
      const p = db
        .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
        .get(id, user);
      if (!p || p.expires < Date.now()) throw expiredPreview();
      const parsed = JSON.parse(p.payload);
      const result = saveImport(
        db,
        parsed,
        inspectImport(parsed, readData(db)),
        user,
      );
      this.remove(id, user);
      return result;
    },
  };
}
