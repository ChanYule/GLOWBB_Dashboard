import { centreById } from "../shared/centres.js";
import { needsAnalysis } from "./needs-domain.js";
import { randomUUID } from "node:crypto";
import { analytics, hash, todaySG } from "./domain.js";
import { clientReport } from "./client-domain.js";
import { dataTransaction } from "./data-management.js";
import {
  reportingConfiguration,
  matchingActivities,
  projectReportingData,
  policySummary,
} from "./reporting-policy.js";
const fail = (status, message) => Object.assign(Error(message), { status });
const admin = (req) => {
  if (req.user.role !== "admin")
    throw fail(403, "Administrator approval is required.");
};
const staff = (req) => {
  if (!["admin", "planner"].includes(req.user.role))
    throw fail(403, "Staff access is required for configuration review.");
};
const validDay = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\d$/.test(v) &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const scopes = ["official", "performance", "report", "review"];
export const REPORT_TEMPLATES = [
  "Monthly Centre Performance",
  "Programme Effectiveness",
  "Male and Minority Outreach",
  "Participant Needs and Accessibility",
  "Inactive Client Engagement",
  "Quarterly Management Review",
];
export async function configurationState(db, storage) {
  if (storage.readPlanningState) return storage.readPlanningState(db);
  return dataTransaction(
    db,
    function* (tx) {
      return {
        data: storage.readData(tx),
        settings: storage.getSettings(tx),
        profiles: yield tx.prepare("SELECT * FROM participant_profiles").all(),
        feedback: yield tx.prepare("SELECT * FROM participant_feedback").all(),
        registry: yield tx.prepare("SELECT * FROM member_registry").all(),
      };
    },
    true,
  );
}
function* transactionState(tx, storage) {
  if (storage.readPlanningState) return yield storage.readPlanningState(tx);
  return {
    data: yield storage.readData(tx),
    settings: yield storage.getSettings(tx),
    profiles: yield tx.prepare("SELECT * FROM participant_profiles").all(),
    registry: yield tx.prepare("SELECT * FROM member_registry").all(),
    feedback: yield tx.prepare("SELECT * FROM participant_feedback").all(),
  };
}
const fingerprint = (state) =>
  hash({
    settings: state.settings,
    data: Object.fromEntries(
      Object.entries(state.data).map(([k, rows]) => [
        k,
        [...rows].sort((a, b) =>
          String(a.id || a.participantId).localeCompare(
            String(b.id || b.participantId),
          ),
        ),
      ]),
    ),
    profiles: state.profiles,
    registry: state.registry,
    feedback: state.feedback,
  });
function dates(body) {
  const from = body.from || "",
    to = body.to || todaySG();
  if (
    (from && !validDay(from)) ||
    !validDay(to) ||
    to > todaySG() ||
    (from && from > to)
  )
    throw fail(400, "Choose a valid delivered reporting period.");
  return { from, to };
}
function validateRule(input, data, settings) {
  if (!input || !scopes.includes(input.scope))
    throw fail(400, "Choose an exclusion scope.");
  const selector = input.selector;
  if (!selector || typeof selector !== "object" || Array.isArray(selector))
    throw fail(400, "Choose activities or a matching rule.");
  const allowed = ["ids", "type", "value"];
  if (Object.keys(selector).some((k) => !allowed.includes(k)))
    throw fail(400, "Choose supported matching fields.");
  if (selector.ids?.length) {
    if (
      !Array.isArray(selector.ids) ||
      selector.ids.length > 10000 ||
      !selector.ids.every(
        (id) =>
          typeof id === "string" && data.programmes.some((p) => p.id === id),
      )
    )
      throw fail(
        400,
        "Some selected activities no longer exist. Refresh the activity list.",
      );
  } else if (
    ![
      "name",
      "contains",
      "prefix",
      "domain",
      "eventType",
      "service",
      "flag",
      "all",
    ].includes(selector.type) ||
    (selector.type !== "all" &&
      (typeof selector.value !== "string" ||
        !selector.value.trim() ||
        selector.value.length > 200))
  )
    throw fail(400, "Enter a specific rule value.");
  if (
    (input.from && !validDay(input.from)) ||
    (input.to && !validDay(input.to)) ||
    (input.from && input.to && input.from > input.to)
  )
    throw fail(400, "Check the rule effective dates.");
  if (
    input.scope === "report" &&
    (typeof input.reportId !== "string" ||
      !input.reportId.trim() ||
      input.reportId.length > 100)
  )
    throw fail(400, "Choose the saved report identifier.");
  const matched = matchingActivities(data, selector, settings).map((p) => p.id);
  if (matched.length > 10000)
    throw fail(400, "Refine the rule to at most 10,000 activities.");
  return {
    id: randomUUID(),
    scope: input.scope,
    selector,
    from: input.from || "",
    to: input.to || "",
    reportId: input.reportId || "",
    enabled: true,
    status: "Approved",
    approvedIds: matched,
    reviewedIds: matched,
  };
}
function definitionChanges(settings, value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw fail(400, "Choose valid reporting definitions.");
  const maps = ["livingGroups", "domainGroups", "cfsMappings", "riskMappings"];
  for (const key of maps)
    if (
      value[key] !== undefined &&
      (!value[key] ||
        typeof value[key] !== "object" ||
        Array.isArray(value[key]) ||
        Object.keys(value[key]).length > 200 ||
        Object.keys(value[key]).some(
          (k) =>
            !k.trim() ||
            k.length > 200 ||
            ["__proto__", "constructor", "prototype"].includes(k),
        ))
    )
      throw fail(
        400,
        "Mappings require exact source keys and documented values.",
      );
  if (
    value.multipleRiskFactors !== undefined &&
    typeof value.multipleRiskFactors !== "boolean"
  )
    throw fail(400, "Choose whether multiple SRF categories are supported.");
  const s = { ...settings };
  for (const k of [
    "seniorAge",
    "ageBands",
    "minority",
    "engagement",
    "inactivityBands",
    "cfsMappings",
    "livingGroups",
    "domainGroups",
    "riskMappings",
    "multipleRiskFactors",
  ])
    if (value[k] !== undefined) s[k] = value[k];
  if (
    !Number.isInteger(s.seniorAge) ||
    s.seniorAge < 1 ||
    s.seniorAge > 100 ||
    !Array.isArray(s.ageBands) ||
    s.ageBands.length !== 2 ||
    !s.ageBands.every(Number.isInteger) ||
    s.ageBands[0] <= s.seniorAge ||
    s.ageBands[1] <= s.ageBands[0] ||
    s.ageBands[1] > 120
  )
    throw fail(
      400,
      "Check the senior threshold and two ascending age boundaries.",
    );
  if (
    !Array.isArray(s.minority) ||
    s.minority.length > 20 ||
    !s.minority.every(
      (v) =>
        typeof v === "string" &&
        v.trim() &&
        v.length < 100 &&
        !["MISSING", "UNKNOWN"].includes(v.trim().toUpperCase()),
    )
  )
    throw fail(
      400,
      "Choose known source race categories for minority reporting.",
    );
  s.minority = [...new Set(s.minority.map((v) => v.trim().toUpperCase()))];
  if (
    !Number.isInteger(s.engagement?.regularFrom) ||
    s.engagement.regularFrom < 3 ||
    s.engagement.regularFrom > 1000
  )
    throw fail(400, "Regular engagement must start at 3 to 1,000 sessions.");
  if (
    !Array.isArray(s.inactivityBands) ||
    s.inactivityBands.length !== 3 ||
    !s.inactivityBands.every(
      (n, i) =>
        Number.isInteger(n) &&
        n > 0 &&
        n <= 3650 &&
        (!i || n > s.inactivityBands[i - 1]),
    )
  )
    throw fail(400, "Choose three ascending inactivity day thresholds.");
  for (const key of ["livingGroups", "domainGroups"])
    if (
      value[key] &&
      (!Object.values(s[key]).every(
        (v) => typeof v === "string" && v.trim() && v.length <= 100,
      ) ||
        Object.keys(s[key]).length > 200)
    )
      throw fail(
        400,
        "Approved mappings need exact source values and concise labels.",
      );
  if (
    value.cfsMappings &&
    !Object.values(value.cfsMappings).every(
      (v) =>
        v &&
        typeof v.label === "string" &&
        v.label.trim() &&
        v.label.length <= 100 &&
        typeof v.meaning === "string" &&
        v.meaning.trim() &&
        v.meaning.length <= 500,
    )
  )
    throw fail(400, "CFS mappings require documented labels.");
  if (
    value.riskMappings &&
    (!Object.values(value.riskMappings).every(
      (v) =>
        v &&
        typeof v.label === "string" &&
        v.label.trim() &&
        typeof v.meaning === "string" &&
        v.meaning.trim() &&
        typeof v.noRisk === "boolean" &&
        Array.isArray(v.categories) &&
        v.categories.every(
          (c) => typeof c === "string" && c.trim() && c.length <= 100,
        ) &&
        (!v.noRisk || !v.categories.length),
    ) ||
      Object.keys(value.riskMappings).length > 200)
  )
    throw fail(
      400,
      "Use documented SRF labels, meanings, categories and no-risk flags.",
    );
  return s;
}
function projected(state, settings, context = {}) {
  return {
    ...state,
    settings,
    data: projectReportingData(state.data, {
      settings,
      mode: "official",
      ...context,
    }),
  };
}
export function reportingImpact(state, settings, period, context = {}) {
  const view = projected(state, settings, context),
    report = analytics(view.data, settings, period),
    clients = clientReport(view, period, todaySG(), true);
  return {
    summary: report.summary,
    rankings: report.programmes.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      unique: p.unique,
      attendance: p.attendance,
      repeat: p.repeat,
    })),
    clientMetrics:
      clients.available && clients.complete ? clients.summary : null,
    clientStatuses:
      clients.available && clients.complete ? clients.statuses : null,
    note: "Unique counts are recalculated from remaining attendance, never subtracted by programme. Client rates/inactivity require a verified registry and eligible attendance history. Reported monthly assessment totals have no activity linkage and are unchanged.",
  };
}
async function preference(db, user) {
  const row = await db
    .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
    .get(user);
  return row ? JSON.parse(row.value) : {};
}
function inventory(state, period) {
  const config = reportingConfiguration(state.settings),
    sessions = new Map(),
    attendance = new Map();
  for (const s of state.data.sessions)
    if ((!period.from || s.date >= period.from) && s.date <= period.to) {
      if (!sessions.has(s.programmeId)) sessions.set(s.programmeId, []);
      sessions.get(s.programmeId).push(s);
    }
  const sessionMap = new Map(state.data.sessions.map((s) => [s.id, s]));
  for (const a of state.data.attendance) {
    const s = sessionMap.get(a.sessionId);
    if (!s || (period.from && s.date < period.from) || s.date > period.to)
      continue;
    if (!attendance.has(s.programmeId)) attendance.set(s.programmeId, []);
    attendance.get(s.programmeId).push(a);
  }
  const matchMap = new Map(
    config.rules
      .filter((r) => r.enabled !== false)
      .map((r) => [
        r.id,
        new Set(
          matchingActivities(state.data, r.selector, state.settings).map(
            (p) => p.id,
          ),
        ),
      ]),
  );
  return state.data.programmes.map((p) => {
    const own = sessions.get(p.id) || [],
      entries = attendance.get(p.id) || [],
      rules = config.rules.filter(
        (r) =>
          r.enabled !== false &&
          (r.approvedIds || []).includes(p.id) &&
          own.some(
            (s) => (!r.from || s.date >= r.from) && (!r.to || s.date <= r.to),
          ),
      ),
      pending = config.rules.filter(
        (r) =>
          r.enabled !== false &&
          matchMap.get(r.id)?.has(p.id) &&
          !(r.reviewedIds || r.approvedIds || []).includes(p.id),
      );
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      eventTypes: [
        ...new Set(own.flatMap((s) => s.optional?.eventTypes || [])),
      ],
      sessions: own.length,
      attendance: entries.length,
      unique: new Set(entries.map((a) => a.participantId)).size,
      status:
        pending.length || rules.some((r) => r.scope === "review")
          ? "Review Required"
          : rules.some((r) => r.scope !== "review")
            ? "Excluded"
            : "Included",
      rules: rules.map((r) => ({
        id: r.id,
        scope: r.scope,
        reason: r.reason,
        from: r.from,
        to: r.to,
        reportId: r.reportId,
      })),
      pending: pending.map((r) => ({
        id: r.id,
        scope: r.scope,
        reason: r.reason,
      })),
      classification: own.some((s) => !s.optional?.centreClassification)
        ? "Some source classifications unavailable"
        : "Recorded",
    };
  });
}
export function* saveDefinitionInTransaction(tx, user, next, reason) {
  const before = JSON.parse(
      (yield tx.prepare("SELECT value FROM settings WHERE id=1").get()).value,
    ),
    config = reportingConfiguration(before),
    after = { ...next, reporting: { ...config, version: config.version + 1 } };
  yield tx
    .prepare("UPDATE settings SET value=? WHERE id=1")
    .run(JSON.stringify(after));
  yield tx
    .prepare(
      "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
    )
    .run(
      new Date().toISOString(),
      user.id,
      "configuration.approved",
      JSON.stringify({
        before,
        after,
        reason,
        actor: user.username,
        operation: "legacy-definitions",
      }),
    );
  return after;
}
export async function saveLegacyDefinitionVersion(
  db,
  user,
  next,
  reason = "Approved through the existing settings workflow.",
) {
  return dataTransaction(
    db,
    function* (tx) {
      return yield* saveDefinitionInTransaction(tx, user, next, reason);
    },
    false,
    ["settings", "audit"],
  );
}
export function mountConfiguration(app, { db, storage }) {
  app.get("/api/configuration", async (req, res) => {
    staff(req);
    const state = await configurationState(db, storage),
      personal = await preference(db, req.user.id);
    res.json({
      settings: state.settings,
      configuration: reportingConfiguration(state.settings),
      personal: personal.configuration || {},
      templates: REPORT_TEMPLATES,
      role: req.user.role,
      source: "Manual imports",
      caritaHub: {
        connected: false,
        note: "CaritaHub is not connected. Retrieval preferences are drafts; no sync is performed.",
      },
    });
  });
  app.get("/api/configuration/activities", async (req, res) => {
    staff(req);
    const state = await configurationState(db, storage),
      period = dates(req.query),
      page = Number(req.query.page || 1),
      search = String(req.query.search || "")
        .trim()
        .toLowerCase();
    if (!Number.isInteger(page) || page < 1)
      throw fail(400, "Choose a valid activity page.");
    const rows = inventory(state, period).filter(
      (p) =>
        (!search ||
          p.name.toLowerCase().includes(search) ||
          p.domain.toLowerCase().includes(search)) &&
        (!req.query.status || p.status === req.query.status),
    );
    res.json({
      rows: rows.slice((page - 1) * 25, page * 25),
      total: rows.length,
      page,
      pages: Math.max(1, Math.ceil(rows.length / 25)),
      version: reportingConfiguration(state.settings).version,
      period,
    });
  });
  app.get("/api/configuration/history", async (req, res) => {
    admin(req);
    const rows = await db
      .prepare(
        "SELECT id,created,user_id,action,details FROM audit WHERE action IN ('configuration.approved','configuration.requested','configuration.request.reviewed','configuration.personal') ORDER BY id DESC",
      )
      .all();
    res.json({
      rows: rows
        .slice(
          (Math.max(1, Number(req.query.page) || 1) - 1) * 20,
          Math.max(1, Number(req.query.page) || 1) * 20,
        )
        .map((r) => ({ ...r, details: JSON.parse(r.details) })),
      total: rows.length,
    });
  });
  app.get("/api/configuration/requests", async (req, res) => {
    admin(req);
    const rows = await db
        .prepare(
          "SELECT id,created,user_id,action,details FROM audit WHERE action IN ('configuration.requested','configuration.request.reviewed') ORDER BY id DESC",
        )
        .all(),
      reviewed = new Set(
        rows
          .filter((r) => r.action === "configuration.request.reviewed")
          .map((r) => JSON.parse(r.details).requestId),
      );
    res.json({
      rows: rows
        .filter(
          (r) => r.action === "configuration.requested" && !reviewed.has(r.id),
        )
        .map((r) => ({ ...r, details: JSON.parse(r.details) })),
    });
  });
  const previewChange = async (req, res) => {
    staff(req);
    const state = await configurationState(db, storage),
      body = req.body || {},
      config = reportingConfiguration(state.settings),
      period = dates(body),
      reason = String(body.reason || "").trim();
    if (reason.length < 5 || reason.length > 500)
      throw fail(400, "Record a concise reason of 5 to 500 characters.");
    if (body.version !== config.version)
      throw fail(
        409,
        "Reporting configuration changed. Reload and review again.",
      );
    let settings = structuredClone(state.settings),
      candidate = reportingConfiguration(settings),
      rule = null,
      requestId = null;
    if (body.operation === "rule") {
      rule = validateRule(body.rule, state.data, state.settings);
      rule = {
        ...rule,
        reason,
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
      };
      if (body.replaceRuleId) {
        if (!candidate.rules.some((r) => r.id === body.replaceRuleId))
          throw fail(409, "That rule no longer exists.");
        candidate.rules = candidate.rules.filter(
          (r) => r.id !== body.replaceRuleId,
        );
      }
      if (candidate.rules.length >= 100)
        throw fail(400, "Review or restore existing rules before adding more.");
      candidate.rules.push(rule);
    } else if (body.operation === "approveMatches") {
      const old = candidate.rules.find(
        (r) => r.id === body.ruleId && r.enabled !== false,
      );
      if (!old) throw fail(404, "Rule not found.");
      const matched = matchingActivities(state.data, old.selector, settings)
        .map((p) => p.id)
        .filter((id) => !(old.reviewedIds || old.approvedIds).includes(id));
      rule = {
        ...old,
        approvedIds: [...new Set([...old.approvedIds, ...matched])],
        reviewedIds: [
          ...new Set([...(old.reviewedIds || old.approvedIds), ...matched]),
        ],
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
        reason,
      };
      candidate.rules = candidate.rules.map((r) =>
        r.id === old.id ? rule : r,
      );
    } else if (body.operation === "restoreActivities") {
      if (
        !Array.isArray(body.ids) ||
        !body.ids.length ||
        !body.ids.every((id) => state.data.programmes.some((p) => p.id === id))
      )
        throw fail(400, "Select current activities to restore.");
      candidate.rules = candidate.rules.map((r) => ({
        ...r,
        approvedIds: r.approvedIds.filter((id) => !body.ids.includes(id)),
        reviewedIds: [
          ...new Set([...(r.reviewedIds || r.approvedIds), ...body.ids]),
        ],
      }));
    } else if (body.operation === "restoreVersion") {
      admin(req);
      const rows = await db
          .prepare(
            "SELECT details FROM audit WHERE action='configuration.approved' ORDER BY id DESC",
          )
          .all(),
        snapshots = rows.flatMap((r) => {
          const d = JSON.parse(r.details);
          return [d.before, d.after];
        }),
        old = snapshots.find(
          (s) => reportingConfiguration(s).version === body.restoreVersion,
        );
      if (!old)
        throw fail(404, "That approved configuration snapshot is unavailable.");
      // Restore reporting definitions, not registry/source attestation or operational records.
      for (const key of [
        "seniorAge",
        "ageBands",
        "minority",
        "engagement",
        "inactivityBands",
        "cfsMappings",
        "livingGroups",
        "domainGroups",
        "riskMappings",
        "multipleRiskFactors",
      ])
        settings[key] = old[key];
      candidate = reportingConfiguration(old);
    } else if (body.operation === "definitions") {
      admin(req);
      settings = definitionChanges(settings, body.values || {});
    } else if (body.operation === "sync") {
      admin(req);
      const v = body.values || {};
      if (
        !Array.isArray(v.categories) ||
        !v.categories.every((c) =>
          ["attendance", "clients", "programmes", "demographics"].includes(c),
        ) ||
        !["all", "dateRange"].includes(v.mode) ||
        (v.mode === "dateRange" &&
          (!validDay(v.from) || !validDay(v.to) || v.from > v.to))
      )
        throw fail(400, "Choose supported retrieval categories and dates.");
      candidate.sync = {
        connected: false,
        categories: [...new Set(v.categories)],
        mode: v.mode,
        from: v.from || "",
        to: v.to || "",
        duplicateHandling: "Exact identity deduplication",
        profiles: "Review nonblank conflicts",
        classification: "Verified source review",
        centreScope: "Current authorised centre",
      };
    } else if (body.operation === "warnings") {
      admin(req);
      const allowed = ["cfs", "srf", "living", "domain", "eventType"];
      if (
        !body.values ||
        Object.keys(body.values).some(
          (k) => !allowed.includes(k) || typeof body.values[k] !== "boolean",
        )
      )
        throw fail(400, "Choose supported missing-information warnings.");
      candidate.qualityWarnings = {
        ...candidate.qualityWarnings,
        ...body.values,
      };
    } else if (body.operation === "approveRequest") {
      admin(req);
      const row = await db
        .prepare(
          "SELECT * FROM audit WHERE id=? AND action='configuration.requested'",
        )
        .get(body.requestId);
      if (!row) throw fail(404, "Exclusion request not found.");
      requestId = row.id;
      const d = JSON.parse(row.details);
      rule = validateRule(d.rule, state.data, settings);
      rule = {
        ...rule,
        reason,
        approvedBy: req.user.id,
        approvedAt: new Date().toISOString(),
      };
      candidate.rules.push(rule);
    } else throw fail(400, "Choose a supported configuration change.");
    candidate.version = config.version + 1;
    settings.reporting = candidate;
    const id = randomUUID(),
      matched = rule
        ? state.data.programmes
            .filter((p) => rule.approvedIds.includes(p.id))
            .map((p) => ({ id: p.id, name: p.name }))
        : [],
      impact = {
        before: reportingImpact(state, state.settings, period),
        after: reportingImpact(state, settings, period),
        ...(rule?.scope === "report"
          ? {
              report: {
                before: reportingImpact(state, state.settings, period, {
                  reportId: rule.reportId,
                }),
                after: reportingImpact(state, settings, period, {
                  reportId: rule.reportId,
                }),
              },
            }
          : {}),
      };
    const payload = {
      kind: "configuration-preview",
      baseVersion: config.version,
      fingerprint: fingerprint(state),
      settings,
      reason,
      operation: body.operation,
      rule,
      requestId,
      matched,
      period,
      impact,
    };
    await db
      .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
      .run(id, req.user.id, Date.now() + 1200000, JSON.stringify(payload));
    res.json({
      id,
      version: config.version,
      nextVersion: candidate.version,
      matched,
      impact,
      period,
      rule,
      note: matched.length
        ? "Only these approved activity IDs will be affected. Future matches require review."
        : "No activity matches. Future matching activities will require review; nothing is silently excluded.",
    });
  };
  app.post("/api/configuration/preview", previewChange);
  const confirmChange = async (req, res) => {
    staff(req);
    const row = await db
      .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
      .get(req.body.id, req.user.id);
    if (!row || row.expires < Date.now())
      throw fail(409, "Configuration preview expired. Review again.");
    const p = JSON.parse(row.payload);
    if (p.kind !== "configuration-preview")
      throw fail(400, "Wrong preview type.");
    const prior = (
      await db
        .prepare(
          "SELECT details FROM audit WHERE action='configuration.approved'",
        )
        .all()
    )
      .map((r) => JSON.parse(r.details))
      .find((r) => r.previewId === req.body.id);
    if (prior)
      return res.json({
        status: "Already approved",
        version: reportingConfiguration(prior.after).version,
      });
    if (
      req.body.confirmed !== true ||
      (p.matched.length > 1 && req.body.bulkConfirmed !== true)
    )
      throw fail(400, "Confirm the impact and all matched activities.");
    const state = await configurationState(db, storage);
    if (fingerprint(state) !== p.fingerprint)
      throw fail(
        409,
        "Source records or configuration changed. Preview the impact again.",
      );
    if (req.user.role !== "admin") {
      if (p.operation !== "rule")
        throw fail(403, "Administrator approval is required.");
      await db
        .prepare(
          "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
        )
        .run(
          new Date().toISOString(),
          req.user.id,
          "configuration.requested",
          JSON.stringify({
            rule: p.rule,
            reason: p.reason,
            actor: req.user.username,
            baseVersion: p.baseVersion,
          }),
        );
      await db
        .prepare("DELETE FROM import_previews WHERE id=?")
        .run(req.body.id);
      return res.json({ status: "Pending approval", version: p.baseVersion });
    }
    await dataTransaction(
      db,
      function* (tx) {
        const checked = yield* transactionState(tx, storage);
        if (fingerprint(checked) !== p.fingerprint)
          throw fail(409, "Source records changed. Preview again.");
        const current = JSON.parse(
          (yield tx.prepare("SELECT value FROM settings WHERE id=1").get())
            .value,
        );
        if (reportingConfiguration(current).version !== p.baseVersion)
          throw fail(409, "Configuration changed. Preview again.");
        if (p.requestId) {
          const decisions = yield tx
            .prepare(
              "SELECT details FROM audit WHERE action='configuration.request.reviewed'",
            )
            .all();
          if (
            decisions.some(
              (r) => JSON.parse(r.details).requestId === p.requestId,
            )
          )
            throw fail(409, "This request has already been reviewed.");
        }
        yield tx
          .prepare("UPDATE settings SET value=? WHERE id=1")
          .run(JSON.stringify(p.settings));
        yield tx
          .prepare(
            "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
          )
          .run(
            new Date().toISOString(),
            req.user.id,
            "configuration.approved",
            JSON.stringify({
              before: current,
              after: p.settings,
              reason: p.reason,
              actor: req.user.username,
              operation: p.operation,
              approval: "Approved",
              period: p.period,
              previewId: req.body.id,
            }),
          );
        if (p.requestId)
          yield tx
            .prepare(
              "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
            )
            .run(
              new Date().toISOString(),
              req.user.id,
              "configuration.request.reviewed",
              JSON.stringify({
                requestId: p.requestId,
                status: "Approved",
                actor: req.user.username,
              }),
            ); /* Retain the reviewed receipt until expiry for idempotent approval retry. */
      },
      false,
      [
        "settings",
        "audit",
        "import_previews",
        "participants",
        "programmes",
        "sessions",
        "attendance",
        "participant_profiles",
        "profile_history",
        "member_registry",
        "participant_feedback",
      ],
    );
    res.json({ status: "Approved", version: p.settings.reporting.version });
  };
  app.post("/api/configuration/confirm", confirmChange);
  const invoke = async (handler, user, body) => {
    let result;
    await handler(
      { user, body },
      {
        json: (value) => {
          result = value;
        },
      },
    );
    return result;
  };
  app.configuration = {
    preview: (user, body) => invoke(previewChange, user, body),
    confirm: (user, body) => invoke(confirmChange, user, body),
  };
  app.post("/api/configuration/requests/:id/reject", async (req, res) => {
    admin(req);
    const id = Number(req.params.id),
      reason =
        typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (
      !Number.isInteger(id) ||
      typeof reason !== "string" ||
      reason.length < 5 ||
      reason.length > 500
    )
      throw fail(400, "Record why this request is not approved.");
    await dataTransaction(
      db,
      function* (tx) {
        if (
          !(yield tx
            .prepare(
              "SELECT id FROM audit WHERE id=? AND action='configuration.requested'",
            )
            .get(id))
        )
          throw fail(404, "Exclusion request not found.");
        const decisions = yield tx
          .prepare(
            "SELECT details FROM audit WHERE action='configuration.request.reviewed'",
          )
          .all();
        if (decisions.some((r) => JSON.parse(r.details).requestId === id))
          throw fail(409, "This request has already been reviewed.");
        yield tx
          .prepare(
            "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
          )
          .run(
            new Date().toISOString(),
            req.user.id,
            "configuration.request.reviewed",
            JSON.stringify({
              requestId: id,
              status: "Not approved",
              reason,
              actor: req.user.username,
            }),
          );
      },
      false,
      ["audit"],
    );
    res.json({ ok: true });
  });
  app.put("/api/configuration/personal", async (req, res) => {
    staff(req);
    const value = req.body || {},
      allowed = [
        "from",
        "to",
        "interval",
        "kpis",
        "charts",
        "dimension",
        "columns",
        "ranking",
        "layout",
        "presets",
        "reportTemplates",
      ];
    if (
      Object.keys(value).some((k) => !allowed.includes(k)) ||
      JSON.stringify(value).length > 30000
    )
      throw fail(400, "Save supported personal display preferences only.");
    if (
      value.kpis &&
      (!Array.isArray(value.kpis) ||
        !value.kpis.length ||
        value.kpis.length > 12 ||
        !value.kpis.every((k) =>
          [
            "unique",
            "male",
            "minority",
            "attendance",
            "sessions",
            "programmes",
            "repeat",
            "firstObserved",
            "returning",
            "average",
          ].includes(k),
        ))
    )
      throw fail(400, "Choose supported personal KPI cards.");
    if (
      value.charts &&
      (!Array.isArray(value.charts) ||
        value.charts.length > 12 ||
        !value.charts.every(
          (c) =>
            c &&
            typeof c.id === "string" &&
            [
              "month",
              "week",
              "programme",
              "gender",
              "race",
              "ages",
              "needs-cfs",
              "needs-living",
            ].includes(c.group) &&
            c.metric === "unique" &&
            ["bar", "line"].includes(c.type),
        ))
    )
      throw fail(400, "Choose supported personal charts.");
    if (
      (value.dimension &&
        ![
          "age",
          "cfs",
          "risk",
          "living",
          "gender",
          "race",
          "locationBlock",
        ].includes(value.dimension)) ||
      (value.ranking &&
        !["unique", "attendance", "repeat"].includes(value.ranking)) ||
      (value.columns &&
        (!Array.isArray(value.columns) ||
          !value.columns.length ||
          !value.columns.every((k) =>
            [
              "name",
              "domain",
              "unique",
              "attendance",
              "sessions",
              "repeat",
            ].includes(k),
          )))
    )
      throw fail(
        400,
        "Choose supported demographic, ranking and column preferences.",
      );
    if (
      value.reportTemplates &&
      (!Array.isArray(value.reportTemplates) ||
        value.reportTemplates.length > 30 ||
        !value.reportTemplates.every(
          (t) =>
            t &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            t.name.trim() &&
            t.name.length <= 100 &&
            REPORT_TEMPLATES.includes(t.template) &&
            ["official", "exploratory"].includes(t.mode) &&
            Array.isArray(t.sections) &&
            Array.isArray(t.excludedIds),
        ))
    )
      throw fail(400, "Save up to 30 valid personal report presets.");
    if (
      (value.from && !validDay(value.from)) ||
      (value.to && !validDay(value.to))
    )
      throw fail(400, "Choose valid personal reporting dates.");
    const previous = await preference(db, req.user.id),
      next = {
        views: [],
        active: "",
        template: "Overview",
        ...previous,
        configuration: { ...previous.configuration, ...value },
        ...(value.layout ? { template: value.layout, active: "" } : {}),
        draft: {
          id: "",
          name: "Personal overview",
          period: "Custom range",
          kpis: ["unique", "male", "minority", "attendance"],
          charts: [
            {
              id: "personal-month",
              group: "month",
              metric: "unique",
              type: "line",
            },
          ],
          ...previous.draft,
          ...(value.layout ? { name: value.layout } : {}),
          ...(value.columns ? { columns: value.columns } : {}),
          filters: {
            interval: "month",
            target: "all",
            ...previous.draft?.filters,
            ...Object.fromEntries(
              ["from", "to", "interval"]
                .filter((k) => value[k] !== undefined)
                .map((k) => [k, value[k]]),
            ),
          },
          ...(value.kpis ? { kpis: value.kpis } : {}),
          ...(value.charts ? { charts: value.charts } : {}),
        },
        patterns: {
          ...previous.patterns,
          ...(value.dimension ? { dimension: value.dimension } : {}),
          ...(value.ranking ? { ranking: value.ranking } : {}),
        },
      };
    await db
      .prepare(
        "INSERT INTO staff_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
      )
      .run(req.user.id, JSON.stringify(next));
    await db
      .prepare(
        "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
      )
      .run(
        new Date().toISOString(),
        req.user.id,
        "configuration.personal",
        JSON.stringify({
          actor: req.user.username,
          fields: Object.keys(value),
          note: "Personal display preferences only; official definitions unchanged.",
        }),
      );
    res.json({ ok: true });
  });
  mountReportBuilder(app, { db, storage });
}
function mountReportBuilder(app, { db, storage }) {
  app.post("/api/configuration/reports/preview", async (req, res) => {
    staff(req);
    const state = await configurationState(db, storage),
      period = dates(req.body),
      mode = req.body.mode || "official";
    if (
      !["official", "exploratory"].includes(mode) ||
      !REPORT_TEMPLATES.includes(req.body.template)
    )
      throw fail(400, "Choose an approved template and reporting mode.");
    const excluded = req.body.excludedIds || [];
    if (
      !Array.isArray(excluded) ||
      !excluded.every((id) => state.data.programmes.some((p) => p.id === id)) ||
      (mode === "official" && (excluded.length || req.body.includeExcluded))
    )
      throw fail(
        400,
        "Additional inclusion choices require Custom exploratory analysis.",
      );
    const context = {
        settings: state.settings,
        mode,
        includeExcluded:
          mode === "exploratory" && req.body.includeExcluded === true,
        customExcludes: excluded,
        reportId: req.body.reportId || "",
      },
      view = projected(state, state.settings, context),
      report = analytics(view.data, state.settings, period),
      clients = clientReport(view, period, todaySG(), true);
    if (
      req.body.ranking &&
      !["unique", "attendance", "repeat"].includes(req.body.ranking)
    )
      throw fail(400, "Choose a supported programme ranking.");
    const needs = needsAnalysis(
      view.data,
      state.profiles,
      state.feedback,
      state.registry,
      state.settings,
      period,
      todaySG(),
    );
    const kpis = [
        "unique",
        "male",
        "minority",
        "attendance",
        "sessions",
        "repeatRate",
        "programmes",
      ],
      selected = req.body.kpis || kpis;
    if (!Array.isArray(selected) || !selected.every((k) => kpis.includes(k)))
      throw fail(400, "Choose supported KPI fields.");
    const breakdowns = req.body.breakdowns || ["gender", "race", "ages"];
    if (
      !Array.isArray(breakdowns) ||
      !breakdowns.every((k) => ["gender", "race", "ages"].includes(k))
    )
      throw fail(400, "Choose supported demographic breakdowns.");
    const snapshot = {
      id: randomUUID(),
      kind: "configuration-report",
      configurationSnapshot: state.settings,
      inclusion: {
        reportId: context.reportId,
        includeExcluded: context.includeExcluded,
        excludedIds: excluded,
      },
      template: req.body.template,
      period,
      created: new Date().toISOString(),
      reporting: policySummary(context),
      sourceFingerprint: fingerprint(state),
      kpis: Object.fromEntries(
        selected.map((k) => [k, report.summary[k] ?? null]),
      ),
      trends: report.trends,
      programmes: [...report.programmes]
        .sort(
          (a, b) =>
            (b[req.body.ranking || "unique"] || 0) -
              (a[req.body.ranking || "unique"] || 0) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, Number(req.body.limit) === 10 ? 10 : 5)
        .map((p) => ({
          name: p.name,
          domain: p.domain,
          unique: p.unique,
          attendance: p.attendance,
          repeat: p.repeat,
          sessions: p.sessions,
        })),
      demographics: Object.fromEntries(breakdowns.map((k) => [k, report[k]])),
      clients:
        clients.available && clients.complete
          ? { summary: clients.summary, statuses: clients.statuses }
          : null,
      limitations: [
        policySummary(context).note,
        "Source records may change after this snapshot. The reporting configuration version is fixed for this export.",
        "Attendance does not establish causation, satisfaction or clinical suitability. Missing registries do not support client rates.",
      ],
      needs: {
        scope: needs.responses.scope,
        respondents: needs.responses.respondents,
        eligible: needs.responses.eligible,
        needs: needs.responses.needs,
        barriers: needs.responses.barriers,
        profiles: needs.profiles,
        limitations: needs.limitations,
      },
      columns: req.body.columns || [
        "name",
        "domain",
        "unique",
        "attendance",
        "sessions",
        "repeat",
      ],
      sections: req.body.sections || ["trends", "programmes"],
    };
    if (
      !Array.isArray(snapshot.columns) ||
      !snapshot.columns.length ||
      !snapshot.columns.every((k) =>
        [
          "name",
          "domain",
          "unique",
          "attendance",
          "sessions",
          "repeat",
        ].includes(k),
      )
    )
      throw fail(400, "Choose supported programme columns.");
    if (
      !Array.isArray(snapshot.sections) ||
      !snapshot.sections.every((k) =>
        ["trends", "programmes", "demographics", "clients", "needs"].includes(
          k,
        ),
      )
    )
      throw fail(400, "Choose supported report sections.");
    await db
      .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
      .run(
        snapshot.id,
        req.user.id,
        Date.now() + 1200000,
        JSON.stringify(snapshot),
      );
    res.json(snapshot);
  });
  app.get("/api/configuration/reports/:id/export", async (req, res) => {
    staff(req);
    const row = await db
      .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
    if (!row || row.expires < Date.now())
      throw fail(409, "Report preview expired. Generate another snapshot.");
    const r = JSON.parse(row.payload);
    if (r.kind !== "configuration-report")
      throw fail(400, "Wrong preview type.");
    const settings = await storage.getSettings(db);
    await db
      .prepare(
        "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
      )
      .run(
        new Date().toISOString(),
        req.user.id,
        "configuration.report.exported",
        JSON.stringify({
          reportId: r.id,
          template: r.template,
          version: r.reporting.version,
          mode: r.reporting.mode,
          period: r.period,
          sourceFingerprint: r.sourceFingerprint,
          reportingSettingsVersion: r.reporting.version,
          configurationSnapshot: r.configurationSnapshot,
          inclusion: r.inclusion,
        }),
      );
    const esc = (v) =>
        String(v ?? "Unavailable").replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        ),
      rows = [
        ["Template", r.template],
        ["Reporting mode", r.reporting.label],
        ["Configuration version", r.reporting.version],
        [
          "Centre",
          centreById(settings.centreId)?.name ||
            settings.centreId ||
            "Current centre",
        ],
        ["Period", r.period.from || "Available history", r.period.to],
        ["Snapshot generated", r.created],
        ...Object.entries(r.kpis),
      ];
    if (r.sections.includes("programmes")) {
      const labels = {
        name: "Programme",
        domain: "AAP Domain",
        unique: "Unique seniors",
        attendance: "Attendance entries",
        repeat: "Repeat seniors",
        sessions: "Sessions",
      };
      rows.push(
        r.columns.map((k) => labels[k]),
        ...r.programmes.map((p) => r.columns.map((k) => p[k])),
      );
    }
    if (r.sections.includes("trends"))
      rows.push(
        ["Trend period", "Unique seniors", "Attendance entries"],
        ...r.trends.map((t) => [t.label, t.unique, t.attendance]),
      );
    if (r.sections.includes("demographics"))
      for (const [name, values] of Object.entries(r.demographics))
        rows.push(
          [name, "Unique seniors"],
          ...values.map((v) => [v.label, v.value]),
        );
    if (r.sections.includes("needs"))
      rows.push(
        ["Needs and accessibility scope", r.needs.scope],
        [
          "Respondents",
          r.needs.respondents,
          "Eligible population",
          r.needs.eligible,
        ],
        ["Recorded needs", JSON.stringify(r.needs.needs)],
        ["Reported barriers", JSON.stringify(r.needs.barriers)],
        ...r.needs.limitations.map((v) => ["Needs limitation", v]),
      );
    if (r.sections.includes("clients"))
      rows.push([
        "Client metrics",
        r.clients
          ? JSON.stringify(r.clients.summary)
          : "Verified centre registry required",
      ]);
    rows.push(...r.limitations.map((v) => ["Limitation", v]));
    if (req.query.format === "csv")
      return res
        .type("text/csv")
        .set(
          "Content-Disposition",
          'attachment; filename="configured-management-report.csv"',
        )
        .send(
          rows
            .map((row) =>
              row
                .map(
                  (v) =>
                    '"' +
                    String(v ?? "Unavailable")
                      .replace(/^[=+@\-\t\r]/, "'$&")
                      .replaceAll('"', '""') +
                    '"',
                )
                .join(","),
            )
            .join("\r\n"),
        );
    const trendMax = Math.max(1, ...r.trends.map((t) => t.unique || 0)),
      trendPoints = r.trends
        .map(
          (t, i) =>
            `${20 + (i * 560) / Math.max(1, r.trends.length - 1)},${150 - ((t.unique || 0) * 120) / trendMax}`,
        )
        .join(" "),
      charts =
        (r.sections.includes("trends") && r.trends.length
          ? '<h2>Unique senior participation trend</h2><svg viewBox="0 0 600 180" style="width:100%;max-height:260px" role="img" aria-label="Unique senior participation trend"><polyline fill="none" stroke="#0d9488" stroke-width="3" points="' +
            trendPoints +
            '"/></svg>'
          : "") +
        (r.sections.includes("programmes")
          ? "<h2>Programme unique senior reach</h2>" +
            r.programmes
              .map(
                (p) =>
                  "<p>" +
                  esc(p.name) +
                  " - " +
                  p.unique +
                  ' seniors</p><div style="height:8px;background:#0d9488;width:' +
                  Math.round(
                    (p.unique /
                      Math.max(1, ...r.programmes.map((p) => p.unique))) *
                      100,
                  ) +
                  '%"></div>',
              )
              .join("")
          : "");
    res
      .type("html")
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>' +
          esc(r.template) +
          "</title><style>body{font:15px system-ui;color:#17314b;padding:24px;max-width:1100px;margin:auto}table{border-collapse:collapse;width:100%}td{padding:8px;border-bottom:1px solid #ccd8e2;overflow-wrap:anywhere}tr{break-inside:avoid}@media print{button{display:none}}</style><h1>" +
          esc(r.template) +
          "</h1><p>" +
          esc(r.reporting.label) +
          " · Configuration version " +
          r.reporting.version +
          "</p>" +
          charts +
          "<table>" +
          rows
            .map(
              (row) =>
                "<tr>" +
                row.map((v) => "<td>" + esc(v) + "</td>").join("") +
                "</tr>",
            )
            .join("") +
          "</table></html>",
      );
  });
}
