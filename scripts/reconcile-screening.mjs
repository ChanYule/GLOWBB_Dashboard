// Read-only source reconciliation. Prints aggregates, never member identifiers.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  readFile,
  inspectImport,
  defaults,
  todaySG,
} from "../server/domain.js";
import { operationsReport } from "../server/operations.js";

if (!process.argv[2])
  throw Error("Usage: node scripts/reconcile-screening.mjs <attendance.xlsx>");
const bytes = readFileSync(process.argv[2]);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes);
const sheets = workbook.worksheets.filter((s) =>
  ["Name/Member ID", "Activity Name", "Session Detail"].every((h) =>
    s.getRow(1).values.slice(1).map(String).includes(h),
  ),
);
assert.equal(
  sheets.length,
  1,
  "Exactly one source attendance worksheet is required.",
);
const sheet = sheets[0],
  headers = sheet.getRow(1).values.slice(1).map(String);
const columns = Object.fromEntries(headers.map((h, i) => [h, i + 1]));
const sourceNames = {
  "GLOW - SPPB Assessment": "sppb",
  "GLOW - Tanita Body Measurement": "tanita",
  "GLOW - Tanita Body Measurements": "tanita",
};
const group = () => ({ sppb: new Set(), tanita: new Set() });
const totals = group(),
  daily = new Map(),
  monthly = new Map(),
  attendance = { sppb: 0, tanita: 0 },
  matchedNames = new Set();
const asOf = todaySG();
sheet.eachRow((row, index) => {
  if (index === 1) return;
  const activity = row.getCell(columns["Activity Name"]).text.trim(),
    type = sourceNames[activity];
  if (!type) return;
  const member = row.getCell(columns["Name/Member ID"]).text.trim();
  const date = row
    .getCell(columns["Session Detail"])
    .text.trim()
    .match(/^(\d{4}-\d{2}-\d{2}),/)?.[1];
  assert.ok(
    member && date,
    "Screening source rows must contain a member key and a date.",
  );
  if (date > asOf) return;
  if (!daily.has(date)) daily.set(date, group());
  if (!monthly.has(date.slice(0, 7))) monthly.set(date.slice(0, 7), group());
  totals[type].add(member);
  daily.get(date)[type].add(member);
  monthly.get(date.slice(0, 7))[type].add(member);
  attendance[type]++;
  matchedNames.add(activity);
});

const parsed = await readFile(bytes, "attendance.xlsx");
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
const actual = operationsReport(
  data,
  defaults,
  {},
  [],
  {},
  "month",
  asOf,
).activityScreening;
for (const type of ["sppb", "tanita"])
  assert.equal(
    actual[type].people,
    totals[type].size,
    `${type}: overall people must match raw workbook identifiers`,
  );
for (const row of actual.monthly)
  for (const type of ["sppb", "tanita"])
    assert.equal(
      row[type + "People"],
      monthly.get(row.label)?.[type].size || 0,
      `${type}: monthly mismatch in ${row.label}`,
    );
for (const [date, expected] of daily) {
  const actualDay = actual.daily.find((r) => r.label === date);
  assert.ok(
    actualDay,
    "Source screening date must be present in the application result.",
  );
  for (const type of ["sppb", "tanita"])
    assert.equal(
      actualDay[type + "People"],
      expected[type].size,
      `${type}: daily mismatch in ${date}`,
    );
}
assert.equal(
  actual.daily.length,
  daily.size,
  "Unexpected screening dates must not be introduced.",
);
console.log(
  JSON.stringify(
    {
      verified: true,
      worksheet: sheet.name,
      dataRows: parsed.rawRows,
      invalid: parsed.issues.length,
      conflicts: inspection.conflicts.length,
      duplicates: inspection.duplicates.length,
      matchedActivities: [...matchedNames],
      totals: {
        sppbPeople: totals.sppb.size,
        sppbSourceRows: attendance.sppb,
        tanitaPeople: totals.tanita.size,
        tanitaSourceRows: attendance.tanita,
      },
      monthly: actual.monthly,
      daily: actual.daily,
    },
    null,
    2,
  ),
);
