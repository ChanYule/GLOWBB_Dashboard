import { hash } from "./domain.js";
export const IMPORT_BATCH_ROWS = 2000;
export const importFingerprint = (data) =>
  hash(
    Object.fromEntries(
      Object.entries(data).map(([key, rows]) => [
        key,
        [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      ]),
    ),
  );
const fail = (message) => Object.assign(Error(message), { status: 409 });
// Freeze the reviewed decisions once. Source observations still use the original rows.
export function importBatch(parsed, current, inspection, batchSize) {
  if (
    !parsed.batch &&
    (!batchSize || parsed.rows.length <= batchSize || parsed.mode === "replace")
  )
    return null;
  if (parsed.batch && parsed.batch.fingerprint !== importFingerprint(current))
    throw fail(
      "Attendance or profiles changed between batches. Saved batches are retained. Upload a fresh preview to review the remaining records.",
    );
  if (!parsed.batch) {
    if (
      inspection.sessionUpdates.length &&
      parsed.fingerprint !== inspection.fingerprint
    )
      throw fail(
        "Session metadata changed after preview. Review a fresh preview.",
      );
    parsed.batch = {
      cursor: 0,
      summary: {},
      plan: {
        freshRows: inspection.fresh.map((r) => r.row),
        updates: inspection.updates,
        sessionUpdates: inspection.sessionUpdates,
        duplicates: inspection.duplicates,
        conflicts: inspection.conflicts,
        warnings: inspection.warnings,
        variants: inspection.variants,
      },
    };
  }
  const state = parsed.batch,
    plan = state.plan,
    start = state.cursor,
    end = Math.min(parsed.rows.length, start + IMPORT_BATCH_ROWS),
    rows = parsed.rows.slice(start, end),
    rowIds = new Set(rows.map((r) => r.row)),
    freshRows = new Set(plan.freshRows),
    complete = end === parsed.rows.length;
  const fresh = inspection.fresh.filter(
    (r) => rowIds.has(r.row) && freshRows.has(r.row),
  );
  const knownPeople = new Set(current.participants.map((p) => p.id));
  const introduced = new Set(
    fresh.map((r) => r.participant.id).filter((id) => !knownPeople.has(id)),
  );
  // A previously skipped row can contain a sourced observation for someone first inserted in this batch.
  const observationRows = introduced.size
    ? parsed.rows
        .slice(0, end)
        .filter((r) => rowIds.has(r.row) || introduced.has(r.participant.id))
    : rows;
  return {
    end,
    complete,
    parsed: {
      observationRows,
      ...parsed,
      batch: undefined,
      rows,
      rawRows: rows.length,
      issues: start === 0 ? parsed.issues : [],
      exactDuplicates: start === 0 ? parsed.exactDuplicates : 0,
      platformBatchIndex: start,
      platformImportComplete: complete,
    },
    inspection: {
      ...inspection,
      fresh,
      updates: complete ? plan.updates : [],
      sessionUpdates: complete ? plan.sessionUpdates : [],
      duplicates: plan.duplicates.filter((row) => rowIds.has(row)),
      conflicts: plan.conflicts.filter((r) => rowIds.has(r.row)),
      warnings: plan.warnings.filter((r) => rowIds.has(r.row)),
      variants: start === 0 ? plan.variants : [],
    },
  };
}
export function importBatchResult(parsed, batch, summary, currentAfter) {
  const total = {
    ...parsed.batch.summary,
    mode: summary.mode,
    platformImportId: parsed.platformImportId,
    raw: parsed.rawRows,
  };
  for (const key of [
    "imported",
    "duplicates",
    "invalid",
    "skipped",
    "exactDuplicates",
    "warnings",
    "invalidAgeCount",
    "invalidSessionCount",
    "namingVariantCount",
    "updatedProfiles",
    "updatedSessions",
  ])
    total[key] = (parsed.batch.summary[key] || 0) + (summary[key] || 0);
  parsed.batch.cursor = batch.end;
  parsed.batch.summary = total;
  if (!batch.complete) parsed.batch.fingerprint = importFingerprint(currentAfter);
  return {
    ...total,
    pending: !batch.complete,
    processedRows: batch.end,
    totalRows: parsed.rows.length,
  };
}
