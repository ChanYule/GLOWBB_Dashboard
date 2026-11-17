import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { readMatrix, HEADERS } from "../server/domain.js";
import { MAX_IMPORT_ROWS, MAX_IMPORT_BYTES } from "../shared/upload-limits.js";
import { centreQaFixture } from "../scripts/centre-qa-fixture.mjs";
const line =
  'fixture,MALE,65,MALAY,4,Yes,Yes,GLOW Movement,Physical,"2026-11-01, 09:00 AM - 10:00 AM"\r\n';
test("attendance CSV accepts 100,000 rows and rejects the next row with an actionable message", async () => {
  const bytes = Buffer.from(
    HEADERS.join(",") + "\r\n" + line.repeat(MAX_IMPORT_ROWS),
  );
  assert.ok(bytes.length < MAX_IMPORT_BYTES);
  const rows = await readMatrix(bytes, "boundary.csv");
  assert.equal(rows.length, MAX_IMPORT_ROWS + 1);
  await assert.rejects(
    () => readMatrix(Buffer.concat([bytes, Buffer.from(line)]), "too-many.csv"),
    /Maximum 100,000 attendance rows per upload/,
  );
});
test("XLSX accepts rows above the former limit with values and headers intact", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Attendance");
  sheet.addRow(HEADERS);
  sheet.getRow(50002).values = [
    "fixture",
    "MALE",
    65,
    "MALAY",
    "4",
    "Yes",
    "Yes",
    "GLOW Movement",
    "Physical",
    "2026-11-01, 09:00 AM - 10:00 AM",
  ];
  const rows = await readMatrix(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "above-old-limit.xlsx",
  );
  assert.equal(rows.length, 50002);
  assert.deepEqual(rows[0], HEADERS);
  assert.equal(rows.at(-1)[0], "fixture");
});
test("multi-centre preview preserves specific reader errors and never saves rejected attendance", async () => {
  const f = await centreQaFixture(),
    server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const preview = async (bytes, name) => {
    const form = new FormData();
    form.append("file", new Blob([bytes]), name);
    const response = await fetch(origin + "/api/import/preview?mode=merge", {
      method: "POST",
      headers: { Origin: origin },
      body: form,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const tooMany = await preview(
      HEADERS.join(",") + "\r\n" + line.repeat(MAX_IMPORT_ROWS + 1),
      "too-many.csv",
    );
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /Maximum 100,000 attendance rows/);
    const corrupt = await preview("PKinvalid archive", "broken.xlsx");
    assert.equal(corrupt.status, 400);
    assert.match(corrupt.body.error, /Attendance file could not be read/);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM attendance").get().n,
      0,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await f.close();
  }
});

test("large preview responses stay bounded and every warning remains downloadable with revision checks", async () => {
  const f = await centreQaFixture(),
    server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([
        HEADERS.concat("Centres").join(",") +
          "\r\n" +
          (line.trimEnd() + ",Bukit Batok\r\n").repeat(1100),
      ]),
      "warnings.csv",
    );
    const res = await fetch(origin + "/api/import/preview?mode=merge", {
        method: "POST",
        headers: { Origin: origin },
        body: form,
      }),
      p = await res.json();
    assert.equal(res.status, 200, JSON.stringify(p));
    assert.ok(p.issueCount > 1000);
    assert.equal(p.issues.length, 100);
    assert.equal(p.rawRows, 1100);
    let seen = 0,
      pages = 1;
    for (let page = 1; page <= pages; page++) {
      const response = await fetch(
          origin +
            "/api/centres/import/issues?" +
            new URLSearchParams({
              id: p.id,
              page: String(page),
              revision: String(p.classificationRevision),
            }),
        ),
        result = await response.json();
      assert.equal(response.status, 200);
      assert.ok(result.issues.length <= 1000);
      seen += result.issues.length;
      pages = result.pages;
    }
    assert.equal(seen, p.issueCount);
    const stale = await fetch(
      origin +
        "/api/centres/import/issues?" +
        new URLSearchParams({ id: p.id, revision: "999" }),
    );
    assert.equal(stale.status, 409);
    assert.equal(f.db.prepare("SELECT count(*) n FROM attendance").get().n, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await f.close();
  }
});
