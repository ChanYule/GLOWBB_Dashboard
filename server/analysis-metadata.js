import {policySummary} from './reporting-policy.js';
const stamp = (value) => {
  if (!value) return null;
  const normalized =
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
      ? value.replace(" ", "T") + "Z"
      : value;
  const date = new Date(normalized);
  return Number.isFinite(+date) ? date.toISOString() : null;
};
export async function analysisMetadata(db, settings) {
  const rows = await db
    .prepare(
      "SELECT 'import' AS kind, MAX(created) AS stamp FROM imports UNION ALL SELECT 'profile' AS kind, MAX(updated) AS stamp FROM participant_profiles UNION ALL SELECT 'action' AS kind, MAX(updated) AS stamp FROM needs_actions UNION ALL SELECT 'feedback' AS kind, MAX(created) AS stamp FROM participant_feedback",
    )
    .all();
  return {
    ...(policySummary()?{reporting:policySummary()}:{}),
    lastUpdatedAt:
      [settings.registry?.importedAt, ...rows.map((r) => r.stamp)]
        .map(stamp)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
    lastImportAt: stamp(rows.find((r) => r.kind === "import")?.stamp),
    generatedAt: new Date().toISOString(),
  };
}
