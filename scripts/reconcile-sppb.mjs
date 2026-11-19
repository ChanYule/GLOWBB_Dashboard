// Read-only source and optional LOCAL SQLite matching inventory. Never opens a
// writable database or creates workspaces. No Member IDs or results are printed.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { readMatrix } from "../server/domain.js";
import {
  parseSppb,
  conflictGroups,
  standardScores,
} from "../server/sppb-domain.js";
import { CENTRES } from "../shared/centres.js";
export async function reconcileSppb(path, directory) {
  const parsed = parseSppb(
    await readMatrix(readFileSync(path), path, [
      "Member ID",
      "Date of Assessment",
      "Total Score",
    ]),
  );
  const dates = new Map();
  for (const r of parsed.rows) {
    if (!dates.has(r.memberKey)) dates.set(r.memberKey, new Set());
    if (r.date) dates.get(r.memberKey).add(r.date);
  }
  const result = {
    source: {
      records: parsed.rows.length,
      uniqueMembers: dates.size,
      repeatedMembers: [...dates.values()].filter((d) => d.size >= 2).length,
      conflictingSameDayGroups: conflictGroups(parsed.rows).length,
      totalsAbove12: parsed.rows.filter((r) => r.original.total > 12).length,
      gaitAbove4: parsed.rows.filter((r) => r.original.gait > 4).length,
      invalidOrMissingDates: parsed.rows.filter((r) => !r.date).length,
      nonstandardRecords: parsed.rows.filter((r) => !standardScores(r.original))
        .length,
      latestDate:
        parsed.rows
          .map((r) => r.date)
          .filter(Boolean)
          .sort()
          .at(-1) || null,
    },
    matching: null,
  };
  if (directory) {
    const existing = new Set(),
      files = [];
    for (const c of CENTRES) {
      const file = resolve(directory, c.id + ".sqlite");
      if (!existsSync(file)) continue;
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        for (const p of db.prepare("SELECT id FROM participants").all())
          existing.add(p.id);
        files.push(c.id);
      } finally {
        db.close();
      }
    }
    const ids = [...dates.keys()].filter(Boolean),
      matched = ids.filter((id) => existing.has(id)).length;
    result.matching = {
      centreFiles: files,
      matchedMembers: matched,
      unmatchedMembers: ids.length - matched,
      matchedRecords: parsed.rows.filter((r) => existing.has(r.memberKey))
        .length,
      note: "Read-only local centre workspaces only. Attendance matches do not grant individual assessment access; verified client affiliation and staff permissions are checked separately. Hosted data and unassigned legacy records are excluded.",
    };
  }
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw Error(
      "Usage: node scripts/reconcile-sppb.mjs <source.xlsx> [local-centre-directory]",
    );
  console.log(
    JSON.stringify(
      await reconcileSppb(process.argv[2], process.argv[3]),
      null,
      2,
    ),
  );
}
