// Keep registry confirmation atomic while avoiding a database network trip for
// every client and source field. Only fixed statements/columns are used here.
export function* writeClientRegistry(db, batch) {
  if (!db.storage) {
    for (const row of batch.created)
      yield db
        .prepare("INSERT OR IGNORE INTO participants VALUES(?,?)")
        .run(row.id, row.details);
    for (const row of batch.updated)
      yield db
        .prepare("UPDATE participants SET details=? WHERE id=?")
        .run(row.details, row.id);
    for (const row of batch.originals)
      yield db
        .prepare("INSERT OR IGNORE INTO member_registry VALUES(?,?,?)")
        .run(row.participant_id, row.snapshot, row.details);
    for (const row of batch.current)
      yield db
        .prepare(
          "INSERT INTO member_registry VALUES(?,?,?) ON CONFLICT(participant_id,snapshot) DO UPDATE SET details=excluded.details",
        )
        .run(row.participant_id, row.snapshot, row.details);
    for (const row of batch.observations)
      yield db
        .prepare("INSERT OR IGNORE INTO profile_observations VALUES(?,?,?,?,?)")
        .run(row.id, row.participant_id, row.field, row.raw, row.recorded);
    return;
  }
  const recordsets = [
    [
      batch.created,
      "INSERT INTO glowbb.participants (id,details) SELECT id,details FROM jsonb_to_recordset($1::jsonb) AS x(id text,details text) ON CONFLICT DO NOTHING",
    ],
    [
      batch.updated,
      "UPDATE glowbb.participants AS p SET details=x.details FROM jsonb_to_recordset($1::jsonb) AS x(id text,details text) WHERE p.id=x.id",
    ],
    [
      batch.originals,
      "INSERT INTO glowbb.member_registry (participant_id,snapshot,details) SELECT participant_id,snapshot,details FROM jsonb_to_recordset($1::jsonb) AS x(participant_id text,snapshot text,details text) ON CONFLICT DO NOTHING",
    ],
    [
      batch.current,
      "INSERT INTO glowbb.member_registry (participant_id,snapshot,details) SELECT participant_id,snapshot,details FROM jsonb_to_recordset($1::jsonb) AS x(participant_id text,snapshot text,details text) ON CONFLICT(participant_id,snapshot) DO UPDATE SET details=excluded.details",
    ],
    [
      batch.observations,
      "INSERT INTO glowbb.profile_observations (id,participant_id,field,raw,recorded) SELECT id,participant_id,field,raw,recorded FROM jsonb_to_recordset($1::jsonb) AS x(id text,participant_id text,field text,raw text,recorded text) ON CONFLICT DO NOTHING",
    ],
  ];
  for (const [rows, sql] of recordsets)
    for (let start = 0; start < rows.length; start += 500)
      yield db.query(sql, [JSON.stringify(rows.slice(start, start + 500))]);
}
