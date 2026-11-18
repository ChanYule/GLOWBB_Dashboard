import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { Plus, Target, ArrowRight, X } from "lucide-react";
import { api } from "./api";
import type { Dashboard, User, Recommendation, Decision } from "./types";
import { Button, Select, Panel, Note, Modal } from "./ui-primitives";
const sgToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const pct = (x: number | null) =>
  x === null ? "Not available" : `${number(x)}%`;
const number = (x: number) =>
  new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(x);
const pretty = (x: string) =>
  x
    ? new Intl.DateTimeFormat("en-SG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Singapore",
      }).format(new Date(x + "T00:00:00+08:00"))
    : "Available history";
export function Planning({
  data,
  user,
  refresh,
  onTarget,
  simple = false,
  initialSearch = "",
}: {
  data: Dashboard;
  user: User;
  refresh: (s?: string) => void;
  onTarget: () => void;
  simple?: boolean;
  initialSearch?: string;
}) {
  const [horizon, setHorizon] = useState("3"),
    [category, setCategory] = useState("All"),
    [edit, setEdit] = useState<Recommendation | null>(null);
  const canEdit = user.role !== "viewer";
  const [search, setSearch] = useState(initialSearch),
    [visible, setVisible] = useState(5),
    [savedVisible, setSavedVisible] = useState(10);
  useEffect(() => {
    setSearch(initialSearch);
    setVisible(5);
  }, [initialSearch]);
  const list = data.recommendations.filter(
    (r) =>
      (category === "All" || r.category === category) &&
      r.programme.toLowerCase().includes(search.toLowerCase()),
  );
  const planningRecord = (d: Decision): Recommendation =>
    data.recommendations.find((r) => r.id === d.id) || {
      id: d.id,
      programme:
        data.options.programmes.find((p) => p.id === d.id)?.name ||
        (d.id.startsWith("target-")
          ? "Saved outreach goal"
          : "Saved programme"),
      category: d.id.startsWith("target-") ? "Pilot" : "Review",
      target: "Recorded planning objective",
      evidence: "Staff-recorded decision",
      figures:
        "Saved plan; matching attendance may be outside the current reporting period.",
      reason: "Review the saved plan with staff.",
      action: d.plannedAction || "Review the saved decision.",
      next: "Confirm an owner and review date.",
      limitations:
        "This is a saved staff decision, not a forecast of future attendance.",
    };
  const saved = data.decisions.filter((d) =>
    [planningRecord(d).programme, d.assigned || "", d.plannedAction || ""]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const gaps = data.targets.filter((t) => t.gap > 0);
  const goals = (
    <Panel
      title="Your outreach goals"
      subtitle="Target progress uses each target’s own date range and programme scope, independently of dashboard filters."
      action={
        canEdit &&
        (!simple || data.targets.length > 0) && (
          <Button primary onClick={onTarget}>
            <Plus size={17} />
            Set target
          </Button>
        )
      }
    >
      {data.targets.length ? (
        <div className="target-grid">
          {data.targets.map((t) => (
            <div className="target-card" key={t.id}>
              <div className="target-label">
                <strong>
                  {
                    {
                      unique: "Unique seniors",
                      male: "Male seniors",
                      minority: "Minority seniors",
                      firstObserved: "First observed in dataset",
                    }[t.metric]
                  }
                </strong>
                {canEdit && (
                  <button
                    className="icon-button"
                    aria-label="Remove target"
                    onClick={async () => {
                      await api("/api/targets/" + t.id, { method: "DELETE" });
                      refresh("Target removed. Attendance is unchanged.");
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <p>
                {pretty(t.start)} – {pretty(t.end)}
              </p>
              {t.programme_id && (
                <small>
                  {
                    data.options.programmes.find((p) => p.id === t.programme_id)
                      ?.name
                  }
                </small>
              )}
              <div className="target-value">
                <strong>{t.current}</strong>
                <span>/ {t.value} target</span>
                <b>{pct(t.progress)}</b>
              </div>
              <progress
                value={Math.min(t.progress, 100)}
                max="100"
                aria-label="Target achievement"
              />
              <small>
                {t.previousCurrent == null
                  ? "No valid prior-period comparison"
                  : `${t.previousCurrent} in the previous equivalent elapsed period`}
              </small>
              <p>
                {t.gap} remaining · {t.daysRemaining} days left
              </p>
              <small>
                {t.gap
                  ? "Review suitable outreach approaches and participant interest."
                  : "Target met within available records; review continuing engagement."}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <div className="target-empty">
          <Target size={28} />
          <div>
            <h3>Give your planning a direction</h3>
            <p>
              Set your own outreach targets. No organisational targets have been
              assumed.
            </p>
          </div>
          {canEdit && (
            <Button onClick={onTarget}>
              {simple ? "Set target" : "Set your first target"}
              <ArrowRight size={16} />
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
  return (
    <>
      {simple ? (
        <details className="panel planning-goals">
          <summary>Outreach targets (optional)</summary>
          {goals}
        </details>
      ) : (
        goals
      )}
      <div className="planning-header">
        <div>
          <span className="eyebrow">EVIDENCE INTO ACTION</span>
          <h2>
            {simple
              ? "Plan future programmes"
              : `A thoughtful plan for the next ${horizon} months`}
          </h2>
          <p className="muted">
            Staff decisions stay separate from observed attendance. No programme
            is automatically changed.
          </p>
        </div>
        {!simple && (
          <div className="segmented">
            {["3", "6"].map((v) => (
              <button
                key={v}
                className={horizon === v ? "active" : ""}
                onClick={() => setHorizon(v)}
              >
                {v} months
              </button>
            ))}
          </div>
        )}
      </div>
      {simple ? (
        <div className="panel planning-toolbar">
          <label className="field">
            Find a programme or saved plan
            <input
              aria-label="Find a programme or saved plan"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisible(5);
              }}
              placeholder="Search programme names"
            />
          </label>
          <Select
            label="Show suggestions"
            value={category}
            onChange={(v) => {
              setCategory(v);
              setVisible(5);
            }}
          >
            {["All", "Expand", "Maintain", "Improve", "Pilot", "Review"].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </Select>
          <p className="muted">
            Suggestions use recorded reach and the existing evidence rules.
            Staff decide what to run again or change.
          </p>
        </div>
      ) : (
        <div
          className="category-tabs"
          role="group"
          aria-label="Recommendation category"
        >
          {["All", "Expand", "Maintain", "Improve", "Pilot", "Review"].map(
            (c) => (
              <button
                key={c}
                className={category === c ? "active" : ""}
                onClick={() => setCategory(c)}
              >
                {c}
                <span>
                  {c === "All"
                    ? data.recommendations.length + gaps.length
                    : c === "Pilot"
                      ? gaps.length
                      : data.recommendations.filter((r) => r.category === c)
                          .length}
                </span>
              </button>
            ),
          )}
        </div>
      )}
      {simple && (
        <section className="panel">
          <h2>Saved plans</h2>
          <p className="muted">
            Saved programme and outreach decisions remain visible across
            reporting periods.
          </p>
          {saved.length ? (
            <>
              <div className="work-table">
                <table>
                  <thead>
                    <tr>
                      <th>Programme / goal</th>
                      <th>Decision</th>
                      <th>Owner</th>
                      <th>Target date</th>
                      <th>Next step</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saved.slice(0, savedVisible).map((d) => (
                      <tr key={d.id}>
                        <th>{planningRecord(d).programme}</th>
                        <td>{d.status}</td>
                        <td>{d.assigned || "Not set"}</td>
                        <td>{d.targetDate || "Not set"}</td>
                        <td>{d.plannedAction || "Not recorded"}</td>
                        <td>
                          {canEdit ? (
                            <button
                              className="text-button"
                              onClick={() => setEdit(planningRecord(d))}
                            >
                              Review saved plan
                            </button>
                          ) : (
                            "Read only"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {saved.length > savedVisible && (
                <Button onClick={() => setSavedVisible((n) => n + 10)}>
                  Show more saved plans
                </Button>
              )}
            </>
          ) : (
            <p>
              No saved plans match this view. Choose a programme below and
              record your next step.
            </p>
          )}
        </section>
      )}
      {!simple && (
        <>
          <div className="plan-timeline">
            {Array.from({ length: Number(horizon) }, (_, i) => {
              const now = sgToday(),
                d = new Date(
                  Date.UTC(
                    Number(now.slice(0, 4)),
                    Number(now.slice(5, 7)) + i,
                    1,
                  ),
                );
              return (
                <div key={i}>
                  <span>MONTH {i + 1}</span>
                  <strong>
                    {new Intl.DateTimeFormat("en-SG", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(d)}
                  </strong>
                  <p>
                    {i === 0
                      ? "Review evidence & resources"
                      : i === 1
                        ? "Confirm staff & participant interest"
                        : i === 2
                          ? "Pilot or deliver approved actions"
                          : "Monitor participation & revisit plans"}
                  </p>
                </div>
              );
            })}
          </div>
          <Note>
            Suggested planning sequence only. Approved actions and resource
            assumptions can be recorded in planning notes; no attendance or
            reach is projected.
          </Note>
        </>
      )}
      <div className="recommendation-list">
        {(simple ? list.slice(0, visible) : list).map((r) => {
          const decision = data.decisions.find((d) => d.id === r.id);
          return (
            <article className="recommendation" key={r.id}>
              <div className="recommendation-side">
                <span className={`badge category-${r.category.toLowerCase()}`}>
                  {r.category}
                </span>
                <small>{r.evidence} evidence</small>
              </div>
              <div>
                <div className="recommendation-heading">
                  <h3>{r.programme}</h3>
                  <span className="badge outline">
                    {decision?.status || "For review"}
                  </span>
                </div>
                <p className="evidence">{r.figures}</p>
                <p>
                  <strong>Action:</strong> {r.action} <strong>Target:</strong>{" "}
                  {r.target}.
                </p>
                {!simple && <p>{r.reason}</p>}
                {!simple && (
                  <p className="muted">
                    <strong>Next step:</strong> {r.next}
                  </p>
                )}
                <details>
                  <summary>
                    {simple
                      ? "Why this suggestion?"
                      : "Evidence rules & limitations"}
                  </summary>
                  {simple && (
                    <p>
                      {r.reason} {r.next}
                    </p>
                  )}
                  <p>
                    {r.limitations} Sufficient evidence requires at least{" "}
                    {data.settings.minSessions} sessions and{" "}
                    {data.settings.minParticipants} unique seniors. Expand flags
                    reach of at least 25% of selected senior reach; Expand also
                    requires a documented confirmed-demand source and review
                    date. Improve flags a decline over 25% between two complete
                    observed months, each meeting the session threshold.
                    Otherwise sufficient-evidence programmes are Maintain. These
                    rules are prompts for review.
                  </p>
                </details>
                {decision?.assigned && (
                  <p>
                    Assigned to {decision.assigned}
                    {decision.targetDate
                      ? ` / Target: ${decision.targetDate}`
                      : ""}
                  </p>
                )}
                {decision?.plannedAction && (
                  <p>Planned action: {decision.plannedAction}</p>
                )}
                {decision?.outcome && (
                  <p>Recorded outcome: {decision.outcome}</p>
                )}
                {decision?.notes && (
                  <p className="planning-notes">
                    Staff planning notes: {decision.notes}
                  </p>
                )}
                {canEdit && (
                  <button className="text-button" onClick={() => setEdit(r)}>
                    {simple ? "Record next step" : "Update planning decision"}
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {simple && list.length > visible && (
          <Button onClick={() => setVisible((n) => n + 5)}>
            Show 5 more programmes
          </Button>
        )}
        {(category === "All" || category === "Pilot") &&
          (simple ? gaps.slice(0, 3) : gaps).map((t) => (
            <article className="recommendation" key={"target" + t.id}>
              <div className="recommendation-side">
                <span className="badge category-pilot">Pilot</span>
                <small>Target-led opportunity</small>
              </div>
              <div>
                <h3>
                  Explore an approach toward your{" "}
                  {t.metric === "firstObserved"
                    ? "first-observed participation"
                    : t.metric + " senior reach"}{" "}
                  goal
                </h3>
                <p className="evidence">
                  {t.current} observed against a target of {t.value} · gap{" "}
                  {t.gap} · {t.daysRemaining} days remaining
                </p>
                <p>
                  Ask intended participants about interests, language, timing
                  and access needs. Discuss a small pilot with staff before
                  allocating resources.
                </p>
                <p className="muted">
                  No new programme concept or expected reach is inferred from
                  demographics. Record the chosen pilot and assumptions in your
                  planning process. Target period: {pretty(t.start)}–
                  {pretty(t.end)}.
                </p>
                <span className="badge outline">
                  {data.decisions.find((d) => d.id === `target-${t.id}`)
                    ?.status || "For review"}
                </span>
                {data.decisions.find((d) => d.id === `target-${t.id}`)
                  ?.notes && (
                  <p className="planning-notes">
                    Staff planning notes:{" "}
                    {
                      data.decisions.find((d) => d.id === `target-${t.id}`)
                        ?.notes
                    }
                  </p>
                )}
                {canEdit && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setEdit({
                        id: `target-${t.id}`,
                        programme: `Pilot opportunity · ${t.metric} target`,
                        category: "Pilot",
                        target: t.metric,
                        evidence: "Target-led opportunity",
                        figures: `${t.current} observed against ${t.value} target; gap ${t.gap}`,
                        reason: "Configured outreach goal has a remaining gap.",
                        action:
                          "Discuss a small pilot with intended participants.",
                        next: "Check interest, staff and resources.",
                        limitations: "No forecast or causal effect is assumed.",
                      })
                    }
                  >
                    Update pilot planning decision
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        {!list.length &&
          !((category === "Pilot" || category === "All") && gaps.length) && (
            <div className="panel empty">
              No {category.toLowerCase()} recommendations meet the documented
              rules in this view. Set a target to identify measurable pilot
              opportunities.
            </div>
          )}
      </div>
      {edit && (
        <DecisionDialog
          recommendation={edit}
          existing={data.decisions.find((d) => d.id === edit.id)}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            refresh("Planning decision saved.");
          }}
        />
      )}
    </>
  );
}
function DecisionDialog({
  recommendation: r,
  existing,
  onClose,
  onDone,
}: {
  recommendation: Recommendation;
  existing?: Decision;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState(existing?.status || "For review"),
    [notes, setNotes] = useState(existing?.notes || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [assigned, setAssigned] = useState(existing?.assigned || ""),
    [plannedAction, setPlannedAction] = useState(existing?.plannedAction || ""),
    [targetDate, setTargetDate] = useState(existing?.targetDate || ""),
    [outcome, setOutcome] = useState(existing?.outcome || "");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/decisions/" + r.id, {
        method: "PUT",
        body: JSON.stringify({
          status,
          notes,
          assigned,
          plannedAction,
          targetDate,
          outcome,
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Planning decision" onClose={onClose}>
      <form onSubmit={save} className="form-stack">
        <h3>{r.programme}</h3>
        <p>{r.figures}</p>
        <Select label="Planning status" value={status} onChange={setStatus}>
          {[
            "For review",
            "Approved for planning",
            "In progress",
            "Completed",
            "Not proceeding",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <label className="field">
          Assigned staff member
          <input
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="field">
          Planned action
          <textarea
            value={plannedAction}
            onChange={(e) => setPlannedAction(e.target.value)}
            maxLength={2000}
          />
        </label>
        <label className="field">
          Target date
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </label>
        <details>
          <summary>Outcome and notes (optional)</summary>
          <label className="field">
            Outcome after implementation
            <textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              maxLength={2000}
            />
          </label>
          <label className="field">
            <span>Planning notes & resource assumptions</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="Record the next action, capacity assumptions, staff hours or questions to check. Avoid participant information."
            />
          </label>
        </details>
        <Note>
          This saves a planning decision. It does not change programme sessions
          or attendance.
        </Note>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button primary type="submit" disabled={busy}>
          Save planning decision
        </Button>
      </form>
    </Modal>
  );
}
