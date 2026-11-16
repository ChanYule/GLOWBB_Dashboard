import { participationReport } from "../server/participation.js";
import { participationPatterns } from "../server/patterns.js";
import { locationFixture } from "./fixtures/location-state.js";
import { locationDefaults } from "../server/location-model.js";
import {clientOutreach} from '../server/client-outreach.js';
import {eventTypeReport} from '../server/event-report.js';
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
import { clientReport, CLIENT_SNAPSHOT } from "../server/client-domain.js";
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
const { render, screen, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const { Overview, Programmes, Audience, Planning, FilterBar, App } =
  await tsImport("../src/main.tsx", import.meta.url);
const { DemographicBars, TrendChart, TimingMatrix, KpiDeck } = await tsImport(
  "../src/analytics-ui.tsx",
  import.meta.url,
);
const { OperationsPage, ActivityScreening } = await tsImport(
  "../src/operations-ui.tsx",
  import.meta.url,
);
const { DataManagement } = await tsImport(
  "../src/data-management.tsx",
  import.meta.url,
);
const { ClientEngagement } = await tsImport(
  "../src/client-ui.tsx",
  import.meta.url,
);
const { ManagementHome } = await tsImport(
  "../src/management.tsx",
  import.meta.url,
);
const { ParticipationPatterns } = await tsImport(
  "../src/patterns-ui.tsx",
  import.meta.url,
);
const { AttendanceQuestions } = await tsImport('../src/attendance-questions-ui.tsx', import.meta.url);
const { ParticipationRateChart } = await tsImport('../src/participation-rate-chart.tsx', import.meta.url);
test('participation ranges keep all groups, sort naturally, pool without replacing originals and retain print evidence', () => {
  const groups = [
    { label: 'Block 100', registered: 40, unique: 20, rate: 50 },
    { label: 'Block 9', registered: 5, unique: 1, rate: 20 },
    { label: 'Block 10', registered: 15, unique: 2, rate: 13.3333 },
    { label: 'Missing', registered: 0, unique: 0, rate: null },
  ];
  const reliability = { cautionMinimum: 20, comparisonFloor: 10, overall: { rate: 38.3333 } };
  let props = { groups, dimension: 'block', reliability, sort: 'label', pool: false };
  let view;
  props.onSort = sort => { props = { ...props, sort }; view.rerender(React.createElement(ParticipationRateChart, props)); };
  props.onPool = pool => { props = { ...props, pool }; view.rerender(React.createElement(ParticipationRateChart, props)); };
  try {
    view = render(React.createElement(ParticipationRateChart, props));
    assert.deepEqual([...document.querySelectorAll('.reliability-row-heading strong')].map(el => el.textContent), ['Block 9', 'Block 10', 'Block 100', 'Missing']);
    assert.equal(screen.getAllByRole('img').length, 3);
    assert.equal(document.querySelectorAll('.reliability-reference').length, 3);
    assert.ok(screen.getByText(/\+11.7 pp vs overall/));
    assert.ok(screen.getByText(/Excluded from automatic highest\/lowest comparisons/));
    fireEvent.change(screen.getByLabelText('Sort participation groups'), { target: { value: 'size' } });
    assert.equal(document.querySelector('.reliability-row-heading strong').textContent, 'Block 100');
    fireEvent.click(screen.getByRole('button', { name: 'Pool small groups' }));
    assert.equal(document.querySelectorAll('.reliability-row').length, 5);
    assert.ok(screen.getByText('Other (small groups combined)'));
    assert.ok(screen.getByRole('img', { name: /Other.*3 of 20, 15%/ }));
    view.rerender(React.createElement(ParticipationRateChart, { ...props, printing: true }));
    assert.equal(screen.queryByLabelText('Sort participation groups'), null);
    assert.equal(document.querySelectorAll('.reliability-row').length, 5);
    assert.ok(screen.getByText(/Pooled comparison:/));
    assert.ok(screen.getAllByText(/plausible range/).length >= 3);
  } finally { cleanup(); }
});
test('registered age view includes younger attendance separately and selecting Below 60 opens their programmes', async () => {
  const original = globalThis.fetch, state = locationFixture(), queries = [];
  state.settings.staffAnalysisFull = true;
  const registered = state.registry.length;
  state.data.participants.push({ id: 'younger-nonclient', age: 59, client: false });
  for (const sessionId of ['s1', 's2', 's2']) state.data.attendance.push({ participantId: 'younger-nonclient', sessionId });
  globalThis.fetch = async input => {
    if (String(input) === '/api/preferences') return Response.json({ patterns: { scope: 'clients', dimension: 'age', from: '2026-11-01', to: '2026-11-03' } });
    const q = Object.fromEntries(new URL(String(input), 'http://local').searchParams); queries.push(q);
    return Response.json(participationPatterns(state, q, '2026-11-05'));
  };
  try {
    render(React.createElement(ParticipationPatterns, { user: { role: 'planner' }, revision: 0 }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'View below-60 attendance and programmes' })));
    const panel = screen.getByRole('heading', { name: 'Below 60 · attendance participants' }).closest('section');
    assert.ok(within(panel).getByText('1 unique participants'));
    assert.match(panel.textContent, /2 attendance entries/);
    assert.equal(screen.getByLabelText('Analysis population').value, 'clients');
    assert.equal(state.registry.length, registered);
    fireEvent.change(screen.getByLabelText('Specific participant group'), { target: { value: 'Below 60' } });
    await waitFor(() => assert.equal(screen.getByLabelText('Analysis population').value, 'overall'));
    await waitFor(() => assert.equal(screen.getByLabelText('Specific participant group').value, 'Below 60'));
    await waitFor(() => assert.ok(screen.getByRole('list', { name: 'Programme rankings for Below 60' })));
    assert.ok(within(screen.getByRole('list', { name: 'Programme rankings for Below 60' })).getByRole('button', { name: 'Repeated programme' }));
    assert.equal(screen.getByLabelText('Group comparison metric').value, 'unique');
    assert.equal(screen.queryByRole('option', { name: 'Client participation rate (%)' }), null);
    assert.ok(queries.some(q => q.scope === 'overall' && q.group === 'Below 60' && q.from === '2026-11-01' && q.to === '2026-11-03'));
    assert.equal(state.data.participants.find(p => p.id === 'younger-nonclient').client, false);
  } finally { cleanup(); globalThis.fetch = original; }
});
test('attendance Q&A keeps full denominators, follows period changes, hides stale answers and retries failed cards', async () => {
  const original = globalThis.fetch, queries = [], reviewed = [];
  let pending, failRisk = true;
  const makeReport = q => ({ dimension: q.dimension, scope: 'clients', basis: 'current', minimum: 0,
    registryComplete: true, ratesAvailable: true, comparisonSuppressed: false,
    period: { from: q.from, to: q.to }, groups: [
      { label: q.dimension === 'cfs' ? 'CFS 1 to 3' : 'Group A', registered: 20, unique: 10, rate: 50 },
      { label: q.dimension === 'cfs' ? 'CFS 7 to 8' : 'Group B', registered: 20, unique: 5, rate: 25 },
    ] });
  globalThis.fetch = async input => {
    const q = Object.fromEntries(new URL(String(input), 'http://local').searchParams); queries.push(q);
    if (q.dimension === 'risk' && failRisk) return Response.json({ error: 'Try again' }, { status: 503 });
    if (q.from === '2026-11-02' && q.dimension === 'cfs') return new Promise(resolve => { pending = () => resolve(Response.json(makeReport(q))); });
    return Response.json(makeReport(q));
  };
  try {
    const props = { query: { scope: 'overall', group: 'one person', second: 'age', from: '2026-11-01', to: '2026-11-03', domain: 'Physical' }, revision: '1', onReview: d => reviewed.push(d) };
    const view = render(React.createElement(AttendanceQuestions, props));
    await waitFor(() => assert.equal(screen.getAllByText(/25 percentage points lower/).length, 1));
    assert.equal(queries.length, 4);
    assert.ok(queries.every(q => q.scope === 'clients' && q.domain === 'Physical' && !q.group && !q.second));
    assert.ok(screen.getByText(/not a session attendance rate/));
    failRisk = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry answer' }));
    await waitFor(() => assert.equal(screen.queryByRole('alert'), null));
    fireEvent.click(screen.getAllByRole('button', { name: 'Explore this comparison' })[0]);
    assert.deepEqual(reviewed, ['cfs']);
    view.rerender(React.createElement(AttendanceQuestions, { ...props, query: { ...props.query, from: '2026-11-02' } }));
    await waitFor(() => assert.ok(pending));
    assert.equal(screen.queryByText(/25 percentage points lower/), null, 'old-period answers disappear while loading');
    pending();
    await waitFor(() => assert.ok(screen.getByText(/25 percentage points lower/)));
  } finally { cleanup(); globalThis.fetch = original; }
});
const { LocationAdmin } = await tsImport(
  "../src/location-admin.tsx",
  import.meta.url,
);
const {EventTypeInsights, EventTypePresentation}=await tsImport('../src/event-types-ui.tsx',import.meta.url);
const {ClientOutreach}=await tsImport('../src/client-outreach.tsx',import.meta.url);
test('outreach work list filters block and attendance without shrinking registered denominators, and opens the existing review flow',async()=>{
 const original=globalThis.fetch,state=locationFixture(),requests=[];let reviewed;
 globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);requests.push(body);return Response.json(clientOutreach(state,body,'2026-11-06'));};
 try{render(React.createElement(ClientOutreach,{user:{role:'planner'},dates:{from:'2026-11-01',to:'2026-11-03',asOf:'2026-11-03'},revision:0,onDates:()=>{},onReview:row=>reviewed=row}));await waitFor(()=>assert.equal(screen.getAllByRole('button',{name:'Review client / plan follow-up'}).length,25));assert.ok(screen.getByRole('heading',{name:'Age profile · all registered clients'}));fireEvent.change(screen.getByLabelText('Outreach list attendance'),{target:{value:'attending'}});fireEvent.change(screen.getByLabelText('Outreach block'),{target:{value:'213'}});await waitFor(()=>assert.equal(screen.getAllByRole('button',{name:'Review client / plan follow-up'}).length,10));fireEvent.click(screen.getAllByRole('button',{name:'Review client / plan follow-up'})[0]);assert.equal(reviewed.block,'213');assert.equal(reviewed.cfs,'4');assert.equal(reviewed.risk,'0');assert.equal(reviewed.employment,'Not recorded');assert.ok(reviewed.attendance>0);assert.equal(requests.at(-1).filters.block,'213');assert.equal(requests.at(-1).status,'attending');assert.ok(screen.getByText(/coverage denominators stay intact/));}finally{cleanup();globalThis.fetch=original;}
});
test('legacy Overall Programme Planning preferences normalize and display age attendance for the exact reported dates',async()=>{
 const original=globalThis.fetch,state=locationFixture(),requests=[];globalThis.fetch=async(input)=>{const url=String(input);if(url==='/api/preferences')return Response.json({patterns:{preset:'overall',scope:'overall',dimension:'age',metric:'rate',from:'2026-05-04',to:'2026-11-05',path:['api','participation-patterns']}});const q=Object.fromEntries(new URL(url,'http://local').searchParams);requests.push(q);return Response.json(participationPatterns(state,q,'2026-11-05'));};
 try{render(React.createElement(ParticipationPatterns,{user:{username:'Planner',role:'planner'},revision:0}));await waitFor(()=>assert.equal(document.querySelector('.patterns-page')?.getAttribute('aria-busy'),'false'));assert.equal(screen.getByLabelText('Analysis population').value,'overall');assert.equal(screen.getByLabelText('Analyse by').value,'age');assert.equal(requests[0].from,'2026-05-04');assert.equal(requests[0].to,'2026-11-05');assert.equal(Object.hasOwn(requests[0],'metric'),false);assert.equal(Object.hasOwn(requests[0],'path'),false);assert.equal(screen.queryByRole('alert')===null,true);assert.ok(screen.getByText(/saved view was updated/));fireEvent.click(screen.getByRole('button',{name:'More filters'}));assert.equal(screen.getByLabelText('Patterns from').value,'2026-05-04');fireEvent.change(screen.getByLabelText('Patterns to'),{target:{value:'2026-11-04'}});assert.equal(screen.getByLabelText('Analyse by').value,'age');}finally{cleanup();globalThis.fetch=original;}
});
test('participation API failures offer retry without discarding selected population or dates',async()=>{const original=globalThis.fetch;let calls=0;const state=locationFixture();globalThis.fetch=async input=>{if(String(input)==='/api/preferences')return Response.json({patterns:{scope:'overall',dimension:'gender',from:'2026-11-01',to:'2026-11-05'}});const q=Object.fromEntries(new URL(String(input),'http://local').searchParams);if(q.dimension==='gender'&&++calls===1)return Response.json({error:'Temporary database connection unavailable'},{status:503});return Response.json(participationPatterns(state,q,'2026-11-05'));};try{render(React.createElement(ParticipationPatterns,{user:{role:'planner'},revision:0}));await waitFor(()=>assert.ok(screen.getByRole('heading',{name:'Participation data could not be loaded'})));fireEvent.click(screen.getByRole('button',{name:'Retry participation analysis'}));await waitFor(()=>assert.equal(screen.queryByRole('alert')===null,true));assert.equal(screen.getByLabelText('Analyse by').value,'gender');assert.equal(screen.getByLabelText('Analysis population').value,'overall');assert.ok(document.querySelector('.patterns-main-grid'));assert.equal(calls,2);}finally{cleanup();globalThis.fetch=original;}});
test('programme mix keeps secondary analysis collapsed, switches measures and saves reviewed view preferences',async()=>{
 const original=globalThis.fetch,s=locationFixture();for(const session of s.data.sessions)session.optional={eventTypeRaw:'Learning, Social & Cognitive',eventTypes:['Learning','Social & Cognitive']};const queries=[];let saved;
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url==='/api/preferences')return Response.json({});if(url.startsWith('/api/event-types/report?')){queries.push(url);return Response.json(eventTypeReport(s,Object.fromEntries(new URL(url,'http://local').searchParams)));}if(url==='/api/event-types/preferences'){saved=JSON.parse(init.body);return Response.json({ok:true});}throw Error('Unexpected request '+url);};
 try{render(React.createElement(EventTypeInsights,{user:{username:'Planner',role:'planner'},initial:{from:'2026-11-01',to:'2026-11-03'}}));await waitFor(()=>assert.equal(screen.queryAllByText('How Is Our Programme Mix Distributed?').length,1));assert.equal(document.querySelector('details').open,false);assert.equal(document.querySelector('table caption')===null,true);fireEvent.change(screen.getByLabelText('Programme mix view'),{target:{value:'domain'}});fireEvent.change(screen.getByLabelText('Programme mix measure'),{target:{value:'unique'}});fireEvent.change(screen.getByLabelText('Event programme ranking'),{target:{value:'average'}});await waitFor(()=>assert.ok(queries.some(q=>q.includes('ranking=average'))));fireEvent.click(screen.getByText('Save programme-type view'));await waitFor(()=>assert.equal(saved.ranking,'average'));assert.equal(saved.from,'2026-11-01');assert.equal(screen.queryByText('Administrator Event Type label review')===null,true);assert.equal(JSON.stringify(queries).includes('factor=cfs'),false);}finally{cleanup();globalThis.fetch=original;}
});
test('Event Type viewer never requests protected analysis',()=>{const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No request expected');};try{render(React.createElement(EventTypeInsights,{user:{username:'Viewer',role:'viewer'}}));assert.equal(calls,0);assert.ok(screen.getByText(/require authorised staff access/));}finally{cleanup();globalThis.fetch=original;}});
test("administrator candidate review requires confirmation and uses the refreshed cache revision", async () => {
  const original = globalThis.fetch;
  let store = {
      ...locationDefaults(),
      revision: 0,
      serviceConfigured: true,
      sessionVenues: [],
    },
    saved,
    changed = 0;
  const candidate = {
    block: "212",
    street: "BUKIT BATOK STREET 21",
    postal: "650212",
    address: "212 BUKIT BATOK STREET 21 SINGAPORE 650212",
    lat: 1.35,
    lon: 103.75,
    source: "Synthetic OneMap candidate",
    status: "Awaiting verification",
  };
  globalThis.fetch = async (url, options) => {
    if (url === "/api/locations" && !options?.method)
      return Response.json(store);
    if (url === "/api/locations/search") {
      store = { ...store, revision: 1 };
      return Response.json({
        revision: 1,
        status: "Awaiting verification",
        candidates: [candidate],
      });
    }
    if (url === "/api/locations/settings") {
      saved = JSON.parse(options.body);
      store = { ...store, revision: 2, centre: saved.centre };
      return Response.json({ ok: true, revision: 2 });
    }
    return Response.json({ rows: [], total: 0, revision: store.revision });
  };
  try {
    render(React.createElement(LocationAdmin, { onChanged: () => changed++ }));
    await waitFor(() =>
      assert.ok(screen.getByText("Centre coordinates and reporting bands")),
    );
    fireEvent.click(screen.getByText("Centre coordinates and reporting bands"));
    const form = screen.getByLabelText("Building latitude").closest("form");
    fireEvent.change(
      within(form).getByLabelText("Location verification status"),
      { target: { value: "Verified" } },
    );
    assert.equal(
      within(form).getByRole("button", { name: "Save reviewed location" })
        .disabled,
      true,
    );
    fireEvent.click(
      within(form).getByRole("button", { name: "Find building candidates" }),
    );
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Review this candidate" })),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review this candidate" }),
    );
    fireEvent.change(
      within(form).getByLabelText("Location verification status"),
      { target: { value: "Verified" } },
    );
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.click(
      within(form).getByRole("button", { name: "Save reviewed location" }),
    );
    await waitFor(() => assert.equal(changed, 1));
    assert.equal(saved.revision, 1);
    assert.equal(saved.centre.lat, 1.35);
    assert.equal(saved.centre.confirm, true);
    assert.match(saved.centre.address, /#01-237/);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("location analysis separates distance measures, supports CFS strata and opens a reviewed outreach draft", async () => {
  const original = globalThis.fetch,
    calls = [],
    fixture = locationFixture();
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (options?.method && options.method !== "GET") writes++;
    if (url === "/api/preferences") return Response.json({ views: [] });
    const q = Object.fromEntries(
      new URL(String(url), "http://localhost").searchParams,
    );
    return Response.json(participationPatterns(fixture, q, "2026-11-05"));
  };
  try {
    render(
      React.createElement(ParticipationPatterns, {
        user: { role: "planner" },
        revision: 0,
        initialDimension: "distance",
      }),
    );
    await waitFor(() =>
      assert.ok(
        screen.getByRole("heading", { name: "Participation by Distance" }),
      ),
    );
    assert.ok(screen.getByText("Verified residential locations"));
    assert.equal(
      screen.queryByText("Administrator location verification"),
      null,
    );
    fireEvent.click(screen.getByRole('button',{name:'More filters'}));
    assert.equal(screen.getByLabelText("Distance measure").value, "walking");
    fireEvent.change(screen.getByLabelText("Distance measure"), {
      target: { value: "straight" },
    });
    await waitFor(() =>
      assert.ok(calls.some((url) => url.includes("distanceMetric=straight"))),
    );
    await waitFor(() =>
      assert.equal(
        document.querySelector(".patterns-page").getAttribute("aria-busy"),
        "false",
      ),
    );
    fireEvent.click(screen.getByText("Explore Distance and Other Factors"));
    await waitFor(() =>
      assert.ok(calls.some((url) => url.includes("second=cfs"))),
    );
    await waitFor(() =>
      assert.equal(
        document.querySelector(".patterns-page").getAttribute("aria-busy"),
        "false",
      ),
    );
    assert.ok(screen.getByLabelText("Focus secondary group"));
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Record proposed location follow-up",
      })[0],
    );
    await waitFor(() =>
      assert.ok(screen.getByRole("dialog", { name: "Review planning action" })),
    );
    assert.equal(
      writes,
      0,
      "opening an outreach draft does not save or send anything",
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("participation patterns loads one dimension, saves the staff view and prints a protected snapshot", async () => {
  const original = globalThis.fetch,
    calls = [];
  let saved;
  const group = {
    label: "60 to 69",
    registered: 20,
    unique: 10,
    noAttendance: 10,
    rate: 50,
    attendance: 20,
    programmes: 1,
    domains: 1,
    averageSessions: 2,
    repeat: 5,
    opportunity: 10,
    repeatRate: 50,
    firstObserved: 5,
    returning: 5,
  };
  const report = {
    dimension: "age",
    scope: "clients",
    basis: "current",
    group: group.label,
    ranking: "unique",
    period: { from: "2026-11-01", to: "2026-11-03" },
    coverage: { from: "2026-10-01", to: "2026-11-03" },
    minimum: 5,
    ratesAvailable: true,
    registryComplete: true,
    population: 20,
    completeness: 100,
    comparisonSuppressed: false,
    groups: [group],
    rankings: {
      suppressed: false,
      rows: [
        {
          id: "p",
          name: "Weekly movement",
          domain: "Physical",
          sessions: 2,
          unique: 10,
          attendance: 20,
          repeat: 5,
          repeatRate: 50,
        },
      ],
      total: 1,
      page: 0,
      limit: 5,
    },
    domainsAvailable: ["Physical"],
    domains: { suppressed: false, rows: [] },
    combined: null,
    programmeDetail: null,
    minority: null,
    reportedBarriers: { suppressed: false, rows: [] },
    findings: [
      {
        title: "Observed participation",
        evidence: "10 of 20 clients attended",
        interpretation: "Association only",
        investigate: "Review availability",
        action: "Ask for voluntary feedback",
      },
    ],
    limitations: ["Current attributes are not historical assessments"],
    metricsDefinition: { rate: "Participating clients / registered clients" },
  };
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (url === "/api/preferences") return Response.json({ views: [] });
    if (options?.method === "PUT") {
      saved = JSON.parse(options.body);
      return Response.json({ ok: true });
    }
    const q = new URL(String(url), "http://localhost").searchParams;
    return Response.json({ ...report, dimension: q.get("dimension") || "age" });
  };
  try {
    render(
      React.createElement(ParticipationPatterns, {
        user: { role: "admin" },
        revision: 0,
      }),
    );
    await waitFor(() =>
      assert.equal(
        document.querySelector(".patterns-page").getAttribute("aria-busy"),
        "false",
      ),
    );
    assert.equal(
      calls.filter((url) => url.startsWith("/api/participation-patterns?"))
        .length,
      5,
    );
    assert.ok(
      screen.getByRole("heading", { name: "Participant group comparison" }),
    );
    assert.equal(document.querySelectorAll(".patterns-kpis article").length, 4);
    assert.equal(document.querySelector(".patterns-page details").open, false);
    fireEvent.change(screen.getByLabelText('Analyse by'),{target:{value:'cfs'}});
    await waitFor(() =>
      assert.ok(calls.some((url) => url.includes("dimension=cfs"))),
    );
    await waitFor(() =>
      assert.equal(
        document.querySelector(".patterns-page").getAttribute("aria-busy"),
        "false",
      ),
    );
    fireEvent.click(screen.getByRole('button',{name:'More filters'}));
    fireEvent.click(screen.getByRole("button", { name: "Save preferred view" }));
    await waitFor(() => assert.equal(saved.dimension, "cfs"));
    fireEvent.click(screen.getByRole("button", { name: "Presentation / PDF" }));
    await waitFor(() =>
      assert.equal(
        document.querySelectorAll(".presentation .report-slide").length,
        4,
      ),
    );
    assert.equal(
      document
        .querySelector(".presentation")
        .textContent.includes("participant_id"),
      false,
    );
    assert.ok(document.querySelector('.presentation .reliability-interval'));
    assert.match(document.querySelector('.presentation').textContent, /n=20/);
    assert.match(document.querySelector('.presentation').textContent, /95% plausible range/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      assert.equal(document.querySelectorAll(".presentation").length, 0),
    );
    cleanup();
    calls.length = 0;
    render(
      React.createElement(ParticipationPatterns, {
        user: { role: "viewer" },
        revision: 0,
      }),
    );
    assert.ok(screen.getByRole("heading", { name: "Authorised staff access" }));
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
const { PresentationView } = await tsImport(
  "../src/presentation.tsx",
  import.meta.url,
);

test("management overview has four headline cards and presentation preserves the same figures without private records", async () => {
  const original = globalThis.fetch;
  const brief = {
    clients: {
      available: true,
      attendanceAvailable: true,
      summary: { registered: 100, attending: 30, noAttendance: 70, rate: 30 },
      populationNote: "Current registered clients",
    },
    needs: {
      respondents: 0,
      eligible: 100,
      note: "Missing responses remain unknown",
      interests: { suppressed: false, values: [], denominator: 0 },
    },
    actions: { total: 0, stages: {} },
  };
  let briefingCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/reporting/participation"))
      return Response.json(
        participationReport(readData(db), defaults, filters),
      );
    briefingCalls++;
    return Response.json(brief);
  };
  const filters = {
    from: "2026-10-01",
    to: "2026-10-31",
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
  try {
    render(
      React.createElement(ManagementHome, {
        data: dashboard(),
        filters,
        revision: 0,
        navigate: () => {},
        present: () => {},
      }),
    );
    await waitFor(() =>
      assert.equal(
        document.querySelector(".management-kpis").dataset.ready,
        "true",
      ),
    );
    assert.equal(document.querySelectorAll(".management-kpi").length, 4);
    const totalCard = screen
      .getByText("Total unique participants")
      .closest("article");
    assert.equal(
      totalCard.querySelector("strong").textContent,
      String(dashboard().summary.allAges),
    );
    assert.match(
      totalCard.querySelector("small").textContent,
      /All recorded ages/,
    );

    assert.equal(screen.queryByText("Registered clients"), null);
    assert.equal(screen.queryByText("No recorded attendance"), null);
    await waitFor(() =>
      assert.ok(screen.getByRole("columnheader", { name: "IB (%)" })),
    );
    assert.equal(
      screen.getByText("Review target-group outreach").closest("details").open,
      false,
    );
    assert.ok(screen.getByRole("button", { name: "Print summary" }));
    assert.equal(
      screen.getAllByRole("combobox", { name: "Chart focus" }).length,
      1,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Chart focus" }), {
      target: { value: "male" },
    });
    assert.ok(
      screen.getByRole("img", { name: /male participation over time/ }),
    );
    assert.deepEqual(
      [...document.querySelectorAll(".management-chart-grid .report-bar")].map(
        (row) => [
          row.querySelector("span").textContent,
          Number(row.querySelector("strong").textContent),
        ],
      ),
      [...dashboard().programmes]
        .sort((a, b) => b.male - a.male)
        .slice(0, 5)
        .map((p) => [p.name, p.male]),
    );
    cleanup();
    let closed = false;
    const privateData = {
      ...dashboard(),
      decisions: [
        { id: "private-id", notes: "PRIVATE NOTE", assigned: "PRIVATE OWNER" },
      ],
    };
    render(
      React.createElement(PresentationView, {
        data: privateData,
        briefing: brief,
        filters,
        revision: 0,
        close: () => {
          closed = true;
        },
      }),
    );
    await waitFor(() =>
      assert.equal(
        screen.getByRole("button", { name: "Print / Save as PDF" }).disabled,
        false,
      ),
    );
    assert.equal(document.querySelectorAll(".report-slide").length, 6);
    assert.equal(briefingCalls, 1);
    assert.equal(screen.queryByText("Registered clients"), null);
    assert.ok(screen.getAllByText("70").length);
    assert.equal(
      document
        .querySelector(".presentation")
        .textContent.includes("PRIVATE NOTE"),
      false,
    );
    assert.equal(
      document
        .querySelector(".presentation")
        .textContent.includes("PRIVATE OWNER"),
      false,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    assert.equal(closed, true);
    cleanup();
    assert.equal(document.body.classList.contains("presenting"), false);
    render(
      React.createElement(PresentationView, {
        data: dashboard(),
        filters: { ...filters, gender: "MALE" },
        revision: 0,
        close: () => {},
      }),
    );
    await waitFor(() => assert.ok(screen.getByText(/Reset audience filters/)));
    assert.equal(document.querySelectorAll(".report-slide").length, 0);
    assert.equal(
      screen.getByRole("button", { name: "Print / Save as PDF" }).disabled,
      true,
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
const { ClientRegistryImport } = await tsImport(
  "../src/client-import.tsx",
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
test("simple planning limits suggestions, supports search and preserves saved plans outside the attendance period", async () => {
  const original = globalThis.fetch;
  let savedRequest;
  globalThis.fetch = async (url, options) => {
    savedRequest = { url, body: JSON.parse(options.body) };
    return Response.json({ ok: true });
  };
  const data = dashboard();
  const example = data.recommendations[0];
  data.recommendations = Array.from({ length: 8 }, (_, i) => ({
    ...example,
    id: "suggestion-" + i,
    programme: "Programme " + i,
  }));
  const saved = {
    id: data.options.programmes[0].id,
    status: "In progress",
    assigned: "Staff owner",
    targetDate: "2026-12-01",
    plannedAction: "Contact facilitator",
    outcome: "Existing outcome",
    notes: "Existing resource assumptions",
  };
  data.decisions = [saved];
  let refreshed = false;
  try {
    render(
      React.createElement(Planning, {
        data,
        simple: true,
        user: { role: "admin" },
        refresh: () => {
          refreshed = true;
        },
        onTarget: () => {},
      }),
    );
    assert.equal(
      document.querySelectorAll(".recommendation-list article").length,
      5,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show 5 more programmes" }),
    );
    assert.equal(
      document.querySelectorAll(".recommendation-list article").length,
      8,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Find a programme or saved plan" }),
      { target: { value: "Programme 7" } },
    );
    assert.equal(
      document.querySelectorAll(".recommendation-list article").length,
      1,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Find a programme or saved plan" }),
      { target: { value: "Staff owner" } },
    );
    assert.ok(screen.getByText("Contact facilitator"));
    fireEvent.click(screen.getByRole("button", { name: "Review saved plan" }));
    assert.equal(
      screen.getByLabelText("Assigned staff member").value,
      saved.assigned,
    );
    assert.equal(screen.getByLabelText("Target date").value, saved.targetDate);
    fireEvent.click(
      screen.getByRole("button", { name: "Save planning decision" }),
    );
    await waitFor(() => assert.equal(refreshed, true));
    assert.equal(savedRequest.url, "/api/decisions/" + saved.id);
    const expected = { ...saved };
    delete expected.id;
    assert.deepEqual(savedRequest.body, expected);
  } finally {
    globalThis.fetch = original;
  }
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
  assert.equal(screen.queryByLabelText("From"), null);
  fireEvent.change(screen.getByLabelText("Reporting period"), {
    target: { value: "Custom range" },
  });
  assert.equal(screen.getByLabelText("Reporting period").value, "Custom range");
  assert.ok(screen.getByLabelText("From"));
  assert.ok(screen.getByLabelText("To"));
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
test("authenticated administrator sees imports, settings, planning and sign out", async () => {
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
          ? { username: "administrator", role: "admin" }
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
    const nav = document.querySelector("nav");
    assert.deepEqual(
      [...nav.querySelectorAll(":scope > button")].map((b) =>
        b.textContent.trim(),
      ),
      ["Main Dashboard", "Programme Analysis", "Planning"],
    );
    fireEvent.click(screen.getByText("Staff Tools"));
    assert.ok(screen.getByRole("button", { name: "Data management" }));
    assert.equal(
      screen.getByText("Custom Analysis").closest("details").open,
      false,
    );
    assert.equal(screen.queryByRole("button", { name: "Sign in" }), null);
    assert.ok(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Planning", exact: true }),
    );
    await waitFor(() =>
      assert.ok(screen.getByText("Outreach targets (optional)")),
    );
    fireEvent.click(screen.getByText("Outreach targets (optional)"));
    assert.ok(screen.getByRole("button", { name: "Set target" }));
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
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reported monthly totals",
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
    Response.json(
      String(url) === "/api/me"
        ? { username: "Local workspace", role: "admin" }
        : String(url).startsWith("/api/operations?")
          ? report
          : core,
    );
  try {
    render(React.createElement(App));
    await waitFor(() =>
      assert.ok(screen.getByText("Make every connection count.")),
    );
    fireEvent.click(screen.getByText("Staff Tools"));
    fireEvent.click(screen.getByText("Advanced analysis"));
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

test("screening participation switches between daily and monthly unique people without IB/OB columns", () => {
  const report = operationFixture();
  report.activityScreening = {
    activityNames: {
      sppb: "GLOW - SPPB Assessment",
      tanita: "GLOW - Tanita Body Measurements",
    },
    sppb: { people: 2, attendance: 3 },
    tanita: { people: 1, attendance: 1 },
    daily: [
      { label: "2026-05-01", sppbPeople: 2, tanitaPeople: 0 },
      { label: "2026-05-02", sppbPeople: 1, tanitaPeople: 1 },
    ],
    monthly: [{ label: "2026-05", sppbPeople: 2, tanitaPeople: 1 }],
  };
  render(React.createElement(ActivityScreening, { report }));
  const monthly = screen.getByRole("table", {
    name: "Screening activity unique people by month",
  });
  assert.ok(within(monthly).getByRole("row", { name: "2026-05 2 1" }));
  assert.equal(within(monthly).getAllByRole("columnheader").length, 3);
  fireEvent.change(screen.getByLabelText("Screening interval"), {
    target: { value: "day" },
  });
  const daily = screen.getByRole("table", {
    name: "Screening activity unique people by day",
  });
  assert.ok(within(daily).getByRole("row", { name: "2026-05-01 2 0" }));
  assert.ok(within(daily).getByRole("row", { name: "2026-05-02 1 1" }));
  assert.ok(
    screen.getByRole("img", {
      name: "Daily unique SPPB and Tanita participants",
    }),
  );
});

const { PersonalWorkspace, SocialRisk, validTypes } = await tsImport(
  "../src/workspace.tsx",
  import.meta.url,
);
test("personal dashboard saves selected KPIs, chart settings, order and filters and reloads them from the staff account", async () => {
  const original = globalThis.fetch;
  let prefs = { views: [], active: "", template: "Overview" };
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "/api/preferences");
    if (options?.method === "PUT") {
      prefs = JSON.parse(options.body);
      return Response.json({ ok: true });
    }
    return Response.json(prefs);
  };
  const props = {
    data: dashboard(),
    filters,
    setFilters: () => {},
    user: { username: "staff-one", role: "planner" },
  };
  try {
    const first = render(React.createElement(PersonalWorkspace, props));
    fireEvent.click(
      screen.getByRole("button", { name: "Customise My Dashboard" }),
    );
    await waitFor(() =>
      assert.equal(
        screen.getByRole("button", { name: "Save as New View" }).disabled,
        false,
      ),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Male seniors reached" }),
    );
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Monthly team discussion" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Chart 1 grouping" }),
      { target: { value: "domain" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Chart 1 display" }),
      { target: { value: "table" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save as New View" }));
    await waitFor(() => assert.equal(prefs.views.length, 1));
    assert.equal(prefs.views[0].name, "Monthly team discussion");
    assert.equal(prefs.views[0].kpis.includes("male"), false);
    assert.equal(prefs.views[0].charts[0].group, "domain");
    assert.equal(prefs.views[0].charts[0].type, "table");
    assert.deepEqual(prefs.views[0].filters, filters);
    first.unmount();
    render(React.createElement(PersonalWorkspace, props));
    await waitFor(() =>
      assert.ok(
        screen.getByRole("heading", { name: "Monthly team discussion" }),
      ),
    );
    assert.equal(
      screen.getByRole("combobox", { name: "Chart 1 display" }).value,
      "table",
    );
    assert.equal(validTypes("programme").includes("donut"), false);
    assert.equal(validTypes("month").includes("line"), true);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("viewer risk page never requests sensitive data and protected pages show suppression explanations", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      suppressed: true,
      limited: true,
      threshold: 5,
      note: "Protected full cohort",
      categories: [],
      states: [],
    });
  };
  try {
    const viewer = render(
      React.createElement(SocialRisk, {
        user: { username: "viewer", role: "viewer" },
      }),
    );
    assert.match(
      screen.getByText(/restricted to authorised/).textContent,
      /planners/,
    );
    assert.equal(calls, 0);
    viewer.unmount();
    render(
      React.createElement(SocialRisk, {
        user: { username: "planner", role: "planner" },
      }),
    );
    await waitFor(() => assert.ok(screen.getByText(/Breakdown withheld/)));
    assert.ok(screen.getByText(/Raw value 0 does not establish/));
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

const { NeedsPage, ParticipantEditor } = await tsImport(
  "../src/needs-ui.tsx",
  import.meta.url,
);
const needsDomain = await import("../server/needs-domain.js");
const catalogue = {
  interests: needsDomain.interests,
  needs: needsDomain.needs,
  barriers: needsDomain.barriers,
  informationSources: needsDomain.informationSources,
  needStates: needsDomain.needStates,
  actionStates: needsDomain.actionStates,
};
test("the needs dashboard restricts viewer access and makes the three analysis levels available without attendance", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({});
  };
  try {
    render(
      React.createElement(NeedsPage, {
        level: "profile",
        filters,
        user: { username: "viewer", role: "viewer" },
        onRefresh: () => {},
      }),
    );
    assert.ok(screen.getByText(/restricted to planners and administrators/));
    assert.equal(calls, 0);
    cleanup();
    const empty = { ...dashboard(), coverage: { from: null, to: null } };
    globalThis.fetch = async (url) =>
      Response.json(
        String(url) === "/api/me"
          ? { username: "Local workspace", role: "admin" }
          : String(url) === "/api/preferences"
            ? { views: [], active: "", template: "Overview" }
            : empty,
      );
    render(React.createElement(App));
    await waitFor(() =>
      assert.ok(screen.getByText("Make every connection count.")),
    );
    fireEvent.click(screen.getByText("Staff Tools"));
    fireEvent.click(screen.getByText("Advanced analysis"));
    for (const label of [
      "Who Are We Serving?",
      "Gaps and Participation Barriers",
      "Detailed action tracker",
      "Programme Alignment",
      "Data Quality and Administration",
    ])
      assert.ok(screen.getByRole("button", { name: label }));
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("staff can edit all eight profile sections without losing drafts and feedback requires voluntary consent", async () => {
  const original = globalThis.fetch;
  const data = readData(db),
    base = {
      ...data.participants[0],
      livingRaw: "Alone",
      maritalRaw: "SINGLE",
      riskRaw: "0",
    };
  let savedProfile, feedback;
  let revision = 0;
  const detail = () => ({
    base,
    current: base,
    revision,
    details: savedProfile?.details || {},
    updated: null,
    notice: "Latest-known fixture profile.",
    history: needsDomain.participantHistory(data, base.id, "2026-10-26"),
    feedback: [],
  });
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/needs/catalogue") return Response.json(catalogue);
    if (path === "/api/participants/lookup")
      return Response.json({ id: base.id });
    if (path.endsWith("/profile")) {
      savedProfile = JSON.parse(options.body);
      revision++;
      return Response.json({ revision });
    }
    if (path.endsWith("/feedback")) {
      feedback = JSON.parse(options.body);
      return Response.json({ id: "saved" });
    }
    if (path === "/api/participants/" + base.id) return Response.json(detail());
    throw Error("Unexpected request " + path);
  };
  try {
    render(React.createElement(ParticipantEditor, { onSaved: () => {} }));
    fireEvent.change(screen.getByLabelText("Exact Member ID"), {
      target: { value: "fixture-member" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find participant" }));
    await waitFor(() => assert.equal(screen.getAllByRole("tab").length, 8));
    fireEvent.click(
      screen.getByRole("tab", { name: "Health and Functional Profile" }),
    );
    fireEvent.change(screen.getByLabelText("Mobility support information"), {
      target: { value: "Participant requested a seated option" },
    });
    fireEvent.click(
      screen.getByRole("tab", { name: "Care and Support Needs" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add support need" }));
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "Transport assistance" },
    });
    fireEvent.change(screen.getByLabelText("Information state"), {
      target: { value: "Not assessed" },
    });
    fireEvent.click(
      screen.getByRole("tab", { name: "Interests and Programme Preferences" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Games" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Arts and crafts" }));
    fireEvent.click(screen.getByRole("tab", { name: "Staff Follow-Up" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Follow-up required" }),
    );
    fireEvent.change(screen.getByLabelText("Assigned staff member"), {
      target: { value: "Assigned planner" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review and save profile" }),
    );
    await waitFor(() => assert.ok(savedProfile));
    assert.equal(
      savedProfile.details.health.mobility,
      "Participant requested a seated option",
    );
    assert.equal(savedProfile.details.needs[0].status, "Not assessed");
    assert.deepEqual(savedProfile.details.preferences.interests, [
      "Games",
      "Arts and crafts",
    ]);
    assert.equal(savedProfile.details.followUp.assigned, "Assigned planner");
    assert.equal(savedProfile.effectiveDate, "");
    assert.equal(savedProfile.revision, 0);
    await waitFor(() =>
      assert.equal(
        screen.getByRole("button", { name: "Review and save profile" })
          .disabled,
        false,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Collect voluntary survey / staff feedback",
      }),
    );
    assert.equal(
      screen.getByRole("button", { name: "Review and save feedback" }).disabled,
      true,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Responses are voluntary/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review and save feedback" }),
    );
    await waitFor(() => assert.ok(feedback));
    assert.equal(feedback.consent, true);
    assert.equal(feedback.method, "survey");
    assert.deepEqual(feedback.preferences, {});
    assert.deepEqual(feedback.barriers, []);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("data management requires a preview and typed confirmation, supports cancel and offers a reviewed undo", async () => {
  const original = globalThis.fetch;
  const counts = {
    attendance: 12,
    participants: 5,
    programmes: 2,
    sessions: 3,
    profiles: 2,
    feedback: 1,
    actions: 1,
    registryRows: 0,
    assessments: 0,
    targets: 0,
  };
  const calls = [],
    changes = [];
  const inventory = {
    counts,
    imports: [
      { id: 1, created: "2026-11-03T02:00:00Z", imported: 12, remaining: 12 },
    ],
    backups: [],
  };
  globalThis.fetch = async (url, options) => {
    const path = String(url),
      body = options?.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path === "/api/data-management") return Response.json(inventory);
    if (path.endsWith("/preview"))
      return Response.json({
        id: "review",
        operation: body.operation || "delete",
        selection: body,
        counts: {
          ...counts,
          ...(body.operation === "restore"
            ? {}
            : {
                participants: 0,
                profiles: 0,
                programmes: 0,
                feedback: 0,
                actions: 0,
              }),
        },
        current: counts,
        affectedPeople: 5,
        confirmation:
          body.operation === "restore" ? "RESTORE DATA" : "DELETE ATTENDANCE",
      });
    if (path.endsWith("/confirm"))
      return Response.json({ operation: "delete", backupId: "saved-recovery" });
    throw Error("Unexpected request " + path);
  };
  try {
    render(
      React.createElement(DataManagement, {
        onImport: () => {},
        onDefinitions: () => {},
        onReporting: () => {},
        onChanged: (message) => changes.push(message),
      }),
    );
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Choose data to delete" })),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose data to delete" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /All attendance/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review deletion" }));
    await waitFor(() =>
      assert.ok(screen.getByRole("dialog", { name: "Review data deletion" })),
    );
    assert.equal(
      screen.getByRole("button", { name: "Delete selected data" }).disabled,
      true,
    );
    assert.equal(
      calls.some((c) => c.path.endsWith("/confirm")),
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    assert.equal(screen.queryByRole("dialog"), null);
    assert.equal(
      calls.some((c) => c.path.endsWith("/confirm")),
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review deletion" }));
    await waitFor(() => assert.ok(screen.getByRole("dialog")));
    fireEvent.change(
      screen.getByLabelText("Type DELETE ATTENDANCE to confirm"),
      { target: { value: "DELETE ATTENDANCE" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected data" }),
    );
    await waitFor(() => assert.ok(changes.length));
    assert.equal(
      calls.find((c) => c.path.endsWith("/confirm")).body.confirmation,
      "DELETE ATTENDANCE",
    );
    assert.equal(screen.queryByRole("dialog"), null);
    fireEvent.click(screen.getByRole("button", { name: "Review undo" }));
    await waitFor(() =>
      assert.ok(screen.getByRole("dialog", { name: "Review data restore" })),
    );
    assert.equal(
      screen.getByRole("button", { name: "Restore data" }).disabled,
      true,
    );
    assert.equal(
      calls.findLast(
        (c) => c.path.endsWith("/preview") && c.body?.operation === "restore",
      ).body.backupId,
      "saved-recovery",
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("data management shows an empty state and requires a separate confirmation to permanently delete a backup", async () => {
  const original = globalThis.fetch;
  let deletion;
  const emptyCounts = {
    attendance: 0,
    participants: 0,
    programmes: 0,
    sessions: 0,
    profiles: 0,
    feedback: 0,
    actions: 0,
    registryRows: 0,
    assessments: 0,
    targets: 0,
  };
  globalThis.fetch = async (url, options) => {
    if (options?.method === "DELETE") {
      deletion = JSON.parse(options.body);
      return Response.json({ ok: true });
    }
    return Response.json({
      counts: emptyCounts,
      imports: [],
      backups: [
        {
          id: "backup",
          created: "2026-11-03T02:00:00Z",
          reason: "Before deleting attendance",
          attendance: 12,
          restorable: true,
        },
      ],
    });
  };
  try {
    render(
      React.createElement(DataManagement, {
        onImport: () => {},
        onDefinitions: () => {},
        onReporting: () => {},
        onChanged: () => {},
      }),
    );
    await waitFor(() =>
      assert.ok(screen.getByText("No attendance imports yet")),
    );
    fireEvent.click(screen.getByRole("button", { name: /Backups/ }));
    assert.equal(
      screen.getByRole("link", { name: "Download" }).getAttribute("href"),
      "/api/backups/backup",
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete backup from/ }));
    assert.equal(
      screen.getByRole("button", { name: "Delete backup permanently" })
        .disabled,
      true,
    );
    fireEvent.change(screen.getByLabelText("Type DELETE BACKUP to confirm"), {
      target: { value: "DELETE BACKUP" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete backup permanently" }),
    );
    await waitFor(() => assert.ok(deletion));
    assert.equal(deletion.confirmation, "DELETE BACKUP");
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
function clientFixtureReport() {
  const people = Array.from({ length: 20 }, (_, i) => ({
    id: "client-" + i,
    memberId: "C" + i,
    age: 75,
    gender: "MALE",
    race: "MALAY",
    cfs: "1-3",
    riskRaw: "0",
    livingRaw: "Alone",
    blockRaw: "101",
    client: true,
    membershipStatus: "Active",
  }));
  return clientReport(
    {
      data: {
        participants: people,
        programmes: [],
        sessions: [],
        attendance: [],
      },
      profiles: [],
      feedback: [],
      registry: people.map((p) => ({
        participant_id: p.id,
        snapshot: CLIENT_SNAPSHOT,
        details: JSON.stringify(p),
      })),
      settings: {
        ...defaults,
        registry: {
          type: "clients",
          complete: true,
          snapshot: CLIENT_SNAPSHOT,
          asOf: "2026-11-03",
        },
      },
    },
    {},
    "2026-11-03",
  );
}
test("client engagement denies viewers without requesting client data and saves selected cards and comparisons independently", async () => {
  const original = globalThis.fetch;
  let requests = 0,
    reportRequests = 0,
    saved;
  globalThis.fetch = async (url, options) => {
    requests++;
    if (String(url) === "/api/clients/preferences") {
      if (options?.method === "PUT") {
        saved = JSON.parse(options.body);
        return Response.json({ ok: true });
      }
      return Response.json({ views: [], sharedTemplates: [] });
    }
    if (String(url) === "/api/clients/report") {
      reportRequests++;
      return Response.json(clientFixtureReport());
    }
    throw Error("Unexpected request " + url);
  };
  try {
    const viewer = render(
      React.createElement(ClientEngagement, {
        user: { username: "viewer", role: "viewer" },
        initialFilters: filters,
        onChanged: () => {},
      }),
    );
    assert.ok(screen.getByText(/restricted to authorised planners/));
    assert.equal(requests, 0);
    viewer.unmount();
    const planner = render(
      React.createElement(ClientEngagement, {
        user: { username: "planner", role: "planner" },
        initialFilters: filters,
        onChanged: () => {},
      }),
    );
    await waitFor(() =>
      assert.ok(screen.getAllByText("Registered clients").length > 0),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Customise client view" }),
    );
    fireEvent.change(screen.getByLabelText("Ready-made client view"), {
      target: { value: "Living Arrangement Analysis" },
    });
    fireEvent.change(screen.getByLabelText("New client view name"), {
      target: { value: "Weekly living review" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save as new client view" }),
    );
    await waitFor(() => assert.ok(saved));
    assert.equal(saved.views[0].name, "Weekly living review");
    assert.deepEqual(saved.views[0].charts, ["living"]);
    assert.ok(saved.views[0].kpis.includes("livingAloneNoAttendance"));
    await waitFor(() =>
      assert.equal(
        screen.queryByText("Calculating linked client participation…"),
        null,
      ),
    );
    const beforeRefresh = reportRequests;
    planner.rerender(
      React.createElement(ClientEngagement, {
        user: { username: "planner", role: "planner" },
        initialFilters: filters,
        dataRevision: 1,
        onChanged: () => {},
      }),
    );
    await waitFor(() => assert.ok(reportRequests > beforeRefresh));
    assert.equal(
      screen.queryByRole("button", {
        name: "Share administrator client template",
      }),
      null,
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("client registry UI reviews conflicts and requires staff review before confirmation", async () => {
  const original = globalThis.fetch,
    originalFormData = globalThis.FormData;
  let confirmed;
  globalThis.FormData = dom.window.FormData;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/preview"))
      return Response.json({
        id: "registry-preview",
        rows: 2,
        matched: 1,
        newProfiles: 1,
        clients: 2,
        withinBoundary: 2,
        missingLiving: 0,
        enrichments: 1,
        omitted: 1,
        duplicates: 0,
        issues: [],
        conflicts: [
          {
            key: "gender-key",
            memberId: "C1",
            label: "Gender",
            existing: "MALE",
            incoming: "FEMALE",
            protectedReview: false,
            source: "Attendance profile",
          },
        ],
        note: "Attendance preserved",
      });
    confirmed = JSON.parse(options.body);
    return Response.json({ created: 1, changed: 1, conflictsKept: 0 });
  };
  try {
    render(React.createElement(ClientRegistryImport, { onSaved: () => {} }));
    const file = new dom.window.File(["fixture"], "registry.xlsx");
    fireEvent.change(screen.getByLabelText("Client registry file"), {
      target: { files: [file] },
    });
    fireEvent.submit(
      screen.getByLabelText("Client registry file").closest("form"),
    );
    await waitFor(() =>
      assert.ok(
        screen.getByRole("button", { name: "Confirm client registry" }),
      ),
    );
    assert.equal(
      screen.getByRole("button", { name: "Confirm client registry" }).disabled,
      true,
    );
    assert.ok(screen.getByText(/previously registered clients are absent/));
    fireEvent.click(screen.getByLabelText("Approve Gender for C1"));
    fireEvent.click(screen.getByLabelText(/I reviewed the matches/));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm client registry" }),
    );
    await waitFor(() => assert.ok(confirmed));
    assert.deepEqual(confirmed.approvedFields, ["gender-key"]);
    assert.equal(confirmed.complete, false);
  } finally {
    cleanup();
    globalThis.fetch = original;
    globalThis.FormData = originalFormData;
  }
});
test("client follow-up keeps clinical classifications out of the default table and records sourced voluntary feedback without sending messages", async () => {
  const original = globalThis.fetch;
  let contact;
  const followupQueries = [];
  const row = {
    id: "client-0",
    memberId: "C0",
    age: 75,
    living: "Alone",
    block: "101",
    last: null,
    status: "no-history",
    attendance: 0,
    followUp: "Not contacted",
    assigned: "",
    lastContact: null,
    profileRevision: 0,
    membershipRevision: 1,
  };
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/clients/preferences")
      return Response.json({ views: [] });
    if (path === "/api/clients/report")
      return Response.json(clientFixtureReport());
    if (path === "/api/clients/followups") {
      followupQueries.push(JSON.parse(options.body));
      return Response.json({
        rows: [row],
        total: 1,
        notice: "Authorised staff only",
      });
    }
    if (path.endsWith("/source"))
      return Response.json({
        current: { membershipStatus: "Active", revision: 1, fieldSources: {} },
        contacts: [],
      });
    if (path === "/api/needs/catalogue")
      return Response.json({
        interests: [],
        needs: [],
        barriers: [],
        informationSources: ["Staff-observed", "Participant-reported"],
        needStates: [],
        actionStates: [],
      });
    if (path === "/api/participants/client-0")
      return Response.json({
        base: {
          id: row.id,
          age: 75,
          gender: "MALE",
          race: "MALAY",
          client: true,
          boundary: true,
        },
        current: {},
        details: {},
        revision: 0,
        history: {
          attendance: 0,
          programmes: 0,
          domains: 0,
          sessions: 0,
          first: null,
          last: null,
          status: "No recorded attendance",
          rows: [],
        },
        feedback: [],
      });
    if (path.endsWith("/contact")) {
      contact = JSON.parse(options.body);
      return Response.json({ ok: true });
    }
    throw Error("Unexpected request " + path);
  };
  try {
    render(
      React.createElement(ClientEngagement, {
        user: { username: "planner", role: "planner" },
        initialFilters: filters,
        onChanged: () => {},
      }),
    );
    await waitFor(() =>
      assert.ok(screen.getAllByText("Registered clients").length > 0),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Client follow-up list" }),
    );
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Open follow-up" })),
    );
    const requestsBeforeSearch = followupQueries.length;
    const search = screen.getByPlaceholderText("Search saved client records");
    fireEvent.change(search, { target: { value: "C" } });
    fireEvent.change(search, { target: { value: "C00" } });
    fireEvent.change(search, { target: { value: "C0" } });
    assert.ok(
      screen.getByRole("button", { name: "Open follow-up" }),
      "Existing rows should remain visible during search",
    );
    await waitFor(() => assert.equal(followupQueries.at(-1).search, "C0"));
    assert.equal(
      followupQueries.length,
      requestsBeforeSearch + 1,
      "Typing should produce only the final search request",
    );
    assert.equal(screen.queryByRole("columnheader", { name: "CFS" }), null);
    assert.equal(screen.queryByRole("columnheader", { name: "SRF" }), null);
    fireEvent.click(screen.getByRole("button", { name: "Open follow-up" }));
    await waitFor(() =>
      assert.ok(screen.getByRole("dialog", { name: "Client follow-up · C0" })),
    );
    fireEvent.change(screen.getByLabelText("Contact outcome"), {
      target: { value: "Follow-up required" },
    });
    fireEvent.change(screen.getByLabelText("Information source"), {
      target: { value: "Participant-reported" },
    });
    fireEvent.click(screen.getByLabelText("Lack of programme awareness"));
    fireEvent.click(screen.getByLabelText(/I have permission to record/));
    fireEvent.click(
      screen.getByRole("button", { name: "Save reviewed contact" }),
    );
    await waitFor(() => assert.ok(contact));
    assert.equal(contact.source, "Participant-reported");
    assert.deepEqual(contact.barriers, ["Lack of programme awareness"]);
    assert.equal(contact.profileRevision, 0);
    assert.equal(contact.permission, true);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
test("outreach action forms keep missing stage counts blank and save staff-reviewed planning rather than sending messages", async () => {
  const original = globalThis.fetch;
  const report = needsDomain.needsAnalysis(
    readData(db),
    [],
    [],
    [],
    defaults,
    {},
    "2026-10-26",
  );
  let saved;
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.startsWith("/api/needs/overview")) return Response.json(report);
    if (path === "/api/needs/actions") return Response.json([]);
    if (path.startsWith("/api/needs/actions/") && options?.method === "PUT") {
      saved = JSON.parse(options.body);
      return Response.json({ revision: 1 });
    }
    throw Error("Unexpected request " + path);
  };
  try {
    render(
      React.createElement(NeedsPage, {
        level: "actions",
        filters,
        user: { username: "planner", role: "planner" },
        onRefresh: () => {},
      }),
    );
    await waitFor(() =>
      assert.ok(
        screen.getByRole("button", { name: "Create targeted outreach plan" }),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create targeted outreach plan" }),
    );
    assert.ok(screen.getByRole("dialog", { name: "Review planning action" }));
    fireEvent.change(screen.getByLabelText("Action title"), {
      target: { value: "Review stated language preferences" },
    });
    fireEvent.change(screen.getByLabelText("Staff owner"), {
      target: { value: "Planner" },
    });
    assert.equal(screen.getByLabelText("Number attended").value, "");
    fireEvent.click(
      screen.getByRole("button", { name: "Save reviewed action" }),
    );
    await waitFor(() => assert.ok(saved));
    assert.equal(saved.kind, "outreach");
    assert.equal(saved.owner, "Planner");
    assert.equal(saved.attended, null);
    assert.equal(saved.contacted, null);
    assert.equal(saved.status, "Proposed");
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});


test("programme classification table keeps secondary labels on one metric row and paginates without losing programmes", async () => {
  const {ProgrammeClassificationTable} = await tsImport('../src/programme-classification-table.tsx', import.meta.url);
  const rows = Array.from({length:25}, (_, i) => ({id:String(i),name:`Programme ${String(i).padStart(2,'0')}`,primaryDomain:'Physical',subDomains:['Learning','Social & Cognitive'],sessions:2,unique:10,repeat:10,averageSessions:2}));
  try {
    render(React.createElement(ProgrammeClassificationTable,{rows}));
    const table = screen.getByRole('table',{name:'Programme domains and sub-domains'});
    assert.ok(within(table).getByRole('columnheader',{name:'Domains'}));
    assert.equal(within(table).queryByRole('columnheader',{name:'Primary Domain'}),null);
    assert.equal(within(table).getAllByRole('row').length,21);
    const first = within(table).getByRole('rowheader',{name:'Programme 00'}).closest('tr');
    assert.ok(within(first).getByText('Physical, Learning, Social, Cognitive'));
    assert.equal(within(first).getAllByRole('cell').length,5);
    fireEvent.click(screen.getByRole('button',{name:'Next classifications'}));
    assert.equal(within(table).getAllByRole('row').length,6);
    assert.ok(screen.getByText('Programme 24'));
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Programme 03'}});
    assert.equal(within(table).getAllByRole('row').length,2);
    assert.ok(screen.getByText('Programme 03'));
    cleanup();
    render(React.createElement(EventTypePresentation,{report:{period:{from:'2026-10-01',to:'2026-10-31'},target:'seniors',programmeClassifications:rows,findings:[],alignment:'Feedback needed',limitations:[]}}));
    assert.equal(screen.getAllByRole('table').length,4);
    assert.equal(screen.getAllByRole('rowheader').length,25);
    assert.equal(screen.queryByRole('searchbox'),null);
    assert.ok(screen.getByText('Programme 24'));
  } finally {cleanup();}
});
