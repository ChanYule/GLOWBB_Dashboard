import { randomBytes } from "node:crypto";
import multer from "multer";
import { readMatrix, parseRows, inspectImport } from "./domain.js";
import { readData, getSettings } from "./db.js";
import { sqlitePreviews } from "./previews.js";
import {
  CENTRES,
  classifyCentre,
  normalizeCentreLocation,
} from "../shared/centres.js";
const fail = (status, message) => Object.assign(Error(message), { status });
export function classifyMatrix(matrix, overrides = {}) {
  if (!matrix.length) throw fail(400, "The file is empty.");
  const headers = matrix[0].map((v) => String(v ?? "").trim()),
    indices = headers
      .map((h, i) => (/^(centre|centres)$/i.test(h) ? i : -1))
      .filter((i) => i >= 0),
    activity = headers.indexOf("Activity Name");
  const classifications = new Map();
  for (let i = 1; i < matrix.length; i++) {
    if (matrix[i].every((v) => String(v ?? "").trim() === "")) continue;
    const values = indices.map((j) => String(matrix[i][j] ?? ""));
    const canonical = values.map(normalizeCentreLocation);
    const location =
      values.length > 1 &&
      (canonical.some((v) => !v) || new Set(canonical).size > 1)
        ? "Ambiguous Centre/Centres columns"
        : values[0];
    classifications.set(i + 1, {
      ...classifyCentre(
        location,
        matrix[i][activity],
        overrides[String(i + 1)],
      ),
      sourceLocations: indices.map((j) => ({
        header: headers[j],
        value: matrix[i][j] ?? "",
      })),
    });
  }
  let parsed;
  try {
    parsed = parseRows(matrix);
  } catch (error) {
    throw fail(400, error.message);
  }
  const counts = Object.fromEntries(CENTRES.map((c) => [c.id, 0]));
  let unclassified = 0;
  for (const [row, c] of classifications) {
    if (c.centreId) counts[c.centreId]++;
    else {
      unclassified++;
      if (
        !parsed.issues.some(
          (i) => i.row === row && i.message.includes("Activity Name"),
        )
      )
        parsed.issues.push({ row, message: c.reason, code: "centre" });
    }
  }
  parsed.rows = parsed.rows
    .filter((r) => classifications.get(r.row)?.centreId)
    .map((r) => {
      const c = classifications.get(r.row);
      return {
        ...r,
        centreId: c.centreId,
        participant: {
          ...r.participant,
          sourceClientStatus: r.participant.client,
          client: null,
        },
        session: {
          ...r.session,
          optional: { ...r.session.optional, centreClassification: c },
        },
      };
    });
  return {
    parsed,
    classifications,
    counts,
    unclassified,
    review: [...classifications]
      .filter(([, c]) => !c.centreId)
      .slice(0, 100)
      .map(([row, c]) => ({
        row,
        activity: String(c.activityRaw ?? ""),
        location: c.sourceLocations.length>1?c.sourceLocations.map(s=>s.header+': '+String(s.value)).join(' / '):String(c.locationRaw ?? ""),
        reason: c.reason,
      })),
  };
}
export function mountCentreImports(
  app,
  { control, workspaces, access, audit, mirror },
) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 },
  }).single("file");
  const admin = (req) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
  };
  async function load(req, id) {
    const row = await control
      .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
      .get(id, req.user.id);
    if (!row || row.expires < Date.now())
      throw fail(409, "Preview expired; upload the file again.");
    const p = JSON.parse(row.payload);
    if (p.kind !== "centre-import") throw fail(400, "Wrong preview type.");
    return p;
  }
  async function preview(req, p, id, classified) {
    const result = classified || classifyMatrix(p.matrix, p.overrides),
      allowed = await access(req.user),
      children = {};
    const denied = Object.keys(result.counts).filter(
      (id) => result.counts[id] && !allowed.ids.includes(id),
    );
    let ready = 0,
      duplicates = 0,
      updatedProfiles = 0,
      updatedSessions = 0,
      conflicts = 0,
      skipped = 0,
      matched = 0,
      missing = 0;
    const centreSummaries = Object.fromEntries(
      CENTRES.map((c) => [
        c.id,
        {
          rawRows: result.counts[c.id],
          ready: 0,
          duplicates: 0,
          skipped: 0,
          invalid: 0,
          profileUpdates: 0,
          sessionUpdates: 0,
        },
      ]),
    );
    const invalidRows = new Set(
      result.parsed.issues.filter((i) => i.code !== "centre").map((i) => i.row),
    );
    const rowOutcomes = Object.fromEntries(
      [...result.classifications].map(([row, c]) => [
        row,
        {
          centreId: c.centreId,
          status: invalidRows.has(row)
            ? "invalid"
            : !c.centreId
              ? "unclassified"
              : !allowed.ids.includes(c.centreId)
                ? "restricted"
                : "pending",
        },
      ]),
    );
    for (const outcome of Object.values(rowOutcomes))
      if (outcome.status === "invalid" && outcome.centreId)
        centreSummaries[outcome.centreId].invalid++;
    const issues = [...result.parsed.issues],
      sessionChanges = [];
    for (const centre of CENTRES) {
      const rows = result.parsed.rows.filter((r) => r.centreId === centre.id);
      if (!rows.length || !allowed.ids.includes(centre.id)) continue;
      const db = await workspaces.get(centre.id);
      await mirror(db, req.user);
      const storage = db.storage || { readData, getSettings };
      const current = await storage.readData(db);
      const existing = new Map(current.participants.map((p) => [p.id, p]));
      for (const r of rows)
        r.participant.client = existing.get(r.participant.id)?.client ?? null;
      const sourceRows = new Set(rows.map((r) => r.row));
      const sourceSessions = new Map();
      for (const row of rows)
        if (!sourceSessions.has(row.session.id))
          sourceSessions.set(row.session.id, row);
      const parsed = {
        ...result.parsed,
        rows,
        mode: p.mode,
        platformImportId: id,
        issues: result.parsed.issues.filter((i) => sourceRows.has(i.row)),
      };
      const inspection = inspectImport(parsed, current);
      const summary = centreSummaries[centre.id];
      Object.assign(summary, {
        ready: inspection.fresh.length,
        duplicates: inspection.duplicates.length,
        skipped: inspection.conflicts.filter((c) => c.action !== "update")
          .length,
        profileUpdates: inspection.updates.length,
        sessionUpdates: inspection.sessionUpdates.length,
        resultingAttendance: inspection.resultingAttendance,
        resultingProfiles: inspection.resultingParticipants,
      });
      for (const row of inspection.fresh)
        rowOutcomes[row.row].status = "insert";
      for (const row of inspection.duplicates)
        rowOutcomes[row].status = "duplicate";
      for (const conflict of inspection.conflicts)
        if (conflict.action !== "update")
          rowOutcomes[conflict.row].status = "skipped";
      parsed.fingerprint = inspection.fingerprint;
      const childId = id + "-" + centre.id;
      const previews = db.previews || sqlitePreviews(db);
      await previews.remove(childId, req.user.id);
      await previews.put(childId, parsed, req.user.id);
      children[centre.id] = {
        previewId: childId,
        ready: inspection.fresh.length,
        duplicates: inspection.duplicates.length,
      };
      ready += inspection.fresh.length;
      duplicates += inspection.duplicates.length;
      updatedProfiles += inspection.updates.length;
      updatedSessions += inspection.sessionUpdates.length;
      conflicts += inspection.conflicts.length;
      skipped += inspection.conflicts.filter(
        (c) => c.action !== "update",
      ).length;
      matched += inspection.matched;
      missing += inspection.missing.length;
      issues.push(...inspection.conflicts, ...inspection.warnings);
      issues.push(
        ...inspection.duplicates.map((row) => ({
          row,
          message:
            "Duplicate attendance: already saved or repeated in this file. No new attendance entry will be inserted.",
        })),
      );
      for (const update of inspection.sessionUpdates) {
        const source = sourceSessions.get(update.id);
        sessionChanges.push({
          programme:
            centre.name +
            " / " +
            (source?.programme.name || "Recorded programme"),
          date: source?.session.date || "",
          before:
            update.optional.eventTypeHistory?.at(-1)?.raw ||
            "Unclassified / unknown",
          after: update.optional.eventTypeRaw || "Unclassified / unknown",
        });
      }
    }
    p.children = children;
    p.denied = denied;
    p.counts = result.counts;
    p.unclassified = result.unclassified;
    p.rowOutcomes = rowOutcomes;
    p.classificationRevision = (p.classificationRevision || 0) + 1;
    await control
      .prepare("UPDATE import_previews SET payload=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(p), id, req.user.id);
    return {
      id,
      mode: p.mode,
      rawRows: result.parsed.rawRows,
      ready,
      duplicates,
      invalid: invalidRows.size,
      unclassified: result.unclassified,
      centreCounts: result.counts,
      centreSummaries,
      classificationRevision: p.classificationRevision,
      flaggedRows: new Set(issues.map((i) => i.row)).size,
      classificationReview: result.review,
      deniedCentres: denied,
      issues,
      preview: result.parsed.rows.slice(0, 30).map((r) => ({
        row: r.row,
        programme: r.programme.name,
        domain: r.programme.domain,
        centreId: r.centreId,
        date: r.session.date,
        start: r.session.start,
        end: r.session.end,
        warnings: r.warnings,
        location: String(
          r.session.optional?.centreClassification.locationRaw ?? "",
        ),
        eventType: r.session.optional?.eventTypeRaw || "",
        status: rowOutcomes[r.row]?.status,
      })),
      updatedProfiles,
      updatedSessions,
      sessionChanges: sessionChanges.slice(0, 100),
      skipped,
      conflicts,
      matched,
      missing,
      exactDuplicates: result.parsed.exactDuplicates,
      variants: [],
      reference: {},
      expectedReference: {},
    };
  }
  app.post("/api/import/preview", upload, async (req, res) => {
    admin(req);
    if (!req.file) throw fail(400, "Select an attendance file.");
    const mode = req.query.mode || "merge";
    if (!["add", "merge"].includes(mode))
      throw fail(
        400,
        "Multi-centre imports support Add or Merge only. Reviewed deletion/restore remains centre-specific.",
      );
    let matrix;
    try {
      matrix = await readMatrix(req.file.buffer, req.file.originalname);
    } catch {
      throw fail(
        400,
        "Attendance file could not be read. Use one values-only worksheet with the required attendance headers, or a valid UTF-8 CSV.",
      );
    }
    if (matrix.length > 50001) throw fail(400, "Maximum 50,000 rows.");
    const classified = classifyMatrix(matrix);
    const id = randomBytes(24).toString("hex"),
      p = { kind: "centre-import", matrix, mode, overrides: {} };
    await control
      .prepare("DELETE FROM import_previews WHERE expires<?")
      .run(Date.now());
    if (
      (await control.prepare("SELECT count(*) AS n FROM import_previews").get())
        .n >= 10
    )
      throw fail(
        429,
        "Several previews are open; discard one or wait for expiry.",
      );
    await control
      .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
      .run(id, req.user.id, Date.now() + 1200000, JSON.stringify(p));
    res.json(await preview(req, p, id, classified));
  });
  app.post("/api/centres/import/review", async (req, res) => {
    admin(req);
    const p = await load(req, req.body.id),
      allowed = await access(req.user);
    if (!Array.isArray(req.body.overrides) || req.body.overrides.length > 50000)
      throw fail(400, "Choose row classifications.");
    if (req.body.unclassifiedCentre) {
      if (!allowed.ids.includes(req.body.unclassifiedCentre))
        throw fail(403, "Centre access is required.");
      classifyCentre("review", "Reviewed activity", {
        centreId: req.body.unclassifiedCentre,
        reason: req.body.reason,
      });
      const unresolved = classifyMatrix(p.matrix, p.overrides);
      for (const issue of unresolved.parsed.issues.filter(
        (i) => i.code === "centre",
      ))
        p.overrides[String(issue.row)] = {
          centreId: req.body.unclassifiedCentre,
          reason: req.body.reason,
        };
    }
    for (const o of req.body.overrides) {
      if (
        !Number.isInteger(o.row) ||
        o.row < 2 ||
        o.row > p.matrix.length ||
        !allowed.ids.includes(o.centreId)
      )
        throw fail(400, "Choose an authorised centre and valid source row.");
      classifyCentre("review", "Reviewed activity", o);
      p.overrides[String(o.row)] = { centreId: o.centreId, reason: o.reason };
    }
    res.json(await preview(req, p, req.body.id));
  });
  app.get("/api/centres/import/rows", async (req, res) => {
    admin(req);
    const { id, centreId, page = "1" } = req.query,
      allowed = await access(req.user);
    if (
      typeof id !== "string" ||
      typeof centreId !== "string" ||
      !CENTRES.some((c) => c.id === centreId) ||
      !/^[1-9]\d*$/.test(String(page)) ||
      Object.keys(req.query).some(
        (k) => !["id", "centreId", "page"].includes(k),
      )
    )
      throw fail(400, "Choose a valid preview, centre and page.");
    if (!allowed.ids.includes(centreId))
      throw fail(
        403,
        "Centre access is required to inspect these source rows.",
      );
    const p = await load(req, id);
    if (!p.rowOutcomes)
      throw fail(409, "Upload a fresh preview to inspect source rows.");
    const selected = Object.entries(p.rowOutcomes).filter(
        ([, o]) => o.centreId === centreId,
      ),
      pages = Math.max(1, Math.ceil(selected.length / 25)),
      number = Number(page);
    if (number > pages)
      throw fail(400, "Choose a page within this centre preview.");
    const headers = p.matrix[0].map((h) => String(h ?? "").trim()),
      cell = (source, header) => String(source[headers.indexOf(header)] ?? "");
    res.json({
      centreId,
      page: number,
      pages,
      total: selected.length,
      rows: selected
        .slice((number - 1) * 25, number * 25)
        .map(([row, outcome]) => {
          const source = p.matrix[Number(row) - 1];
          return {
            row: Number(row),
            centreId,
            status: outcome.status,
            activity: cell(source, "Activity Name"),
            location: headers
              .map((h, i) =>
                /^(centre|centres)$/i.test(h) ? String(source[i] ?? "") : null,
              )
              .filter((v) => v !== null)
              .join(" / "),
            domain: cell(source, "AAP Domain"),
            eventType: cell(source, "Activity Name/Event Type"),
            session: cell(source, "Session Detail"),
          };
        }),
    });
  });
  app.delete("/api/import/preview/:id", async (req, res) => {
    admin(req);
    const p = await load(req, req.params.id);
    for (const [centreId, child] of Object.entries(p.children || {})) {
      const a = await access(req.user);
      if (a.ids.includes(centreId)) {
        const db = await workspaces.get(centreId);
        await (db.previews || sqlitePreviews(db)).remove(
          child.previewId,
          req.user.id,
        );
      }
    }
    await control
      .prepare("DELETE FROM import_previews WHERE id=? AND user_id=?")
      .run(req.params.id, req.user.id);
    res.json({ ok: true });
  });
  app.post("/api/import/confirm", async (req, res) => {
    admin(req);
    const p = await load(req, req.body.id),
      a = await access(req.user);
    if (req.body.confirmed !== true)
      throw fail(400, "Review centre allocations and confirm the import.");
    if (p.unclassified || p.denied?.length)
      throw fail(
        400,
        "Resolve all unclassified and unauthorised centre rows before importing.",
      );
    const results = {};
    for (const [id, child] of Object.entries(p.children || {})) {
      if (!a.ids.includes(id))
        throw fail(403, "Centre access changed; review a fresh import.");
      const db = await workspaces.get(id);
      await mirror(db, req.user);
      const prior = (await db.prepare("SELECT summary FROM imports").all())
        .map((r) => JSON.parse(r.summary))
        .find((s) => s.platformImportId === req.body.id);
      results[id] =
        prior ||
        (await (db.previews || sqlitePreviews(db)).confirm(
          child.previewId,
          req.user.id,
        ));
    }
    await audit(req.user, "centres.attendance.imported", {
      centres: Object.keys(results),
      counts: Object.fromEntries(
        Object.entries(results).map(([id, r]) => [id, r.imported]),
      ),
    });
    // Retain the preview until expiry: retrying after a lost response returns the same committed receipt.
    res.json({
      imported: Object.values(results).reduce((n, r) => n + r.imported, 0),
      centres: results,
    });
  });
}
