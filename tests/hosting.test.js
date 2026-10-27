import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tsImport } from "tsx/esm/api";
import { createProxy } from "../api/[...path].js";
const { api } = await tsImport("../src/api.ts", import.meta.url);
async function withProxy(options, check) {
  const server = createServer(createProxy(options));
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    await check("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
async function withFetch(fn, check) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    await check();
  } finally {
    globalThis.fetch = original;
  }
}
test("missing Vercel backend returns useful JSON instead of a page response", async () => {
  await withProxy({}, async (base) => {
    const r = await fetch(base + "/api/dashboard");
    assert.equal(r.status, 503);
    assert.match(r.headers.get("content-type"), /application\/json/);
    assert.match((await r.json()).error, /DASHBOARD_BACKEND_URL/);
  });
});
test("Vercel proxy forwards reporting filters, status, JSON and no-cache headers", async () => {
  let target;
  await withProxy(
    {
      backendUrl: "https://backend.example",
      fetchImpl: async (url) => {
        target = String(url);
        return Response.json({ summary: { unique: 7 } });
      },
    },
    async (base) => {
      const r = await fetch(
        base + "/api/dashboard?from=2026-05-01&target=male",
      );
      assert.equal(r.status, 200);
      assert.equal((await r.json()).summary.unique, 7);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(
        target,
        "https://backend.example/api/dashboard?from=2026-05-01&target=male",
      );
    },
  );
});
test("Vercel proxy preserves mutations and upload bytes with the original origin", async () => {
  const calls = [];
  await withProxy(
    {
      backendUrl: "https://backend.example",
      fetchImpl: async (url, options) => {
        calls.push(options);
        return Response.json({ ok: true });
      },
    },
    async (base) => {
      await fetch(base + "/api/targets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://glowbbdashboard.vercel.app",
        },
        body: JSON.stringify({ value: 50 }),
      });
      assert.equal(JSON.parse(calls[0].body.toString()).value, 50);
      assert.equal(
        calls[0].headers.get("origin"),
        "https://glowbbdashboard.vercel.app",
      );
      const form = new FormData();
      form.append("file", new Blob(["test file bytes"]), "attendance.csv");
      await fetch(base + "/api/import/preview", { method: "POST", body: form });
      assert.match(
        calls[1].headers.get("content-type"),
        /multipart\/form-data; boundary=/,
      );
      assert.ok(calls[1].body.toString().includes("test file bytes"));
    },
  );
});
test("Vercel proxy rejects backend redirects and HTML API fallbacks without leaking their contents", async () => {
  for (const response of [
    new Response("private upstream text", {
      status: 404,
      headers: { "content-type": "text/html" },
    }),
    new Response(null, {
      status: 302,
      headers: { location: "https://other.example" },
    }),
  ])
    await withProxy(
      {
        backendUrl: "https://backend.example",
        fetchImpl: async () => response,
      },
      async (base) => {
        const r = await fetch(base + "/api/dashboard");
        assert.equal(r.status, 502);
        assert.equal(
          JSON.stringify(await r.json()).includes("private upstream"),
          false,
        );
      },
    );
});
test("Vercel proxy permits print reports and CSV attachments and handles network failure", async () => {
  for (const [path, type] of [
    ["report", "text/html"],
    ["csv", "text/csv"],
  ])
    await withProxy(
      {
        backendUrl: "https://backend.example",
        fetchImpl: async () =>
          new Response("report contents", {
            headers: {
              "content-type": type,
              "content-disposition": "attachment; filename=report.csv",
            },
          }),
      },
      async (base) => {
        const r = await fetch(base + "/api/export/" + path);
        assert.equal(await r.text(), "report contents");
        assert.equal(r.headers.get("content-type"), type);
      },
    );
  await withProxy(
    {
      backendUrl: "https://backend.example",
      fetchImpl: async () => {
        throw Error("secret error");
      },
    },
    async (base) => {
      const r = await fetch(base + "/api/dashboard");
      assert.equal(r.status, 502);
      assert.equal((await r.text()).includes("secret"), false);
    },
  );
});
test("Vercel proxy rejects invalid configuration and oversized bodies", async () => {
  for (const backendUrl of [
    "http://backend.example",
    "https://user:pass@backend.example",
    "https://backend.example/unexpected",
  ])
    await withProxy({ backendUrl }, async (base) =>
      assert.equal((await fetch(base + "/api/dashboard")).status, 503),
    );
  await withProxy(
    {
      backendUrl: "https://backend.example",
      fetchImpl: async () => {
        throw Error("should not forward");
      },
    },
    async (base) => {
      const r = await fetch(base + "/api/import/preview", {
        method: "POST",
        body: Buffer.alloc(4 * 1024 * 1024 + 1),
      });
      assert.equal(r.status, 413);
    },
  );
});
test("client handles the exact Vercel text 404 and malformed JSON cleanly", async () => {
  await withFetch(
    async () =>
      new Response("The page could not be found\nNOT_FOUND", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
    async () =>
      assert.rejects(
        api("/api/dashboard"),
        (e) =>
          e.message.includes("not deployed or connected") &&
          !e.message.includes("Unexpected token"),
      ),
  );
  await withFetch(
    async () =>
      new Response("broken json", {
        headers: { "content-type": "application/json" },
      }),
    async () => assert.rejects(api("/api/dashboard"), /unreadable response/),
  );
});
test("client preserves API errors and handles lost connections", async () => {
  await withFetch(
    async () =>
      Response.json(
        { error: "The dashboard backend is not connected yet." },
        { status: 503 },
      ),
    async () =>
      assert.rejects(api("/api/dashboard"), /backend is not connected/),
  );
  await withFetch(
    async () => {
      throw TypeError("Failed to fetch");
    },
    async () => assert.rejects(api("/api/dashboard"), /Unable to connect/),
  );
  await withFetch(
    async () => Response.json({ summary: { unique: 0 } }),
    async () => assert.equal((await api("/api/dashboard")).summary.unique, 0),
  );
});
