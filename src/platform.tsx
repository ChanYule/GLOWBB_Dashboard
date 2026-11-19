import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Database,
  Download,
  HeartHandshake,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { App } from "./main";
import type { Filters, User } from "./types";
import { api, setCentreContext, setReportingMode } from "./api";
import type { Centre } from "../shared/centres.js";
import "./platform.css";
import "./professional-ui.css";
import './experience.css';
const CentreTools = lazy(() =>
  import("./centre-tools").then((m) => ({ default: m.CentreTools })),
);
const ConfigurationCentre = lazy(() =>
  import("./configuration-centre").then((m) => ({
    default: m.ConfigurationCentre,
  })),
);
type Staff = User & {
  id: number;
  centres: Centre[];
  preferredCentre: string | null;
  canCompare: boolean;
};
const mainPages = [
  ["Overview", "Overview", LayoutDashboard],
  ["Programme Performance", "Programme Analysis", BarChart3],
  [
    "Participation Patterns & Insights",
    "Participation Insights",
    ChartNoAxesCombined,
  ],
  ["Client Engagement", "Client Engagement", Users],
  ["Planning & Recommendations", "Planning", ClipboardList],
] as const;
const analysisPages = [
  ["SPPB Assessments", "SPPB Assessments", Activity],
  ["Participant Needs & Accessibility", "Participant Needs", HeartHandshake],
  ["Custom Analysis", "Custom Analysis", SlidersHorizontal],
] as const;
const advancedPages = [
  ["Audience & Outreach", "Audience & Outreach", Users],
  ["Operations & Screening", "Operations & Screening", Activity],
  ["Social Risk Analysis", "Social Risk Analysis", ShieldCheck],
  ["Who Are We Serving?", "Who Are We Serving?", Users],
  ["Gaps and Participation Barriers", "Gaps and Barriers", HeartHandshake],
  ["Programme Alignment", "Programme Alignment", BarChart3],
  ["Programme Planning and Actions", "Detailed action tracker", ClipboardList],
  [
    "Data Quality and Administration",
    "Data Quality and Administration",
    ShieldCheck,
  ],
] as const;
export function PlatformApp() {
  const [staff, setStaff] = useState<Staff | null>(null),
    [centre, setCentre] = useState<Centre | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState("Overview"),
    [mode, setMode] = useState<"official" | "exploratory">("official"),
    [revision, setRevision] = useState(0),
    [menu, setMenu] = useState(false),
    [collapsed, setCollapsed] = useState(() => {
      try {
        return window.localStorage.getItem("glow.sidebar.collapsed") === "true";
      } catch {
        return false;
      }
    }),
    [command, setCommand] = useState<
      { id: number; modal: string } | undefined
    >();
  const dates = useRef<Partial<Filters> | undefined>(undefined),
    [period, setPeriod] = useState<Partial<Filters>>({});
  const rememberDates = useCallback((value: Partial<Filters>) => {
    dates.current = value;
    setPeriod((old) =>
      old.from === value.from &&
      old.to === value.to &&
      old.interval === value.interval
        ? old
        : value,
    );
  }, []);
  const load = useCallback(() => {
    setStaff(null);
    setCentre(null);
    setCentreContext(null);
    setMode("official");
    api<Staff>("/api/me")
      .then((value) => {
        const selected =
          value.centres.find((c) => c.id === value.preferredCentre) ||
          value.centres[0] ||
          null;
        setCentreContext(selected);
        setCentre(selected);
        setStaff(value);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    document.title = centre
      ? centre.name + " | Programme & Outreach Dashboard"
      : "Programme & Outreach Dashboard";
  }, [centre]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menu]);
  const navigate = (id: string) => {
    setPage(id);
    setMenu(false);
    document.scrollingElement?.scrollTo?.({ top: 0, behavior: "instant" });
  };
  const openModal = (modal: string) => {
    if (page.startsWith("__")) setPage("Overview");
    setCommand({ id: Date.now(), modal });
    setMenu(false);
  };
  const navItem = ([id, label, Icon]: readonly [
    string,
    string,
    typeof Users,
  ]) => (
    <button
      key={id}
      data-page={id}
      className={"shell-nav-item" + (page === id ? " active" : "")}
      aria-current={page === id ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={() => navigate(id)}
    >
      <Icon size={19} />
      <span>{label}</span>
    </button>
  );
  if (!staff)
    return (
      <main className="workspace-loading">
        <div className="workspace-loading-mark">
          <ChartNoAxesCombined size={28} />
        </div>
        <h1>Programme &amp; Outreach</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Loading your centre workspace…"}
        </p>
        {error && (
          <button className="button" onClick={load}>
            Retry staff workspace
          </button>
        )}
      </main>
    );
  const administrative = page.startsWith("__");
  return (
    <div
      className={
        "dashboard-shell" +
        (collapsed ? " sidebar-collapsed" : "") +
        (menu ? " shell-menu-open" : "")
      }
    >
      <a
        className="skip-link"
        href={administrative ? "#workspace-content" : "#main"}
      >
        Skip to main content
      </a>
      {menu && (
        <button
          className="shell-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className="shell-sidebar" id="workspace-navigation">
        <div className="shell-brand">
          <span className="shell-brand-icon">
            <ChartNoAxesCombined size={23} />
          </span>
          <div>
            Programme &amp; Outreach<small>Centre intelligence</small>
          </div>
        </div>
        <button
          className="shell-collapse"
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed(!collapsed);
            try {
              window.localStorage.setItem(
                "glow.sidebar.collapsed",
                String(!collapsed),
              );
            } catch {
              /* Display preference is optional. */
            }
          }}
        >
          <ChevronLeft size={16} />
          <span>Collapse sidebar</span>
        </button>
        <nav aria-label="Main navigation">
          <p className="shell-nav-label">Workspace</p>
          {mainPages
            .filter(
              ([id]) =>
                staff.role !== "viewer" ||
                ![
                  "Client Engagement",
                  "Participation Patterns & Insights",
                ].includes(id),
            )
            .map(navItem)}
          <p className="shell-nav-label">Analysis</p>
          {analysisPages
            .filter(
              ([id]) => staff.role !== "viewer" || id === "Custom Analysis",
            )
            .map(navItem)}
          <button
            className="shell-nav-item"
            aria-label="Reports"
            title="Reports"
            onClick={() => openModal("export")}
          >
            <Download size={19} />
            <span>Reports</span>
          </button>
          <details
            className="shell-advanced"
            open={advancedPages.some(([id]) => id === page) || undefined}
          >
            <summary title="Additional analysis">
              <BarChart3 size={19} />
              <span>Additional analysis</span>
              <ChevronDown size={14} />
            </summary>
            {advancedPages
              .filter(
                ([id]) =>
                  staff.role !== "viewer" ||
                  ["Audience & Outreach", "Operations & Screening"].includes(
                    id,
                  ),
              )
              .map(navItem)}
          </details>
          <p className="shell-nav-label">Administration</p>
          {(staff.role === "admin" || staff.canCompare) &&
            navItem(["__centres", "Centre Administration", Building2])}
          {staff.role !== "viewer" &&
            navItem(["__config", "Dashboard Configuration", SlidersHorizontal])}
          {staff.role === "admin" &&
            navItem(["Data management", "Data Management", Database])}
          {staff.role !== "viewer" &&
            navItem(["__sync", "CaritaHub Sync", Activity])}
          <button
            className="shell-nav-item"
            title="Settings"
            aria-label="Settings"
            onClick={() => openModal("dashboard-settings")}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>
        </nav>
        <div className="shell-sidebar-footer">
          <ShieldCheck size={15} />
          <span>Centre-scoped staff analysis</span>
        </div>
      </aside>
      <div className="shell-workspace">
        <header className="shell-topbar platform-header">
          <button
            className="shell-menu-toggle"
            aria-expanded={menu}
            aria-controls="workspace-navigation"
            aria-label={menu ? "Close menu" : "Open menu"}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={20} /> : <Menu size={20} />}
          </button>
          <label className="shell-centre">
            <Building2 size={17} />
            <span className="sr-only">Centre</span>
            <select
              aria-label="Selected centre"
              value={centre?.id || ""}
              onChange={(e) => {
                const next = staff.centres.find(
                  (c) => c.id === e.target.value,
                )!;
                setCentreContext(next);
                setCentre(next);
                setMode("official");
                setPage("Overview");
                setMenu(false);
                api("/api/centres/preference", {
                  method: "PUT",
                  body: JSON.stringify({ centreId: next.id }),
                }).catch((e) => {
                  if (e.name !== "AbortError") setError(e.message);
                });
              }}
            >
              {staff.centres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="shell-period"
            title="Current dashboard reporting period"
          >
            <CalendarDays size={15} />
            <span>
              {period.from || "Available history"}
              <span className="period-separator"> – </span>
              {period.to || "Today"}
            </span>
          </div>
          {centre && staff.role !== "viewer" && (
            <label className="shell-reporting-mode">
              <span className="sr-only">Reporting mode</span>
              <select
                aria-label="Reporting mode"
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as typeof mode;
                  setReportingMode(next);
                  setMode(next);
                }}
              >
                <option value="official">Official reporting</option>
                <option value="exploratory">Exploratory analysis</option>
              </select>
            </label>
          )}
          <button
            className="button shell-export"
            onClick={() => openModal("export")}
          >
            <Download size={16} />
            <span>Export</span>
          </button>
          <details className="shell-account">
            <summary aria-label="Account menu">
              <span className="shell-avatar">
                {staff.username.slice(0, 2).toUpperCase()}
              </span>
              <ChevronDown size={13} />
            </summary>
            <div>
              <strong>{staff.username}</strong>
              <small>
                {staff.role === "admin"
                  ? "Administrator"
                  : staff.role === "planner"
                    ? "Planning staff"
                    : "Viewer"}
              </small>
              {centre && staff.role !== "viewer" && (
                <label className="account-reporting-mode">
                  Reporting mode
                  <select
                    aria-label="Reporting mode in account"
                    value={mode}
                    onChange={(e) => {
                      const next = e.target.value as typeof mode;
                      setReportingMode(next);
                      setMode(next);
                    }}
                  >
                    <option value="official">Official reporting</option>
                    <option value="exploratory">Exploratory analysis</option>
                  </select>
                </label>
              )}
              <button onClick={load}>Refresh centre access</button>
              {staff.username !== "Local workspace" && (
                <button
                  onClick={async () => {
                    await api("/api/logout", { method: "POST" });
                    load();
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          </details>
        </header>
        {error && (
          <p role="alert" className="error shell-error">
            {error}
          </p>
        )}
        <div id="workspace-content" className="workspace-content">
          <div className="mobile-reporting-context">
            {mode === "official"
              ? "Official reporting"
              : "Exploratory analysis"}
            <span>Change mode in the account menu</span>
          </div>
          {page === "__centres" ? (
            <Suspense
              fallback={
                <div className="page-skeleton" role="status">
                  Loading centre administration…
                </div>
              }
            >
              <CentreTools staff={staff} onChanged={load} />
            </Suspense>
          ) : administrative && centre ? (
            <Suspense
              fallback={
                <div className="page-skeleton" role="status">
                  Loading configuration…
                </div>
              }
            >
              <ConfigurationCentre
                key={centre.id + "-" + page}
                centre={centre}
                centres={staff.centres}
                user={staff}
                initialTab={page === "__sync" ? "sync" : "activities"}
                onChanged={() => {
                  setReportingMode(mode);
                  setRevision((n) => n + 1);
                }}
                onReturn={() => navigate("Overview")}
              />
            </Suspense>
          ) : centre ? (
            <div
              key={centre.id + "-" + mode + "-" + revision}
              className="centre-workspace"
            >
              <div className="selected-centre-name sr-only">{centre.name}</div>
              <App
                embedded
                initialUser={staff}
                page={page}
                onPage={setPage}
                command={command}
                initialDates={dates.current}
                onDates={rememberDates}
                onAuthChanged={load}
              />
            </div>
          ) : (
            <section className="panel">
              <h1>No centre access assigned</h1>
              <p>
                An administrator must assign centre access before attendance or
                client information can be loaded.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
