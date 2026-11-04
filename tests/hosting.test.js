import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tsImport } from "tsx/esm/api";
import { createProxy } from "../api/index.js";
const { api } = await tsImport("../src/api.ts", import.meta.url);
test("client gives actionable timeout errors for hosted JSON envelopes and plain gateway errors without leaking server details", async () => {
  for (const response of [
    Response.json(
      {
        error: {
          code: "FUNCTION_INVOCATION_TIMEOUT",
          message: "PRIVATE PROVIDER DETAIL",
        },
      },
      { status: 500 },
    ),
    new Response("PRIVATE PROVIDER DETAIL", { status: 504 }),
  ]) {
    await withFetch(
      async () => response,
      async () =>
        assert.rejects(
          api("/api/client-registry/confirm", { method: "POST" }),
          (e) =>
            /timed out.*check whether the registry was saved/i.test(
              e.message,
            ) && !e.message.includes("PRIVATE PROVIDER DETAIL"),
        ),
    );
  }
});
test("GET coalescing lasts only while pending, mutation invalidates it, and aborts remain distinguishable", async () => {
  const original = globalThis.fetch;
  let calls = 0,
    release;
  globalThis.fetch = () => {
    calls++;
    return new Promise((r) => {
      release = () => r(Response.json({ ok: true }));
    });
  };
  try {
    const first = api("/coalesce"),
      second = api("/coalesce");
    assert.equal(calls, 1);
    release();
    await Promise.all([first, second]);
    const third = api("/coalesce");
    assert.equal(calls, 2);
    release();
    await third;
    const pending = api("/session-data");
    const releaseOld = release;
    globalThis.fetch = async () => Response.json({ ok: true });
    await api("/api/logout", { method: "POST" });
    const fresh = await api("/session-data");
    assert.deepEqual(fresh, { ok: true });
    releaseOld();
    await pending;
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Cancelled", "AbortError");
    globalThis.fetch = async () => {
      throw abort;
    };
    await assert.rejects(
      api("/cancel", { signal: controller.signal }),
      (e) => e === abort,
    );
  } finally {
    globalThis.fetch = original;
  }
});
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

test("hosted upload size errors remain useful when Vercel returns plain text", async () => {
  await withFetch(
    async () =>
      new Response("FUNCTION_PAYLOAD_TOO_LARGE", {
        status: 413,
        headers: { "content-type": "text/plain" },
      }),
    async () =>
      assert.rejects(api("/api/import/preview"), /file smaller than 4 MB/),
  );
});

test("Vercel proxy forwards staff session cookies in both directions", async () => {
  let received;
  await withProxy(
    {
      backendUrl: "https://backend.example",
      fetchImpl: async (_url, options) => {
        received = options.headers.get("cookie");
        return Response.json(
          { ok: true },
          {
            headers: {
              "Set-Cookie":
                "glow_session=test; HttpOnly; Secure; SameSite=Strict; Path=/",
            },
          },
        );
      },
    },
    async (base) => {
      const r = await fetch(base + "/api/me", {
        headers: { Cookie: "glow_session=test" },
      });
      assert.equal(received, "glow_session=test");
      assert.match(r.headers.get("set-cookie"), /HttpOnly; Secure/);
    },
  );
});

test("Vercel proxy permits needs management reports and protected-route approved general CSV downloads", async () => {
  for (const [path, type] of [
    ["/api/needs/export/report", "text/html"],
    ["/api/needs/export/csv", "text/csv"],
    ["/api/clients/export/report", "text/html"],
    ["/api/clients/export/csv", "text/csv"],
    ["/api/analysis/export?group=programme&metric=unique", "text/csv"],
    ["/api/analysis/view/personal-view/export", "text/csv"],
  ])
    await withProxy(
      {
        backendUrl: "https://backend.example",
        fetchImpl: async () =>
          new Response("Verified report", {
            headers: {
              "Content-Type": type,
              "Content-Disposition": "attachment; filename=summary.csv",
            },
          }),
      },
      async (base) => {
        const r = await fetch(base + path);
        assert.equal(r.status, 200, path);
        assert.match(r.headers.get("content-type"), new RegExp(type));
        assert.equal(await r.text(), "Verified report");
      },
    );
});
