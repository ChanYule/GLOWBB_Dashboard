import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tsImport } from "tsx/esm/api";
import { createProxy, createHostedHandler } from "../api/index.js";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
const { api } = await tsImport("../src/api.ts", import.meta.url);
test("hosted client summary exports use URL filters without platform routing metadata", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, { authRequired: false });
  const handler = createHostedHandler({
    databaseUrl: "test",
    loadApp: async () => app,
  });
  const server = createServer((req, res) => {
    // Vercel provides its own query property, including rewrite route parameters.
    req.query = {
      ...Object.fromEntries(
        new URL(req.url, "https://dashboard.invalid").searchParams,
      ),
      path: "clients/export/csv",
    };
    return handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    for (const format of ["csv", "report"]) {
      const response = await fetch(
        base +
          `/api/clients/export/${format}?from=&to=2026-11-04&asOf=2026-11-04`,
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type"),
        format === "csv" ? /text\/csv/ : /text\/html/,
      );
      assert.match(await response.text(), /2026-11-04/);
    }
    for (const query of [
      "living=Alone",
      "gender=MALE",
    ]) {
      assert.equal(
        (await fetch(base + "/api/clients/export/csv?" + query)).status,
        403,
      );
    }
    assert.equal((await fetch(base+'/api/clients/export/csv?path=clients/export/csv&to=2026-11-04&asOf=2026-11-04')).status,200);
    assert.equal(
      (await fetch(base + "/api/clients/export/csv?asOf=bad-date")).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
test('hosted participation strips URL rewrite path as well as own query metadata without accepting unsupported audience filters',async()=>{
  const db=openDb(':memory:'),app=createApp(db,{authRequired:false}),handler=createHostedHandler({databaseUrl:'test',loadApp:async()=>app});
  const server=createServer((req,res)=>{req.query={path:['participation-patterns'],...Object.fromEntries(new URL(req.url,'http://test').searchParams)};handler(req,res);});
  server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const path of ['participation-patterns','api/participation-patterns','one&two']){
      const params=new URLSearchParams({path,dimension:'age',scope:'overall',from:'2026-05-04',to:'2026-11-05'});params.append('path','second-rewrite-value');
      const response=await fetch(base+'/api/participation-patterns?'+params);const report=await response.json();assert.equal(response.status,200,JSON.stringify(report));assert.equal(report.scope,'overall');assert.equal(report.dimension,'age');assert.deepEqual(report.period,{from:'2026-05-04',to:'2026-11-05'});assert.equal(report.ratesAvailable,false);
    }
    assert.equal((await fetch(base+'/api/participation-patterns?path=participation-patterns&living=Alone')).status,403);
    assert.equal((await fetch(base+'/api/participation-patterns?path=participation-patterns&from=invalid')).status,400);
    assert.equal((await fetch(base+'/api/event-types/report?path=event-types/report')).status,200);
  }finally{await new Promise(r=>server.close(r));db.close();}
});
test('proxy strips reserved rewrite path from the forwarded URL and preserves actual analytical filters',async()=>{
 let target;
 await withProxy({backendUrl:'https://backend.example',fetchImpl:async url=>{target=new URL(url);return Response.json({ok:true});}},async base=>{const response=await fetch(base+'/api/participation-patterns?path=participation-patterns&scope=overall&dimension=age&from=2026-05-04&to=2026-11-05');assert.equal(response.status,200);assert.equal(target.pathname,'/api/participation-patterns');assert.equal(target.searchParams.has('path'),false);assert.equal(target.searchParams.get('scope'),'overall');assert.equal(target.searchParams.get('to'),'2026-11-05');});
});
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
test('read requests have a recoverable deadline while write confirmations are never automatically retried or timed out by the client',async(t)=>{
 const original=globalThis.fetch;let release,calls=0;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  globalThis.fetch=async()=>new Promise(()=>{});
  const stalled=api('/api/me');const rejected=assert.rejects(stalled,e=>e.status===408&&e.message.includes('try again'));
  t.mock.timers.tick(30001);await rejected;
  globalThis.fetch=async()=>{calls++;return new Promise(r=>{release=r;});};
  const write=api('/api/settings',{method:'POST',body:'{}'});t.mock.timers.tick(30001);assert.equal(calls,1);
  release(Response.json({ok:true}));assert.deepEqual(await write,{ok:true});
 }finally{globalThis.fetch=original;t.mock.timers.reset();}
});

test("hosted upload size errors remain useful when Vercel returns plain text", async () => {
  await withFetch(
    async () =>
      new Response("FUNCTION_PAYLOAD_TOO_LARGE", {
        status: 413,
        headers: { "content-type": "text/plain" },
      }),
    async () =>
      assert.rejects(api("/api/import/preview"), /file of 20 MB or less/),
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


test('browser sends large files in request-sized chunks and cleans temporary uploads after preview',async()=>{
 const original=globalThis.fetch,calls=[];let chunks=0;
 globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method,bytes:Buffer.byteLength(options.body||'')});if(url==='/api/centres/uploads')return Response.json({id:'upload-fixture',chunkBytes:1024*1024});if(String(url).includes('/chunks/')){chunks++;return Response.json({ok:true});}if(options.method==='DELETE')return Response.json({ok:true});assert.equal(JSON.parse(options.body).uploadId,'upload-fixture');return Response.json({ready:1});};
 try{const form=new FormData();form.append('file',new Blob([new Uint8Array(5*1024*1024)]),'large.xlsx');const p=await api('/api/import/preview?mode=merge',{method:'POST',body:form});assert.equal(p.ready,1);assert.equal(chunks,5);assert.ok(calls.every(c=>c.bytes<2*1024*1024));assert.equal(calls.at(-1).method,'DELETE');assert.equal(calls.some(c=>c.method==='POST'&&c.url.includes('/confirm')),false);}finally{globalThis.fetch=original;}
});

test('large upload cleanup still runs when preview validation fails',async()=>{
 const original=globalThis.fetch;let cleaned=false;
 globalThis.fetch=async(url,options)=>{if(url==='/api/centres/uploads')return Response.json({id:'upload-fixture',chunkBytes:1024*1024});if(String(url).includes('/chunks/'))return Response.json({ok:true});if(options.method==='DELETE'){cleaned=true;return Response.json({ok:true});}return Response.json({error:'Invalid worksheet headers'},{status:400});};
 try{const form=new FormData();form.append('file',new Blob([new Uint8Array(3*1024*1024+1)]),'large.xlsx');await assert.rejects(api('/api/import/preview',{method:'POST',body:form}),/Invalid worksheet headers/);assert.equal(cleaned,true);}finally{globalThis.fetch=original;}
});
