import {centreUrl} from "./api";
import { useEffect, useState, useCallback, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "./api";
import { ClientRegistryImport } from "./client-import";
import { SppbProfileSection } from './sppb-ui';
import type { Dashboard, Filters, User } from "./types";
import { AnalysisGraphic, PersonalWorkspace } from "./workspace";
import "./needs.css";
import { ProgrammeClassificationTable, type ProgrammeClassificationRow } from "./programme-classification-table";
type Cell = {
  label: string;
  unique: number;
  attendance?: number | null;
  repeat?: number | null;
  once?: number | null;
  frequency?: number | null;
  repeatRate?: number | null;
  percent?: number | null;
};
export type ProtectedSeries = {
  suppressed: boolean;
  denominator: number | null;
  values: Cell[];
  note?: string;
  population?:string;
  populationLabel?:string;
};
export type Finding = {
  id: string;
  category: string;
  title: string;
  finding: string;
  explanation: string;
  action: string;
  target: string;
  evidence: string;
  priority: string;
  next: string;
};
export type NeedsReport = {
  period: { from: string; to: string; now: string };
  summary: Dashboard["summary"];
  generatedAt: string;
  registry: {
    available: boolean;
    total: number | null;
    asOf: string | null;
    neverAttended: number | null;
    noRecordedAttendance: number | null;
    inactive: number | null;
    inactivePct: number | null;
    note: string;
  };
  engagement: {
    asOf: string;
    denominator: number;
    bands: number[];
    values: Cell[];
    note: string;
  };
  qualityScope: string;
  quality: {
    field: string;
    label: string;
    completed: number;
    missing: number;
    unknown: number;
    notAssessed: number;
    total: number;
    percent: number | null;
    state: string;
    source: string;
    updated: string | null;
  }[];
  demographics: Record<string, ProtectedSeries>;
  profiles: {
    cfs: ProtectedSeries;
    living: ProtectedSeries;
    marital: ProtectedSeries;
    livingAlone: number | null;
  };
  responses: {
    respondents: number | null;
    scope: string;
    eligible: number | null;
    note: string;
    interests: ProtectedSeries;
    needs: ProtectedSeries;
    barriers: ProtectedSeries;
    hypotheses: ProtectedSeries;
    preferences: Record<string, ProtectedSeries>;
  };
  programmeClassifications: ProgrammeClassificationRow[];
  alignment: {
    label: string;
    rawDomains: string[];
    programmes: number;
    sessions: number;
    unique: number;
    attendance: number;
    average: number;
    repeat: number;
    sessionShare: number | null;
  }[];
  coverage: {
    kind: string;
    interest: string;
    reached: number | null;
    respondents: number;
    denominator: number;
    programmes: {
      id: string;
      name: string;
      status: string;
      outcomes: string;
      accessibility: Record<string, string>;
    }[];
    sessions: number;
    review: string;
  }[];
  findings: Finding[];
  limitations: string[];
};
type Evidence = {
  category: string;
  status: string;
  source: string;
  date: string;
  details?: string;
  relatedDomain?: string;
  actionTaken?: string;
  outcome?: string;
};
type Profile = {
  basic?: {
    age?: number | null;
    gender?: string;
    race?: string;
    preferredLanguage?: string;
    registrationDate?: string;
    livingRaw?: string;
    blockRaw?: string;
    client?: boolean | null;
    boundary?: boolean | null;
    employmentStatus?:string;
    employmentSource?:string;
    employmentRecordedOn?:string;
  };
  health?: Record<string, string>;
  social?: Record<string, string>;
  needs?: Evidence[];
  preferences?: {
    responded?: boolean;
    interests?: string[];
    days?: string[];
    times?: string[];
    languages?: string[];
    programmeTypes?: string[];
    format?: string;
    wantsToTry?: string[];
    noLongerInterested?: string[];
    reasons?: string;
    requests?: string;
  };
  barriers?: Evidence[];
  followUp?: {
    required?: boolean;
    assigned?: string;
    type?: string;
    date?: string;
    status?: string;
    outcome?: string;
    nextAction?: string;
  };
};
type Catalogue = {
  interests: string[];
  needs: string[];
  barriers: string[];
  informationSources: string[];
  needStates: string[];
  actionStates: string[];
};
type Detail = {
  base: {
    id: string;
    age: number | null;
    gender: string;
    race: string;
    cfs?: string;
    cfsAssessedOn?: string;
    preferredLanguage?: string;
    registrationDate?: string;
    livingRaw?: string;
    maritalRaw?: string;
    riskRaw?: string;
    client: boolean | null;
    boundary: boolean | null;
  };
  current: Detail["base"];
  revision: number;
  provenance?: {
    source: string;
    effectiveDate: string | null;
    recorded: string;
  } | null;
  details: Profile;
  updated: string | null;
  notice: string;
  history: {
    attendance: number;
    programmes: number;
    sessions: number;
    domains: number;
    first: string | null;
    last: string | null;
    status: string;
    repeat: boolean;
    rows: {
      id: string;
      session: { date: string; start: number; end: number };
      programme: { name: string; domain: string };
    }[];
  };
  feedback: {
    id: string;
    date: string;
    source: string;
    method: string;
    comments: string;
    suggestedImprovement: string;
    preferences?: Profile["preferences"];
    barriers?: Evidence[];
    followUpNeeded?: boolean;
    contact?: {
      outcome: string;
      assigned: string;
      notes: string;
      nextDate: string | null;
    };
  }[];
};
type Action = {
  id: string;
  kind: "action" | "outreach";
  revision: number;
  title: string;
  finding: string;
  targetGroup: string;
  plannedChange: string;
  owner: string;
  due: string;
  start: string;
  priority: string;
  status: string;
  notes: string;
  outcome: string;
  objective: string;
  reportedNeeds: string;
  channel: string;
  approach: string;
  contacted: number | null;
  responded: number | null;
  interested: number | null;
  registered: number | null;
  attended: number | null;
  repeat: number | null;
  evidenceSource: string;
  evaluationBefore: string;
  evaluationAfter: string;
  evaluationLimitations: string;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const fmt = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
export const blankAction = (
  kind: "action" | "outreach" = "action",
  f?: Finding,
): Action => ({
  id: crypto.randomUUID(),
  kind,
  revision: 0,
  title: f?.title || "",
  finding: f?.finding || "",
  targetGroup: f?.target || "",
  plannedChange: f?.action || "",
  owner: "",
  due: "",
  start: "",
  priority: f?.priority || "Medium",
  status: "Proposed",
  notes: "",
  outcome: "",
  objective: "",
  reportedNeeds: "",
  channel: "",
  approach: "",
  contacted: null,
  responded: null,
  interested: null,
  registered: null,
  attended: null,
  repeat: null,
  evidenceSource: "",
  evaluationBefore: "",
  evaluationAfter: "",
  evaluationLimitations: "",
});
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel needs-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={2000}
      />
    </label>
  );
}
function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={2000}
      />
    </label>
  );
}
function Multi({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="needs-multi">
      <legend>{label}</legend>
      <div className="work-checks">
        {options.map((v) => (
          <label key={v}>
            <input
              type="checkbox"
              checked={value.includes(v)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, v]
                    : value.filter((x) => x !== v),
                )
              }
            />
            {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
export function ProtectedDistribution({
  title,
  series,
  engagement = false,
}: {
  title: string;
  series: ProtectedSeries;
  engagement?: boolean;
}) {
  return (
    <Panel title={title}>
      {series.suppressed ? (
        <p className="privacy-empty">
          {series.note ||
            "This breakdown and complementary values are withheld under the minimum subgroup reporting rule. Reset filters or collect more voluntary responses."}
        </p>
      ) : (
        <>
          <AnalysisGraphic
            rows={series.values.map((v) => ({
              label: v.label,
              value: v.unique,
            }))}
            title={title}
            type="bar"
          />
          <p className="muted">
            Denominator: {fmt(series.denominator)} distinct{" "}
            {series.populationLabel || (title.includes("all participating ages")
              ? "participants of all ages"
              : title.startsWith("Preferred ") ||
                  title.includes("interest") ||
                  title.includes("barrier") ||
                  title.includes("need")
                ? "question respondents"
                : "people in this profile cohort")}
            .{" "}
            {series.note ||
              "Multiple selections may overlap; do not add category counts."}
          </p>
          {engagement && (
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>{series.population==='attendance'?'Unique participants':'Unique seniors'}</th>
                    <th>Attendance</th>
                    <th>{series.population==='attendance'?'Repeat participants':'Repeat seniors'}</th>
                    <th>{series.population==='attendance'?'Entries / participant':'Entries / senior'}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.values.map((r) => (
                    <tr key={r.label}>
                      <th>{r.label}</th>
                      <td>{fmt(r.unique)}</td>
                      <td>{fmt(r.attendance)}</td>
                      <td>{fmt(r.repeat)}</td>
                      <td>{fmt(r.frequency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
export function NeedsManagement({
  data,
  filters,
  setFilters,
  user,
  onNavigate,
}: {
  data: Dashboard;
  filters: Filters;
  setFilters: (f: Filters) => void;
  user: User;
  onNavigate: (tab: string) => void;
}) {
  const [report, setReport] = useState<NeedsReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (user.role !== "viewer")
      api<NeedsReport>("/api/needs/overview?" + new URLSearchParams(filters))
        .then((r) => {
          if (live) {
            setReport(r);
            setError("");
          }
        })
        .catch((e) => {
          if (live) {
            setReport(null);
            setError(e.message);
          }
        });
    return () => {
      live = false;
    };
  }, [filters, user.role]);
  return (
    <div className="work-space">
      <div className="needs-level-links">
        {[
          [
            "01",
            "Who Are We Serving?",
            "Profiles, health and social circumstances",
          ],
          [
            "02",
            "Gaps and Participation Barriers",
            "Evidence gaps, feedback and access",
          ],
          [
            "03",
            "Programme Planning and Actions",
            "Programme alignment and agreed follow-up",
          ],
        ].map(([n, label, caption]) => (
          <button key={n} onClick={() => onNavigate(label)}>
            <span>{n}</span>
            <strong>{label}</strong>
            <small>{caption}</small>
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <PersonalWorkspace
        data={data}
        filters={filters}
        setFilters={setFilters}
        user={user}
        onRisk={() => onNavigate("Social Risk Analysis")}
      />
      {report && (
        <div className="needs-insight-grid">
          {report.findings.slice(0, 3).map((f) => (
            <article className="panel" key={f.id}>
              <span className="badge soft">{f.category}</span>
              <h3>{f.title}</h3>
              <p>{f.finding}</p>
              <p className="muted">{f.action}</p>
              <button
                className="text-button"
                onClick={() => onNavigate("Gaps and Participation Barriers")}
              >
                View supporting analysis →
              </button>
            </article>
          ))}
        </div>
      )}
      {report && (
        <p className="note">
          {report.registry.note} Updated{" "}
          {new Date(report.generatedAt).toLocaleString("en-SG", {
            timeZone: "Asia/Singapore",
          })}
          .
        </p>
      )}
    </div>
  );
}
export function NeedsPage({
  level,
  filters,
  user,
  onRefresh,
}: {
  level: "profile" | "gaps" | "actions" | "quality" | "alignment";
  filters: Filters;
  user: User;
  onRefresh: () => void;
}) {
  const [report, setReport] = useState<NeedsReport | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [tool, setTool] = useState(""),
    [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const refresh = () => {
    setRevision((x) => x + 1);
    onRefresh();
  };
  useEffect(() => {
    let live = true;
    if (user.role === "viewer") return;
    setReport(null);
    api<NeedsReport>("/api/needs/overview?" + new URLSearchParams(filters))
      .then((r) => {
        if (live) {
          setReport(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [filters, user.role, revision]);
  if (user.role === "viewer")
    return (
      <Panel title="Authorised staff analysis">
        <p>
          Participant needs, living circumstances and detailed health analysis
          are restricted to planners and administrators. General attendance and
          programme dashboards remain available.
        </p>
      </Panel>
    );
  return (
    <div className="work-space">
      <div className="work-toolbar">
        <div>
          <span className="eyebrow">
            {level === "profile"
              ? "LEVEL 1 · WHO ARE THEY?"
              : level === "gaps"
                ? "LEVEL 2 · WHAT ARE WE MISSING?"
                : level === "actions"
                  ? "LEVEL 3 · WHAT SHOULD WE DO?"
                  : "REVIEWED SOURCE INFORMATION"}
          </span>
          <h2>
            {level === "profile"
              ? "Participant Profile and Needs"
              : level === "gaps"
                ? "Outreach Gaps and Needs Analysis"
                : level === "actions"
                  ? "Action and Programme Planning"
                  : level === "alignment"
                    ? "Programme Alignment"
                    : "Data Quality and Administration"}
          </h2>
        </div>
        <div className="work-actions">
          <button
            className="button"
            onClick={() => setTool(tool === "participant" ? "" : "participant")}
          >
            Participant profile & feedback
          </button>
          <button
            className="button"
            onClick={() => setTool(tool === "programmes" ? "" : "programmes")}
          >
            Programme accessibility
          </button>
          {user.role === "admin" && (
            <button
              className="button"
              onClick={() => setTool(tool === "settings" ? "" : "settings")}
            >
              Needs reporting settings
            </button>
          )}
          <a
            className="button"
            href={centreUrl("/api/needs/export/csv?" + new URLSearchParams(filters))}
          >
            Export summary CSV
          </a>
          <a
            className="button"
            href={centreUrl("/api/needs/export/report?" + new URLSearchParams(filters))}
            target="_blank"
            rel="noreferrer"
          >
            Print management summary
          </a>
        </div>
      </div>
      {tool === "participant" && <ParticipantEditor onSaved={refresh} />}{" "}
      {tool === "programmes" && <ProgrammeEditor onSaved={refresh} />}{" "}
      {tool === "settings" && <NeedsSettings onSaved={refresh} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!report && !error && (
        <p className="panel" role="status">
          Loading needs analysis…
        </p>
      )}
      {report && (
        <>
          {level === "profile" && (
            <>
              <p className="note">
                {fmt(report.summary.unique)} unique participating seniors in{" "}
                {report.period.from || "available history"} to{" "}
                {report.period.to}. Health/social charts use a fixed
                full-history cohort only when filters are reset. Profiles are
                latest-known, not historical assessments.
              </p>
              <div className="needs-mini-kpis">
                {[
                  ["Registered members", report.registry.total],
                  ["Participating seniors", report.summary.unique],
                  ["Male seniors", report.summary.male],
                  ["Minority seniors", report.summary.minority],
                  [
                    "Seniors recorded as living alone",
                    report.profiles.livingAlone,
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <strong>{fmt(value as number | null)}</strong>
                  </div>
                ))}
              </div>
              <details>
                <summary>
                  Demographic overview ? selected reporting period
                </summary>
                <div className="needs-two">
                  {Object.entries(report.demographics).map(
                    ([field, series]) => (
                      <ProtectedDistribution
                        key={field}
                        title={
                          field === "ages"
                            ? series.population==='registry'?'Age profile — all registered clients':'Age distribution — programme participants'
                            : field === "clients"
                              ? "Client participation ? seniors"
                              : field === "boundary"
                                ? "Service boundary ? seniors"
                                : field === "gender"
                                  ? "Gender distribution ? seniors"
                                  : "Race distribution ? seniors"
                        }
                        series={series}
                      />
                    ),
                  )}
                </div>
                <p className="muted">
                  Age distribution includes below-threshold participants. Other
                  distributions and outreach KPIs use the configured senior age
                  threshold.
                </p>
              </details>
              <div className="needs-two">
                <ProtectedDistribution
                  title="Recorded CFS profile — programme participants"
                  series={report.profiles.cfs}
                  engagement
                />
                <ProtectedDistribution
                  title="Living arrangements"
                  series={report.profiles.living}
                  engagement
                />
              </div>
              <p className="note">
                Living alone does not establish loneliness. Raw CFS values do
                not establish programme suitability or a diagnosis. Use approved
                assessment definitions and staff review.
              </p>
              <ProtectedDistribution
                title="Marital status"
                series={report.profiles.marital}
              />
              <div className="needs-two">
                <ProtectedDistribution
                  title="Stated participant interests"
                  series={report.responses.interests}
                />
                <ProtectedDistribution
                  title="Reported and assessed support needs"
                  series={report.responses.needs}
                />
              </div>
              <p className="muted">
                {report.responses.note} {fmt(report.responses.respondents)}{" "}
                respondents among {fmt(report.responses.eligible)} eligible
                senior profiles. Cohort: {report.responses.scope}. Missing
                information does not indicate no needs.
              </p>
              <div className="needs-two">
                {Object.entries(report.responses.preferences).map(([k, v]) => (
                  <ProtectedDistribution
                    key={k}
                    title={"Preferred " + k}
                    series={v}
                  />
                ))}
              </div>
            </>
          )}
          {level === "gaps" && (
            <>
              <Panel title="Inactive and less active members">
                <p>{report.registry.note}</p>
                <div className="needs-mini-kpis">
                  {[
                    ["Registered members", report.registry.total],
                    [
                      "Members with recorded inactivity",
                      report.registry.inactive,
                    ],
                    [
                      "Recorded inactivity % of registry",
                      report.registry.inactivePct,
                    ],
                    [
                      "Members with no recorded attendance",
                      report.registry.noRecordedAttendance,
                    ],
                    [
                      "Never attended · complete history required",
                      report.registry.neverAttended,
                    ],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <span>{label}</span>
                      <strong>{fmt(value as number | null)}</strong>
                    </div>
                  ))}
                </div>
                <h3>Observed engagement as of {report.engagement.asOf}</h3>
                <AnalysisGraphic
                  rows={report.engagement.values.map((v) => ({
                    label: v.label,
                    value: v.unique,
                  }))}
                  title="Observed engagement bands"
                  type="bar"
                />
                <p className="muted">
                  {report.engagement.note} Denominator:{" "}
                  {report.engagement.denominator}{" "}
                  {report.registry.available
                    ? "registered members in the attested snapshot"
                    : "previously observed participants"}
                  . Whole-centre coverage and never-attended membership require
                  independent registry evidence.
                </p>
              </Panel>
              <div className="needs-two">
                <ProtectedDistribution
                  title="Reported barriers to participation · six themes"
                  series={report.responses.barriers}
                />
                <ProtectedDistribution
                  title="Staff observations and unconfirmed hypotheses"
                  series={report.responses.hypotheses}
                />
              </div>
              <p className="note">
                Primary barrier counts use participant/caregiver reports. Staff
                observations and unconfirmed hypotheses are separate. Low
                attendance is not evidence of a barrier or unwillingness to
                participate.
              </p>
              <NeedsCoverage report={report} />
              <DataQuality report={report} />
            </>
          )}
          {level === "actions" && (
            <>
              <div className="work-actions">
                <button
                  className="button primary"
                  onClick={() => setSelectedAction(blankAction())}
                >
                  Create planning action
                </button>
                <button
                  className="button"
                  onClick={() => setSelectedAction(blankAction("outreach"))}
                >
                  Create targeted outreach plan
                </button>
              </div>
              <div className="needs-insight-grid">
                {report.findings.slice(0, 5).map((f) => (
                  <article className="panel" key={f.id}>
                    <span className="badge soft">
                      {f.category} · {f.priority} priority
                    </span>
                    <h3>{f.title}</h3>
                    <p>
                      <strong>Finding:</strong> {f.finding}
                    </p>
                    <p>
                      <strong>Possible explanation:</strong> {f.explanation}
                    </p>
                    <p>
                      <strong>Recommended action:</strong> {f.action}
                    </p>
                    <p className="muted">
                      Target: {f.target}. Evidence: {f.evidence}. Next: {f.next}
                    </p>
                    <button
                      className="button"
                      onClick={() =>
                        setSelectedAction(
                          blankAction(
                            f.category === "Targeted Outreach"
                              ? "outreach"
                              : "action",
                            f,
                          ),
                        )
                      }
                    >
                      Record proposed follow-up
                    </button>
                  </article>
                ))}
              </div>
              {report.findings.length > 5 && <details><summary>More evidence to review ({report.findings.length - 5})</summary>{report.findings.slice(5).map(f => <article className="panel" key={f.id}><h3>{f.title}</h3><p>{f.finding}</p><p><b>Evidence:</b> {f.evidence}</p><p><b>Next step:</b> {f.action}</p></article>)}</details>}
              {!report.findings.length && (
                <p className="panel">
                  No additional evidence-supported needs recommendations in this
                  view. Existing programme recommendations remain under Planning
                  & Recommendations.
                </p>
              )}
              <ActionTracker revision={revision} onEdit={setSelectedAction} />
              <Alignment report={report} />
            </>
          )}
          {level === "alignment" && (
            <>
              <Alignment report={report} />
              <NeedsCoverage report={report} />
            </>
          )}
          {level === "quality" && (
            <>
              <DataQuality report={report} />
              {user.role === "admin" && <RegistryImport onSaved={refresh} />}
              <p className="note">
                No complete membership, ActivityHub scheduling, validated
                assessment codebook or programme cost/capacity integration was
                supplied. The dashboard displays recorded evidence and optional
                staff-reviewed programme metadata.
              </p>
            </>
          )}
          <p className="muted">{report.limitations.join(" ")}</p>
        </>
      )}
      {selectedAction && (
        <ActionEditor
          value={selectedAction}
          onClose={() => setSelectedAction(null)}
          onSaved={() => {
            setSelectedAction(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
function DataQuality({ report }: { report: NeedsReport }) {
  return (
    <Panel title="Profile completeness and information gaps">
      <p>
        {report.qualityScope}: {report.quality[0]?.total || 0} profiles.
        Completeness means recorded information, not proof of accuracy or a
        completed clinical assessment.
      </p>
      <div className="work-table">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>With information</th>
              <th>Blank / missing</th>
              <th>Unknown</th>
              <th>Not assessed</th>
              <th>Completion</th>
              <th>Collection state</th>
              <th>Source / updated</th>
            </tr>
          </thead>
          <tbody>
            {report.quality.map((q) => (
              <tr key={q.field}>
                <th>{q.label}</th>
                <td>{q.completed}</td>
                <td>{q.missing}</td>
                <td>{q.unknown}</td>
                <td>{q.notAssessed}</td>
                <td>
                  <progress
                    value={q.percent || 0}
                    max={100}
                    aria-label={q.label + " completeness"}
                  />
                  {fmt(q.percent)}%
                </td>
                <td>{q.state}</td>
                <td>
                  {q.source}
                  <small>
                    {q.updated
                      ? new Date(q.updated).toLocaleDateString("en-SG", {
                          timeZone: "Asia/Singapore",
                        })
                      : "No update date recorded"}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
function Alignment({ report }: { report: NeedsReport }) {
  return (
    <Panel title="Programme alignment and diversity">
      <p>Review each programme's primary domain and recorded sub-domains together, with one set of reach and engagement figures for the same programme.</p>
      <ProgrammeClassificationTable rows={report.programmeClassifications || []} />
      <p className="muted">Delivered sessions have recorded attendance. Recorded attendance is not a verified future schedule; participant feedback is still needed to assess programme alignment.</p>
    </Panel>
  );
}
function NeedsCoverage({ report }: { report: NeedsReport }) {
  return (
    <Panel title="Needs coverage and stated demand">
      <p>
        Only explicit staff-reviewed programme interest tags establish a
        catalogue link. Titles are never used to infer suitability or that a
        health/social need is met.
      </p>
      {!report.coverage.length ? (
        <p className="chart-empty">
          No privacy-safe stated-interest coverage is available. Collect
          voluntary preferences and review programme tags before drawing
          alignment conclusions.
        </p>
      ) : (
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Interest</th>
                <th>Respondents</th>
                <th>Explicitly tagged programmes</th>
                <th>Delivered sessions</th>
                <th>Review action</th>
              </tr>
            </thead>
            <tbody>
              {report.coverage.map((c) => (
                <tr key={c.interest}>
                  <th>
                    {c.interest}
                    <small>{c.kind}</small>
                  </th>
                  <td>
                    {c.respondents} / {c.denominator}
                  </td>
                  <td>
                    {c.programmes.length
                      ? c.programmes.map((p) => (
                          <div key={p.id}>
                            {p.name}
                            <small>
                              {p.status} ·{" "}
                              {p.outcomes || "No intended outcome recorded"}
                            </small>
                          </div>
                        ))
                      : "No reviewed catalogue match"}
                  </td>
                  <td>{c.sessions}</td>
                  <td>{c.review}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
export function ParticipantEditor({
  onSaved,
  initialId,
  initialMemberId,
}: {
  onSaved: () => void;
  initialId?: string;
  initialMemberId?: string;
}) {
  const [memberId, setMemberId] = useState(initialMemberId || ""),
    [detail, setDetail] = useState<Detail | null>(null),
    [profile, setProfile] = useState<Profile>({}),
    [tab, setTab] = useState("Basic Information"),
    [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [source, setSource] = useState("Unconfirmed"),
    [effectiveDate, setEffectiveDate] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(false),
    [create, setCreate] = useState(false);
  useEffect(() => {
    api<Catalogue>("/api/needs/catalogue")
      .then(setCatalogue)
      .catch((e) => setMessage(e.message));
  }, []);
  const load = useCallback(async (id: string) => {
    const d = await api<Detail>("/api/participants/" + id);
    setDetail(d);
    setProfile(d.details);
    setSource(d.provenance?.source || "Unconfirmed");
    setEffectiveDate(d.provenance?.effectiveDate || "");
    setMessage("");
  }, []);
  useEffect(() => {
    if (initialId)
      void load(initialId).catch((e: Error) => setMessage(e.message));
  }, [initialId, load]);
  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ id: string }>("/api/participants/lookup", {
        method: "POST",
        body: JSON.stringify({ memberId }),
      });
      await load(result.id);
    } catch (e) {
      setDetail(null);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));
  const tabs = [
    "SPPB Assessments",
    "Basic Information",
    "Health and Functional Profile",
    "Social and Living Circumstances",
    "Care and Support Needs",
    "Interests and Programme Preferences",
    "Participation History",
    "Engagement Barriers",
    "Staff Follow-Up",
  ];
  return (
    <Panel title="Participant profile · authorised staff">
      <form className="work-toolbar" onSubmit={lookup}>
        <Field
          label="Exact Member ID"
          value={memberId}
          onChange={(v) => {
            setMemberId(v);
            setDetail(null);
            setCreate(false);
          }}
          required
        />
        <button className="button primary" disabled={busy}>
          Find participant
        </button>
        <button
          className="button"
          type="button"
          onClick={() => setCreate(!create)}
        >
          Create reviewed participant profile
        </button>
      </form>
      <p className="muted">
        Member IDs are hashed for matching and are not retained in general
        charts. Looking up a profile is audited. Enter only necessary
        programme-support information.
      </p>
      {create && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const result = await api<{ id: string }>("/api/participants", {
                method: "POST",
                body: JSON.stringify({ memberId, basic: {} }),
              });
              await load(result.id);
              setCreate(false);
              onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <p>
            This creates an observed/reviewed profile, not verified membership
            or attendance. Use the member registry import for membership
            evidence.
          </p>
          <button className="button" disabled={!memberId.trim()}>
            Create profile for entered Member ID
          </button>
        </form>
      )}
      {message && (
        <p role="status" className="note">
          {message}
        </p>
      )}
      {detail && catalogue && (
        <>
          <p className="note">
            {detail.notice} Last staff update:{" "}
            {detail.updated || "Not yet recorded"}. Source:{" "}
            {detail.provenance?.source || "No reviewed source recorded"}.
            Effective date: {detail.provenance?.effectiveDate || "Not supplied"}
            .
          </p>
          <div
            className="needs-tab-strip"
            role="tablist"
            aria-label="Participant profile sections"
          >
            {tabs.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={tab} className="needs-profile-body">
            {tab === "SPPB Assessments" && <SppbProfileSection id={detail.base.id} />}
            {tab === "Basic Information" && (
              <>
                <div className="needs-imported">
                  {[
                    ["Age", detail.base.age],
                    ["Gender", detail.base.gender],
                    ["Race", detail.base.race],
                    ["Marital status", detail.base.maritalRaw],
                    ["Preferred language", detail.base.preferredLanguage],
                    ["Registration date", detail.base.registrationDate],
                    [
                      "Client",
                      detail.base.client == null
                        ? "Unknown"
                        : detail.base.client
                          ? "Yes"
                          : "No",
                    ],
                    [
                      "Within boundary",
                      detail.base.boundary == null
                        ? "Unknown"
                        : detail.base.boundary
                          ? "Yes"
                          : "No",
                    ],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <span>Imported {label}</span>
                      <strong>{String(value ?? "Unknown")}</strong>
                    </div>
                  ))}
                </div>
                <p>
                  Reviewed corrections are saved separately from imported raw
                  values. Blank corrections retain imported values.
                </p>
                <div className="needs-two">
                  <Field
                    label="Reviewed age (optional)"
                    type="number"
                    value={
                      profile.basic?.age == null
                        ? ""
                        : String(profile.basic.age)
                    }
                    onChange={(v) =>
                      update("basic", {
                        ...profile.basic,
                        age: v === "" ? null : Number(v),
                      })
                    }
                  />
                  <Select
                    label="Reviewed gender"
                    value={profile.basic?.gender || ""}
                    options={["", "MALE", "FEMALE", "UNKNOWN"]}
                    onChange={(v) =>
                      update("basic", { ...profile.basic, gender: v })
                    }
                  />
                  <Field
                    label="Reviewed race"
                    value={profile.basic?.race || ""}
                    onChange={(v) =>
                      update("basic", { ...profile.basic, race: v })
                    }
                  />
                  <Field
                    label="Preferred language"
                    value={profile.basic?.preferredLanguage || ""}
                    onChange={(v) =>
                      update("basic", {
                        ...profile.basic,
                        preferredLanguage: v,
                      })
                    }
                  />
                  <Field
                    label="Registration date (only if verified)"
                    type="date"
                    value={profile.basic?.registrationDate || ""}
                    onChange={(v) =>
                      update("basic", { ...profile.basic, registrationDate: v })
                    }
                  />
                  <Select label="Recorded employment status" value={profile.basic?.employmentStatus||''} options={['','Working','Not working','Retired','Unknown','Prefers not to say']} onChange={v=>update('basic',{...profile.basic,employmentStatus:v})}/>
                  <Field label="Employment information source" value={profile.basic?.employmentSource||''} onChange={v=>update('basic',{...profile.basic,employmentSource:v})}/>
                  <Field label="Employment recorded date" type="date" value={profile.basic?.employmentRecordedOn||''} onChange={v=>update('basic',{...profile.basic,employmentRecordedOn:v})}/>
                </div>
              </>
            )}
            {tab === "Health and Functional Profile" && (
              <>
                <p>
                  Imported CFS: <strong>{detail.base.cfs || "Missing"}</strong>.
                  Use an approved assessment framework; no diagnosis or
                  programme suitability is inferred.
                </p>
                {[
                  ["cfsAssessedOn", "CFS assessment date", "date"],
                  [
                    "functionalCategory",
                    "Approved functional category / source definition",
                    "text",
                  ],
                  ["mobility", "Mobility support information", "text"],
                  ["accessibility", "Accessibility requirements", "text"],
                  [
                    "considerations",
                    "Programme participation considerations",
                    "text",
                  ],
                  [
                    "supportInformation",
                    "Other relevant programme support",
                    "text",
                  ],
                ].map(([key, label, type]) => (
                  <Field
                    key={key}
                    label={label}
                    type={type}
                    value={profile.health?.[key] || ""}
                    onChange={(v) =>
                      update("health", { ...profile.health, [key]: v })
                    }
                  />
                ))}
              </>
            )}
            {tab === "Social and Living Circumstances" && (
              <>
                <div className="needs-imported">
                  <div>
                    <span>Raw living arrangement</span>
                    <strong>{detail.base.livingRaw || "Missing"}</strong>
                  </div>
                  <div>
                    <span>Raw marital status</span>
                    <strong>{detail.base.maritalRaw || "Missing"}</strong>
                  </div>
                  <div>
                    <span>Raw social risk code</span>
                    <strong>{detail.base.riskRaw ?? "Missing"}</strong>
                  </div>
                </div>
                <p className="note">
                  Living alone does not establish loneliness or social
                  isolation. Raw social risk codes require approved mappings.
                  Imported values are retained. A sourced staff correction can
                  be recorded below; leave it blank to use the imported value.
                </p>
                <Field
                  label="Reviewed living arrangement"
                  value={profile.basic?.livingRaw || ""}
                  onChange={(v) =>
                    update("basic", { ...profile.basic, livingRaw: v })
                  }
                />
                <Field
                  label="Reviewed residential block"
                  value={profile.basic?.blockRaw || ""}
                  onChange={(v) =>
                    update("basic", { ...profile.basic, blockRaw: v })
                  }
                />
                {[
                  ["regularContact", "Regular social contact"],
                  [
                    "practicalSupport",
                    "Someone available for practical support",
                  ],
                  [
                    "joiningDifficulty",
                    "Reports difficulty joining social activities",
                  ],
                  ["interestSocial", "Expresses interest in social programmes"],
                ].map(([key, label]) => (
                  <Select
                    key={key}
                    label={label}
                    value={profile.social?.[key] || "Unknown"}
                    options={["Unknown", "Not assessed", "Yes", "No"]}
                    onChange={(v) =>
                      update("social", { ...profile.social, [key]: v })
                    }
                  />
                ))}
                <TextArea
                  label="Volunteered relevant living circumstances"
                  value={profile.social?.circumstances || ""}
                  onChange={(v) =>
                    update("social", { ...profile.social, circumstances: v })
                  }
                />
              </>
            )}
            {tab === "Care and Support Needs" && (
              <EvidenceEditor
                type="needs"
                catalogue={catalogue}
                values={profile.needs || []}
                onChange={(v) => update("needs", v)}
              />
            )}{" "}
            {tab === "Interests and Programme Preferences" && (
              <PreferencesEditor
                catalogue={catalogue}
                value={profile.preferences || {}}
                onChange={(v) => update("preferences", v)}
              />
            )}{" "}
            {tab === "Participation History" && (
              <>
                <div className="needs-mini-kpis">
                  {[
                    ["Entries", detail.history.attendance],
                    ["Programmes", detail.history.programmes],
                    ["Domains", detail.history.domains],
                    ["First observed", detail.history.first],
                    ["Last attended", detail.history.last],
                    ["Observed engagement", detail.history.status],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <span>{label}</span>
                      <strong>{value ?? "Unavailable"}</strong>
                    </div>
                  ))}
                </div>
                <p>
                  First observed is not the registration date or proof of being
                  new to the centre.
                </p>
                <div className="work-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Programme</th>
                        <th>AAP domain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.history.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.session.date}</td>
                          <th>{r.programme.name}</th>
                          <td>{r.programme.domain}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}{" "}
            {tab === "Engagement Barriers" && (
              <>
                <EvidenceEditor
                  type="barriers"
                  catalogue={catalogue}
                  values={profile.barriers || []}
                  onChange={(v) => update("barriers", v)}
                />
                <p>
                  Participant/caregiver reports, staff observations and
                  unconfirmed hypotheses remain distinct. Attendance alone is
                  never a reported barrier.
                </p>
              </>
            )}
            {tab === "Staff Follow-Up" && (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={profile.followUp?.required || false}
                    onChange={(e) =>
                      update("followUp", {
                        ...profile.followUp,
                        required: e.target.checked,
                      })
                    }
                  />
                  Follow-up required
                </label>
                {[
                  ["assigned", "Assigned staff member", "text"],
                  ["type", "Follow-up type", "text"],
                  ["date", "Follow-up date", "date"],
                  ["outcome", "Outcome", "text"],
                  ["nextAction", "Next action", "text"],
                ].map(([key, label, type]) => (
                  <Field
                    key={key}
                    label={label}
                    type={type}
                    value={String(
                      profile.followUp?.[
                        key as keyof NonNullable<Profile["followUp"]>
                      ] || "",
                    )}
                    onChange={(v) =>
                      update("followUp", { ...profile.followUp, [key]: v })
                    }
                  />
                ))}
                <Select
                  label="Follow-up status"
                  value={profile.followUp?.status || "Proposed"}
                  options={catalogue.actionStates}
                  onChange={(v) =>
                    update("followUp", { ...profile.followUp, status: v })
                  }
                />
              </>
            )}
          </div>
          <div className="needs-save">
            <Select
              label="Information source for this revision"
              value={source}
              options={catalogue.informationSources}
              onChange={setSource}
            />
            <Field
              label="Effective / assessment date (if known)"
              type="date"
              value={effectiveDate}
              onChange={setEffectiveDate}
            />
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    "/api/participants/" + detail.base.id + "/profile",
                    {
                      method: "PUT",
                      body: JSON.stringify({
                        revision: detail.revision,
                        details: profile,
                        source,
                        effectiveDate,
                      }),
                    },
                  );
                  await load(detail.base.id);
                  setMessage(
                    "Profile saved. Original imported values and revision history are preserved.",
                  );
                  onSaved();
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Review and save profile
            </button>
            <button className="button" onClick={() => setFeedback(!feedback)}>
              Collect voluntary survey / staff feedback
            </button>
          </div>
          {feedback && (
            <FeedbackForm
              id={detail.base.id}
              catalogue={catalogue}
              onSaved={() => {
                void load(detail.base.id);
                onSaved();
              }}
            />
          )}
          <details>
            <summary>Recorded feedback · {detail.feedback.length}</summary>
            {detail.feedback.map((f) => (
              <article key={f.id}>
                <h4>
                  {f.date} · {f.method} · {f.source}
                </h4>
                <p>{f.comments}</p>
                <p>{f.suggestedImprovement}</p>
                {f.contact && (
                  <p>
                    Contact outcome: {f.contact.outcome}. Assigned staff:{" "}
                    {f.contact.assigned || "Unassigned"}. Next contact:{" "}
                    {f.contact.nextDate || "Not set"}. {f.contact.notes}
                  </p>
                )}
                <p>
                  Stated interests:{" "}
                  {f.preferences?.interests?.join(", ") ||
                    (f.preferences?.responded
                      ? "Explicitly no selections"
                      : "Not answered")}
                  .
                </p>
                <p>
                  Preferred days / times:{" "}
                  {[
                    ...(f.preferences?.days || []),
                    ...(f.preferences?.times || []),
                  ].join(", ") || "Not answered"}
                  . Languages:{" "}
                  {f.preferences?.languages?.join(", ") || "Not answered"}.
                </p>
                {f.barriers?.map((b, i) => (
                  <p key={i}>
                    {b.category} ? {b.status} ? {b.source} ?{" "}
                    {b.date || "Date not supplied"}
                  </p>
                ))}
                {f.followUpNeeded && (
                  <p className="badge soft">
                    Follow-up requested ? review and assign in Staff Follow-Up
                  </p>
                )}
              </article>
            ))}
          </details>
        </>
      )}
    </Panel>
  );
}
function EvidenceEditor({
  type,
  catalogue,
  values,
  onChange,
}: {
  type: "needs" | "barriers";
  catalogue: Catalogue;
  values: Evidence[];
  onChange: (v: Evidence[]) => void;
}) {
  return (
    <div className="form-stack">
      <p>
        Record only volunteered/reviewed information. Unknown and not assessed
        are different from explicitly confirmed not present.
      </p>
      {values.map((n, i) => {
        const change = (patch: Partial<Evidence>) =>
          onChange(values.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <fieldset key={i}>
            <legend>
              {type === "needs" ? "Support need" : "Barrier"} {i + 1}
            </legend>
            <div className="needs-two">
              <Select
                label="Category"
                value={n.category}
                options={catalogue[type]}
                onChange={(v) => change({ category: v })}
              />
              <Select
                label="Information state"
                value={n.status}
                options={catalogue.needStates}
                onChange={(v) => change({ status: v })}
              />
              <Select
                label="Information source"
                value={n.source}
                options={catalogue.informationSources}
                onChange={(v) => change({ source: v })}
              />
              <Field
                label="Reported / assessed date (if known)"
                type="date"
                value={n.date}
                onChange={(v) => change({ date: v })}
              />
            </div>
            <TextArea
              label="Relevant programme support details"
              value={n.details || ""}
              onChange={(v) => change({ details: v })}
            />
            {type === "barriers" && (
              <>
                <Field
                  label="Related programme / domain (if reported)"
                  value={n.relatedDomain || ""}
                  onChange={(v) => change({ relatedDomain: v })}
                />
                <Field
                  label="Action taken"
                  value={n.actionTaken || ""}
                  onChange={(v) => change({ actionTaken: v })}
                />
                <TextArea
                  label="Reported follow-up outcome"
                  value={n.outcome || ""}
                  onChange={(v) => change({ outcome: v })}
                />
              </>
            )}
            <button
              className="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              Remove unsaved item
            </button>
          </fieldset>
        );
      })}
      <button
        className="button"
        onClick={() =>
          onChange([
            ...values,
            {
              category: catalogue[type][0],
              status: "Unknown",
              source: "Unconfirmed",
              date: "",
            },
          ])
        }
      >
        Add{" "}
        {type === "needs" ? "support need" : "reported barrier / hypothesis"}
      </button>
    </div>
  );
}
function PreferencesEditor({
  catalogue,
  value,
  onChange,
}: {
  catalogue: Catalogue;
  value: NonNullable<Profile["preferences"]>;
  onChange: (v: NonNullable<Profile["preferences"]>) => void;
}) {
  return (
    <div className="form-stack">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.responded || false}
          onChange={(e) => onChange({ ...value, responded: e.target.checked })}
        />
        The participant voluntarily answered these preference questions
        (including an explicit empty response)
      </label>
      <p>
        These are stated preferences. Attendance is not treated as an expressed
        interest.
      </p>
      <Multi
        label="Activities of interest"
        options={catalogue.interests}
        value={value.interests || []}
        onChange={(v) => onChange({ ...value, responded: true, interests: v })}
      />
      <Multi
        label="Preferred weekdays"
        options={[
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ]}
        value={value.days || []}
        onChange={(v) => onChange({ ...value, days: v })}
      />
      <Multi
        label="Preferred time slots"
        options={["Morning", "Afternoon", "Evening"]}
        value={value.times || []}
        onChange={(v) => onChange({ ...value, times: v })}
      />
      {[
        ["languages", "Preferred languages (one per line)"],
        ["programmeTypes", "Preferred programme types (one per line)"],
        ["wantsToTry", "Activities to try (one per line)"],
        ["noLongerInterested", "Activities no longer wanted (one per line)"],
      ].map(([key, label]) => (
        <TextArea
          key={key}
          label={label}
          value={(value[key as "languages"] || []).join("\n")}
          onChange={(v) =>
            onChange({ ...value, [key]: v.split("\n").filter(Boolean) })
          }
        />
      ))}
      <Field
        label="Preferred activity format"
        value={value.format || ""}
        onChange={(v) => onChange({ ...value, format: v })}
      />
      <TextArea
        label="Volunteered reasons for preferences"
        value={value.reasons || ""}
        onChange={(v) => onChange({ ...value, reasons: v })}
      />
      <TextArea
        label="Programme requests"
        value={value.requests || ""}
        onChange={(v) => onChange({ ...value, requests: v })}
      />
    </div>
  );
}
function FeedbackForm({
  id,
  catalogue,
  onSaved,
}: {
  id: string;
  catalogue: Catalogue;
  onSaved: () => void;
}) {
  const [method, setMethod] = useState("survey"),
    [source, setSource] = useState("Unconfirmed"),
    [date, setDate] = useState(today()),
    [preferences, setPreferences] = useState<
      NonNullable<Profile["preferences"]>
    >({}),
    [reported, setReported] = useState<string[]>([]),
    [comments, setComments] = useState(""),
    [improvement, setImprovement] = useState(""),
    [consent, setConsent] = useState(false),
    [followUp, setFollowUp] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reference, setReference] = useState(() => crypto.randomUUID());
  return (
    <section className="needs-survey">
      <h3>Voluntary participant survey / staff feedback</h3>
      <p>
        Staff-assisted, mobile-friendly collection. Participation in programmes
        never depends on disclosing health or social circumstances. Leave
        unanswered questions blank.
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/participants/" + id + "/feedback", {
              method: "POST",
              body: JSON.stringify({
                id: reference,
                method,
                source,
                date,
                consent,
                preferences,
                barriers: reported.map((category) => ({
                  category,
                  status: source === "Unconfirmed" ? "Unknown" : "Reported",
                  source,
                  date,
                })),
                comments,
                suggestedImprovement: improvement,
                followUpNeeded: followUp,
              }),
            });
            setMessage("Feedback saved. No outreach message was sent.");
            setReference(crypto.randomUUID());
            setPreferences({});
            setReported([]);
            setComments("");
            setImprovement("");
            setConsent(false);
            onSaved();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Select
          label="Collection method"
          value={method}
          options={["survey", "staff"]}
          onChange={setMethod}
        />
        <Select
          label="Feedback source"
          value={source}
          options={catalogue.informationSources}
          onChange={setSource}
        />
        <Field
          label="Feedback date"
          type="date"
          value={date}
          onChange={setDate}
        />
        <Multi
          label="Which activities interest you?"
          options={catalogue.interests}
          value={preferences.interests || []}
          onChange={(v) =>
            setPreferences({ ...preferences, responded: true, interests: v })
          }
        />
        <Multi
          label="Which days suit you?"
          options={[
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ]}
          value={preferences.days || []}
          onChange={(v) => setPreferences({ ...preferences, days: v })}
        />
        <Multi
          label="Which times suit you?"
          options={["Morning", "Afternoon", "Evening"]}
          value={preferences.times || []}
          onChange={(v) => setPreferences({ ...preferences, times: v })}
        />
        <Field
          label="Preferred language (optional)"
          value={(preferences.languages || []).join(", ")}
          onChange={(v) =>
            setPreferences({ ...preferences, languages: v ? [v] : [] })
          }
        />
        <Multi
          label="What makes it difficult to attend? (optional)"
          options={catalogue.barriers}
          value={reported}
          onChange={setReported}
        />
        <TextArea
          label="What would make joining more comfortable?"
          value={improvement}
          onChange={setImprovement}
        />
        <TextArea
          label="Other comments or programme requests (optional)"
          value={comments}
          onChange={setComments}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={followUp}
            onChange={(e) => setFollowUp(e.target.checked)}
          />
          Follow-up requested
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />
          Responses are voluntary and permission to record this feedback has
          been obtained
        </label>
        <button className="button primary" disabled={!consent || busy}>
          Review and save feedback
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
function ActionTracker({
  revision,
  onEdit,
}: {
  revision: number;
  onEdit: (a: Action) => void;
}) {
  const [actions, setActions] = useState<Action[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<Action[]>("/api/needs/actions")
      .then(setActions)
      .catch((e) => setError(e.message));
  }, [revision]);
  return (
    <Panel title="Planning actions and outreach outcomes">
      {error && <p role="alert">{error}</p>}
      {!actions.length ? (
        <p>
          No actions recorded. Recommendations remain discussion prompts until
          staff create and approve an action.
        </p>
      ) : (
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Action / target group</th>
                <th>Owner / due</th>
                <th>Priority / status</th>
                <th>Outcome</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <th>
                    {a.title}
                    <small>
                      {a.kind} · {a.targetGroup}
                    </small>
                  </th>
                  <td>
                    {a.owner || "Unassigned"}
                    <small>{a.due || "No target date"}</small>
                  </td>
                  <td>
                    {a.priority}
                    <small>{a.status}</small>
                  </td>
                  <td>
                    {a.outcome || "Not recorded"}
                    {a.kind === "outreach" && (
                      <small>
                        Contacted {fmt(a.contacted)} → responded{" "}
                        {fmt(a.responded)} → interested {fmt(a.interested)} →
                        registered {fmt(a.registered)} → attended{" "}
                        {fmt(a.attended)} → repeat {fmt(a.repeat)}. Source:{" "}
                        {a.evidenceSource || "Not recorded"}
                      </small>
                    )}
                  </td>
                  <td>
                    <button className="button" onClick={() => onEdit(a)}>
                      Review action
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        Outreach stages are separate manually evidenced counts, not attendance
        inferred from contacts. Missing is not zero. No causal effect is
        claimed.
      </p>
    </Panel>
  );
}
export function ActionEditor({
  value,
  onClose,
  onSaved,
}: {
  value: Action;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [a, setAction] = useState(value),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  const update = (key: keyof Action, v: Action[keyof Action]) =>
    setAction((x) => ({ ...x, [key]: v }));
  return (
    <dialog
      ref={dialog}
      className="panel needs-action-editor"
      aria-label="Review planning action"
      onCancel={onClose}
    >
      <div className="work-toolbar">
        <h2>
          {a.kind === "outreach" ? "Targeted Outreach Plan" : "Planning action"}
        </h2>
        <button className="button" onClick={onClose}>
          Close action
        </button>
      </div>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { id, ...body } = a;
            await api("/api/needs/actions/" + id, {
              method: "PUT",
              body: JSON.stringify(body),
            });
            onSaved();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Action title"
          value={a.title}
          onChange={(v) => update("title", v)}
          required
        />
        <TextArea
          label="Related finding"
          value={a.finding}
          onChange={(v) => update("finding", v)}
        />
        <Field
          label="Target group"
          value={a.targetGroup}
          onChange={(v) => update("targetGroup", v)}
        />
        <TextArea
          label="Proposed programme or outreach change"
          value={a.plannedChange}
          onChange={(v) => update("plannedChange", v)}
        />
        <div className="needs-two">
          <Field
            label="Staff owner"
            value={a.owner}
            onChange={(v) => update("owner", v)}
          />
          <Field
            label="Start date"
            type="date"
            value={a.start}
            onChange={(v) => update("start", v)}
          />
          <Field
            label="Target completion date"
            type="date"
            value={a.due}
            onChange={(v) => update("due", v)}
          />
          <Select
            label="Priority"
            value={a.priority}
            options={["Low", "Medium", "High"]}
            onChange={(v) => update("priority", v)}
          />
          <Select
            label="Progress status"
            value={a.status}
            options={[
              "Proposed",
              "Under Review",
              "Approved",
              "In Progress",
              "Completed",
              "Not Proceeding",
            ]}
            onChange={(v) => update("status", v)}
          />
        </div>
        {a.kind === "outreach" && (
          <>
            <Field
              label="Outreach objective"
              value={a.objective}
              onChange={(v) => update("objective", v)}
            />
            <TextArea
              label="Relevant reported needs"
              value={a.reportedNeeds}
              onChange={(v) => update("reportedNeeds", v)}
            />
            <Field
              label="Preferred communication channel (if known)"
              value={a.channel}
              onChange={(v) => update("channel", v)}
            />
            <TextArea
              label="Planned engagement approach"
              value={a.approach}
              onChange={(v) => update("approach", v)}
            />
            <p>
              Record outcomes only from the same documented outreach cohort.
              Leave unavailable stages blank. These values do not create
              attendance records or send messages.
            </p>
            <div className="needs-two">
              {(
                [
                  "contacted",
                  "responded",
                  "interested",
                  "registered",
                  "attended",
                  "repeat",
                ] as const
              ).map((k) => (
                <Field
                  key={k}
                  label={"Number " + k}
                  type="number"
                  value={a[k] == null ? "" : String(a[k])}
                  onChange={(v) => update(k, v === "" ? null : Number(v))}
                />
              ))}
            </div>
            <Field
              label="Evidence source for outreach counts"
              value={a.evidenceSource}
              onChange={(v) => update("evidenceSource", v)}
            />
          </>
        )}
        <TextArea
          label="Planning notes (avoid participant identifiers)"
          value={a.notes}
          onChange={(v) => update("notes", v)}
        />
        <TextArea
          label="Outcome after implementation"
          value={a.outcome}
          onChange={(v) => update("outcome", v)}
        />
        <details>
          <summary>Before and after evaluation</summary>
          <TextArea
            label="Before: metric, count, denominator and period"
            value={a.evaluationBefore}
            onChange={(v) => update("evaluationBefore", v)}
          />
          <TextArea
            label="After: same metric and observed period"
            value={a.evaluationAfter}
            onChange={(v) => update("evaluationAfter", v)}
          />
          <TextArea
            label="Evaluation limitations / programme changes"
            value={a.evaluationLimitations}
            onChange={(v) => update("evaluationLimitations", v)}
          />
          <p>
            Use Explore the Data for measured reporting-period comparisons.
            Before/after differences do not establish that the intervention
            caused a change.
          </p>
        </details>
        {message && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          Save reviewed action
        </button>
      </form>
    </dialog>
  );
}
function ProgrammeEditor({ onSaved }: { onSaved: () => void }) {
  type Offering = {
    id: string;
    name: string;
    domain: string;
    revision: string;
    optional: {
      outcomes?: string;
      confirmedDemand?: boolean;
      demandSource?: string;
      demandDate?: string;
      interestCategories?: string[];
      intendedNeeds?: string[];
      offeringStatus?: string;
      accessibility?: Record<string, string>;
    };
  };
  const [offerings, setOfferings] = useState<Offering[]>([]),
    [id, setId] = useState(""),
    [selected, setSelected] = useState<Offering | null>(null),
    [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [message, setMessage] = useState(""),
    [name, setName] = useState(""),
    [domain, setDomain] = useState("");
  const load = useCallback(
    () =>
      api<Offering[]>("/api/needs/programmes")
        .then(setOfferings)
        .catch((e) => setMessage(e.message)),
    [],
  );
  useEffect(() => {
    void load();
    api<Catalogue>("/api/needs/catalogue")
      .then(setCatalogue)
      .catch((e) => setMessage(e.message));
  }, [load]);
  const patch = (p: Offering["optional"]) =>
    setSelected((s) => (s ? { ...s, optional: { ...s.optional, ...p } } : s));
  return (
    <Panel title="Programme intended outcomes and accessibility">
      <p>
        Staff-reviewed metadata is distinct from attendance. Tags identify an
        intended alignment, not proof of meeting a need or an eligibility rule.
      </p>
      <label className="field">
        Programme
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setSelected(offerings.find((p) => p.id === e.target.value) || null);
          }}
        >
          <option value="">Choose a programme</option>
          {offerings.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {message && <p role="status">{message}</p>}
      {selected && catalogue && (
        <div className="form-stack">
          <TextArea
            label="Intended outcomes (staff reviewed)"
            value={selected.optional.outcomes || ""}
            onChange={(v) => patch({ outcomes: v })}
          />
          <Select
            label="Offering status"
            value={selected.optional.offeringStatus || "Not confirmed"}
            options={[
              "Not confirmed",
              "Current offering",
              "Planned offering",
              "Past offering",
            ]}
            onChange={(v) => patch({ offeringStatus: v })}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={selected.optional.confirmedDemand || false}
              onChange={(e) => patch({ confirmedDemand: e.target.checked })}
            />
            Demand has been explicitly confirmed through a reviewed source
            (required for Expand recommendations)
          </label>
          {selected.optional.confirmedDemand && (
            <>
              <Field
                label="Confirmed demand source"
                value={selected.optional.demandSource || ""}
                onChange={(v) => patch({ demandSource: v })}
              />
              <Field
                label="Demand review date"
                type="date"
                value={selected.optional.demandDate || ""}
                onChange={(v) => patch({ demandDate: v })}
              />
            </>
          )}
          <Multi
            label="Explicit interest alignment"
            options={catalogue.interests}
            value={selected.optional.interestCategories || []}
            onChange={(v) => patch({ interestCategories: v })}
          />
          <Multi
            label="Intended support-need considerations"
            options={catalogue.needs}
            value={selected.optional.intendedNeeds || []}
            onChange={(v) => patch({ intendedNeeds: v })}
          />
          <div className="needs-two">
            {[
              ["physicalLevel", "Physical activity level"],
              ["mobilityRequirements", "Mobility requirements"],
              ["seatedOption", "Seated activity option"],
              ["languages", "Language of instruction"],
              ["venueAccessibility", "Venue accessibility"],
              ["transport", "Transport considerations"],
              ["groupSize", "Group size (verified capacity only)"],
              ["equipment", "Required equipment"],
              ["support", "Staff / volunteer support"],
            ].map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={selected.optional.accessibility?.[key] || ""}
                onChange={(v) =>
                  patch({
                    accessibility: {
                      ...selected.optional.accessibility,
                      [key]: v,
                    },
                  })
                }
              />
            ))}
          </div>
          <button
            className="button primary"
            onClick={async () => {
              try {
                await api("/api/programmes/" + selected.id + "/profile", {
                  method: "PUT",
                  body: JSON.stringify({
                    ...selected.optional,
                    offeringStatus:
                      selected.optional.offeringStatus || "Not confirmed",
                    accessibility: selected.optional.accessibility || {},
                    revision: selected.revision,
                  }),
                });
                setMessage(
                  "Programme review saved. No attendance or eligibility was changed.",
                );
                await load();
                setSelected(null);
                setId("");
                onSaved();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Save programme review
          </button>
        </div>
      )}
      <details>
        <summary>Add a verified future offering to the catalogue</summary>
        <Field
          label="Verified programme name"
          value={name}
          onChange={setName}
        />
        <Field
          label="Original AAP domain"
          value={domain}
          onChange={setDomain}
        />
        <button
          className="button"
          disabled={!name || !domain}
          onClick={async () => {
            try {
              await api("/api/programme-offerings", {
                method: "POST",
                body: JSON.stringify({ name, domain }),
              });
              setMessage(
                "Planned catalogue offering added. No session or attendance was created.",
              );
              setName("");
              setDomain("");
              await load();
              onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Add planned offering
        </button>
      </details>
    </Panel>
  );
}
function NeedsSettings({ onSaved }: { onSaved: () => void }) {
  type Config = {
    settings: {
      inactivityBands: number[];
      planningPriorities: Record<string, string>;
      cfsMappings: Record<string, { label: string; meaning: string }>;
      livingGroups: Record<string, string>;
      domainGroups: Record<string, string>;
    };
    raw: { cfs: string[]; living: string[]; domains: string[] };
  };
  const [c, setConfig] = useState<Config | null>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    api<Config>("/api/needs/settings")
      .then(setConfig)
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <Panel title="Administrator · needs reporting definitions">
      {message && <p role="status">{message}</p>}
      {c && (
        <div className="form-stack">
          <h3>Observed inactivity thresholds</h3>
          <div className="needs-two">
            {c.settings.inactivityBands.map((v, i) => (
              <Field
                key={i}
                label={`Band ${i + 1} upper boundary (days)`}
                type="number"
                value={String(v)}
                onChange={(value) =>
                  setConfig({
                    ...c,
                    settings: {
                      ...c.settings,
                      inactivityBands: c.settings.inactivityBands.map((n, j) =>
                        i === j ? Number(value) : n,
                      ),
                    },
                  })
                }
              />
            ))}
          </div>
          <h3>Transparent recommendation priorities</h3>
          <p>
            Priorities organise staff review; they are not individual risk
            scores.
          </p>
          {["quality", "barrier", "interest"].map((key) => (
            <Select
              key={key}
              label={key + " finding priority"}
              value={c.settings.planningPriorities?.[key] || "Medium"}
              options={["Low", "Medium", "High"]}
              onChange={(v) =>
                setConfig({
                  ...c,
                  settings: {
                    ...c.settings,
                    planningPriorities: {
                      ...c.settings.planningPriorities,
                      [key]: v,
                    },
                  },
                })
              }
            />
          ))}
          <h3>Approved CFS labels and meanings</h3>
          <p>
            Blank mappings preserve raw classifications. Do not infer clinical
            suitability from a code.
          </p>
          {c.raw.cfs.map((raw) => (
            <fieldset key={raw}>
              <legend>Raw CFS: {raw}</legend>
              <Field
                label={"CFS " + raw + " reporting label"}
                value={c.settings.cfsMappings[raw]?.label || ""}
                onChange={(v) =>
                  setConfig({
                    ...c,
                    settings: {
                      ...c.settings,
                      cfsMappings: {
                        ...c.settings.cfsMappings,
                        [raw]: {
                          ...(c.settings.cfsMappings[raw] || {
                            label: "",
                            meaning: "",
                          }),
                          label: v,
                        },
                      },
                    },
                  })
                }
              />
              <TextArea
                label={"CFS " + raw + " approved source meaning"}
                value={c.settings.cfsMappings[raw]?.meaning || ""}
                onChange={(v) =>
                  setConfig({
                    ...c,
                    settings: {
                      ...c.settings,
                      cfsMappings: {
                        ...c.settings.cfsMappings,
                        [raw]: {
                          ...(c.settings.cfsMappings[raw] || {
                            label: "",
                            meaning: "",
                          }),
                          meaning: v,
                        },
                      },
                    },
                  })
                }
              />
            </fieldset>
          ))}
          {(["livingGroups", "domainGroups"] as const).map((key) => (
            <div key={key}>
              <h3>
                {key === "livingGroups"
                  ? "Living arrangement reporting groups"
                  : "AAP domain reporting groups"}
              </h3>
              <p>
                Original values remain unchanged; leave blank to retain the
                original label.
              </p>
              {c.raw[key === "livingGroups" ? "living" : "domains"].map(
                (raw) => (
                  <Field
                    key={raw}
                    label={raw}
                    value={c.settings[key][raw] || ""}
                    onChange={(v) => {
                      const mapping = { ...c.settings[key] };
                      if (v.trim()) mapping[raw] = v;
                      else delete mapping[raw];
                      setConfig({
                        ...c,
                        settings: { ...c.settings, [key]: mapping },
                      });
                    }}
                  />
                ),
              )}
            </div>
          ))}
          <button
            className="button primary"
            onClick={async () => {
              try {
                await api("/api/needs/settings", {
                  method: "PUT",
                  body: JSON.stringify(c.settings),
                });
                setMessage(
                  "Organisation definitions saved and audited. Source values remain unchanged.",
                );
                onSaved();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Save needs reporting definitions
          </button>
        </div>
      )}
    </Panel>
  );
}
function RegistryImport({ onSaved }: { onSaved: () => void }) {
  return <ClientRegistryImport onSaved={onSaved} />;
}
