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
import { operationsReport } from "../server/operations.js";
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
const { DemographicBars, TrendChart, TimingMatrix, KpiDeck } = await tsImport(
  "../src/analytics-ui.tsx",
  import.meta.url,
);
const { OperationsPage } = await tsImport(
  "../src/operations-ui.tsx",
  import.meta.url,
);
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
test("application opens directly with import, settings and planning and no login controls", async () => {
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
    assert.ok(screen.getByRole("button", { name: "Import attendance" }));
    assert.ok(screen.getByRole("button", { name: "Data & settings" }));
    assert.equal(screen.queryByRole("button", { name: "Sign in" }), null);
    assert.equal(screen.queryByRole("button", { name: "Sign out" }), null);
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

test("application displays a useful hosting error and retry instead of a raw JSON parser exception", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("The page could not be found\nNOT_FOUND", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  try {
    render(React.createElement(App));
    await waitFor(() => assert.ok(screen.getByRole("alert")));
    assert.match(
      screen.getByRole("alert").textContent,
      /data service is not deployed or connected/,
    );
    assert.equal(
      screen.getByRole("alert").textContent.includes("Unexpected token"),
      false,
    );
    assert.ok(screen.getByRole("button", { name: "Try again" }));
    assert.equal(screen.queryByText("Make every connection count."), null);
  } finally {
    globalThis.fetch = original;
  }
});

test("demographic shares include unknown people and drill-down keeps the chosen category", () => {
  let chosen;
  render(
    React.createElement(DemographicBars, {
      items: [
        { label: "MALE", value: 1 },
        { label: "UNKNOWN", value: 1 },
      ],
      denominator: 2,
      onSelect: (label) => {
        chosen = label;
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show percentages" }));
  assert.equal(
    screen
      .getByRole("button", { name: "Show counts" })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.match(
    screen.getByText(/Percentages use all/).textContent,
    /including missing\/unknown/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Filter UNKNOWN" }));
  assert.equal(chosen, "UNKNOWN");
});
test("daily trends and domain portfolio drill-down update the global filters", () => {
  let next;
  render(
    React.createElement(Overview, {
      data: dashboard(),
      filters,
      setFilters: (value) => {
        next = value;
      },
      onProgramme: () => {},
    }),
  );
  fireEvent.change(screen.getByLabelText("Trend interval"), {
    target: { value: "day" },
  });
  assert.equal(next.interval, "day");
  fireEvent.click(screen.getByRole("button", { name: "Physical" }));
  assert.equal(next.domain, "Physical");
  fireEvent.click(
    screen.getByRole("button", { name: "First observed", exact: true }),
  );
  assert.ok(
    screen.getByRole("img", { name: /firstObserved participation over time/ }),
  );
});
test("charts and timing comparisons show explanations instead of single-point trends or sparse heatmaps", () => {
  const data = dashboard();
  render(React.createElement(TrendChart, { rows: data.trends.slice(0, 1) }));
  assert.ok(
    screen.getByText("Not enough historical data to show a meaningful trend."),
  );
  assert.equal(screen.queryByRole("img"), null);
  cleanup();
  render(React.createElement(TimingMatrix, { data }));
  assert.ok(screen.getByText("Not enough comparable time slots yet."));
  assert.equal(screen.queryByRole("table"), null);
});
test("KPI definitions are reachable by keyboard-native disclosures", () => {
  render(React.createElement(KpiDeck, { data: dashboard() }));
  const explanation = screen.getByLabelText(
    "How unique seniors reached is calculated",
  );
  fireEvent.click(explanation);
  assert.ok(explanation.parentElement.hasAttribute("open"));
  assert.ok(screen.getByText(/Distinct participants aged 60/));
});

test("age-band drill-down sends the numeric range expected by the shared API filter", () => {
  let next;
  render(
    React.createElement(Audience, {
      data: dashboard(),
      filters,
      setFilters: (value) => {
        next = value;
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Filter 60/ }));
  assert.equal(next.ageBand, "60-69");
});

function operationFixture() {
  return {
    ...operationsReport(
      readData(db),
      defaults,
      filters,
      [],
      { inactivityDays: null },
      "month",
      "2026-10-26",
    ),
    targets: [],
  };
}
test("operations screening uses reported totals and clearly leaves person-level metrics unavailable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(operationFixture());
  try {
    render(
      React.createElement(OperationsPage, {
        filters,
        data: dashboard(),
        user: { username: "staff", role: "admin" },
        onProgramme: () => {},
      }),
    );
    await waitFor(() => assert.ok(screen.getByText(/IB = clients/)));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Health Screening Overview",
        exact: true,
      }),
    );
    assert.ok(screen.getByText("SPPB Assessment"));
    assert.ok(screen.getByText("Tanita Assessment"));
    assert.equal(screen.getAllByText("Unique people assessed").length, 2);
    assert.ok(screen.getByText(/No assessment totals have been recorded/));
    fireEvent.click(
      screen.getByRole("button", { name: "Record monthly totals" }),
    );
    assert.ok(screen.getByLabelText("SPPB completed assessments"));
    assert.ok(screen.getByLabelText("Reported as of"));
    assert.ok(screen.getByText(/Leave unavailable values blank/));
  } finally {
    globalThis.fetch = original;
  }
});
test("operational report intervals refetch the shared filtered dataset and viewer controls stay read-only", async () => {
  const original = globalThis.fetch,
    requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return Response.json(operationFixture());
  };
  try {
    render(
      React.createElement(OperationsPage, {
        filters: { ...filters, client: "true" },
        data: dashboard(),
        user: { username: "viewer", role: "viewer" },
        onProgramme: () => {},
      }),
    );
    await waitFor(() => assert.ok(screen.getByText(/IB = clients/)));
    assert.equal(
      screen.queryByRole("button", { name: "Set operational target" }),
      null,
    );
    assert.equal(
      screen.queryByRole("button", { name: "Configure inactivity definition" }),
      null,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Operational report", exact: true }),
    );
    fireEvent.change(screen.getByLabelText("Report interval"), {
      target: { value: "week" },
    });
    await waitFor(() =>
      assert.ok(
        requested.some(
          (url) => url.includes("grain=week") && url.includes("client=true"),
        ),
      ),
    );
    assert.ok(screen.getByText(/Reset audience filters to export/));
    assert.equal(
      screen.queryByRole("link", { name: "Export aggregate CSV" }),
      null,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Health Screening Overview",
        exact: true,
      }),
    );
    assert.equal(
      screen.queryByRole("button", { name: "Record monthly totals" }),
      null,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("the integrated operations tab remains reachable when attendance is empty", async () => {
  const original = globalThis.fetch;
  const empty = {
    participants: [],
    programmes: [],
    sessions: [],
    attendance: [],
  };
  const core = {
    ...analytics(empty, defaults, {}, "2026-10-26"),
    settings: defaults,
    targets: [],
    decisions: [],
  };
  const report = {
    ...operationsReport(
      empty,
      defaults,
      {},
      [],
      { inactivityDays: null },
      "month",
      "2026-10-26",
    ),
    targets: [],
  };
  globalThis.fetch = async (url) =>
    Response.json(String(url).startsWith("/api/operations?") ? report : core);
  try {
    render(React.createElement(App));
    await waitFor(() =>
      assert.ok(screen.getByText("Make every connection count.")),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Operations & Screening" }),
    );
    await waitFor(() =>
      assert.ok(
        screen.getByRole("button", {
          name: "Health Screening Overview",
          exact: true,
        }),
      ),
    );
    assert.equal(screen.queryByText("Make every connection count."), null);
  } finally {
    globalThis.fetch = original;
  }
});
