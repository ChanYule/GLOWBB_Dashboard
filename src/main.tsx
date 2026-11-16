import { OutreachRulesFields } from "./outreach-rules-fields";
import type { Briefing } from "./management";
import {activityDomains} from '../shared/activity-domains.js';
import { ImportProgress } from "./import-progress";
import { api } from "./api";
import { metrics, reportingFilters } from "./view-config";
import { ManagementHome, DomainPortfolio } from "./management";
import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  Children,
  isValidElement,
} from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Database,
  Filter,
  HeartHandshake,
  Info,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Upload,
  Users,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  Dashboard,
  Filters,
  Programme,
  Recommendation,
  Settings,
  Stats,
  User,
  Count,
  Preview,
  Preferences,
  Decision,
} from "./types";
import "./styles.css";
import "./redesign.css";
import "./data-management.css";
import "./design-system.css";
const ParticipationPatterns = lazy(() =>
  import("./patterns-ui").then((m) => ({ default: m.ParticipationPatterns })),
);
const NeedsPage = lazy(() =>
  import("./needs-ui").then((m) => ({ default: m.NeedsPage })),
);
const NeedsExperience = lazy(() =>
  import("./needs-experience").then((m) => ({ default: m.NeedsExperience })),
);
const DataManagement = lazy(() =>
  import("./data-management").then((m) => ({ default: m.DataManagement })),
);
const ClientEngagement = lazy(() =>
  import("./client-ui").then((m) => ({ default: m.ClientEngagement })),
);
const PersonalWorkspace = lazy(() =>
  import("./workspace").then((m) => ({ default: m.PersonalWorkspace })),
);
const SocialRisk = lazy(() =>
  import("./workspace").then((m) => ({ default: m.SocialRisk })),
);
const RiskSettings = lazy(() =>
  import("./workspace").then((m) => ({ default: m.RiskSettings })),
);
const Login = lazy(() =>
  import("./workspace").then((m) => ({ default: m.Login })),
);
const ProgrammeCompare = lazy(() =>
  import("./workspace").then((m) => ({ default: m.ProgrammeCompare })),
);
const PresentationView = lazy(() =>
  import("./presentation").then((m) => ({ default: m.PresentationView })),
);
const EventTypeInsights=lazy(()=>import('./event-types-ui').then(m=>({default:m.EventTypeInsights})));
const OperationsPage = lazy(() =>
  import("./operations-ui").then((module) => ({
    default: module.OperationsPage,
  })),
);
import {
  KpiDeck,
  TrendChart,
  InsightCards,
  Portfolio,
  DemographicBars,
  TimingMatrix,
  ActiveFilters,
} from "./analytics-ui";
const sgToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const number = (x: number) =>
  new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(x);
const pct = (x: number | null) =>
  x === null ? "Not available" : `${number(x)}%`;
const time = (x: number) =>
  `${Math.floor(x / 60)
    .toString()
    .padStart(2, "0")}:${(x % 60).toString().padStart(2, "0")}`;
const pretty = (x: string) =>
  x
    ? new Intl.DateTimeFormat("en-SG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Singapore",
      }).format(new Date(x + "T00:00:00+08:00"))
    : "Available history";
const emptyFilters: Filters = {
  from: "",
  to: sgToday(),
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
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`${primary ? "button primary" : "button"} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Select({
  label,
  value,
  onChange,
  children,
  multiple = false,
}: {
  multiple?: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  if (multiple) {
    let selected: string[] = [];
    try {
      selected = value.startsWith("[")
        ? JSON.parse(value)
        : value
          ? [value]
          : [];
    } catch {
      selected = [];
    }
    return (
      <div className="field work-multiselect">
        <span>{label}</span>
        <details>
          <summary>
            {selected.length ? `${selected.length} selected` : "All"}
          </summary>
          <button className="text-button" onClick={() => onChange("")}>
            Clear {label.toLowerCase()}
          </button>
          {Children.toArray(children)
            .filter(isValidElement<{ value?: string; children?: ReactNode }>)
            .map((child, i) => {
              const v = String(child.props.value ?? child.props.children ?? "");
              return v ? (
                <label key={i} className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.includes(v)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, v]
                        : selected.filter((x) => x !== v);
                      onChange(
                        next.length > 1 ? JSON.stringify(next) : next[0] || "",
                      );
                    }}
                  />
                  {child.props.children}
                </label>
              ) : null;
            })}
        </details>
      </div>
    );
  }
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
function Panel({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="note">
      <Info size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
function Bars({
  items,
  unit = "seniors",
  color = "teal",
  onSelect,
}: {
  items: Count[];
  unit?: string;
  color?: string;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(...items.map((x) => x.value), 1);
  return items.length ? (
    <div className="bars">
      {items.map((x, i) => (
        <div className="bar-row" key={x.label}>
          <div className="bar-caption">
            {onSelect ? (
              <button className="domain-link" onClick={() => onSelect(x.label)}>
                {x.label}
                <ArrowRight size={13} />
              </button>
            ) : (
              <span>{x.label}</span>
            )}
            <strong>
              {number(x.value)} <small>{unit}</small>
            </strong>
          </div>
          <div className="bar-track">
            <div
              className={`bar-fill ${color}`}
              style={{ width: `${(x.value / max) * 100}%` }}
            />
            <span className="sr-only">Rank {i + 1}</span>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="chart-empty">No attendance matches these filters.</div>
  );
}
const LineChart = TrendChart;
function Modal({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`${wide ? "modal wide" : "modal"} ${drawer ? "programme-drawer" : ""}`}
      onCancel={onClose}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <HeartHandshake size={25} />
      </div>
      <span>
        GLOW<span className="brand-dot">.</span>
        <small>BUKIT BATOK</small>
      </span>
    </div>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [authError, setAuthError] = useState(""),
    [needsLogin, setNeedsLogin] = useState(false);
  useEffect(() => {
    api<User>("/api/me")
      .then(setUser)
      .catch((e) => {
        if (e.status === 401) setNeedsLogin(true);
        else setAuthError(e.message);
      });
  }, []);
  const [presentationSnapshot, setPresentationSnapshot] = useState<{
    data: Dashboard;
    filters: Filters;
    briefing: Briefing;
  } | null>(null);
  const [planSearch, setPlanSearch] = useState("");
  const [patternsInitial, setPatternsInitial] = useState("");
  const [tab, setTab] = useState("Overview"),
    [filters, setFilters] = useState<Filters>(emptyFilters),
    [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState(""),
    [programme, setProgramme] = useState<Programme | null>(null),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState(""),
    [navigationOpen, setNavigationOpen] = useState(false);
  const contextOnly = [
    "Participation Patterns & Insights",
    "Client Engagement",
    "Data management",
    "Participant Needs & Accessibility",
    "Who Are We Serving?",
    "Gaps and Participation Barriers",
    "Data Quality and Administration",
    "Social Risk Analysis",
    "Programme Alignment",
  ].includes(tab);
  const reportView = contextOnly
    ? "context"
    : tab === "Overview"
      ? "overview"
      : "full";
  useEffect(() => {
    if (!user) return;
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Dashboard>(
        "/api/dashboard?" +
          new URLSearchParams({ ...filters, view: reportView }),
        { signal: controller.signal },
      )
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (live) {
            if (controller.signal.aborted) return;
            if (e.status === 401) {
              setUser(null);
              setNeedsLogin(true);
            }
            setError(e.message);
          }
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 100);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, revision, user, reportView]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    api<Preferences>("/api/preferences")
      .then((p) => {
        if (live && p.draft)
          setFilters(reportingFilters(p.draft, emptyFilters));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const refresh = (message = "Saved successfully.") => {
    setRevision((n) => n + 1);
    setToast(message);
  };
  const primaryTabs = [
    { name: "Overview", label: "Main Dashboard", icon: LayoutDashboard },
    {
      name: "Programme Performance",
      label: "Programme Analysis",
      icon: BarChart3,
    },
    {
      name: "Planning & Recommendations",
      label: "Planning",
      icon: ClipboardList,
    },
  ];
  const staffTabs = [
    { name: "Participation Patterns & Insights", icon: ChartNoAxesCombined },
    {
      name: "Client Engagement",
      label: "Client Engagement & Outreach",
      icon: Users,
    },
    { name: "Participant Needs & Accessibility", icon: HeartHandshake },
    ...(user?.role === "admin"
      ? [{ name: "Data management", icon: Database }]
      : []),
  ];
  const advancedTabs = [
    {
      name: "Programme Planning and Actions",
      label: "Detailed action tracker",
      icon: ClipboardList,
    },
    { name: "Who Are We Serving?", icon: Users },
    { name: "Gaps and Participation Barriers", icon: HeartHandshake },
    { name: "Audience & Outreach", icon: Users },
    { name: "Operations & Screening", icon: Activity },
    { name: "Social Risk Analysis", icon: ShieldCheck },
    { name: "Custom Analysis", icon: ChartNoAxesCombined },
    { name: "Programme Alignment", icon: BarChart3 },
    { name: "Data Quality and Administration", icon: ShieldCheck },
  ];
  const navItem = (t: { name: string; label?: string; icon: typeof Users }) => (
    <button
      key={t.name}
      className={tab === t.name ? "nav-item active" : "nav-item"}
      aria-current={tab === t.name ? "page" : undefined}
      onClick={() => {
        setTab(t.name);
        setPatternsInitial("");
        setPlanSearch("");
        setNavigationOpen(false);
      }}
    >
      <t.icon size={20} />
      <span>{t.label || t.name}</span>
      {tab === t.name && <ChevronRight size={16} />}
    </button>
  );
  const title = [
    "Participation Patterns & Insights",
    "Data management",
    "Client Engagement",
    "Participant Needs & Accessibility",
  ].includes(tab)
    ? tab === "Client Engagement"
      ? "Client Engagement & Outreach"
      : tab
    : tab === "Overview"
      ? "Main dashboard"
      : tab === "Programme Planning and Actions"
        ? "Detailed action tracker"
        : [
              "Who Are We Serving?",
              "Gaps and Participation Barriers",
              "Programme Planning and Actions",
              "Programme Alignment",
              "Data Quality and Administration",
            ].includes(tab)
          ? tab
          : tab === "Programme Performance"
            ? "Programme analysis"
            : tab === "Social Risk Analysis" || tab === "Custom Analysis"
              ? tab
              : tab === "Audience & Outreach"
                ? "Audience & outreach gaps"
                : tab === "Operations & Screening"
                  ? "Operations & health screening"
                  : "Planning";
  const sensitive =
    ["gender", "race", "ageBand", "client", "boundary"].some(
      (k) => filters[k as keyof Filters],
    ) || filters.target !== "all";
  if (needsLogin && !user)
    return (
      <Login
        onDone={(u) => {
          setUser(u);
          setNeedsLogin(false);
        }}
      />
    );
  if (!user)
    return (
      <main className="login-shell">
        <div className="panel" role={authError ? "alert" : "status"}>
          {authError || "Loading staff workspace?"}
          <button className="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  return (
    <Suspense
      fallback={
        <div className="panel" role="status">
          Loading workspace?
        </div>
      }
    >
      <div className={`app${navigationOpen ? " navigation-open" : ""}`}>
        <aside className="sidebar">
          <Brand />
          <div className="workspace-label">STAFF WORKSPACE</div>
          <button
            className="navigation-toggle"
            aria-expanded={navigationOpen}
            aria-controls="main-navigation"
            onClick={() => setNavigationOpen((open) => !open)}
          >
            <Menu size={18} /> Menu
          </button>
          <a className="skip-link" href="#main">
            Skip to main content
          </a>
          <nav aria-label="Main navigation" id="main-navigation">
            {primaryTabs.map(navItem)}
            <details
              className="nav-tools"
              open={
                [...staffTabs, ...advancedTabs].some((t) => t.name === tab) ||
                undefined
              }
            >
              <summary>
                <Users size={19} />
                Staff Tools
                <ChevronRight size={16} />
              </summary>
              {staffTabs.map(navItem)}
              <button
                className="nav-item"
                onClick={() => {
                  setModal("dashboard-settings");
                  setNavigationOpen(false);
                }}
              >
                Dashboard Settings
              </button>
              <button
                className="nav-item"
                onClick={() => {
                  setModal("export");
                  setNavigationOpen(false);
                }}
              >
                Download reports
              </button>
              <details
                className="nav-advanced"
                open={advancedTabs.some((t) => t.name === tab) || undefined}
              >
                <summary>Advanced analysis</summary>
                {advancedTabs.map(navItem)}
              </details>
            </details>
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-note">
              <ShieldCheck size={20} />
              <div>
                <strong>A trusted staff space</strong>
                <p>
                  Attendance-led insights.
                  <br />
                  People-first decisions.
                </p>
              </div>
            </div>
            <div className="staff">
              <div className="avatar">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <strong>{user.username}</strong>
                <small>{user.role}</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <span>
              <span className="green-dot" /> Programme intelligence
            </span>
            <div>
              {user.username !== "Local workspace" && (
                <button
                  className="text-button"
                  onClick={async () => {
                    await api("/api/logout", { method: "POST" });
                    setData(null);
                    setUser(null);
                    setNeedsLogin(true);
                  }}
                >
                  Sign out
                </button>
              )}
              <span className="restricted">
                <ShieldCheck size={15} />{" "}
                {user.username === "Local workspace"
                  ? "Local workspace"
                  : "Staff access"}
              </span>
              <span className="top-date">{pretty(sgToday())}</span>
            </div>
          </header>
          <main id="main">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  GLOW BUKIT BATOK <span>/</span> PLANNING WITH PURPOSE
                </div>
                <h1>{title}</h1>
                <p className="muted">
                  {tab === "Participation Patterns & Insights"
                    ? "Understand who participates, which programmes attract them and where engagement gaps exist."
                    : tab === "Client Engagement"
                      ? "Link your registered population to attendance, investigate gaps and plan reviewed outreach."
                      : tab === "Data management"
                        ? "Import, review, delete and recover saved records in one place."
                        : tab === "Overview"
                          ? "Track programme delivery, senior outreach and participation patterns to support planning."
                          : tab === "Who Are We Serving?"
                            ? "Understand current participant profiles and explicitly reported needs."
                            : tab === "Gaps and Participation Barriers"
                              ? "Review observed engagement, voluntary feedback and information gaps."
                              : tab === "Programme Planning and Actions"
                                ? "Agree next steps using documented needs and transparent evidence."
                                : tab === "Programme Alignment"
                                  ? "Compare programme supply, unique reach and stated demand."
                                  : tab === "Data Quality and Administration"
                                    ? "Keep source completeness and organisation definitions visible."
                                    : tab === "Programme Performance"
                                      ? "Compare reach and engagement with the right context."
                                      : tab === "Audience & Outreach"
                                        ? "Explore participation patterns and opportunities to connect."
                                        : tab === "Operations & Screening"
                                          ? "Monitor participation, client outreach and reported monthly assessments."
                                          : "Turn observed participation into thoughtful plans for the next 3–6 months."}
                </p>
              </div>
              <div className="heading-actions">
                {tab!=='Participation Patterns & Insights'&&<Button
                  disabled={loading}
                  onClick={() =>
                    refresh("Dashboard refreshed from saved records.")
                  }
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>}
                {![
                  "Overview",
                  "Data management",
                  "Client Engagement",
                  "Participation Patterns & Insights",
                ].includes(tab) && (
                  <Button onClick={() => setModal("export")}>
                    <Download size={17} />
                    Export report
                  </Button>
                )}
                {user.role === "admin" &&
                  ![
                    "Data management",
                    "Client Engagement",
                    "Participation Patterns & Insights",
                  ].includes(tab) && (
                    <Button primary onClick={() => setModal("import")}>
                      <Upload size={17} />
                      Import attendance
                    </Button>
                  )}
              </div>
            </div>
            {![
              "Data management",
              "Client Engagement",
              "Participation Patterns & Insights",
            ].includes(tab) && (
              <FilterBar
                filters={filters}
                setFilters={setFilters}
                data={data}
              />
            )}
            {![
              "Data management",
              "Client Engagement",
              "Participation Patterns & Insights",
            ].includes(tab) && (
              <ActiveFilters
                filters={filters}
                data={data}
                setFilters={setFilters}
              />
            )}
            {error && (
              <div className="error" role="alert">
                {error}
                <Button onClick={() => setRevision((n) => n + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {loading && (
              <div className="fetch-status" role="status">
                <div className="skeleton-lines" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span>Updating dashboard...</span>
              </div>
            )}
            {data && (
              <div
                className={
                  loading ? "dashboard-content updating" : "dashboard-content"
                }
                aria-busy={loading}
              >
                {![
                  "Data management",
                  "Client Engagement",
                  "Participation Patterns & Insights",
                ].includes(tab) && (
                  <div className="period-caption">
                    <span>
                      <CalendarDays size={15} />
                      {pretty(data.period.from)} — {pretty(data.period.to)}
                    </span>
                    <span>
                      {data.metadata?.lastUpdatedAt
                        ? `Last updated: ${new Date(data.metadata.lastUpdatedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" })}`
                        : "Available records - Singapore time"}
                    </span>
                  </div>
                )}
                <Suspense
                  fallback={
                    <div className="panel" role="status">
                      Loading workspace?
                    </div>
                  }
                >
                  {tab === "Participation Patterns & Insights" ? (
                    <ParticipationPatterns
                      user={user}
                      revision={revision}
                      initialDimension={patternsInitial}
                      onClients={() => setTab("Client Engagement")}
                    />
                  ) : tab === "Client Engagement" ? (
                    <ClientEngagement
                      user={user}
                      coverageTo={data.coverage.to}
                      onLocations={() => {
                        setPatternsInitial("distance");
                        setTab("Participation Patterns & Insights");
                      }}
                      dataRevision={revision}
                      onImportAttendance={() => setModal("import")}
                      initialFilters={filters}
                      onChanged={() =>
                        refresh(
                          "Client information saved and linked participation refreshed.",
                        )
                      }
                    />
                  ) : tab === "Data management" && user.role === "admin" ? (
                    <DataManagement
                      version={revision}
                      onImport={() => setModal("import")}
                      onDefinitions={() => setModal("settings")}
                      onReporting={() => setModal("risk-settings")}
                      onClients={() => setTab("Client Engagement")}
                      onChanged={refresh}
                    />
                  ) : tab === "Participant Needs & Accessibility" ? (
                    <NeedsExperience
                      filters={filters}
                      user={user}
                      onRefresh={() => refresh()}
                    />
                  ) : data.coverage.from === null &&
                    ![
                      "Overview",
                      "Planning & Recommendations",
                      "Operations & Screening",
                      "Custom Analysis",
                      "Social Risk Analysis",
                      "Who Are We Serving?",
                      "Gaps and Participation Barriers",
                      "Programme Planning and Actions",
                      "Programme Alignment",
                      "Data Quality and Administration",
                    ].includes(tab) ? (
                    <div className="welcome panel">
                      <div className="icon-tile">
                        <ChartNoAxesCombined size={30} />
                      </div>
                      <span className="eyebrow">
                        YOUR NEXT CHAPTER STARTS WITH DATA
                      </span>
                      <h2>Make every connection count.</h2>
                      <p>
                        Bring your attendance records together to understand
                        your reach,
                        <br className="desktop-only" /> discover participation
                        patterns and plan what comes next.
                      </p>
                      {user.role === "admin" ? (
                        <Button primary onClick={() => setModal("import")}>
                          <Plus size={18} />
                          Import your first attendance file
                        </Button>
                      ) : (
                        <p>
                          Ask an administrator to import the attendance
                          workbook.
                        </p>
                      )}
                      <div className="welcome-steps">
                        <span>
                          <b>01</b>Preview your records
                        </span>
                        <span>
                          <b>02</b>Understand your reach
                        </span>
                        <span>
                          <b>03</b>Plan with evidence
                        </span>
                      </div>
                      <Note>
                        No sample statistics are shown. Your dashboard is
                        calculated from confirmed, saved attendance.
                      </Note>
                    </div>
                  ) : data.summary.attendance === 0 &&
                    ![
                      "Overview",
                      "Planning & Recommendations",
                      "Operations & Screening",
                      "Who Are We Serving?",
                      "Gaps and Participation Barriers",
                      "Programme Planning and Actions",
                      "Programme Alignment",
                      "Data Quality and Administration",
                      "Custom Analysis",
                      "Social Risk Analysis",
                    ].includes(tab) ? (
                    <div className="panel empty">
                      <Search size={28} />
                      <h2>No attendance matches this view</h2>
                      <p>Try a wider date range or reset your filters.</p>
                      <Button onClick={() => setFilters(emptyFilters)}>
                        Reset filters
                      </Button>
                    </div>
                  ) : tab === "Operations & Screening" ? (
                    <Suspense
                      fallback={<p role="status">Loading operational tools…</p>}
                    >
                      <OperationsPage
                        filters={filters}
                        data={data}
                        user={user}
                        onProgramme={setProgramme}
                      />
                    </Suspense>
                  ) : [
                      "Who Are We Serving?",
                      "Gaps and Participation Barriers",
                      "Programme Planning and Actions",
                      "Programme Alignment",
                      "Data Quality and Administration",
                    ].includes(tab) ? (
                    <>
                      <NeedsPage
                        level={
                          tab === "Who Are We Serving?"
                            ? "profile"
                            : tab === "Gaps and Participation Barriers"
                              ? "gaps"
                              : tab === "Programme Planning and Actions"
                                ? "actions"
                                : tab === "Programme Alignment"
                                  ? "alignment"
                                  : "quality"
                        }
                        filters={filters}
                        user={user}
                        onRefresh={() =>
                          refresh("Reviewed needs data refreshed.")
                        }
                      />
                    </>
                  ) : tab === "Social Risk Analysis" ? (
                    <SocialRisk user={user} />
                  ) : tab === "Custom Analysis" ? (
                    <PersonalWorkspace
                      data={data}
                      filters={filters}
                      setFilters={setFilters}
                      user={user}
                      explore
                      onRisk={() => setTab("Social Risk Analysis")}
                    />
                  ) : tab === "Overview" ? (
                    <ManagementHome
                      updating={loading}
                      data={data}
                      filters={filters}
                      revision={revision}
                      navigate={(name) => {
                        setPlanSearch("");
                        setTab(name);
                      }}
                      present={(briefing) => {
                        setPresentationSnapshot({
                          data,
                          filters: { ...filters },
                          briefing,
                        });
                        setModal("presentation");
                      }}
                    />
                  ) : tab === "Programme Performance" ? (
                    <><Suspense fallback={<p>Loading programme classifications…</p>}><EventTypeInsights user={user} revision={revision} initial={Object.fromEntries(Object.entries(filters).filter(([k])=>['from','to','domain','programme','gender','race','ageBand','cfs','client','boundary'].includes(k)))} onProgramme={id=>{const p=data.programmes.find(p=>p.id===id);if(p)setProgramme(p);}}/></Suspense><Programmes data={data} onProgramme={setProgramme} /></>
                  ) : tab === "Audience & Outreach" ? (
                    <Audience
                      data={data}
                      filters={filters}
                      setFilters={setFilters}
                    />
                  ) : (
                    <Planning
                      data={data}
                      user={user}
                      refresh={refresh}
                      onTarget={() => setModal("target")}
                      initialSearch={planSearch}
                      simple
                    />
                  )}
                  {data.coverage.from !== null &&
                    ![
                      "Data management",
                      "Client Engagement",
                      "Participation Patterns & Insights",
                    ].includes(tab) && (
                      <footer className="data-footnote">
                        <ShieldCheck size={16} />
                        <p>
                          Measured within available records:{" "}
                          {pretty(data.coverage.from!)} –{" "}
                          {pretty(data.coverage.to!)}. Attendance shows
                          participation; it does not establish programme impact
                          or causation. Unique counts must not be added across
                          programmes or periods.
                        </p>
                      </footer>
                    )}
                </Suspense>
              </div>
            )}
          </main>
        </div>
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )}
        {modal === "import" && (
          <ImportDialog
            onClose={() => setModal("")}
            onDone={() => {
              setModal("");
              refresh(
                "Import confirmed. Dashboard updated from saved records.",
              );
            }}
          />
        )}
        {modal === "risk-settings" && user.role === "admin" && (
          <Modal
            title="Organisation reporting controls"
            onClose={() => setModal("")}
            wide
          >
            <RiskSettings
              onSaved={() => refresh("Organisation definitions saved.")}
            />
          </Modal>
        )}
        {modal === "dashboard-settings" && (
          <Modal title="Dashboard Settings" onClose={() => setModal("")}>
            <section className="panel">
              <h2>Personal preferences</h2>
              <p>
                Save your selected cards, charts and filters in Custom Analysis.
                Client views are saved separately in Client Engagement &
                Outreach.
              </p>
              <Button
                onClick={() => {
                  setModal("");
                  setTab("Custom Analysis");
                }}
              >
                Open personal dashboard settings
              </Button>
            </section>
            {user.role === "admin" && (
              <section className="panel">
                <h2>Organisation settings</h2>
                <p>
                  These definitions affect staff reports and target progress.
                </p>
                <Button onClick={() => setModal("settings")}>
                  Demographic and evidence definitions
                </Button>
                <Button onClick={() => setModal("risk-settings")}>
                  Protected reporting controls
                </Button>
              </section>
            )}
          </Modal>
        )}
        {modal === "settings" && data && (
          <SettingsDialog
            data={data}
            onClose={() => setModal("")}
            refresh={refresh}
          />
        )}
        {modal === "target" && data && (
          <TargetDialog
            data={data}
            onClose={() => setModal("")}
            onDone={() => {
              setModal("");
              refresh("Outreach target saved.");
            }}
          />
        )}
        {modal === "export" && (
          <Modal
            title="Export a management report"
            onClose={() => setModal("")}
          >
            <p>
              Exports include the active period and programme/domain filters.
              Shared reports omit all demographic breakdowns, target-group
              counts and staff notes.
            </p>
            {sensitive ? (
              <Note>
                Reset audience filters before exporting. This prevents sensitive
                groups being inferred from filtered totals.
              </Note>
            ) : (
              <div className="export-options">
                <a
                  className="export-option"
                  href={"/api/export/csv?" + new URLSearchParams(filters)}
                >
                  <ArrowDownToLine />
                  <span>
                    <strong>Programme performance CSV</strong>
                    <small>
                      Aggregated reach and engagement, ready for Excel.
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </a>
                <a
                  className="export-option"
                  target="_blank"
                  rel="noreferrer"
                  href={"/api/export/report?" + new URLSearchParams(filters)}
                >
                  <ClipboardList />
                  <span>
                    <strong>Print-friendly planning summary</strong>
                    <small>
                      Trends, findings and recommendations. Print ? Save as PDF.
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </a>
              </div>
            )}
            <Note>
              Review the report before sharing it under your organisation’s data
              protection rules.
            </Note>
          </Modal>
        )}
        {modal === "presentation" && presentationSnapshot && (
          <PresentationView
            data={presentationSnapshot.data}
            filters={presentationSnapshot.filters}
            revision={revision}
            briefing={presentationSnapshot.briefing}
            close={() => setModal("")}
          />
        )}
        {programme && data && (
          <ProgrammeDialog
            programme={
              data.programmes.find((p) => p.id === programme.id) || programme
            }
            data={data}
            onClose={() => setProgramme(null)}
            onPlan={
              user.role === "viewer"
                ? undefined
                : () => {
                    setPlanSearch(programme.name);
                    setProgramme(null);
                    setTab("Planning & Recommendations");
                  }
            }
          />
        )}
      </div>
    </Suspense>
  );
}
function FilterBar({
  filters,
  setFilters,
  data,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  data: Dashboard | null;
}) {
  const [advanced, setAdvanced] = useState(false),
    [preset, setPreset] = useState("Available history");
  const update = (k: keyof Filters, v: string) =>
    setFilters({ ...filters, [k]: v });
  function choose(value: string) {
    setPreset(value);
    if (value === "Custom range") return;
    const now = sgToday(),
      y = Number(now.slice(0, 4)),
      m = Number(now.slice(5, 7));
    let from = "",
      to = now;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (value === "This month") from = now.slice(0, 7) + "-01";
    if (value === "Last month") {
      from = iso(new Date(Date.UTC(y, m - 2, 1)));
      to = iso(new Date(Date.UTC(y, m - 1, 0)));
    }
    if (value === "Last 3 months") from = iso(new Date(Date.UTC(y, m - 3, 1)));
    if (value === "Last 6 months") from = iso(new Date(Date.UTC(y, m - 6, 1)));
    if (value === "This year") from = y + "-01-01";
    setFilters({ ...filters, from, to });
  }
  const customRange =
    preset === "Custom range" ||
    (preset === "Available history" && !!filters.from);
  return (
    <div className="filter-panel">
      <div className="filters">
        <Select
          label="Reporting period"
          value={
            customRange
              ? "Custom range"
              : !filters.from && filters.to === emptyFilters.to
                ? "Available history"
                : preset
          }
          onChange={choose}
        >
          {[
            "Available history",
            "This month",
            "Last month",
            "Last 3 months",
            "Last 6 months",
            "This year",
            "Custom range",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        {customRange && (
          <>
            <label className="field date-field">
              <span>From</span>
              <input
                aria-label="From date"
                type="date"
                value={filters.from}
                max={filters.to || sgToday()}
                onChange={(e) => {
                  setPreset("Custom range");
                  update("from", e.target.value);
                }}
              />
            </label>
            <label className="field date-field">
              <span>To</span>
              <input
                aria-label="To date"
                type="date"
                value={filters.to}
                min={filters.from}
                onChange={(e) => {
                  setPreset("Custom range");
                  update("to", e.target.value);
                }}
              />
            </label>
          </>
        )}
        <button
          className={`button filter-toggle ${advanced ? "selected" : ""}`}
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          <Filter size={17} />
          More filters
        </button>
        <button
          className="text-button reset"
          onClick={() => {
            setPreset("Available history");
            setFilters(emptyFilters);
          }}
        >
          Reset filters
        </button>
      </div>
      {advanced && (
        <div className="advanced-filters">
          <Select
            multiple
            label="Programme"
            value={filters.programme}
            onChange={(v) => update("programme", v)}
          >
            <option value="">All programmes</option>
            {data?.options.programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            multiple
            label="AAP domain"
            value={filters.domain}
            onChange={(v) => update("domain", v)}
          >
            <option value="">All domains</option>
            {data?.options.domains.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
          <Select
            label="Audience"
            value={filters.target}
            onChange={(v) => update("target", v)}
          >
            <option value="all">All attendees</option>
            <option value="male">Male seniors</option>
            <option value="minority">Minority seniors</option>
          </Select>

          <Select
            label="Age"
            value={filters.ageBand}
            onChange={(v) => update("ageBand", v)}
          >
            <option value="">All ages</option>
            <option value={`0-${(data?.settings.seniorAge || 60) - 1}`}>
              Below senior threshold
            </option>
            <option
              value={`${data?.settings.seniorAge || 60}-${(data?.settings.ageBands[0] || 70) - 1}`}
            >
              {data?.settings.seniorAge || 60}–
              {(data?.settings.ageBands[0] || 70) - 1}
            </option>
            <option
              value={`${data?.settings.ageBands[0] || 70}-${(data?.settings.ageBands[1] || 80) - 1}`}
            >
              {data?.settings.ageBands[0] || 70}–
              {(data?.settings.ageBands[1] || 80) - 1}
            </option>
            <option value={`${data?.settings.ageBands[1] || 80}-120`}>
              {data?.settings.ageBands[1] || 80}+
            </option>
          </Select>
          <Select
            label="Recorded gender"
            value={filters.gender}
            onChange={(v) => update("gender", v)}
          >
            <option value="">All genders</option>
            {["MALE", "FEMALE", "UNKNOWN"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            label="Recorded race"
            value={filters.race}
            onChange={(v) => update("race", v)}
          >
            <option value="">All categories</option>
            {data?.options.races.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            label="Client status"
            value={filters.client}
            onChange={(v) => update("client", v)}
          >
            <option value="">All statuses</option>
            <option value="true">Existing client</option>
            <option value="false">Other attendee</option>
            <option value="null">Unknown</option>
          </Select>
          <Select
            label="Service boundary"
            value={filters.boundary}
            onChange={(v) => update("boundary", v)}
          >
            <option value="">All locations</option>
            <option value="true">Within boundary</option>
            <option value="false">Outside boundary</option>
            <option value="null">Unknown</option>
          </Select>
          <p className="muted">
            CFS and living-circumstance analysis is available in the protected
            Who Are We Serving? view; arbitrary sensitive cross-filters are
            restricted.
          </p>

          <Select
            label="Day of week"
            value={filters.weekday || ""}
            onChange={(v) => update("weekday", v)}
          >
            <option value="">All days</option>
            {[
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ].map((x, i) => (
              <option key={x} value={i}>
                {x}
              </option>
            ))}
          </Select>
          <Select
            label="Time of day"
            value={filters.timeSlot || ""}
            onChange={(v) => update("timeSlot", v)}
          >
            <option value="">All time slots</option>
            {["Morning", "Afternoon", "Evening"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select
            label="First observed / returning"
            value={filters.observed || ""}
            onChange={(v) => update("observed", v)}
          >
            <option value="">All participants</option>
            <option value="first">First observed in this period</option>
            <option value="returning">Previously observed</option>
          </Select>
          <p className="muted">
            Different fields combine using AND; choices within Programme or AAP
            domain combine using OR. Risk cross-filters are restricted to
            prevent disclosure.
          </p>
        </div>
      )}
    </div>
  );
}
function Kpis({ data }: { data: Dashboard }) {
  return <KpiDeck data={data} />;
}
function Overview({
  data,
  filters,
  setFilters,
  onProgramme,
}: {
  data: Dashboard;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onProgramme: (p: Programme) => void;
}) {
  const [group, setGroup] = useState<
      | "unique"
      | "male"
      | "minority"
      | "attendance"
      | "firstObserved"
      | "returning"
    >("unique"),
    [rank, setRank] = useState<"unique" | "male" | "minority">("unique");
  const top = [...data.programmes]
      .sort((a, b) => b[rank] - a[rank])
      .slice(0, 5),
    s = data.summary;
  return (
    <>
      <Kpis data={data} />
      <div className="overview-grid">
        <Panel
          title="Outreach over time"
          subtitle="Attendance includes all ages; reach and engagement show unique seniors in each period"
          action={
            <span className="badge soft">
              <span className="green-dot" />
              Observed participation
            </span>
          }
        >
          <div className="chart-controls">
            <div className="segmented">
              {(
                [
                  "unique",
                  "attendance",
                  "firstObserved",
                  "returning",
                  "male",
                  "minority",
                ] as const
              ).map((g) => (
                <button
                  aria-pressed={group === g}
                  className={group === g ? "active" : ""}
                  key={g}
                  onClick={() => setGroup(g)}
                >
                  {g === "unique"
                    ? "All seniors"
                    : g === "male"
                      ? "Male seniors"
                      : g === "minority"
                        ? "Minority seniors"
                        : g === "attendance"
                          ? "Attendance"
                          : g === "firstObserved"
                            ? "First observed"
                            : "Returning"}
                </button>
              ))}
            </div>
            <select
              aria-label="Trend interval"
              value={filters.interval}
              onChange={(e) =>
                setFilters({ ...filters, interval: e.target.value })
              }
            >
              <option value="day">Daily</option>
              <option value="month">Monthly</option>
              <option value="week">Weekly</option>
              <option value="quarter">Quarterly</option>
            </select>
          </div>
          <LineChart rows={data.trends} metric={group} />
        </Panel>
        <Panel
          title="Programmes with highest reach"
          subtitle="Each senior is counted once per programme"
          action={
            <select
              aria-label="Programme ranking audience"
              value={rank}
              onChange={(e) => setRank(e.target.value as typeof rank)}
            >
              <option value="unique">All seniors</option>
              <option value="male">Male seniors</option>
              <option value="minority">Minority seniors</option>
            </select>
          }
        >
          <Bars
            items={top.map((p) => ({ label: p.name, value: p[rank] }))}
            onSelect={(name) => {
              const p = top.find((p) => p.name === name);
              if (p) onProgramme(p);
            }}
          />
          <div className="panel-link">
            <button
              className="text-button"
              onClick={() => top[0] && onProgramme(top[0])}
            >
              Explore the leading programme
              <ArrowRight size={16} />
            </button>
          </div>
        </Panel>
        <Panel
          title="First observed & returning"
          subtitle="The first recorded attendance across the available dataset"
        >
          <div className="engagement-total">
            <strong>{number(s.unique)}</strong>
            <span>different seniors in this view</span>
          </div>
          <div
            className="stacked"
            role="img"
            aria-label={`${s.firstObserved} first observed; ${s.unique - s.firstObserved} observed before this period`}
          >
            <div
              style={{
                width: `${s.unique ? (s.firstObserved / s.unique) * 100 : 0}%`,
              }}
            />
            <div
              style={{
                width: `${s.unique ? ((s.unique - s.firstObserved) / s.unique) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="legend">
            <span>
              <i />
              {s.firstObserved} first observed in period
            </span>
            <span>
              <i className="blue" />
              {s.unique - s.firstObserved} observed before period
            </span>
          </div>
          <div className="engagement-stats">
            <div>
              <b>{s.repeat}</b>
              <span>attended 2+ sessions in this view</span>
            </div>
            <div>
              <b>{number(s.frequency)}</b>
              <span>senior attendances per senior</span>
            </div>
            <div>
              <b>{pct(s.repeatRate)}</b>
              <span>of seniors attended 2+ sessions</span>
            </div>
            <div>
              <b>{number(s.multiProgramme)}</b>
              <span>attended 2+ programmes</span>
            </div>
          </div>
          <Note>
            First observed does not mean new to the centre. Repeat engagement
            can include first-observed seniors.
          </Note>
        </Panel>
        <Panel
          title="Participation by AAP domain"
          subtitle="Unique senior reach and attendance entries across all ages"
        >
          <div className="domain-list">
            {[...data.domains]
              .sort((a, b) => b.unique - a.unique)
              .map((d) => (
                <div key={d.label}>
                  <div>
                    <strong>{d.label}</strong>
                    <span>
                      {d.unique} seniors · {d.attendance} entries · {d.sessions}{" "}
                      sessions
                    </span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(d.unique / Math.max(...data.domains.map((x) => x.unique), 1)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
          <Note>A senior may attend programmes in several domains.</Note>
        </Panel>
      </div>
      <Portfolio
        data={data}
        onDomain={(domain) => setFilters({ ...filters, domain })}
      />
      <InsightCards data={data} onProgramme={onProgramme} />
      <Note>
        Minority definitions: {data.settings.minority.join(", ")}. Unknown race:{" "}
        {s.unknownRace}; unknown or other recorded gender: {s.unknownGender}.
        These seniors remain in overall reach.
      </Note>
    </>
  );
}
function Programmes({
  data,
  onProgramme,
}: {
  data: Dashboard;
  onProgramme: (p: Programme) => void;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] =
      useState<
        keyof Pick<
          Stats,
          | "unique"
          | "male"
          | "minority"
          | "sessions"
          | "repeat"
          | "average"
          | "attendance"
          | "firstObserved"
          | "returning"
        >
      >("unique");
  const [compareOpen, setCompareOpen] = useState(false),
    [portfolioOpen, setPortfolioOpen] = useState(false);
  const [page, setPage] = useState(0),
    [columns, setColumns] = useState<string[]>([
      "sessions",
      "unique",
      "male",
      "minority",
      "average",
    ]),
    [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    api<{ programmeColumns?: string[] }>("/api/preferences")
      .then((p) => {
        if (p.programmeColumns) setColumns(p.programmeColumns);
      })
      .catch(() => {});
  }, []);
  const list = data.programmes
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name));
  return (
    <>
      <Panel
        title="Past programmes"
        subtitle={`${list.length} programmes · senior outreach alongside delivery frequency`}
      >
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Search programme names"
              placeholder="Search programmes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Select
            label="Sort by"
            value={sort}
            onChange={(v) => setSort(v as typeof sort)}
          >
            {[
              ["unique", "Unique seniors"],
              ["male", "Male reach"],
              ["minority", "Minority reach"],
              ["sessions", "Sessions"],
              ["repeat", "Repeat participants"],
              ["average", "Average attendance"],
              ["attendance", "Attendance entries"],
              ["firstObserved", "First observed seniors"],
              ["returning", "Seniors recorded before period"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <details>
          <summary>Choose visible programme columns</summary>
          <div className="work-checks">
            {Object.entries(metrics).map(([k, [label]]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={columns.includes(k)}
                  onChange={(e) =>
                    setColumns(
                      e.target.checked
                        ? [...columns, k]
                        : columns.filter((x) => x !== k),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <Button
            onClick={async () => {
              try {
                const prefs =
                  await api<Record<string, unknown>>("/api/preferences");
                await api("/api/preferences", {
                  method: "PUT",
                  body: JSON.stringify({ ...prefs, programmeColumns: columns }),
                });
                setSavedMessage("Programme columns saved to your account.");
              } catch (e) {
                setSavedMessage((e as Error).message);
              }
            }}
          >
            Save programme columns
          </Button>
          {savedMessage && <p role="status">{savedMessage}</p>}
        </details>
        <div className="work-table programme-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Programme / Domains</th>
                {columns
                  .filter((k) => metrics[k])
                  .map((k) => (
                    <th scope="col" key={k}>{metrics[k][0]}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {list
                .slice(
                  Math.min(page, Math.max(0, Math.ceil(list.length / 20) - 1)) *
                    20,
                  (Math.min(
                    page,
                    Math.max(0, Math.ceil(list.length / 20) - 1),
                  ) +
                    1) *
                    20,
                )
                .map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <button
                        className="text-button programme-name"
                        onClick={() => onProgramme(p)}
                      >
                        {p.name}
                      </button>
                      <ul className="programme-domains" aria-label="Programme domains">
                        {activityDomains(
                          p.domain,
                          p.eventTypes || (p.sessionList || []).flatMap(s => s.eventTypes || []),
                        ).map(domain => <li key={domain}>{domain}</li>)}
                      </ul>
                    </th>
                    {columns
                      .filter((k) => metrics[k])
                      .map((k) => (
                        <td key={k}>{number(Number(p[k as keyof Stats]))}</td>
                      ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="work-actions">
          <Button
            disabled={page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
          >
            Previous page
          </Button>
          <span>{list.length} programmes ? 20 per page</span>
          <Button
            disabled={(page + 1) * 20 >= list.length}
            onClick={() => setPage(page + 1)}
          >
            Next page
          </Button>
        </div>
        <details onToggle={(e) => setCompareOpen(e.currentTarget.open)}>
          <summary>Compare Programmes ? select 2?4</summary>
          {compareOpen && (
            <Suspense
              fallback={<p role="status">Loading programme comparison?</p>}
            >
              <ProgrammeCompare
                data={{ ...data, programmes: list }}
                onProgramme={onProgramme}
                columns={columns}
                setColumns={setColumns}
              />
            </Suspense>
          )}
        </details>
        {list.length === 0 && (
          <div className="empty">No programmes match your search.</div>
        )}
        <Note>
          One-time workshops and recurring activities have different delivery
          frequencies. Open a programme for attendance per session, engagement
          and evidence limitations.
        </Note>
      </Panel>
      <details
        className="panel"
        onToggle={(e) => setPortfolioOpen(e.currentTarget.open)}
      >
        <summary>Compare programme types</summary>
        {portfolioOpen && <DomainPortfolio data={data} />}
      </details>
    </>
  );
}
function Audience({
  data,
  filters,
  setFilters,
}: {
  data: Dashboard;
  filters?: Filters;
  setFilters?: (f: Filters) => void;
}) {
  const [metric, setMetric] = useState<"male" | "minority">("male");

  return (
    <>
      <div className="callout">
        <div className="icon-tile">
          <Users />
        </div>
        <div>
          <h2>Participation patterns, with context</h2>
          <p>
            A low share alone does not establish underrepresentation. Compare
            against staff-configured targets or a suitable reference population.
            Small groups need careful interpretation.
          </p>
        </div>
      </div>
      <div className="audience-grid">
        <Panel
          title="Gender outreach"
          subtitle={`${data.summary.knownGender} seniors with known male/female gender`}
        >
          <DemographicBars
            items={data.gender}
            denominator={data.summary.unique}
            onSelect={
              filters && setFilters
                ? (gender) => setFilters({ ...filters, gender })
                : undefined
            }
          />
          <Note>
            Unknown and other recorded values are shown separately and excluded
            from the male percentage denominator.
          </Note>
        </Panel>
        <Panel
          title="Recorded race & minority outreach"
          subtitle={`Configured minority groups: ${data.settings.minority.join(", ")}`}
        >
          <DemographicBars
            items={data.race}
            denominator={data.summary.unique}
            onSelect={
              filters && setFilters
                ? (race) => setFilters({ ...filters, race })
                : undefined
            }
          />
          <Note>
            Staff-only detail. Counts below five are small samples. All
            demographic breakdowns are omitted from shared reports.
          </Note>
        </Panel>
        <Panel
          title="Senior age groups"
          subtitle={`Age eligibility: ${data.settings.seniorAge}+`}
        >
          <DemographicBars
            items={data.ages}
            denominator={data.summary.unique}
            onSelect={
              filters && setFilters
                ? (label) =>
                    setFilters({
                      ...filters,
                      ageBand: label
                        .replace(/\u2013/g, "-")
                        .replace("+", "-120"),
                    })
                : undefined
            }
          />
          <Note>
            Use More filters ? Age to view attendees below the senior threshold;
            these attendees count in attendance, not senior reach.
          </Note>
        </Panel>
        <Panel
          title="Participation frequency"
          subtitle="Different seniors, based on distinct sessions in this view"
        >
          <Bars items={data.frequency} color="blue" />
        </Panel>
        <Panel
          title="Existing clients & other attendees"
          subtitle="Unique seniors by recorded client status"
        >
          <Bars items={data.clients} />
          <Note>Other attendees are not necessarily new to the centre.</Note>
        </Panel>
        <Panel
          title="Service boundary"
          subtitle="Unique seniors by recorded service-boundary status"
        >
          <Bars items={data.boundary} />
          <Note>
            Outside-boundary participation does not establish newly acquired
            outreach.
          </Note>
        </Panel>
        <Panel
          title="Target-group participation by domain"
          subtitle="People may appear in several domains"
          action={
            <select
              aria-label="Domain audience"
              value={metric}
              onChange={(e) => setMetric(e.target.value as typeof metric)}
            >
              <option value="male">Male seniors</option>
              <option value="minority">Minority seniors</option>
            </select>
          }
        >
          <Bars
            items={data.domains.map((d) => ({
              label: `${d.label} · ${pct(metric === "male" ? d.malePct : d.minorityPct)} of known ${metric === "male" ? "gender" : "race"}`,
              value: d[metric],
            }))}
          />
        </Panel>
        <Panel
          title="Weekday & time of day"
          subtitle="Morning before 12:00 · afternoon 12:00–17:59 · evening from 18:00"
        >
          <TimingMatrix data={data} />
          <Note>
            Timing coincides with attendance; programme type and delivery
            frequency also differ. Counts are not additive across time slots.
          </Note>
        </Panel>
        <Panel
          title="Venue & living arrangements"
          subtitle="Additional context for future planning"
        >
          <div className="missing-fields">
            <span>
              Venue analysis <b>Review programme metadata</b>
            </span>
            <span>
              Living arrangements <b>Protected profile workspace</b>
            </span>
            <span>
              Language & transport barriers <b>Review recorded responses</b>
            </span>
          </div>
          <Note>
            Optional fields are reserved in the data model. No assumptions are
            made about isolation, frailty or language from race, age or CFS.
          </Note>
        </Panel>
        <Panel
          title="Session duration & attendance"
          subtitle="Observed all-age attendance per session; duration is not a proven cause"
        >
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Recorded attendance by session duration
              </caption>
              <thead>
                <tr>
                  <th scope="col">Duration</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Avg attendance</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {data.duration.map((d) => (
                  <tr key={d.label}>
                    <th scope="row">{d.label}</th>
                    <td>{number(d.sessions)}</td>
                    <td>{number(d.average)}</td>
                    <td>
                      {d.sessions >= data.settings.minSessions &&
                      d.unique >= data.settings.minParticipants
                        ? "Sufficient observations"
                        : "Limited observations"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            These are descriptive averages. Programme type, intended audience
            and delivery frequency differ; capacity and cancellations are not
            recorded.
          </Note>
        </Panel>
      </div>
    </>
  );
}
function Planning({
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
function ProgrammeDialog({
  programme: p,
  data,
  onClose,
  onPlan,
}: {
  programme: Programme;
  data: Dashboard;
  onClose: () => void;
  onPlan?: () => void;
}) {
  const rec = data.recommendations.find((r) => r.id === p.id);
  return (
    <Modal title={p.name} onClose={onClose} wide drawer>
      <div className="detail-intro">
        <span className="badge soft">{activityDomains(p.domain,p.eventTypes||(p.sessionList||[]).flatMap(s=>s.eventTypes||[])).join(', ')}</span>
        <span>
          {p.sessions === 1
            ? "One observed session"
            : "Recurring within available records"}
        </span>
      </div>
      <div className="detail-stats">
        {[
          ["Unique seniors", p.unique],
          ["Male seniors", `${p.male} · ${pct(p.malePct)}`],
          ["Minority seniors", `${p.minority} · ${pct(p.minorityPct)}`],
          ["Recorded sessions", p.sessions],
          ["Attendance · all ages", p.attendance],
          ["Average attendance / session", number(p.average)],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      {onPlan && (
        <Button primary onClick={onPlan}>
          Plan next steps for this programme
        </Button>
      )}
      <details>
        <summary>Repeat participation and history</summary>
        <div className="detail-stats">
          {[
            ["Repeat seniors · 2+ sessions", p.repeat],
            ["First observed in period", p.firstObserved],
            ["Recorded before period", p.returning],
            ["Repeat participation rate", pct(p.repeatRate)],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </details>
      <h3>Attendance trend · all ages</h3>
      <LineChart rows={p.trend} metric="attendance" />
      <details>
        <summary>Programme notes and accessibility</summary>
        <h3>Programme accessibility and feedback</h3>
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Staff-reviewed information</th>
                <th>Recorded value</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["languages", "Languages"],
                ["venueAccessibility", "Venue access"],
                ["seatedOption", "Seated option"],
                ["mobilityRequirements", "Mobility requirements"],
              ].map(([key, label]) => (
                <tr key={key}>
                  <th>{label}</th>
                  <td>
                    {String(
                      (
                        p.optional.accessibility as
                          Record<string, string> | undefined
                      )?.[key] || "Data required",
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <th>Programme-specific feedback</th>
                <td>
                  Data required: participant feedback is not automatically
                  attributed to a programme.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <h3>Recorded session dates</h3>
      <div className="session-list">
        {p.sessionList.map((s) => (
          <div key={s.id}>
            <span>{pretty(s.date)}</span>
            <span>
              {time(s.start)}–{time(s.end)} SGT
            </span>
            <span>{s.venue || "Venue not supplied"}</span>
            <span>{activityDomains(p.domain,s.eventTypes).join(', ')}</span>
          </div>
        ))}
      </div>
      {rec && (
        <div className="callout">
          <div>
            <h3>
              {rec.category} · {rec.evidence} evidence
            </h3>
            <p>
              {rec.figures}. {rec.reason}
            </p>
            <p>{rec.action}</p>
          </div>
        </div>
      )}
      <Note>
        Known gender denominator: {p.knownGender}; known race: {p.knownRace}.
        Unknown gender: {p.unknownGender}; unknown race: {p.unknownRace}. First
        observed refers to the full available dataset, not first-ever centre
        participation. Cost, capacity and feedback are unavailable. A single
        session is not necessarily the programme’s only planned delivery.
      </Note>
    </Modal>
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
function TargetDialog({
  data,
  onClose,
  onDone,
}: {
  data: Dashboard;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [start, setStart] = useState(sgToday()),
    [end, setEnd] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      await api("/api/targets", {
        method: "POST",
        body: JSON.stringify({ ...f, value: Number(f.value) }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Set an outreach target" onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <p>
          Choose your own goal and period. Progress will use saved attendance
          within that period.
        </p>
        <label className="field">
          <span>Measure</span>
          <select name="metric">
            <option value="unique">Unique seniors reached</option>
            <option value="male">Unique male seniors</option>
            <option value="minority">Unique minority seniors</option>
            <option value="firstObserved">
              First observed in available dataset
            </option>
          </select>
        </label>
        <label className="field">
          <span>Target number of different seniors</span>
          <input
            name="value"
            type="number"
            min="1"
            max="1000000"
            step="1"
            required
          />
        </label>
        <label className="field">
          Target period
          <select
            defaultValue="Custom range"
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === "Custom range") return;
              const now = sgToday(),
                y = Number(now.slice(0, 4)),
                m = Number(now.slice(5, 7)) - 1;
              const base = kind === "Quarter" ? Math.floor(m / 3) * 3 : m;
              const months =
                kind === "Monthly" ? 1 : kind === "Six months" ? 6 : 3;
              setStart(
                new Date(Date.UTC(y, base, 1)).toISOString().slice(0, 10),
              );
              setEnd(
                new Date(Date.UTC(y, base + months, 0))
                  .toISOString()
                  .slice(0, 10),
              );
            }}
          >
            <option>Custom range</option>
            <option>Monthly</option>
            <option>Quarter</option>
            <option>Three months</option>
            <option>Six months</option>
          </select>
        </label>
        <div className="form-row">
          <label className="field">
            <span>Start date</span>
            <input
              name="start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>End date</span>
            <input
              name="end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
        </div>
        <label className="field">
          <span>Programme scope</span>
          <select name="programmeId">
            <option value="">All programmes</option>
            {data.options.programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Note>
          No projection is calculated. First-observed participation does not
          establish new centre registration.
        </Note>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button primary type="submit" disabled={busy}>
          Save target
        </Button>
      </form>
    </Modal>
  );
}
function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const maxFileMb = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname,
  )
    ? 8
    : 4;
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [mode, setMode] = useState("merge"),
    [confirmation, setConfirmation] = useState("");
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const file = form.get("file");
      if (
        file &&
        typeof file !== "string" &&
        file.size >= maxFileMb * 1024 * 1024
      )
        throw Error(
          `Choose a file smaller than ${maxFileMb} MB. Split larger attendance exports into smaller files.`,
        );
      setPreview(
        await api<Preview>("/api/import/preview?mode=" + mode, {
          method: "POST",
          body: form,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await api("/api/import/confirm", {
        method: "POST",
        body: JSON.stringify({ id: preview!.id, confirmation }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function issuesCsv() {
    if (!preview) return;
    const csv =
      "Row,Issue\r\n" +
      preview.issues
        .map((i) => `${i.row},"${i.message.replaceAll('"', '""')}"`)
        .join("\r\n");
    const a = document.createElement("a"),
      url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.href = url;
    a.download = "import-issues.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  const discard = () => {
    if (preview)
      void api("/api/import/preview/" + preview.id, { method: "DELETE" }).catch(
        () => {},
      );
  };
  return (
    <Modal
      title={preview ? "Review attendance import" : "Import attendance"}
      onClose={() => {
        discard();
        onClose();
      }}
      wide
    >
      <ImportProgress step={!preview ? 1 : consent ? 4 : 3} />
      {!preview ? (
        <form onSubmit={upload} className="form-stack">
          <Select label="Import mode" value={mode} onChange={setMode}>
            <option value="add">
              Add New Records ? retain existing profiles
            </option>
            <option value="merge">Merge and Update Existing Records</option>
            <option value="replace">
              Full Replacement ? attendance only, backup required
            </option>
          </Select>
          <p>
            Merge keeps historical attendance, updates nonblank profile values
            by Member ID, and retains existing values when incoming fields are
            blank. Conflicting incoming nonblank values use source row order:
            the last reviewed value wins.
          </p>
          <div className="upload-area">
            <Upload size={32} />
            <h3>Bring your attendance records together</h3>
            <p>
              Excel (.xlsx) or UTF-8 CSV · under {maxFileMb} MB and up to 50,000
              rows
            </p>
            <input
              type="file"
              name="file"
              aria-label="Attendance workbook or CSV"
              accept=".xlsx,.csv"
              required
            />
          </div>
          <details>
            <summary>Required column headers & source rules</summary>
            <p>
              Name/Member ID, Gender, optional Name/Current Living Arrangement
              and Name/Marital Status, Name/Age, Name/Race, Name/CFS, optional
              Name/Social Risk Factor(s), Is Client, Within Boundary, Activity
              Name, AAP Domain, Session Detail
            </p>
            <p>
              Headers in row 1 of exactly one worksheet. Session example:
              2026-05-04, 09:00 AM - 09:45 AM. Formula cells and legacy .xls
              files are not accepted.
            </p>
          </details>
          <Note>
            Attendance is added only after you review and confirm. A temporary
            preview expires after 20 minutes. Raw Member IDs are hashed for
            matching and are not retained; the file itself is not stored.
          </Note>
          <Button primary type="submit" disabled={busy}>
            {busy ? "Validating file…" : "Preview import"}
            <ArrowRight size={16} />
          </Button>
        </form>
      ) : (
        <>
          <div className="import-counts">
            {[
              ["Raw rows", preview.rawRows],
              ["Existing matches", preview.matched ?? 0],
              ["Profile updates", preview.updatedProfiles ?? 0],
              ["Session Event Type updates", preview.updatedSessions ?? 0],
              ["Missing values", preview.missing ?? 0],
              ["Resulting attendance", preview.resultingAttendance ?? 0],
              ["Resulting profiles", preview.resultingParticipants ?? 0],
              ["Ready to import", preview.ready],
              ["Duplicates", preview.duplicates],
              ["Invalid", preview.invalid],
              ["Conflicts · skipped", preview.skipped],
            ].map(([k, v]) => (
              <div key={k}>
                <strong>{v}</strong>
                <span>{k}</span>
              </div>
            ))}
          </div>
          <Note>
            Attendance identity uses Member ID, exact trimmed programme name,
            date and both session times. Separate sessions on the same day
            remain separate. Existing member details and programme domains are
            retained in Add mode. Merge updates reviewed nonblank profile fields
            and preserves blank incoming values; programme-domain conflicts
            remain skipped. Future sessions are stored but excluded from
            delivered attendance until their date.
            {' '}Merge also applies the previewed session Event Type changes. Older or blank Event Types never erase existing classifications.
          </Note>
          {!!preview.sessionChanges?.length&&<details><summary>Review session Event Type changes · {preview.updatedSessions}</summary><div className="work-table"><table><thead><tr><th>Programme / date</th><th>Existing source</th><th>Incoming source</th></tr></thead><tbody>{preview.sessionChanges.map((s,i)=><tr key={i}><th>{s.programme} · {s.date}</th><td>{s.before}</td><td>{s.after}</td></tr>)}</tbody></table></div><p>Up to 100 changes shown; all proposed session updates are counted above.</p></details>}
          {preview.variants.length > 0 && (
            <div className="warning">
              <h3>Similar programme names remain separate</h3>
              {preview.variants.map((v, i) => (
                <p key={i}>{v.join(" ? ")}</p>
              ))}
              <p>
                Correct the source and preview again if these are the same
                programme. No names are silently merged.
              </p>
            </div>
          )}
          <details open={preview.issues.length > 0}>
            <summary>
              Validation report · {preview.issues.length} issues & warnings
            </summary>
            <Button onClick={issuesCsv}>
              <Download size={16} />
              Download row issues
            </Button>
            <div className="issue-list">
              {preview.issues.slice(0, 100).map((i, n) => (
                <p key={n}>
                  <b>Row {i.row}:</b> {i.message}
                </p>
              ))}
              {preview.issues.length > 100 && (
                <p>Download the full report for remaining issues.</p>
              )}
              {!preview.issues.length && (
                <p>No invalid rows or demographic warnings detected.</p>
              )}
            </div>
          </details>
          <h3>Preview · first {preview.preview.length} valid rows</h3>
          <div className="import-preview">
            {preview.preview.map((r) => (
              <div key={r.row}>
                <span>Row {r.row}</span>
                <strong>{r.programme}</strong>
                <span>{r.domain}</span>
                {r.eventType&&<span>Event Type: {r.eventType}</span>}
                <small>
                  {r.date} · {time(r.start)}–{time(r.end)}
                </small>
              </div>
            ))}
          </div>
          <details>
            <summary>Compare with the reference workbook checks</summary>
            <p>
              Use these checks only for the exact reference workbook.
              Definitions use current settings. Demographic conflicts can affect
              diagnostics; resolve them in the source.
            </p>
            <div className="reference-table">
              {Object.entries(preview.expectedReference).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <span>Expected {v}</span>
                  <strong>
                    {preview.reference[k] ?? "—"}{" "}
                    {preview.reference[k] === v ? "?" : "· differs"}
                  </strong>
                </div>
              ))}
            </div>
          </details>
          {mode === "replace" && (
            <div className="warning">
              <h3>Replace all saved attendance</h3>
              <p>
                A transactional database backup will be created. Existing
                profiles, targets, programme metadata and decisions remain. All
                attendance is replaced by valid imported entries. Invalid or
                conflicting rows are excluded.
              </p>
              <label className="field">
                Type REPLACE ATTENDANCE to confirm
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I reviewed the preview, mode, profile updates, session Event Types and issue report.
              Apply the displayed changes; skip invalid rows and unresolved
              programme conflicts.
            </span>
          </label>
          <div className="modal-actions">
            <Button
              onClick={() => {
                discard();
                setPreview(null);
                setConsent(false);
              }}
            >
              Choose another file
            </Button>
            <Button
              primary
              disabled={
                busy ||
                !consent ||
                (!preview.ready && !preview.updatedProfiles && !preview.updatedSessions) ||
                (mode === "replace" && confirmation !== "REPLACE ATTENDANCE")
              }
              onClick={confirm}
            >
              {busy
                ? "Saving…"
                : `Confirm ${preview.ready} entries, ${preview.updatedProfiles || 0} profile and ${preview.updatedSessions || 0} session updates`}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function SettingsDialog({
  data,
  onClose,
  refresh,
}: {
  data: Dashboard;
  onClose: () => void;
  refresh: (s?: string) => void;
}) {
  const [s, setS] = useState<Settings>(data.settings),
    [rulesLoaded, setRulesLoaded] = useState(false),
    [minority, setMinority] = useState(data.settings.minority.join(", ")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [quality, setQuality] = useState<{
      imports: {
        id: number;
        created: string;
        imported: number;
        duplicates: number;
        invalid: number;
        invalidAgeCount?: number;
        invalidSessionCount?: number;
        namingVariantCount?: number;
        skipped: number;
      }[];
      audit: { created: string; action: string }[];
    } | null>(null);
  useEffect(() => {
    let live = true;
    api<NonNullable<Settings["outreachRules"]>>("/api/settings/outreach-rules")
      .then((outreachRules) => {
        if (!live) return;
        setS((old) => ({ ...old, outreachRules }));
        setRulesLoaded(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    api<typeof quality>("/api/quality")
      .then(setQuality)
      .catch((e) => setError(e.message));
    return () => { live = false; };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!rulesLoaded) return;
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...s,
          minority: minority
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      });
      refresh("Definitions updated. All dashboard calculations refreshed.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Data quality & definitions" onClose={onClose} wide>
      <div className="quality-grid">
        {Object.entries(data.quality).map(([k, v]) => (
          <div key={k}>
            <strong>{v}</strong>
            <span>
              {
                {
                  missingAge: "Missing age",
                  unknownGender: "Unknown / other gender",
                  unknownRace: "Unknown race",
                  missingRace: "Missing race",
                  futureSessions: "Future sessions",
                  missingVenue: "Sessions without venue",
                }[k]
              }
            </span>
          </div>
        ))}
      </div>
      <Note>
        Quality counts cover all persisted records, independently of dashboard
        filters. Invalid ages, incomplete session dates and conflicting details
        appear in the import reports. CFS is preserved without a clinical
        interpretation.
      </Note>
      <h3>Import history</h3>
      <div className="history-list">
        {quality?.imports.map((i) => (
          <div key={i.id}>
            <strong>
              Import #{i.id} ·{" "}
              {new Date(i.created).toLocaleString("en-SG", {
                timeZone: "Asia/Singapore",
              })}
            </strong>
            <span>
              {i.imported} imported · {i.duplicates} duplicates · {i.invalid}{" "}
              invalid · {i.skipped} conflicts skipped
            </span>
            <span>
              {i.invalidAgeCount ?? 0} invalid ages ·{" "}
              {i.invalidSessionCount ?? 0} invalid/incomplete session details ·{" "}
              {i.namingVariantCount ?? 0} naming variations retained separately
            </span>
          </div>
        ))}
        {quality?.imports.length === 0 && (
          <p className="muted">No confirmed imports yet.</p>
        )}
      </div>
      <form className="form-stack" onSubmit={save}>
        <h3>Demographic & evidence definitions</h3>
        <div className="form-row">
          <label className="field">
            <span>Senior age threshold</span>
            <input
              type="number"
              min="1"
              max="100"
              value={s.seniorAge}
              onChange={(e) =>
                setS({ ...s, seniorAge: Number(e.target.value) })
              }
              required
            />
          </label>
          <label className="field">
            <span>Second age band starts at</span>
            <input
              type="number"
              min={s.seniorAge + 1}
              max="119"
              value={s.ageBands[0]}
              onChange={(e) =>
                setS({
                  ...s,
                  ageBands: [Number(e.target.value), s.ageBands[1]],
                })
              }
              required
            />
          </label>
          <label className="field">
            <span>Oldest age band starts at</span>
            <input
              type="number"
              min={s.ageBands[0] + 1}
              max="120"
              value={s.ageBands[1]}
              onChange={(e) =>
                setS({
                  ...s,
                  ageBands: [s.ageBands[0], Number(e.target.value)],
                })
              }
              required
            />
          </label>
        </div>
        <label className="field">
          <span>Minority race categories, separated by commas</span>
          <input
            value={minority}
            onChange={(e) => setMinority(e.target.value)}
            maxLength={1000}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Minimum sessions for sufficient evidence</span>
            <input
              type="number"
              min="3"
              max="100"
              value={s.minSessions}
              onChange={(e) =>
                setS({ ...s, minSessions: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Minimum seniors for sufficient evidence</span>
            <input
              type="number"
              min="5"
              max="1000"
              value={s.minParticipants}
              onChange={(e) =>
                setS({ ...s, minParticipants: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <Note>
          Changing definitions recalculates analytics and target progress.
          Original imported demographics and attendance remain intact. UNKNOWN
          is excluded from minority categories and known-race denominators.
        </Note>
        <fieldset>
          <legend>Participation comparison reliability</legend>
          <p>These thresholds flag uncertainty and limit automatic comparisons. All recorded staff groups remain visible; privacy settings are unchanged.</p>
          <div className="form-row">
            <label className="field"><span>Caution below this registered group size</span><input type="number" min="2" max="1000" required value={s.reliability?.cautionMinimum ?? 20} onChange={e => setS({ ...s, reliability: { cautionMinimum: Number(e.target.value), comparisonFloor: s.reliability?.comparisonFloor ?? 10 } })} /></label>
            <label className="field"><span>Minimum registered group size for automatic comparisons</span><input type="number" min="1" max={s.reliability?.cautionMinimum ?? 20} required value={s.reliability?.comparisonFloor ?? 10} onChange={e => setS({ ...s, reliability: { cautionMinimum: s.reliability?.cautionMinimum ?? 20, comparisonFloor: Number(e.target.value) } })} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Engagement depth</legend>
          <label className="field"><span>Regular participation starts at this many sessions</span><input type="number" min="3" max="1000" required value={s.engagement?.regularFrom ?? 6} onChange={e => setS({ ...s, engagement: { regularFrom: Number(e.target.value) } })} /></label>
          <p>Within the reporting period: One-time = 1 distinct session; Occasional = 2–{(s.engagement?.regularFrom ?? 6) - 1}; Regular = {s.engagement?.regularFrom ?? 6}+. No recorded history and no attendance matching this view remain separate. Recency uses 30/60/90-day bands anchored to the attendance coverage end date. These segments do not change the existing active/inactive rules.</p>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {rulesLoaded ? (
          <OutreachRulesFields
            value={s.outreachRules}
            onChange={(outreachRules) => setS({ ...s, outreachRules })}
          />
        ) : <p role="status">Loading saved follow-up priority rules…</p>}
        <Button primary type="submit" disabled={busy || !rulesLoaded}>
          Save definitions
        </Button>
      </form>
      <details>
        <summary>Recent audit events</summary>
        {quality?.audit.map((a, i) => (
          <p key={i}>
            {new Date(a.created).toLocaleString("en-SG", {
              timeZone: "Asia/Singapore",
            })}{" "}
            · {a.action}
          </p>
        ))}
      </details>
    </Modal>
  );
}
export {
  App,
  Overview,
  Audience,
  Planning,
  FilterBar,
  Programmes,
  ImportDialog,
  Modal,
};
