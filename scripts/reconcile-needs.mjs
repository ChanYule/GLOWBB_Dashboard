import { readFileSync } from "node:fs";
import {
  readMatrix,
  parseRows,
  parseSession,
  inspectImport,
  analytics,
  defaults,
  todaySG,
} from "../server/domain.js";
import { pathToFileURL } from "node:url";
export async function reconcileNeeds(path) {
  const matrix = await readMatrix(readFileSync(path), path);
  const headers = matrix[0].map((x) => String(x ?? "").trim());
  const rows = matrix
    .slice(1)
    .filter((r) => r.some((v) => String(v ?? "").trim()))
    .map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])),
    );
  const people = new Map(),
    sessions = new Map(),
    exact = new Set();
  let exactDuplicates = 0;
  const variants = new Map();
  for (const r of rows) {
    const signature = JSON.stringify(headers.map((h) => r[h]));
    if (exact.has(signature)) exactDuplicates++;
    exact.add(signature);
    const id = r["Name/Member ID"];
    const old = people.get(id) || {};
    const next = { ...old };
    for (const field of headers.filter(
      (h) =>
        h.startsWith("Name/") ||
        ["Gender", "Is Client", "Within Boundary"].includes(h),
    )) {
      if (!variants.has(field)) variants.set(field, new Map());
      const fieldVariants = variants.get(field);
      if (!fieldVariants.has(id)) fieldVariants.set(id, new Set());
      if (r[field]) {
        fieldVariants.get(id).add(r[field]);
        next[field] = r[field];
      }
    }
    people.set(id, next);
    const s = parseSession(r["Session Detail"]);
    sessions.set(JSON.stringify([r["Activity Name"], s.date, s.start, s.end]), {
      ...s,
      domain: r["AAP Domain"],
    });
  }
  const participants = [...people.values()];
  const count = (field) =>
    Object.fromEntries(
      [...new Set(participants.map((p) => p[field] || "(missing)"))]
        .sort()
        .map((v) => [
          v,
          participants.filter((p) => (p[field] || "(missing)") === v).length,
        ]),
    );
  const parsed = parseRows(matrix);
  parsed.mode = "merge";
  const inspection = inspectImport(parsed, {
    participants: [],
    programmes: [],
    sessions: [],
    attendance: [],
  });
  const app = analytics(
    {
      participants: [
        ...new Map(
          inspection.fresh.map((r) => [r.participant.id, r.participant]),
        ).values(),
      ],
      programmes: [
        ...new Map(
          inspection.fresh.map((r) => [r.programme.id, r.programme]),
        ).values(),
      ],
      sessions: [
        ...new Map(
          inspection.fresh.map((r) => [r.session.id, r.session]),
        ).values(),
      ],
      attendance: inspection.fresh.map((r) => ({
        id: r.id,
        participantId: r.participant.id,
        sessionId: r.session.id,
      })),
    },
    defaults,
    {},
    todaySG(),
  );
  const dates = [...sessions.values()].map((s) => s.date).sort();
  return {
    source: {
      file: path.split(/[\\/]/).at(-1),
      headers,
      rawRows: rows.length,
      participants: participants.length,
      seniors: participants.filter(
        (p) => Number(p["Name/Age"]) >= 60 && p["Name/Age"],
      ).length,
      maleSeniors: participants.filter(
        (p) =>
          Number(p["Name/Age"]) >= 60 && p.Gender?.toUpperCase() === "MALE",
      ).length,
      programmes: new Set(rows.map((r) => r["Activity Name"])).size,
      sessions: sessions.size,
      exactDuplicates,
      from: dates[0],
      to: dates.at(-1),
      risk: count("Name/Social Risk Factor(s)"),
      living: count("Name/Current Living Arrangement"),
      marital: count("Name/Marital Status"),
      cfs: count("Name/CFS"),
      domainSessions: Object.fromEntries(
        [...new Set([...sessions.values()].map((s) => s.domain))]
          .sort()
          .map((d) => [
            d,
            [...sessions.values()].filter((s) => s.domain === d).length,
          ]),
      ),
      conflictingProfiles: Object.fromEntries(
        [...variants].map(([field, members]) => [
          field,
          [...members.values()].filter((v) => v.size > 1).length,
        ]),
      ),
    },
    application: {
      parsedRows: parsed.rows.length,
      invalid: parsed.issues.length,
      deduplicatedAttendance: inspection.fresh.length,
      skipped: inspection.conflicts.filter((c) => c.action !== "update").length,
      participants: app.summary.allAges,
      seniors: app.summary.unique,
      maleSeniors: app.summary.male,
      programmes: app.summary.programmes,
      sessions: app.summary.sessions,
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv[2])
    throw Error(
      "Provide an attendance workbook path. This command only reads the source.",
    );
  console.log(JSON.stringify(await reconcileNeeds(process.argv[2]), null, 2));
}
