import {saveLegacyDefinitionVersion} from './configuration.js';
import { dataTransaction } from "./data-management.js";
import { readEffectiveData } from "./needs-domain.js";
import {staffAnalysisSettings} from './staff-analysis.js';
import { protectedRiskReport } from "./risk-report.js";
import { analytics, defaults } from "./domain.js";
const fail = (status, message) => Object.assign(Error(message), { status });
const admin = (req) => {
  if (req.user.role !== "admin")
    throw fail(403, "Administrator access is required.");
};
export function mountAnalysis(app, { db, storage, filters }) {
  const exportable = (req, filters) => {
    if (req.user.role === "viewer")
      throw fail(403, "This account cannot export reports.");
    if (
      [
        "gender",
        "race",
        "ageBand",
        "client",
        "boundary",
        "risk",
        "cfs",
        "observed",
      ].some((k) => filters[k]) ||
      (filters.target && filters.target !== "all")
    )
      throw fail(
        403,
        "Reset audience filters before exporting. Sensitive filtered downloads are restricted.",
      );
  };
  const exportRows = (report, chart) => {
    if (
      ![
        "unique",
        "attendance",
        "sessions",
        "programmes",
        "average",
        "repeat",
        "firstObserved",
        "returning",
      ].includes(chart.metric) ||
      !["programme", "domain", "month", "week", "timing"].includes(chart.group)
    )
      throw fail(
        403,
        "This chart includes restricted demographic information. Choose a general participation chart for export.",
      );
    const rows =
      chart.group === "programme"
        ? report.programmes.map((p) => ({ ...p, label: p.name }))
        : chart.group === "domain"
          ? report.domains
          : chart.group === "timing"
            ? report.timing
            : report.trends;
    return [
      ["Analysis", chart.metric, "Grouped by", chart.group],
      ["Reporting period", report.period.from, report.period.to],
      ["Group", "Value"],
      ...rows.map((r) => [r.label, r[chart.metric]]),
    ];
  };
  const sendCsv = (res, rows) => {
    const cell = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    res
      .type("text/csv")
      .attachment("saved-analysis.csv")
      .send("\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"));
  };
  app.get("/api/analysis/export", async (req, res) => {
    const f = filters(req);
    exportable(req, f);
    const chart = { group: f.group, metric: f.metric };
    const report = analytics(
      await readEffectiveData(db, storage),
      await storage.getSettings(db),
      { ...f, interval: chart.group === "week" ? "week" : "month" },
    );
    sendCsv(res, [
      ...exportRows(report, chart),
      ["Active filters", JSON.stringify(f)],
      [
        "Limitations",
        "Unique counts overlap across programmes and periods; attendance is not evidence of causal impact. Current participant profiles are used.",
      ],
    ]);
  });
  app.get("/api/analysis/view/:id/export", async (req, res) => {
    const p = await db
      .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
      .get(req.user.id);
    const view =
      p && JSON.parse(p.value).views.find((v) => v.id === req.params.id);
    if (!view) throw fail(404, "Personal view not found.");
    const f = filters({ query: view.filters || {} });
    exportable(req, f);
    const data = await readEffectiveData(db, storage),
      settings = await storage.getSettings(db),
      report = analytics(data, settings, f);
    const allowed = [
      "unique",
      "attendance",
      "sessions",
      "programmes",
      "average",
      "repeat",
      "firstObserved",
      "returning",
    ];
    const rows = [
      ["Saved view", view.name],
      ["Reporting period", report.period.from, report.period.to],
      ["Saved filters", JSON.stringify(f)],
      ["KPI", "Value"],
      ...view.kpis
        .filter((k) => allowed.includes(k))
        .map((k) => [k, report.summary[k]]),
    ];
    let weeklyReport = f.interval === "week" ? report : null;
    for (const chart of view.charts)
      if (
        allowed.includes(chart.metric) &&
        ["programme", "domain", "month", "week", "timing"].includes(chart.group)
      )
        rows.push(
          ...exportRows(
            chart.group === "week"
              ? (weeklyReport ||= analytics(data, settings, {
                  ...f,
                  interval: "week",
                }))
              : report,
            chart,
          ),
        );
    rows.push(
      [
        "Privacy",
        "Demographic and risk cards/charts are omitted from shared reports.",
      ],
      [
        "Limitations",
        "Do not add unique counts across programmes or periods. Saved absolute dates are used; refresh and resave rolling periods before reporting.",
      ],
    );
    sendCsv(res, rows);
  });
  app.get("/api/preferences", async (req, res) => {
    const row = await db
      .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
      .get(req.user.id);
    res.json(
      row
        ? JSON.parse(row.value)
        : { views: [], active: "", template: "Overview" },
    );
  });
  app.put("/api/preferences", async (req, res) => {
    const value = req.body;
    if (
      !value ||
      !Array.isArray(value.views) ||
      value.views.length > 30 ||
      JSON.stringify(value).length > 50000
    )
      throw fail(400, "Save up to 30 personal views within 50 KB.");
    await dataTransaction(
      db,
      function* (tx) {
        const previous = yield tx
          .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
          .get(req.user.id);
        const saved = previous ? JSON.parse(previous.value) : {};
        const next = {
          ...value,
          ...(saved.clients ? { clients: saved.clients } : {}),
          ...(saved.patterns ? { patterns: saved.patterns } : {}),
          ...(saved.configuration ? {configuration:saved.configuration}:{}),
        };
        yield tx
          .prepare(
            "INSERT INTO staff_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
          )
          .run(req.user.id, JSON.stringify(next));
      },
      false,
      ["staff_preferences"],
    );
    res.json({ ok: true });
  });
  app.get("/api/risk-configuration", async (req, res) => {
    admin(req);
    const data = await readEffectiveData(db, storage),
      settings = await storage.getSettings(db);
    const values = new Map();
    for (const p of data.participants) {
      const raw = p.riskRaw ?? "";
      values.set(raw, (values.get(raw) || 0) + 1);
    }
    const observed = await db
      .prepare("SELECT DISTINCT raw FROM risk_observations")
      .all();
    for (const { raw } of observed)
      if (!values.has(raw ?? "")) values.set(raw ?? "", 0);
    res.json({
      settings,
      values: [...values].map(([raw, participants]) => ({
        raw,
        participants,
        mapping: settings.riskMappings?.[raw] || null,
      })),
    });
  });
  app.put("/api/risk-configuration", async (req, res) => {
    admin(req);
    const {
      riskMappings,
      multipleRiskFactors,
      privacyMinimum,
      timeBands,
      sharedTemplates,
    } = req.body || {};
    if (
      !riskMappings ||
      typeof riskMappings !== "object" ||
      Array.isArray(riskMappings) ||
      Object.keys(riskMappings).length > 200 ||
      typeof multipleRiskFactors !== "boolean" ||
      !Number.isInteger(privacyMinimum) ||
      privacyMinimum < 5 ||
      privacyMinimum > 100
    )
      throw fail(400, "Check mappings and privacy threshold (5–100).");
    for (const [code, m] of Object.entries(riskMappings)) {
      if (
        !code.trim() ||
        code.length > 500 ||
        !m ||
        typeof m.label !== "string" ||
        !m.label.trim() ||
        m.label.length > 200 ||
        typeof m.meaning !== "string" ||
        !m.meaning.trim() ||
        m.meaning.length > 2000 ||
        typeof m.noRisk !== "boolean" ||
        !Array.isArray(m.categories) ||
        m.categories.length > 20 ||
        m.categories.some(
          (x) => typeof x !== "string" || !x.trim() || x.length > 100,
        ) ||
        (m.noRisk && m.categories.length) ||
        (!multipleRiskFactors && m.categories.length > 1)
      )
        throw fail(
          400,
          "Each code needs a label, documented meaning and valid categories. No-risk codes cannot also have risk categories.",
        );
    }
    if (
      timeBands &&
      (!Array.isArray(timeBands) ||
        timeBands.length !== 2 ||
        !timeBands.every(Number.isInteger) ||
        timeBands[0] < 1 ||
        timeBands[1] <= timeBands[0] ||
        timeBands[1] > 1439)
    )
      throw fail(
        400,
        "Enter ordered time-band boundaries in minutes after midnight.",
      );
    if (
      sharedTemplates &&
      (!Array.isArray(sharedTemplates) ||
        sharedTemplates.length > 20 ||
        JSON.stringify(sharedTemplates).length > 30000)
    )
      throw fail(400, "Check shared templates.");
    const settings = {
      ...defaults,
      ...(await storage.getSettings(db)),
      riskMappings,
      multipleRiskFactors,
      privacyMinimum,
      ...(timeBands ? { timeBands } : {}),
      ...(sharedTemplates ? { sharedTemplates } : {}),
    };
    await saveLegacyDefinitionVersion(db,req.user,settings,'Approved through the existing risk definitions editor.');
    await storage.audit(db, req.user.id, "risk.definitions.updated", {
      codes: Object.keys(riskMappings).length,
      privacyMinimum,
    });
    res.json({ ok: true });
  });
  app.get("/api/social-risk", async (req, res) => {
    if (req.user.role === "viewer")
      throw fail(
        403,
        "Social risk analysis is restricted to authorised planners and administrators.",
      );
    // One fixed full-history cohort, with no arbitrary filters or cross-tabs. This
    // prevents differencing queries against totals, dates and demographic slices.
    if (Object.keys(req.query).length)
      throw fail(
        403,
        "Risk reports use the full available cohort. Filtered risk queries are restricted to prevent reconstruction.",
      );
    const data = await readEffectiveData(db, storage),
      settings = await storage.getSettings(db);
    res.json(protectedRiskReport(data, staffAnalysisSettings(settings,req.user)));
  });
  app.get("/api/backups/:id", async (req, res) => {
    admin(req);
    const backup = await db
      .prepare("SELECT payload FROM attendance_backups WHERE id=?")
      .get(req.params.id);
    if (!backup) throw fail(404, "Backup not found.");
    res
      .type("application/json")
      .attachment("attendance-backup.json")
      .send(backup.payload);
  });
  app.get("/api/backups", async (req, res) => {
    admin(req);
    res.json(
      await db
        .prepare(
          "SELECT id,created FROM attendance_backups ORDER BY created DESC",
        )
        .all(),
    );
  });
}
