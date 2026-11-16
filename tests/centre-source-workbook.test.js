import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readMatrix } from "../server/domain.js";
import { readData } from "../server/db.js";
import { classifyMatrix } from "../server/centre-imports.js";
import { CENTRES } from "../shared/centres.js";
import { centreQaFixture } from "../scripts/centre-qa-fixture.mjs";

const source =
  process.env.CENTRE_ATTENDANCE_WORKBOOK ||
  resolve(homedir(), "Downloads/member_attendances_20261116163550.xlsx");
test(
  "16 November source workbook reconciles independently, imports only into GLOW Bukit Batok and is idempotent",
  { skip: !existsSync(source) },
  async (t) => {
    const buffer = readFileSync(source),
      digest = (data) => createHash("sha256").update(data).digest("hex"),
      before = digest(buffer);
    const matrix = await readMatrix(buffer, source),
      headers = matrix[0],
      at = (label) => headers.indexOf(label),
      raw = matrix
        .slice(1)
        .filter((r) => r.some((v) => String(v ?? "").trim()));
    // Independent source controls: no application IDs or classifier in these counts.
    assert.equal(raw.length, 3610);
    assert.equal(
      raw.length - new Set(raw.map((r) => JSON.stringify(r))).size,
      1,
    );
    assert.equal(
      new Set(raw.map((r) => String(r[at("Name/Member ID")]).trim())).size,
      426,
    );
    assert.equal(
      new Set(raw.map((r) => String(r[at("Activity Name")]).trim())).size,
      122,
    );
    assert.equal(
      new Set(
        raw.map((r) =>
          JSON.stringify([
            String(r[at("Activity Name")]).trim(),
            String(r[at("Session Detail")]).trim(),
          ]),
        ),
      ).size,
      385,
    );
    assert.deepEqual(
      [...new Set(raw.map((r) => r[at("Centres")]))],
      ["Tzu Chi SEEN @ Bukit Batok"],
    );
    assert.equal(
      raw.filter((r) =>
        String(r[at("Activity Name")]).trim().startsWith("GLOW_"),
      ).length,
      113,
    );
    const classified = classifyMatrix(matrix);
    assert.equal(classified.unclassified, 0);
    assert.deepEqual(classified.counts, {
      glow_bukit_batok: 3610,
      seen_bukit_batok: 0,
      glow_nanyang: 0,
      seen_nanyang: 0,
    });
    const fixture = await centreQaFixture(),
      server = fixture.app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    const request = (path, body) =>
      fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          ...(body !== undefined && !(body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
    const preview = async () => {
      const form = new FormData();
      form.append(
        "file",
        new Blob([buffer]),
        "member_attendances_20261116163550.xlsx",
      );
      const r = await request("/api/import/preview?mode=merge", form),
        p = await r.json();
      assert.equal(r.status, 200, JSON.stringify(p));
      return p;
    };
    try {
      const p = await preview();
      assert.equal(p.rawRows, 3610);
      assert.equal(p.ready, 3609);
      assert.equal(p.duplicates, 1);
      assert.equal(p.exactDuplicates, 1);
      assert.equal(p.invalid, 0);
      assert.equal(p.unclassified, 0);
      assert.deepEqual(p.centreCounts, classified.counts);
      assert.equal(p.centreSummaries.glow_bukit_batok.ready, 3609);
      const inspected = await (
        await request(
          "/api/centres/import/rows?" +
            new URLSearchParams({
              id: p.id,
              centreId: "glow_bukit_batok",
              page: "2",
            }),
        )
      ).json();
      assert.equal(inspected.rows.length, 25);
      assert.equal(inspected.total, 3610);
      assert.equal(inspected.pages, 145);
      assert.equal(inspected.rows[0].row, 27);
      assert.ok(
        inspected.rows.every(
          (r) => r.location === "Tzu Chi SEEN @ Bukit Batok",
        ),
      );
      assert.equal(JSON.stringify(inspected).includes("participantId"), false);
      const response = await request("/api/import/confirm", {
          id: p.id,
          confirmed: true,
        }),
        receipt = await response.json();
      assert.equal(response.status, 200, JSON.stringify(receipt));
      assert.equal(receipt.imported, 3609);
      assert.deepEqual(Object.keys(receipt.centres), ["glow_bukit_batok"]);
      const data = readData(fixture.db);
      assert.equal(data.attendance.length, 3609);
      assert.equal(data.participants.length, 426);
      assert.equal(data.programmes.length, 122);
      assert.equal(data.sessions.length, 385);
      assert.ok(data.participants.every((p) => p.client === null));
      assert.equal(
        fixture.db.prepare("SELECT COUNT(*) n FROM member_registry").get().n,
        0,
      );
      for (const session of data.sessions) {
        const row = classified.parsed.rows.find(
          (r) => r.session.id === session.id,
        );
        assert.equal(
          session.optional.centreClassification.centreId,
          "glow_bukit_batok",
        );
        assert.equal(
          session.optional.centreClassification.locationRaw,
          "Tzu Chi SEEN @ Bukit Batok",
        );
        assert.equal(
          session.optional.centreClassification.activityRaw,
          row.session.optional.centreClassification.activityRaw,
        );
        assert.equal(
          session.optional.eventTypeRaw,
          row.session.optional.eventTypeRaw,
        );
        assert.deepEqual(
          session.optional.eventTypes,
          row.session.optional.eventTypes,
        );
      }
      const dashboard = await (
        await request("/api/dashboard?centre=glow_bukit_batok")
      ).json();
      assert.equal(dashboard.summary.attendance, 3609);
      assert.equal(dashboard.summary.allAges, 426);
      for (const c of CENTRES.slice(1)) {
        const empty = await (
          await request("/api/dashboard?centre=" + c.id)
        ).json();
        assert.equal(empty.summary.attendance, 0);
        const db = await fixture.app.platform.workspaces.get(c.id);
        assert.equal(readData(db).attendance.length, 0);
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM member_registry").get().n,
          0,
        );
      }
      const repeat = await preview();
      assert.equal(repeat.ready, 0);
      assert.equal(repeat.duplicates, 3610);
      assert.equal(readData(fixture.db).attendance.length, 3609);
      assert.equal(
        fixture.control.prepare("SELECT COUNT(*) n FROM attendance").get().n,
        0,
      );
      assert.equal(digest(readFileSync(source)), before);
      t.diagnostic(
        "Read-only source: 3,610 raw rows; 1 exact duplicate; 3,609 imported; 426 participants; 122 programmes; 385 sessions. All GLOW Bukit Batok. Re-upload inserts 0. Isolated memory stores only.",
      );
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await fixture.close();
    }
  },
);
