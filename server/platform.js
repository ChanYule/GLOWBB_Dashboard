import {REPORT_STYLES} from "./report-design.js";
import { ensureSppb, mountSppb } from './sppb-routes.js';
import {randomUUID} from 'node:crypto';
import {reportingContext,policySummary,isReportingRequest,projectReportingData} from './reporting-policy.js';
import {mountLargeUploads} from './large-uploads.js';
import {MAX_IMPORT_MB} from '../shared/upload-limits.js';
import express from "express";
import { createApp } from "./app.js";
import { openDb, readData, getSettings, audit as sqliteAudit } from "./db.js";
import { mountIdentity } from "./identity.js";
import { CENTRES, centreById } from "../shared/centres.js";
import { setupCentres, centreStore, mirrorUser } from "./centre-store.js";
import { mountCentreImports } from "./centre-imports.js";
import { mountCentreMigration } from "./centre-migration.js";
import { ensureOperations } from "./operations-routes.js";
import { ensureLocations } from "./location-store.js";
import { analytics, todaySG } from "./domain.js";
import { clientPopulation, validDay } from "./client-domain.js";
import { dataTransaction } from "./data-management.js";
import { withoutRoutingQuery } from "./request-url.js";
const fail = (status, message) => Object.assign(Error(message), { status });
export function createPlatformApp(control = openDb(), options = {}) {
  const authRequired = options.authRequired ?? false;
  const app = express(),
    storage = control.storage || { readData, getSettings, audit: sqliteAudit };
  const ready = (async () => {
    await control
      .prepare(
        "INSERT OR IGNORE INTO users(username,password,role) VALUES(?,?,'admin')",
      )
      .run("__local_workspace__", "disabled");
    await ensureOperations(control);
    await ensureLocations(control);
    await setupCentres(control);
    await ensureSppb(control);
    if (!authRequired) {
      const user = await control
        .prepare("SELECT id FROM users WHERE username=?")
        .get("__local_workspace__");
      for (const c of CENTRES)
        await control
          .prepare("INSERT OR IGNORE INTO centre_access VALUES(?,?)")
          .run(user.id, c.id);
      await control
        .prepare(
          "INSERT INTO platform_preferences(user_id,can_compare) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET can_compare=1",
        )
        .run(user.id);
    }
  })();
  const workspaces = centreStore(control, options),
    apps = new Map();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.url = withoutRoutingQuery(req.url);
    res.set({
      "Cache-Control": "no-store",
      Vary: "Cookie, X-Centre-Id",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", async (req, _res, next) => {
    await ready;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin"),
        expected =
          process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
      if (origin !== expected)
        throw fail(403, "Request origin was not accepted.");
    }
    next();
  });
  app.get("/api/ready", async (_req, res) => {
    await ready;
    res.json({ ready: true, multiCentre: true });
  });
  mountIdentity(app, control, {
    required: authRequired,
    production: !!options.production,
    ...(!authRequired
      ? {
          resolveUser: () =>
            control
              .prepare("SELECT id,username,role FROM users WHERE username=?")
              .get("__local_workspace__"),
        }
      : {}),
  });
  async function access(user) {
    const rows = await control
      .prepare(
        "SELECT c.* FROM centres c JOIN centre_access a ON a.centre_id=c.id WHERE a.user_id=? AND c.status='Active'",
      )
      .all(user.id);
    const pref = await control
      .prepare("SELECT * FROM platform_preferences WHERE user_id=?")
      .get(user.id);
    const centres = CENTRES.filter((c) => rows.some((r) => r.id === c.id));
    return {
      ids: centres.map((c) => c.id),
      centres,
      preferredCentre: centres.some((r) => r.id === pref?.preferred_centre)
        ? pref.preferred_centre
        : centres[0]?.id || null,
      canCompare: !!pref?.can_compare && centres.length > 1,
    };
  }
  const audit = (user, action, details) =>
    storage.audit(control, user.id, action, details);
  const admin = (req) => {
    if (req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
  };
  app.get("/api/me", async (req, res) =>
    res.json({ ...req.user, ...(await access(req.user)), platform: true }),
  );
  app.get('/api/centres/status',async(req,res)=>{
    const grants=await access(req.user);
    if(req.user.role!=='admin'&&!grants.canCompare)throw fail(403,'Centre administration access is required.');
    const rows=[];
    for(const centre of grants.centres){
      const db=await workspaces.get(centre.id);
      const [people,sessions,attendance,last,settings]=await Promise.all([
        db.prepare('SELECT COUNT(*) AS n FROM participants').get(),
        db.prepare('SELECT COUNT(*) AS n FROM sessions').get(),
        db.prepare('SELECT COUNT(*) AS n FROM attendance').get(),
        db.prepare('SELECT MAX(created) AS created FROM imports').get(),
        db.storage?db.storage.getSettings(db):getSettings(db),
      ]);
      rows.push({...centre,participants:Number(people.n),sessions:Number(sessions.n),attendance:Number(attendance.n),lastImport:last.created||null,registryComplete:settings.registry?.complete===true});
    }
    res.json({rows});
  });
  app.put("/api/centres/preference", async (req, res) => {
    const a = await access(req.user);
    if (!a.ids.includes(req.body.centreId))
      throw fail(403, "Centre access is required.");
    await control
      .prepare(
        "INSERT INTO platform_preferences(user_id,preferred_centre) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET preferred_centre=excluded.preferred_centre",
      )
      .run(req.user.id, req.body.centreId);
    res.json({ ok: true });
  });
  app.get("/api/centres/access", async (req, res) => {
    admin(req);
    res.json({
      users: await control
        .prepare(
          "SELECT id,username,role FROM users WHERE username<>'__local_workspace__'",
        )
        .all(),
      grants: await control.prepare("SELECT * FROM centre_access").all(),
      preferences: await control
        .prepare("SELECT user_id,can_compare FROM platform_preferences")
        .all(),
      centres: CENTRES,
      configuration: JSON.parse(
        (
          await control
            .prepare("SELECT value FROM platform_configuration WHERE id=1")
            .get()
        ).value,
      ),
    });
  });
  app.put("/api/centres/access", async (req, res) => {
    admin(req);
    const { userId, centreIds, canCompare } = req.body;
    if (
      !Number.isInteger(userId) ||
      !Array.isArray(centreIds) ||
      !centreIds.every((id) => centreById(id)) ||
      typeof canCompare !== "boolean" ||
      !(await control.prepare("SELECT id FROM users WHERE id=?").get(userId))
    )
      throw fail(400, "Choose a staff account and valid centre access.");
    // Delete-then-insert is isolated in one transaction; active sessions are checked afresh on every request.
    await dataTransaction(
      control,
      function* (tx) {
        yield tx
          .prepare("DELETE FROM centre_access WHERE user_id=?")
          .run(userId);
        for (const id of new Set(centreIds))
          yield tx
            .prepare("INSERT INTO centre_access VALUES(?,?)")
            .run(userId, id);
        yield tx
          .prepare(
            "INSERT INTO platform_preferences(user_id,can_compare) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET can_compare=excluded.can_compare",
          )
          .run(userId, canCompare ? 1 : 0);
      },
      false,
      ["centre_access", "platform_preferences"],
    );
    await audit(req.user, "centres.access.updated", {
      userId,
      centreIds,
      canCompare,
    });
    res.json({ ok: true });
  });
  app.put("/api/centres/identity-policy", async (req, res) => {
    admin(req);
    if (
      typeof req.body.verified !== "boolean" ||
      typeof req.body.reason !== "string" ||
      req.body.reason.trim().length < 10
    )
      throw fail(
        400,
        "Record the source evidence for globally unique Member IDs.",
      );
    await control
      .prepare("UPDATE platform_configuration SET value=? WHERE id=1")
      .run(
        JSON.stringify({
          memberIdsVerifiedGlobal: req.body.verified,
          reason: req.body.reason,
          reviewedAt: new Date().toISOString(),
        }),
      );
    await audit(req.user, "centres.identity-policy.updated", {
      verified: req.body.verified,
    });
    res.json({ ok: true });
  });
  mountLargeUploads(app,{control,access});
  mountSppb(app, { control, workspaces, access });
  mountCentreImports(app, {
    control,
    workspaces,
    access,
    audit,
    mirror: mirrorUser,
  });
  mountCentreMigration(app, {
    control,
    workspaces,
    access,
    audit,
    mirror: mirrorUser,
  });
  app.get("/api/centres/compare", async (req, res) => {
    const a = await access(req.user);
    if (!a.canCompare || req.user.role === "viewer")
      throw fail(403, "Management comparison permission is required.");
    if (
      Object.keys(req.query).some(
        (k) => !["from", "to", "centreIds", "format"].includes(k),
      )
    )
      throw fail(400, "Choose supported comparison dates and centres.");
    for (const k of ["from", "to"])
      if (req.query[k] && (!validDay(req.query[k]) || req.query[k] > todaySG()))
        throw fail(400, "Choose valid delivered dates.");
    if (req.query.from && req.query.to && req.query.from > req.query.to)
      throw fail(400, "Choose ordered dates.");
    if (req.query.format && !["csv"].includes(req.query.format))
      throw fail(400, "Choose CSV format.");
    const selectedIds = req.query.centreIds
      ? String(req.query.centreIds).split(",")
      : a.ids;
    if (!selectedIds.length || selectedIds.some((id) => !a.ids.includes(id)))
      throw fail(403, "Comparison centres must all be authorised.");
    const filters = Object.fromEntries(
      Object.entries(req.query).filter(([k]) => ["from", "to"].includes(k)),
    );
    const rows = [],
      ids = new Set();
    let allSessions = 0,
      allEntries = 0;
    const config = JSON.parse(
      (
        await control
          .prepare("SELECT value FROM platform_configuration WHERE id=1")
          .get()
      ).value,
    );
    for (const c of a.centres.filter((c) => selectedIds.includes(c.id))) {
      const db = await workspaces.get(c.id);
      const state = db.storage
        ? await db.storage.readPlanningState(db)
        : await dataTransaction(
            db,
            function* (tx) {
              return {
                data: readData(tx),
                settings: getSettings(tx),
                registry: yield tx
                  .prepare("SELECT * FROM member_registry")
                  .all(),
                profiles: yield tx
                  .prepare("SELECT * FROM participant_profiles")
                  .all(),
                feedback: yield tx
                  .prepare("SELECT * FROM participant_feedback")
                  .all(),
              };
            },
            true,
          );
      state.data=projectReportingData(state.data,{settings:state.settings,mode:'official'});
      const { data, settings } = state,
        r = analytics(data, settings, filters),
        selected = analytics(data, settings, filters, undefined, true, "rows");
      for (const row of selected)
        if (row.p.age != null && row.p.age >= settings.seniorAge)
          ids.add(row.p.id);
      allSessions += r.summary.sessions;
      allEntries += r.summary.attendance;
      const people = clientPopulation(
          state,
          req.query.to || new Date().toISOString().slice(0, 10),
        ),
        eligible = new Set(people.map((p) => p.id)),
        attending = new Set(
          selected.filter((r) => eligible.has(r.p.id)).map((r) => r.p.id),
        );
      const registryVerified =
        settings.registry?.type === "clients" &&
        settings.registry?.complete === true &&
        settings.registry?.asOf <= todaySG();
      rows.push({
        ...c,
        ...r.summary,
        ...(!r.coverage.from
          ? {
              unique: null,
              male: null,
              minority: null,
              sessions: null,
              attendance: null,
            }
          : {}),
        coverage: r.coverage,
        seniorAge: settings.seniorAge,
        reporting:policySummary({settings,mode:'official'}),
        programmeMix:
          r.domains
            .map((d) => `${d.label}: ${d.sessions} sessions`)
            .join("; ") || "Unavailable",
        registered: registryVerified ? people.length : null,
        clientRate:
          registryVerified && r.coverage.from && people.length
            ? (attending.size / people.length) * 100
            : null,
      });
    }
    await audit(
      req.user,
      req.query.format === "csv"
        ? "centres.comparison.exported"
        : "centres.comparison.viewed",
      { centres: selectedIds,configurationVersions:Object.fromEntries(rows.map(r=>[r.id,r.reporting.version])) },
    );
    const note =
      "Official reporting configuration versions: "+rows.map(r=>r.name+" v"+r.reporting.version).join("; ")+". Counts alone do not rank performance; consider coverage, senior thresholds, programme frequency, audiences and resources. " +
      (config.memberIdsVerifiedGlobal
        ? "Combined unique reach deduplicates exact verified Member IDs; centre unique counts must not be summed."
        : "Combined unique reach is unavailable until an administrator verifies globally unique source Member IDs.");
    if (req.query.format === "csv") {
      res
        .type("text/csv")
        .set(
          "Content-Disposition",
          'attachment; filename="authorised-centre-comparison.csv"',
        );
      return res.send(
        [
          [
            "Centre",
            "Coverage from",
            "Coverage to",
            "Senior age threshold",
            "Unique seniors",
            "Male seniors",
            "Minority seniors",
            "Sessions",
            "Entries",
            "Registered clients",
            "Client participation rate (%)",
            "Repeat senior participation (%)",
            "Primary domain session mix",
          ],
          ...rows.map((r) => [
            r.name,
            r.coverage.from,
            r.coverage.to,
            r.seniorAge,
            r.unique,
            r.male,
            r.minority,
            r.sessions,
            r.attendance,
            r.registered,
            r.clientRate,
            r.repeatRate,
            r.programmeMix,
          ]),
          [
            "Combined verified unique reach",
            config.memberIdsVerifiedGlobal ? ids.size : null,
          ],
          [
            "Reporting period",
            filters.from || "Available history",
            filters.to || "Available history",
          ],
          ["Interpretation", note],
        ]
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
    }
    res.json({
      rows,
      period: filters,
      combined: {
        unique: config.memberIdsVerifiedGlobal ? ids.size : null,
        sessions: allSessions,
        attendance: allEntries,
      },
      note,
    });
  });
  const configuredApp=async(id,user)=>{const db=await workspaces.get(id);await mirrorUser(db,user);if(!apps.has(id))apps.set(id,createApp(db,{...options,resolveUser:r=>r.centreActor}));return {db,application:apps.get(id)};};
  app.post('/api/centres/configuration/preview',async(req,res)=>{
    admin(req);const allowed=await access(req.user),ids=req.body.centreIds;
    if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>!allowed.ids.includes(id)))throw fail(403,'Choose authorised centres for this shared policy.');
    if(req.body.rule?.selector?.ids?.length&&ids.length>1)throw fail(400,'Use a named matching rule for a shared policy; activity IDs belong to their centre workspace.');
    const id=randomUUID(),targets=[];
    for(const centreId of ids){const {db,application}=await configuredApp(centreId,req.user),settings=db.storage?await db.storage.getSettings(db):getSettings(db);const preview=await application.configuration.preview(req.user,{...req.body,version:settings.reporting?.version||1});targets.push({centreId,preview});}
    await control.prepare('INSERT INTO import_previews VALUES(?,?,?,?)').run(id,req.user.id,Date.now()+1200000,JSON.stringify({kind:'shared-configuration',targets}));res.json({id,targets,note:'Each centre has its own approved version and transaction. If a later centre changes, earlier approvals remain recorded; retrying the same preview resumes safely.'});
  });
  app.post('/api/centres/configuration/confirm',async(req,res)=>{
    admin(req);if(req.body.confirmed!==true||req.body.bulkConfirmed!==true)throw fail(400,'Confirm every selected centre impact.');
    const row=await control.prepare('SELECT * FROM import_previews WHERE id=? AND user_id=?').get(req.body.id,req.user.id);if(!row||row.expires<Date.now())throw fail(409,'Shared preview expired.');const p=JSON.parse(row.payload),allowed=await access(req.user);if(p.kind!=='shared-configuration')throw fail(400,'Wrong preview type.');if(p.targets.some(t=>!allowed.ids.includes(t.centreId)))throw fail(403,'Centre access changed.');
    const results=[];for(const target of p.targets){const {application}=await configuredApp(target.centreId,req.user);results.push({centreId:target.centreId,...await application.configuration.confirm(req.user,{id:target.preview.id,confirmed:true,bulkConfirmed:true})});}res.json({results});
  });
  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    if (/^\/api\/(centres|users|login|logout|me)(\/|$)/.test(req.path))
      throw fail(404, "Platform endpoint not found.");
    const url = new URL(req.url, "http://local"),
      queryCentre = url.searchParams.get("centre"),
      headerCentre = req.get("x-centre-id");
    if (queryCentre && headerCentre && queryCentre !== headerCentre)
      throw fail(400, "Conflicting centre context.");
    const id = headerCentre || queryCentre;
    if (!centreById(id))
      throw fail(400, "Select a valid centre before loading this workspace.");
    const a = await access(req.user);
    if (!a.ids.includes(id))
      throw fail(403, "You do not have access to this centre.");
    url.searchParams.delete("centre");
    req.url = url.pathname + url.search;
    req.centreActor = req.user;
    const db = await workspaces.get(id);
    await mirrorUser(db, req.user);
    const centre = centreById(id);
    let reporting=null;
    if(isReportingRequest(req)){
      const mode=url.searchParams.get('reportingMode')||'official',includeExcluded=url.searchParams.get('includeExcluded')==='1',reportId=url.searchParams.get('reportId')||'';
      if(!['official','exploratory'].includes(mode)||mode==='exploratory'&&req.user.role==='viewer'||mode==='official'&&includeExcluded)throw fail(403,'Choose an authorised reporting mode.');
      for(const key of ['reportingMode','includeExcluded','reportId'])url.searchParams.delete(key);
      req.url=url.pathname+url.search;
      const raw=db.storage||{getSettings};reporting={settings:await raw.getSettings(db),mode,includeExcluded,reportId};
    }

    res.set("X-Centre-Id", id);
    const json = res.json.bind(res),
      send = res.send.bind(res);
    res.json = (value) => {
      res.type("application/json");
      return json(
        value && typeof value === "object" && !Array.isArray(value)
          ? { ...value, centre, ...(reporting?{reporting:policySummary(reporting)}:{}) }
          : value,
      );
    };
    res.send = (value) => {
      const type = String(res.get("Content-Type") || "");
      if (typeof value === "string" && type.includes("text/html"))value=value.replace(/(<h1\b)/i,'<style data-report-design>'+REPORT_STYLES+'</style>$1');
      if (typeof value === "string" && type.includes("text/html"))
        value = value.replace(/(<h1[^>]*>)/i, "$1" + centre.name + " · ");
      if (typeof value === "string" && type.includes("text/csv"))
        value =
          '\uFEFF"Centre","' +
          centre.name +
          '"\r\n' +
          value.replace(/^\uFEFF/, "");
      if(reporting&&typeof value==='string'){
        const summary=policySummary(reporting);
        if(type.includes('text/html'))value=value.replace('</h1>','</h1><p>'+summary.label+' - Configuration version '+summary.version+'</p>');
        if(type.includes('text/csv'))value='"Reporting mode","'+summary.label+'"\r\n"Configuration version","'+summary.version+'"\r\n'+value;
      }
      const disposition = res.get("Content-Disposition");
      if (disposition)
        res.set(
          "Content-Disposition",
          String(disposition).replace(
            /filename=(?:"([^"]+)"|([^;\s]+))/,
            (_match, quoted, plain) =>
              'filename="' + id + "-" + (quoted || plain) + '"',
          ),
        );
      return send(value);
    };
    if (!apps.has(id))
      apps.set(
        id,
        createApp(db, { ...options, resolveUser: (r) => r.centreActor }),
      );
    return reporting?reportingContext.run(reporting,()=>apps.get(id)(req,res,next)):apps.get(id)(req,res,next);
  });
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err.code === "LIMIT_FILE_SIZE")
      return res
        .status(413)
        .json({ error: `Choose an import file of ${MAX_IMPORT_MB} MB or less.` });
    res.status(err.status || 500).json({
      error: err.status
        ? err.message
        : "The centre service could not complete this request.",
    });
  });
  app.platform = { ready, workspaces, control, access };
  return app;
}
