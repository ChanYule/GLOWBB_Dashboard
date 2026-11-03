import { readEffectiveData } from "./needs-domain.js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readMatrix, hash, todaySG } from "./domain.js";
import { audit as sqliteAudit } from "./db.js";
import {
  parseAssessmentTotals,
  assessmentHeaders,
  monthlyPlan,
  operationsReport,
  validMonth,
  monthEnd,
  operationMetrics,
} from "./operations.js";

const localSchema = `CREATE TABLE IF NOT EXISTS assessment_monthly(id INTEGER PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,month TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('SPPB','TANITA')),total INTEGER NOT NULL CHECK(total>=0),reported_as_of TEXT NOT NULL,complete INTEGER NOT NULL CHECK(complete IN (0,1)),created TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
CREATE INDEX IF NOT EXISTS assessment_monthly_period ON assessment_monthly(month,type);
CREATE TABLE IF NOT EXISTS operational_settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
INSERT OR IGNORE INTO operational_settings VALUES(1,'{"inactivityDays":null}');
CREATE TABLE IF NOT EXISTS operational_targets(id TEXT PRIMARY KEY,month TEXT NOT NULL,metric TEXT NOT NULL,value INTEGER NOT NULL CHECK(value>0));
INSERT OR IGNORE INTO schema_version VALUES(2);`;
const error = (message, status = 400) =>
  Object.assign(Error(message), { status });
const columns =
  "fingerprint,month,type,total,reported_as_of,complete,created,user_id";
const insertSql = `INSERT OR IGNORE INTO assessment_monthly(${columns}) VALUES(?,?,?,?,?,?,?,?)`;

const operationSetups = new WeakMap();
export function ensureOperations(db) {
  if (!operationSetups.has(db)) {
    const setup = (async () => {
      if (
        (
          await db
            .prepare("SELECT version FROM schema_version WHERE version=2")
            .get()
        )?.version === 2
      )
        return;
      if (db.storage) {
        // This versioned migration contains only flat SQL statements. A checked-
        // out transaction guarantees rollback before a failed connection is reused.
        const statements = readFileSync(
          new URL("../supabase/migrations/002_operations.sql", import.meta.url),
          "utf8",
        )
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s && !/^(BEGIN|COMMIT)$/i.test(s));
        await db.transaction(async (tx) => {
          for (const statement of statements) await tx.query(statement);
        });
      } else {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(localSchema);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }
    })().catch((e) => {
      operationSetups.delete(db);
      throw e;
    });
    operationSetups.set(db, setup);
  }
  return operationSetups.get(db);
}

export function mountOperations(
  app,
  { db, storage, previews, upload, filters },
) {
  app.use("/api/operations", async (_req, _res, next) => {
    await ensureOperations(db);
    next();
  });
  const admin = (req) => {
    if (req.user.role !== "admin")
      throw error("Only authorised staff can change operational records.", 403);
  };
  async function readState() {
    return {
      records: await db
        .prepare("SELECT * FROM assessment_monthly ORDER BY id")
        .all(),
      config: JSON.parse(
        (
          await db
            .prepare("SELECT value FROM operational_settings WHERE id=1")
            .get()
        ).value,
      ),
    };
  }
  async function report(req) {
    const grain = req.query.grain || "month";
    if (!["day", "week", "month", "year"].includes(grain))
      throw error("Choose day, week, month or year.");
    const data = await readEffectiveData(db, storage),
      settings = await storage.getSettings(db),
      state = await readState();
    const result = operationsReport(
      data,
      settings,
      filters(req),
      state.records,
      state.config,
      grain,
    );
    const targets = await db
      .prepare("SELECT * FROM operational_targets ORDER BY month,metric")
      .all();
    const cache = new Map();
    result.targets = targets.map((target) => {
      if (!cache.has(target.month))
        cache.set(
          target.month,
          target.month > todaySG().slice(0, 7)
            ? null
            : operationsReport(
                data,
                settings,
                { from: target.month + "-01", to: monthEnd(target.month) },
                state.records,
                state.config,
              ).summary,
        );
      const actual = cache.get(target.month)?.[target.metric] ?? null;
      return {
        ...target,
        label: operationMetrics[target.metric],
        actual,
        progress: actual === null ? null : (actual / target.value) * 100,
        remaining: actual === null ? null : Math.max(0, target.value - actual),
      };
    });
    return result;
  }
  app.get("/api/operations", async (req, res) => res.json(await report(req)));
  app.put("/api/operations/settings", async (req, res) => {
    admin(req);
    const days = req.body?.inactivityDays;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))
      throw error(
        "Enter an approved inactivity period from 1 to 3,650 days, or leave it unconfigured.",
      );
    const value = { inactivityDays: days };
    await db
      .prepare("UPDATE operational_settings SET value=? WHERE id=1")
      .run(JSON.stringify(value));
    await storage.audit(
      db,
      req.user.id,
      "operations.inactivity_definition.updated",
      value,
    );
    res.json(value);
  });
  app.post("/api/operations/targets", async (req, res) => {
    admin(req);
    const { month, metric, value } = req.body || {};
    if (
      !validMonth(month) ||
      !Object.hasOwn(operationMetrics, metric) ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 1000000
    )
      throw error(
        "Choose a month and metric and enter a target from 1 to 1,000,000.",
      );
    const id = hash([month, metric]);
    await db
      .prepare(
        "INSERT INTO operational_targets(id,month,metric,value) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(id, month, metric, value);
    await storage.audit(db, req.user.id, "operations.target.saved", {
      month,
      metric,
      value,
    });
    res.json({ id });
  });
  app.delete("/api/operations/targets/:id", async (req, res) => {
    admin(req);
    await db
      .prepare("DELETE FROM operational_targets WHERE id=?")
      .run(req.params.id);
    await storage.audit(db, req.user.id, "operations.target.removed");
    res.json({ ok: true });
  });
  app.post("/api/operations/assessments/preview", upload, async (req, res) => {
    admin(req);
    if (!req.file) throw error("Choose a monthly assessment report.");
    let matrix;
    try {
      matrix = await readMatrix(
        req.file.buffer,
        req.file.originalname,
        assessmentHeaders,
      );
    } catch {
      throw error(
        "Could not read the report. Use the monthly CSV/XLSX template, values only, with Month, SPPB, Tanita, Reported As Of and Final headers.",
      );
    }
    const parsed = parseAssessmentTotals(matrix);
    if (parsed.issues.length)
      return res.status(400).json({
        error: parsed.issues
          .map((i) => `${i.row ? `Row ${i.row}: ` : ""}${i.message}`)
          .slice(0, 20)
          .join(" "),
        issues: parsed.issues,
      });
    const id = randomBytes(24).toString("hex");
    await previews.put(
      id,
      { kind: "assessment-monthly", rows: parsed.rows },
      req.user.id,
    );
    res.json({
      id,
      rows: parsed.rows,
      warnings: parsed.warnings,
      message:
        "Monthly assessment totals only. No participant records or unique-person counts will be created.",
    });
  });
  async function saveRows(req, rows, previewId) {
    const revise = req.body?.revise === true,
      created = new Date().toISOString();
    if (db.storage)
      return db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(714206)");
        if (previewId) rows = await readPreview(tx, req, previewId);
        const plan = monthlyPlan(
          await tx
            .prepare("SELECT * FROM assessment_monthly ORDER BY id")
            .all(),
          rows,
          revise,
        );
        const values = plan.inserts.map((r) => ({
          ...r,
          created,
          user_id: req.user.id,
        }));
        if (values.length)
          await tx.query(
            `INSERT INTO glowbb.assessment_monthly(${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS x(fingerprint text,month text,type text,total integer,reported_as_of text,complete integer,created text,user_id integer) ON CONFLICT(fingerprint) DO NOTHING`,
            [JSON.stringify(values)],
          );
        await tx.storage.audit(
          tx,
          req.user.id,
          "assessments.monthly.recorded",
          {
            entries: plan.inserts.length,
            duplicates: plan.duplicates,
            revisionConfirmed: revise,
          },
        );
        if (previewId)
          await tx
            .prepare("DELETE FROM import_previews WHERE id=?")
            .run(previewId);
        return { saved: plan.inserts.length, duplicates: plan.duplicates };
      });
    // All SQLite writes execute synchronously inside one transaction.
    if (previewId) rows = readPreviewSync(req, previewId);
    const plan = monthlyPlan(
      db.prepare("SELECT * FROM assessment_monthly ORDER BY id").all(),
      rows,
      revise,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of plan.inserts)
        db.prepare(insertSql).run(
          r.fingerprint,
          r.month,
          r.type,
          r.total,
          r.reported_as_of,
          r.complete,
          created,
          req.user.id,
        );
      sqliteAudit(db, req.user.id, "assessments.monthly.recorded", {
        entries: plan.inserts.length,
        duplicates: plan.duplicates,
        revisionConfirmed: revise,
      });
      if (previewId)
        db.prepare("DELETE FROM import_previews WHERE id=?").run(previewId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { saved: plan.inserts.length, duplicates: plan.duplicates };
  }
  function checkPreview(p) {
    if (!p || p.expires < Date.now())
      throw error("Preview expired. Upload the report again.");
    const parsed = JSON.parse(p.payload);
    if (parsed.kind !== "assessment-monthly")
      throw error("This preview is for a different import.");
    return parsed.rows;
  }
  const readPreviewSync = (req, id) =>
    checkPreview(
      db
        .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
        .get(id, req.user.id),
    );
  const readPreview = async (tx, req, id) =>
    checkPreview(
      await tx
        .prepare(
          "SELECT * FROM import_previews WHERE id=? AND user_id=? FOR UPDATE",
        )
        .get(id, req.user.id),
    );
  app.post("/api/operations/assessments/confirm", async (req, res) => {
    admin(req);
    if (typeof req.body?.id !== "string")
      throw error("Choose an assessment report preview.");
    res.json(await saveRows(req, null, req.body.id));
  });
  app.post("/api/operations/assessments", async (req, res) => {
    admin(req);
    const b = req.body || {};
    const parsed = parseAssessmentTotals([
      assessmentHeaders,
      [
        b.month,
        b.sppb ?? "",
        b.tanita ?? "",
        b.reportedAsOf,
        b.final === true ? "YES" : "NO",
      ],
    ]);
    if (parsed.issues.length)
      throw error(parsed.issues.map((i) => i.message).join(" "));
    res.json(await saveRows(req, parsed.rows));
  });
  app.get("/api/operations/export", async (req, res) => {
    if (
      ["gender", "race", "target", "ageBand", "client", "boundary"].some(
        (k) => req.query[k] && req.query[k] !== "all",
      )
    )
      throw error(
        "Reset audience filters before exporting a shareable operational report.",
      );
    const result = await report(req);
    const cell = (value) =>
      '"' +
      String(value ?? "Unavailable")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows = [
      ["Reporting period", result.period.from, result.period.to],
      [
        "Demographic breakdowns omitted from shared exports. Monthly assessment totals cannot be split into daily/weekly counts. Blank assessment records mean unavailable, not zero.",
      ],
      [
        "Period",
        "Unique programme types",
        "Sessions",
        "Attendances (all ages)",
        "Unique participants (all ages)",
        "Average attendance per session",
        "First observed participants",
        "Previously recorded participants",
        "SPPB reported assessments",
        "Tanita reported assessments",
      ],
      ...result.rows.map((r) => [
        r.label,
        r.programmes,
        r.sessions,
        r.attendance,
        r.unique,
        r.average,
        r.firstObserved,
        r.returning,
        r.sppb,
        r.tanita,
      ]),
    ];
    res
      .type("text/csv")
      .attachment("operational-summary.csv")
      .send("\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"));
  });
}
