import {
  analyticsRevision,
  ensureAnalyticsRevisions,
} from "./analytics-revisions.js";
import {
  readData as rawReadData,
  getSettings as rawGetSettings,
} from "./db.js";
import { analytics, todaySG } from "./domain.js";
import { analysisMetadata } from "./analysis-metadata.js";
import { reportingContext, projectReportingData } from "./reporting-policy.js";
import { dataTransaction } from "./data-management.js";
import { ensureOperations } from "./operations-routes.js";
import { staffAnalysisSettings } from "./staff-analysis.js";
import { clientReport } from "./client-domain.js";
import { needsAnalysis } from "./needs-domain.js";
import { materializeProfiles } from "./needs-domain.js";
import { participationReport } from "./participation.js";
import { programmeDomainReport as eventTypeReport } from "./event-report.js";

export function* readBriefingState(tx, storage) {
  return storage.readPlanningState
    ? yield storage.readPlanningState(tx)
    : {
        data: yield storage.readData(tx),
        settings: yield storage.getSettings(tx),
        registry: yield tx.prepare("SELECT * FROM member_registry").all(),
        profiles: yield tx.prepare("SELECT * FROM participant_profiles").all(),
        feedback: yield tx.prepare("SELECT * FROM participant_feedback").all(),
      };
}
export function* buildBriefing(
  tx,
  state,
  f,
  includeRegistry,
  includeMix = true,
) {
  const selected =
    [
      "programme",
      "domain",
      "gender",
      "race",
      "ageBand",
      "client",
      "boundary",
      "weekday",
      "timeSlot",
      "observed",
    ].some((k) => f[k]) ||
    (f.target && f.target !== "all");
  // Registry denominator cannot silently become an attendance-only cohort.
  const clients =
    selected || !includeRegistry
      ? null
      : clientReport(
          state,
          { from: f.from || "", to: f.to || "" },
          undefined,
          true,
        );
  const report = needsAnalysis(
    state.data,
    state.profiles,
    state.feedback,
    state.registry,
    state.settings,
    f,
    undefined,
    true,
  );
  const actions = yield tx.prepare("SELECT details FROM needs_actions").all();
  const decisions = yield tx
    .prepare(
      "SELECT status FROM decisions UNION ALL SELECT status FROM opportunity_decisions",
    )
    .all();
  const stages = {};
  const decisionStatus = {
    "For review": "Under Review",
    "Approved for planning": "Approved",
    "In progress": "In Progress",
    "Not proceeding": "Not Proceeding",
  };
  for (const status of [
    ...actions.map((row) => JSON.parse(row.details).status),
    ...decisions.map((row) => decisionStatus[row.status] || row.status),
  ]) {
    const key = [
      "Proposed",
      "Under Review",
      "Approved",
      "In Progress",
      "Completed",
      "Not Proceeding",
    ].includes(status)
      ? status
      : "Other recorded status";
    stages[key] = (stages[key] || 0) + 1;
  }
  const mixSensitive =
    [
      "gender",
      "race",
      "ageBand",
      "client",
      "boundary",
      "cfs",
      "risk",
      "observed",
      "weekday",
      "timeSlot",
    ].some((k) => f[k]) ||
    (f.target && f.target !== "all");
  let programmeMix = null;
  if (!mixSensitive && includeMix) {
    const mix = eventTypeReport(state, {
      from: f.from || "",
      to: f.to || "",
      domain: f.domain || "",
      programme: f.programme || "",
      target: "senior",
    });
    programmeMix = {
      domains: mix.domains.map((r) => ({
        label: r.label,
        sessions: r.sessions,
      })),
      types: mix.types.map((r) => ({
        label: r.label,
        sessions: r.sessions,
        unique: r.unique,
        repeat: r.repeat,
      })),
      findings: mix.findings.slice(0, 2),
      note: "Overlapping labels describe recorded programme objectives, not achieved outcomes. Unclassified historical sessions are retained.",
    };
  }
  return {
    programmeMix,
    generatedAt: report.generatedAt,
    registryOmitted: !includeRegistry,
    clients: clients
      ? {
          available: clients.available && clients.complete,
          attendanceAvailable: clients.attendanceAvailable,
          summary: clients.summary,
          populationNote: clients.populationNote,
          limitations: clients.limitations,
        }
      : null,
    needs: {
      respondents: report.responses.respondents,
      eligible: report.responses.eligible,
      note: report.responses.note,
      interests: report.responses.interests,
    },
    actions: { total: actions.length + decisions.length, stages },
  };
}
// A deliberately narrow report contract: never serialize source records, notes,
// profile distributions or staff-written action text into the presentation.
export function mountReporting(app, { db, storage, filters, aggregateCache }) {
  app.get("/api/reporting/participation", async (req, res) => {
    const f = filters(req),
      month = f.month || "";
    if (f.risk)
      throw Object.assign(
        Error(
          "Social risk filters are restricted to the protected aggregate view.",
        ),
        { status: 403 },
      );
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw Object.assign(Error("Choose a valid summary month."), {
        status: 400,
      });
    delete f.month;
    res.json(
      await dataTransaction(
        db,
        function* (tx) {
          const raw = yield storage.readData(tx),
            profiles = yield tx
              .prepare("SELECT * FROM participant_profiles")
              .all(),
            settings = yield storage.getSettings(tx);
          const data = materializeProfiles(raw, profiles);
          return participationReport(data, settings, f, month);
        },
        true,
      ),
    );
  });
  const cached = (req, label, work) =>
    aggregateCache ? aggregateCache.run(req, label, work) : work();
  app.get("/api/reporting/meeting-status", async (req, res) => {
    if (
      req.authorizedCentreId !== "seen_nanyang" ||
      !["admin", "planner"].includes(req.user.role)
    )
      return res
        .status(403)
        .json({
          error:
            "Meeting presentation requires authorised SEEN Nanyang staff access.",
        });
    res.json({ revision: await analyticsRevision(db) });
  });
  app.get("/api/reporting/meeting", async (req, res) => {
    if (
      req.authorizedCentreId !== "seen_nanyang" ||
      !["admin", "planner"].includes(req.user.role)
    )
      return res.status(403).json({
        error:
          "Meeting presentation requires authorised SEEN Nanyang staff access.",
      });
    const input = filters(req),
      f = { from: input.from || "", to: input.to || "", interval: "month" };
    await ensureOperations(db);
    const revisionEnabled = await ensureAnalyticsRevisions(db);
    const snapshot = await cached(req, "seen-meeting", () =>
      dataTransaction(
        db,
        function* (tx) {
          const rawStorage = db.storage || {
            ...storage,
            readData: rawReadData,
            getSettings: rawGetSettings,
          };
          const state = yield* readBriefingState(tx, rawStorage);
          const policy = {
            ...reportingContext.getStore(),
            settings: state.settings,
          };
          state.data = projectReportingData(state.data, policy);
          const now = todaySG();
          const data = analytics(
            materializeProfiles(state.data, state.profiles),
            state.settings,
            f,
            now,
            "overview",
          );
          const domains = eventTypeReport(
            state,
            { from: f.from, to: f.to, target: "senior" },
            now,
          );
          const briefing = yield* buildBriefing(tx, state, f, true, false);
          const revisions = revisionEnabled
            ? yield tx
                .prepare(
                  "SELECT kind,revision FROM analytics_revisions ORDER BY kind",
                )
                .all()
            : null;
          const metadata = yield analysisMetadata(tx, state.settings);
          const minimum = Math.max(5, state.settings.privacyMinimum || 5);
          const release = (amount, total) =>
            amount >= minimum && total - amount >= minimum ? amount : null;
          const counts = ({
            unique,
            attendance,
            sessions,
            programmes,
            male,
            minority,
            knownGender,
            knownRace,
          }) => ({
            unique,
            attendance,
            sessions,
            programmes,
            male: release(male, knownGender),
            minority: release(minority, knownRace),
            knownGender: knownGender >= minimum ? knownGender : null,
            knownRace: knownRace >= minimum ? knownRace : null,
          });
          return {
            revision: revisions
              ? revisions.map((row) => row.kind + ":" + row.revision).join("|")
              : null,
            overview: {
              summary: counts(data.summary),
              settings: { privacyMinimum: state.settings.privacyMinimum },
              previous: data.previous
                ? {
                    ...counts(data.previous),
                    from: data.previous.from,
                    to: data.previous.to,
                  }
                : null,
              trends: data.trends.map((row) => ({
                label: row.label,
                partial: row.partial,
                ...counts(row),
              })),
              programmes: data.programmes.map((row) => ({
                id: row.id,
                name: row.name,
                unique: row.unique,
              })),
              coverage: data.coverage,
              period: data.period,
              metadata: {
                ...metadata,
                reporting: {
                  label:
                    policy.mode === "exploratory"
                      ? "Exploratory reporting"
                      : "Official reporting",
                  version: state.settings.reporting?.version ?? 1,
                },
              },
            },
            domains: {
              total: domains.total,
              domains: domains.domains,
              minimum: domains.minimum,
              findings: domains.findings,
            },
            briefing: {
              clients: briefing.clients
                ? {
                    available: briefing.clients.available,
                    summary: briefing.clients.summary,
                  }
                : null,
              needs: briefing.needs
                ? { respondents: briefing.needs.respondents }
                : null,
            },
          };
        },
        true,
      ),
    );
    res.json(snapshot);
  });
  app.get("/api/reporting/briefing", async (req, res) => {
    const f = filters(req);
    const includeRegistry = f.includeRegistry !== "0";
    delete f.includeRegistry;
    if (!["admin", "planner"].includes(req.user.role)) {
      return res.json({ clients: null, needs: null, actions: null });
    }
    await ensureOperations(db);
    res.json(
      await cached(req, "reporting-briefing", () =>
        dataTransaction(
          db,
          function* (tx) {
            const state = yield* readBriefingState(tx, storage);
            state.settings = staffAnalysisSettings(state.settings, req.user);
            return yield* buildBriefing(tx, state, f, includeRegistry);
          },
          true,
        ),
      ),
    );
  });
}
