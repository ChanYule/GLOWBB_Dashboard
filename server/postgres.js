import pg from "pg";
import { rootCertificates } from "node:tls";
import { inspectImport } from "./domain.js";
import { expiredPreview } from "./previews.js";

const tables =
  /\b(schema_version|users|logins|participants|programmes|sessions|attendance|imports|settings|targets|decisions|opportunity_decisions|audit|import_previews)\b/g;

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
    if (!connectionString) throw Error("DATABASE_URL is required.");
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw Error("Invalid DATABASE_URL protocol.");
    // Avoid connection-string SSL parameters overriding certificate verification.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      url.searchParams.delete(key);
    pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: true,
        ...(process.env.DATABASE_CA_CERT
          ? {
              ca: [
                ...rootCertificates,
                process.env.DATABASE_CA_CERT.replaceAll("\\n", "\n"),
              ],
            }
          : {}),
      },
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
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
    confirm: (id, user) =>
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
        const inspection = inspectImport(parsed, await readData(tx));
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
  return JSON.parse(
    (await db.prepare("SELECT value FROM settings WHERE id=1").get()).value,
  );
}
async function audit(db, user, action, details = {}) {
  await db
    .prepare(
      "INSERT INTO audit(created,user_id,action,details) VALUES(?,?,?,?)",
    )
    .run(new Date().toISOString(), user, action, JSON.stringify(details));
}
async function saveImport(db, parsed, inspection, user) {
  const summary = {
    raw: parsed.rawRows,
    imported: inspection.fresh.length,
    duplicates: inspection.duplicates.length,
    invalid: parsed.issues.length,
    skipped: inspection.conflicts.length,
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
        return [id, { id, details: JSON.stringify(details) }];
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
  await audit(db, user, "attendance.import", summary);
  return summary;
}
