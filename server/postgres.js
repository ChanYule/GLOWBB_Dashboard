import {importBatch,importBatchResult} from "./import-batches.js";
import pg from "pg";
import { rootCertificates } from "node:tls";
import { readFileSync } from "node:fs";
import { inspectImport, defaults, hash } from "./domain.js";
import { expiredPreview } from "./previews.js";
import {measuredPool} from './database-metrics.js';

const tables =
  /\b(analytics_revisions|sppb_records|sppb_batches|sppb_configuration|legacy_allocations|centres|centre_access|platform_preferences|platform_configuration|schema_version|users|logins|participants|programmes|sessions|attendance|imports|settings|targets|decisions|opportunity_decisions|audit|import_previews|assessment_monthly|operational_settings|operational_targets|staff_preferences|attendance_backups|risk_observations|participant_profiles|profile_history|profile_observations|participant_feedback|needs_actions|member_registry|location_store)\b/g;

const supabaseCa = readFileSync(
  new URL("./supabase-ca.crt", import.meta.url),
  "utf8",
);

export function postgresOptions(
  connectionString,
  customCa = process.env.DATABASE_CA_CERT,
) {
  if (!connectionString) throw Error("DATABASE_URL is required.");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("Invalid DATABASE_URL protocol.");
  // Connection-string SSL options must not override certificate verification.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(key);
  const authorities = [...rootCertificates];
  if (
    /^(?:db\.[a-z0-9-]+\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com)$/i.test(
      url.hostname,
    )
  )
    authorities.push(supabaseCa);
  if (customCa?.trim())
    authorities.push(customCa.trim().replaceAll("\\n", "\n"));
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca: authorities },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  };
}

// Adapt the app's fixed SQLite statements. SQL values always stay parameterized.
export function postgresStatement(statement) {
  let n = 0;
  const ignore = statement.startsWith("INSERT OR IGNORE INTO");
  let sql = statement
    .replace("INSERT OR IGNORE INTO", "INSERT INTO")
    .replace(tables, "glowbb.$1")
    .replace(/\bend\b/gi, '"end"')
    .replaceAll("?", () => `$${++n}`);
  if (ignore) sql += " ON CONFLICT DO NOTHING";
  if (/^INSERT INTO glowbb\.(imports|targets)\b/.test(sql))
    sql += " RETURNING id";
  return sql;
}

export function openPostgres(connectionString, { pool, schema = 'glowbb', measured=false } = {}) {
  if (!pool) {
    pool = new pg.Pool(postgresOptions(connectionString));
    pool.on("error", () =>
      console.error("Dashboard database connection interrupted."),
    );
  }
  if(!/^(glowbb|centre_(?:glow|seen)_(?:bukit_batok|nanyang))$/.test(schema))throw Error('Unsupported workspace schema.');
  if(!measured)pool=measuredPool(pool);
  const rawPool=pool;
  if(schema!=='glowbb'){
    const wrap=client=>({query:(sql,values)=>client.query(sql.replace(/\bglowbb\./g,schema+'.'),values),release:()=>client.release()});
    pool={query:(sql,values)=>rawPool.query(sql.replace(/\bglowbb\./g,schema+'.'),values),connect:async()=>wrap(await rawPool.connect()),end:()=>Promise.resolve()};
  }
  const db = adapter(pool);
  db.dialect='postgres';
  db.namespace=schema;
  db.databaseDiagnostics=()=>rawPool.diagnostics(schema);
  db.centreConnection = id => openPostgres(connectionString,{pool:rawPool,schema:'centre_'+id,measured:true});
  db.close = () => pool.end();
  db.transaction = async (work, { readOnly = false } = {}) => {
    const client = await pool.connect();
    try {
      await client.query(
        readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
      );
      const result = await work(adapter(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };
  db.previews = {
    put: (id, parsed, user) =>
      db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(714203)");
        await tx
          .prepare("DELETE FROM import_previews WHERE expires < ?")
          .run(Date.now());
        if (
          (
            await tx
              .prepare("SELECT count(*)::integer AS n FROM import_previews")
              .get()
          ).n >= 5
        )
          throw Object.assign(
            Error(
              "Several previews are open. Confirm or wait 20 minutes before uploading another.",
            ),
            { status: 429 },
          );
        await tx
          .prepare("INSERT INTO import_previews VALUES(?,?,?,?)")
          .run(id, user, Date.now() + 1200000, JSON.stringify(parsed));
      }),
    remove: (id, user) =>
      db
        .prepare("DELETE FROM import_previews WHERE id=? AND user_id=?")
        .run(id, user),
    confirm: (id, user, options = {}) =>
      db.transaction(async (tx) => {
        // Serializes imports across functions, then recomputes conflicts on current data.
        await tx.query("SELECT pg_advisory_xact_lock(714204)");
        const p = await tx
          .prepare(
            "SELECT * FROM import_previews WHERE id=? AND user_id=? FOR UPDATE",
          )
          .get(id, user);
        if (!p || p.expires < Date.now()) throw expiredPreview();
        const parsed = JSON.parse(p.payload);
        if (parsed.kind)
          throw Object.assign(
            Error("This preview is for a different import."),
            { status: 400 },
          );
        const current = await readData(tx);
        if (
          parsed.mode === "replace" &&
          (options.confirmation !== "REPLACE ATTENDANCE" ||
            parsed.fingerprint !== hash(current))
        )
          throw Object.assign(
            Error("Replacement requires confirmation and a fresh preview."),
            { status: 409 },
          );
        const inspection = inspectImport(parsed, current);
        const batch=importBatch(parsed,current,inspection,options.batchSize);
        if(!batch && inspection.sessionUpdates.length && parsed.fingerprint!==inspection.fingerprint)
          throw Object.assign(Error('Session metadata changed after preview. Review a fresh preview.'),{status:409});
        const summary=await saveImport(tx,batch?.parsed||parsed,batch?.inspection||inspection,user);
        if(batch){
          const response=importBatchResult(parsed,batch,summary,batch.complete?null:await readData(tx));
          if(batch.complete){
            await tx.prepare('UPDATE imports SET summary=? WHERE id=(SELECT MAX(id) FROM imports)').run(JSON.stringify({...summary,platformTotals:response}));
            await tx.prepare('DELETE FROM import_previews WHERE id=?').run(id);
          }else await tx.prepare('UPDATE import_previews SET payload=?,expires=? WHERE id=? AND user_id=?').run(JSON.stringify(parsed),Date.now()+1200000,id,user);
          return response;
        }
        await tx.prepare("DELETE FROM import_previews WHERE id=?").run(id);
        return summary;
      }),
  };
  return db;
}

function adapter(client) {
  return {
    dialect:'postgres',
    storage: { readData, readPlanningState, readMembershipState,readParticipantState,readSppbAttendance,getSettings, audit },
    query: (sql, values) => client.query(sql, values),
    prepare(statement) {
      const sql = postgresStatement(statement);
      return {
        all: async (...values) => (await client.query(sql, values)).rows,
        get: async (...values) => (await client.query(sql, values)).rows[0],
        run: async (...values) => {
          const r = await client.query(sql, values);
          return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id };
        },
      };
    },
  };
}

// One statement gives a consistent snapshot without a network trip per table.
const coreSnapshot = `(SELECT COALESCE(json_agg(p),'[]'::json) FROM glowbb.participants p) AS participants,
(SELECT COALESCE(json_agg(p),'[]'::json) FROM glowbb.programmes p) AS programmes,
(SELECT COALESCE(json_agg(s),'[]'::json) FROM glowbb.sessions s) AS sessions,
(SELECT COALESCE(json_agg(json_build_object('id',a.id,'participant_id',a.participant_id,'session_id',a.session_id)),'[]'::json) FROM glowbb.attendance a) AS attendance`;
async function readData(db) {
  if (db.transaction) return db.transaction(readData, { readOnly: true });
  const {
    rows: [snapshot],
  } = await db.query(`SELECT ${coreSnapshot}`);
  return decodeData(snapshot);
}
async function readPlanningState(db) {
  if (db.transaction)
    return db.transaction(readPlanningState, { readOnly: true });
  const {
    rows: [snapshot],
  } = await db.query(`SELECT ${coreSnapshot},
(SELECT COALESCE(json_agg(p),'[]'::json) FROM glowbb.participant_profiles p) AS profiles,
(SELECT COALESCE(json_agg(f ORDER BY f.date,f.created),'[]'::json) FROM glowbb.participant_feedback f) AS feedback,
(SELECT COALESCE(json_agg(r),'[]'::json) FROM glowbb.member_registry r) AS registry,
(SELECT value FROM glowbb.settings WHERE id=1) AS settings`);
  return {
    data: decodeData(snapshot),
    profiles: snapshot.profiles,
    feedback: snapshot.feedback,
    registry: snapshot.registry,
    settings: { ...defaults, ...JSON.parse(snapshot.settings) },
  };
}
function decodeData({ participants, programmes, sessions, attendance }) {
  return {
    participants: participants.map((r) => ({
      id: r.id,
      ...JSON.parse(r.details),
    })),
    programmes: programmes.map((r) => ({
      ...r,
      optional: JSON.parse(r.optional),
    })),
    sessions: sessions.map((r) => ({
      id: r.id,
      programmeId: r.programme_id,
      date: r.date,
      start: r.start,
      end: r.end,
      venue: r.venue,
      optional: JSON.parse(r.optional),
    })),
    attendance: attendance.map((r) => ({
      id: r.id,
      participantId: r.participant_id,
      sessionId: r.session_id,
    })),
  };
}
async function getSettings(db) {
  return {
    ...defaults,
    ...JSON.parse(
      (await db.prepare("SELECT value FROM settings WHERE id=1").get()).value,
    ),
  };
}
async function readMembershipState(db,participantId=null,compact=false){
 if(db.transaction)return db.transaction(tx=>readMembershipState(tx,participantId,compact),{readOnly:true});
 const {rows:[s]}=await db.query(`SELECT
 (SELECT COALESCE(json_agg(CASE WHEN $2::boolean THEN jsonb_build_object('id',p.id,'details',COALESCE((SELECT jsonb_object_agg(k,v) FROM jsonb_each(p.details::jsonb) e(k,v) WHERE k IN ('memberId','age','cfs','gender','race','riskRaw','livingRaw')),'{}'::jsonb)::text) ELSE to_jsonb(p) END),'[]') FROM glowbb.participants p WHERE $1::text IS NULL OR p.id=$1) participants,
 (SELECT COALESCE(json_agg(CASE WHEN $2::boolean THEN to_jsonb(p)||jsonb_build_object('details',jsonb_build_object('basic',COALESCE(p.details::jsonb->'basic','{}'::jsonb))::text) ELSE to_jsonb(p) END),'[]') FROM glowbb.participant_profiles p WHERE $1::text IS NULL OR p.participant_id=$1) profiles,
 (SELECT COALESCE(json_agg(CASE WHEN $2::boolean THEN to_jsonb(r)||jsonb_build_object('details',COALESCE((SELECT jsonb_object_agg(k,v) FROM jsonb_each(r.details::jsonb) e(k,v) WHERE k IN ('memberId','age','cfs','gender','race','riskRaw','livingRaw','registrationDate','client','membershipStatus')),'{}'::jsonb)::text) ELSE to_jsonb(r) END),'[]') FROM glowbb.member_registry r WHERE $1::text IS NULL OR r.participant_id=$1) registry,
 (SELECT value FROM glowbb.settings WHERE id=1) settings`,[participantId,compact]);
 return {data:decodeData({...s,programmes:[],sessions:[],attendance:[]}),profiles:s.profiles,registry:s.registry,feedback:[],settings:{...defaults,...JSON.parse(s.settings)}};
}
async function readParticipantState(db,id){
 if(db.transaction)return db.transaction(tx=>readParticipantState(tx,id),{readOnly:true});
 const state=await readMembershipState(db,id);
 const {rows:[s]}=await db.query(`WITH own AS (SELECT id,participant_id,session_id FROM glowbb.attendance WHERE participant_id=$1),
 own_sessions AS (SELECT s.* FROM glowbb.sessions s WHERE EXISTS(SELECT 1 FROM own a WHERE a.session_id=s.id))
 SELECT (SELECT COALESCE(json_agg(a),'[]') FROM own a) attendance,
 (SELECT COALESCE(json_agg(s),'[]') FROM own_sessions s) sessions,
 (SELECT COALESCE(json_agg(p),'[]') FROM glowbb.programmes p WHERE EXISTS(SELECT 1 FROM own_sessions s WHERE s.programme_id=p.id)) programmes,
 (SELECT COALESCE(json_agg(f ORDER BY f.date,f.created),'[]') FROM glowbb.participant_feedback f WHERE participant_id=$1) feedback`,[id]);
 return {...state,data:{...decodeData({...s,participants:[]}),participants:state.data.participants},feedback:s.feedback};
}
async function readSppbAttendance(db,windows,asOf){
 if(db.transaction)return db.transaction(tx=>readSppbAttendance(tx,windows,asOf),{readOnly:true});
 const {rows:[s]}=await db.query(`WITH bounds AS (SELECT * FROM jsonb_to_recordset($1::jsonb) w(id text,lo text,hi text)),
 own AS (SELECT DISTINCT a.participant_id,a.session_id FROM glowbb.attendance a JOIN glowbb.sessions s ON s.id=a.session_id JOIN bounds b ON b.id=a.participant_id AND s.date>=b.lo AND s.date<=b.hi),
 own_sessions AS (SELECT s.* FROM glowbb.sessions s WHERE EXISTS(SELECT 1 FROM own a WHERE a.session_id=s.id))
 SELECT (SELECT COALESCE(json_agg(json_build_object('id',a.participant_id||':'||a.session_id,'participant_id',a.participant_id,'session_id',a.session_id)),'[]') FROM own a) attendance,
 (SELECT COALESCE(json_agg(s),'[]') FROM own_sessions s) sessions,
 (SELECT COALESCE(json_agg(p),'[]') FROM glowbb.programmes p WHERE EXISTS(SELECT 1 FROM own_sessions s WHERE s.programme_id=p.id)) programmes,
 (SELECT json_build_object('first',MIN(s.date),'last',MAX(s.date)) FROM glowbb.sessions s WHERE s.date<=$2 AND EXISTS(SELECT 1 FROM glowbb.attendance a WHERE a.session_id=s.id)) coverage`,[JSON.stringify(windows),asOf]);
 return {data:decodeData({...s,participants:[]}),coverage:s.coverage};
}
async function audit(db, user, action, details = {}) {
  await db
    .prepare(
      "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
    )
    .run(new Date().toISOString(), user, action, JSON.stringify(details));
}
async function saveImport(db, parsed, inspection, user) {
  if (inspection.mode === "replace") {
    await db.prepare("INSERT INTO attendance_backups VALUES(?,?,?,?)").run(
      crypto.randomUUID(),
      new Date().toISOString(),
      user,
      JSON.stringify({
        ...(await readData(db)),
        attendanceRows: await db.prepare("SELECT * FROM attendance").all(),
      }),
    );
    await db.prepare("DELETE FROM attendance").run();
  }
  const summary = {
    ...(parsed.platformImportId ? {platformImportId:parsed.platformImportId} : {}),
    ...(parsed.platformBatchIndex !== undefined ? {platformBatchIndex:parsed.platformBatchIndex,platformImportComplete:parsed.platformImportComplete}:{}),
    updatedSessions: inspection.sessionUpdates?.length || 0,
    updatedProfiles: inspection.updates?.length || 0,
    mode: inspection.mode || "add",
    raw: parsed.rawRows,
    imported: inspection.fresh.length,
    duplicates: inspection.duplicates.length,
    invalid: parsed.issues.length,
    skipped: inspection.conflicts.filter((c) => c.action !== "update").length,
    exactDuplicates: parsed.exactDuplicates,
    warnings: inspection.warnings.length,
    invalidAgeCount: parsed.issues.filter((i) => i.code === "invalidAge")
      .length,
    invalidSessionCount: parsed.issues.filter(
      (i) => i.code === "invalidSession",
    ).length,
    namingVariantCount: inspection.variants.length,
  };
  const { lastInsertRowid: id } = await db
    .prepare("INSERT INTO imports(created,user_id,summary) VALUES(?,?,?)")
    .run(new Date().toISOString(), user, JSON.stringify(summary));
  const rows = inspection.fresh;
  // Four bulk inserts keep large imports from issuing a network query per row.
  const participants = [
    ...new Map(
      rows.map((r) => {
        const { id, ...details } = r.participant;
        return [
          id,
          {
            id,
            details: JSON.stringify({
              ...details,
              profileImportedAt: new Date().toISOString(),
            }),
          },
        ];
      }),
    ).values(),
  ];
  const programmes = [
    ...new Map(rows.map((r) => [r.programme.id, r.programme])).values(),
  ];
  const sessions = [
    ...new Map(
      rows.map((r) => [
        r.session.id,
        {
          id: r.session.id,
          programme_id: r.programme.id,
          date: r.session.date,
          start: r.session.start,
          end: r.session.end,
          optional: JSON.stringify(r.session.optional||{}),
        },
      ]),
    ).values(),
  ];
  const attendance = rows.map((r) => ({
    id: r.id,
    participant_id: r.participant.id,
    session_id: r.session.id,
    source_session: r.sourceSession,
    import_id: id,
  }));
  for (const [table, columns, types, values] of [
    ["participants", "id,details", "id text,details text", participants],
    [
      "programmes",
      "id,name,domain",
      "id text,name text,domain text",
      programmes,
    ],
    [
      "sessions",
      'id,programme_id,date,start,"end",optional',
      'id text,programme_id text,date text,start integer,"end" integer,optional text',
      sessions,
    ],
    [
      "attendance",
      "id,participant_id,session_id,source_session,import_id",
      "id text,participant_id text,session_id text,source_session text,import_id integer",
      attendance,
    ],
  ]) {
    await db.query(
      `INSERT INTO glowbb.${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS x(${types}) ON CONFLICT DO NOTHING`,
      [JSON.stringify(values)],
    );
  }
  for(let start=0;start<(inspection.sessionUpdates||[]).length;start+=500)
    await db.query('UPDATE glowbb.sessions AS s SET optional=x.optional FROM jsonb_to_recordset($1::jsonb) AS x(id text,optional text) WHERE s.id=x.id',[JSON.stringify(inspection.sessionUpdates.slice(start,start+500).map(s=>({id:s.id,optional:JSON.stringify(s.optional)})))]);
  const updates = (inspection.updates || []).map(({ id, ...details }) => ({
    id,
    details: JSON.stringify(details),
  }));
  for (let start = 0; start < updates.length; start += 500)
    await db.query(
      "UPDATE glowbb.participants AS p SET details=x.details FROM jsonb_to_recordset($1::jsonb) AS x(id text,details text) WHERE p.id=x.id",
      [JSON.stringify(updates.slice(start, start + 500))],
    );
  const observations = [
    ...new Map(
      (parsed.observationRows || parsed.rows)
        .filter((r) => "riskRaw" in r.participant)
        .map((r) => {
          const id = hash([
            r.participant.id,
            r.session.id,
            r.participant.riskRaw,
          ]);
          return [
            id,
            {
              id,
              participant_id: r.participant.id,
              raw: r.participant.riskRaw,
              imported: new Date().toISOString(),
            },
          ];
        }),
    ).values(),
  ];
  if (observations.length)
    await db.query(
      `INSERT INTO glowbb.risk_observations SELECT x.* FROM jsonb_to_recordset($1::jsonb) AS x(id text,participant_id text,raw text,imported text) JOIN glowbb.participants p ON p.id=x.participant_id ON CONFLICT DO NOTHING`,
      [JSON.stringify(observations)],
    );
  const profileObservations = [
    ...new Map(
      (parsed.observationRows || parsed.rows).flatMap((r) =>
        [
          "age",
          "gender",
          "race",
          "client",
          "boundary",
          "livingRaw",
          "maritalRaw",
          "cfs",
          "riskRaw",
          "preferredLanguage",
          "registrationDate",
          "cfsAssessedOn",
          "residentialObservation",
        ]
          .filter((field) => field === "residentialObservation" ? Boolean(r.residentialObservation) : field in r.participant)
          .map((field) => {
            const value = field === "residentialObservation" ? r.residentialObservation : r.participant[field];
            const id = hash([r.participant.id, field, value]);
            return [
              id,
              {
                id,
                participant_id: r.participant.id,
                field,
                raw: typeof value === "boolean" ? String(value) : value,
                recorded: new Date().toISOString(),
              },
            ];
          }),
      ),
    ).values(),
  ];
  if (profileObservations.length)
    await db.query(
      `INSERT INTO glowbb.profile_observations SELECT x.* FROM jsonb_to_recordset($1::jsonb) AS x(id text,participant_id text,field text,raw text,recorded text) JOIN glowbb.participants p ON p.id=x.participant_id ON CONFLICT DO NOTHING`,
      [JSON.stringify(profileObservations)],
    );
  await audit(db, user, "attendance.import", summary);
  return summary;
}
