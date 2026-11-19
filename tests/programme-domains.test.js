import test from "node:test";
import assert from "node:assert/strict";
import {
  activityDomains,
  PROGRAMME_DOMAINS,
  validDomainMapping,
} from "../shared/activity-domains.js";
import {
  combinedDomainData,
  domainMatches,
  sessionDomains,
} from "../server/programme-domains.js";
import { programmeDomainReport } from "../server/event-report.js";
import {
  HEADERS,
  defaults,
  parseRows,
  inspectImport,
  analytics,
} from "../server/domain.js";
import { openDb, readData, saveImport } from "../server/db.js";
import { createApp } from "../server/app.js";

test("only exact approved five-domain tokens, delimiters and explicit spelling alias contribute", () => {
  for (const [primary, secondary, expected] of [
    ["Physical", "Cognitive & Physical", ["Physical", "Cognitive"]],
    ["Others", "Physical & Cognitive", ["Physical", "Cognitive"]],
    ["Learning", "Social & Cognitive", ["Cognitive", "Learning", "Social"]],
    ["Social", "Physical & Cognitive", ["Physical", "Cognitive", "Social"]],
    ["Others", "Learning", ["Learning"]],
    ["Physical", "Self care and mindfulness", ["Physical"]],
    [
      "Physical",
      "Social & Cognitive, Learning",
      ["Physical", "Cognitive", "Learning", "Social"],
    ],
    ["Social & Volunterism", "", ["Social", "Volunteerism"]],
    [
      " cognitive ",
      "SOCIAL,physical & Learning",
      ["Physical", "Cognitive", "Learning", "Social"],
    ],
    [
      "Community",
      "Class, Cognitive stimulating activity, Self care and mindfulness",
      [],
    ],
    ["Physicality", "Socialising, Cognitive+Social", []],
    ["", "", []],
    ["Social", "Social, Social & Social", ["Social"]],
  ])
    assert.deepEqual(activityDomains(primary, [secondary]), expected);
  assert.deepEqual(
    activityDomains("Cognitive stimulating activity", [], {
      domainGroups: { "Cognitive stimulating activity": "Cognitive" },
    }),
    ["Cognitive"],
  );
  assert.equal(validDomainMapping("Physical & Social"), true);
  assert.equal(validDomainMapping("Community"), false);
});

test("combined-domain demographic selections retain distinct people and protected small groups stay withheld", () => {
  const f = fixture();
  try {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const r = row(
        "group" + i,
        "2026-10-01",
        "Others",
        "Physical & Cognitive",
      );
      r[1] = i < 6 ? "MALE" : "FEMALE";
      return r;
    });
    f.save(rows);
    const state = f.state();
    const selected = programmeDomainReport(
      state,
      { factor: "gender", group: "MALE", selectedDomain: "Cognitive" },
      "2026-11-05",
    );
    assert.equal(selected.total.unique, 6);
    assert.equal(
      selected.domains.find((d) => d.label === "Cognitive").unique,
      6,
    );
    assert.equal(selected.rankings.rows[0].attendance, 6);
    assert.equal(selected.registered, null);
    state.settings = {
      ...state.settings,
      staffAnalysisFull: false,
      privacyMinimum: 10,
    };
    const protectedReport = programmeDomainReport(
      state,
      { factor: "gender", group: "MALE", selectedDomain: "Cognitive" },
      "2026-11-05",
    );
    assert.equal(protectedReport.total.unique, null);
    assert.equal(
      protectedReport.domains.find((d) => d.label === "Cognitive").unique,
      null,
    );
    assert.deepEqual(protectedReport.domainBreadth, []);
    assert.equal(JSON.stringify(protectedReport).includes("group0"), false);
  } finally {
    f.db.close();
  }
});
const row = (id, date, primary, event, programme = "Recurring activity") => [
  id,
  "MALE",
  "82",
  "MALAY",
  "4",
  "YES",
  "YES",
  programme,
  primary,
  `${date}, 09:00 AM - 10:00 AM`,
  event,
];
function fixture() {
  const db = openDb(":memory:");
  const app = createApp(db);
  const actor = db
    .prepare("SELECT id FROM users WHERE username='__local_workspace__'")
    .get().id;
  return {
    db,
    app,
    actor,
    save(rows, mode = "add") {
      const p = parseRows([[...HEADERS, "Activity Name/Event Type"], ...rows]);
      p.mode = mode;
      const review = inspectImport(p, readData(db), mode);
      saveImport(db, p, review, actor);
      return review;
    },
    state() {
      return {
        data: readData(db),
        settings: { ...defaults, staffAnalysisFull: true },
        registry: [],
        profiles: [],
        feedback: [],
      };
    },
  };
}
test("session histories and overlapping domain counts retain overall attendance and domain-specific repeat opportunity", () => {
  const f = fixture();
  try {
    f.save([
      row("a", "2026-10-01", "Physical", "Cognitive & Physical"),
      row("b", "2026-10-01", "Physical", "Cognitive & Physical"),
      row("a", "2026-10-02", "Social", ""),
      row("a", "2026-10-03", "Others", "Community", "Unmapped"),
      row(
        "a",
        "2026-10-04",
        "Others",
        "Cognitive stimulating activity",
        "Unapproved",
      ),
    ]);
    const state = f.state(),
      before = structuredClone(state.data);
    const report = programmeDomainReport(
      state,
      { selectedDomain: "Cognitive", target: "all" },
      "2026-11-05",
    );
    assert.deepEqual(
      report.domains.map((d) => d.label),
      PROGRAMME_DOMAINS,
    );
    assert.equal(report.matrix.length, 0);
    assert.equal(report.total.sessions, 4);
    assert.equal(report.total.attendance, 5);
    assert.equal(report.total.unique, 2);
    assert.equal(report.unclassified.sessions, 2);
    const cognitive = report.domains.find((d) => d.label === "Cognitive");
    assert.equal(cognitive.sessions, 1);
    assert.equal(cognitive.unique, 2);
    assert.equal(cognitive.repeat, 0);
    assert.equal(cognitive.opportunity, 0);
    assert.equal(report.rankings.rows[0].sessions, 1);
    assert.equal(report.rankings.rows[0].repeat, 0);
    assert.equal(report.rankings.rows[0].attendance, 2);
    const social = programmeDomainReport(
      state,
      { selectedDomain: "Social", target: "all" },
      "2026-11-05",
    );
    assert.equal(social.rankings.rows[0].sessions, 1);
    assert.equal(social.rankings.rows[0].unique, 1);
    assert.deepEqual(state.data, before);
    const derived = combinedDomainData(state.data, state.settings);
    assert.deepEqual(derived.sessions[0].combinedDomains, [
      "Physical",
      "Cognitive",
    ]);
    assert.equal(
      derived.sessions[2].domainClassificationStatus,
      "Unclassified",
    );
    const unmapped = derived.sessions.find(
      (s) => s.domainClassificationStatus === "Unclassified",
    );
    assert.equal(
      domainMatches(
        "Physical",
        unmapped,
        derived.programmes.find((p) => p.id === unmapped.programmeId),
      ),
      false,
    );
    const filtered = analytics(
      state.data,
      state.settings,
      { domain: "Cognitive" },
      "2026-11-05",
    );
    assert.equal(filtered.summary.attendance, 2);
    state.settings.domainGroups = {
      "Cognitive stimulating activity": "Cognitive",
    };
    assert.equal(
      programmeDomainReport(state, { target: "all" }, "2026-11-05").unclassified
        .sessions,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("imports accept either source column and reviewed session corrections retain original values", () => {
  const f = fixture();
  try {
    f.save([row("a", "2026-10-01", "Physical", "Cognitive")]);
    const changed = f.save(
      [row("a", "2026-10-01", "Social", "Cognitive")],
      "merge",
    );
    assert.equal(changed.fresh.length, 0);
    assert.equal(changed.sessionUpdates.length, 1);
    const s = readData(f.db).sessions[0];
    assert.equal(s.optional.aapDomainRaw, "Social");
    assert.equal(s.optional.aapDomainHistory[0].raw, "Physical");
    assert.equal(readData(f.db).programmes[0].domain, "Physical");
    assert.deepEqual(sessionDomains(s, readData(f.db).programmes[0]), [
      "Cognitive",
      "Social",
    ]);
    const headers = [...HEADERS, "Activity Name/Event Type"].filter(
      (h) => h !== "AAP Domain",
    );
    const values = row("b", "2026-10-02", "", "Physical & Cognitive");
    values.splice(8, 1);
    const parsed = parseRows([headers, values]);
    assert.equal(parsed.issues.length, 0);
    assert.deepEqual(parsed.rows[0].session.optional.combinedDomains, [
      "Physical",
      "Cognitive",
    ]);
  } finally {
    f.db.close();
  }
});
test("domain API, protected export, preferences and raw storage agree", async () => {
  const f = fixture();
  f.save(
    Array.from({ length: 12 }, (_, i) =>
      row("member" + i, "2026-10-01", "Others", "Physical & Cognitive"),
    ),
  );
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const r = await fetch(
      base + "/api/programme-domains/report?selectedDomain=Cognitive",
    );
    assert.equal(r.status, 200);
    const report = await r.json();
    assert.equal(report.rankings.rows[0].sessions, 1);
    assert.deepEqual(
      report.domains.map((d) => d.label),
      PROGRAMME_DOMAINS,
    );
    const exported = await fetch(
      base + "/api/programme-domains/export?selectedDomain=Cognitive",
    );
    assert.equal(exported.status, 200);
    assert.deepEqual((await exported.json()).domains, report.domains);
    assert.equal(
      (await fetch(base + "/api/programme-domains/export?factor=cfs")).status,
      403,
    );
    const saved = await fetch(base + "/api/programme-domains/preferences", {
      method: "PUT",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ selectedDomain: "Cognitive", ranking: "repeat" }),
    });
    assert.equal(saved.status, 200);
    const cells = [
      [...HEADERS, "Activity Name/Event Type"],
      row("member0", "2026-10-01", "Social", "Physical & Cognitive"),
    ];
    const csv = cells
      .map((c) =>
        c.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n");
    const form = new FormData();
    form.append("file", new Blob([csv]), "session-correction.csv");
    const preview = await fetch(base + "/api/import/preview?mode=merge", {
      method: "POST",
      headers: { Origin: base },
      body: form,
    });
    const review = await preview.json();
    assert.equal(preview.status, 200, JSON.stringify(review));
    assert.equal(review.updatedSessions, 1);
    assert.match(review.sessionChanges[0].before, /AAP Domain: Others/);
    assert.match(review.sessionChanges[0].after, /AAP Domain: Social/);
    assert.equal(readData(f.db).sessions[0].optional.aapDomainRaw, "Others");
    const confirmed = await fetch(base + "/api/import/confirm", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ id: review.id, confirmed: true }),
    });
    assert.equal(confirmed.status, 200, await confirmed.text());
    assert.equal(readData(f.db).sessions[0].optional.aapDomainRaw, "Social");
    assert.equal(
      readData(f.db).sessions[0].optional.aapDomainHistory.at(-1).raw,
      "Others",
    );
    assert.equal(readData(f.db).programmes[0].domain, "Others");
    assert.equal(readData(f.db).attendance.length, 12);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    f.db.close();
  }
});
