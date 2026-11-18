// Isolated in-memory browser QA. Never opens saved dashboard databases.
// A source workbook is read only when explicitly supplied with --import-preview.
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
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
import { centreQaFixture } from "./centre-qa-fixture.mjs";
import { ensureLocations } from "../server/location-store.js";
import { diagnosticFixture } from "../tests/fixtures/programme-diagnostics-state.js";
const executable = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!executable) throw Error("Chromium browser unavailable.");
const root = resolve("data"),
  output = join(
    root,
    "professional-ui-qa",
    process.argv.includes("--baseline")
      ? "before"
      : process.argv.includes("--reports-only")
        ? "reports"
        : "after",
  );
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "glow-analysis-polish-browser-"));
const fixture = await centreQaFixture();
const { db, app } = fixture;
const state = diagnosticFixture();
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
  JSON.stringify({ ...state.settings, centreId: "glow_bukit_batok" }),
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
const requestCounts = new Map();
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
    } else if (m.method === "Network.requestWillBeSent") {
      const path = new URL(m.params.request.url).pathname;
      if (path.startsWith("/api/"))
        requestCounts.set(path, (requestCounts.get(path) || 0) + 1);
    } else if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
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
    throw Error(
      "Timed out: " +
        label +
        " / " +
        errors.join("; ") +
        " / " +
        (await evaluate("document.body.innerText.slice(0,3500)")),
    );
  };
  await command("Runtime.enable");
  await command("Page.enable");

  await command("Network.enable");
  const baseline = process.argv.includes("--baseline");
  const pages = [
    ["Overview", "Main Dashboard"],
    ["Programme Performance", "Programme Analysis"],
    ["Participation Patterns & Insights", "Participation Patterns"],
    ["Client Engagement", "Client Engagement"],
    ["Participant Needs & Accessibility", "Participant Needs"],
    ["Planning & Recommendations", "Planning"],
    ["Custom Analysis", "Custom Analysis"],
    ["Operations & Screening", "Operations & Screening"],
    ["Social Risk Analysis", "Social Risk Analysis"],
    ["Who Are We Serving?", "Who Are We Serving?"],
    ["Gaps and Participation Barriers", "Gaps and Participation Barriers"],
    ["Programme Alignment", "Programme Alignment"],
    ["Programme Planning and Actions", "Detailed action tracker"],
    ["Data Quality and Administration", "Data Quality and Administration"],
    ["Data management", "Data management"],
    ["__centres", "Centre administration"],
    ["__config", "Dashboard & Data Configuration"],
  ];
  const clickPage = async (id, label) => {
    await evaluate(
      `(()=>{const toggle=document.querySelector('.shell-menu-toggle,.navigation-toggle');if(innerWidth<900&&toggle?.getAttribute('aria-expanded')==='false')toggle.click();const candidates=[...document.querySelectorAll('nav button,.platform-header button,.shell-sidebar button')];const b=candidates.find(b=>b.dataset.page===${JSON.stringify(id)})||candidates.find(b=>(b.textContent||'').includes(${JSON.stringify(label)}));if(!b)throw Error('Missing route '+${JSON.stringify(id)});for(let p=b.closest('details');p;p=p.parentElement.closest('details'))p.open=true;b.click();})()`,
    );
  };
  const metrics = {};
  for (const [name, path, body] of [
    ["overview", "/api/dashboard?view=overview", null],
    [
      "patterns",
      "/api/participation-patterns?dimension=age&scope=clients",
      null,
    ],
    ["clients", "/api/clients/report", {}],
  ]) {
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < 8; i++) {
      const start = performance.now(),
        r = await fetch(
          origin +
            path +
            (path.includes("?") ? "&" : "?") +
            "centre=glow_bukit_batok",
          {
            ...(body
              ? {
                  method: "POST",
                  headers: {
                    Origin: origin,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(body),
                }
              : {}),
          },
        );
      const text = await r.text();
      if (!r.ok) throw Error(text);
      bytes = Buffer.byteLength(text);
      if (i) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    metrics[name] = { medianMs: samples[3], p95Ms: samples.at(-1), bytes };
  }
  const viewports = process.argv.includes("--reports-only")
    ? []
    : process.argv.includes("--mobile-only")
      ? [[375, 812]]
      : baseline
        ? [[1366, 768]]
        : [
            [1920, 1080],
            [1366, 768],
            [1024, 768],
            [768, 900],
            [375, 812],
          ];
  for (const [width, height] of viewports) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    requestCounts.clear();
    const start = performance.now();
    await command("Page.navigate", { url: origin });
    await wait(
      "!!document.querySelector('.management-kpis[data-ready=true]')&&!document.querySelector('.fetch-status')",
      "overview",
    );
    const meaningfulMs = performance.now() - start;
    const startupRequests = Object.fromEntries(requestCounts);
    for (const [id, label] of pages) {
      const navStart = performance.now();
      if (id !== "Overview") await clickPage(id, label);
      await wait(
        "!document.querySelector('.fetch-status')&&!document.querySelector('.patterns-page[aria-busy=true]')&&!document.querySelector('.client-workspace[aria-busy=true]')&&!!document.querySelector('h1')",
        label,
      );
      await pause(200);
      await evaluate("window.scrollTo({top:0,behavior:'instant'})");
      const layout = await evaluate(
        "({body:document.documentElement.scrollWidth,width:innerWidth,title:document.querySelector('main h1,h1')?.textContent,headerHeight:document.querySelector('.shell-topbar,.platform-header')?.getBoundingClientRect().height,charts:document.querySelectorAll('svg[role=img],.report-bars,.engagement-stack,.horizontal-ranking').length,headings:[...document.querySelectorAll('main h2,main h3')].map(e=>e.textContent).slice(0,25),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})",
      );
      if (!baseline && layout.body > width + 2) {
        const offenders = await evaluate(
          "[...document.querySelectorAll('main *, .shell-topbar *')].map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+2).slice(0,20)",
        );
        await command("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
        }).then((r) =>
          writeFileSync(
            join(output, "overflow.png"),
            Buffer.from(r.data, "base64"),
          ),
        );
        throw Error(
          "Page overflow " +
            id +
            " " +
            width +
            " " +
            layout.body +
            " " +
            JSON.stringify(offenders),
        );
      }
      const slug = id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await command("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      }).then((r) =>
        writeFileSync(
          join(output, width + "-" + slug + ".png"),
          Buffer.from(r.data, "base64"),
        ),
      );
      results.push({
        width,
        height,
        page: id,
        navigationMs: performance.now() - navStart,
        ...layout,
        ...(id === "Overview" ? { meaningfulMs, startupRequests } : {}),
      });
    }
  }
  if (process.argv.includes("--reports-only")) {
    await command("Emulation.setDeviceMetricsOverride", {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command("Page.navigate", { url: origin });
    await wait(
      "!!document.querySelector('.management-kpis[data-ready=true]')&&!document.querySelector('.fetch-status')",
      "report-only overview",
    );
  }
  const exported = await fetch(
    origin + "/api/export/report?centre=glow_bukit_batok",
  );
  const exportedHtml = await exported.text();
  if (
    !exported.ok ||
    !exportedHtml.includes("data-report-design") ||
    !exportedHtml.includes("GLOW Bukit Batok")
  )
    throw Error("Shared export design or centre metadata missing");
  const interactionChecks = [
    { htmlExport: true, sharedDesign: true, centreMetadata: true },
  ];
  for (const width of [1366, 375]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 375 ? 812 : 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await clickPage("__config", "Dashboard & Data Configuration");
    await wait(
      "!!document.querySelector('.configuration-tabs')",
      "configuration tabs",
    );
    for (const label of [
      "Activity Exclusions",
      "KPI & Reporting Rules",
      "Centre Configuration",
      "CaritaHub Sync Settings",
      "Personal Dashboard Preferences",
    ]) {
      await evaluate(
        `(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing configuration tab');b.click();})()`,
      );
      await pause(100);
      const check = await evaluate(
        "({overflow:document.documentElement.scrollWidth>innerWidth+2,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),disconnected:document.body.innerText.includes('Not connected')})",
      );
      if (check.overflow || check.errors.length)
        throw Error(
          "Configuration layout " + label + " " + JSON.stringify(check),
        );
      if (label === "CaritaHub Sync Settings" && !check.disconnected)
        throw Error("Missing disconnected sync status");
      interactionChecks.push({ width, configuration: label, passed: true });
      await command("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      }).then((r) =>
        writeFileSync(
          join(
            output,
            width + "-config-" + label.replace(/[^a-z0-9]+/gi, "-") + ".png",
          ),
          Buffer.from(r.data, "base64"),
        ),
      );
    }
  }
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await clickPage("Overview", "Main Dashboard");
  await wait(
    "!![...document.querySelectorAll('button')].find(b=>b.textContent==='Print summary'&&!b.disabled)",
    "management report ready",
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent==='Print summary').click()",
  );
  await wait("!!document.querySelector('.presentation')", "presentation");
  if (!(await evaluate("document.querySelector('.dashboard-shell').inert")))
    throw Error("Background remains interactive in presentation");
  await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }).then((r) =>
    writeFileSync(
      join(output, "1366-management-presentation.png"),
      Buffer.from(r.data, "base64"),
    ),
  );
  if (
    await evaluate(
      "!!document.querySelector('.presentation').closest('[inert]')",
    )
  )
    throw Error("Presentation controls are inert");
  await command("Emulation.setEmulatedMedia", { media: "print" });
  const pdf = await command("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
  });
  writeFileSync(
    join(output, "management-print.pdf"),
    Buffer.from(pdf.data, "base64"),
  );
  await command("Emulation.setEmulatedMedia", { media: "" });
  await evaluate("document.querySelector('.presentation button').click()");
  await wait(
    "!document.querySelector('.presentation')",
    "return from presentation",
  );
  interactionChecks.push({
    presentation: true,
    backgroundInert: true,
    printPDF: true,
    returned: true,
  });
  const index = readFileSync("dist/index.html", "utf8"),
    entry =
      index.match(/src="([^"]+\.js)"/)?.[1] ||
      index.match(/src="([^"]+\.js)"/)?.[1];
  const file = (index.match(/src="([^"]+\.js)"/) || [])[1];
  const asset =
    entry ||
    file ||
    [...index.matchAll(/src="([^"]+)"/g)]
      .map((m) => m[1])
      .find((v) => v.endsWith(".js"));
  const bytes = readFileSync(join("dist", asset.replace(/^\//, "")));
  const report = {
    interactionChecks,
    syntheticOnly: true,
    database: "SQLite :memory:",
    environment: {
      node: process.version,
      browser: "Headless Chromium, loopback",
    },
    metrics,
    entry: { bytes: bytes.length, gzipBytes: gzipSync(bytes).length },
    results,
    errors,
  };
  writeFileSync(join(output, "results.json"), JSON.stringify(report, null, 2));
  if (errors.length) throw Error(errors.join("; "));
  console.log(
    JSON.stringify(
      {
        passed: true,
        output,
        metrics,
        entry: report.entry,
        pages: results.length,
      },
      null,
      2,
    ),
  );
  await send("Browser.close");
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await fixture.close();
}
