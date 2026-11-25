import { importBatch, importBatchResult } from "./import-batches.js";
import { readData, saveImport } from "./db.js";
import { inspectImport, hash } from "./domain.js";

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
    confirm(id, user, options = {}) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const p = db
          .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
          .get(id, user);
        if (!p || p.expires < Date.now()) throw expiredPreview();
        const parsed = JSON.parse(p.payload);
        if (parsed.kind)
          throw Object.assign(
            Error("This preview is for a different import."),
            {
              status: 400,
            },
          );
        if (
          parsed.mode === "replace" &&
          (options.confirmation !== "REPLACE ATTENDANCE" ||
            parsed.fingerprint !== hash(readData(db)))
        )
          throw Object.assign(
            Error("Replacement requires confirmation and a fresh preview."),
            { status: 409 },
          );
        const current = readData(db),
          inspection = inspectImport(parsed, current);
        const batch = importBatch(
          parsed,
          current,
          inspection,
          options.batchSize,
        );
        if (
          !batch &&
          inspection.sessionUpdates.length &&
          parsed.fingerprint !== inspection.fingerprint
        )
          throw Object.assign(
            Error(
              "Session metadata changed after preview. Review a fresh preview.",
            ),
            { status: 409 },
          );
        const result = saveImport(
          db,
          batch?.parsed || parsed,
          batch?.inspection || inspection,
          user,
          { transaction: false },
        );
        let response = result;
        if (batch) {
          response = importBatchResult(parsed, batch, result, batch.complete ? null : readData(db));
          if (batch.complete) {
            db.prepare(
              "UPDATE imports SET summary=? WHERE id=(SELECT MAX(id) FROM imports)",
            ).run(JSON.stringify({ ...result, platformTotals: response }));
            this.remove(id, user);
          } else
            db.prepare(
              "UPDATE import_previews SET payload=?,expires=? WHERE id=? AND user_id=?",
            ).run(JSON.stringify(parsed), Date.now() + 1200000, id, user);
        } else this.remove(id, user);
        db.exec("COMMIT");
        return response;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
