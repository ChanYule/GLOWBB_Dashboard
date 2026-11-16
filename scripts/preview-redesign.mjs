// Isolated, synthetic browser-QA fixture. Never opens a local or hosted database.
import express from "express";
import { readFileSync } from "node:fs";
import { centreQaFixture } from "./centre-qa-fixture.mjs";
import { readData, saveImport } from "../server/db.js";
import { HEADERS, parseRows, inspectImport } from "../server/domain.js";
const fixture=await centreQaFixture();
const {db,app}=fixture;
const actor = db
  .prepare("SELECT id FROM users WHERE username=?")
  .get("__local_workspace__").id;
const rows = [];
const programmes = [
  ["Move with confidence", "Physical"],
  ["Coffee & connections", "Social"],
  ["Digital discovery", "Cognitive"],
  ["Creative afternoons", "Arts"],
  ["Community conversations", "Social"],
  ["Garden together", "Physical"],
];
for (let month = 4; month <= 10; month++) {
  for (let day = 1; day <= 24; day += 3) {
    const p = programmes[(day + month) % programmes.length];
    for (let i = 0; i < 9 + month; i++) {
      const person = (i + day * 3 + month * 5) % 80;
      rows.push([
        `SYNTHETIC-${person}`,
        person % 3 === 0 ? "MALE" : "FEMALE",
        String(58 + (person % 31)),
        person % 8 === 0 ? "" : person % 4 === 0 ? "MALAY" : "CHINESE",
        "",
        person % 2 ? "YES" : "NO",
        person % 5 ? "YES" : "NO",
        p[0],
        p[1],
        `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}, ${day % 2 ? "09:00 AM - 10:00 AM" : "02:00 PM - 03:30 PM"}`,
      ]);
    }
  }
}
const parsed = parseRows([HEADERS, ...rows]);
saveImport(db, parsed, inspectImport(parsed, readData(db)), actor);
app.get("/", (_req, res) =>
  res
    .type("html")
    .send(
      readFileSync("dist/index.html", "utf8").replace(
        "</head>",
        '<style>.topbar:after{content:"SYNTHETIC QA DATA";color:#9b5f09;background:#fff1ce;border-radius:5px;padding:4px 9px;font-size:10px}.topbar{flex-wrap:wrap}</style></head>',
      ),
    ),
);
app.use(express.static("dist"));
const server = app.listen(3100, "127.0.0.1", () =>
  console.log("Isolated synthetic QA preview: http://127.0.0.1:3100"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await fixture.close();
      process.exit(0);
    }),
  );
