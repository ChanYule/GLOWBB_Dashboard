import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { openPostgres } from "../server/postgres.js";
import { createPlatformApp } from "../server/platform.js";
import { HEADERS } from "../server/domain.js";

test("PostgreSQL centre schemas isolate all existing stores and remain private; reviewed imports survive adapter boundaries", async () => {
  const engine = new PGlite();
  await engine.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of [
    "001_dashboard.sql",
    "002_operations.sql",
    "003_personal_analysis.sql",
    "004_needs_based.sql",
    "005_locations.sql",
  ])
    await engine.exec(
      await readFile(
        new URL("../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  const query = async (sql, values) => {
    if (!values && sql.includes(";")) {
      const r = await engine.exec(sql),
        last = r.at(-1);
      return { rows: last?.rows || [], rowCount: last?.affectedRows || 0 };
    }
    const r = await engine.query(sql, values);
    return { rows: r.rows, rowCount: r.affectedRows };
  };
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      let release;
      const next = new Promise((r) => {
        release = r;
      });
      const old = tail;
      tail = next;
      await old;
      return { query, release };
    },
    async query(sql, values) {
      const c = await this.connect();
      try {
        return await c.query(sql, values);
      } finally {
        c.release();
      }
    },
    end: () => engine.close(),
  };
  const control = openPostgres(undefined, { pool }),
    app = createPlatformApp(control, { authRequired: false });
  await app.platform.ready;
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (path, body) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
  try {
    const row = [
      "opaque-id",
      "MALE",
      65,
      "MALAY",
      "4",
      "YES",
      "YES",
      "GLOW Movement",
      "Physical",
      "2026-11-01, 09:00 AM - 10:00 AM",
    ];
    const matrix = [
      [...HEADERS, "Centres"],
      [...row, "Tzu Chi SEEN @ Bukit Batok"],
      [...row, "Tzu Chi SEEN @ Nanyang"],
    ];
    const csvBuffer = Buffer.from(
      matrix.map((r) => r.map((v) => '"' + v + '"').join(",")).join("\r\n"),
    );
    const begin = await request("/api/centres/uploads", {
        name: "two-centres.csv",
        size: csvBuffer.length,
        target: "/api/import/preview?mode=merge",
      }),
      upload = await begin.json();
    assert.equal(begin.status, 200, JSON.stringify(upload));
    const chunk = await fetch(
      origin + "/api/centres/uploads/" + upload.id + "/chunks/0",
      {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ data: csvBuffer.toString("base64") }),
      },
    );
    assert.equal(chunk.status, 200, await chunk.text());
    const pResponse = await request("/api/import/preview?mode=merge", {
        uploadId: upload.id,
      }),
      p = await pResponse.json();
    assert.equal(pResponse.status, 200, JSON.stringify(p));
    assert.equal(p.ready, 2);
    assert.equal(
      (
        await fetch(origin + "/api/centres/uploads/" + upload.id, {
          method: "DELETE",
          headers: { Origin: origin },
        })
      ).status,
      200,
    );
    const confirmed = await request("/api/import/confirm", {
      id: p.id,
      confirmed: true,
    });
    assert.equal(
      confirmed.status,
      200,
      JSON.stringify(await confirmed.clone().json()),
    );
    for (const id of ["glow_bukit_batok", "glow_nanyang"]) {
      const response = await request("/api/dashboard?centre=" + id),
        r = await response.json();
      assert.equal(response.status, 200, JSON.stringify(r));
      assert.equal(r.summary.unique, 1);
      assert.equal(r.centre.id, id);
    }
    assert.equal(
      (
        await control
          .prepare("SELECT count(*)::integer n FROM attendance")
          .get()
      ).n,
      0,
    );
    assert.equal(
      (
        await engine.query(
          "SELECT count(*)::integer n FROM centre_glow_bukit_batok.attendance",
        )
      ).rows[0].n,
      1,
    );
    // Configuration approvals use the same private per-centre settings and retain source rows.
    const cfg = await (await request('/api/configuration?centre=glow_bukit_batok')).json();
    const proposalResponse=await request('/api/configuration/preview?centre=glow_bukit_batok', {operation:'rule',version:cfg.configuration.version,reason:'Reviewed PostgreSQL attendance policy',rule:{scope:'official',selector:{type:'name',value:'GLOW Movement'}}});
    const proposal=await proposalResponse.json();assert.equal(proposalResponse.status,200,JSON.stringify(proposal));
    const approval=await request('/api/configuration/confirm?centre=glow_bukit_batok',{id:proposal.id,confirmed:true,bulkConfirmed:true});assert.equal(approval.status,200,await approval.text());
    assert.equal((await(await request('/api/dashboard?centre=glow_bukit_batok')).json()).summary.attendance,0);
    assert.equal((await(await request('/api/dashboard?centre=glow_nanyang')).json()).summary.attendance,1);
    assert.equal((await engine.query('SELECT count(*)::integer n FROM centre_glow_bukit_batok.attendance')).rows[0].n,1);
    assert.equal((await(await request('/api/configuration/history?centre=glow_bukit_batok')).json()).rows[0].details.after.reporting.version,2);
    await engine.exec("SET ROLE anon;");
    await assert.rejects(() =>
      engine.query("SELECT * FROM centre_glow_nanyang.attendance"),
    );
    await engine.exec("RESET ROLE;");
    const client = await request("/api/clients/report?centre=glow_nanyang", {});
    assert.equal(client.status, 200);
    assert.equal((await client.json()).complete, false);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await control.close();
  }
});
