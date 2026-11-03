import pg from "pg";
import { rootCertificates } from "node:tls";
import { readFileSync } from "node:fs";
import { inspectImport, defaults, hash } from "./domain.js";
import { expiredPreview } from "./previews.js";

const tables =
  /\b(schema_version|users|logins|participants|programmes|sessions|attendance|imports|settings|targets|decisions|opportunity_decisions|audit|import_previews|assessment_monthly|operational_settings|operational_targets|staff_preferences|attendance_backups|risk_observations|participant_profiles|profile_history|profile_observations|participant_feedback|needs_actions|member_registry)\b/g;

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

export function openPostgres(connectionString, { pool } = {}) {
  if (!pool) {
    pool = new pg.Pool(postgresOptions(connectionString));
    pool.on("error", () =>
      console.error("Dashboard database connection interrupted."),
    );
  }
  const db = adapter(pool);
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
        const summary = await saveImport(tx, parsed, inspection, user);
        await tx.prepare("DELETE FROM import_previews WHERE id=?").run(id);
        return summary;
      }),
  };
  return db;
}

function adapter(client) {
  return {
    storage: { readData, getSettings, audit },
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

async function readData(db) {
  if (db.transaction) return db.transaction(readData, { readOnly: true });
  // Sequential queries work with the transaction pooler's single connection.
  const participants = await db.prepare("SELECT * FROM participants").all();
  const programmes = await db.prepare("SELECT * FROM programmes").all();
  const sessions = await db.prepare("SELECT * FROM sessions").all();
  const attendance = await db.prepare("SELECT * FROM attendance").all();
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
  for (const { id, ...details } of inspection.updates || [])
    await db
      .prepare("UPDATE participants SET details=? WHERE id=?")
      .run(JSON.stringify(details), id);
  const summary = {
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
      'id,programme_id,date,start,"end"',
      'id text,programme_id text,date text,start integer,"end" integer',
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
  for (const { id, ...details } of inspection.updates || [])
    await db
      .prepare("UPDATE participants SET details=? WHERE id=?")
      .run(JSON.stringify(details), id);
  const observations = [
    ...new Map(
      parsed.rows
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
      parsed.rows.flatMap((r) =>
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
        ]
          .filter((field) => field in r.participant)
          .map((field) => {
            const id = hash([r.participant.id, field, r.participant[field]]);
            return [
              id,
              {
                id,
                participant_id: r.participant.id,
                field,
                raw:
                  typeof r.participant[field] === "boolean"
                    ? String(r.participant[field])
                    : r.participant[field],
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
