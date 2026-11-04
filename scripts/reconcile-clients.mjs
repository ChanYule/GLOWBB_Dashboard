import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readMatrix, readFile, defaults } from "../server/domain.js";
import {
  parseClientRegistry,
  clientReport,
  CLIENT_SNAPSHOT,
} from "../server/client-domain.js";
export async function reconcileClients(registryPath, attendancePath) {
  const matrix = await readMatrix(readFileSync(registryPath), registryPath, [
    "Member ID",
  ]);
  const raw = matrix
    .slice(1)
    .filter((r) => r.some((v) => String(v ?? "").trim()))
    .map((r) =>
      Object.fromEntries(
        matrix[0].map((h, i) => [String(h).trim(), String(r[i] ?? "").trim()]),
      ),
    );
  const attendanceMatrix = await readMatrix(
    readFileSync(attendancePath),
    attendancePath,
  );
  const a = attendanceMatrix
    .slice(1)
    .filter((r) => r.some((v) => String(v ?? "").trim()))
    .map((r) =>
      Object.fromEntries(
        attendanceMatrix[0].map((h, i) => [
          String(h).trim(),
          String(r[i] ?? "").trim(),
        ]),
      ),
    );
  const attendanceIds = new Set(a.map((r) => r["Name/Member ID"])),
    ids = new Set(raw.map((r) => r["Member ID"])),
    matched = raw.filter((r) => attendanceIds.has(r["Member ID"]));
  const grouped = (field) =>
    Object.fromEntries(
      [
        ...raw.reduce(
          (m, p) =>
            m.set(
              p[field] || "Missing",
              (m.get(p[field] || "Missing") || 0) + 1,
            ),
          new Map(),
        ),
      ].sort(),
    );
  const parsed = parseClientRegistry(matrix),
    attendance = await readFile(readFileSync(attendancePath), attendancePath);
  const unique = (key) => [
    ...new Map(attendance.rows.map((r) => [r[key].id, r[key]])).values(),
  ];
  const people = new Map(unique("participant").map((p) => [p.id, p]));
  for (const p of parsed.rows) if (!people.has(p.id)) people.set(p.id, p);
  const data = {
    participants: [...people.values()],
    programmes: unique("programme"),
    sessions: unique("session").map((s) => ({
      ...s,
      programmeId: s.programmeId,
    })),
    attendance: [
      ...new Map(
        attendance.rows.map((r) => [
          r.id,
          {
            id: r.id,
            participantId: r.participant.id,
            sessionId: r.session.id,
          },
        ]),
      ).values(),
    ],
  };
  const state = {
    data,
    profiles: [],
    feedback: [],
    registry: parsed.rows.map((p) => ({
      participant_id: p.id,
      snapshot: CLIENT_SNAPSHOT,
      details: JSON.stringify({ ...p, membershipStatus: "Active" }),
    })),
    settings: {
      ...defaults,
      registry: {
        type: "clients",
        snapshot: CLIENT_SNAPSHOT,
        asOf: "2026-11-03",
        complete: true,
      },
    },
  };
  const report = clientReport(state, {}, "2026-11-03");
  return {
    source: {
      registryRows: raw.length,
      uniqueClients: ids.size,
      attending: matched.length,
      noAttendance: ids.size - matched.length,
      otherAttenders: [...attendanceIds].filter((id) => !ids.has(id)).length,
      living: grouped("Current Living Arrangement"),
      gender: grouped("Gender"),
      cfs: grouped("CFS"),
      risk: grouped("Social Risk Factor(s)"),
      blocks: new Set(raw.map((p) => p["Block / Building No."])).size,
      livingAloneAttending: matched.filter(
        (p) => p["Current Living Arrangement"] === "Alone",
      ).length,
      maleAttending: matched.filter((p) => p.Gender === "MALE").length,
      allClientsYes: raw.every((p) => p["Is Client"].toUpperCase() === "YES"),
      allWithinBoundary: raw.every(
        (p) => p["Within Boundary"].toUpperCase() === "YES",
      ),
      attendanceRaw: a.length,
      deduplicated: data.attendance.length,
      programmes: data.programmes.length,
      sessions: data.sessions.length,
    },
    application: {
      summary: report.summary,
      living: report.groups.living.rows,
      gender: report.groups.gender.rows,
      coverage: report.coverage,
    },
    issues: parsed.issues,
    duplicates: parsed.duplicates,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2] || !process.argv[3])
    throw Error("Provide the registry and attendance workbook paths.");
  console.log(
    JSON.stringify(
      await reconcileClients(process.argv[2], process.argv[3]),
      null,
      2,
    ),
  );
}
