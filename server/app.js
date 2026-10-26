import express from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { readFile, inspectImport, analytics } from "./domain.js";
import { openDb, readData, getSettings, saveImport, audit } from "./db.js";
const error = (status, message) => Object.assign(Error(message), { status });
const date = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  !Number.isNaN(Date.parse(x)) &&
  new Date(x).toISOString().slice(0, 10) === x;
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function createApp(db = openDb(), { production = false } = {}) {
  const app = express(),
    previews = new Map();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    if (production)
      res.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    next();
  });
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const expected =
        process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
      if (!origin || origin !== expected)
        return res
          .status(403)
          .json({ error: "Request origin was not accepted." });
    }
    next();
  });
  // Retain an audit actor for foreign-key relationships without requiring an account.
  db.prepare(
    "INSERT OR IGNORE INTO users(username,password,role) VALUES(?,?,'admin')",
  ).run("__local_workspace__", "disabled");
  const localActor = db
    .prepare("SELECT id FROM users WHERE username=?")
    .get("__local_workspace__");
  app.use("/api", (req, res, next) => {
    req.user = {
      id: localActor.id,
      username: "Local workspace",
      role: "admin",
    };
    next();
  });
  app.get("/api/me", (req, res) => res.json(req.user));
  const filters = (req) => {
    const f = { ...req.query };
    for (const k of ["from", "to"])
      if (f[k] && !date(f[k])) throw error(400, "Invalid reporting date.");
    if (f.from && f.to && f.from > f.to)
      throw error(400, "Start date must be before end date.");
    for (const v of Object.values(f))
      if (typeof v !== "string") throw error(400, "Invalid filter.");
    return f;
  };
  function dashboard(req) {
    const data = readData(db),
      settings = getSettings(db),
      f = filters(req),
      report = analytics(data, settings, f);
    const targets = db
      .prepare("SELECT * FROM targets")
      .all()
      .map((t) => {
        const scoped = analytics(data, settings, {
          from: t.start,
          to: t.end,
          programme: t.programme_id || "",
        });
        const value = scoped.summary[t.metric];
        const remaining = Math.max(
          0,
          Math.ceil(
            (Date.parse(t.end + "T23:59:59+08:00") - Date.now()) / 86400000,
          ),
        );
        return {
          ...t,
          current: value,
          progress: (value / t.value) * 100,
          gap: Math.max(0, t.value - value),
          daysRemaining: remaining,
        };
      });
    return {
      ...report,
      settings,
      targets,
      decisions: db
        .prepare(
          "SELECT programme_id AS id,status,notes,updated FROM decisions UNION ALL SELECT 'target-' || target_id AS id,status,notes,updated FROM opportunity_decisions",
        )
        .all(),
    };
  }
  app.get("/api/dashboard", (req, res) => res.json(dashboard(req)));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 },
  }).single("file");
  app.post("/api/import/preview", upload, async (req, res) => {
    if (!req.file) throw error(400, "Select an attendance file.");
    for (const [key, value] of previews)
      if (value.expires < Date.now()) previews.delete(key);
    if (previews.size >= 5)
      throw error(
        429,
        "Several previews are open. Confirm or wait 20 minutes before uploading another.",
      );
    let parsed;
    try {
      parsed = await readFile(req.file.buffer, req.file.originalname);
    } catch (e) {
      const safe =
        /^(The file is empty|Missing required headers:|Duplicate column|Upload an |This is not a valid|Exactly one worksheet|Maximum |Formula cells|Workbook expands|CSV could not)/.test(
          e.message,
        );
      throw error(
        400,
        safe
          ? e.message
          : "Could not read this file. Use a valid XLSX or UTF-8 CSV with the exact ten attendance headers, values only, in row 1.",
      );
    }
    if (parsed.rawRows > 50000)
      throw error(400, "Maximum 50,000 rows per upload.");
    const inspection = inspectImport(parsed, readData(db));
    const id = randomBytes(24).toString("hex");
    previews.set(id, {
      parsed,
      user: req.user.id,
      expires: Date.now() + 20 * 60 * 1000,
    });
    const referenceRows = inspectImport(parsed, {
      participants: [],
      programmes: [],
      sessions: [],
      attendance: [],
    }).fresh;
    const reference = analytics(
      {
        participants: [
          ...new Map(
            referenceRows.map((r) => [r.participant.id, r.participant]),
          ).values(),
        ],
        programmes: [
          ...new Map(
            referenceRows.map((r) => [r.programme.id, r.programme]),
          ).values(),
        ],
        sessions: [
          ...new Map(
            referenceRows.map((r) => [r.session.id, r.session]),
          ).values(),
        ],
        attendance: [
          ...new Map(
            referenceRows.map((r) => [
              r.id,
              {
                id: r.id,
                participantId: r.participant.id,
                sessionId: r.session.id,
              },
            ]),
          ).values(),
        ],
      },
      getSettings(db),
    );
    res.json({
      id,
      rawRows: parsed.rawRows,
      ready: inspection.fresh.length,
      duplicates: inspection.duplicates.length,
      invalid: parsed.issues.length,
      skipped: inspection.conflicts.length,
      exactDuplicates: parsed.exactDuplicates,
      issues: [
        ...parsed.issues,
        ...inspection.conflicts,
        ...inspection.warnings,
      ],
      variants: inspection.variants,
      preview: parsed.rows.slice(0, 30).map((r) => ({
        row: r.row,
        programme: r.programme.name,
        domain: r.programme.domain,
        date: r.session.date,
        start: r.session.start,
        end: r.session.end,
        warnings: r.warnings,
      })),
      reference: {
        raw: parsed.rawRows,
        allAges: reference.summary.allAges,
        seniors: reference.summary.unique,
        male: reference.summary.male,
        minority: reference.summary.minority,
        unknownRace: reference.summary.recordedUnknownRace,
        programmes: reference.options.programmes.length,
        exactDuplicates: parsed.exactDuplicates,
        from: reference.coverage.from,
        to: reference.coverage.to,
      },
      expectedReference: {
        raw: 3101,
        allAges: 385,
        seniors: 364,
        male: 84,
        minority: 18,
        unknownRace: 2,
        programmes: 110,
        exactDuplicates: 1,
        from: "2026-05-04",
        to: "2026-10-26",
      },
    });
  });
  app.delete("/api/import/preview/:id", (req, res) => {
    const p = previews.get(req.params.id);
    if (p?.user === req.user.id) previews.delete(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/import/confirm", (req, res) => {
    const p = previews.get(req.body.id);
    if (!p || p.user !== req.user.id || p.expires < Date.now())
      throw error(400, "Preview expired. Upload the file again.");
    const result = saveImport(
      db,
      p.parsed,
      inspectImport(p.parsed, readData(db)),
      req.user.id,
    );
    previews.delete(req.body.id);
    res.json(result);
  });
  app.get("/api/quality", (req, res) =>
    res.json({
      imports: db
        .prepare(
          "SELECT id,created,summary FROM imports ORDER BY id DESC LIMIT 100",
        )
        .all()
        .map((r) => ({ ...r, ...JSON.parse(r.summary) })),
      audit: db
        .prepare("SELECT created,action FROM audit ORDER BY id DESC LIMIT 50")
        .all(),
    }),
  );
  app.put("/api/settings", (req, res) => {
    const s = req.body;
    if (
      !Number.isInteger(s.seniorAge) ||
      s.seniorAge < 1 ||
      s.seniorAge > 100 ||
      !Array.isArray(s.minority) ||
      s.minority.length > 20 ||
      s.minority.some(
        (x) =>
          typeof x !== "string" ||
          !x.trim() ||
          ["UNKNOWN", "MISSING"].includes(x.trim().toUpperCase()) ||
          x.length > 100,
      ) ||
      !Array.isArray(s.ageBands) ||
      s.ageBands.length !== 2 ||
      !s.ageBands.every(Number.isInteger) ||
      s.ageBands[0] <= s.seniorAge ||
      s.ageBands[1] <= s.ageBands[0] ||
      s.ageBands[1] > 120 ||
      !Number.isInteger(s.minSessions) ||
      s.minSessions < 3 ||
      s.minSessions > 100 ||
      !Number.isInteger(s.minParticipants) ||
      s.minParticipants < 5 ||
      s.minParticipants > 1000
    )
      throw error(
        400,
        "Check age bands and definitions. Minimum evidence is 3 sessions and 5 seniors.",
      );
    const clean = {
      seniorAge: s.seniorAge,
      minority: [
        ...new Set(s.minority.map((x) => x.trim().toUpperCase())),
      ].filter((x) => x !== "UNKNOWN"),
      ageBands: s.ageBands,
      minSessions: s.minSessions,
      minParticipants: s.minParticipants,
      privacyMinimum: 5,
    };
    db.prepare("UPDATE settings SET value=? WHERE id=1").run(
      JSON.stringify(clean),
    );
    audit(db, req.user.id, "definitions.updated");
    res.json(clean);
  });
  app.post("/api/targets", (req, res) => {
    const t = req.body;
    if (
      !["unique", "male", "minority", "firstObserved"].includes(t.metric) ||
      !Number.isInteger(t.value) ||
      t.value < 1 ||
      t.value > 1000000 ||
      !date(t.start) ||
      !date(t.end) ||
      t.start > t.end ||
      (t.programmeId &&
        !db.prepare("SELECT id FROM programmes WHERE id=?").get(t.programmeId))
    )
      throw error(
        400,
        "Enter a valid metric, positive target and reporting period.",
      );
    const id = Number(
      db
        .prepare(
          "INSERT INTO targets(metric,value,start,end,programme_id) VALUES(?,?,?,?,?)",
        )
        .run(t.metric, t.value, t.start, t.end, t.programmeId || null)
        .lastInsertRowid,
    );
    audit(db, req.user.id, "target.created", { id });
    res.json({ id });
  });
  app.delete("/api/targets/:id", (req, res) => {
    db.prepare("DELETE FROM targets WHERE id=?").run(req.params.id);
    audit(db, req.user.id, "target.removed");
    res.json({ ok: true });
  });
  app.put("/api/decisions/:id", (req, res) => {
    const { status, notes } = req.body;
    const opportunity = /^target-\d+$/.test(req.params.id);
    const entityId = opportunity
      ? Number(req.params.id.slice(7))
      : req.params.id;
    if (
      ![
        "For review",
        "Approved for planning",
        "In progress",
        "Completed",
        "Not proceeding",
      ].includes(status) ||
      typeof notes !== "string" ||
      notes.length > 4000 ||
      !(
        opportunity
          ? db.prepare("SELECT id FROM targets WHERE id=?")
          : db.prepare("SELECT id FROM programmes WHERE id=?")
      ).get(entityId)
    )
      throw error(400, "Invalid planning decision.");
    db.prepare(
      opportunity
        ? "INSERT INTO opportunity_decisions VALUES(?,?,?,?,?) ON CONFLICT(target_id) DO UPDATE SET status=excluded.status,notes=excluded.notes,updated=excluded.updated,user_id=excluded.user_id"
        : "INSERT INTO decisions VALUES(?,?,?,?,?) ON CONFLICT(programme_id) DO UPDATE SET status=excluded.status,notes=excluded.notes,updated=excluded.updated,user_id=excluded.user_id",
    ).run(entityId, status, notes, new Date().toISOString(), req.user.id);
    audit(db, req.user.id, "planning.updated");
    res.json({ ok: true });
  });
  // Shared reports deliberately omit all demographic cells, free-text notes and target-group filtered data.
  app.get("/api/export/:format", (req, res) => {
    const f = filters(req);
    if (
      ["gender", "race", "target", "ageBand", "client", "boundary"].some(
        (k) => f[k] && f[k] !== "all",
      )
    )
      throw error(
        400,
        "Reset audience filters before producing a shareable report. Demographic cells are restricted in shared reports.",
      );
    const r = dashboard(req);
    const period = `${r.period.from || "Available records"} to ${r.period.to} (Asia/Singapore)`;
    const cell = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    if (req.params.format === "csv") {
      res
        .type("text/csv")
        .attachment("programme-performance.csv")
        .send(
          "\uFEFF" +
            [
              ["Reporting period", period],
              ["Demographic figures omitted for privacy"],
              [
                "Programme",
                "AAP domain",
                "Sessions",
                "Attendance entries (all ages)",
                "Unique seniors",
                "Average attendance per session",
                "Repeat seniors",
              ],
              ...r.programmes.map((p) => [
                p.name,
                p.domain,
                p.sessions,
                p.attendance,
                p.unique,
                p.average.toFixed(1),
                p.repeat,
              ]),
            ]
              .map((row) => row.map(cell).join(","))
              .join("\r\n"),
        );
      return;
    }
    if (req.params.format !== "report")
      throw error(404, "Report format not found.");
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GLOW · Programme planning summary</title><style>body{font:16px system-ui;color:#17314b;max-width:1000px;margin:40px auto;padding:20px}h1{font-size:30px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}article{break-inside:avoid;padding:12px 0}small{color:#536576}@media print{body{margin:0;padding:0}button{display:none}thead{display:table-header-group}}</style><h1>Programme impact & outreach</h1><p>${esc(period)}</p><p>${r.summary.unique} unique seniors · ${r.summary.attendance} attendance entries (all ages) · ${r.summary.sessions} recorded sessions</p><p>Available history: ${esc(r.coverage.from || "No records")} to ${esc(r.coverage.to || "No records")}. Senior threshold: ${r.settings.seniorAge}+. First observed means first in available records, not new to the centre. Incomplete periods are not full-period comparisons.</p><h2>Participation trends</h2><table><thead><tr><th>Period</th><th>Unique seniors</th><th>Attendance</th></tr></thead><tbody>${r.trends.map((t) => `<tr><td>${esc(t.label)}${t.partial ? " (in progress)" : ""}</td><td>${t.unique}</td><td>${t.attendance}</td></tr>`).join("")}</tbody></table><h2>Programme performance</h2><table><thead><tr><th>Programme</th><th>Sessions</th><th>Unique seniors</th><th>Attendance</th></tr></thead><tbody>${r.programmes.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.sessions}</td><td>${p.unique}</td><td>${p.attendance}</td></tr>`).join("")}</tbody></table><h2>Findings & planning discussion</h2>${r.recommendations.map((p) => `<article><b>${esc(p.category)} · ${esc(p.programme)}</b><p>${esc(p.figures)}. Evidence: ${esc(p.evidence)}.</p><p>${esc(p.reason)} ${esc(p.action)} ${esc(p.next)}</p></article>`).join("")}<p>Demographic cells and staff notes are omitted from shared reports to reduce disclosure. Recommendations are discussion prompts, not evidence of causal impact. Venue, capacity, cost, language, feedback and living arrangements were not supplied. Attendance per session includes all ages. Participants may appear in several programmes or months; do not sum unique counts.</p><p>Use your browser’s Print ? Save as PDF.</p></html>`,
      );
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 400).json({
      error: err.status
        ? err.message
        : err instanceof multer.MulterError
          ? "Upload must be a single file under 8 MB."
          : "The request could not be processed. Check your file or entries and try again.",
    });
  });
  return app;
}
