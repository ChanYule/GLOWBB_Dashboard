import {validDomainMapping} from '../shared/activity-domains.js';
import {saveLegacyDefinitionVersion} from './configuration.js';
import { randomUUID } from "node:crypto";
import { clientReport } from "./client-domain.js";
import {staffAnalysisState} from './staff-analysis.js';
import { hash, readMatrix, todaySG } from "./domain.js";
import {
  needsAnalysis,
  participantHistory,
  materializeProfiles,
  interests,
  needs,
  barriers,
  informationSources,
  needStates,
  actionStates,
  validDate,
} from "./needs-domain.js";
const fail = (status, message) => Object.assign(Error(message), { status });
const privileged = (req) => {
  if (req.user.role === "viewer")
    throw fail(403, "Authorised planners and administrators only.");
};
const admin = (req) => {
  if (req.user.role !== "admin")
    throw fail(403, "Administrator access is required.");
};
const text = (value, max = 2000) =>
  typeof value === "string" && value.length <= max;
const list = (value, allowed, max = 30) =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((v) => text(v, 150) && (!allowed || allowed.includes(v)));
const optionalDate = (value) =>
  value == null || value === "" || validDate(value);
const optionalString = (value) => value == null || text(value);
export function validateProfile(d) {
  if (
    !d ||
    typeof d !== "object" ||
    Array.isArray(d) ||
    JSON.stringify(d).length > 32000 ||
    Object.keys(d).some(
      (k) =>
        ![
          "basic",
          "health",
          "social",
          "needs",
          "preferences",
          "barriers",
          "followUp",
        ].includes(k),
    )
  )
    throw fail(400, "Check the participant profile fields.");
  for (const key of ["basic", "health", "social", "preferences", "followUp"])
    if (
      d[key] &&
      (!d[key] || typeof d[key] !== "object" || Array.isArray(d[key]))
    )
      throw fail(400, "Check the profile section.");
  const b = d.basic || {};
  if (
    Object.keys(b).some(
      (k) =>
        ![
          "age",
          "gender",
          "race",
          "preferredLanguage",
          "registrationDate",
          "livingRaw",
          "blockRaw",
          "client",
          "boundary",
          "employmentStatus","employmentSource","employmentRecordedOn",
        ].includes(k),
    ) ||
    ("age" in b &&
      b.age !== null &&
      (!Number.isInteger(b.age) || b.age < 0 || b.age > 120)) ||
    (b.gender && !["MALE", "FEMALE", "UNKNOWN"].includes(b.gender)) ||
    !optionalDate(b.registrationDate) ||
    ["client", "boundary"].some(
      (k) => k in b && ![true, false, null].includes(b[k]),
    ) ||
    ["race", "preferredLanguage", "livingRaw", "blockRaw"].some(
      (k) => k in b && !optionalString(b[k]),
    )
  )
    throw fail(400, "Check basic profile values and dates.");
  if(b.employmentStatus&&!['Working','Not working','Retired','Unknown','Prefers not to say'].includes(b.employmentStatus))throw fail(400,'Choose a recorded employment status.');
  if(!optionalDate(b.employmentRecordedOn)||(b.employmentRecordedOn&&b.employmentRecordedOn>todaySG())||(b.employmentSource&&!optionalString(b.employmentSource)))throw fail(400,'Check employment source and recorded date.');
  if(['Working','Not working','Retired'].includes(b.employmentStatus)&&(!b.employmentSource?.trim()||!b.employmentRecordedOn))throw fail(400,'Record the employment information source and date; do not infer working status from age.');
  const h = d.health || {};
  if (
    Object.keys(h).some(
      (k) =>
        ![
          "cfsAssessedOn",
          "functionalCategory",
          "mobility",
          "accessibility",
          "considerations",
          "supportInformation",
        ].includes(k),
    ) ||
    !optionalDate(h.cfsAssessedOn) ||
    Object.values(h).some((v) => !optionalString(v))
  )
    throw fail(400, "Check health profile values; dates must be YYYY-MM-DD.");
  const s = d.social || {};
  if (
    Object.keys(s).some(
      (k) =>
        ![
          "regularContact",
          "practicalSupport",
          "joiningDifficulty",
          "interestSocial",
          "circumstances",
        ].includes(k),
    ) ||
    Object.entries(s).some(([k, v]) =>
      k === "circumstances"
        ? !optionalString(v)
        : !["Yes", "No", "Unknown", "Not assessed", ""].includes(v),
    )
  )
    throw fail(400, "Check voluntary social information.");
  for (const field of ["needs", "barriers"])
    if (
      d[field] &&
      (!Array.isArray(d[field]) ||
        d[field].length > 30 ||
        d[field].some(
          (n) =>
            !n ||
            Object.keys(n).some(
              (k) =>
                ![
                  "category",
                  "status",
                  "source",
                  "date",
                  "details",
                  "relatedDomain",
                  "actionTaken",
                  "outcome",
                ].includes(k),
            ) ||
            !(field === "needs" ? needs : barriers).includes(n.category) ||
            !needStates.includes(n.status) ||
            (n.category === "No reported transport barrier" &&
              !["Not present", "Not assessed", "Unknown"].includes(n.status)) ||
            !informationSources.includes(n.source) ||
            !optionalDate(n.date) ||
            (n.date && n.date > todaySG()) ||
            ["details", "relatedDomain", "actionTaken", "outcome"].some(
              (k) => k in n && !optionalString(n[k]),
            ),
        ))
    )
      throw fail(
        400,
        "Each need or barrier requires a valid category, state, source and assessment/report date.",
      );
  const p = d.preferences || {};
  for (const [key, value] of Object.entries(p)) {
    if (
      [
        "interests",
        "days",
        "times",
        "languages",
        "programmeTypes",
        "wantsToTry",
        "noLongerInterested",
      ].includes(key)
    ) {
      if (
        !list(
          value,
          key === "interests"
            ? interests
            : key === "days"
              ? [
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ]
              : key === "times"
                ? ["Morning", "Afternoon", "Evening"]
                : null,
        )
      )
        throw fail(400, "Check preference selections.");
    } else if (key === "responded") {
      if (typeof value !== "boolean") throw fail(400, "Check response status.");
    } else if (
      !["format", "reasons", "requests"].includes(key) ||
      !optionalString(value)
    )
      throw fail(400, "Check preference fields.");
  }
  const f = d.followUp || {};
  if (
    Object.keys(f).some(
      (k) =>
        ![
          "required",
          "assigned",
          "type",
          "date",
          "status",
          "outcome",
          "nextAction",
        ].includes(k),
    ) ||
    (f.required !== undefined && typeof f.required !== "boolean") ||
    !optionalDate(f.date) ||
    (f.status && !actionStates.includes(f.status)) ||
    ["assigned", "type", "outcome", "nextAction"].some(
      (k) => k in f && !optionalString(f[k]),
    )
  )
    throw fail(400, "Check follow-up details.");
  return d;
}
export async function writeTransaction(db, work) {
  if (db.transaction) return db.transaction(work);
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await work(db);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function mountNeeds(app, { db, storage, filters, previews, upload,aggregateCache }) {
  const readState = async (connection = db) => {
    if (storage.readPlanningState) return storage.readPlanningState(connection);
    if (connection.transaction)
      return connection.transaction((tx) => readState(tx), { readOnly: true });
    return {
      data: await storage.readData(connection),
      profiles: await connection
        .prepare("SELECT * FROM participant_profiles")
        .all(),
      feedback: await connection
        .prepare("SELECT * FROM participant_feedback ORDER BY date,created")
        .all(),
      registry: await connection.prepare("SELECT * FROM member_registry").all(),
      settings: await storage.getSettings(connection),
    };
  };
  const report = async (req) => {
    const f = filters(req);
    if (
      [
        "living",
        "marital",
        "needs",
        "interests",
        "barriers",
        "risk",
        "cfs",
      ].some((k) => f[k])
    )
      throw fail(
        403,
        "Sensitive segments are available only in fixed protected aggregate views.",
      );
    const s = staffAnalysisState(await readState(),req.user);
    const result = needsAnalysis(
      s.data,
      s.profiles,
      s.feedback,
      s.registry,
      s.settings,
      f,
    );
    if (
      s.settings.registry?.type === "clients" &&
      ![
        "programme",
        "domain",
        "gender",
        "race",
        "ageBand",
        "client",
        "boundary",
        "observed",
      ].some((k) => f[k]) &&
      (!f.target || f.target === "all")
    ) {
      const clients = clientReport(s, {
        from: f.from || "",
        to: f.to || "",
        asOf: todaySG(),
      });
      result.findings.push(
        ...clients.findings.map((f) => ({
          id: f.id,
          category: "Targeted Outreach",
          title: f.title,
          finding: f.finding,
          explanation: f.why + " Investigate: " + f.investigate,
          action: f.action,
          target: f.target,
          evidence: f.evidence,
          priority: f.priority,
          next: f.next,
        })),
      );
    }
    return result;
  };
  app.get("/api/needs/catalogue", (_req, res) =>
    res.json({
      interests,
      needs,
      barriers,
      informationSources,
      needStates,
      actionStates,
    }),
  );
  app.get("/api/needs/overview", async (req, res) => {
    privileged(req);
    res.json(await (aggregateCache?aggregateCache.run(req,'needs-overview',()=>report(req)):report(req)));
  });
  app.post("/api/participants/lookup", async (req, res) => {
    privileged(req);
    const memberId = req.body?.memberId;
    if (!text(memberId, 200) || !memberId.trim())
      throw fail(400, "Enter the exact Member ID.");
    const participant = await db
      .prepare("SELECT id FROM participants WHERE id=?")
      .get(hash([memberId.trim()]));
    if (!participant)
      throw fail(
        404,
        "No profile matches this Member ID. Import attendance or a verified member registry, or create a reviewed participant profile.",
      );
    res.json({ id: participant.id });
  });
  app.post("/api/participants", async (req, res) => {
    privileged(req);
    const { memberId, basic = {} } = req.body || {};
    if (!text(memberId, 200) || !memberId.trim())
      throw fail(400, "Enter a Member ID.");
    validateProfile({ basic });
    const id = hash([memberId.trim()]);
    const result = await db
      .prepare("INSERT OR IGNORE INTO participants VALUES(?,?)")
      .run(
        id,
        JSON.stringify({
          age: basic.age ?? null,
          gender: basic.gender || "UNKNOWN",
          race: basic.race || "MISSING",
          cfs: null,
          client: basic.client ?? null,
          boundary: basic.boundary ?? null,
          preferredLanguage: basic.preferredLanguage || null,
          registrationDate: basic.registrationDate || null,
          profileSource: "Reviewed staff entry",
        }),
      );
    if (!result.changes)
      throw fail(
        409,
        "This participant already exists; look up the existing profile.",
      );
    await storage.audit(db, req.user.id, "participant.created", { id });
    res.json({ id });
  });
  app.get("/api/participants/:id", async (req, res) => {
    privileged(req);
    const state = storage.readParticipantState?await storage.readParticipantState(db,req.params.id):await readState(),
      base = state.data.participants.find((p) => p.id === req.params.id);
    if (!base) throw fail(404, "Participant not found.");
    const profile = state.profiles.find((p) => p.participant_id === base.id);
    const latestRevision = await db
      .prepare(
        "SELECT source,effective_date,created FROM profile_history WHERE participant_id=? ORDER BY created DESC LIMIT 1",
      )
      .get(base.id);
    const effective = materializeProfiles(state.data, state.profiles);
    await storage.audit(db, req.user.id, "participant.viewed", { id: base.id });
    res.json({
      base,
      current: effective.participants.find((p) => p.id === base.id),
      revision: profile?.revision || 0,
      provenance: latestRevision
        ? {
            source: latestRevision.source,
            effectiveDate: latestRevision.effective_date,
            recorded: latestRevision.created,
          }
        : null,
      details: profile ? JSON.parse(profile.details) : {},
      updated: profile?.updated || null,
      history: participantHistory(
        effective,
        base.id,
        todaySG(),
        state.settings.inactivityBands,
      ),
      feedback: state.feedback
        .filter((f) => f.participant_id === base.id)
        .map((f) => ({ id: f.id, date: f.date, ...JSON.parse(f.details) })),
      notice:
        "Latest-known imported and reviewed profile. Raw imported fields are retained. Attendance dates are not assessment dates. Presence in attendance is not proof of membership.",
    });
  });
  app.put("/api/participants/:id/profile", async (req, res) => {
    privileged(req);
    const { revision, details, source, effectiveDate } = req.body || {};
    if (
      !Number.isInteger(revision) ||
      revision < 0 ||
      !text(source, 200) ||
      !source.trim() ||
      !optionalDate(effectiveDate) ||
      (effectiveDate && effectiveDate > todaySG())
    )
      throw fail(
        400,
        "Include the profile revision, information source and a valid effective date if known.",
      );
    validateProfile(details);
    const updated = new Date().toISOString();
    await writeTransaction(db, async (tx) => {
      if (
        !(await tx
          .prepare("SELECT id FROM participants WHERE id=?")
          .get(req.params.id))
      )
        throw fail(404, "Participant not found.");
      await tx
        .prepare("INSERT OR IGNORE INTO participant_profiles VALUES(?,?,?,?,?)")
        .run(req.params.id, 0, "{}", updated, req.user.id);
      const old = await tx
        .prepare("SELECT * FROM participant_profiles WHERE participant_id=?")
        .get(req.params.id);
      if (old.revision !== revision)
        throw fail(
          409,
          "The profile changed since you opened it. Reload and review before saving.",
        );
      const result = await tx
        .prepare(
          "UPDATE participant_profiles SET details=?,revision=?,updated=?,user_id=? WHERE participant_id=? AND revision=?",
        )
        .run(
          JSON.stringify(details),
          revision + 1,
          updated,
          req.user.id,
          req.params.id,
          revision,
        );
      if (!result.changes)
        throw fail(409, "The profile changed; reload and review.");
      await tx
        .prepare("INSERT INTO profile_history VALUES(?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          req.params.id,
          JSON.stringify({ before: JSON.parse(old.details), after: details }),
          updated,
          effectiveDate || null,
          source,
          req.user.id,
        );
      await storage.audit(tx, req.user.id, "participant.profile.updated", {
        id: req.params.id,
        revision: revision + 1,
        sections: Object.keys(details),
      });
    });
    res.json({ revision: revision + 1, updated });
  });
  app.post("/api/participants/:id/feedback", async (req, res) => {
    privileged(req);
    const f = req.body;
    if (
      !f ||
      f.consent !== true ||
      !validDate(f.date) ||
      f.date > todaySG() ||
      !informationSources.includes(f.source) ||
      !["survey", "staff"].includes(f.method) ||
      !text(f.comments || "") ||
      !text(f.suggestedImprovement || "")
    )
      throw fail(
        400,
        "Confirm voluntary consent, date, method and information source.",
      );
    validateProfile({
      preferences: f.preferences || {},
      barriers: f.barriers || [],
    });
    if (
      !(await db
        .prepare("SELECT id FROM participants WHERE id=?")
        .get(req.params.id))
    )
      throw fail(404, "Participant not found.");
    const id = f.id || randomUUID();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw fail(400, "Invalid feedback reference.");
    const clean = {
      consent: true,
      date: f.date,
      source: f.source,
      method: f.method,
      preferences: f.preferences || {},
      barriers: f.barriers || [],
      comments: f.comments || "",
      suggestedImprovement: f.suggestedImprovement || "",
      followUpNeeded: !!f.followUpNeeded,
    };
    await writeTransaction(db, async (tx) => {
      const old = await tx
        .prepare(
          "SELECT participant_id,details FROM participant_feedback WHERE id=?",
        )
        .get(id);
      if (
        old &&
        (old.participant_id !== req.params.id ||
          old.details !== JSON.stringify(clean))
      )
        throw fail(
          409,
          "Feedback reference already exists with different details.",
        );
      await tx
        .prepare(
          "INSERT OR IGNORE INTO participant_feedback VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          req.params.id,
          f.date,
          JSON.stringify(clean),
          new Date().toISOString(),
          req.user.id,
        );
      const persisted = await tx
        .prepare(
          "SELECT participant_id,details FROM participant_feedback WHERE id=?",
        )
        .get(id);
      if (
        persisted.participant_id !== req.params.id ||
        persisted.details !== JSON.stringify(clean)
      )
        throw fail(
          409,
          "Feedback reference was concurrently saved with different details.",
        );
      await storage.audit(tx, req.user.id, "participant.feedback.recorded", {
        id: req.params.id,
        feedback: id,
      });
    });
    res.json({ id });
  });
  app.get("/api/needs/actions", async (req, res) => {
    privileged(req);
    res.json(
      (
        await db
          .prepare("SELECT * FROM needs_actions ORDER BY updated DESC")
          .all()
      ).map((r) => ({
        id: r.id,
        kind: r.kind,
        revision: r.revision,
        ...JSON.parse(r.details),
        updated: r.updated,
      })),
    );
  });
  app.put("/api/needs/actions/:id", async (req, res) => {
    privileged(req);
    const a = req.body;
    if (
      !/^[a-zA-Z0-9-]{1,80}$/.test(req.params.id) ||
      !a ||
      !Number.isInteger(a.revision) ||
      a.revision < 0 ||
      !["action", "outreach"].includes(a.kind) ||
      !text(a.title, 200) ||
      !a.title.trim() ||
      !actionStates.includes(a.status) ||
      !["Low", "Medium", "High"].includes(a.priority) ||
      !optionalDate(a.start) ||
      !optionalDate(a.due) ||
      (a.start && a.due && a.start > a.due) ||
      JSON.stringify(a).length > 15000
    )
      throw fail(
        400,
        "Check action title, status, priority, dates and revision.",
      );
    const allowed = [
      "title",
      "finding",
      "targetGroup",
      "plannedChange",
      "owner",
      "due",
      "start",
      "priority",
      "status",
      "notes",
      "outcome",
      "objective",
      "reportedNeeds",
      "channel",
      "approach",
      "contacted",
      "responded",
      "interested",
      "registered",
      "attended",
      "repeat",
      "evidenceSource",
      "evaluationBefore",
      "evaluationAfter",
      "evaluationLimitations",
    ];
    if (
      Object.keys(a).some(
        (k) => !["revision", "kind", "updated", ...allowed].includes(k),
      )
    )
      throw fail(400, "Unknown action field.");
    for (const key of allowed)
      if (
        key in a &&
        ![
          "contacted",
          "responded",
          "interested",
          "registered",
          "attended",
          "repeat",
        ].includes(key) &&
        !text(a[key], key === "title" ? 200 : 2000)
      )
        throw fail(400, "Check action text fields.");
    const counts = [
      "contacted",
      "responded",
      "interested",
      "registered",
      "attended",
      "repeat",
    ];
    for (const k of counts)
      if (
        a[k] != null &&
        (!Number.isInteger(a[k]) || a[k] < 0 || a[k] > 1000000)
      )
        throw fail(
          400,
          "Outreach counts must be nonnegative whole numbers or blank.",
        );
    if (
      (a.responded != null &&
        a.contacted != null &&
        a.responded > a.contacted) ||
      (a.interested != null &&
        a.responded != null &&
        a.interested > a.responded) ||
      (a.registered != null &&
        a.interested != null &&
        a.registered > a.interested) ||
      (a.attended != null &&
        a.registered != null &&
        a.attended > a.registered) ||
      (a.repeat != null && a.attended != null && a.repeat > a.attended)
    )
      throw fail(
        400,
        "The outreach funnel must use the same tracked cohort; check counts at each stage.",
      );
    if (counts.some((k) => a[k] != null) && !a.evidenceSource?.trim())
      throw fail(
        400,
        "Document the source of outreach outcome counts. Blank means not collected, not zero.",
      );
    const clean = Object.fromEntries(
      allowed.filter((k) => k in a).map((k) => [k, a[k]]),
    );
    const now = new Date().toISOString();
    await writeTransaction(db, async (tx) => {
      const old = await tx
        .prepare("SELECT revision,kind FROM needs_actions WHERE id=?")
        .get(req.params.id);
      if ((old?.revision || 0) !== a.revision || (old && old.kind !== a.kind))
        throw fail(
          409,
          "The action was updated by another staff member; reload.",
        );
      if (!old) {
        const inserted = await tx
          .prepare("INSERT OR IGNORE INTO needs_actions VALUES(?,?,?,?,?,?,?)")
          .run(
            req.params.id,
            a.kind,
            1,
            JSON.stringify(clean),
            now,
            now,
            req.user.id,
          );
        if (!inserted.changes)
          throw fail(
            409,
            "This action was concurrently created; reload and review.",
          );
      } else {
        const result = await tx
          .prepare(
            "UPDATE needs_actions SET details=?,revision=?,updated=?,user_id=? WHERE id=? AND revision=?",
          )
          .run(
            JSON.stringify(clean),
            a.revision + 1,
            now,
            req.user.id,
            req.params.id,
            a.revision,
          );
        if (!result.changes) throw fail(409, "The action changed; reload.");
      }
      await storage.audit(tx, req.user.id, "needs.action.updated", {
        id: req.params.id,
        kind: a.kind,
        status: a.status,
      });
    });
    res.json({ id: req.params.id, revision: a.revision + 1 });
  });
  app.put("/api/programmes/:id/profile", async (req, res) => {
    privileged(req);
    const p = req.body;
    if (
      !p ||
      !text(p.outcomes || "") ||
      !list(p.interestCategories || [], interests) ||
      !list(p.intendedNeeds || [], needs) ||
      ![
        "Not confirmed",
        "Current offering",
        "Planned offering",
        "Past offering",
      ].includes(p.offeringStatus) ||
      typeof p.accessibility !== "object" ||
      !p.accessibility ||
      Array.isArray(p.accessibility) ||
      Object.keys(p.accessibility).some(
        (k) =>
          ![
            "physicalLevel",
            "mobilityRequirements",
            "seatedOption",
            "languages",
            "venueAccessibility",
            "transport",
            "groupSize",
            "equipment",
            "support",
          ].includes(k),
      ) ||
      Object.values(p.accessibility).some((v) => !text(v, 1000)) ||
      JSON.stringify(p).length > 10000
    )
      throw fail(
        400,
        "Check programme outcomes, reviewed tags and accessibility information.",
      );
    if (
      (p.confirmedDemand !== undefined &&
        typeof p.confirmedDemand !== "boolean") ||
      (p.confirmedDemand === true &&
        (!text(p.demandSource, 1000) ||
          !p.demandSource.trim() ||
          !validDate(p.demandDate) ||
          p.demandDate > todaySG()))
    )
      throw fail(
        400,
        "Confirmed demand needs a documented source and valid review date.",
      );
    const old = await db
      .prepare("SELECT optional FROM programmes WHERE id=?")
      .get(req.params.id);
    if (!old) throw fail(404, "Programme not found.");
    if (p.revision !== hash(old.optional))
      throw fail(409, "Programme details changed; reload and review.");
    const clean = {
      ...JSON.parse(old.optional),
      outcomes: p.outcomes || "",
      interestCategories: p.interestCategories || [],
      intendedNeeds: p.intendedNeeds || [],
      offeringStatus: p.offeringStatus,
      accessibility: p.accessibility,
      confirmedDemand: p.confirmedDemand === true,
      demandSource: p.confirmedDemand === true ? p.demandSource : "",
      demandDate: p.confirmedDemand === true ? p.demandDate : "",
      reviewedAt: new Date().toISOString(),
    };
    const result = await db
      .prepare("UPDATE programmes SET optional=? WHERE id=? AND optional=?")
      .run(JSON.stringify(clean), req.params.id, old.optional);
    if (!result.changes) throw fail(409, "Programme details changed; reload.");
    await storage.audit(db, req.user.id, "programme.accessibility.updated", {
      id: req.params.id,
    });
    res.json({ ok: true });
  });
  app.post("/api/programme-offerings", async (req, res) => {
    privileged(req);
    const { name, domain } = req.body || {};
    if (
      !text(name, 500) ||
      !name.trim() ||
      !text(domain, 100) ||
      !domain.trim()
    )
      throw fail(400, "Enter a verified programme name and domain.");
    const id = hash([name.trim()]);
    const result = await db
      .prepare(
        "INSERT OR IGNORE INTO programmes(id,name,domain,optional) VALUES(?,?,?,?)",
      )
      .run(
        id,
        name.trim(),
        domain.trim(),
        JSON.stringify({
          offeringStatus: "Planned offering",
          source: "Staff-entered catalogue",
        }),
      );
    if (!result.changes)
      throw fail(
        409,
        "That exact programme already exists; update its profile.",
      );
    await storage.audit(db, req.user.id, "programme.offering.created", { id });
    res.json({ id });
  });
  app.get("/api/needs/programmes", async (req, res) => {
    privileged(req);
    res.json(
      (
        await db.prepare("SELECT id,name,domain,optional FROM programmes").all()
      ).map((p) => ({
        ...p,
        optional: JSON.parse(p.optional),
        revision: hash(p.optional),
      })),
    );
  });
  app.get("/api/needs/settings", async (req, res) => {
    admin(req);
    if(db.dialect==='postgres'){
      const {rows:[raw]}=await db.query(`SELECT (SELECT COALESCE(json_agg(v ORDER BY v),'[]') FROM (SELECT DISTINCT details::jsonb->>'cfs' v FROM glowbb.participants WHERE COALESCE(details::jsonb->>'cfs','')<>'') a) cfs,(SELECT COALESCE(json_agg(v ORDER BY v),'[]') FROM (SELECT DISTINCT details::jsonb->>'livingRaw' v FROM glowbb.participants WHERE COALESCE(details::jsonb->>'livingRaw','')<>'') b) living,(SELECT COALESCE(json_agg(v ORDER BY v),'[]') FROM (SELECT DISTINCT domain v FROM glowbb.programmes) c) domains`);
      return res.json({settings:await storage.getSettings(db),raw});
    }
    const data = await storage.readData(db);
    res.json({
      settings: await storage.getSettings(db),
      raw: {
        cfs: [
          ...new Set(data.participants.map((p) => p.cfs).filter(Boolean)),
        ].sort(),
        living: [
          ...new Set(data.participants.map((p) => p.livingRaw).filter(Boolean)),
        ].sort(),
        domains: [...new Set(data.programmes.map((p) => p.domain))].sort(),
      },
    });
  });
  app.put("/api/needs/settings", async (req, res) => {
    admin(req);
    const s = req.body;
    if(s?.domainGroups&&Object.values(s.domainGroups).some(v=>!validDomainMapping(v)))throw fail(400,"Map exact source labels only to Physical, Cognitive, Learning, Social or Volunteerism.");
    if (
      !s ||
      !Array.isArray(s.inactivityBands) ||
      s.inactivityBands.length !== 3 ||
      s.inactivityBands.some(
        (v, i) =>
          !Number.isInteger(v) ||
          v < 1 ||
          v > 3650 ||
          (i > 0 && v <= s.inactivityBands[i - 1]),
      )
    )
      throw fail(400, "Use three increasing inactivity thresholds in days.");
    for (const key of ["cfsMappings", "livingGroups", "domainGroups"]) {
      if (
        !s[key] ||
        typeof s[key] !== "object" ||
        Array.isArray(s[key]) ||
        Object.keys(s[key]).length > 200
      )
        throw fail(400, "Check organisation mappings.");
      for (const [raw, value] of Object.entries(s[key]))
        if (
          !raw.trim() ||
          raw.length > 200 ||
          (key === "cfsMappings"
            ? !value ||
              !text(value.label, 150) ||
              !value.label.trim() ||
              !text(value.meaning) ||
              !value.meaning.trim()
            : !text(value, 150) || !value.trim())
        )
          throw fail(
            400,
            "Each mapping needs a label; CFS mappings also need an approved source meaning.",
          );
    }
    if (
      s.planningPriorities &&
      (typeof s.planningPriorities !== "object" ||
        ["quality", "barrier", "interest"].some(
          (k) => !["Low", "Medium", "High"].includes(s.planningPriorities[k]),
        ))
    )
      throw fail(
        400,
        "Choose Low, Medium or High priorities for each documented finding type.",
      );
    const settings = {
      ...(await storage.getSettings(db)),
      ...(s.planningPriorities
        ? { planningPriorities: s.planningPriorities }
        : {}),
      inactivityBands: s.inactivityBands,
      cfsMappings: s.cfsMappings,
      livingGroups: s.livingGroups,
      domainGroups: s.domainGroups,
    };
    await saveLegacyDefinitionVersion(db,req.user,settings,'Approved through the existing needs definitions editor.');
    await storage.audit(db, req.user.id, "needs.definitions.updated", {
      fields: [
        "inactivityBands",
        "cfsMappings",
        "livingGroups",
        "domainGroups",
      ],
    });
    res.json({ ok: true });
  });
  app.post("/api/registry/preview", upload, async (req, res) => {
    admin(req);
    if (!req.file) throw fail(400, "Choose a member registry.");
    const matrix = await readMatrix(req.file.buffer, req.file.originalname, [
      "Name/Member ID",
    ]);
    const headers = matrix[0].map((v) => String(v ?? "").trim());
    if (new Set(headers).size !== headers.length)
      throw fail(400, "Registry headers must be unique.");
    const rows = [],
      issues = [],
      seen = new Set();
    let duplicates = 0;
    for (let i = 1; i < matrix.length; i++) {
      const values = Object.fromEntries(
        headers.map((h, j) => [h, String(matrix[i][j] ?? "").trim()]),
      );
      if (Object.values(values).every((v) => !v)) continue;
      const memberId = values["Name/Member ID"];
      if (!memberId || memberId.length > 200) {
        issues.push({ row: i + 1, message: "A valid Member ID is required." });
        continue;
      }
      const id = hash([memberId]);
      if (seen.has(id)) {
        duplicates++;
        continue;
      }
      seen.add(id);
      const age = values["Name/Age"] ? Number(values["Name/Age"]) : null,
        registrationDate =
          values["Registration Date"] ||
          values["Name/Registration Date"] ||
          null;
      if (
        (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) ||
        !optionalDate(registrationDate)
      ) {
        issues.push({
          row: i + 1,
          message: "Check age and registration date.",
        });
        continue;
      }
      rows.push({
        id,
        age,
        gender: values.Gender?.toUpperCase() || "UNKNOWN",
        race: values["Name/Race"]?.toUpperCase() || "MISSING",
        registrationDate,
        cfs: values["Name/CFS"] || null,
        riskRaw: values["Name/Social Risk Factor(s)"] || null,
        livingRaw: values["Name/Current Living Arrangement"] || null,
        maritalRaw: values["Name/Marital Status"] || null,
        preferredLanguage: values["Name/Preferred Language"] || null,
      });
    }
    if (!rows.length) throw fail(400, "No valid registry rows.");
    const id = randomUUID();
    await previews.put(
      id,
      {
        kind: "member-registry",
        rows,
        issues,
        duplicates,
        source: req.file.originalname,
        sourceHash: hash(req.file.buffer.toString("base64")),
      },
      req.user.id,
    );
    const current = await storage.readData(db);
    res.json({
      id,
      rows: rows.length,
      matched: rows.filter((r) =>
        current.participants.some((p) => p.id === r.id),
      ).length,
      newProfiles: rows.filter(
        (r) => !current.participants.some((p) => p.id === r.id),
      ).length,
      duplicates,
      issues,
      note: "This adds membership evidence, never attendance. A complete current registry must be explicitly attested. Imports never replace attendance or clear profile values.",
    });
  });
  app.post("/api/registry/confirm", async (req, res) => {
    admin(req);
    const { id, complete, asOf, historyComplete = false } = req.body || {};
    if (
      !text(id, 100) ||
      typeof complete !== "boolean" ||
      typeof historyComplete !== "boolean" ||
      !validDate(asOf) ||
      asOf > todaySG()
    )
      throw fail(
        400,
        "Include a preview, completeness declaration and snapshot date.",
      );
    await writeTransaction(db, async (tx) => {
      if (tx.query) await tx.query("SELECT pg_advisory_xact_lock(714205)");
      const preview = await tx
        .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
        .get(id, req.user.id);
      if (!preview || preview.expires < Date.now())
        throw fail(400, "Registry preview expired.");
      const parsed = JSON.parse(preview.payload);
      if (parsed.kind !== "member-registry")
        throw fail(400, "Choose a registry preview.");
      if ((await storage.getSettings(tx)).registry?.type === "clients")
        throw fail(
          409,
          "Use the client registry importer to update this client population without replacing its membership history.",
        );
      if (complete && (parsed.issues.length || parsed.duplicates))
        throw fail(
          400,
          "Resolve all invalid and duplicate registry rows before attesting completeness.",
        );
      for (const p of parsed.rows) {
        const { id: pid, ...details } = p;
        await tx.prepare("INSERT OR IGNORE INTO participants VALUES(?,?)").run(
          pid,
          JSON.stringify({
            cfs: null,
            client: null,
            boundary: null,
            ...details,
            profileSource: "Member registry",
          }),
        );
        const existing = await tx
          .prepare("SELECT details FROM participants WHERE id=?")
          .get(pid);
        const merged = JSON.parse(existing.details);
        for (const [field, value] of Object.entries(details))
          if (
            value != null &&
            value !== "" &&
            !["UNKNOWN", "MISSING"].includes(String(value).toUpperCase()) &&
            (merged[field] == null ||
              merged[field] === "" ||
              ["UNKNOWN", "MISSING"].includes(
                String(merged[field]).toUpperCase(),
              ))
          )
            merged[field] = value;
        await tx
          .prepare("UPDATE participants SET details=? WHERE id=?")
          .run(JSON.stringify(merged), pid);
        await tx
          .prepare("INSERT OR IGNORE INTO member_registry VALUES(?,?,?)")
          .run(
            pid,
            parsed.sourceHash,
            JSON.stringify({
              ...details,
              source: parsed.source,
              asOf,
            }),
          );
      }
      const settings = await storage.getSettings(tx);
      settings.registry = {
        complete,
        historyComplete,
        snapshot: parsed.sourceHash,
        asOf,
        source: parsed.source,
      };
      await tx
        .prepare("UPDATE settings SET value=? WHERE id=1")
        .run(JSON.stringify(settings));
      await tx.prepare("DELETE FROM import_previews WHERE id=?").run(id);
      await storage.audit(tx, req.user.id, "member.registry.imported", {
        rows: parsed.rows.length,
        complete,
        asOf,
      });
    });
    res.json({ ok: true });
  });
  const csvCell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  app.get("/api/needs/export/:format", async (req, res) => {
    privileged(req);
    const f = filters(req);
    if (
      [
        "gender",
        "race",
        "ageBand",
        "client",
        "boundary",
        "cfs",
        "observed",
      ].some((k) => f[k]) ||
      (f.target && f.target !== "all")
    )
      throw fail(
        403,
        "Reset audience filters before generating a shareable management report.",
      );
    const r = await report(req);
    const actions = (
      await db.prepare("SELECT id,kind,details FROM needs_actions").all()
    ).map((row) => ({
      id: row.id,
      kind: row.kind,
      ...JSON.parse(row.details),
    }));
    const actionRows = actions.map((a) => {
      const stages = [
        a.contacted,
        a.responded,
        a.interested,
        a.registered,
        a.attended,
        a.repeat,
      ];
      const restricted =
        stages.some((n) => n != null && n > 0 && n < r.privacyMinimum) ||
        stages
          .slice(1)
          .some(
            (n, i) =>
              n != null &&
              stages[i] != null &&
              stages[i] - n > 0 &&
              stages[i] - n < r.privacyMinimum,
          );
      return [
        a.title,
        a.kind,
        a.owner || "Unassigned",
        a.due || "",
        a.priority,
        a.status,
        ...stages.map((n) =>
          restricted ? "Withheld" : (n ?? "Not collected"),
        ),
      ];
    });
    const rows = [
      ["Programme & Outreach needs-based management summary"],
      ["Period", r.period.from, r.period.to],
      ["Active filters", JSON.stringify(filters(req))],
      ["WHO ARE THEY?"],
      ["Unique participating seniors", r.summary.unique],
      [
        "Male seniors",
        [r.summary.male, r.summary.unique - r.summary.male].some(
          (n) => n > 0 && n < r.privacyMinimum,
        )
          ? "Withheld"
          : r.summary.male,
      ],
      [
        "Minority seniors",
        [r.summary.minority, r.summary.unique - r.summary.minority].some(
          (n) => n > 0 && n < r.privacyMinimum,
        )
          ? "Withheld"
          : r.summary.minority,
      ],
      ["Attendance entries", r.summary.attendance],
      ["Distinct sessions", r.summary.sessions],
      ["WHAT ARE WE MISSING?"],
      ["Registry", r.registry.note],
      ["Profile quality cohort", r.qualityScope],
      [
        "Field",
        "Known profiles",
        "Blank / missing profiles",
        "Unknown",
        "Not assessed",
        "Total profiles in quality cohort",
        "Completion percent",
      ],
      ...r.quality.map((q) => [
        q.label,
        q.completed,
        q.missing,
        q.unknown,
        q.notAssessed,
        q.total,
        q.percent,
      ]),
      [
        "Programme alignment",
        "Distinct programmes",
        "Delivered sessions",
        "Unique seniors",
        "Session share percent",
      ],
      ...r.alignment.map((a) => [
        a.label,
        a.programmes,
        a.sessions,
        a.unique,
        a.sessionShare,
      ]),
      ["WHAT SHOULD WE DO?"],
      [
        "Recorded staff actions ? own dates and manually evidenced outreach cohorts",
      ],
      [
        "Action",
        "Type",
        "Staff owner",
        "Due",
        "Priority",
        "Status",
        "Contacted",
        "Responded",
        "Interested",
        "Registered",
        "Attended",
        "Repeat",
      ],
      ...actionRows,
      [
        "Action",
        "Finding",
        "Possible explanation",
        "Recommended follow-up",
        "Evidence",
      ],
      ...r.findings.map((f) => [
        f.title,
        f.finding,
        f.explanation,
        f.action,
        f.evidence,
      ]),
      ["Limitations", ...r.limitations],
      [
        "Privacy",
        "Sensitive profile/barrier/health/living breakdowns, personal notes and identifiers are excluded from management downloads. Fixed sensitive tables stay inside authorised staff views.",
      ],
    ];
    if (req.params.format === "csv") {
      res
        .type("text/csv")
        .attachment("needs-management-summary.csv")
        .send(
          "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
        );
      return;
    }
    if (req.params.format !== "report")
      throw fail(404, "Report format not found.");
    const esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Programme & Outreach management summary</title><style>body{font:15px system-ui;color:#16304c;max-width:1100px;margin:30px auto;padding:20px}table{border-collapse:collapse;width:100%}td{padding:9px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}tr{break-inside:avoid}h1{font-size:28px}@media print{body{margin:0;padding:0}}</style><h1>Needs-based programme planning</h1><p>Generated ${esc(r.generatedAt)} · latest-known profiles; not historical assessments. Print → Save as PDF.</p><table>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table></html>`,
      );
  });
}
