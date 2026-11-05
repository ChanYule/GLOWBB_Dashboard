import { readFileSync } from "node:fs";
import {
  readFile,
  inspectImport,
  analytics,
  defaults,
} from "../server/domain.js";
import {eventTypeReport} from '../server/event-report.js';
const path = process.argv[2];
if (!path)
  throw Error("Supply an attendance workbook path. Source is read only.");
const parsed = await readFile(readFileSync(path), path);
const inspection = inspectImport(parsed, {
  participants: [],
  programmes: [],
  sessions: [],
  attendance: [],
});
const rows = inspection.fresh;
const data = {
  participants: [
    ...new Map(rows.map((r) => [r.participant.id, r.participant])).values(),
  ],
  programmes: [
    ...new Map(rows.map((r) => [r.programme.id, r.programme])).values(),
  ],
  sessions: [...new Map(rows.map((r) => [r.session.id, r.session])).values()],
  attendance: rows.map((r) => ({
    id: r.id,
    participantId: r.participant.id,
    sessionId: r.session.id,
  })),
};
const samples = [];
for (let i = 0; i < 6; i++) {
  const start = performance.now();
  analytics(data, defaults);
  if (i) samples.push(performance.now() - start);
}
const labels = new Map();
for (const s of data.sessions)
  for (const label of s.optional?.eventTypes || [])
    labels.set(label, (labels.get(label) || 0) + 1);
const eventSamples=[];for(let i=0;i<8;i++){const start=performance.now();eventTypeReport({data,settings:defaults,registry:[],profiles:[],feedback:[]});if(i)eventSamples.push(performance.now()-start);}
console.log(
  JSON.stringify(
    {
      raw: parsed.rawRows,
      deduplicated: rows.length,
      exactDuplicates: parsed.exactDuplicates,
      invalid: parsed.issues.length,
      participants: data.participants.length,
      programmes: data.programmes.length,
      sessions: data.sessions.length,
      domains: new Set(data.programmes.map((p) => p.domain)).size,
      eventTypes: Object.fromEntries(labels),
      analyticsMedianMs: samples.sort((a, b) => a - b)[2],
    eventTypeMedianMs:eventSamples.sort((a,b)=>a-b)[3],
    },
    null,
    2,
  ),
);
