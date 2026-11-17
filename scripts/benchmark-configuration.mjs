import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { analytics, defaults } from "../server/domain.js";
import { projectReportingData } from "../server/reporting-policy.js";
// Reproducible synthetic benchmark; never opens a saved database.
const data = {
  participants: Array.from({ length: 1000 }, (_, i) => ({
    id: "p" + i,
    age: 60 + (i % 35),
    gender: i % 2 ? "MALE" : "FEMALE",
    race: i % 3 ? "CHINESE" : "MALAY",
    client: true,
    boundary: true,
  })),
  programmes: Array.from({ length: 100 }, (_, i) => ({
    id: "g" + i,
    name: "Synthetic activity " + i,
    domain: ["Physical", "Social", "Learning"][i % 3],
  })),
  sessions: [],
  attendance: [],
};
for (let g = 0; g < 100; g++)
  for (let d = 0; d < 10; d++) {
    const id = "s" + g + "-" + d;
    data.sessions.push({
      id,
      programmeId: "g" + g,
      date: "2026-10-" + String(d + 1).padStart(2, "0"),
      start: 540,
      end: 600,
      optional: {},
    });
    for (let j = 0; j < 20; j++)
      data.attendance.push({
        id: id + "-" + j,
        participantId: "p" + ((g * 10 + j + d) % 1000),
        sessionId: id,
      });
  }
const settings = {
    ...defaults,
    reporting: {
      version: 2,
      rules: [
        {
          id: "reviewed",
          scope: "official",
          enabled: true,
          status: "Approved",
          approvedIds: data.programmes.slice(0, 20).map((p) => p.id),
          from: "",
          to: "",
        },
      ],
    },
  },
  context = { settings, mode: "official" };
const measure = (fn) => {
  const ms = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    fn();
    if (i >= 3) ms.push(performance.now() - start);
  }
  return Math.round(ms.sort((a, b) => a - b)[3] * 100) / 100;
};
const period = { from: "2026-10-01", to: "2026-10-31" },
  baseline = measure(() => analytics(data, defaults, period, "2026-11-17")),
  projection = measure(() => projectReportingData(data, context)),
  approved = measure(() =>
    analytics(
      projectReportingData(data, context),
      settings,
      period,
      "2026-11-17",
    ),
  );
const result = {
  syntheticOnly: true,
  participants: 1000,
  programmes: 100,
  sessions: 1000,
  attendance: 20000,
  excludedProgrammes: 20,
  iterations: 7,
  baselineAnalyticsMedianMs: baseline,
  policyProjectionMedianMs: projection,
  approvedAnalyticsIncludingProjectionMedianMs: approved,
  rawAttendanceAfter: data.attendance.length,
  eligibleAttendance: projectReportingData(data, context).attendance.length,
  note: "Local medians after three warmups. Approved reporting has fewer rows, so total timing is not a speedup claim. No hosted performance or connector test.",
};
mkdirSync("data/configuration-qa", { recursive: true });
writeFileSync(
  "data/configuration-qa/performance.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
