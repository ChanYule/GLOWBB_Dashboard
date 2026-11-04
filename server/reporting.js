import { dataTransaction } from "./data-management.js";
import { ensureOperations } from "./operations-routes.js";
import { clientReport } from "./client-domain.js";
import { needsAnalysis } from "./needs-domain.js";

// A deliberately narrow report contract: never serialize source records, notes,
// profile distributions or staff-written action text into the presentation.
export function mountReporting(app, { db, storage, filters }) {
  app.get("/api/reporting/briefing", async (req, res) => {
    const f = filters(req);
    if (!["admin", "planner"].includes(req.user.role)) {
      return res.json({ clients: null, needs: null, actions: null });
    }
    await ensureOperations(db);
    res.json(
      await dataTransaction(
        db,
        function* (tx) {
          const state = {
            data: yield storage.readData(tx),
            settings: yield storage.getSettings(tx),
            registry: yield tx.prepare("SELECT * FROM member_registry").all(),
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
          const clients = selected
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
          );
          const actions = yield tx
            .prepare("SELECT details FROM needs_actions")
            .all();
          const stages = {};
          for (const row of actions) {
            const status = JSON.parse(row.details).status;
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
            actions: { total: actions.length, stages },
          };
        },
        true,
      ),
    );
  });
}
