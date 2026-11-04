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
      "document.querySelector('h1')?.textContent.toLowerCase() === 'management overview' && (document.querySelector('.management-kpis[data-ready=true]') || document.querySelector('.metric-grid')) && !document.querySelector('.fetch-status')",
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
        `!!document.querySelector('[data-report-from="${expectedFrom}"] .management-kpis[data-ready=true]') && !document.querySelector('.fetch-status')`,
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
      "Management Overview",
      ...(registrySource ? ["Client Engagement & Outreach"] : []),
      "Programme Performance",
      "Participant Needs & Accessibility",
      "Who Are We Serving?",
      "Gaps and Participation Barriers",
      "Planning & Actions",
      "Programme Alignment",
      "Custom Analysis",
      "Operations & Screening",
      "Social Risk Analysis",
      "Audience & Outreach",
      "Planning & Recommendations",
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
      if(process.argv.includes("--print-only") && width !== 1440) continue;
      await command("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await command("Page.navigate", { url: origin });
      await wait(
        "document.querySelector('h1')?.textContent === 'Management overview' && document.querySelector('.management-kpis[data-ready=true]') && !document.querySelector('.fetch-status')",
        "management overview",
      );
      for (const page of pages.filter(page => !process.argv.includes("--print-only") || page === "Management Overview")) {
        if (page !== "Management Overview") {
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
            `(() => { const menu = document.querySelector('.navigation-toggle'); if (innerWidth <= 650 && menu?.getAttribute('aria-expanded') === 'false') menu.click(); const button = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === ${JSON.stringify(page)}); if (!button) return false; const details = button.closest('details'); if (details && !details.open) details.querySelector('summary').click(); if (!button.getClientRects().length) return false; button.click(); return true; })()`,
          );
          if (!clicked) throw Error("Navigation missing: " + page);
          await wait(
            `document.querySelector('h1')?.textContent === ${JSON.stringify(page === "Planning & Actions" ? "Planning & Actions" : page === "Programme Performance" ? "Programme performance" : page === "Operations & Screening" ? "Operations & health screening" : page === "Audience & Outreach" ? "Audience & outreach gaps" : page === "Planning & Recommendations" ? "Programme planning recommendations" : page)} && !document.body.innerText.includes('Loading needs analysis') && !document.querySelector('.fetch-status')`,
            "page " + page,
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
        if (
          (width === 1440 || width === 768) &&
          [
            "Management Overview",
            "Who Are We Serving?",
            "Planning & Actions",
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
        if (page === "Management Overview") {
          await evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent==='Presentation View').click()",
          );
          await wait(
            "document.querySelectorAll('.report-slide').length === 6 && !document.querySelector('.presentation-toolbar button:last-child').disabled",
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
      join(output, process.argv.includes("--print-only") ? "print-results.json" : "results.json"),
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
