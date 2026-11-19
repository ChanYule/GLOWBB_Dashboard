import { useEffect, useState } from "react";
import { api, centreUrl } from "./api";
import type { Centre } from "../shared/centres.js";
import type { User } from "./types";
import "./configuration.css";
type Rule = {
  id: string;
  scope: string;
  selector: { ids?: string[]; type?: string; value?: string };
  reason: string;
  from: string;
  to: string;
  approvedIds: string[];
  reportId?: string;
};
type Settings = {
  seniorAge: number;
  ageBands: number[];
  minority: string[];
  inactivityBands: number[];
  engagement: { regularFrom: number };
  cfsMappings: Record<string, unknown>;
  livingGroups: Record<string, string>;
  domainGroups: Record<string, string>;
  riskMappings: Record<string, unknown>;
};
type Config = {
  settings: Settings;
  configuration: {
    version: number;
    rules: Rule[];
    qualityWarnings: Record<string, boolean>;
    sync: { categories: string[]; mode: string; from: string; to: string };
  };
  personal: Record<string, unknown>;
  templates: string[];
  caritaHub: { connected: boolean; note: string };
};
type Activity = {
  id: string;
  name: string;
  domain: string;
  eventTypes: string[];
  sessions: number;
  attendance: number;
  unique: number;
  status: string;
  rules: { scope: string; reason: string; from: string; to: string }[];
  pending: { id: string; scope: string; reason: string }[];
};
type Impact = {
  summary: Record<string, number | null>;
  rankings: { name: string; unique: number; attendance: number }[];
  clientMetrics: Record<string, unknown> | null;
  note: string;
};
type Preview = {
  id: string;
  version: number;
  nextVersion: number;
  matched: { id: string; name: string }[];
  impact: {
    before: Impact;
    after: Impact;
    report?: { before: Impact; after: Impact };
  };
  note: string;
};
type SharedPreview = {
  id: string;
  targets: { centreId: string; preview: Preview }[];
  note: string;
};
type Report = {
  id: string;
  template: string;
  reporting: { version: number; label: string };
  kpis: Record<string, number | null>;
  programmes: { name: string; unique: number; attendance: number }[];
  limitations: string[];
  period: { from: string; to: string };
  sections: string[];
  columns: string[];
  trends: { label: string; unique: number; attendance: number }[];
  demographics: Record<string, { label: string; value: number }[]>;
  clients: { summary: Record<string, unknown> } | null;
  needs: {
    respondents: number;
    eligible: number;
    scope: string;
    limitations: string[];
  };
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(
    new Date(),
  );
const fmt = (n: unknown) =>
  typeof n === "number"
    ? new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n)
    : "Unavailable";
const scopeNames: Record<string, string> = {
  official: "Official attendance KPIs",
  performance: "Programme performance only",
  report: "Selected saved report",
  review: "Flag for review",
};
const reasons = [
  "Administrative activity",
  "Duplicate or invalid programme",
  "Not part of programme KPI reporting",
  "Trial programme",
  "Special reporting arrangement",
  "Other",
];
const kpiNames: Record<string, string> = {
  unique: "Unique seniors",
  male: "Male seniors",
  minority: "Minority seniors",
  attendance: "Attendance entries",
  sessions: "Sessions",
  programmes: "Programmes",
  repeatRate: "Repeat participation (%)",
};
const chartChoices = [
  ["month", "Participation trend"],
  ["programme", "Programme rankings"],
  ["gender", "Gender"],
  ["race", "Race"],
  ["ages", "Age"],
  ["needs-cfs", "CFS"],
  ["needs-living", "Living arrangement"],
];
export function ConfigurationCentre({
  centre,
  centres,
  user,
  onChanged,
  onReturn,
  initialTab="activities",
}: {
  centre: Centre;
  centres: Centre[];
  user: User;
  onChanged: () => void;
  onReturn: () => void;
  initialTab?:string;
}) {
  const [tab, setTab] = useState(initialTab),
    [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [activities, setActivities] = useState<{
      key: string;
      rows: Activity[];
      total: number;
      pages: number;
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(today()),
    [effectiveFrom, setEffectiveFrom] = useState(""),
    [effectiveTo, setEffectiveTo] = useState(""),
    [scope, setScope] = useState("official"),
    [reason, setReason] = useState(reasons[0]),
    [explanation, setExplanation] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [matchType, setMatchType] = useState("contains"),
    [matchValue, setMatchValue] = useState(""),
    [reportId, setReportId] = useState(""),
    [sharedIds, setSharedIds] = useState<string[]>([centre.id]);
  const [preview, setPreview] = useState<Preview | null>(null),
    [sharedPreview, setSharedPreview] = useState<SharedPreview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [history, setHistory] = useState<
      {
        id: number;
        created: string;
        action: string;
        details: {
          actor: string;
          reason: string;
          before?: { reporting?: { version: number } };
          after?: { reporting?: { version: number } };
        };
      }[]
    >([]),
    [requests, setRequests] = useState<
      {
        id: number;
        created: string;
        details: { actor: string; reason: string; rule: Rule };
      }[]
    >([]);
  const [definitions, setDefinitions] = useState({
      seniorAge: 60,
      ageBands: "70,80",
      minority: "MALAY, INDIAN, OTHERS",
      inactivityBands: "30,60,90",
      regularFrom: 5,
    }),
    [mappingField, setMappingField] = useState("livingGroups"),
    [mappingSource, setMappingSource] = useState(""),
    [mappingLabel, setMappingLabel] = useState(""),
    [mappingMeaning, setMappingMeaning] = useState("");
  const [categories, setCategories] = useState<string[]>(["attendance"]),
    [syncMode, setSyncMode] = useState("all"),
    [syncFrom, setSyncFrom] = useState(""),
    [syncTo, setSyncTo] = useState("");
  const [personalFrom, setPersonalFrom] = useState(""),
    [personalTo, setPersonalTo] = useState(""),
    [personalKpis, setPersonalKpis] = useState([
      "unique",
      "male",
      "minority",
      "attendance",
    ]),
    [personalCharts, setPersonalCharts] = useState(["month", "programme"]),
    [dimension, setDimension] = useState("age"),
    [ranking, setRanking] = useState("unique"),
    [layout, setLayout] = useState("Overview"),
    [columns, setColumns] = useState([
      "name",
      "domain",
      "unique",
      "attendance",
      "sessions",
    ]);
  const [template, setTemplate] = useState("Monthly Centre Performance"),
    [reportMode, setReportMode] = useState("official"),
    [includeExcluded, setIncludeExcluded] = useState(false),
    [sections, setSections] = useState(["trends", "programmes"]),
    [report, setReport] = useState<Report | null>(null),
    [savedName, setSavedName] = useState(""),
    [reportKpis, setReportKpis] = useState([
      "unique",
      "male",
      "minority",
      "attendance",
    ]),
    [breakdowns, setBreakdowns] = useState(["gender", "race", "ages"]),
    [historyPage, setHistoryPage] = useState(1),
    [historyTotal, setHistoryTotal] = useState(0),
    [previewBasis, setPreviewBasis] = useState("");
  const formBasis = JSON.stringify({
    selected,
    from,
    to,
    effectiveFrom,
    effectiveTo,
    scope,
    reason,
    explanation,
    advanced,
    matchType,
    matchValue,
    reportId,
    sharedIds,
    definitions,
    mappingField,
    mappingSource,
    mappingLabel,
    mappingMeaning,
  });
  const previewCurrent = previewBasis === formBasis;
  const admin = user.role === "admin",
    key = [centre.id, debounced, status, page, from, to, revision].join("|"),
    list = activities?.key === key ? activities : null;
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reload = () => {
    setRevision((n) => n + 1);
    onChanged();
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let live = true;
    api<Config>("/api/configuration")
      .then((value) => {
        if (!live) return;
        setConfig(value);
        setDefinitions({
          seniorAge: value.settings.seniorAge,
          ageBands: value.settings.ageBands.join(", "),
          minority: value.settings.minority.join(", "),
          inactivityBands: value.settings.inactivityBands.join(", "),
          regularFrom: value.settings.engagement.regularFrom,
        });
        setCategories(value.configuration.sync.categories);
        setSyncMode(value.configuration.sync.mode);
        setSyncFrom(value.configuration.sync.from);
        setSyncTo(value.configuration.sync.to);
        const p = value.personal;
        setPersonalFrom(String(p.from || ""));
        setPersonalTo(String(p.to || ""));
        if (Array.isArray(p.kpis)) setPersonalKpis(p.kpis as string[]);
        if (Array.isArray(p.charts))
          setPersonalCharts(
            (p.charts as { group: string }[]).map((c) => c.group),
          );
        if (p.dimension) setDimension(String(p.dimension));
        if (p.ranking) setRanking(String(p.ranking));
        if (p.layout) setLayout(String(p.layout));
        if (Array.isArray(p.columns)) setColumns(p.columns as string[]);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [centre.id, revision]);
  useEffect(() => {
    if (tab !== "activities") return;
    let live = true;
    api<{ rows: Activity[]; total: number; pages: number }>(
      "/api/configuration/activities?" +
        new URLSearchParams({
          search: debounced,
          status,
          page: String(page),
          from,
          to,
        }),
    )
      .then((v) => {
        if (live) setActivities({ key, ...v });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [tab, key, debounced, status, page, from, to]);
  const previewChange = async (
    operation: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!config) return;
    setConfirmed(false);
    setPreviewBasis(formBasis);
    setPreview(null);
    setSharedPreview(null);
    const body = {
      operation,
      version: config.configuration.version,
      reason:
        reason === "Other"
          ? explanation
          : reason + (explanation ? " — " + explanation : ""),
      from,
      to,
      ...extra,
    };
    if (
      advanced &&
      operation === "rule" &&
      (sharedIds.length !== 1 || sharedIds[0] !== centre.id)
    ) {
      setSharedPreview(
        await api("/api/centres/configuration/preview", {
          method: "POST",
          body: JSON.stringify({ ...body, centreIds: sharedIds }),
        }),
      );
    } else
      setPreview(
        await api("/api/configuration/preview", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
  };
  useEffect(() => {
    if (preview || sharedPreview)
      document
        .querySelector(".configuration-preview")
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [preview, sharedPreview]);
  const proposeRule = () =>
    previewChange("rule", {
      rule: {
        scope,
        selector: advanced
          ? { type: matchType, value: matchValue }
          : { ids: selected },
        from: effectiveFrom,
        to: effectiveTo,
        reportId,
      },
    });
  const loadHistory = (requestedPage = 1) =>
    run(async () => {
      const h = await api<{ rows: typeof history; total: number }>(
        "/api/configuration/history?page=" + requestedPage,
      );
      setHistory(h.rows);
      setHistoryTotal(h.total);
      setHistoryPage(requestedPage);
      const r = await api<{ rows: typeof requests }>(
        "/api/configuration/requests",
      );
      setRequests(r.rows);
    });
  const savePersonal = () =>
    run(async () => {
      await api("/api/configuration/personal", {
        method: "PUT",
        body: JSON.stringify({
          from: personalFrom,
          to: personalTo,
          kpis: personalKpis,
          charts: personalCharts.map((group) => ({
            id: "personal-" + group,
            group,
            metric: "unique",
            type: group === "month" ? "line" : "bar",
          })),
          dimension,
          ranking,
          layout,
          columns,
        }),
      });
      setMessage(
        "Display preferences saved for this account. Official definitions are unchanged.",
      );
      reload();
    });
  if (!config)
    return (
      <main className="configuration-centre panel">
        <h1>Dashboard &amp; Data Configuration</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Loading reporting configuration..."}
        </p>
      </main>
    );
  const renderImpact = (p: Preview, name = centre.name) => (
    <section className="configuration-impact" key={name}>
      <h3>{name}: impact preview</h3>
      <p>
        Version {p.version} → {p.nextVersion}. {p.matched.length} matched
        activities. {p.note}
      </p>
      <div className="work-table">
        <table aria-label={"Reporting impact for " + name}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Current</th>
              <th>After change</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(kpiNames).map(([k, label]) => (
              <tr key={k}>
                <th>{label}</th>
                <td>{fmt(p.impact.before.summary[k])}</td>
                <td>{fmt(p.impact.after.summary[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.impact.report && (
        <p>
          Selected saved report:{" "}
          {fmt(p.impact.report.before.summary.attendance)} to{" "}
          {fmt(p.impact.report.after.summary.attendance)} attendance entries;{" "}
          {fmt(p.impact.report.before.summary.unique)} to{" "}
          {fmt(p.impact.report.after.summary.unique)} unique seniors.
          Centre-wide official totals are unchanged by report-only rules.
        </p>
      )}
      <p>
        Registered-client metrics:{" "}
        {p.impact.after.clientMetrics
          ? "Recalculated using the verified registry and eligible attendance."
          : "Unavailable without a complete verified registry."}
      </p>
      {p.impact.after.clientMetrics && (
        <div className="work-table">
          <table aria-label="Client impact">
            <thead>
              <tr>
                <th>Client metric</th>
                <th>Current</th>
                <th>After change</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(p.impact.after.clientMetrics)
                .filter(([, v]) => typeof v === "number" || v === null)
                .map(([k, v]) => (
                  <tr key={k}>
                    <th>
                      {(
                        {
                          registered: "Registered clients",
                          attending: "Participating clients",
                          noAttendance: "No eligible attendance in period",
                          rate: "Client participation rate (%)",
                          active: "Active clients",
                          inactive: "Inactive clients",
                          noHistory:
                            "No eligible attendance in available history",
                        } as Record<string, string>
                      )[k] || k.replace(/([A-Z])/g, " $1")}
                    </th>
                    <td>{fmt(p.impact.before.clientMetrics?.[k])}</td>
                    <td>{fmt(v)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <p>{p.impact.after.note}</p>
      <details>
        <summary>Matched activity names and programme ranking changes</summary>
        {p.matched.map((m) => (
          <p key={m.id}>{m.name}</p>
        ))}
        <p>
          Before:{" "}
          {p.impact.before.rankings
            .map((r) => r.name + " (" + r.unique + " reached)")
            .join("; ") || "No eligible programmes"}
        </p>
        <p>
          After:{" "}
          {p.impact.after.rankings
            .map((r) => r.name + " (" + r.unique + " reached)")
            .join("; ") || "No eligible programmes"}
        </p>
      </details>
    </section>
  );
  return (
    <main className="configuration-centre panel">
      <header>
        <div>
          <h1>Dashboard &amp; Data Configuration</h1>
          <p>
            Manage programme reporting, dashboard preferences and approved data
            rules.
          </p>
          <strong>
            {centre.name} · Official configuration version{" "}
            {config.configuration.version}
          </strong>
        </div>
        <button className="button" onClick={onReturn}>
          Return to dashboard
        </button>
      </header>
      <div
        className="configuration-tabs"
        role="tablist"
        aria-label="Configuration sections"
      >
        {[
          ["activities", "Activity Exclusions"],
          ["kpis", "KPI & Reporting Rules"],
          ["centres", "Centre Configuration"],
          ["sync", "CaritaHub Sync Settings"],
          ["personal", "Personal Dashboard Preferences"],
        ].map(([id, name]) => (
          <button
            role="tab"
            key={id}
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setError("");
              setReport(null);
              if (id !== "activities") {
                setReason("Other");
                setExplanation("");
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="configuration-period">
        <label>
          Impact reporting from
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Impact reporting to
          <input
            type="date"
            max={today()}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {tab === "activities" && (
        <section>
          <h2>Activity Exclusions</h2>
          <p>
            Valid source attendance is retained. Exclusion changes affect
            reporting only; names and categories never exclude records
            automatically.
          </p>
          <div className="configuration-filters">
            <label>
              Search activities
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Reporting status
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {["Included", "Excluded", "Review Required"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          {!list ? (
            <p role="status">Loading activities...</p>
          ) : (
            <>
              <p>
                {list.total} activities · Page {page} of {list.pages}
              </p>
              <div className="work-table">
                <table aria-label="Activity reporting configuration">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select current activity page"
                          checked={
                            !!list.rows.length &&
                            list.rows.every((r) => selected.includes(r.id))
                          }
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [
                                    ...new Set([
                                      ...old,
                                      ...list.rows.map((r) => r.id),
                                    ]),
                                  ]
                                : old.filter(
                                    (id) => !list.rows.some((r) => r.id === id),
                                  ),
                            )
                          }
                        />
                      </th>
                      {[
                        "Activity",
                        "Centre",
                        "Source AAP Domain / Event Type (audit)",
                        "Sessions",
                        "Entries",
                        "Unique participants",
                        "Reporting status",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"Select " + r.name}
                            checked={selected.includes(r.id)}
                            onChange={(e) =>
                              setSelected((old) =>
                                e.target.checked
                                  ? [...old, r.id]
                                  : old.filter((id) => id !== r.id),
                              )
                            }
                          />
                        </td>
                        <th>{r.name}</th>
                        <td>{centre.name}</td>
                        <td>
                          {r.domain}
                          <small>
                            {r.eventTypes.join(", ") ||
                              "No Event Type recorded"}
                          </small>
                        </td>
                        <td>{r.sessions}</td>
                        <td>{r.attendance}</td>
                        <td>{r.unique}</td>
                        <td>
                          <span
                            className={
                              "configuration-status " +
                              r.status.replaceAll(" ", "-").toLowerCase()
                            }
                          >
                            {r.status}
                          </span>
                          {r.rules.map((rule, i) => (
                            <small key={i}>
                              {scopeNames[rule.scope]} · {rule.reason}
                            </small>
                          ))}
                          {r.pending.length > 0 && (
                            <small>
                              New automatic match awaits approval; currently
                              included.
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="work-actions">
                <button
                  className="button"
                  disabled={page <= 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous activities
                </button>
                <button
                  className="button"
                  disabled={page >= list.pages}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next activities
                </button>
              </div>
            </>
          )}
          <section className="configuration-editor">
            <h3>Review changes for {selected.length} selected activities</h3>
            <label>
              Exclusion scope
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                {Object.entries(scopeNames).map(([v, label]) => (
                  <option value={v} key={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {scope === "report" && (
              <label>
                Saved report
                <select
                  value={reportId}
                  onChange={(e) => setReportId(e.target.value)}
                >
                  <option value="">Choose a saved report</option>
                  {(Array.isArray(config.personal.reportTemplates)
                    ? (config.personal.reportTemplates as {
                        id: string;
                        name: string;
                      }[])
                    : []
                  ).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <small>
                  Save a report preset in KPI &amp; Reporting Rules first.
                </small>
              </label>
            )}
            <p>
              {scope === "official"
                ? "Official attendance, reach, repeat participation and eligibility-based inactivity are recalculated. Client registry populations remain intact."
                : scope === "performance"
                  ? "Removes eligible sessions from programme rankings, domain comparisons and programme-performance recommendations. Centre-wide participation remains included."
                  : scope === "report"
                    ? "Applies only when generating the named saved report; centre-wide official KPIs remain unchanged."
                    : "Flags matching activities for staff review. No attendance is excluded."}
            </p>
            <details onToggle={(e) => setAdvanced(e.currentTarget.open)}>
              <summary>Advanced rule builder and shared policies</summary>
              <label>
                Match activities by
                <select
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value)}
                >
                  {[
                    ["name", "Exact programme name"],
                    ["contains", "Name contains"],
                    ["prefix", "Name prefix"],
                    ["domain", "Programme Domain"],
                    ["eventType", "Event Type"],
                    ["service", "Programme service (glow / seen)"],
                    ["flag", "Explicit reporting flag (duplicate / invalid)"],
                    ["all", "All activities in this centre"],
                  ].map(([id, label]) => (
                    <option value={id} key={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {matchType !== "all" && (
                <label>
                  Exact matching value
                  <input
                    value={matchValue}
                    onChange={(e) => setMatchValue(e.target.value)}
                  />
                </label>
              )}
              <p>
                Exact selected activity IDs take priority outside this builder.
                These conditions are centre-scoped. New matching activities will
                be included until reviewed.
              </p>
              {admin && (
                <fieldset>
                  <legend>Apply this policy to authorised centres</legend>
                  {centres.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={sharedIds.includes(c.id)}
                        onChange={(e) =>
                          setSharedIds((old) =>
                            e.target.checked
                              ? [...old, c.id]
                              : old.filter((id) => id !== c.id),
                          )
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </fieldset>
              )}
            </details>
            <div className="configuration-period">
              <label>
                Rule effective from
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </label>
              <label>
                Rule effective to
                <input
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                />
              </label>
            </div>
            <p>
              Blank effective dates apply across available reporting history.
              Source records stay stored.
            </p>
            <button
              className="button primary"
              disabled={
                busy ||
                (!advanced && !selected.length) ||
                (advanced && matchType !== "all" && !matchValue.trim())
              }
              onClick={() => run(proposeRule)}
            >
              Preview Matches &amp; Impact
            </button>
            {admin && (
              <button
                className="button"
                disabled={busy || !selected.length}
                onClick={() =>
                  run(() =>
                    previewChange("restoreActivities", { ids: selected }),
                  )
                }
              >
                Include Normally — preview restoration
              </button>
            )}
          </section>
          <details>
            <summary>Approved rules and new matching activities</summary>
            {config.configuration.rules.length ? (
              config.configuration.rules.map((rule) => (
                <article className="configuration-rule" key={rule.id}>
                  <strong>
                    {scopeNames[rule.scope]} · {rule.reason}
                  </strong>
                  <p>
                    {rule.approvedIds.length} approved activity IDs ·{" "}
                    {rule.from || "Available history"} to{" "}
                    {rule.to || "No end date"}. New matches require review.
                  </p>
                  {admin && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          previewChange("approveMatches", { ruleId: rule.id }),
                        )
                      }
                    >
                      Preview new matches for this rule
                    </button>
                  )}
                </article>
              ))
            ) : (
              <p>No activity exclusions are approved.</p>
            )}
          </details>
        </section>
      )}
      {tab === "kpis" && (
        <section>
          <h2>KPI &amp; Reporting Rules</h2>
          <p>
            Official definitions are centre settings. Unique participation
            always uses distinct Member IDs. Missing/unknown categories remain
            separate; first observed means first seen in available eligible
            history.
          </p>
          <fieldset disabled={!admin || busy}>
            <legend>Approved calculation parameters</legend>
            <div className="configuration-fields">
              <label>
                Senior age threshold
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={definitions.seniorAge}
                  onChange={(e) =>
                    setDefinitions((v) => ({
                      ...v,
                      seniorAge: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Two age boundaries
                <input
                  value={definitions.ageBands}
                  onChange={(e) =>
                    setDefinitions((v) => ({ ...v, ageBands: e.target.value }))
                  }
                />
              </label>
              <label>
                Minority source race categories
                <input
                  value={definitions.minority}
                  onChange={(e) =>
                    setDefinitions((v) => ({ ...v, minority: e.target.value }))
                  }
                />
              </label>
              <label>
                Three inactivity day thresholds
                <input
                  value={definitions.inactivityBands}
                  onChange={(e) =>
                    setDefinitions((v) => ({
                      ...v,
                      inactivityBands: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Regular engagement starts at sessions
                <input
                  type="number"
                  min="3"
                  max="1000"
                  value={definitions.regularFrom}
                  onChange={(e) =>
                    setDefinitions((v) => ({
                      ...v,
                      regularFrom: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
            <p>
              Repeat participation remains two or more distinct sessions.
              Regular engagement is a separate threshold. No recorded eligible
              history remains distinct from not attending the selected period.
            </p>
            <button
              className="button primary"
              onClick={() =>
                run(() =>
                  previewChange("definitions", {
                    values: {
                      seniorAge: definitions.seniorAge,
                      ageBands: definitions.ageBands.split(",").map(Number),
                      minority: definitions.minority
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                      inactivityBands: definitions.inactivityBands
                        .split(",")
                        .map(Number),
                      engagement: { regularFrom: definitions.regularFrom },
                    },
                  }),
                )
              }
            >
              Preview KPI definition changes
            </button>
          </fieldset>
          <details>
            <summary>Approved demographic and programme mappings</summary>
            <p>
              Source gender values remain MALE/FEMALE/UNKNOWN, with missing race
              separate from recorded UNKNOWN. No profile category or code is
              inferred from names or age.
            </p>
            <p>Programme Domain aliases accept only Physical, Cognitive, Learning, Social and Volunteerism. Separate multiple domains with commas or &amp;. The exact source value is preserved; review and confirm configuration changes to refresh analytics.</p>
            <fieldset disabled={!admin || busy}>
              <legend>Add or revise an exact approved mapping</legend>
              <label>
                Mapping type
                <select
                  value={mappingField}
                  onChange={(e) => setMappingField(e.target.value)}
                >
                  <option value="livingGroups">Living arrangement</option>
                  <option value="domainGroups">Programme Domains (approved exact aliases)</option>
                  <option value="cfsMappings">CFS</option>
                </select>
              </label>
              <label>
                Exact source value
                <input
                  value={mappingSource}
                  onChange={(e) => setMappingSource(e.target.value)}
                />
              </label>
              <label>
                Approved label
                <input
                  value={mappingLabel}
                  onChange={(e) => setMappingLabel(e.target.value)}
                />
              </label>
              {mappingField === "cfsMappings" && (
                <label>
                  Documented source meaning
                  <input
                    value={mappingMeaning}
                    onChange={(e) => setMappingMeaning(e.target.value)}
                  />
                </label>
              )}
              <button
                className="button"
                disabled={
                  !mappingSource.trim() ||
                  !mappingLabel.trim() ||
                  (mappingField === "cfsMappings" && !mappingMeaning.trim())
                }
                onClick={() =>
                  run(() =>
                    previewChange("definitions", {
                      values: {
                        [mappingField]: {
                          ...config.settings[
                            mappingField as
                              "cfsMappings" | "livingGroups" | "domainGroups"
                          ],
                          [mappingSource]:
                            mappingField === "cfsMappings"
                              ? { label: mappingLabel, meaning: mappingMeaning }
                              : mappingLabel,
                        },
                      },
                    }),
                  )
                }
              >
                Preview approved mapping
              </button>
            </fieldset>
            <p>
              Existing SRF mapping and codebook workflows remain available in
              the centre dashboard's social-risk definitions. Unmapped codes
              stay unknown.
            </p>
          </details>
          <details>
            <summary>Data quality warnings</summary>
            <p>
              Identity validation, date validation and exact attendance
              deduplication are mandatory. Missing optional information is a
              warning, never an automatic exclusion.
            </p>
            {Object.entries(config.configuration.qualityWarnings).map(
              ([name, value]) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    disabled={!admin || busy}
                    checked={value}
                    onChange={(e) =>
                      setConfig((c) =>
                        c
                          ? {
                              ...c,
                              configuration: {
                                ...c.configuration,
                                qualityWarnings: {
                                  ...c.configuration.qualityWarnings,
                                  [name]: e.target.checked,
                                },
                              },
                            }
                          : c,
                      )
                    }
                  />{" "}
                  Warn for missing{" "}
                  {
                    (
                      {
                        cfs: "CFS",
                        srf: "SRF",
                        living: "living arrangement",
                        domain: "Programme Domain",
                        eventType: "Event Type",
                      } as Record<string, string>
                    )[name]
                  }
                </label>
              ),
            )}
            <button
              className="button"
              disabled={!admin || busy}
              onClick={() =>
                run(() =>
                  previewChange("warnings", {
                    values: config.configuration.qualityWarnings,
                  }),
                )
              }
            >
              Preview warning preferences
            </button>
          </details>
          <section>
            <h3>Management reporting templates</h3>
            <label>
              Report template
              <select
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setReport(null);
                  if (e.target.value === "Inactive Client Engagement")
                    setSections(["clients", "trends"]);
                  else if (
                    e.target.value === "Participant Needs and Accessibility"
                  )
                    setSections(["needs", "demographics"]);
                  else if (e.target.value === "Male and Minority Outreach")
                    setSections(["demographics", "programmes"]);
                  else setSections(["trends", "programmes"]);
                }}
              >
                {config.templates.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Report mode
              <select
                value={reportMode}
                onChange={(e) => {
                  setReportMode(e.target.value);
                  setReport(null);
                }}
              >
                <option value="official">Official reporting</option>
                <option value="exploratory">Custom exploratory analysis</option>
              </select>
            </label>
            {reportMode === "exploratory" && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={includeExcluded}
                    onChange={(e) => setIncludeExcluded(e.target.checked)}
                  />{" "}
                  Temporarily include officially excluded activities
                </label>
                <p>
                  {selected.length} activities selected in Activity Exclusions
                  will be left out of this exploratory report only.
                </p>
              </>
            )}
            <fieldset>
              <legend>Report KPI cards</legend>
              {Object.entries(kpiNames).map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={reportKpis.includes(id)}
                    onChange={(e) => {
                      setReportKpis((old) =>
                        e.target.checked
                          ? [...old, id]
                          : old.filter((k) => k !== id),
                      );
                      setReport(null);
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Demographic breakdowns</legend>
              {[
                ["gender", "Gender"],
                ["race", "Race"],
                ["ages", "Age groups"],
              ].map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={breakdowns.includes(id)}
                    onChange={(e) => {
                      setBreakdowns((old) =>
                        e.target.checked
                          ? [...old, id]
                          : old.filter((k) => k !== id),
                      );
                      setReport(null);
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              Programme ranking metric
              <select
                value={ranking}
                onChange={(e) => {
                  setRanking(e.target.value);
                  setReport(null);
                }}
              >
                <option value="unique">Unique reach</option>
                <option value="attendance">Attendance entries</option>
                <option value="repeat">Repeat participation</option>
              </select>
            </label>
            <fieldset>
              <legend>Report sections</legend>
              {[
                ["trends", "Participation trends"],
                ["programmes", "Programme rankings"],
                ["demographics", "Demographic comparisons"],
                ["clients", "Client participation and inactivity"],
                ["needs", "Participant needs and accessibility"],
              ].map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={sections.includes(id)}
                    onChange={(e) =>
                      setSections((old) =>
                        e.target.checked
                          ? [...old, id]
                          : old.filter((k) => k !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setReport(
                    await api("/api/configuration/reports/preview", {
                      method: "POST",
                      body: JSON.stringify({
                        template,
                        mode: reportMode,
                        from,
                        to,
                        includeExcluded:
                          reportMode === "exploratory" && includeExcluded,
                        excludedIds:
                          reportMode === "exploratory" ? selected : [],
                        kpis: reportKpis,
                        ranking,
                        breakdowns,
                        sections,
                        reportId,
                        columns,
                      }),
                    }),
                  ),
                )
              }
            >
              Preview management report
            </button>
            {report && (
              <article className="configuration-impact">
                <h3>{report.template}</h3>
                <p>
                  {report.reporting.label} · Version {report.reporting.version}{" "}
                  · {centre.name}
                </p>
                {Object.entries(report.kpis).map(([k, v]) => (
                  <p key={k}>
                    {kpiNames[k] || k}: {fmt(v)}
                  </p>
                ))}
                <p>
                  {report.period.from || "Available history"} to{" "}
                  {report.period.to}. This preview is a fixed snapshot; generate
                  it again after changing report options.
                </p>
                {report.sections.includes("trends") && (
                  <>
                    <h4>Participation trend</h4>
                    <div className="configuration-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Period</th>
                            <th>Unique seniors</th>
                            <th>Attendance entries</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.trends.map((t) => (
                            <tr key={t.label}>
                              <td>{t.label}</td>
                              <td>{fmt(t.unique)}</td>
                              <td>{fmt(t.attendance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {report.sections.includes("programmes") && (
                  <>
                    <h4>Programme rankings</h4>
                    <div className="configuration-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {report.columns.map((k) => (
                              <th key={k}>{kpiNames[k] || k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.programmes.map((p, i) => (
                            <tr key={i}>
                              {report.columns.map((k) => (
                                <td key={k}>
                                  {typeof (p as Record<string, unknown>)[k] ===
                                  "number"
                                    ? fmt((p as Record<string, unknown>)[k])
                                    : String(
                                        (p as Record<string, unknown>)[k] ??
                                          "Unavailable",
                                      )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {report.sections.includes("demographics") &&
                  Object.entries(report.demographics).map(([name, rows]) => (
                    <section key={name}>
                      <h4>{name === "ages" ? "Age groups" : name}</h4>
                      {rows.map((row) => (
                        <p key={row.label}>
                          {row.label}: {fmt(row.value)}
                        </p>
                      ))}
                    </section>
                  ))}
                {report.sections.includes("clients") && (
                  <section>
                    <h4>Client participation and inactivity</h4>
                    {report.clients ? (
                      Object.entries(report.clients.summary).map(([k, v]) => (
                        <p key={k}>
                          {k.replace(/([A-Z])/g, " $1")}: {fmt(v)}
                        </p>
                      ))
                    ) : (
                      <p>
                        A complete, verified centre client registry is required.
                        Unavailable values are not zero.
                      </p>
                    )}
                  </section>
                )}
                {report.sections.includes("needs") && (
                  <section>
                    <h4>Participant needs and accessibility</h4>
                    <p>
                      {fmt(report.needs.respondents)} recorded respondents /{" "}
                      {fmt(report.needs.eligible)} eligible people. Scope:{" "}
                      {report.needs.scope}.
                    </p>
                    {report.needs.limitations.map((v) => (
                      <p key={v}>{v}</p>
                    ))}
                  </section>
                )}
                {report.limitations.map((v) => (
                  <p key={v}>{v}</p>
                ))}
                <a
                  className="button"
                  href={centreUrl(
                    "/api/configuration/reports/" +
                      report.id +
                      "/export?format=html",
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open report / Print or save as PDF
                </a>
                <a
                  className="button"
                  href={centreUrl(
                    "/api/configuration/reports/" +
                      report.id +
                      "/export?format=csv",
                  )}
                >
                  Download Excel-compatible CSV
                </a>
              </article>
            )}
            <label>
              Save this report as a personal preset
              <input
                value={savedName}
                onChange={(e) => setSavedName(e.target.value)}
                maxLength={100}
              />
            </label>
            <button
              className="button"
              disabled={busy || !savedName.trim()}
              onClick={() =>
                run(async () => {
                  const templates = Array.isArray(
                    config.personal.reportTemplates,
                  )
                    ? config.personal.reportTemplates
                    : [];
                  await api("/api/configuration/personal", {
                    method: "PUT",
                    body: JSON.stringify({
                      reportTemplates: [
                        ...templates,
                        {
                          id: crypto.randomUUID(),
                          name: savedName,
                          template,
                          mode: reportMode,
                          from,
                          to,
                          sections,
                          kpis: reportKpis,
                          ranking,
                          columns,
                          breakdowns,
                          excludedIds: selected,
                          includeExcluded,
                        },
                      ].slice(-30),
                    }),
                  });
                  setMessage(
                    "Personal report preset saved; official rules unchanged.",
                  );
                  reload();
                })
              }
            >
              Save personal report preset
            </button>
            {Array.isArray(config.personal.reportTemplates) &&
              (
                config.personal.reportTemplates as {
                  id: string;
                  name: string;
                  template: string;
                  mode: string;
                  from: string;
                  to: string;
                  sections: string[];
                  excludedIds: string[];
                  includeExcluded: boolean;
                  kpis?: string[];
                  ranking?: string;
                  columns?: string[];
                  breakdowns?: string[];
                }[]
              ).map((t) => (
                <button
                  className="button"
                  key={t.id}
                  onClick={() => {
                    setSavedName(t.name);
                    setTemplate(t.template);
                    if (t.kpis) setReportKpis(t.kpis);
                    if (t.ranking) setRanking(t.ranking);
                    if (t.columns) setColumns(t.columns);
                    if (t.breakdowns) setBreakdowns(t.breakdowns);
                    setReportMode(t.mode);
                    setFrom(t.from);
                    setTo(t.to);
                    setSections(t.sections);
                    setSelected(t.excludedIds);
                    setIncludeExcluded(t.includeExcluded);
                    setReportId(t.id);
                    setReport(null);
                  }}
                >
                  Load {t.name}
                </button>
              ))}
          </section>
        </section>
      )}
      {tab === "centres" && (
        <section>
          <h2>Centre Configuration</h2>
          <p>
            These settings belong to <strong>{centre.name}</strong>. Targets,
            source mappings, approved registry status and reference locations
            remain centre-scoped.
          </p>
          <p>
            Location aliases identify Bukit Batok or Nanyang. Activity Name
            determines GLOW/SEEN, including the verified GLOW_ separator.
            Original imported text is retained.
          </p>
          <p>
            Use the centre dashboard's Location analysis to review the reference
            address; no centre inherits Block 212 automatically. Existing
            outreach targets and programme metadata remain available in their
            current staff workflows.
          </p>
          <h3>Configuration history and approval queue</h3>
          {admin ? (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() => loadHistory()}
              >
                Load history and pending requests
              </button>
              {requests.map((r) => (
                <article className="configuration-rule" key={r.id}>
                  <strong>Request by {r.details.actor}</strong>
                  <p>
                    {r.details.reason} · {scopeNames[r.details.rule.scope]}
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        previewChange("approveRequest", { requestId: r.id }),
                      )
                    }
                  >
                    Preview requested exclusion
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(
                          "/api/configuration/requests/" + r.id + "/reject",
                          {
                            method: "POST",
                            body: JSON.stringify({
                              reason: explanation || reason,
                            }),
                          },
                        );
                        setMessage("Request not approved.");
                        await loadHistory();
                      })
                    }
                  >
                    Do not approve request
                  </button>
                </article>
              ))}
              {historyTotal > 20 && (
                <div className="work-actions">
                  <button
                    className="button"
                    disabled={busy || historyPage === 1}
                    onClick={() => loadHistory(historyPage - 1)}
                  >
                    Previous history
                  </button>
                  <span>
                    Page {historyPage} of {Math.ceil(historyTotal / 20)}
                  </span>
                  <button
                    className="button"
                    disabled={busy || historyPage * 20 >= historyTotal}
                    onClick={() => loadHistory(historyPage + 1)}
                  >
                    Next history
                  </button>
                </div>
              )}
              {history.map((h) => (
                <article className="configuration-rule" key={h.id}>
                  <strong>
                    {h.action === "configuration.approved"
                      ? "Approved configuration"
                      : "Configuration request or preference change"}{" "}
                    · {h.created}
                  </strong>
                  <p>
                    {h.details.actor}:{" "}
                    {h.details.reason || "Personal display settings"}
                  </p>
                  {h.details.after?.reporting && (
                    <p>
                      Version {h.details.before?.reporting?.version || 1} →{" "}
                      {h.details.after.reporting.version}
                    </p>
                  )}
                  {h.details.before && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          previewChange("restoreVersion", {
                            restoreVersion:
                              h.details.before?.reporting?.version || 1,
                          }),
                        )
                      }
                    >
                      Preview restoration of previous approved version
                    </button>
                  )}
                </article>
              ))}
            </>
          ) : (
            <p>
              Staff may request exclusions; administrators approve official
              changes and restore versions.
            </p>
          )}
        </section>
      )}
      {tab === "sync" && (
        <section>
          <h2>CaritaHub Sync Settings</h2>
          <p className="configuration-status review-required">Not connected</p>
          <p>
            {config.caritaHub.note} Valid source records, including
            reporting-excluded activities, must be preserved when a connector is
            configured.
          </p>
          <fieldset disabled={!admin || busy}>
            <legend>Draft retrieval preferences</legend>
            {[
              ["attendance", "Programme attendance"],
              ["clients", "Registered-client profiles"],
              ["programmes", "Programmes and sessions"],
              ["demographics", "Approved demographic fields"],
            ].map(([id, label]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={categories.includes(id)}
                  onChange={(e) =>
                    setCategories((old) =>
                      e.target.checked
                        ? [...old, id]
                        : old.filter((k) => k !== id),
                    )
                  }
                />
                {label}
              </label>
            ))}
            <p>
              Centre scope: {centre.name}. Shared source access requires a
              verified connector and authorised centre mapping.
            </p>
            <label>
              Retrieval mode
              <select
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value)}
              >
                <option value="all">All available records</option>
                <option value="dateRange">Approved date range</option>
                <option disabled>
                  Updated since last successful sync — unsupported until
                  connected
                </option>
              </select>
            </label>
            {syncMode === "dateRange" && (
              <div className="configuration-period">
                <label>
                  Retrieve from
                  <input
                    type="date"
                    value={syncFrom}
                    onChange={(e) => setSyncFrom(e.target.value)}
                  />
                </label>
                <label>
                  Retrieve to
                  <input
                    type="date"
                    value={syncTo}
                    onChange={(e) => setSyncTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            <p>
              Member ID matching and attendance deduplication are locked.
              Profile conflicts, source classifications and unmapped
              domains/types retain their established review flow. Reporting
              exclusions never discard retrieved source records.
            </p>
            <button
              className="button"
              onClick={() =>
                run(() =>
                  previewChange("sync", {
                    values: {
                      categories,
                      mode: syncMode,
                      from: syncFrom,
                      to: syncTo,
                    },
                  }),
                )
              }
            >
              Preview draft sync preferences
            </button>
          </fieldset>
          <button className="button" disabled>
            Sync unavailable — CaritaHub not connected
          </button>
          <p>
            Retrieved, validated, inserted/updated, duplicate and review counts
            are unavailable because no connector has run. They are not recorded
            as zero.
          </p>
        </section>
      )}
      {tab === "personal" && (
        <section>
          <h2>Personal Dashboard Preferences</h2>
          <p>
            Saved for <strong>{user.username}</strong>, within {centre.name}.{" "}
            {user.username === "Local workspace"
              ? "The current no-login workspace shares these preferences."
              : "Other accounts keep their own preferences."}{" "}
            These choices never change official calculations.
          </p>
          <div className="configuration-period">
            <label>
              Default reporting from
              <input
                type="date"
                value={personalFrom}
                onChange={(e) => setPersonalFrom(e.target.value)}
              />
            </label>
            <label>
              Default reporting to
              <input
                type="date"
                value={personalTo}
                onChange={(e) => setPersonalTo(e.target.value)}
              />
            </label>
          </div>
          <fieldset>
            <legend>Visible KPI cards in personal analysis</legend>
            {Object.entries(kpiNames)
              .filter(([k]) => k !== "repeatRate")
              .map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={personalKpis.includes(id)}
                    onChange={(e) =>
                      setPersonalKpis((old) =>
                        e.target.checked
                          ? [...old, id]
                          : old.filter((k) => k !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
          </fieldset>
          <fieldset>
            <legend>Visible personal charts</legend>
            {chartChoices.map(([id, label]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={personalCharts.includes(id)}
                  onChange={(e) =>
                    setPersonalCharts((old) =>
                      e.target.checked
                        ? [...old, id]
                        : old.filter((k) => k !== id),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="configuration-fields">
            <label>
              Preferred demographic analysis
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
              >
                {[
                  ["age", "Age"],
                  ["cfs", "CFS"],
                  ["risk", "SRF"],
                  ["living", "Living arrangement"],
                  ["gender", "Gender"],
                  ["race", "Race"],
                ].map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default programme ranking
              <select
                value={ranking}
                onChange={(e) => setRanking(e.target.value)}
              >
                <option value="unique">Unique reach</option>
                <option value="attendance">Attendance entries</option>
                <option value="repeat">Repeat participation</option>
              </select>
            </label>
            <label>
              Preferred report layout
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value)}
              >
                <option>Overview</option>
                <option>Programme Planning</option>
                <option>Outreach Analysis</option>
                <option>Participant Profile</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>Programme columns in configured reports</legend>
            {[
              "name",
              "domain",
              "unique",
              "attendance",
              "sessions",
              "repeat",
            ].map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={columns.includes(id)}
                  onChange={(e) =>
                    setColumns((old) =>
                      e.target.checked
                        ? [...old, id]
                        : old.filter((k) => k !== id),
                    )
                  }
                />
                {id}
              </label>
            ))}
          </fieldset>
          <p>
            Defaults are used by personal analysis and saved report presets.
            Current dashboard dates are preserved while switching centres.
          </p>
          <button
            className="button primary"
            disabled={busy || !personalKpis.length}
            onClick={savePersonal}
          >
            Save personal display defaults
          </button>
          <p>
            Preferred centre is saved using the global centre selector. Existing
            saved analysis views remain available in Custom Analysis.
          </p>
        </section>
      )}
      <section className="configuration-reason">
        <h3>Change reason</h3>
        <label>
          Reporting reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasons.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          {reason === "Other"
            ? "Required explanation"
            : "Additional explanation (optional)"}
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            maxLength={400}
          />
        </label>
      </section>
      {(preview || sharedPreview) && (
        <section
          className="configuration-preview"
          aria-label="Configuration impact preview"
        >
          {!previewCurrent && (
            <p role="alert">
              The form changed after this preview. Preview the change again
              before approving.
            </p>
          )}
          {preview && renderImpact(preview)}
          {sharedPreview && (
            <>
              <p>{sharedPreview.note}</p>
              {sharedPreview.targets.map((t) =>
                renderImpact(
                  t.preview,
                  centres.find((c) => c.id === t.centreId)?.name || t.centreId,
                ),
              )}
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed && previewCurrent}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I reviewed the impact, matched activities, dates and all selected
            centres.
          </label>
          <div className="work-actions">
            <button
              className="button"
              onClick={() => {
                setPreview(null);
                setSharedPreview(null);
              }}
            >
              Cancel proposed change
            </button>
            <button
              className="button primary"
              disabled={busy || !confirmed || !previewCurrent}
              onClick={() =>
                run(async () => {
                  const result = await api<{ status?: string }>(
                    sharedPreview
                      ? "/api/centres/configuration/confirm"
                      : "/api/configuration/confirm",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        id: sharedPreview?.id || preview?.id,
                        confirmed: true,
                        bulkConfirmed: true,
                      }),
                    },
                  );
                  setMessage(
                    result.status === "Pending approval"
                      ? "Exclusion request submitted for administrator approval. Official reports are unchanged."
                      : "Configuration approved. Source attendance is preserved; reporting will refresh.",
                  );
                  setPreview(null);
                  setSharedPreview(null);
                  setConfirmed(false);
                  setSelected([]);
                  reload();
                })
              }
            >
              {admin
                ? "Approve reporting configuration"
                : "Request administrator approval"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
