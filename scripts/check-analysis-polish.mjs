// Isolated synthetic browser QA. Never opens data/glowbb.sqlite or source workbooks.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import express from "express";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import { ensureLocations } from "../server/location-store.js";
import { diagnosticFixture } from "../tests/fixtures/programme-diagnostics-state.js";
const executable = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!executable) throw Error("Chromium browser unavailable.");
const root = resolve("data"),
  output = join(root, "analysis-polish-qa");
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "glow-analysis-polish-browser-"));
const db = openDb(":memory:"),
  app = createApp(db),
  state = diagnosticFixture();
state.registry.forEach((r, i) => {
  const p = JSON.parse(r.details);
  if (i < 30) p.age = null;
  p.registrationDate = i < 20 ? "2026-11-01" : null;
  r.details = JSON.stringify(p);
});
state.settings.registry.importedAt = "2026-11-05T01:00:00Z";
for (const p of state.data.participants)
  db.prepare("INSERT INTO participants VALUES(?,?)").run(
    p.id,
    JSON.stringify(p),
  );
for (const p of state.data.programmes)
  db.prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)").run(
    p.id,
    p.name,
    p.domain,
  );
for (const s of state.data.sessions)
  db.prepare(
    "INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)",
  ).run(s.id, s.programmeId, s.date, 540, 600);
state.data.attendance.forEach((a, i) =>
  db
    .prepare(
      "INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)",
    )
    .run("a" + i, a.participantId, a.sessionId, "Synthetic QA"),
);
for (const r of state.registry)
  db.prepare("INSERT INTO member_registry VALUES(?,?,?)").run(
    r.participant_id,
    r.snapshot,
    r.details,
  );
db.prepare("UPDATE settings SET value=? WHERE id=1").run(
  JSON.stringify(state.settings),
);
await ensureLocations(db);
db.prepare("UPDATE location_store SET value=? WHERE id=1").run(
  JSON.stringify(state.locations),
);
app.use(express.static("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = spawn(
  executable,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let socket,
  sequence = 0;
const pending = new Map(),
  errors = [],
  results = [];
try {
  let address;
  for (let i = 0; i < 100; i++) {
    try {
      const lines = readFileSync(join(profile, "DevToolsActivePort"), "utf8")
        .trim()
        .split(/\r?\n/);
      address = "ws://127.0.0.1:" + lines[0] + lines[1];
      break;
    } catch {
      await pause(100);
    }
  }
  if (!address)
    throw Error("Headless browser did not expose its local testing endpoint.");
  socket = new WebSocket(address);
  await new Promise((r, j) => {
    socket.addEventListener("open", r, { once: true });
    socket.addEventListener("error", j, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p?.reject(Error(m.error.message));
      else p?.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const target = await send("Target.createTarget", { url: "about:blank" }),
    { sessionId } = await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const wait = async (expression, label) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw Error("Timed out: " + label);
  };
  await command("Runtime.enable");
  await command("Page.enable");
  const navigate = async (name) => {
    await evaluate(
      `(()=>{const menu=document.querySelector('.navigation-toggle');if(innerWidth<=650&&menu?.getAttribute('aria-expanded')==='false')menu.click();const button=[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes(${JSON.stringify(name)}));if(!button)throw Error('Missing navigation');const parents=[];for(let d=button.closest('details');d;d=d.parentElement.closest('details'))parents.push(d);parents.reverse().forEach(d=>d.open=true);button.click();})()`,
    );
  };
  for (const width of [1440, 1024, 768, 390]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command("Page.navigate", { url: origin });
    await wait(
      "!!document.querySelector('nav')&&!document.querySelector('.fetch-status')",
      "main app",
    );
    await navigate("Participation Patterns");
    await wait(
      "!!document.querySelector('[aria-label=\"Analysis population\"]')&&!document.querySelector('.patterns-page[aria-busy=true]')",
      "patterns",
    );
    await evaluate(
      "(()=>{const el=document.querySelector('[aria-label=\"Analysis population\"]');el.value='clients';el.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await wait(
      "!!document.querySelector('.data-completeness table')&&!document.querySelector('.patterns-page[aria-busy=true]')",
      "completeness",
    );
    await evaluate(
      "(()=>{const el=document.querySelector('[aria-label=\"Analysis preset\"]');el.value='living';el.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await wait(
      "document.querySelector('[aria-label=\"Analyse by\"]')?.value==='living'&&!document.querySelector('.patterns-page[aria-busy=true]')",
      "living preset",
    );
    const layout = await evaluate(
      "(()=>{const el=document.querySelector('[aria-label=\"Analysis preset\"]'),style=getComputedStyle(el),ctx=document.createElement('canvas').getContext('2d');ctx.font=style.font;return {width:innerWidth,body:document.documentElement.scrollWidth,label:el.selectedOptions[0].textContent,labelWidth:ctx.measureText(el.selectedOptions[0].textContent).width,selectWidth:el.clientWidth,progress:document.querySelector('.address-verification-banner progress')?.value,stamps:[...document.querySelectorAll('.analysis-stamp')].map(e=>e.textContent)};})()",
    );
    if (
      layout.body > width + 2 ||
      layout.labelWidth > layout.selectWidth - 36 ||
      layout.progress !== 80
    )
      throw Error("Layout/progress failed: " + JSON.stringify(layout));
    await evaluate(
      "[...document.querySelectorAll('.data-completeness button')].find(b=>b.textContent==='Review missing age').click()",
    );
    await wait(
      "document.querySelector('.quality-dialog[open] tbody')?.rows.length===25",
      "missing list",
    );
    await evaluate(
      "[...document.querySelectorAll('.quality-dialog button')].find(b=>b.textContent==='Close missing list').click()",
    );
    await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    }).then((r) =>
      writeFileSync(
        join(output, width + "-patterns.png"),
        Buffer.from(r.data, "base64"),
      ),
    );
    await navigate("Client Engagement");
    await wait("!!document.querySelector('.client-tabs')", "client workspace");
    await evaluate(
      "[...document.querySelectorAll('.client-tabs button')].find(b=>b.textContent==='Data completeness').click()",
    );
    await wait(
      "!!document.querySelector('.data-completeness table')",
      "client completeness",
    );
    const clientWidth = await evaluate("document.documentElement.scrollWidth");
    if (clientWidth > width + 2)
      throw Error(
        "Client completeness overflow at " + width + ": " + clientWidth,
      );
    await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    }).then((r) =>
      writeFileSync(
        join(output, width + "-clients.png"),
        Buffer.from(r.data, "base64"),
      ),
    );
    results.push({ ...layout, clientWidth });
  }
  if (errors.length) throw Error("Browser errors: " + errors.join("; "));
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify({ syntheticOnly: true, results, errors }, null, 2),
  );
  process.stdout.write(
    JSON.stringify(
      {
        passed: true,
        widths: results.map((r) => r.width),
        output,
        temporaryProfile: profile,
      },
      null,
      2,
    ) + "\n",
  );
  await send("Browser.close");
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
  // Retain this isolated OS-temp profile for manual cleanup; no recursive deletion.
}
