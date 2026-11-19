import { randomBytes, createHash } from "node:crypto";
import multer from "multer";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_MB,
  UPLOAD_CHUNK_BYTES,
} from "../shared/upload-limits.js";
import { dataTransaction } from "./data-management.js";
const fail = (status, message) => Object.assign(Error(message), { status });
const paths = new Set([
  "/api/sppb/import/preview",
  "/api/import/preview",
  "/api/client-registry/preview",
  "/api/registry/preview",
  "/api/operations/assessments/preview",
]);
export function importFileUpload() {
  const multipart = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0 },
  }).single("file");
  return (req, res, next) => (req.file ? next() : multipart(req, res, next));
}
function targetUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/api/"))
    throw fail(400, "Choose an import preview destination.");
  const url = new URL(value, "http://upload.local");
  if (
    url.origin !== "http://upload.local" ||
    !paths.has(url.pathname) ||
    url.hash
  )
    throw fail(400, "Only supported import previews accept file uploads.");
  url.searchParams.sort();
  return url.pathname + url.search;
}
export function mountLargeUploads(app, { control, access }) {
  const admin = (req) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required to import files.");
  };
  async function allowed(req, target) {
    admin(req);
    const url = new URL(target, "http://upload.local"),
      centre = url.searchParams.get("centre"),
      grants = await access(req.user);
    if (centre && !grants.ids.includes(centre))
      throw fail(403, "Centre access is required.");
    if (url.pathname !== "/api/import/preview" && !centre)
      throw fail(400, "Select a centre for this import.");
  }
  async function load(req, id) {
    if (typeof id !== "string" || !/^upload-[a-f0-9]{48}$/.test(id))
      throw fail(400, "Choose a valid upload.");
    const row = await control
      .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
      .get(id, req.user.id);
    if (!row || row.expires < Date.now())
      throw fail(409, "Upload expired. Select the file again.");
    const value = JSON.parse(row.payload);
    if (value.kind !== "file-upload") throw fail(400, "Wrong upload type.");
    return { ...value, expires: row.expires };
  }
  app.post("/api/centres/uploads", async (req, res) => {
    admin(req);
    const { name, size, target } = req.body || {},
      destination = targetUrl(target);
    if (
      typeof name !== "string" ||
      name.length > 240 ||
      name.includes("/") ||
      name.includes("\\") ||
      [...name].some((c) => c.charCodeAt(0) < 32) ||
      !/\.(xlsx|csv)$/i.test(name) ||
      !Number.isSafeInteger(size) ||
      size < 1
    )
      throw fail(400, "Choose an XLSX or CSV file.");
    if (size > MAX_IMPORT_BYTES)
      throw fail(413, `Choose a file of ${MAX_IMPORT_MB} MB or less.`);
    await allowed(req, destination);
    const id = "upload-" + randomBytes(24).toString("hex"),
      expires = Date.now() + 1200000;
    await dataTransaction(
      control,
      function* (tx) {
        yield tx
          .prepare("DELETE FROM import_previews WHERE expires<?")
          .run(Date.now());
        const count = yield tx
          .prepare(
            "SELECT COUNT(*) n FROM import_previews WHERE user_id=? AND id LIKE 'upload-%' AND id NOT LIKE '%-chunk-%'",
          )
          .get(req.user.id);
        if (count.n >= 2)
          throw fail(
            429,
            "Two uploads are already open. Finish them or wait for expiry.",
          );
        yield tx.prepare("INSERT INTO import_previews VALUES(?,?,?,?)").run(
          id,
          req.user.id,
          expires,
          JSON.stringify({
            kind: "file-upload",
            name,
            size,
            target: destination,
            chunks: Math.ceil(size / UPLOAD_CHUNK_BYTES),
          }),
        );
      },
      false,
      ["import_previews"],
    );
    res.json({ id, chunkBytes: UPLOAD_CHUNK_BYTES });
  });
  app.put("/api/centres/uploads/:id/chunks/:index", async (req, res) => {
    admin(req);
    const p = await load(req, req.params.id);
    await allowed(req, p.target);
    const index = Number(req.params.index),
      data = req.body?.data;
    if (
      !/^\d+$/.test(req.params.index) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= p.chunks ||
      typeof data !== "string" ||
      data.length > Math.ceil(UPLOAD_CHUNK_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        data,
      )
    )
      throw fail(
        400,
        "Part of the file was not received correctly. Select the file again.",
      );
    const bytes = Buffer.from(data, "base64"),
      expected = Math.min(
        UPLOAD_CHUNK_BYTES,
        p.size - index * UPLOAD_CHUNK_BYTES,
      );
    if (bytes.length !== expected || bytes.toString("base64") !== data)
      throw fail(
        400,
        "Part of the file was not received correctly. Select the file again.",
      );
    const id = req.params.id + "-chunk-" + index,
      payload = JSON.stringify({
        kind: "file-upload-chunk",
        data,
        digest: createHash("sha256").update(bytes).digest("hex"),
      });
    await dataTransaction(
      control,
      function* (tx) {
        const parent = yield tx
          .prepare(
            "SELECT id FROM import_previews WHERE id=? AND user_id=? AND expires>?",
          )
          .get(req.params.id, req.user.id, Date.now());
        if (!parent)
          throw fail(
            409,
            "Upload expired or was cancelled. Select the file again.",
          );
        yield tx
          .prepare("INSERT OR IGNORE INTO import_previews VALUES(?,?,?,?)")
          .run(id, req.user.id, p.expires, payload);
        const old = yield tx
          .prepare(
            "SELECT payload FROM import_previews WHERE id=? AND user_id=?",
          )
          .get(id, req.user.id);
        if (old.payload !== payload)
          throw fail(409, "The uploaded file changed. Select the file again.");
      },
      false,
      ["import_previews"],
    );
    res.json({ ok: true, index });
  });
  app.delete("/api/centres/uploads/:id", async (req, res) => {
    admin(req);
    await load(req, req.params.id);
    await control
      .prepare(
        "DELETE FROM import_previews WHERE user_id=? AND (id=? OR id LIKE ?)",
      )
      .run(req.user.id, req.params.id, req.params.id + "-chunk-%");
    res.json({ ok: true });
  });
  app.use(async (req, _res, next) => {
    if (req.method !== "POST" || !paths.has(req.path) || !req.body?.uploadId)
      return next();
    admin(req);
    const p = await load(req, req.body.uploadId);
    await allowed(req, p.target);
    if (p.target !== targetUrl(req.url))
      throw fail(409, "The import destination changed. Select the file again.");
    const chunks = await control
        .prepare(
          "SELECT id,payload FROM import_previews WHERE user_id=? AND id LIKE ?",
        )
        .all(req.user.id, req.body.uploadId + "-chunk-%"),
      buffers = [];
    for (let i = 0; i < p.chunks; i++) {
      const row = chunks.find(
        (c) => c.id === req.body.uploadId + "-chunk-" + i,
      );
      if (!row) throw fail(409, "Upload is incomplete. Select the file again.");
      const value = JSON.parse(row.payload),
        bytes = Buffer.from(value.data, "base64");
      if (
        value.kind !== "file-upload-chunk" ||
        createHash("sha256").update(bytes).digest("hex") !== value.digest
      )
        throw fail(409, "Upload could not be verified. Select the file again.");
      buffers.push(bytes);
    }
    const buffer = Buffer.concat(buffers);
    if (buffer.length !== p.size)
      throw fail(409, "Upload size changed. Select the file again.");
    req.file = {
      fieldname: "file",
      originalname: p.name,
      mimetype: /\.csv$/i.test(p.name)
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      encoding: "7bit",
      buffer,
      size: buffer.length,
    };
    next();
  });
}
