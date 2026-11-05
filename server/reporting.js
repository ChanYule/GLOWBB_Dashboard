import { dataTransaction } from "./data-management.js";
import { ensureOperations } from "./operations-routes.js";
import { clientReport } from "./client-domain.js";
import { needsAnalysis } from "./needs-domain.js";
import { materializeProfiles } from "./needs-domain.js";
import { participationReport } from "./participation.js";

// A deliberately narrow report contract: never serialize source records, notes,
// profile distributions or staff-written action text into the presentation.
export function mountReporting(app, { db, storage, filters }) {
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
  app.get("/api/reporting/briefing", async (req, res) => {
    const f = filters(req);
    const includeRegistry = f.includeRegistry !== "0";
    delete f.includeRegistry;
    if (!["admin", "planner"].includes(req.user.role)) {
      return res.json({ clients: null, needs: null, actions: null });
    }
    await ensureOperations(db);
    res.json(
      await dataTransaction(
        db,
        function* (tx) {
          const state = storage.readPlanningState
            ? yield storage.readPlanningState(tx)
            : {
                data: yield storage.readData(tx),
                settings: yield storage.getSettings(tx),
                registry: yield tx
                  .prepare("SELECT * FROM member_registry")
                  .all(),
                profiles: yield tx
                  .prepare("SELECT * FROM participant_profiles")
                  .all(),
                feedback: yield tx
                  .prepare("SELECT * FROM participant_feedback")
                  .all(),
              };
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
          const actions = yield tx
            .prepare("SELECT details FROM needs_actions")
            .all();
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
          return {
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
        },
        true,
      ),
    );
  });
}
