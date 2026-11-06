import { readFileSync } from "node:fs";
import {
  readFile,
  readMatrix,
  inspectImport,
  defaults,
} from "../server/domain.js";
import {
  parseClientRegistry,
  registryHeaders,
  CLIENT_SNAPSHOT,
} from "../server/client-domain.js";
import { clientOutreach } from "../server/client-outreach.js";
const [attendancePath, registryPath] = process.argv.slice(2);
if (!attendancePath || !registryPath)
  throw Error(
    "Provide attendance and client-registry workbook paths. Source files are read only.",
  );
const parsed = await readFile(readFileSync(attendancePath), attendancePath),
  rows = inspectImport(parsed, {
    participants: [],
    programmes: [],
    sessions: [],
    attendance: [],
  }).fresh;
const registryMatrix = await readMatrix(
  readFileSync(registryPath),
  registryPath,
  Object.values(registryHeaders),
);
const clients = parseClientRegistry(registryMatrix).rows;
const participants = new Map(
  rows.map((r) => [r.participant.id, r.participant]),
);
for (const c of clients) if (!participants.has(c.id)) participants.set(c.id, c);
const sessions = [
    ...new Map(rows.map((r) => [r.session.id, r.session])).values(),
  ],
  asOf = sessions
    .map((s) => s.date)
    .sort()
    .at(-1);
const state = {
  data: {
    participants: [...participants.values()],
    programmes: [
      ...new Map(rows.map((r) => [r.programme.id, r.programme])).values(),
    ],
    sessions,
    attendance: rows.map((r) => ({
      participantId: r.participant.id,
      sessionId: r.session.id,
    })),
  },
  profiles: [],
  feedback: [],
  registry: clients.map((p) => ({
    participant_id: p.id,
    snapshot: CLIENT_SNAPSHOT,
    details: JSON.stringify(p),
  })),
  settings: {
    ...defaults,
    registry: {
      complete: false,
      type: "clients",
      snapshot: CLIENT_SNAPSHOT,
      asOf,
    },
  },
};
const report = clientOutreach(state, {
  cohort: "all",
  status: "all",
  filters: { asOf, to: asOf },
});
console.log(
  JSON.stringify(
    {
      sourceOnly: true,
      asOf,
      registryRows: clients.length,
      registryCompletenessVerified: false,
      sourceEmploymentFieldPresent: registryMatrix[0].some((h) =>
        /employment|working status|occupation/i.test(String(h)),
      ),
      ageProfile: report.ageProfile,
      groups: report.priorities,
    },
    null,
    2,
  ),
);
