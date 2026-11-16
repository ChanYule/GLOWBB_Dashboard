import { writeClientRegistry } from "./client-writes.js";
import { randomUUID } from "node:crypto";
import {clientOutreach} from './client-outreach.js';
import { outreachPriorities } from "./outreach-priorities.js";
import { dataQualityReport } from './data-quality.js';
import { ensureLocations, locationRow } from './location-store.js';
import { decodeLocations } from './location-model.js';
import {staffAnalysisState} from './staff-analysis.js';
import { hash, readMatrix, todaySG } from "./domain.js";
import { dataTransaction } from "./data-management.js";
import { ensureOperations } from "./operations-routes.js";
import { barriers, informationSources } from "./needs-domain.js";
import { transportCategories } from "./location-model.js";
import {
  CLIENT_SNAPSHOT,
  clientFields,
  parseClientRegistry,
  inspectClientRegistry,
  registryFingerprint,
  currentClientRows,
  clientReport,
  clientFollowupRows,
  contactOutcomes,
  validDay,
  missing,
} from "./client-domain.js";

const fail = (status, message) => Object.assign(Error(message), { status });
const privileged = (req) => {
  if (!["admin", "planner"].includes(req.user.role))
    throw fail(
      403,
      "Client engagement and follow-up are restricted to authorised staff.",
    );
};
const admin = (req) => {
  if (req.user.role !== "admin")
    throw fail(403, "Administrator access is required.");
};
const text = (v, max = 2000) => typeof v === "string" && v.length <= max;
function* readState(db, storage) {
  if (storage.readPlanningState) return yield storage.readPlanningState(db);
  return {
    data: yield storage.readData(db),
    settings: yield storage.getSettings(db),
    registry: yield db.prepare("SELECT * FROM member_registry").all(),
    profiles: yield db.prepare("SELECT * FROM participant_profiles").all(),
    feedback: yield db.prepare("SELECT * FROM participant_feedback").all(),
  };
}
const labels = {
  registered: "Registered clients",
  attending: "Clients with recorded attendance",
  noAttendance: "No recorded attendance in selected period",
  rate: "Observed client participation rate (%)",
  active: "Active clients",
  inactive: "Previously observed clients inactive under configured rules",
  otherAttenders:
    "Other attendance participants (outside current client registry)",
};
const csvCell = (v) =>
  '"' +
  String(v ?? "Unavailable")
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
const esc = (v) =>
  String(v ?? "Unavailable").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function* audit(db, user, action, details) {
  yield db
    .prepare(
      "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
    )
    .run(new Date().toISOString(), user, action, JSON.stringify(details));
}
function validateViews(views) {
  for (const v of views) {
    if (
      !text(v.name, 100) ||
      !Array.isArray(v.kpis) ||
      v.kpis.some(
        (k) =>
          ![
            ...Object.keys(labels),
            "maleRate",
            "minorityRate",
            "livingAloneNoAttendance",
          ].includes(k),
      ) ||
      !Array.isArray(v.charts) ||
      v.charts.some(
        (k) =>
          ![
            "gender",
            "age",
            "living",
            "race",
            "cfs",
            "risk",
            "block",
            "zone",
            "statuses",
            "barriers",
          ].includes(k),
      )
    )
      throw fail(400, "Check client view cards and charts.");
    clientReport(
      {
        data: {
          participants: [],
          programmes: [],
          sessions: [],
          attendance: [],
        },
        settings: {},
        registry: [],
        profiles: [],
        feedback: [],
      },
      v.filters || {},
    );
  }
}
export function mountClients(app, { db, storage, upload }) {
  app.use(["/api/clients", "/api/client-registry"], async (req, _res, next) => {
    privileged(req);
    await ensureOperations(db);
    next();
  });
  app.post("/api/client-registry/preview", upload, async (req, res) => {
    admin(req);
    if (!req.file)
      throw fail(400, "Choose the client registry Excel or CSV file.");
    const parsed = parseClientRegistry(
      await readMatrix(req.file.buffer, req.file.originalname, [
        ["Member ID", "Name/Member ID"],
      ]),
    );
    const sourceHash = hash(req.file.buffer.toString("base64")),
      id = randomUUID();
    const result = await dataTransaction(db, function* (tx) {
      const state = yield* readState(tx, storage),
        inspection = inspectClientRegistry(parsed, state);
      const payload = {
        kind: "client-registry",
        ...parsed,
        source: req.file.originalname,
        sourceHash,
        fingerprint: registryFingerprint(state),
      };
      yield tx
        .prepare("DELETE FROM import_previews WHERE expires < ?")
        .run(Date.now());
      yield tx
        .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
        .run(id, req.user.id, Date.now() + 1200000, JSON.stringify(payload));
      return {
        id,
        rows: parsed.rows.length,
        issues: parsed.issues,
        duplicates: parsed.duplicates,
        ...inspection,
        clients: parsed.rows.filter((p) => p.client === true).length,
        withinBoundary: parsed.rows.filter((p) => p.boundary === true).length,
        missingLiving: parsed.rows.filter((p) => missing(p.livingRaw)).length,
        note: "Member ID is matched exactly after trimming outer whitespace. Case, punctuation and leading zeros are preserved. Attendance and non-client participants are retained. Missing clients remain registered; absence from a new file never archives them.",
      };
    });
    res.json(result);
  });
  app.post("/api/client-registry/confirm", async (req, res) => {
    admin(req);
    const { id, asOf, complete, approvedFields = [] } = req.body || {};
    if (
      !text(id, 100) ||
      !validDay(asOf) ||
      asOf > todaySG() ||
      typeof complete !== "boolean" ||
      !Array.isArray(approvedFields) ||
      approvedFields.length > 500 ||
      approvedFields.some((k) => !text(k, 100))
    )
      throw fail(
        400,
        "Review the registry, snapshot date and approved updates. Select at most 500 conflicting fields per import.",
      );
    res.json(
      await dataTransaction(db, function* (tx) {
        const preview = yield tx
          .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
          .get(id, req.user.id);
        if (!preview || preview.expires < Date.now())
          throw fail(
            409,
            "Client registry preview expired. Preview the file again.",
          );
        const parsed = JSON.parse(preview.payload);
        if (parsed.kind !== "client-registry")
          throw fail(400, "Choose a client registry preview.");
        if (parsed.issues.length || parsed.duplicates)
          throw fail(
            400,
            "Resolve invalid and duplicate client rows before confirming.",
          );
        const state = yield* readState(tx, storage);
        if (registryFingerprint(state) !== parsed.fingerprint)
          throw fail(
            409,
            "Profiles or membership changed after this preview. Review a fresh preview.",
          );
        const inspection = inspectClientRegistry(parsed, state),
          allowed = new Set(
            inspection.conflicts
              .filter((c) => !c.protectedReview)
              .map((c) => c.key),
          );
        if (approvedFields.some((k) => !allowed.has(k)))
          throw fail(
            400,
            "Only the displayed source conflicts can be approved. Staff-reviewed corrections must be reviewed in the participant profile.",
          );
        const approved = new Set(approvedFields),
          current = new Map(
            currentClientRows(state.registry, state.settings).map((p) => [
              p.id,
              p,
            ]),
          );
        const participants = new Map(
          state.data.participants.map((p) => [p.id, p]),
        );
        const timestamp = new Date().toISOString();
        const batch = {
          created: [],
          updated: [],
          originals: [],
          current: [],
          observations: [],
        };
        let changed = 0,
          created = 0;
        for (const row of parsed.rows) {
          const { id: pid, memberId, row: sourceRow, ...incoming } = row;
          const previous = current.get(pid),
            existing = participants.get(pid),
            details = { ...(existing || {}), ...(previous || {}) };
          delete details.id;
          delete details.profile;
          const fieldSources = { ...(previous?.fieldSources || {}) };
          for (const [field, value] of Object.entries(incoming)) {
            if (missing(value)) continue;
            if (
              missing(details[field]) ||
              details[field] === value ||
              approved.has(hash([pid, field]))
            ) {
              details[field] = value;
              fieldSources[field] = {
                source: "Client registry",
                file: parsed.source,
                asOf,
                recorded: timestamp,
              };
            }
          }
          details.memberId = memberId;
          details.membershipStatus = previous?.membershipStatus || "Active";
          const comparable = (p) =>
            Object.fromEntries(
              [
                ...clientFields,
                "registrationDate",
                "preferredLanguage",
                "memberId",
                "membershipStatus",
              ].map((k) => [k, p?.[k] ?? null]),
            );
          const isChanged =
            JSON.stringify(comparable(previous)) !==
            JSON.stringify(comparable(details));
          if (isChanged) changed++;
          details.revision = (previous?.revision || 0) + (isChanged ? 1 : 0);
          details.fieldSources = fieldSources;
          details.asOf = asOf;
          details.source = parsed.source;
          details.importedAt = timestamp;
          details.lastSourceHash = parsed.sourceHash;
          // Keep source originals separate from the approved current profile.
          if (!existing) {
            const base = {
              ...incoming,
              profileSource: "Client registry",
              profileImportedAt: timestamp,
            };
            batch.created.push({ id: pid, details: JSON.stringify(base) });
            created++;
          } else {
            const base = { ...existing };
            delete base.id;
            for (const [field, value] of Object.entries(incoming))
              if (
                !missing(value) &&
                (missing(base[field]) || approved.has(hash([pid, field])))
              )
                base[field] = value;
            base.registryImportedAt = timestamp;
            batch.updated.push({ id: pid, details: JSON.stringify(base) });
          }
          batch.originals.push({
            participant_id: pid,
            snapshot: parsed.sourceHash,
            details: JSON.stringify({
              ...incoming,
              memberId,
              source: parsed.source,
              asOf,
              recorded: timestamp,
              sourceRow,
            }),
          });
          batch.current.push({
            participant_id: pid,
            snapshot: CLIENT_SNAPSHOT,
            details: JSON.stringify(details),
          });
          for (const [field, value] of Object.entries(incoming))
            if (!missing(value))
              batch.observations.push({
                id: hash([
                  "client-registry",
                  pid,
                  field,
                  String(value),
                  parsed.sourceHash,
                ]),
                participant_id: pid,
                field,
                raw: String(value),
                recorded: timestamp,
              });
        }
        yield* writeClientRegistry(tx, batch);
        const settings = {
          ...state.settings,
          registry: {
            type: "clients",
            snapshot: CLIENT_SNAPSHOT,
            sourceSnapshot: parsed.sourceHash,
            complete,
            historyComplete: false,
            asOf,
            source: parsed.source,
            importedAt: timestamp,
          },
        };
        yield tx
          .prepare("UPDATE settings SET value=? WHERE id=1")
          .run(JSON.stringify(settings));
        const result = {
          ok: true,
          rows: parsed.rows.length,
          created,
          matched: inspection.matched,
          changed,
          approved: approved.size,
          conflictsKept: inspection.conflicts.length - approved.size,
          omittedRetained: inspection.omitted,
          complete,
          asOf,
          source: parsed.source,
        };
        yield* audit(tx, req.user.id, "client.registry.imported", result);
        yield tx.prepare("DELETE FROM import_previews WHERE id=?").run(id);
        return result;
      }),
    );
  });
  app.post("/api/clients/report", async (req, res) =>
    res.json(
      await dataTransaction(
        db,
        function* (tx) {
          return clientReport(staffAnalysisState(yield* readState(tx, storage),req.user), req.body || {});
        },
        true,
      ),
    ),
  );
  app.post('/api/clients/outreach',async(req,res)=>{
    const result=await dataTransaction(db,function*(tx){const state=yield* readState(tx,storage);const value=clientOutreach(state,req.body||{});yield* audit(tx,req.user.id,'client.outreach.viewed',{cohort:value.cohort,count:value.people.total,page:value.people.page});return value;},false,['audit']);
    res.json(result);
  });
  app.post("/api/clients/priorities", async (req, res) => {
    privileged(req);
    const result = await dataTransaction(
      db,
      function* (tx) {
        const value = outreachPriorities(
          yield* readState(tx, storage),
          req.body || {},
        );
        yield* audit(tx, req.user.id, "client.priorities.viewed", {
          view: value.view,
          count: value.people.total,
          page: value.people.page,
        });
        return value;
      },
      false,
      ["audit"],
    );
    res.json(result);
  });
  app.post('/api/clients/data-quality',async(req,res)=>{
    privileged(req);
    await ensureLocations(db);
    const result=await dataTransaction(db,function*(tx){
      const state=yield* readState(tx,storage);
      state.locations=decodeLocations(yield locationRow(tx));
      const value=dataQualityReport(state,req.body||{},todaySG());
      yield* audit(tx,req.user.id,'client.data-quality.viewed',{field:value.missingField||'summary',count:value.missingField?value.total:value.summary.total,page:value.page});
      return value;
    },false,['audit']);
    res.json(result);
  });
  app.post("/api/clients/priorities/export", async (req) => {
    privileged(req);
    throw fail(
      403,
      "Identifiable outreach CSV exports are disabled by the current export policy. Aggregate centre summaries remain available.",
    );
  });
  app.post("/api/clients/followups", async (req, res) => {
    const {
      filters = {},
      search = "",
      sort = "memberId",
      direction = "asc",
      page = 1,
      pageSize = 25,
      membership = "Active",
    } = req.body || {};
    if (!["Active", "Archived", "All"].includes(membership))
      throw fail(400, "Choose a membership scope.");
    if (membership !== "Active") admin(req);
    if (
      !text(search, 200) ||
      ![
        "memberId",
        "age",
        "block",
        "last",
        "status",
        "assigned",
        "lastContact",
        "followUp",
      ].includes(sort) ||
      !["asc", "desc"].includes(direction) ||
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw fail(400, "Check follow-up search and pagination.");
    res.json(
      await dataTransaction(db, function* (tx) {
        const state = yield* readState(tx, storage),
          { rows, ctx } = clientFollowupRows(
            state,
            filters,
            todaySG(),
            membership,
          );
        const searched = rows.filter((p) =>
          [p.memberId, p.block, p.assigned].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(search.toLowerCase()),
          ),
        );
        searched.sort(
          (a, b) =>
            (typeof a[sort] === "number" && typeof b[sort] === "number"
              ? a[sort] - b[sort]
              : String(a[sort] ?? "").localeCompare(
                  String(b[sort] ?? ""),
                  "en",
                  { numeric: true },
                )) * (direction === "asc" ? 1 : -1),
        );
        yield* audit(tx, req.user.id, "client.followup.list.viewed", {
          filters: Object.keys(filters),
          matches: searched.length,
          page,
          pageSize,
        });
        return {
          rows: searched.slice((page - 1) * pageSize, page * pageSize),
          total: searched.length,
          page,
          pageSize,
          coverage: ctx.coverage,
          notice:
            ctx.historyNote +
            " Authorised follow-up workspace. Member IDs and residential details must not be copied into general reports. No message is sent by recording a contact.",
        };
      }),
    );
  });
  app.get("/api/clients/preferences", async (req, res) => {
    const row = await db
      .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
      .get(req.user.id);
    const settings = await storage.getSettings(db);
    res.json({
      ...(row ? JSON.parse(row.value).clients || {} : {}),
      sharedTemplates: settings.clientSharedTemplates || [],
    });
  });
  app.put("/api/clients/preferences", async (req, res) => {
    const value = req.body;
    if (
      !value ||
      !Array.isArray(value.views) ||
      value.views.length > 20 ||
      JSON.stringify(value).length > 30000
    )
      throw fail(400, "Save up to 20 client views within 30 KB.");
    validateViews([...value.views, ...(value.draft ? [value.draft] : [])]);
    await dataTransaction(db, function* (tx) {
      const previous = yield tx
        .prepare("SELECT value FROM staff_preferences WHERE user_id=?")
        .get(req.user.id);
      const next = {
        ...(previous
          ? JSON.parse(previous.value)
          : { views: [], active: "", template: "Overview" }),
        clients: {
          views: value.views,
          ...(value.draft ? { draft: value.draft } : {}),
        },
      };
      yield tx
        .prepare(
          "INSERT INTO staff_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
        )
        .run(req.user.id, JSON.stringify(next));
    });
    res.json({ ok: true });
  });
  app.put("/api/clients/templates", async (req, res) => {
    admin(req);
    const view = req.body?.view;
    validateViews([view]);
    await dataTransaction(db, function* (tx) {
      const settings = yield storage.getSettings(tx);
      const shared = { ...view, id: view.id || randomUUID() };
      const current = settings.clientSharedTemplates || [];
      const next = current.some((v) => v.id === shared.id)
        ? current.map((v) => (v.id === shared.id ? shared : v))
        : [...current, shared];
      if (next.length > 20)
        throw fail(400, "Keep up to 20 shared client templates.");
      yield tx
        .prepare("UPDATE settings SET value=? WHERE id=1")
        .run(JSON.stringify({ ...settings, clientSharedTemplates: next }));
      yield* audit(tx, req.user.id, "client.template.shared", {
        id: shared.id,
        name: shared.name,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/clients/imports", async (req, res) => {
    admin(req);
    const rows = await db
      .prepare(
        "SELECT created,user_id,details FROM audit WHERE action=? ORDER BY id DESC LIMIT 50",
      )
      .all("client.registry.imported");
    res.json(
      rows.map((r) => ({
        created: r.created,
        userId: r.user_id,
        ...JSON.parse(r.details),
      })),
    );
  });
  app.get("/api/clients/settings", async (req, res) => {
    admin(req);
    res.json(
      await dataTransaction(
        db,
        function* (tx) {
          const state = yield* readState(tx, storage);
          return {
            zones: state.settings.clientZones || {},
            documentation: state.settings.clientZoneDocumentation || "",
            bands: state.settings.inactivityBands,
            blocks: [
              ...new Set(
                currentClientRows(state.registry, state.settings)
                  .map((p) => p.blockRaw)
                  .filter(Boolean),
              ),
            ].sort(),
          };
        },
        true,
      ),
    );
  });
  app.put("/api/clients/settings", async (req, res) => {
    admin(req);
    const { zones, documentation, bands } = req.body || {};
    if (
      !zones ||
      Array.isArray(zones) ||
      Object.keys(zones).length > 200 ||
      Object.entries(zones).some(([k, v]) => !text(k, 100) || !text(v, 100)) ||
      !text(documentation, 2000) ||
      (Object.values(zones).some(Boolean) && !documentation.trim()) ||
      !Array.isArray(bands) ||
      bands.length !== 3 ||
      bands.some((n) => !Number.isInteger(n) || n < 1 || n > 3650) ||
      !(bands[0] < bands[1] && bands[1] < bands[2])
    )
      throw fail(
        400,
        "Use three increasing day thresholds and document any block-to-zone groupings.",
      );
    await dataTransaction(db, function* (tx) {
      const settings = yield storage.getSettings(tx);
      yield tx.prepare("UPDATE settings SET value=? WHERE id=1").run(
        JSON.stringify({
          ...settings,
          clientZones: zones,
          clientZoneDocumentation: documentation,
          inactivityBands: bands,
        }),
      );
      yield* audit(tx, req.user.id, "client.reporting.settings.updated", {
        zones,
        bands,
        documentation,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/clients/:id/source", async (req, res) => {
    res.json(
      await dataTransaction(db, function* (tx) {
        const state = yield* readState(tx, storage),
          row = currentClientRows(state.registry, state.settings).find(
            (p) => p.id === req.params.id,
          );
        if (!row) throw fail(404, "Client not found.");
        yield* audit(tx, req.user.id, "client.source.viewed", { id: row.id });
        return {
          current: row,
          profileRevision:
            state.profiles.find((p) => p.participant_id === row.id)?.revision ||
            0,
          contacts: state.feedback
            .filter((f) => f.participant_id === row.id)
            .map((f) => ({ id: f.id, date: f.date, ...JSON.parse(f.details) }))
            .filter((f) => f.contact)
            .sort((a, b) => b.date.localeCompare(a.date)),
        };
      }),
    );
  });
  app.post("/api/clients/:id/membership", async (req, res) => {
    admin(req);
    const { revision, status, reason, confirmation } = req.body || {};
    if (
      !Number.isInteger(revision) ||
      !["Active", "Archived"].includes(status) ||
      !text(reason) ||
      !reason.trim() ||
      confirmation !==
        (status === "Archived" ? "ARCHIVE CLIENT" : "RESTORE CLIENT")
    )
      throw fail(
        400,
        "Review the membership status, enter a reason and type the confirmation phrase.",
      );
    res.json(
      await dataTransaction(db, function* (tx) {
        const row = yield tx
          .prepare(
            "SELECT details FROM member_registry WHERE participant_id=? AND snapshot=?",
          )
          .get(req.params.id, CLIENT_SNAPSHOT);
        if (!row) throw fail(404, "Client not found.");
        const p = JSON.parse(row.details);
        if (p.revision !== revision)
          throw fail(
            409,
            "Membership changed. Reload the client before continuing.",
          );
        const next = {
          ...p,
          membershipStatus: status,
          revision: revision + 1,
          membershipReason: reason,
          membershipUpdated: new Date().toISOString(),
        };
        yield tx
          .prepare(
            "UPDATE member_registry SET details=? WHERE participant_id=? AND snapshot=?",
          )
          .run(JSON.stringify(next), req.params.id, CLIENT_SNAPSHOT);
        yield* audit(tx, req.user.id, "client.membership.changed", {
          id: req.params.id,
          before: p.membershipStatus,
          after: status,
          reason,
        });
        return { ok: true, revision: next.revision };
      }),
    );
  });
  app.post("/api/clients/:id/contact", async (req, res) => {
    const b = req.body || {},
      source = b.source || "Staff-observed",
      reportDate = b.date;
    if (
      !text(b.id, 100) ||
      !b.id ||
      !validDay(reportDate) ||
      reportDate > todaySG() ||
      !contactOutcomes.includes(b.outcome) ||
      !Number.isInteger(b.profileRevision) ||
      !text(b.assigned || "", 200) ||
      !text(b.notes || "", 2000) ||
      !informationSources.includes(source) ||
      (b.nextDate && !validDay(b.nextDate)) ||
      !Array.isArray(b.barriers) ||
      b.barriers.some((v) => !barriers.includes(v)) ||
      (b.barriers.includes("No reported transport barrier") &&
        b.barriers.some(
          (v) =>
            v !== "No reported transport barrier" &&
            [
              ...transportCategories,
              "Distance and transport",
              "Mobility limitations",
            ].includes(v),
        )) ||
      (b.barriers.length && b.permission !== true)
    )
      throw fail(
        400,
        "Check contact date, outcome, staff assignment and permission to record voluntary barrier information.",
      );
    const details = {
      method: "staff",
      source,
      date: reportDate,
      staff: req.user.username,
      contact: {
        outcome: b.outcome,
        assigned: b.assigned || "",
        notes: b.notes || "",
        nextDate: b.nextDate || null,
      },
      barriers: b.barriers.map((category) => ({
        category,
        status:
          source === "Unconfirmed"
            ? "Unknown"
            : category === "No reported transport barrier"
              ? "Not present"
              : "Reported",
        source,
        date: reportDate,
      })),
      consent: b.barriers.length ? true : null,
    };
    res.json(
      await dataTransaction(db, function* (tx) {
        const existing = yield tx
          .prepare(
            "SELECT participant_id,date,details FROM participant_feedback WHERE id=?",
          )
          .get(b.id);
        if (existing) {
          if (
            existing.participant_id === req.params.id &&
            existing.date === reportDate &&
            hash(JSON.parse(existing.details)) === hash(details)
          )
            return { ok: true, replayed: true };
          throw fail(
            409,
            "This contact reference was already used for different information.",
          );
        }
        const member = yield tx
          .prepare(
            "SELECT details FROM member_registry WHERE participant_id=? AND snapshot=?",
          )
          .get(req.params.id, CLIENT_SNAPSHOT);
        if (!member) throw fail(404, "Choose a registered client.");
        const p = yield tx
          .prepare("SELECT * FROM participant_profiles WHERE participant_id=?")
          .get(req.params.id);
        if ((p?.revision || 0) !== b.profileRevision)
          throw fail(
            409,
            "The participant profile changed. Reload before recording the contact.",
          );
        const previous = p ? JSON.parse(p.details) : {},
          next = {
            ...previous,
            followUp: {
              ...previous.followUp,
              required: [
                "Follow-up required",
                "Referral or support required",
                "Participant interested",
              ].includes(b.outcome),
              assigned: b.assigned || "",
              date: b.nextDate || reportDate,
              type: "Client outreach",
              status:
                b.outcome === "Contact attempted"
                  ? "In Progress"
                  : [
                        "Follow-up required",
                        "Referral or support required",
                        "Participant interested",
                      ].includes(b.outcome)
                    ? "Proposed"
                    : "Completed",
              outcome: b.outcome,
              nextAction: b.notes || "",
            },
          };
        const created = new Date().toISOString();
        yield tx
          .prepare("INSERT INTO participant_feedback VALUES(?,?,?,?,?,?)")
          .run(
            b.id,
            req.params.id,
            reportDate,
            JSON.stringify(details),
            created,
            req.user.id,
          );
        yield tx
          .prepare(
            "INSERT INTO participant_profiles VALUES(?,?,?,?,?) ON CONFLICT(participant_id) DO UPDATE SET revision=excluded.revision,details=excluded.details,updated=excluded.updated,user_id=excluded.user_id",
          )
          .run(
            req.params.id,
            b.profileRevision + 1,
            JSON.stringify(next),
            created,
            req.user.id,
          );
        yield tx
          .prepare("INSERT INTO profile_history VALUES(?,?,?,?,?,?,?)")
          .run(
            randomUUID(),
            req.params.id,
            JSON.stringify({ before: previous, after: next }),
            created,
            reportDate,
            "Staff-observed",
            req.user.id,
          );
        yield* audit(tx, req.user.id, "client.contact.recorded", {
          id: req.params.id,
          reference: b.id,
          outcome: b.outcome,
        });
        return { ok: true, revision: b.profileRevision + 1 };
      }),
    );
  });
  app.get("/api/clients/export/:format", async (req, res) => {
    if (Object.keys(req.query).some((k) => !["from", "to", "asOf"].includes(k)))
      throw fail(
        403,
        "Client exports contain unsegmented aggregate summaries only. Identifiable and sensitive filtered exports are restricted.",
      );
    const r = await dataTransaction(
      db,
      function* (tx) {
        return clientReport(staffAnalysisState(yield* readState(tx, storage),req.user), req.query);
      },
      true,
    );
    const rows = [
      ["Client engagement summary"],
      ["Population", r.populationNote],
      ["Reporting period", r.period.from, r.period.to],
      ["Attendance coverage", r.coverage.from, r.coverage.to],
      ...Object.entries(labels).map(([k, label]) => [
        label,
        r.summary[k] ?? "Withheld",
      ]),
      ...r.limitations.map((note) => ["Limitation", note]),
    ];
    if (req.params.format === "csv")
      res
        .type("text/csv")
        .attachment("client-engagement-summary.csv")
        .send(
          "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        );
    else if (req.params.format === "report")
      res.type("html").send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Programme &amp; Outreach / Client Engagement</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px;color:#202c48}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}table{width:100%;border-collapse:collapse}@media print{button{display:none}}</style><h1>Client engagement and outreach</h1><p>${esc(r.populationNote)}</p><p>${esc(r.period.from)} to ${esc(r.period.to)}. Attendance coverage: ${esc(r.coverage.from)} to ${esc(r.coverage.to)}.</p><h2>Who are they?</h2><table>${Object.entries(
          labels,
        )
          .map(
            ([k, label]) =>
              `<tr><th>${esc(label)}</th><td>${esc(r.summary[k] ?? "Withheld")}</td></tr>`,
          )
          .join(
            "",
          )}</table><h2>What are we missing?</h2><p>No recorded attendance is an observation within the supplied history. It is not a confirmed reason for non-participation.</p><h2>What should we do?</h2><p>Review contact records and collect voluntary feedback before choosing programme adjustments or outreach.</p>${r.limitations.map((note) => `<p>${esc(note)}</p>`).join("")}<p>Member IDs, residential blocks, clinical/social breakdowns and private notes are excluded.</p></html>`,
      );
    else throw fail(404, "Report format not found.");
    await storage.audit(db, req.user.id, "client.summary.exported", {
      format: req.params.format,
    });
  });
}
