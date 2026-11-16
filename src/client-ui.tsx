import { Coverage } from "./management";
import { useEffect, useRef, useState,lazy,Suspense } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Filter,
  Home,
  Layers3,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import type { Filters, User } from "./types";
import { ActionEditor, blankAction, ParticipantEditor } from "./needs-ui";
import { ClientRegistryImport } from "./client-import";
import "./clients.css";
const ClientOutreach=lazy(()=>import('./client-outreach').then(m=>({default:m.ClientOutreach})));
const OutreachPriorities = lazy(() =>
  import("./outreach-priorities-ui").then((m) => ({
    default: m.OutreachPriorities,
  })),
);
type ClientQuery = Record<string, string>;
type Metric = number | null;
type ComparisonRow = {
  label: string;
  suppressed: boolean;
  registered: Metric;
  attending: Metric;
  noAttendance: Metric;
  rate: Metric;
  averageSessions: Metric;
  lastPatterns: { label: string; value: number }[];
  domains: { label: string; value: number }[];
};
type Finding = {
  id: string;
  title: string;
  finding: string;
  why: string;
  investigate: string;
  action: string;
  target: string;
  evidence: string;
  priority: string;
  next: string;
};
export type ClientReport = {
  attendanceAvailable: boolean;
  available: boolean;
  complete: boolean;
  suppressed: boolean;
  minimum: number;
  generatedAt: string;
  period: { from: string | null; to: string; asOf: string };
  coverage: { from: string | null; to: string | null };
  registry: { asOf: string | null; source: string | null };
  summary: Record<string, Metric>;
  privacyNote: string;
  populationNote: string;
  limitations: string[];
  groups: Record<string, { suppressed: boolean; rows: ComparisonRow[] }>;
  statuses: {
    note?: string;
    suppressed: boolean;
    bands: number[];
    rows: { label: string; value: number }[];
  };
  barriers: {
    suppressed: boolean;
    respondents: Metric;
    unassessed: Metric;
    rows: { label: string; value: number; percent: Metric }[];
  };
  findings: Finding[];
  quality: {
    field: string;
    label: string;
    missing: Metric;
    unknown?: Metric;
    total: number;
    source: string;
  }[];
  options: Record<string, string[]>;
  programmes: { id: string; name: string; domain: string }[];
};
type ClientView = {
  id: string;
  name: string;
  filters: ClientQuery;
  kpis: string[];
  charts: string[];
  display?: Record<string, string>;
};
type ClientPreferences = {
  views: ClientView[];
  draft?: ClientView;
  sharedTemplates?: ClientView[];
};
type Followup = {
  id: string;
  memberId: string;
  age: number | null;
  living: string;
  block: string;
  last: string | null;
  status: string;
  attendance: number;
  followUp: string;
  assigned: string;
  lastContact: string | null;
  profileRevision: number;
  membershipRevision: number;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const fmt = (value: Metric | undefined, rate = false) =>
  value == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", {
        maximumFractionDigits: rate ? 1 : 0,
      }).format(value) + (rate ? "%" : "");
const cardLabels: Record<string, string> = {
  registered: "Registered clients",
  attending: "Clients who attended",
  noAttendance: "No recorded attendance",
  rate: "Client participation rate",
  active: "Active clients",
  inactive: "Previously observed, now inactive",
  maleRate: "Male client participation",
  minorityRate: "Minority client participation",
  livingAloneNoAttendance: "Living alone, no recorded attendance",
  otherAttenders: "Other attendance participants",
};
const groupLabels: Record<string, string> = {
  gender: "Gender and participation",
  age: "Age and participation",
  living: "Living arrangement and participation",
  race: "Race and participation",
  cfs: "Recorded CFS and participation",
  risk: "Recorded SRF and participation",
  block: "Residential block comparison",
  zone: "Staff-defined zone comparison",
  statuses: "Recorded engagement status",
  barriers: "Participant-reported barriers",
};
const templateNames = [
  "Registered Client Engagement",
  "Inactive and Less Active Clients",
  "Living Arrangement Analysis",
  "Gender and Minority Outreach",
  "CFS and SRF Participation",
  "Residential Block and Location Analysis",
  "Participation Barriers",
  "Programme Planning Recommendations",
];
const defaultCards = [
  "registered",
  "attending",
  "noAttendance",
  "rate",
  "active",
  "inactive",
];
const outcomes = [
  "Contact attempted",
  "Contact successful",
  "Participant not interested",
  "Participant interested",
  "Follow-up required",
  "Referral or support required",
  "Other approved outcome",
];
const statusLabel = (code: string, bands = [30, 60, 90]) =>
  ({
    active: `Active · last ${bands[0]} days`,
    recent: `Recently less active · ${bands[0] + 1}–${bands[1]} days`,
    "inactive-61-90": `Inactive · ${bands[1] + 1}–${bands[2]} days`,
    "inactive-90": `Inactive · over ${bands[2]} days`,
    "no-history": "No recorded attendance in available history",
    "history-limited": "History not current for this reporting date",
  })[code] || code;
function template(name: string, q: ClientQuery): ClientView {
  return {
    id: "",
    name,
    filters: {
      ...q,
      status: "",
      gender: "",
      living: "",
      cfs: "",
      risk: "",
      block: "",
      zone: "",
      ageMin: "",
      ageMax: "",
      interest: "",
      need: "",
      barrier: "",
      followUp: "",
    },
    kpis:
      name === "Gender and Minority Outreach"
        ? ["registered", "attending", "rate", "maleRate", "minorityRate"]
        : name === "Living Arrangement Analysis"
          ? ["registered", "attending", "rate", "livingAloneNoAttendance"]
          : defaultCards,
    charts:
      name === "Living Arrangement Analysis"
        ? ["living"]
        : name === "CFS and SRF Participation"
          ? ["cfs", "risk"]
          : name === "Residential Block and Location Analysis"
            ? ["block", "zone"]
            : name === "Participation Barriers"
              ? ["barriers"]
              : name === "Inactive and Less Active Clients"
                ? ["statuses"]
                : name === "Gender and Minority Outreach"
                  ? ["gender", "race"]
                  : ["living", "statuses"],
    display: {},
  };
}
function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="client-drawer"
      aria-label={title}
      onCancel={onClose}
    >
      <header>
        <div>
          <span className="eyebrow">AUTHORISED STAFF WORKSPACE</span>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close client workspace"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="client-drawer-body">{children}</div>
    </dialog>
  );
}
function Compare({
  title,
  rows,
  display,
  onDisplay,
  onFollowup,
}: {
  title: string;
  rows: ComparisonRow[];
  display: string;
  onDisplay: (v: string) => void;
  onFollowup: (label: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("registered"),
    [page, setPage] = useState(1);
  const selected = rows
    .filter((r) => r.label.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sort === "label"
        ? a.label.localeCompare(b.label, "en", { numeric: true })
        : Number(b[sort as keyof ComparisonRow] ?? -1) -
          Number(a[sort as keyof ComparisonRow] ?? -1),
    );
  const slice = selected.slice((page - 1) * 10, page * 10),
    max = Math.max(1, ...selected.map((r) => r.registered || 0));
  return (
    <section className="panel client-comparison">
      <div className="client-panel-head">
        <div>
          <span className="eyebrow">POPULATION VS PARTICIPATION</span>
          <h2>{title}</h2>
        </div>
        <select
          aria-label={`${title} display`}
          value={display}
          onChange={(e) => onDisplay(e.target.value)}
        >
          <option value="bar">Grouped bars</option>
          <option value="table">Comparison table</option>
        </select>
      </div>
      <p className="muted">
        Distinct registered clients, all ages. Missing information is kept
        separate; category membership does not explain why someone has not
        attended.
      </p>
      {rows.length > 10 && (
        <div className="client-search-row">
          <label className="field">
            <span>Search {title.toLowerCase()}</span>
            <input
              value={search}
              placeholder="Type a block, zone or category"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="field">
            <span>Sort comparison</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="registered">Most registered clients</option>
              <option value="noAttendance">Most without attendance</option>
              <option value="rate">Highest participation rate</option>
              <option value="label">Category / block</option>
            </select>
          </label>
        </div>
      )}
      {display === "table" ? (
        <div className="client-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Registered</th>
                <th>Attended</th>
                <th>No recorded attendance</th>
                <th>Participation</th>
                <th>Sessions per attendee</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  <td>{fmt(r.registered)}</td>
                  <td>{fmt(r.attending)}</td>
                  <td>{fmt(r.noAttendance)}</td>
                  <td>{fmt(r.rate, true)}</td>
                  <td>
                    {r.averageSessions == null
                      ? r.suppressed
                        ? "Withheld"
                        : "Not applicable"
                      : r.averageSessions.toFixed(1)}
                  </td>
                  <td>
                    {!r.suppressed && (
                      <button
                        className="text-button"
                        onClick={() => onFollowup(r.label)}
                      >
                        Review clients
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="client-legend">
            <span>
              <i />
              Registered clients
            </span>
            <span>
              <i />
              Attended
            </span>
          </div>
          <div className="client-bar-list">
            {slice.map((r) => (
              <div className="client-bar-row" key={r.label}>
                <div>
                  <strong>{r.label}</strong>
                  {r.suppressed ? (
                    <span>
                      Withheld · small group or complementary category
                    </span>
                  ) : (
                    <span>
                      {fmt(r.attending)} of {fmt(r.registered)} attended ·{" "}
                      {fmt(r.rate, true)}
                    </span>
                  )}
                </div>
                {!r.suppressed && (
                  <>
                    <div
                      className="client-bars"
                      aria-label={`${r.attending} of ${r.registered} clients attended`}
                    >
                      <i
                        style={{
                          width: `${((r.registered || 0) / max) * 100}%`,
                        }}
                      />
                      <b
                        style={{
                          width: `${((r.attending || 0) / max) * 100}%`,
                        }}
                      />
                    </div>
                    <button
                      className="text-button"
                      onClick={() => onFollowup(r.label)}
                    >
                      Review clients <ArrowRight size={14} />
                    </button>
                    <details className="client-row-detail">
                      <summary>Frequency and recorded engagement</summary>
                      <p>
                        {r.averageSessions == null
                          ? "No participating clients; average sessions is not applicable."
                          : `${r.averageSessions.toFixed(1)} distinct sessions per participating client.`}
                      </p>
                      {r.domains.length > 0 ? (
                        <p>
                          Domains reached:{" "}
                          {r.domains
                            .map((d) => `${d.label}: ${d.value} clients`)
                            .join("; ")}
                          . People overlap across domains.
                        </p>
                      ) : (
                        <p>
                          Detailed domain counts are unavailable or withheld.
                        </p>
                      )}
                      {r.lastPatterns.length > 0 && (
                        <p>
                          Last-attendance patterns:{" "}
                          {r.lastPatterns
                            .map((p) => `${statusLabel(p.label)}: ${p.value}`)
                            .join("; ")}
                          .
                        </p>
                      )}
                    </details>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {!selected.length && (
        <p className="client-empty">
          No matching categories. Try another search.
        </p>
      )}
      {selected.length > 10 && (
        <div className="client-pagination">
          <button
            className="button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(selected.length / 10)}
          </span>
          <button
            className="button"
            disabled={page * 10 >= selected.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
      {rows.some((r) => r.suppressed) && (
        <p className="client-privacy">
          <ShieldCheck size={15} /> Small categories and complementary values
          are withheld together. Unrecorded living arrangements are an
          information gap.
        </p>
      )}
    </section>
  );
}
export function ClientOverview({
  user,
  filters,
  version = 0,
  onNavigate,
}: {
  user: User;
  filters: Filters;
  version?: number;
  onNavigate: () => void;
}) {
  const [report, setReport] = useState<ClientReport | null>(null);
  useEffect(() => {
    if (user.role === "viewer") return;
    let live = true;
    api<ClientReport>("/api/clients/report", {
      method: "POST",
      body: JSON.stringify({
        from: filters.from || "",
        to: filters.to || "",
        asOf: today(),
      }),
    })
      .then((r) => {
        if (live) setReport(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user.role, filters.from, filters.to, version]);
  if (!report?.available || user.role === "viewer") return null;
  return (
    <section
      className="client-overview-link"
      aria-label="Registered client participation summary"
    >
      <div>
        <span className="eyebrow">LINKED CLIENT COVERAGE</span>
        <h2>Are our registered clients being reached?</h2>
        <p>
          Current registry compared with attendance in this reporting period.
        </p>
      </div>
      <div>
        <strong>{fmt(report.summary.registered)}</strong>
        <small>REGISTERED CLIENTS</small>
      </div>
      <div>
        <strong>{fmt(report.summary.attending)}</strong>
        <small>WITH ATTENDANCE</small>
      </div>
      <div>
        <strong>{fmt(report.summary.rate, true)}</strong>
        <small>PARTICIPATION</small>
      </div>
      <button className="button" onClick={onNavigate}>
        Review client engagement <ArrowRight size={16} />
      </button>
    </section>
  );
}
export function ClientEngagement({
  user,
  initialFilters,
  coverageTo,
  dataRevision = 0,
  onImportAttendance,
  onChanged,
  onLocations,
}: {
  user: User;
  initialFilters: Filters;
  coverageTo?: string | null;
  dataRevision?: number;
  onImportAttendance?: () => void;
  onChanged: () => void;
  onLocations?: () => void;
}) {
  const initial = {
    from:
      coverageTo && (initialFilters.from || "") > coverageTo
        ? ""
        : initialFilters.from || "",
    to:
      coverageTo && (!initialFilters.to || initialFilters.to > coverageTo)
        ? coverageTo
        : initialFilters.to || "",
    asOf: coverageTo && coverageTo < today() ? coverageTo : today(),
  };
  const [view, setView] = useState<ClientView>(() =>
      template("Registered Client Engagement", initial),
    ),
    [prefs, setPrefs] = useState<ClientPreferences>({ views: [] }),
    [ready, setReady] = useState(false),
    [report, setReport] = useState<ClientReport | null>(null),
    [reportQuery, setReportQuery] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("analysis"),
    [tool, setTool] = useState(""),
    [customise, setCustomise] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [viewName, setViewName] = useState("My client engagement view"),
    [selected, setSelected] = useState<Followup | null>(null),
    [action, setAction] = useState<ReturnType<typeof blankAction> | null>(null);
  const q = view.filters;
  const previousCoverage = useRef(coverageTo);
  useEffect(() => {
    if (coverageTo && !previousCoverage.current && !prefs.draft)
      setView((v) => ({
        ...v,
        filters: {
          ...v.filters,
          from: v.filters.from > coverageTo ? "" : v.filters.from,
          to:
            !v.filters.to || v.filters.to > coverageTo
              ? coverageTo
              : v.filters.to,
          asOf: v.filters.asOf > coverageTo ? coverageTo : v.filters.asOf,
        },
      }));
    previousCoverage.current = coverageTo;
  }, [coverageTo, prefs.draft]);
  useEffect(() => {
    if (user.role === "viewer") return;
    let live = true;
    api<ClientPreferences>("/api/clients/preferences")
      .then((p) => {
        if (live) {
          setPrefs({ ...p, views: p.views || [] });
          if (p.draft) setView(p.draft);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [user.role]);
  useEffect(() => {
    if (!ready || user.role === "viewer") return;
    if(['outreach','priorities'].includes(tab)){setBusy(false);return;}
    let live = true;
    const controller = new AbortController();
    setBusy(true);
    api<ClientReport>("/api/clients/report", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify(q),
    })
      .then((r) => {
        if (live) {
          setReport(r);
          setReportQuery(JSON.stringify(q));
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [q, revision, ready, user.role, dataRevision,tab]);
  const refresh = () => {
    setRevision((n) => n + 1);
    onChanged();
  };
  const filter = (key: string, value: string) =>
    setView((v) => ({ ...v, filters: { ...v.filters, [key]: value } }));
  const save = async (isNew: boolean) => {
    const nextView = {
      ...view,
      id: isNew ? crypto.randomUUID() : view.id,
      name: isNew ? viewName.trim() || "My client engagement view" : view.name,
    };
    const next = {
      ...prefs,
      draft: nextView,
      views: isNew
        ? [...prefs.views, nextView]
        : prefs.views.map((v) => (v.id === nextView.id ? nextView : v)),
    };
    try {
      await api("/api/clients/preferences", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setPrefs(next);
      setView(nextView);
      setMessage("Your client view was saved to this account.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (user.role === "viewer")
    return (
      <section className="panel">
        <h2>Authorised client analysis</h2>
        <p>
          Client participation, residential analysis and individual follow-up
          are restricted to authorised planners and administrators.
        </p>
      </section>
    );
  const reviewGroup = (group: string, label: string) => {
    const key = (
      {
        age: "ageGroup",
        living: "living",
        block: "block",
        zone: "zone",
        cfs: "cfs",
        risk: "risk",
        gender: "gender",
        race: "race",
      } as Record<string, string>
    )[group];
    filter(key, label);
    setTab("followups");
  };
  const selectedCount = Object.entries(q).filter(
    ([k, v]) => v && !["from", "to", "asOf"].includes(k),
  ).length;
  return (
    <div className="client-workspace">
      <section className="client-intro">
        <span className="client-icon">
          <Users size={26} />
        </span>
        <div>
          <span className="eyebrow">
            REGISTERED PEOPLE · RECORDED PARTICIPATION
          </span>
          <h2>Connect your client population to programme attendance</h2>
          <p>
            See who is reached, review gaps and collect feedback before choosing
            an outreach approach.
          </p>
        </div>
        <div className="client-actions">
          {user.role === "admin" && (
            <button
              className="button primary"
              onClick={() => setTool(tool === "import" ? "" : "import")}
            >
              <FileSpreadsheet size={17} /> Import client registry
            </button>
          )}
          <button className="button" onClick={() => setCustomise((v) => !v)}>
            <Settings2 size={17} /> Customise client view
          </button>
        </div>
      </section>
      <div className="client-tabs" aria-label="Client engagement sections">
        {onLocations && (
          <button onClick={onLocations}>
            Location & Participation Insights
          </button>
        )}
        {[
          ["outreach", "Outreach priorities"],
          ["priorities", "Follow-up priorities"],
          ["analysis", "Client participation"],
          ["explore", "Explore client participation gaps"],
          ["followups", "Client follow-up list"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              if (key === "explore") setAdvanced(true);
            }}
          >
            {label}
          </button>
        ))}
        {user.role === "admin" && (
          <button
            aria-pressed={tool === "settings"}
            onClick={() => setTool(tool === "settings" ? "" : "settings")}
          >
            <Layers3 size={16} /> Zones & rules
          </button>
        )}
      </div>
      {tool === "import" && (
        <ClientRegistryImport
          onSaved={() => {
            refresh();
            setMessage(
              "Registry saved; client participation has been recalculated.",
            );
          }}
        />
      )}
      {tool === "settings" && <ClientSettings onSaved={refresh} />}
      {customise && (
        <section className="panel client-customise">
          <div className="client-panel-head">
            <div>
              <span className="eyebrow">YOUR WORKSPACE</span>
              <h2>Choose the cards and comparisons you use</h2>
            </div>
            <button className="text-button" onClick={() => setCustomise(false)}>
              Done
            </button>
          </div>
          <div className="client-filter-grid">
            <label className="field">
              <span>Ready-made client view</span>
              <select
                value={templateNames.includes(view.name) ? view.name : ""}
                onChange={(e) => setView(template(e.target.value, initial))}
              >
                <option value="">Custom view</option>
                {templateNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Saved client views</span>
              <select
                value={view.id}
                onChange={(e) => {
                  const v = prefs.views.find((v) => v.id === e.target.value);
                  if (v) setView(v);
                }}
              >
                <option value="">Choose a saved view</option>
                {prefs.views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Shared administrator client templates</span>
            <select
              value=""
              onChange={(e) => {
                const selected = prefs.sharedTemplates?.find(
                  (v) => v.id === e.target.value,
                );
                if (selected) setView({ ...selected, id: "" });
              }}
            >
              <option value="">Choose a shared template</option>
              {(prefs.sharedTemplates || []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>KPI cards · four to six recommended</legend>
            <div className="client-check-grid">
              {Object.entries(cardLabels).map(([key, label]) => (
                <label className="checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={view.kpis.includes(key)}
                    onChange={(e) =>
                      setView((v) => ({
                        ...v,
                        kpis: e.target.checked
                          ? [...v.kpis, key]
                          : v.kpis.filter((k) => k !== key),
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Comparisons and chart order</legend>
            <div className="client-check-grid">
              {Object.entries(groupLabels).map(([key, label]) => (
                <label className="checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={view.charts.includes(key)}
                    onChange={(e) =>
                      setView((v) => ({
                        ...v,
                        charts: e.target.checked
                          ? [...v.charts, key]
                          : v.charts.filter((k) => k !== key),
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="client-chart-order">
              {view.charts.map((key, index) => (
                <div key={key}>
                  <span>
                    {index + 1}. {groupLabels[key]}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Move ${groupLabels[key]} up`}
                    disabled={index === 0}
                    onClick={() =>
                      setView((v) => {
                        const charts = [...v.charts];
                        [charts[index - 1], charts[index]] = [
                          charts[index],
                          charts[index - 1],
                        ];
                        return { ...v, charts };
                      })
                    }
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${groupLabels[key]} down`}
                    disabled={index === view.charts.length - 1}
                    onClick={() =>
                      setView((v) => {
                        const charts = [...v.charts];
                        [charts[index + 1], charts[index]] = [
                          charts[index],
                          charts[index + 1],
                        ];
                        return { ...v, charts };
                      })
                    }
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="client-actions">
            <label className="field">
              <span>New client view name</span>
              <input
                value={viewName}
                maxLength={100}
                onChange={(e) => setViewName(e.target.value)}
              />
            </label>
            <button className="button primary" onClick={() => void save(true)}>
              Save as new client view
            </button>
            <button className="button" onClick={() => void save(false)}>
              Save current client layout
            </button>
            {user.role === "admin" && (
              <button
                className="button"
                onClick={async () => {
                  try {
                    await api("/api/clients/templates", {
                      method: "PUT",
                      body: JSON.stringify({
                        view: {
                          ...view,
                          id: crypto.randomUUID(),
                          name: viewName.trim() || view.name,
                        },
                      }),
                    });
                    const next = await api<ClientPreferences>(
                      "/api/clients/preferences",
                    );
                    setPrefs((p) => ({
                      ...p,
                      sharedTemplates: next.sharedTemplates,
                    }));
                    setMessage("Client template shared with authorised staff.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Share administrator client template
              </button>
            )}
          </div>
        </section>
      )}
      <section
        className="panel client-filters"
        aria-label="Client participation filters"
      >
        <div className="client-filter-grid">
          <label className="field">
            <span>Attendance from</span>
            <input
              type="date"
              value={q.from || ""}
              max={q.to || q.asOf}
              onChange={(e) => filter("from", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Attendance to</span>
            <input
              type="date"
              value={q.to || ""}
              min={q.from}
              max={q.asOf}
              onChange={(e) => filter("to", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Reporting date for engagement status</span>
            <input
              type="date"
              value={q.asOf}
              max={today()}
              onChange={(e) => filter("asOf", e.target.value)}
            />
          </label>
          {!['outreach','priorities'].includes(tab)&&<label className="field">
            <span>Participation status</span>
            <select
              value={q.status || ""}
              onChange={(e) => filter("status", e.target.value)}
            >
              <option value="">All registered clients</option>
              <option value="attending">Recorded attendance in period</option>
              <option value="no-attendance">
                No recorded attendance in period
              </option>
              <option value="active">Active under configured rules</option>
              <option value="recent">Recently less active</option>
              <option value="inactive">
                Previously observed, now inactive
              </option>
              <option value="no-history">
                No recorded attendance in available history
              </option>
            </select>
          </label>}
        </div>
        <div className="client-actions">
          {!['outreach','priorities'].includes(tab)&&<button
            className="text-button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((v) => !v)}
          >
            <Filter size={16} />{" "}
            {advanced ? "Hide advanced filters" : "More client filters"}
            {selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>}
          <button
            className="text-button"
            onClick={() => setView((v) => ({ ...v, filters: initial }))}
          >
            Reset client filters
          </button>
        </div>
        {!['outreach','priorities'].includes(tab) && advanced && report && (
          <div className="client-filter-grid client-advanced">
            {[
              ["gender", "Gender"],
              ["race", "Race"],
              ["ageGroup", "Age group"],
              ["living", "Living arrangement"],
              ["cfs", "Recorded CFS"],
              ["risk", "Recorded SRF code"],
              ["block", "Residential block"],
              ["zone", "Staff-defined zone"],
              ["language", "Preferred language"],
              ["interest", "Stated programme interest"],
              ["barrier", "Reported barrier"],
              ["need", "Recorded support need"],
            ].map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <select
                  value={q[key] || ""}
                  onChange={(e) => filter(key, e.target.value)}
                >
                  <option value="">All / not selected</option>
                  {(report.options[key] || []).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field">
              <span>Minimum age</span>
              <input
                type="number"
                min={0}
                max={120}
                value={q.ageMin || ""}
                onChange={(e) => filter("ageMin", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Maximum age</span>
              <input
                type="number"
                min={0}
                max={120}
                value={q.ageMax || ""}
                onChange={(e) => filter("ageMax", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Programme attended / not attended</span>
              <select
                value={q.programme || ""}
                onChange={(e) => filter("programme", e.target.value)}
              >
                <option value="">All programmes</option>
                {report.programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>AAP domain</span>
              <select
                value={q.domain || ""}
                onChange={(e) => filter("domain", e.target.value)}
              >
                <option value="">All domains</option>
                {[...new Set(report.programmes.map((p) => p.domain))].map(
                  (d) => (
                    <option key={d}>{d}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span>Follow-up outcome</span>
              <select
                value={q.followUp || ""}
                onChange={(e) => filter("followUp", e.target.value)}
              >
                <option value="">All outcomes</option>
                <option>Not contacted</option>
                {outcomes.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Client status</span>
              <select
                value={q.client || "all"}
                onChange={(e) => filter("client", e.target.value)}
              >
                <option value="all">Current registered clients</option>
                <option value="true">Client = Yes</option>
              </select>
            </label>
          </div>
        )}
      </section>
      {message && (
        <p className="client-success" role="status">
          <Check size={17} />
          {message}
        </p>
      )}
      {tab==='outreach'&&<Suspense fallback={<p>Loading outreach workspace…</p>}><ClientOutreach user={user} dates={{from:q.from||'',to:q.to||'',asOf:q.asOf}} revision={revision+dataRevision} onDates={next=>setView(old=>({...old,filters:{...old.filters,...next}}))} onReview={row=>setSelected(row)}/></Suspense>}
      {tab === "priorities" && (
        <Suspense fallback={<p>Loading follow-up priorities…</p>}>
          <OutreachPriorities
            user={user}
            dates={{ from: q.from || "", to: q.to || "", asOf: q.asOf }}
            revision={revision + dataRevision}
            onDates={(next) =>
              setView((old) => ({
                ...old,
                filters: { ...old.filters, ...next },
              }))
            }
            onReview={(row) => setSelected(row)}
          />
        </Suspense>
      )}
      {tab !== "priorities" && error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRevision((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {busy && (
        <p className="muted" role="status">
          Calculating linked client participation…
        </p>
      )}
      {!['outreach','priorities'].includes(tab) && report && reportQuery === JSON.stringify(q) && !error && (
        <>
          <div className="client-scope">
            <span>
              <Home size={16} /> Current registry:{" "}
              {report.registry.asOf || "Not imported"}
            </span>
            <span>
              Attendance coverage: {report.coverage.from || "No records"} to{" "}
              {report.coverage.to || "No records"}
            </span>
          </div>
          {!report.available ? (
            <section className="panel client-empty">
              <Users size={34} />
              <h2>Start with your complete client registry</h2>
              <p>
                Attendance alone cannot identify all registered clients. Import
                the client workbook, review matches and confirm the population
                before interpreting coverage.
              </p>
              {user.role === "admin" && (
                <button
                  className="button primary"
                  onClick={() => setTool("import")}
                >
                  Import client registry
                </button>
              )}
            </section>
          ) : (
            <>
              {!report.complete && (
                <p className="client-notice">
                  This registry has not been attested complete. Figures describe
                  known registered clients and must not be presented as
                  whole-centre coverage.
                </p>
              )}
              {!report.attendanceAvailable && (
                <section className="panel client-notice">
                  <h2>Add attendance to calculate participation coverage</h2>
                  <p>
                    The client registry is ready, but no valid attendance
                    history is available. Participation rates and
                    active/inactive classifications are unavailable until
                    attendance is imported. The authorised roster and feedback
                    workflows remain available.
                  </p>
                  {user.role === "admin" && onImportAttendance && (
                    <button
                      className="button primary"
                      onClick={onImportAttendance}
                    >
                      Import attendance records
                    </button>
                  )}
                </section>
              )}
              {tab === "followups" ? (
                <ClientFollowups
                  user={user}
                  filters={q}
                  report={report}
                  revision={revision}
                  onOpen={setSelected}
                />
              ) : (
                <>
                  {tab === "explore" && (
                    <section className="client-guide">
                      <Search size={24} />
                      <div>
                        <h2>Start with a question, then review the evidence</h2>
                        <p>
                          Combined sensitive charts may be withheld. Authorised
                          staff can review matching individuals in the audited
                          follow-up workspace.
                        </p>
                        <div className="client-actions">
                          <button
                            className="button"
                            onClick={() => {
                              setView((v) => ({
                                ...v,
                                filters: {
                                  ...initial,
                                  gender: "MALE",
                                  ageMin: "70",
                                  status: "no-attendance",
                                },
                              }));
                              setTab("followups");
                            }}
                          >
                            Male clients aged 70+ with no attendance
                          </button>
                          <button
                            className="button"
                            onClick={() => {
                              const start = new Date(q.asOf + "T00:00:00Z");
                              start.setUTCDate(start.getUTCDate() - 89);
                              setView((v) => ({
                                ...v,
                                filters: {
                                  ...initial,
                                  from: start.toISOString().slice(0, 10),
                                  to: q.asOf,
                                  living: "Alone",
                                  status: "no-attendance",
                                },
                              }));
                              setTab("followups");
                            }}
                          >
                            Living alone, no attendance in 90 days
                          </button>
                          <button
                            className="button"
                            onClick={() =>
                              setView((v) => ({
                                ...v,
                                charts: ["zone"],
                                filters: initial,
                              }))
                            }
                          >
                            Compare residential zones
                          </button>
                          <button
                            className="button"
                            onClick={() => {
                              setView((v) => ({
                                ...v,
                                filters: {
                                  ...initial,
                                  interest: "Social gatherings",
                                  domain: "Social",
                                  status: "no-attendance",
                                },
                              }));
                              setTab("followups");
                            }}
                          >
                            Social interests, no Social attendance
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                  <div className="client-kpis">
                    {view.kpis.map((key) => (
                      <article className="client-kpi" key={key}>
                        <span>{cardLabels[key]}</span>
                        <strong>
                          {fmt(
                            report.summary[key],
                            key.endsWith("Rate") || key === "rate",
                          )}
                        </strong>
                        <small>
                          {key === "rate"
                            ? `${fmt(report.summary.attending)} of ${fmt(report.summary.registered)} current registered clients`
                            : key === "noAttendance"
                              ? "In the selected attendance period"
                              : key === "otherAttenders"
                                ? "Recorded participants outside this registry"
                                : key === "active" || key === "inactive"
                                  ? `Last known attendance as of ${q.asOf}`
                                  : "Distinct people · all ages"}
                        </small>
                      </article>
                    ))}
                  </div>
                  <section className="panel">
                    <h2>Registered client coverage</h2>
                    <Coverage
                      briefing={{
                        clients: {
                          available: report.available && report.complete,
                          attendanceAvailable: report.attendanceAvailable,
                          summary: report.summary,
                          populationNote: report.populationNote,
                          limitations: report.limitations,
                        },
                        needs: null,
                        actions: null,
                      }}
                    />
                  </section>
                  <p className="client-privacy">
                    <ShieldCheck size={17} />
                    {report.privacyNote}
                  </p>
                  <div className="report-section-heading">
                    <h2>Compare client participation</h2>
                    <label>
                      Compare by
                      <select
                        value={
                          view.charts.find(
                            (k) => !["statuses", "barriers"].includes(k),
                          ) || "living"
                        }
                        onChange={(e) =>
                          setView((v) => ({
                            ...v,
                            charts: [e.target.value, "statuses"],
                          }))
                        }
                      >
                        {Object.entries(groupLabels)
                          .filter(
                            ([k]) => !["statuses", "barriers"].includes(k),
                          )
                          .map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="client-chart-grid">
                    {(customise
                      ? view.charts
                      : [
                          ...view.charts
                            .filter(
                              (k) => !["statuses", "barriers"].includes(k),
                            )
                            .slice(0, 1),
                          ...view.charts.filter((k) =>
                            ["statuses", "barriers"].includes(k),
                          ),
                        ]
                    ).map((group) =>
                      group === "statuses" ? (
                        <section className="panel" key={group}>
                          <h2>{groupLabels[group]}</h2>
                          <p className="muted">
                            Uses the latest known attendance across available
                            history, independently of the selected period. No
                            recorded history stays separate.
                          </p>
                          {report.statuses.note && (
                            <p className="note">{report.statuses.note}</p>
                          )}
                          {report.statuses.suppressed ? (
                            <p className="note">
                              Status values are withheld under the small-group
                              or combined-filter rule.
                            </p>
                          ) : (
                            <div className="client-status-list">
                              {report.statuses.rows.map((r) => (
                                <div key={r.label}>
                                  <span>
                                    {statusLabel(
                                      r.label,
                                      report.statuses.bands,
                                    )}
                                  </span>
                                  <strong>{fmt(r.value)}</strong>
                                  <i
                                    style={{
                                      width: `${report.summary.registered ? (r.value / report.summary.registered) * 100 : 0}%`,
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      ) : group === "barriers" ? (
                        <section className="panel" key={group}>
                          <h2>{groupLabels[group]}</h2>
                          {report.barriers.suppressed ? (
                            <p className="note">
                              Barrier responses are withheld under privacy
                              rules.
                            </p>
                          ) : (
                            <>
                              <p>
                                {fmt(report.barriers.respondents)} respondents
                                assessed for barriers ·{" "}
                                {fmt(report.barriers.unassessed)} not assessed.
                                Multiple selections overlap; percentages use
                                respondents.
                              </p>
                              {report.barriers.rows.length ? (
                                <div className="client-status-list">
                                  {report.barriers.rows.map((r) => (
                                    <div key={r.label}>
                                      <span>{r.label}</span>
                                      <strong>
                                        {fmt(r.value)} · {fmt(r.percent, true)}
                                      </strong>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="client-empty">
                                  <ClipboardList size={28} />
                                  <h3>
                                    Collect feedback before explaining the gap
                                  </h3>
                                  <p>
                                    No confirmed participant/caregiver-reported
                                    barriers have been recorded. Missing answers
                                    do not mean no barrier.
                                  </p>
                                  <button
                                    className="button"
                                    onClick={() => setTab("followups")}
                                  >
                                    Review clients and record feedback
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </section>
                      ) : report.groups[group] &&
                        !report.groups[group].suppressed ? (
                        <Compare
                          key={group}
                          title={groupLabels[group]}
                          rows={report.groups[group].rows}
                          display={view.display?.[group] || "bar"}
                          onDisplay={(value) =>
                            setView((v) => ({
                              ...v,
                              display: { ...v.display, [group]: value },
                            }))
                          }
                          onFollowup={(label) => reviewGroup(group, label)}
                        />
                      ) : (
                        <section className="panel" key={group}>
                          <h2>{groupLabels[group]}</h2>
                          <p className="note">
                            This combined breakdown is withheld. Reset client
                            filters for the fixed population comparison, or use
                            authorised follow-up.
                          </p>
                        </section>
                      ),
                    )}
                  </div>
                  <section className="client-findings">
                    <div>
                      <span className="eyebrow">
                        FROM OBSERVATION TO ACTION
                      </span>
                      <h2>What should we investigate next?</h2>
                    </div>
                    <div className="client-finding-grid">
                      {report.findings.map((f) => (
                        <article className="panel" key={f.id}>
                          <span className="badge soft">Outreach review</span>
                          <h3>{f.title}</h3>
                          <dl>
                            <dt>Finding</dt>
                            <dd>{f.finding}</dd>
                            <dt>Why it matters</dt>
                            <dd>{f.why}</dd>
                            <dt>What to investigate</dt>
                            <dd>{f.investigate}</dd>
                            <dt>Suggested action</dt>
                            <dd>{f.action}</dd>
                          </dl>
                          <button
                            className="button"
                            onClick={() =>
                              setAction(
                                blankAction("outreach", {
                                  ...f,
                                  category: "Outreach review",
                                  explanation: f.why,
                                }),
                              )
                            }
                          >
                            Create reviewed outreach action{" "}
                            <ArrowRight size={16} />
                          </button>
                        </article>
                      ))}
                    </div>
                    {!report.findings.length && (
                      <p className="muted">
                        No privacy-safe client findings are available for this
                        view. Review source completeness and collect voluntary
                        feedback.
                      </p>
                    )}
                  </section>
                  <section className="panel">
                    <h2>Information we still need</h2>
                    <div className="client-quality-grid">
                      {report.quality.map((f) => (
                        <div key={f.field}>
                          <span>{f.label}</span>
                          <strong>{fmt(f.missing)} missing</strong>
                          {f.unknown !== undefined && f.unknown !== 0 && (
                            <small>Unknown category: {fmt(f.unknown)}</small>
                          )}
                          <small>
                            of {f.total.toLocaleString("en-SG")} registered
                            clients · {f.source}
                          </small>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
              <div className="client-report-footer">
                <div>
                  <strong>Read these figures in context</strong>
                  <p>{report.populationNote}</p>
                  <details>
                    <summary>Source and interpretation limits</summary>
                    {report.limitations.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                  </details>
                </div>
                <div className="client-actions">
                  <a
                    className="button"
                    href={
                      "/api/clients/export/csv?" +
                      new URLSearchParams({
                        from: q.from || "",
                        to: q.to || "",
                        asOf: q.asOf,
                      })
                    }
                  >
                    <Download size={16} /> Export centre summary CSV
                  </a>
                  <a
                    className="button"
                    target="_blank"
                    rel="noreferrer"
                    href={
                      "/api/clients/export/report?" +
                      new URLSearchParams({
                        from: q.from || "",
                        to: q.to || "",
                        asOf: q.asOf,
                      })
                    }
                  >
                    Print management summary
                  </a>
                  <small>
                    Exports use the full client cohort for these dates and omit
                    audience filters, Member IDs, blocks and clinical/social
                    breakdowns.
                  </small>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {selected && (
        <Drawer
          title={`Client follow-up · ${selected.memberId}`}
          onClose={() => setSelected(null)}
        >
          <ContactForm
            client={selected}
            report={report}
            user={user}
            onSaved={() => {
              refresh();
              setSelected(null);
              setMessage("Contact recorded. No message was sent.");
            }}
          />
          <details className="client-profile-details">
            <summary>Open full participant profile and recorded needs</summary>
            <ParticipantEditor
              key={selected.id}
              initialId={selected.id}
              initialMemberId={selected.memberId}
              onSaved={refresh}
            />
          </details>
        </Drawer>
      )}
      {action && (
        <ActionEditor
          value={action}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            setMessage(
              "Reviewed outreach action saved in Programme Planning and Actions.",
            );
            refresh();
          }}
        />
      )}
    </div>
  );
}
function ClientFollowups({
  user,
  filters,
  report,
  revision,
  onOpen,
}: {
  user: User;
  filters: ClientQuery;
  report: ClientReport;
  revision: number;
  onOpen: (p: Followup) => void;
}) {
  const [data, setData] = useState<{
      rows: Followup[];
      total: number;
      notice: string;
    } | null>(null),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("memberId"),
    [direction, setDirection] = useState("asc"),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [updating, setUpdating] = useState(false),
    [membership, setMembership] = useState("Active");
  useEffect(() => setPage(1), [filters, search, sort, direction, membership]);
  const requestBody = JSON.stringify({
    filters,
    search,
    sort,
    direction,
    page,
    pageSize: 25,
    membership,
  });
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setUpdating(true);
    const timer = setTimeout(() => {
      api<typeof data>("/api/clients/followups", {
        method: "POST",
        body: requestBody,
        signal: controller.signal,
      })
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (live && !controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (live) setUpdating(false);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestBody, revision]);
  return (
    <section className="panel client-followups" aria-busy={updating}>
      {updating && (
        <p role="status" className="muted">
          Updating follow-up list...
        </p>
      )}
      <div className="client-panel-head">
        <div>
          <span className="eyebrow">REVIEW BEFORE CONTACTING</span>
          <h2>Client follow-up list</h2>
        </div>
        <span className="client-private">
          <ShieldCheck size={16} /> Authorised staff · access audited
        </span>
      </div>
      <p>
        This list includes identifiable clients. Recorded health and social
        classifications stay inside the individual profile. No list export or
        automatic outreach is provided.
      </p>
      <div className="client-filter-grid">
        {user.role === "admin" && (
          <label className="field">
            <span>Membership records</span>
            <select
              value={membership}
              onChange={(e) => setMembership(e.target.value)}
            >
              <option value="Active">Current clients</option>
              <option value="Archived">Archived clients</option>
              <option value="All">Current and archived clients</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>Search Member ID, block or assigned staff</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search saved client records"
          />
        </label>
        <label className="field">
          <span>Sort follow-up list</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {[
              "memberId",
              "age",
              "block",
              "last",
              "status",
              "assigned",
              "lastContact",
              "followUp",
            ].map((v) => (
              <option key={v} value={v}>
                {(
                  {
                    memberId: "Member ID",
                    last: "Last recorded attendance",
                    lastContact: "Last contact",
                    followUp: "Follow-up outcome",
                  } as Record<string, string>
                )[v] || v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sort direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data ? (
        <>
          <p>
            <strong>
              {data.total.toLocaleString("en-SG")} matching clients
            </strong>{" "}
            · Period-specific attendance and last-known history are shown
            separately.
          </p>
          <div className="client-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Member ID",
                    "Age",
                    "Living arrangement",
                    "Block",
                    "Last attended",
                    "Participation status",
                    "Follow-up",
                    "Assigned staff",
                    "Last contact",
                    "Review",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <th>{p.memberId}</th>
                    <td>{p.age ?? "Missing"}</td>
                    <td>{p.living}</td>
                    <td>{p.block}</td>
                    <td>{p.last || "No record"}</td>
                    <td>
                      <strong>
                        {p.attendance
                          ? `${p.attendance} sessions in period`
                          : "No recorded attendance in period"}
                      </strong>
                      <small>
                        {statusLabel(p.status, report.statuses.bands)}
                      </small>
                    </td>
                    <td>{p.followUp}</td>
                    <td>{p.assigned || "Unassigned"}</td>
                    <td>{p.lastContact || "Not contacted"}</td>
                    <td>
                      <button className="button" onClick={() => onOpen(p)}>
                        Open follow-up
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && (
            <p className="client-empty">
              No clients match these filters. Widen the selection or reset
              client filters.
            </p>
          )}
          <div className="client-pagination">
            <button
              className="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous clients
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(data.total / 25))}
            </span>
            <button
              className="button"
              disabled={page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next clients
            </button>
          </div>
          <p className="client-privacy">{data.notice}</p>
        </>
      ) : (
        <p role="status">Loading authorised client list…</p>
      )}
    </section>
  );
}
function ContactForm({
  client,
  report,
  user,
  onSaved,
}: {
  client: Followup;
  report: ClientReport | null;
  user: User;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState("Contact attempted"),
    [date, setDate] = useState(today()),
    [assigned, setAssigned] = useState(client.assigned),
    [nextDate, setNextDate] = useState(""),
    [source, setSource] = useState("Staff-observed"),
    [notes, setNotes] = useState(""),
    [reported, setReported] = useState<string[]>([]),
    [permission, setPermission] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reference] = useState(() => crypto.randomUUID()),
    [membership, setMembership] = useState<{
      status: string;
      reason: string;
      confirmation: string;
    } | null>(null),
    [sourceData, setSourceData] = useState<{
      current: {
        membershipStatus: string;
        revision: number;
        fieldSources: Record<
          string,
          { source: string; asOf: string; file: string }
        >;
      };
      contacts: {
        id: string;
        date: string;
        contact: { outcome: string; assigned: string; notes: string };
        staff: string;
      }[];
    } | null>(null);
  useEffect(() => {
    let live = true;
    api<typeof sourceData>("/api/clients/" + client.id + "/source")
      .then((d) => {
        if (live) setSourceData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [client.id]);
  return (
    <section className="client-contact">
      <div className="client-contact-summary">
        <div>
          <span>Recorded attendance</span>
          <strong>{client.attendance} sessions in period</strong>
        </div>
        <div>
          <span>Last known attendance</span>
          <strong>{client.last || "No recorded attendance"}</strong>
        </div>
        <div>
          <span>Residential block</span>
          <strong>{client.block}</strong>
        </div>
      </div>
      <p className="note">
        Observed fact: this is a current registered client with the
        participation history above. Timing, awareness or access may warrant
        investigation; none is a confirmed reason until appropriately reported.
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/api/clients/" + client.id + "/contact", {
              method: "POST",
              body: JSON.stringify({
                id: reference,
                profileRevision: client.profileRevision,
                outcome,
                date,
                assigned,
                nextDate,
                source,
                notes,
                barriers: reported,
                permission,
              }),
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Record an outreach contact</h3>
        <div className="client-filter-grid">
          <label className="field">
            <span>Contact date</span>
            <input
              type="date"
              required
              max={today()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Contact outcome</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              {outcomes.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Assigned staff member</span>
            <input
              value={assigned}
              maxLength={200}
              onChange={(e) => setAssigned(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Next follow-up date, if known</span>
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>Information source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {[
              "Participant-reported",
              "Caregiver-reported",
              "Staff-observed",
              "Unconfirmed",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Reported participation barriers · optional</legend>
          <p>
            Participant/caregiver reports are analysed separately from staff
            observations and unconfirmed hypotheses.
          </p>
          <div className="client-check-grid">
            {(report?.options.barrier || []).map((b) => (
              <label className="checkbox" key={b}>
                <input
                  type="checkbox"
                  checked={reported.includes(b)}
                  onChange={(e) =>
                    setReported((v) =>
                      e.target.checked ? [...v, b] : v.filter((x) => x !== b),
                    )
                  }
                />
                {b}
              </label>
            ))}
          </div>
        </fieldset>
        {reported.length > 0 && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={permission}
              required
              onChange={(e) => setPermission(e.target.checked)}
            />{" "}
            I have permission to record this voluntary barrier information.
          </label>
        )}
        <label className="field">
          <span>Reported explanation, action taken and next step</span>
          <textarea
            rows={4}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Recording contact…" : "Save reviewed contact"}
        </button>
        <p className="muted">
          This updates the existing Staff Follow-Up section and retains the
          contact history. No email, text message or call is sent.
        </p>
      </form>
      {sourceData && (
        <details>
          <summary>Previous contacts and registry provenance</summary>
          {sourceData.contacts.length ? (
            sourceData.contacts.map((c) => (
              <article className="client-contact-history" key={c.id}>
                <strong>
                  {c.date} · {c.contact.outcome}
                </strong>
                <p>
                  {c.staff} · {c.contact.assigned || "Unassigned"}
                </p>
                <p>{c.contact.notes}</p>
              </article>
            ))
          ) : (
            <p>No contact history recorded.</p>
          )}
          <p>
            Latest-known registry fields retain their source file, snapshot date
            and import timestamp; imported source snapshots are retained
            separately.
          </p>
        </details>
      )}
      {user.role === "admin" && sourceData && (
        <details>
          <summary>Explicit membership status change · administrator</summary>
          <p>
            Missing from an import never changes membership. Archiving excludes
            a client from the current population while retaining their
            attendance and profile.
          </p>
          <button
            className="button"
            onClick={() =>
              setMembership({
                status:
                  sourceData.current.membershipStatus === "Archived"
                    ? "Active"
                    : "Archived",
                reason: "",
                confirmation: "",
              })
            }
          >
            {sourceData.current.membershipStatus === "Archived"
              ? "Review reactivation"
              : "Review client archive"}
          </button>
          {membership && (
            <div className="form-stack">
              <label className="field">
                <span>Reason for membership change</span>
                <input
                  required
                  value={membership.reason}
                  onChange={(e) =>
                    setMembership({ ...membership, reason: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>
                  Type{" "}
                  {membership.status === "Archived"
                    ? "ARCHIVE CLIENT"
                    : "RESTORE CLIENT"}
                </span>
                <input
                  value={membership.confirmation}
                  onChange={(e) =>
                    setMembership({
                      ...membership,
                      confirmation: e.target.value,
                    })
                  }
                />
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  !membership.reason.trim() ||
                  membership.confirmation !==
                    (membership.status === "Archived"
                      ? "ARCHIVE CLIENT"
                      : "RESTORE CLIENT")
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/api/clients/" + client.id + "/membership", {
                      method: "POST",
                      body: JSON.stringify({
                        ...membership,
                        revision: sourceData.current.revision,
                      }),
                    });
                    onSaved();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm membership change
              </button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
function ClientSettings({ onSaved }: { onSaved: () => void }) {
  const [s, setS] = useState<{
      zones: Record<string, string>;
      documentation: string;
      bands: number[];
      blocks: string[];
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<
      {
        created: string;
        source: string;
        rows: number;
        createdProfiles?: number;
        omittedRetained: number;
      }[]
    >([]);
  useEffect(() => {
    api<typeof s>("/api/clients/settings")
      .then(setS)
      .catch((e) => setMessage(e.message));
    api<typeof history>("/api/clients/imports")
      .then(setHistory)
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <section className="panel client-settings">
      <h2>Client engagement rules and geographic zones</h2>
      <p>
        Block numbers are identifiers, not validated addresses. Group them only
        with documented staff knowledge. Organisation definitions apply to all
        staff.
      </p>
      {s && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/api/clients/settings", {
                method: "PUT",
                body: JSON.stringify({
                  zones: s.zones,
                  documentation: s.documentation,
                  bands: s.bands,
                }),
              });
              setMessage("Client reporting rules saved.");
              onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="client-filter-grid">
            {s.bands.map((b, i) => (
              <label className="field" key={i}>
                <span>
                  {
                    [
                      "Active through day",
                      "Recently less active through day",
                      "Second inactive band through day",
                    ][i]
                  }
                </span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={b}
                  onChange={(e) =>
                    setS({
                      ...s,
                      bands: s.bands.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label className="field">
            <span>Documented basis for block-to-zone groupings</span>
            <textarea
              required={Object.values(s.zones).some(Boolean)}
              maxLength={2000}
              value={s.documentation}
              onChange={(e) => setS({ ...s, documentation: e.target.value })}
            />
          </label>
          <details>
            <summary>
              Assign recorded blocks to staff-defined zones ({s.blocks.length})
            </summary>
            <div className="client-filter-grid">
              {s.blocks.map((b) => (
                <label className="field" key={b}>
                  <span>Block {b}</span>
                  <input
                    value={s.zones[b] || ""}
                    maxLength={100}
                    placeholder="Unassigned zone"
                    onChange={(e) =>
                      setS({ ...s, zones: { ...s.zones, [b]: e.target.value } })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <button className="button primary" disabled={busy}>
            Save client reporting rules
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Client registry import history</summary>
        {history.length ? (
          history.map((h, i) => (
            <p key={i}>
              {new Date(h.created).toLocaleString("en-SG", {
                timeZone: "Asia/Singapore",
              })}{" "}
              · {h.source} · {h.rows} source records · {h.omittedRetained}{" "}
              absent records retained
            </p>
          ))
        ) : (
          <p>No client registry imports recorded.</p>
        )}
      </details>
    </section>
  );
}
