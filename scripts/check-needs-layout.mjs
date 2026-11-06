// Headless browser QA against an isolated in-memory fixture; never opens a saved dashboard database.
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import express from "express";
import { gzipSync } from "node:zlib";
import { createApp } from "../server/app.js";
import { openDb, readData, saveImport } from "../server/db.js";
import { readFile, inspectImport } from "../server/domain.js";
const source = process.argv[2];
const registrySource = process.argv[3];
const benchmarkLabel = process.argv
  .find((v) => v.startsWith("--benchmark="))
  ?.split("=")[1];
if (!source) throw Error("Provide a workbook to validate in memory.");
const executable = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!executable) throw Error("A Chromium browser was not found.");
const dataRoot = resolve("data");
mkdirSync(dataRoot, { recursive: true });
const profileDir = mkdtempSync(join(dataRoot, "needs-headless-"));
const output = join(dataRoot, "needs-layout-qa");
mkdirSync(output, { recursive: true });
const db = openDb(":memory:");
const app = createApp(db, { production: true, authRequired: false });
const actor = db
  .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
  .get().id;
const parsed = await readFile(readFileSync(source), source);
parsed.mode = "merge";
saveImport(db, parsed, inspectImport(parsed, readData(db)), actor);
const sourceAttendanceCount = db
  .prepare("SELECT count(*) n FROM attendance")
  .get().n;
const sourceParticipantCount=db.prepare('SELECT count(DISTINCT participant_id) n FROM attendance').get().n;
const sourceProgrammeCount=db.prepare('SELECT count(*) n FROM programmes').get().n;
app.use(express.static("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const requestCounts = new Map();
server.prependListener("request", (req) => {
  if (req.url.startsWith("/api/"))
    requestCounts.set(req.url, (requestCounts.get(req.url) || 0) + 1);
});
if (registrySource) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([readFileSync(registrySource)]),
    "registry.xlsx",
  );
  const previewResponse = await fetch(origin + "/api/client-registry/preview", {
    method: "POST",
    headers: { Origin: origin },
    body: form,
  });
  const preview = await previewResponse.json();
  if (!previewResponse.ok)
    throw Error("Registry fixture preview failed: " + JSON.stringify(preview));
  const confirmation = await fetch(origin + "/api/client-registry/confirm", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: preview.id,
      complete: true,
      asOf: new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Singapore",
      }),
    }),
  });
  if (!confirmation.ok)
    throw Error(
      "Registry fixture confirmation failed: " + (await confirmation.text()),
    );
}
const patternMeasurements = [];
for (const dimension of [
  "age",
  "cfs",
  "risk",
  "race",
  "gender",
  "living",
  "distance",
]) {
  const timings = [];
  let summary;
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    const response = await fetch(
      origin + "/api/participation-patterns?dimension=" + dimension,
    );
    summary = await response.json();
    if (!response.ok) throw Error("Pattern benchmark failed: " + dimension);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  patternMeasurements.push({
    dimension,
    medianMs: Number(timings[2].toFixed(2)),
    responseBytes: Buffer.byteLength(JSON.stringify(summary)),
    visibleGroups: summary.groups.filter((g) => !g.suppressed).length,
    releasedProgrammes: summary.rankings.rows.length,
  });
}
writeFileSync(
  join(output, "patterns-performance.json"),
  JSON.stringify(
    {
      sourceAttendanceCount,
      localOnly: true,
      measurements: patternMeasurements,
    },
    null,
    2,
  ),
);
const browser = spawn(
  executable,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profileDir,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
const pending = new Map();
let sequence = 0;
const errors = [];
const results = [];
try {
  let address;
  for (let i = 0; i < 100; i++) {
    try {
      const lines = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8")
        .trim()
        .split(/\r?\n/);
      address = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
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
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) p?.reject(Error(message.error.message));
      else p?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
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
  const target = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) =>
    (
      await command("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value;
  const wait = async (expression, label) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw Error("Timed out waiting for " + label);
  };
  await command("Runtime.enable");
  await command("Page.enable");
  if (benchmarkLabel) {
    const apis = {};
    for (const [name, url, body] of [
      ["dashboard", "/api/dashboard?interval=month&target=all", null],
      ["needs", "/api/needs/overview", null],
      ["clients", "/api/clients/report", {}],
      ["filter", "/api/dashboard?interval=month&target=all&gender=MALE", null],
      [
        "overview",
        "/api/dashboard?view=overview&interval=month&target=all",
        null,
      ],
    ]) {
      const samples = [];
      let bytes = 0;
      for (let i = 0; i < 8; i++) {
        const start = performance.now();
        const response = await fetch(origin + url, {
          ...(body
            ? {
                method: "POST",
                headers: { Origin: origin, "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        const text = await response.text();
        if (!response.ok) throw Error("Benchmark API failed: " + url);
        bytes = Buffer.byteLength(text);
        samples.push(performance.now() - start);
      }
      const warm = samples.slice(1).sort((a, b) => a - b);
      apis[name] = {
        firstMs: samples[0],
        warmMedianMs: warm[Math.floor(warm.length / 2)],
        warmP95Ms: warm.at(-1),
        bytes,
        samplesMs: samples,
      };
    }
    requestCounts.clear();
    await command("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const start = performance.now();
    await command("Page.navigate", { url: origin });
    await wait(
      "document.querySelector('h1')?.textContent.toLowerCase() === 'main dashboard' && (document.querySelector('.management-kpis[data-ready=true]') || document.querySelector('.metric-grid')) && document.querySelector('.participation-summary table') && !document.querySelector('.fetch-status')",
      "benchmark overview",
    );
    const overviewReadyMs = performance.now() - start;
    await pause(350);
    const resources = await evaluate(
      "performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,transfer:r.transferSize,decoded:r.decodedBodySize})).filter(r=>/\\.(js|css)$/.test(r.name))",
    );
    const index = readFileSync("dist/index.html", "utf8"),
      entry = index.match(/src="([^"]+\.js)"/)?.[1];
    const entryBytes = entry
      ? readFileSync(join("dist", entry.replace(/^\//, "")))
      : Buffer.alloc(0);
    const initialRequests = Object.fromEntries(requestCounts);
    let warmFilterReadyMs = null;
    if (benchmarkLabel === "after") {
      requestCounts.clear();
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Singapore",
      });
      const expectedFrom = new Date(
        Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 3, 1),
      )
        .toISOString()
        .slice(0, 10);
      const filterStart = performance.now();
      await evaluate(
        "(() => {const select=document.querySelector('.filters select');select.value='Last 3 months';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
      );
      await wait(
        `!!document.querySelector('[data-report-from="${expectedFrom}"] .management-kpis[data-ready=true]') && !document.querySelector('.participation-summary[aria-busy=true]') && !document.querySelector('.fetch-status')`,
        "warm filter update",
      );
      warmFilterReadyMs = performance.now() - filterStart;
    }
    const result = {
      label: benchmarkLabel,
      environment: {
        node: process.version,
        browser: "Isolated headless Chromium, 1440x1000",
        database: "Local SQLite :memory:",
        network:
          "Loopback; first API call and seven warm calls; no provider cold-start measurement",
        sourceAttendance: sourceAttendanceCount,
        registeredSource: Boolean(registrySource),
      },
      entry: {
        bytes: entryBytes.length,
        gzipBytes: gzipSync(entryBytes).length,
      },
      apis,
      overviewReadyMs,
      requests: initialRequests,
      warmFilterReadyMs,
      filterRequests:
        benchmarkLabel === "after" ? Object.fromEntries(requestCounts) : null,
      resources,
    };
    writeFileSync(
      join(dataRoot, `performance-${benchmarkLabel}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        label: benchmarkLabel,
        entry: result.entry,
        overviewReadyMs,
        warmFilterReadyMs,
        apis: Object.fromEntries(
          Object.entries(apis).map(([k, v]) => [
            k,
            {
              firstMs: v.firstMs,
              warmMedianMs: v.warmMedianMs,
              bytes: v.bytes,
            },
          ]),
        ),
        requests: result.requests,
      }),
    );
    await send("Browser.close").catch(() => {});
  } else {
    const pages = [
      "Main Dashboard",
      ...(registrySource ? ["Client Engagement & Outreach"] : []),
      "Programme Analysis",
      "Participation Patterns & Insights",
      "Participant Needs & Accessibility",
      "Who Are We Serving?",
      "Gaps and Participation Barriers",
      "Detailed action tracker",
      "Programme Alignment",
      "Custom Analysis",
      "Operations & Screening",
      "Social Risk Analysis",
      "Audience & Outreach",
      "Planning",
      "Data Quality and Administration",
      "Data management",
    ];
    for (const [width, height] of [
      [1440, 1000],
      [1366, 900],
      [1024, 768],
      [768, 1024],
      [375, 812],
    ]) {
      if (process.argv.includes("--print-only") && width !== 1440) continue;
      await command("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await command("Page.navigate", { url: origin });
      await wait(
        "document.querySelector('h1')?.textContent === 'Main dashboard' && document.querySelector('.management-kpis[data-ready=true]') && document.querySelector('.participation-summary table') && !document.querySelector('.fetch-status')",
        "management overview",
      );
      const eagerPatterns = await evaluate(
        "performance.getEntriesByType('resource').some(r => r.name.includes('/api/participation-patterns'))",
      );
      if (eagerPatterns)
        throw Error(
          "Optional participation analysis loaded on the main dashboard",
        );
      const primary = await evaluate(
        "[...document.querySelectorAll('nav > button')].map(b => b.textContent.trim())",
      );
      if (
        JSON.stringify(primary) !==
        JSON.stringify(["Main Dashboard", "Programme Analysis", "Planning"])
      )
        throw Error("Unexpected initial navigation: " + primary.join(", "));
      for (const page of pages.filter(
        (page) =>
          !process.argv.includes("--print-only") || page === "Main Dashboard",
      )) {
        if (page !== "Main Dashboard") {
          if (width <= 650) {
            await evaluate(
              "(() => { const menu = document.querySelector('.navigation-toggle'); if (menu?.getAttribute('aria-expanded') === 'false') menu.click(); })()",
            );
            await wait(
              "document.querySelector('.navigation-toggle')?.getAttribute('aria-expanded') === 'true'",
              "mobile menu",
            );
          }
          const clicked = await evaluate(
            `(() => { const menu = document.querySelector('.navigation-toggle'); if (innerWidth <= 650 && menu?.getAttribute('aria-expanded') === 'false') menu.click(); const button = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === ${JSON.stringify(page)}); if (!button) return false; const parents = []; for (let d = button.closest('details'); d; d = d.parentElement.closest('details')) parents.push(d); parents.reverse().forEach(d => { if (!d.open) d.querySelector('summary').click(); }); if (!button.getClientRects().length) return false; button.click(); return true; })()`,
          );
          if (!clicked) throw Error("Navigation missing: " + page);
          await wait(
            `document.querySelector('h1')?.textContent === ${JSON.stringify(page === "Detailed action tracker" ? "Detailed action tracker" : page === "Programme Analysis" ? "Programme analysis" : page === "Operations & Screening" ? "Operations & health screening" : page === "Audience & Outreach" ? "Audience & outreach gaps" : page === "Planning" ? "Planning" : page)} && !document.body.innerText.includes('Loading needs analysis') && !document.querySelector('.fetch-status')`,
            "page " + page,
          );
        }
        if (page === "Participation Patterns & Insights") {
          await wait(
            "!!document.querySelector('.patterns-kpis') && document.querySelector('.patterns-page')?.getAttribute('aria-busy') === 'false'",
            "selected participation dimension",
          );
          const compatibilityCheck=await evaluate("({scope:document.querySelector('[aria-label=\"Analysis population\"]').value,dimension:document.querySelector('[aria-label=\"Analyse by\"]').value,unique:document.querySelector('.patterns-kpis strong').textContent,compact:!!document.querySelector('.patterns-main-grid')})");
          if(compatibilityCheck.scope!=='overall'||compatibilityCheck.dimension!=='age'||Number(compatibilityCheck.unique.replaceAll(',',''))!==sourceParticipantCount||!compatibilityCheck.compact)throw Error('Attendance population compatibility failed: '+JSON.stringify(compatibilityCheck));
          results.push({viewport:`${width}x${height}`,page:'All-attendee age compatibility',...compatibilityCheck});
          if([1440,768,375].includes(width)){await evaluate('scrollTo(0,0)');const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${width}-Participation-Compact-Header.png`),Buffer.from(shot.data,'base64'));}
          if (width === 1440) {
            for (const label of [
              "CFS",
              "Social Risk Factor",
              "Living Arrangement",
              "Age Group",
            ]) {
              await evaluate(
                `(()=>{const select=document.querySelector('[aria-label="Analyse by"]');select.value=[...select.options].find(o=>o.textContent===${JSON.stringify(label)}).value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
              );
              await pause(200);
              await wait(
                "document.querySelector('.patterns-page')?.getAttribute('aria-busy') === 'false'",
                "dimension " + label,
              );
            }
            await evaluate(
              "[...document.querySelectorAll('.patterns-page button')].find(b => b.textContent==='Presentation / PDF').click()",
            );
            await wait(
              "!!document.querySelector('.presentation') && document.querySelectorAll('.presentation .report-slide').length===4",
              "patterns presentation",
            );
            const reportCheck = await evaluate(
              "({width:innerWidth,scrollWidth:document.querySelector('.presentation').scrollWidth,sections:document.querySelectorAll('.presentation .report-slide').length})",
            );
            if (reportCheck.scrollWidth > width + 1)
              throw Error("Patterns report overflow");
            results.push({
              viewport: `${width}x${height}`,
              page: "Patterns presentation",
              ...reportCheck,
            });
            const interactive = await evaluate(
              "!document.querySelector('.presentation').closest('[inert]') && !document.querySelector('.presentation').closest('.main-shell')",
            );
            if (!interactive)
              throw Error(
                "Patterns presentation is inside the disabled workspace",
              );
            await command("Emulation.setEmulatedMedia", { media: "print" });
            const printable = await evaluate(
              "document.querySelector('.presentation').getBoundingClientRect().width > 0 && getComputedStyle(document.querySelector('.main-shell')).display === 'none' && getComputedStyle(document.querySelector('.presentation-toolbar')).display === 'none'",
            );
            if (!printable)
              throw Error("Patterns report is hidden in print output");
            const patternPdf = await command("Page.printToPDF", {
              landscape: true,
              printBackground: true,
              preferCSSPageSize: true,
            });
            const pdfBytes = Buffer.from(patternPdf.data, "base64");
            writeFileSync(join(output, "Patterns-report-print.pdf"), pdfBytes);
            const printedPages = (
              pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []
            ).length;
            if (printedPages !== 4)
              throw Error(
                "Patterns report should print as four readable pages; found " +
                  printedPages,
              );
            results.push({
              viewport: `${width}x${height}`,
              page: "Patterns print",
              printedPages,
              printable,
            });
            await command("Emulation.setEmulatedMedia", { media: "screen" });

            await evaluate(
              "[...document.querySelectorAll('.presentation button')].find(b => b.textContent==='Back to analysis').click()",
            );
          }
          await evaluate(
            "(()=>{const s=document.querySelector('[aria-label=\"Analyse by\"]');s.value='distance';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
          );
          await pause(220);
          await wait(
            "document.querySelector('.patterns-page')?.getAttribute('aria-busy')==='false' && [...document.querySelectorAll('h2')].some(h=>h.textContent==='Participation by Distance')",
            "distance analysis without invented coordinates",
          );
          await evaluate("(()=>{const b=[...document.querySelectorAll('.patterns-controls button')].find(b=>b.textContent==='More filters');if(b.getAttribute('aria-expanded')==='false')b.click();})()");
          const distanceCheck = await evaluate(
            "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText),metric:document.querySelector('[aria-label=\"Distance measure\"]').value,verified:document.querySelector('.patterns-kpis article strong').textContent})",
          );
          if (
            distanceCheck.scrollWidth > width + 1 ||
            distanceCheck.alerts.length ||
            distanceCheck.metric !== "walking" ||
            distanceCheck.verified !== "0"
          )
            throw Error(
              "Distance layout or verification mismatch: " +
                JSON.stringify(distanceCheck),
            );
          results.push({
            viewport: `${width}x${height}`,
            page: "Location & Distance",
            ...distanceCheck,
          });
          if ([1440, 768, 375].includes(width)) {
            await evaluate("scrollTo(0,0)");
            const shot = await command("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: false,
            });
            writeFileSync(
              join(output, `${width}-Location-Insights.png`),
              Buffer.from(shot.data, "base64"),
            );
          }
          if (width === 1440) {
            await evaluate(
              "[...document.querySelectorAll('.patterns-page summary')].find(s=>s.textContent==='Administrator location verification').click()",
            );
            await wait(
              "!!document.querySelector('.location-admin')",
              "location administration",
            );
            await evaluate(
              "[...document.querySelectorAll('.location-admin summary')].find(s=>s.textContent==='Centre coordinates and reporting bands').click()",
            );
            await evaluate(
              "document.querySelector('.location-admin').scrollIntoView({block:'start'})",
            );
            const shot = await command("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: false,
            });
            writeFileSync(
              join(output, "1440-Location-verification.png"),
              Buffer.from(shot.data, "base64"),
            );
            results.push({
              viewport: `${width}x${height}`,
              page: "Administrator location review",
              verifiedCoordinatesInvented: false,
            });
            await evaluate(
              "[...document.querySelectorAll('.patterns-page summary')].find(s=>s.textContent==='Administrator location verification').click()",
            );
            await evaluate(
              "[...document.querySelectorAll('.patterns-page summary')].find(s=>s.textContent==='Participation by Residential Block').click()",
            );
            await wait(
              "!!document.querySelector('[aria-label=\"Find a residential building\"]') && !document.body.innerText.includes('Updating residential comparison...')",
              "protected residential block table",
            );
            await evaluate(
              "[...document.querySelectorAll('.patterns-page summary')].find(s=>s.textContent==='Explore Distance and Other Factors').click()",
            );
            await pause(220);
            await wait(
              "document.querySelector('.patterns-page')?.getAttribute('aria-busy')==='false' && document.querySelector('[aria-label=\"Second characteristic\"]')?.value==='cfs'",
              "default distance and CFS comparison",
            );
            await evaluate(
              "[...document.querySelectorAll('.patterns-page summary')].find(s=>s.textContent==='Explore Distance and Other Factors').click()",
            );
            await pause(220);
            await wait(
              "document.querySelector('.patterns-page')?.getAttribute('aria-busy')==='false'",
              "distance comparison restored",
            );
            await evaluate(
              "[...document.querySelectorAll('.patterns-page button')].find(b=>b.textContent==='Presentation / PDF').click()",
            );
            await wait(
              "!!document.querySelector('.presentation') && document.querySelectorAll('.presentation .report-slide').length===4",
              "location presentation",
            );
            await command("Emulation.setEmulatedMedia", { media: "print" });
            const pdf = await command("Page.printToPDF", {
              landscape: true,
              printBackground: true,
              preferCSSPageSize: true,
            });
            const bytes = Buffer.from(pdf.data, "base64"),
              pages = (
                bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []
              ).length;
            writeFileSync(join(output, "Location-report-print.pdf"), bytes);
            if (pages !== 4)
              throw Error(
                "Location report should be four readable pages; found " + pages,
              );
            results.push({
              viewport: `${width}x${height}`,
              page: "Location print",
              printedPages: pages,
            });
            await command("Emulation.setEmulatedMedia", { media: "screen" });
            await evaluate(
              "[...document.querySelectorAll('.presentation button')].find(b=>b.textContent==='Back to analysis').click()",
            );
          }
          await evaluate(
            "(()=>{const s=document.querySelector('[aria-label=\"Analyse by\"]');s.value='age';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
          );
          await pause(220);
          await wait(
            "document.querySelector('.patterns-page')?.getAttribute('aria-busy')==='false' && [...document.querySelectorAll('h2')].some(h=>h.textContent==='Participant group comparison')",
            "age view restored",
          );
        }
        if (page === "Data management")
          await wait(
            "!!document.querySelector('.data-stat-grid')",
            "saved data inventory",
          );
        if (page === "Client Engagement & Outreach")
          await wait(
            "!!document.querySelector('.client-kpis') && !document.body.innerText.includes('Calculating linked client')",
            "linked client engagement",
          );
        await pause(200);
        const check = await evaluate(
          `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText),kpis:document.querySelectorAll('.metric-card').length,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent)})`,
        );
        results.push({ viewport: `${width}x${height}`, page, ...check });
        console.log(
          JSON.stringify({
            viewport: `${width}x${height}`,
            page,
            width: check.width,
            scrollWidth: check.scrollWidth,
            alerts: check.errors.length,
          }),
        );
        if (check.scrollWidth > width + 1) {
          const overflow = await evaluate(
            "[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,class:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+1 && e.width>0).slice(0,18)",
          );
          const screenshot = await command("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          writeFileSync(
            join(output, `${width}-overflow.png`),
            Buffer.from(screenshot.data, "base64"),
          );
          throw Error(
            "Horizontal page overflow: " +
              width +
              " " +
              page +
              " " +
              JSON.stringify(overflow),
          );
        }
        if (check.errors.length)
          throw Error("Visible page error: " + check.errors.join(" | "));
        if(page==='Client Engagement & Outreach'){
          await evaluate("[...document.querySelectorAll('.client-tabs button')].find(b=>b.textContent==='Outreach priorities').click()");
          await wait("!!document.querySelector('.client-outreach') && document.querySelector('.client-outreach').getAttribute('aria-busy')==='false' && !!document.querySelector('.client-outreach table')",'client outreach priorities');
          const outreach=await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,alerts:[...document.querySelectorAll('.client-outreach [role=alert]')].map(e=>e.textContent),age:document.querySelector('.client-outreach').innerText.includes('Age profile · all registered clients'),employment:document.querySelector('[aria-label=\"Outreach working status\"]')?.value})");
          if(outreach.scrollWidth>width+1||outreach.alerts.length||!outreach.age)throw Error('Outreach layout failed: '+JSON.stringify(outreach));
          results.push({viewport:`${width}x${height}`,page:'Registered client outreach priorities',...outreach});
          if(width===1440){await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Outreach group\"]');select.value='alone';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await pause(200);await wait("document.querySelector('.client-outreach')?.getAttribute('aria-busy')==='false'",'living-alone outreach');const living=await evaluate("document.querySelector('.client-outreach').innerText");if(!living.includes('Seniors recorded living alone')||!living.includes('Recorded block'))throw Error('Living-alone drill-down unavailable');}
          await evaluate("[...document.querySelectorAll('.client-tabs button')].find(b=>b.textContent==='Client participation').click()");
          await wait("!document.querySelector('.client-outreach') && !!document.querySelector('.client-kpis') && !document.body.innerText.includes('Calculating linked client')",'return to client participation');
        }
        if (
          (width === 1440 || width === 768) &&
          [
            "Main Dashboard",
            "Programme Analysis",
            "Participation Patterns & Insights",
            "Planning",
            "Who Are We Serving?",
            "Detailed action tracker",
            "Data management",
            "Client Engagement & Outreach",
          ].includes(page)
        ) {
          const screenshot = await command("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          writeFileSync(
            join(output, `${width}-${page.replace(/[^A-Za-z]+/g, "-")}.png`),
            Buffer.from(screenshot.data, "base64"),
          );
        }
        if(page==='Programme Analysis'){
          await wait("!!document.querySelector('.event-insights') && !document.querySelector('.event-insights[aria-busy=true]') && !!document.querySelector('.event-insights .report-bars')",'Event Type programme mix');
          const check=await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,alerts:[...document.querySelectorAll('.event-insights [role=alert]')].map(e=>e.textContent),labels:document.querySelector('.event-insights').innerText.includes('Social & Cognitive')})");
          if(check.scrollWidth>width+1||check.alerts.length||!check.labels)throw Error('Event Type layout/data check failed: '+JSON.stringify(check));
          results.push({viewport:`${width}x${height}`,page:'Event Type programme mix',...check});
          const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${width}-Event-Type-Analysis.png`),Buffer.from(shot.data,'base64'));
          if(width===1440){
            await evaluate("[...document.querySelectorAll('.event-insights summary')].find(e=>e.textContent.includes('Additional Engagement Types')).click()");
            await wait("!!document.querySelector('.event-insights table caption')",'domain and Event Type matrix');
            const matrix=await evaluate("document.querySelector('.event-insights table caption').closest('table').innerText");if(!matrix.includes('Learning')||!matrix.includes('Physical'))throw Error('Event matrix source labels missing');
            await evaluate("[...document.querySelectorAll('.event-insights button')].find(e=>e.textContent==='Presentation / PDF').click()");
            const expectedSections=Math.max(1,Math.ceil(sourceProgrammeCount/8))+1;
            await wait(`document.querySelectorAll('.presentation .report-slide').length===${expectedSections}`,'paginated Event Type presentation');
            const classificationRows=await evaluate("document.querySelectorAll('.presentation .programme-classification-slide tbody tr').length");if(classificationRows!==sourceProgrammeCount)throw Error('Programme classification print rows do not reconcile to distinct programmes');
            const combinedDomains=await evaluate("(()=>{const tables=[...document.querySelectorAll('.presentation .programme-classifications table')];return tables.length>0&&tables.every(table=>[...table.querySelectorAll('thead th')].some(th=>th.textContent==='Domains')&&[...table.querySelectorAll('tbody tr')].every(row=>{const parts=row.cells[1].textContent.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);return parts.length===new Set(parts).size;}));})()");if(!combinedDomains)throw Error('Activity domains are missing or duplicated in the report');
            await command('Emulation.setEmulatedMedia',{media:'print'});const pdf=await command('Page.printToPDF',{landscape:true,printBackground:true,preferCSSPageSize:true});const bytes=Buffer.from(pdf.data,'base64');writeFileSync(join(output,'Event-Type-report-print.pdf'),bytes);const pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;if(pages<expectedSections)throw Error(`Event Type PDF produced only ${pages} pages for ${expectedSections} report sections`);await command('Emulation.setEmulatedMedia',{media:'screen'});
            await evaluate("document.querySelector('.presentation-toolbar button').click()");await wait("!document.querySelector('.presentation')",'close Event Type presentation');results.push({viewport:`${width}x${height}`,page:'Event Type matrix and paginated PDF',pages,classificationRows});
          }
        }
        if (page === "Programme Analysis" && width === 1440) {
          await evaluate(
            "document.querySelector('.work-table tbody button, .table-scroll tbody button').click()",
          );
          await wait(
            "!![...document.querySelectorAll('dialog button')].find(b => b.textContent.trim()==='Plan next steps for this programme')",
            "programme next step",
          );
          const programme = await evaluate(
            "document.querySelector('dialog .modal-head h2').textContent",
          );
          await evaluate(
            "[...document.querySelectorAll('dialog button')].find(b => b.textContent.trim()==='Plan next steps for this programme').click()",
          );
          await wait(
            "document.querySelector('h1')?.textContent==='Planning' && !!document.querySelector('input[aria-label=\"Find a programme or saved plan\"]') && !document.querySelector('.fetch-status')",
            "programme planning handoff",
          );
          const query = await evaluate(
            "document.querySelector('input[aria-label=\"Find a programme or saved plan\"]').value",
          );
          if (query !== programme)
            throw Error("Programme selection was lost during planning handoff");
          results.push({
            viewport: `${width}x${height}`,
            page: "Programme to planning",
            programmeSelected: true,
          });
        }
        if (page === "Main Dashboard") {
          await evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent==='Print summary').click()",
          );
          await wait(
            "document.querySelectorAll('.report-slide').length >= 6 && !document.querySelector('.presentation-toolbar button:last-child').disabled",
            "six-section presentation",
          );
          const report = await evaluate(
            "({width:innerWidth,scrollWidth:document.querySelector('.presentation').scrollWidth,sections:document.querySelectorAll('.report-slide').length,identities:document.querySelector('.presentation').innerText.includes('Member ID')})",
          );
          if (report.scrollWidth > width + 1 || report.identities)
            throw Error(
              "Presentation layout or privacy failed: " +
                JSON.stringify(report),
            );
          results.push({
            viewport: `${width}x${height}`,
            page: "Presentation View",
            ...report,
          });
          const shot = await command("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          writeFileSync(
            join(output, `${width}-Presentation.png`),
            Buffer.from(shot.data, "base64"),
          );
          if (width === 1440) {
            await command("Emulation.setEmulatedMedia", { media: "print" });
            const hidden = await evaluate(
              "getComputedStyle(document.querySelector('.main-shell')).display === 'none' && getComputedStyle(document.querySelector('.presentation-toolbar')).display === 'none' && getComputedStyle(document.querySelector('.app'),'::before').content === 'none'",
            );
            if (!hidden)
              throw Error("Print controls or workspace were not hidden");
            const pdf = await command("Page.printToPDF", {
              landscape: true,
              printBackground: true,
              preferCSSPageSize: true,
            });
            writeFileSync(
              join(output, "Management-report-print.pdf"),
              Buffer.from(pdf.data, "base64"),
            );
            await command("Emulation.setEmulatedMedia", { media: "screen" });
            await command("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
            });
            const inside = await evaluate(
              "!!document.activeElement.closest('.presentation')",
            );
            if (!inside) throw Error("Presentation keyboard focus escaped");
          }
          await evaluate(
            "document.querySelector('.presentation-toolbar button').click()",
          );
          await wait(
            "!document.querySelector('.presentation')",
            "presentation close",
          );
          const fixtureData = readData(db),
            fixtureSessions = new Map(
              fixtureData.sessions.map((s) => [s.id, s]),
            );
          const today = new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Singapore",
          });
          const delivered = fixtureData.attendance.filter(
            (a) => fixtureSessions.get(a.sessionId)?.date <= today,
          );
          await evaluate(
            "document.querySelectorAll('.participation-summary .segmented button')[1].click()",
          );
          await wait(
            "document.querySelector('.participation-summary thead th')?.textContent === 'Month'",
            "monthly summary",
          );
          const monthly = await evaluate(
            "({attendance:Number(document.querySelector('.participation-summary tfoot tr').children[2].textContent.replaceAll(',','')),unique:Number(document.querySelector('.participation-summary tfoot tr').children[3].textContent.replaceAll(',','')),overflow:document.documentElement.scrollWidth>innerWidth+1,registry:[...document.querySelectorAll('.management-home h2')].some(e=>e.textContent==='Registered client coverage')})",
          );
          if (
            monthly.attendance !== delivered.length ||
            monthly.unique !==
              new Set(delivered.map((a) => a.participantId)).size ||
            monthly.overflow ||
            monthly.registry
          )
            throw Error(
              "Main dashboard summary reconciliation failed: " +
                JSON.stringify(monthly),
            );
          if (width === 1440 || width === 375) {
            await evaluate(
              "document.querySelector('.participation-summary').scrollIntoView({block:'start'})",
            );
            const shot = await command("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: false,
            });
            writeFileSync(
              join(output, `${width}-Monthly-summary.png`),
              Buffer.from(shot.data, "base64"),
            );
            await evaluate("window.scrollTo(0,0)");
          }
          await evaluate(
            "document.querySelectorAll('.participation-summary .segmented button')[0].click()",
          );
          const firstMonth = await evaluate(
            "document.querySelector('[aria-label=\"Summary month\"] option').value",
          );
          const monthLabel = new Intl.DateTimeFormat("en-SG", {
            month: "long",
            year: "numeric",
            timeZone: "Asia/Singapore",
          }).format(new Date(firstMonth + "-01T00:00:00+08:00"));
          await evaluate(
            `(() => {const select=document.querySelector('[aria-label="Summary month"]');select.value=${JSON.stringify(firstMonth)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
          );
          await wait(
            `document.querySelector('.participation-summary caption')?.textContent.startsWith(${JSON.stringify(monthLabel)}) && document.querySelector('.participation-summary')?.getAttribute('aria-busy') === 'false'`,
            "summary month switch",
          );
          results.push({
            viewport: `${width}x${height}`,
            page: "Daily and monthly summary controls",
            ...monthly,
          });
        }
        if (page === "Client Engagement & Outreach") {
          for (const [label, selector] of [
            ["Explore client participation gaps", ".client-guide"],
            ["Client follow-up list", ".client-followups tbody"],
          ]) {
            await evaluate(
              `[...document.querySelectorAll('.client-tabs button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`,
            );
            await wait(
              `!!document.querySelector(${JSON.stringify(selector)})`,
              label,
            );
            const result = await evaluate(
              "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText)})",
            );
            if (result.scrollWidth > width + 1 || result.errors.length)
              throw Error(
                "Client workspace layout failed: " +
                  label +
                  " " +
                  JSON.stringify(result),
              );
            results.push({
              viewport: `${width}x${height}`,
              page: label,
              ...result,
            });
          }
          await evaluate(
            "[...document.querySelectorAll('.client-intro button')].find(b=>b.textContent.includes('Import client registry')).click()",
          );
          await wait(
            "!!document.querySelector('.client-import')",
            "client registry import form",
          );
          const result = await evaluate(
            "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText)})",
          );
          if (result.scrollWidth > width + 1 || result.errors.length)
            throw Error(
              "Client import layout failed: " + JSON.stringify(result),
            );
          results.push({
            viewport: `${width}x${height}`,
            page: "Client registry import",
            ...result,
          });
        }
        if (page === "Data management") {
          await evaluate(
            "[...document.querySelectorAll('button')].find(b => b.textContent === 'Choose data to delete').click()",
          );
          await wait(
            "!!document.querySelector('.data-choice')",
            "deletion options",
          );
          await evaluate(
            "[...document.querySelectorAll('.data-choice')].find(e => e.textContent.includes('All attendance')).querySelector('input').click()",
          );
          await wait(
            "[...document.querySelectorAll('.data-choice')].find(e => e.textContent.includes('All attendance')).querySelector('input').checked",
            "attendance selection",
          );
          await evaluate(
            "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Review deletion')).click()",
          );
          await wait(
            "!!document.querySelector('.data-confirm[open]')",
            "deletion preview dialog",
          );
          const review = await evaluate(
            `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText),deleteEnabled:[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete selected data')?.disabled === false})`,
          );
          if (
            review.scrollWidth > width + 1 ||
            review.errors.length ||
            review.deleteEnabled
          )
            throw Error(
              "Deletion preview layout or confirmation guard failed: " +
                JSON.stringify(review),
            );
          results.push({
            viewport: `${width}x${height}`,
            page: "Deletion preview",
            ...review,
          });
          const screenshot = await command("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          writeFileSync(
            join(output, `${width}-Deletion-preview.png`),
            Buffer.from(screenshot.data, "base64"),
          );
          await evaluate(
            "document.querySelector('[aria-label=\"Close review\"]').click()",
          );
          if (
            db.prepare("SELECT count(*) n FROM attendance").get().n !==
            sourceAttendanceCount
          )
            throw Error("A preview changed the source fixture.");
          await evaluate(
            "(() => {const button=[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='Dashboard Settings');button.closest('details').open=true;button.click();})()",
          );
          await wait(
            "!!document.querySelector('dialog[aria-label=\"Dashboard Settings\"][open]')",
            "dashboard settings",
          );
          const settings = await evaluate(
            "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText)})",
          );
          if (settings.scrollWidth > width + 1 || settings.errors.length)
            throw Error("Settings layout failed: " + JSON.stringify(settings));
          results.push({
            viewport: `${width}x${height}`,
            page: "Dashboard Settings",
            ...settings,
          });
          await evaluate(
            'document.querySelector(\'dialog[aria-label="Dashboard Settings"] [aria-label="Close dialog"]\').click()',
          );
        }
      }
    }
    if (errors.length)
      throw Error("Browser runtime errors: " + errors.join(" | "));
    writeFileSync(
      join(
        output,
        process.argv.includes("--print-only")
          ? "print-results.json"
          : "results.json",
      ),
      JSON.stringify(
        {
          fixture:
            "Read-only source workbook loaded into an isolated in-memory database",
          results,
          runtimeErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${results.length} page/viewport checks, no horizontal page overflow, visible errors or runtime exceptions. Screenshots: ${output}`,
    );
    await send("Browser.close").catch(() => {});
  }
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
  const safe = relative(dataRoot, resolve(profileDir));
  if (!safe || safe.startsWith("..") || isAbsolute(safe))
    console.error("Skipped unsafe browser-profile cleanup target.");
  else
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(profileDir, { recursive: true, force: true });
        break;
      } catch {
        await pause(200);
      }
    }
}
