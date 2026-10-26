import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import React from "react";
import { tsImport } from "tsx/esm/api";
import {
  analytics,
  defaults,
  parseRows,
  HEADERS,
  inspectImport,
} from "../server/domain.js";
import { openDb, readData, saveImport, passwordHash } from "../server/db.js";
registerHooks({
  load(url, context, next) {
    if (new URL(url).pathname.endsWith(".css"))
      return { format: "module", source: "export {};", shortCircuit: true };
    return next(url, context);
  },
});
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLDialogElement",
  "Node",
  "MutationObserver",
  "Event",
  "MouseEvent",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
const { render, screen, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const { Overview, Programmes, Audience, Planning, FilterBar, App } =
  await tsImport("../src/main.tsx", import.meta.url);
const db = openDb(":memory:");
db.prepare("INSERT INTO users VALUES(1,?,?,?)").run(
  "admin",
  passwordHash("test-password-long"),
  "admin",
);
const fields = (id, gender, race, programme, domain, detail) => [
  id,
  gender,
  "65",
  race,
  "CFS-value",
  "YES",
  "YES",
  programme,
  domain,
  detail,
];
const parsed = parseRows([
  HEADERS,
  fields(
    "one",
    "MALE",
    "MALAY",
    "Movement",
    "Physical",
    "2026-05-04, 09:00 AM - 10:00 AM",
  ),
  fields(
    "two",
    "FEMALE",
    "CHINESE",
    "A very long programme title that should wrap naturally without truncating important staff information",
    "Social",
    "2026-06-04, 01:00 PM - 02:00 PM",
  ),
]);
saveImport(db, parsed, inspectImport(parsed, readData(db)), 1);
function dashboard(filters = {}) {
  return {
    ...analytics(readData(db), defaults, filters, "2026-10-26"),
    settings: defaults,
    targets: [],
    decisions: [],
  };
}
const filters = {
  from: "",
  to: "2026-10-26",
  domain: "",
  programme: "",
  target: "all",
  interval: "month",
  gender: "",
  race: "",
  client: "",
  boundary: "",
  ageBand: "",
};
test.after(() => {
  db.close();
  dom.window.close();
});
test.afterEach(() => cleanup());
test("overview uses observed fixture counts, selectable accessible trends and programme details", () => {
  let selected = null;
  render(
    React.createElement(Overview, {
      data: dashboard(),
      filters,
      setFilters: () => {},
      onProgramme: (p) => {
        selected = p;
      },
    }),
  );
  assert.ok(screen.getByText("Unique seniors reached"));
  assert.ok(
    screen.getByText(
      "First observed does not mean new to the centre. Repeat engagement can include first-observed seniors.",
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Male seniors", exact: true }),
  );
  assert.equal(
    screen
      .getByRole("button", { name: "Male seniors", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Explore the leading programme" }),
  );
  assert.ok(selected);
  assert.ok(screen.getByRole("img", { name: /male participation over time/ }));
});
test("programme search and sorting preserve details affordance", () => {
  let chosen = null;
  render(
    React.createElement(Programmes, {
      data: dashboard(),
      onProgramme: (p) => {
        chosen = p;
      },
    }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search programme names" }),
    { target: { value: "Movement" } },
  );
  assert.equal(screen.queryByText(/A very long programme title/), null);
  fireEvent.click(screen.getByRole("button", { name: /Movement/ }));
  assert.equal(chosen.name, "Movement");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search programme names" }),
    { target: { value: "No match" } },
  );
  assert.ok(screen.getByText("No programmes match your search."));
});
test("audience shows missing-field and small-sample explanations", () => {
  render(React.createElement(Audience, { data: dashboard() }));
  assert.ok(screen.getByText(/Counts below five are small samples/));
  assert.ok(screen.getByText(/At least 3 recorded sessions/));
  assert.ok(screen.getByText(/No assumptions are made about isolation/));
});
test("planning uses role-specific actions and 3/6-month planning horizon", () => {
  render(
    React.createElement(Planning, {
      data: dashboard(),
      user: { username: "viewer", role: "viewer" },
      refresh: () => {},
      onTarget: () => {},
    }),
  );
  assert.equal(screen.queryByRole("button", { name: "Set target" }), null);
  assert.equal(
    screen.queryByRole("button", { name: "Update planning decision" }),
    null,
  );
  fireEvent.click(screen.getByRole("button", { name: "6 months" }));
  assert.ok(screen.getByText("A thoughtful plan for the next 6 months"));
  fireEvent.click(screen.getByRole("button", { name: /Pilot/ }));
  assert.ok(screen.getByText(/No pilot recommendations/));
});
test("global filters expand, submit exact filter changes and reset", () => {
  let next;
  render(
    React.createElement(FilterBar, {
      data: dashboard(),
      filters,
      setFilters: (f) => {
        next = f;
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "More filters" }));
  assert.equal(
    screen
      .getByRole("button", { name: "More filters" })
      .getAttribute("aria-expanded"),
    "true",
  );
  fireEvent.change(screen.getByLabelText("Recorded race"), {
    target: { value: "MALAY" },
  });
  assert.equal(next.race, "MALAY");
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  assert.equal(next.race, "");
});
test("empty application permits planning targets while guarding administrator import UI", async () => {
  const original = globalThis.fetch;
  const empty = {
    ...dashboard(),
    coverage: { from: null, to: null },
    summary: { ...dashboard().summary, attendance: 0 },
  };
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url) === "/api/me"
          ? { username: "planner", role: "planner" }
          : empty,
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    render(React.createElement(App));
    await waitFor(() =>
      assert.ok(screen.getByText("Make every connection count.")),
    );
    assert.equal(
      screen.queryByRole("button", { name: "Import attendance" }),
      null,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Planning & Recommendations" }),
    );
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Set target" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Set target" }));
    assert.ok(screen.getByRole("dialog", { name: "Set an outreach target" }));
  } finally {
    globalThis.fetch = original;
  }
});
