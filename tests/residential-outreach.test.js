import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResidence,
  targetArea,
} from "../server/residential-outreach.js";
import { HEADERS, parseRows } from "../server/domain.js";
import { classifyCentre } from "../shared/centres.js";

test("residential matching accepts approved formats and rejects unresolved or out-of-area addresses", () => {
  const match = (block, street) =>
    targetArea(normalizeResidence(block, street));
  assert.equal(match(" BLK 987 a ", "jurong west St. 91"), "900");
  assert.equal(match("710c", "jurong west street 71"), "701");
  for (const [block, street] of [
    ["987A", "Jurong West Steer 91"],
    ["987A", "Jurong West Street 71"],
    ["711", "Jurong West Street 71"],
    ["701", "Bukit Batok Street 71"],
    ["unit 701", "Jurong West Street 71"],
    ["701", ""],
  ])
    assert.equal(match(block, street), null);
});

test("new attendance columns preserve residential evidence without changing attendance identity", () => {
  const row = [
    "test-member",
    "FEMALE",
    67,
    "MALAY",
    "4",
    "YES",
    "YES",
    "GLOW Movement",
    "Physical",
    "2026-01-04, 09:00 AM - 10:00 AM",
  ];
  const old = parseRows([HEADERS, row]).rows[0];
  const current = parseRows([
    [...HEADERS, "Name/Block / Building No.", "Name/Street Name"],
    [...row, "987a", "Jurong West St 91"],
  ]).rows[0];
  assert.equal(current.id, old.id);
  assert.equal(current.participant.id, old.participant.id);
  assert.equal(current.participant.residentialBlockRaw, "987a");
  assert.equal(
    JSON.parse(current.residentialObservation).street,
    "Jurong West St 91",
  );
  assert.equal(
    classifyCentre("Tzu Chi SEEN @ Nanyang", "GLOW Movement").centreId,
    "glow_nanyang",
  );
  assert.equal(
    classifyCentre("Tzu Chi SEEN @ Nanyang", "SEEN Movement").centreId,
    "seen_nanyang",
  );
});

test("targeted outreach rejects other centres and counts only the GLOW Nanyang workspace", async () => {
  const { centreQaFixture } = await import("../scripts/centre-qa-fixture.mjs");
  const { mirrorUser } = await import("../server/centre-store.js");
  const { readData, saveImport } = await import("../server/db.js");
  const { inspectImport } = await import("../server/domain.js");
  const fixture = await centreQaFixture();
  const server = fixture.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const actor = fixture.control
      .prepare("SELECT id,username,role FROM users WHERE username=?")
      .get("__local_workspace__");
    for (const centre of ["glow_nanyang", "seen_nanyang"]) {
      const db = await fixture.app.platform.workspaces.get(centre);
      await mirrorUser(db, actor);
      const rows = Array.from({ length: 6 }, (_, i) => [
        "member-" + i,
        "FEMALE",
        67,
        "MALAY",
        "4",
        "YES",
        "YES",
        centre === "glow_nanyang" ? "GLOW Movement" : "SEEN Movement",
        "Physical",
        "2026-01-04, 09:00 AM - 10:00 AM",
        "987A",
        "Jurong West Street 91",
      ]);
      const parsed = parseRows([
        [...HEADERS, "Name/Block / Building No.", "Name/Street Name"],
        ...rows,
      ]);
      saveImport(db, parsed, inspectImport(parsed, readData(db)), actor.id);
    }
    for (const centre of [
      "glow_bukit_batok",
      "seen_bukit_batok",
      "seen_nanyang",
    ]) {
      assert.equal(
        (await fetch(origin + "/api/residential-outreach?centre=" + centre))
          .status,
        403,
      );
    }
    const url = origin + "/api/residential-outreach?centre=glow_nanyang";
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const report = await response.json();
    const area = report.groups.find((group) => group.id === "900");
    assert.equal(area.summary.attendance, 6);
    assert.equal(area.summary.seniors, 6);
    assert.equal(JSON.stringify(report).includes("member-"), false);
    assert.match(
      await (await fetch(url + "&format=print")).text(),
      /Targeted Residential Outreach/,
    );
    const general = await (
      await fetch(origin + "/api/residential-distribution?centre=seen_nanyang")
    ).json();
    assert.equal(general.streets[0].residents, 6);
    assert.equal(general.groups, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
  }
});
