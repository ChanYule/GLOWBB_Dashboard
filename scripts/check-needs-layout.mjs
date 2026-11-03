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
import { createApp } from "../server/app.js";
import { openDb, readData, saveImport } from "../server/db.js";
import { readFile, inspectImport } from "../server/domain.js";
const source = process.argv[2];
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
  const pages = [
    "Management Overview",
    "Who Are We Serving?",
    "Gaps and Participation Barriers",
    "Programme Planning and Actions",
    "Programme Alignment",
    "Explore the Data",
    "Data Quality and Administration",
    "Data management",
  ];
  for (const [width, height] of [
    [1440, 1000],
    [1024, 768],
    [768, 1024],
    [390, 844],
  ]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command("Page.navigate", { url: origin });
    await wait(
      "document.querySelector('h1')?.textContent === 'Management overview' && document.querySelector('.metric-grid') && !document.querySelector('.fetch-status')",
      "management overview",
    );
    for (const page of pages) {
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
          `document.querySelector('h1')?.textContent === ${JSON.stringify(page === "Explore the Data" ? "Explore the Data" : page)} && !document.body.innerText.includes('Loading needs analysis') && !document.querySelector('.fetch-status')`,
          "page " + page,
        );
      }
      if (page === "Data management")
        await wait(
          "!!document.querySelector('.data-stat-grid')",
          "saved data inventory",
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
          "Programme Planning and Actions",
          "Data management",
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
      }
    }
  }
  if (errors.length)
    throw Error("Browser runtime errors: " + errors.join(" | "));
  writeFileSync(
    join(output, "results.json"),
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
