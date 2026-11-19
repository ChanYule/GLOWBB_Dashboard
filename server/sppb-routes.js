import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { CENTRES, centreById } from "../shared/centres.js";
import { readData, getSettings } from "./db.js";
import { readMatrix, hash, todaySG } from "./domain.js";
import { currentClientRows, validDay } from "./client-domain.js";
import { dataTransaction } from "./data-management.js";
import { importFileUpload } from "./large-uploads.js";
import { sessionEventTypes } from "./event-types.js";
import { sessionDomains,PROGRAMME_DOMAINS } from "./programme-domains.js";
import {
  sppbDefaults,
  sppbFail as fail,
  parseSppb,
  conflictGroups,
  memberSummary,
  standardScores,
  scoredRecord,
  PENDING,
} from "./sppb-domain.js";

export async function ensureSppb(db) {
  if (db.storage) {
    await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(714227)");
      await tx.query(
        readFileSync(
          new URL(
            "../supabase/migrations/007_sppb_assessments.sql",
            import.meta.url,
          ),
          "utf8",
        ).replace(/^BEGIN;\s*|^COMMIT;\s*/gm, ""),
      );
    });
  } else
    db.exec(`CREATE TABLE IF NOT EXISTS sppb_records(id TEXT PRIMARY KEY,member_key TEXT,details TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sppb_member_key ON sppb_records(member_key);
    CREATE TABLE IF NOT EXISTS sppb_batches(id TEXT PRIMARY KEY,created TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),details TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sppb_configuration(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,details TEXT NOT NULL);`);
  await db
    .prepare("INSERT OR IGNORE INTO sppb_configuration VALUES(1,1,?)")
    .run(JSON.stringify(sppbDefaults));
}
const locks = [
  "sppb_records",
  "sppb_batches",
  "sppb_configuration",
  "import_previews",
  "audit",
];
const text = (value, max = 200) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function* log(tx, user, action, details) {
  yield tx
    .prepare(
      "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
    )
    .run(new Date().toISOString(), user.id, action, JSON.stringify(details));
}
async function configuration(db) {
  const row = await db
    .prepare("SELECT * FROM sppb_configuration WHERE id=1")
    .get();
  return {
    ...sppbDefaults,
    ...JSON.parse(row.details),
    revision: row.revision,
  };
}
async function allRecords(db) {
  return (await db.prepare("SELECT * FROM sppb_records").all()).map((r) => ({
    id: r.id,
    memberKey: r.member_key,
    ...JSON.parse(r.details),
  }));
}
// These routes live on the platform, before centre dispatch. One assessment is
// stored once; membership and grants are rechecked against live workspaces.
export function mountSppb(app, { control, workspaces, access }) {
  const upload = importFileUpload();
  app.use("/api/sppb", (req, _res, next) => {
    if (!["admin", "planner", "viewer"].includes(req.user.role))
      throw fail(403, "Staff access is required.");
    next();
  });
  async function globalAdmin(req) {
    const grants = await access(req.user);
    if (
      req.user.role !== "admin" ||
      !CENTRES.every((c) => grants.ids.includes(c.id))
    )
      throw fail(
        403,
        "An administrator with access to all four centres is required for the shared assessment source.",
      );
  }
  const staff = (req) => {
    if (!["admin", "planner"].includes(req.user.role))
      throw fail(
        403,
        "Individual assessments are restricted to authorised staff.",
      );
  };
  async function context(req, all = false) {
    const grants = await access(req.user);
    const queryCentre = req.query.centre,
      headerCentre = req.get("x-centre-id");
    if (queryCentre && headerCentre && queryCentre !== headerCentre)
      throw fail(400, "Conflicting centre context.");
    const selected = headerCentre || queryCentre;
    if (!all && (!selected || (selected !== "all" && !centreById(selected))))
      throw fail(400, "Select an authorised centre.");
    if (!all && selected === "all" && !grants.canCompare)
      throw fail(403, "Management comparison permission is required.");
    const ids = all
      ? CENTRES.map((c) => c.id)
      : selected === "all"
        ? grants.ids
        : [selected];
    if (ids.some((id) => !grants.ids.includes(id)))
      throw fail(403, "Centre access is required.");
    const people = new Map(),
      existing = new Set(),
      states = [];
    let complete = ids.length > 0;
    for (const id of ids) {
      const db = await workspaces.get(id),
        storage = db.storage || { readData, getSettings };
      const data = await storage.readData(db),
        settings = await storage.getSettings(db);
      const registry = await db.prepare("SELECT * FROM member_registry").all();
      const profiles = await db
        .prepare("SELECT * FROM participant_profiles")
        .all();
      const participantById=new Map(data.participants.map(p=>[p.id,p]));
      const profileById=new Map(profiles.map(p=>[p.participant_id,JSON.parse(p.details).basic||{}]));
      for (const p of data.participants) existing.add(p.id);
      complete &&=
        settings.registry?.type === "clients" &&
        settings.registry?.complete === true;
      if (settings.registry?.type === "clients")
        for (const r of currentClientRows(registry, settings)) {
          if (
            r.client !== true ||
            r.membershipStatus === "Archived" ||
            (r.registrationDate && r.registrationDate > todaySG())
          )
            continue;
          const base = participantById.get(r.id) || {};
          const basic = profileById.get(r.id) || {};
          const person = people.get(r.id) || {
            id: r.id,
            memberId: r.memberId || null,
            age: basic.age ?? r.age ?? base.age,
            cfs: basic.cfs ?? r.cfs ?? base.cfs,
            centres: [],
          };
          person.centres.push(id);
          people.set(r.id, person);
        }
      states.push({ id, data, settings });
    }
    return { people, existing, complete, ids, states };
  }
  function filterInput(req) {
    const q = req.query;
    for (const field of ["from", "to", "asOf"])
      if (q[field] && (!validDay(q[field]) || q[field] > todaySG()))
        throw fail(400, "Choose valid Singapore reporting dates.");
    if (q.from && q.to && q.from > q.to)
      throw fail(400, "Assessment start date must be before the end date.");
    if (q.search && (typeof q.search !== "string" || q.search.length > 200))
      throw fail(400, "Choose a valid Member ID search.");
    if (q.age && !["below60", "60to79", "80plus", "unknown"].includes(q.age))
      throw fail(400, "Choose an approved age group.");
    if (
      q.status &&
      ![
        "all",
        "repeated",
        "review",
        "due",
        "none",
        "increased",
        "decreased",
      ].includes(q.status)
    )
      throw fail(400, "Choose a supported assessment status.");
    if (
      q.sort &&
      !["recent", "oldest", "count", "increase", "decline", "review"].includes(
        q.sort,
      )
    )
      throw fail(400, "Choose a supported assessment sort.");
    const page = Number(q.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw fail(400, "Choose a valid assessment page.");
    return { ...q, page, asOf: q.asOf || todaySG() };
  }
  async function report(req) {
    const q = filterInput(req),
      ctx = await context(req),
      config = await configuration(control),
      records = await allRecords(control);
    const visible = [...ctx.people.values()].filter(
      (p) =>
        (!q.search ||
          (
            p.memberId ||
            records.find((r) => r.memberKey === p.id)?.memberId ||
            ""
          ).includes(q.search)) &&
        (!q.cfs || String(p.cfs) === q.cfs) &&
        (!q.age ||
          (q.age === "unknown"
            ? p.age == null
            : p.age != null &&
              (q.age === "below60"
                ? p.age < 60
                : q.age === "60to79"
                  ? p.age >= 60 && p.age < 80
                  : p.age >= 80))),
    );
    const byMember = new Map();
    for (const r of records)
      if (
        r.memberKey &&
        ctx.people.has(r.memberKey) &&
        (!r.date || r.date <= q.asOf)
      ) {
        if (!byMember.has(r.memberKey)) byMember.set(r.memberKey, []);
        byMember.get(r.memberKey).push(r);
      }
    const members = visible.map((p) =>
      memberSummary(
        {
          ...p,
          memberId: p.memberId || byMember.get(p.id)?.[0]?.memberId || p.id,
        },
        byMember.get(p.id) || [],
        config,
        q.asOf,
      ),
    );
    const selected = members.filter(
      (m) =>
        (!q.from && !q.to) ||
        m.records.some(
          (r) =>
            r.date &&
            (!q.from || r.date >= q.from) &&
            (!q.to || r.date <= q.to),
        ),
    );
    const monthly = new Map();
    for (const m of selected)
      for (const r of m.records)
        if (
          r.date &&
          (!q.from || r.date >= q.from) &&
          (!q.to || r.date <= q.to) &&
          r.review?.disposition !== "superseded"
        ) {
          const month = r.date.slice(0, 7);
          if (!monthly.has(month)) monthly.set(month, new Set());
          monthly.get(month).add(m.id);
        }
    const assessed = selected.filter((m) => m.latestDate).length;
    const scoreGroups = new Map();
    for (const m of selected) {
      const latest = m.latest;
      if (latest?.original.total == null) continue;
      const key = JSON.stringify([
        latest.sourceDefinition,
        latest.original.total,
      ]);
      const group = scoreGroups.get(key) || {
        sourceDefinition: latest.sourceDefinition,
        total: latest.original.total,
        members: 0,
      };
      group.members++;
      scoreGroups.set(key, group);
    }
    const summary = {
      eligible: visible.length,
      assessed,
      coverage:
        ctx.complete && visible.length
          ? (assessed / visible.length) * 100
          : null,
      repeated: selected.filter((m) => m.distinctDates >= 2).length,
      latest:
        selected
          .map((m) => m.latestDate)
          .filter(Boolean)
          .sort()
          .at(-1) || null,
      due: selected.filter((m) =>
        ["Overdue", "Reassessment due"].includes(m.followup.status),
      ).length,
      increased: selected.filter((m) => m.delta > 0).length,
      unchanged: selected.filter((m) => m.delta === 0).length,
      decreased: selected.filter((m) => m.delta != null && m.delta < 0).length,
      comparable: selected.filter((m) => m.delta != null).length,
      review: selected.filter((m) => m.reviewRequired).length,
    };
    let filtered = selected.filter(
      (m) =>
        !q.status ||
        q.status === "all" ||
        {
          repeated: m.distinctDates >= 2,
          review: m.reviewRequired,
          due: ["Overdue", "Reassessment due"].includes(m.followup.status),
          none: m.count === 0,
          increased: m.delta > 0,
          decreased: m.delta != null && m.delta < 0,
        }[q.status],
    );
    filtered = filtered.sort((a, b) =>
      q.sort === "oldest"
        ? (a.latestDate || "").localeCompare(b.latestDate || "")
        : q.sort === "count"
          ? b.count - a.count
          : q.sort === "increase"
            ? (b.delta ?? -Infinity) - (a.delta ?? -Infinity)
            : q.sort === "decline"
              ? (a.delta ?? Infinity) - (b.delta ?? Infinity)
              : q.sort === "review"
                ? Number(b.reviewRequired) - Number(a.reviewRequired)
                : (b.latestDate || "").localeCompare(a.latestDate || ""),
    );
    return {
      ctx,
      config,
      q,
      selected,
      filtered,
      summary,
      recordedScores: [...scoreGroups.values()].sort(
        (a, b) =>
          a.sourceDefinition.localeCompare(b.sourceDefinition) ||
          a.total - b.total,
      ),
      monthly: [...monthly]
        .sort()
        .map(([month, ids]) => ({ month, members: ids.size })),
      note: "Eligible population: current verified registered clients in the selected authorised centres. Assessment location remains Unknown. Date filters select members with assessments in that interval; latest results and follow-up use their history through the reporting date. Coverage requires a verified complete registry. Changes are observed numerical differences, not clinical improvement or evidence of programme causation.",
    };
  }
  app.get("/api/sppb/overview", async (req, res) => {
    const r = await report(req);
    if (req.user.role === "viewer") {
      // Fixed centre-level aggregates only; no identifier search or small cells.
      if (Object.keys(req.query).some((k) => !["centre"].includes(k)))
        throw fail(
          403,
          "Detailed assessment filtering requires authorised staff access.",
        );
      const safe =
        r.summary.eligible >= 10 &&
        r.summary.assessed >= 5 &&
        r.summary.eligible - r.summary.assessed >= 5;
      return res.json({
        summary: safe
          ? {
              eligible: r.summary.eligible,
              assessed: r.summary.assessed,
              coverage: r.summary.coverage,
            }
          : null,
        suppressed: !safe,
        note: "Protected centre-level coverage only. Detailed scores and assessment histories require authorised staff.",
      });
    }
    const rows = r.filtered
      .slice((r.q.page - 1) * 25, r.q.page * 25)
      .map(({ records: _records, ...member }) => ({
        ...member,
        latest: member.latest
          ? {
              date: member.latest.date,
              original: member.latest.original,
              standard: member.latest.standard,
              validation: member.latest.validation,
            }
          : null,
        previous: member.previous
          ? { date: member.previous.date, standard: member.previous.standard }
          : null,
        followupTask: r.config.followups?.[member.id] || null,
      }));
    res.json({
      summary: r.summary,
      recordedScores: r.recordedScores,
      rows,
      total: r.filtered.length,
      page: r.q.page,
      pageSize: 25,
      monthly: r.monthly,
      intervalMonths: r.config.intervalMonths,
      note: r.note,
    });
  });
  app.get("/api/sppb/members/:id", async (req, res) => {
    staff(req);
    const ctx = await context(req),
      member = ctx.people.get(req.params.id);
    if (!member)
      throw fail(
        404,
        "No verified client affiliation is available in this authorised centre population.",
      );
    const config = await configuration(control),
      records = (
        await control
          .prepare("SELECT * FROM sppb_records WHERE member_key=?")
          .all(member.id)
      ).map((r) => ({
        id: r.id,
        memberKey: r.member_key,
        ...JSON.parse(r.details),
      }));
    const summary = memberSummary(
      {
        ...member,
        memberId: member.memberId || records[0]?.memberId || member.id,
      },
      records,
      config,
    );
    const participation = {
      sessions: 0,
      programmes: [],
      domains: [],
      eventTypes: [],
      from: summary.previous?.date || null,
      to: summary.latest?.date || null,
    };
    if (summary.previous && summary.latest?.standard) {
      const seen = new Set(),
        programmes = new Set(),
        domains = new Set(),
        events = new Set();
      for (const state of ctx.states) {
        const sessions = new Map(state.data.sessions.map((s) => [s.id, s])),
          catalogue = new Map(state.data.programmes.map((p) => [p.id, p]));
        for (const a of state.data.attendance)
          if (a.participantId === member.id) {
            const s = sessions.get(a.sessionId);
            if (
              !s ||
              s.date <= summary.previous.date ||
              s.date > summary.latest.date ||
              seen.has(state.id + ":" + s.id)
            )
              continue;
            seen.add(state.id + ":" + s.id);
            const p = catalogue.get(s.programmeId);
            if (p) {
              programmes.add(p.name);
              for (const domain of sessionDomains(s,p,state.settings))
                domains.add(domain);
              for (const e of sessionEventTypes(s)) events.add(e);
            }
          }
      }
      participation.sessions = seen.size;
      participation.programmes = [...programmes];
      participation.domains = PROGRAMME_DOMAINS.filter(d=>domains.has(d));
      participation.eventTypes = [...events];
    }
    await dataTransaction(
      control,
      function* (tx) {
        yield* log(tx, req.user, "sppb.history.viewed", {
          memberKey: member.id,
        });
      },
      false,
      ["audit"],
    );
    res.json({
      ...summary,
      records: summary.records.sort((a, b) =>
        (b.date || "").localeCompare(a.date || ""),
      ),
      participation,
      followupTask: config.followups?.[member.id] || null,
      note:
        PENDING +
        ". Original scores remain unchanged; programme participation is exploratory.",
    });
  });
  app.post(
    "/api/sppb/import/preview",
    async (req, _res, next) => {
      await globalAdmin(req);
      next();
    },
    upload,
    async (req, res) => {
      if (!req.file) throw fail(400, "Choose the SPPB workbook.");
      const parsed = parseSppb(
        await readMatrix(req.file.buffer, req.file.originalname, [
          "Member ID",
          "Date of Assessment",
          "Total Score",
        ]),
      );
      const ctx = await context(req, true),
        existing = await allRecords(control),
        saved = new Set(existing.map((r) => r.id));
      const unique = [...new Map(parsed.rows.map((r) => [r.id, r])).values()];
      const combined = [
        ...new Map([...unique, ...existing].map((r) => [r.id, r])).values(),
      ];
      const groups = conflictGroups(combined),
        keys = new Set(parsed.rows.map((r) => r.memberKey).filter(Boolean));
      const matched = [...keys].filter((k) => ctx.existing.has(k));
      const id = randomUUID(),
        sourceHash = hash(req.file.buffer.toString("base64"));
      const summary = {
        rows: parsed.rows.length,
        uniqueMembers: keys.size,
        matchedMembers: matched.length,
        unmatchedMembers: keys.size - matched.length,
        matchedRecords: parsed.rows.filter((r) => ctx.existing.has(r.memberKey))
          .length,
        newRecords: unique.filter((r) => !saved.has(r.id)).length,
        existingRecords: unique.filter((r) => saved.has(r.id)).length,
        identicalDuplicates: parsed.rows.length - unique.length,
        conflicts: groups.filter((g) =>
          g.some((r) => unique.some((u) => u.id === r.id)),
        ).length,
        scoringWarnings: parsed.rows.filter((r) => !standardScores(r.original))
          .length,
        missingDates: parsed.rows.filter((r) => !r.date).length,
        reviewRecords: parsed.issues.length,
        invalidMembers: parsed.rows.filter((r) => !r.memberKey).length,
      };
      const payload = {
        kind: "sppb",
        source: req.file.originalname,
        sourceHash,
        rows: unique,
        summary,
      };
      await dataTransaction(
        control,
        function* (tx) {
          yield tx
            .prepare("DELETE FROM import_previews WHERE expires < ?")
            .run(Date.now());
          yield tx
            .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
            .run(
              id,
              req.user.id,
              Date.now() + 1200000,
              JSON.stringify(payload),
            );
        },
        false,
        ["import_previews"],
      );
      res.json({
        id,
        ...summary,
        matchedMemberIds: unique
          .filter((r) => ctx.existing.has(r.memberKey))
          .map((r) => r.memberId)
          .filter((v, i, a) => a.indexOf(v) === i),
        unmatchedMemberIds: unique
          .filter((r) => !ctx.existing.has(r.memberKey))
          .map((r) => r.memberId)
          .filter((v, i, a) => a.indexOf(v) === i),
        note: "Preview only. No clients or attendance will be created. Unmatched and invalid records remain in protected staging. All source scores are pending validation.",
      });
    },
  );
  app.post("/api/sppb/import/confirm", async (req, res) => {
    await globalAdmin(req);
    if (req.body.confirmed !== true || !text(req.body.id, 100))
      throw fail(400, "Review and confirm the SPPB import.");
    const ctx = await context(req, true);
    res.json(
      await dataTransaction(
        control,
        function* (tx) {
          const preview = yield tx
            .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
            .get(req.body.id, req.user.id);
          if (!preview || preview.expires < Date.now())
            throw fail(
              409,
              "SPPB preview expired. Preview the workbook again.",
            );
          const payload = JSON.parse(preview.payload);
          if (payload.kind !== "sppb")
            throw fail(400, "Choose an SPPB import preview.");
          const batch = randomUUID(),
            timestamp = new Date().toISOString();
          let inserted = 0;
          for (const r of payload.rows) {
            if (
              yield tx
                .prepare("SELECT id FROM sppb_records WHERE id=?")
                .get(r.id)
            )
              continue;
            yield tx.prepare("INSERT INTO sppb_records VALUES(?,?,?)").run(
              r.id,
              r.memberKey,
              JSON.stringify({
                ...r,
                source: payload.source,
                sourceHash: payload.sourceHash,
                batch,
                importedAt: timestamp,
                linkedExisting: ctx.existing.has(r.memberKey),
                review: { revision: 0, disposition: "unresolved" },
              }),
            );
            inserted++;
          }
          const result = {
            ...payload.summary,
            inserted,
            batch,
            source: payload.source,
            noMembershipChanges: true,
          };
          yield tx
            .prepare("INSERT INTO sppb_batches VALUES(?,?,?,?)")
            .run(batch, timestamp, req.user.id, JSON.stringify(result));
          yield* log(tx, req.user, "sppb.imported", {
            batch,
            inserted,
            rows: payload.summary.rows,
          });
          yield tx
            .prepare("DELETE FROM import_previews WHERE id=? AND user_id=?")
            .run(req.body.id, req.user.id);
          return result;
        },
        false,
        locks,
      ),
    );
  });
  app.delete("/api/sppb/import/preview/:id", async (req, res) => {
    await globalAdmin(req);
    await dataTransaction(
      control,
      function* (tx) {
        const row = yield tx
          .prepare("SELECT * FROM import_previews WHERE id=? AND user_id=?")
          .get(req.params.id, req.user.id);
        if (row && JSON.parse(row.payload).kind === "sppb")
          yield tx
            .prepare("DELETE FROM import_previews WHERE id=? AND user_id=?")
            .run(req.params.id, req.user.id);
      },
      false,
      ["import_previews"],
    );
    res.json({ ok: true });
  });
  app.get("/api/sppb/review", async (req, res) => {
    await globalAdmin(req);
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1)
      throw fail(400, "Choose a review page.");
    const ctx = await context(req, true),
      records = await allRecords(control),
      config = await configuration(control),
      conflicts = conflictGroups(records),
      conflictIds = new Set(conflicts.flat().map((r) => r.id));
    const pending = records.filter(
      (r) =>
        !ctx.existing.has(r.memberKey) ||
        r.warnings.length ||
        !scoredRecord(r, config, conflictIds).standard ||
        conflictIds.has(r.id),
    );
    res.json({
      total: pending.length,
      unmatchedMembers: new Set(
        records
          .filter((r) => r.memberKey && !ctx.existing.has(r.memberKey))
          .map((r) => r.memberKey),
      ).size,
      conflicts: conflicts.length,
      rows: pending.slice((page - 1) * 25, page * 25).map((r) => ({
        ...r,
        matched: ctx.existing.has(r.memberKey),
        conflict: conflictIds.has(r.id),
      })),
      config: { ...config, followups: undefined },
      batches: (await control.prepare("SELECT * FROM sppb_batches").all())
        .map((b) => ({
          id: b.id,
          created: b.created,
          ...JSON.parse(b.details),
        }))
        .slice(-10)
        .reverse(),
    });
  });
  app.post("/api/sppb/reprocess", async (req, res) => {
    await globalAdmin(req);
    const ctx = await context(req, true);
    res.json(
      await dataTransaction(
        control,
        function* (tx) {
          let linked = 0,
            unmatched = 0;
          for (const row of yield tx
            .prepare("SELECT * FROM sppb_records")
            .all()) {
            const r = JSON.parse(row.details),
              matched = ctx.existing.has(row.member_key);
            if (matched && !r.linkedExisting) linked++;
            if (!matched) unmatched++;
            yield tx
              .prepare("UPDATE sppb_records SET details=? WHERE id=?")
              .run(JSON.stringify({ ...r, linkedExisting: matched }), row.id);
          }
          yield* log(tx, req.user, "sppb.reprocessed", { linked, unmatched });
          return { linked, unmatched };
        },
        false,
        locks,
      ),
    );
  });
  app.post("/api/sppb/configuration", async (req, res) => {
    await globalAdmin(req);
    const { intervalMonths, approachDays, definitions, reason, revision } =
      req.body;
    if (
      !(
        intervalMonths === null ||
        (Number.isInteger(intervalMonths) &&
          intervalMonths >= 1 &&
          intervalMonths <= 120)
      ) ||
      !Number.isInteger(approachDays) ||
      approachDays < 0 ||
      approachDays > 365 ||
      !text(reason, 2000) ||
      reason.trim().length < 10 ||
      !Array.isArray(definitions) ||
      definitions.length > 20 ||
      definitions.some(
        (d) =>
          !text(d.sourceDefinition) ||
          !text(d.version) ||
          !["identity", "reviewed"].includes(d.method) ||
          typeof d.approved !== "boolean",
      )
    )
      throw fail(
        400,
        "Provide a documented interval and approved scoring definitions. Identity approval only validates already standard-range, internally consistent scores.",
      );
    if (
      new Set(definitions.map((d) => d.sourceDefinition)).size !==
      definitions.length
    )
      throw fail(400, "Each source definition needs one current approval.");
    res.json(
      await dataTransaction(
        control,
        function* (tx) {
          const old = yield tx
            .prepare("SELECT * FROM sppb_configuration WHERE id=1")
            .get();
          if (old.revision !== revision)
            throw fail(
              409,
              "Assessment configuration changed. Reload before saving.",
            );
          const config = {
            ...JSON.parse(old.details),
            intervalMonths,
            approachDays,
            definitions: definitions.map(
              ({ sourceDefinition, version, method, approved }) => ({
                sourceDefinition,
                version,
                method,
                approved,
              }),
            ),
            reason,
            approvedBy: req.user.id,
            approvedAt: new Date().toISOString(),
          };
          yield tx
            .prepare(
              "UPDATE sppb_configuration SET revision=?,details=? WHERE id=1",
            )
            .run(revision + 1, JSON.stringify(config));
          yield* log(tx, req.user, "sppb.configuration.updated", {
            previous: JSON.parse(old.details),
            current: config,
          });
          return { ok: true, revision: revision + 1 };
        },
        false,
        locks,
      ),
    );
  });
  app.post("/api/sppb/records/:id/review", async (req, res) => {
    await globalAdmin(req);
    const {
      revision,
      disposition,
      reason,
      standard,
      scoringVersion,
      correctedRecordId,
      sourceDefinition,
    } = req.body;
    if (
      !["unresolved", "separate", "superseded"].includes(disposition) ||
      !text(reason, 2000) ||
      reason.trim().length < 10 ||
      (standard && !standardScores(standard)) ||
      (sourceDefinition != null && !text(sourceDefinition))
    )
      throw fail(
        400,
        "Choose a source-record resolution and document the evidence. Validated scores must meet standard component ranges and total.",
      );
    res.json(
      await dataTransaction(
        control,
        function* (tx) {
          const row = yield tx
            .prepare("SELECT * FROM sppb_records WHERE id=?")
            .get(req.params.id);
          if (!row) throw fail(404, "Assessment record not found.");
          const old = JSON.parse(row.details),
            config = JSON.parse(
              (yield tx
                .prepare("SELECT * FROM sppb_configuration WHERE id=1")
                .get()).details,
            );
          if ((old.review?.revision || 0) !== revision)
            throw fail(409, "This assessment review changed. Reload it.");
          const definition = config.definitions.find(
            (d) =>
              d.sourceDefinition ===
                (sourceDefinition || old.sourceDefinition) &&
              d.approved &&
              d.version === scoringVersion,
          );
          if (standard && !definition)
            throw fail(
              400,
              "Approve the documented scoring version before validating a corrected result.",
            );
          if (correctedRecordId) {
            const corrected = yield tx
              .prepare("SELECT * FROM sppb_records WHERE id=?")
              .get(correctedRecordId);
            if (
              !corrected ||
              corrected.id === row.id ||
              corrected.member_key !== row.member_key
            )
              throw fail(
                400,
                "A correction must reference another assessment for the same member.",
              );
          }
          const review = {
            revision: revision + 1,
            disposition,
            reason: reason.trim(),
            standard: standard || null,
            scoringVersion: standard ? scoringVersion : null,
            correctedRecordId: correctedRecordId || null,
            reviewedBy: req.user.id,
            reviewedAt: new Date().toISOString(),
          };
          const updated = {
            ...old,
            sourceDefinition: sourceDefinition || old.sourceDefinition,
            review,
          };
          yield tx
            .prepare("UPDATE sppb_records SET details=? WHERE id=?")
            .run(JSON.stringify(updated), row.id);
          yield* log(tx, req.user, "sppb.record.reviewed", {
            recordId: row.id,
            previous: {
              review: old.review,
              sourceDefinition: old.sourceDefinition,
            },
            current: { review, sourceDefinition: updated.sourceDefinition },
          });
          return { ok: true, revision: review.revision };
        },
        false,
        locks,
      ),
    );
  });
  app.post("/api/sppb/members/:id/followup", async (req, res) => {
    staff(req);
    const ctx = await context(req);
    if (!ctx.people.has(req.params.id))
      throw fail(404, "Verified client affiliation is required.");
    const { assigned, status, revision } = req.body;
    if (
      typeof assigned !== "string" ||
      assigned.length > 200 ||
      ![
        "Not started",
        "Review required",
        "Contact attempted",
        "Follow-up agreed",
        "Completed",
      ].includes(status)
    )
      throw fail(400, "Choose a valid follow-up status and staff member.");
    res.json(
      await dataTransaction(
        control,
        function* (tx) {
          const row = yield tx
              .prepare("SELECT * FROM sppb_configuration WHERE id=1")
              .get(),
            config = JSON.parse(row.details);
          const old = config.followups?.[req.params.id];
          if ((old?.revision || 0) !== revision)
            throw fail(409, "Follow-up changed. Reload the member history.");
          config.followups = {
            ...config.followups,
            [req.params.id]: {
              assigned,
              status,
              revision: revision + 1,
              updated: new Date().toISOString(),
              userId: req.user.id,
            },
          };
          yield tx
            .prepare(
              "UPDATE sppb_configuration SET revision=?,details=? WHERE id=1",
            )
            .run(row.revision + 1, JSON.stringify(config));
          yield* log(tx, req.user, "sppb.followup.updated", {
            memberKey: req.params.id,
            previous: old || null,
            current: config.followups[req.params.id],
          });
          return { ok: true };
        },
        false,
        locks,
      ),
    );
  });
  app.get("/api/sppb/export", async (req, res) => {
    staff(req);
    const r = await report(req);
    if (!["xlsx", "pdf"].includes(req.query.format))
      throw fail(400, "Choose Excel or print / PDF export.");
    const rows = r.filtered.map((m) => [
      m.memberId,
      m.centres.map((id) => centreById(id).name).join("; "),
      m.latestDate || "",
      m.latest?.original.total ?? "",
      m.latest?.standard?.total ?? "",
      m.previous?.standard?.total ?? "",
      m.delta ?? "",
      m.change,
      m.followup.status,
      m.followup.due || "",
    ]);
    const headers = [
      "Member ID",
      "Verified affiliation",
      "Latest date",
      "Original imported total (unvalidated unless reviewed)",
      "Validated standard total",
      "Previous comparable total",
      "Observed score difference",
      "Comparison status",
      "Reassessment status",
      "Due date",
    ];
    await dataTransaction(
      control,
      function* (tx) {
        yield* log(tx, req.user, "sppb.exported", {
          centres: r.ctx.ids,
          rows: rows.length,
          format: req.query.format,
        });
      },
      false,
      ["audit"],
    );
    if (req.query.format === "xlsx") {
      const workbook = new ExcelJS.Workbook(),
        sheet = workbook.addWorksheet("SPPB Assessments");
      sheet.addRow(headers);
      sheet.addRows(rows);
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.columns.forEach((c) => {
        c.width = 26;
      });
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { wrapText: true };
      sheet.getRow(1).height = 45;
      const notes = workbook.addWorksheet("Scope and definitions");
      notes.addRow(["Reporting date", r.q.asOf]);
      notes.addRow([
        "Centres",
        r.ctx.ids.map((id) => centreById(id).name).join("; "),
      ]);
      notes.addRow(["Assessment dates", r.q.from || "All", r.q.to || "All"]);
      notes.addRow(["Interpretation", r.note]);
      notes.addRow(["Scoring", PENDING]);
      notes.getColumn(1).width = 24;
      notes.getColumn(2).width = 100;
      notes.getColumn(2).alignment = { wrapText: true };
      res
        .set(
          "Content-Disposition",
          'attachment; filename="sppb-assessments.xlsx"',
        )
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .send(Buffer.from(await workbook.xlsx.writeBuffer()));
    } else
      res
        .type("html")
        .send(
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>SPPB Assessments</title><style>body{font:14px system-ui;color:#17314b;padding:24px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}thead{display:table-header-group}@media print{button{display:none}@page{size:landscape}}</style><h1>SPPB Assessments</h1><p>${escape(r.ctx.ids.map((id) => centreById(id).name).join(", "))} · Reporting date ${escape(r.q.asOf)} · ${escape(r.q.from || "All dates")} to ${escape(r.q.to || "All dates")}</p><p>${escape(r.note)}</p><p>${escape(PENDING)}</p><button onclick="window.print()">Print / Save as PDF</button><table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></html>`,
        );
  });
}
