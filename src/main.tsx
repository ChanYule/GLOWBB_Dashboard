import {Button,Select,Note,Modal} from "./ui-primitives";

import {MAX_IMPORT_MB,MAX_IMPORT_ROWS} from '../shared/upload-limits.js';
import {STAFF_PAGES,staffPage} from "../shared/staff-workspace.js";
import {centreById} from '../shared/centres.js';
import {CentreImportReview} from './centre-import-review';
import {centreUrl} from "./api";
import {OutreachRulesFields} from "./outreach-rules-fields";
import {ProgrammeDiagnosticLabels} from './programme-diagnostic-ui';
import {AnalysisStamp} from './analysis-stamp';

import './analysis-quality.css';
import type {Briefing} from "./management";
import {activityDomains} from '../shared/activity-domains.js';
import {ImportProgress} from "./import-progress";
import {api,currentCentre,invalidateReadCache} from "./api";
import {reportingFilters} from "./view-config";
const ManagementHome=lazy(()=>import('./management').then(m=>({default:m.ManagementHome})));
import {useEffect,useRef,useState,lazy,Suspense} from "react";
import type {FormEvent} from "react";
import {Activity,ArrowDownToLine,ArrowRight,BarChart3,ChartNoAxesCombined,Check,ChevronRight,ClipboardList,Download,Database,Filter,HeartHandshake,LayoutDashboard,Menu,Plus,Search,ShieldCheck,Upload,Users,RefreshCw} from "lucide-react";
import type {Dashboard,Filters,Programme,Settings,User,Preview,Preferences} from "./types";
import "./styles.css";
import "./redesign.css";
import "./data-management.css";
import "./design-system.css";
const Overview=lazy(()=>import("./dashboard-pages").then(m=>({default:m.Overview})));
const Programmes=lazy(()=>import("./dashboard-pages").then(m=>({default:m.Programmes})));
const Audience=lazy(()=>import("./dashboard-pages").then(m=>({default:m.Audience})));
const Planning = lazy(() => import("./planning-page").then(m=>({default:m.Planning})));
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
const SppbAssessments = lazy(() => import('./sppb-ui').then(m => ({ default: m.SppbAssessments })));
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
const PresentationView = lazy(() =>
  import("./presentation").then((m) => ({ default: m.PresentationView })),
);
const EventTypeInsights=lazy(()=>import('./programme-domains-ui').then(m=>({default:m.ProgrammeDomainAnalysis})));
const OperationsPage = lazy(() =>
  import("./operations-ui").then((module) => ({
    default: module.OperationsPage,
  })),
);
import {TrendChart,ActiveFilters} from "./analytics-ui";
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
const LineChart = TrendChart;
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <HeartHandshake size={25} />
      </div>
      <span>
        Programme<span className="brand-dot">.</span>
        <small>&amp; Outreach</small>
      </span>
    </div>
  );
}
function App({initialDates,onDates,onAuthChanged,initialUser,embedded=false,page,onPage,command}:{initialDates?:Partial<Filters>;onDates?:(dates:Partial<Filters>)=>void;onAuthChanged?:()=>void;initialUser?:User;embedded?:boolean;page?:string;onPage?:(page:string)=>void;command?:{id:number;modal:string}}={}) {
  const initialDatesRef=useRef(initialDates);
  const [user, setUser] = useState<User | null>(initialUser||null),
    [authError, setAuthError] = useState(""),
    [needsLogin, setNeedsLogin] = useState(false);
  useEffect(() => {
    if(initialUser)return;
    api<User>("/api/me")
      .then(setUser)
      .catch((e) => {
        if (e.status === 401) setNeedsLogin(true);
        else setAuthError(e.message);
      });
  }, [initialUser]);
  const [presentationSnapshot, setPresentationSnapshot] = useState<{
    data: Dashboard;
    filters: Filters;
    briefing: Briefing;
  } | null>(null);
  const [planSearch, setPlanSearch] = useState("");
  const [patternsInitial, setPatternsInitial] = useState("");
  const [sppbSection, setSppbSection] = useState("Overview");
  const [programmeDetails,setProgrammeDetails]=useState(false);
  const [localTab, setLocalTab] = useState("Overview"),
    [filters, setFilters] = useState<Filters>({...emptyFilters,...initialDates}),
    [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState(""),
    [programme, setProgramme] = useState<Programme | null>(null),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState(""),
    [navigationOpen, setNavigationOpen] = useState(false);
  const tab=staffPage(page??localTab,user?.role);
  const setTab=(next:string)=>{const selected=staffPage(next,user?.role);if(onPage)onPage(selected);else setLocalTab(selected);};
  useEffect(()=>{if(tab!=='SPPB Assessments')setSppbSection('Overview');if(tab!=='Programme Performance')setProgrammeDetails(false);},[tab]);
  useEffect(()=>{if(command)setModal(command.modal);},[command]);
  const contextOnly = [
    "SPPB Assessments",
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
  useEffect(()=>{onDates?.({from:filters.from,to:filters.to,interval:filters.interval});},[filters.from,filters.to,filters.interval,onDates]);
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
        { signal: controller.signal, reuseForMs:15000 },
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
              onAuthChanged?.();
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
  }, [filters, revision, user, reportView,onAuthChanged]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    api<Preferences>("/api/preferences")
      .then((p) => {
        if (live && p.draft)
          setFilters({...reportingFilters(p.draft, emptyFilters),...initialDatesRef.current});
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
    invalidateReadCache();
    setRevision((n) => n + 1);
    setToast(message);
  };
  const pageIcons:Record<string,typeof Users>={Overview:LayoutDashboard,'Programme Performance':BarChart3,'Participation Patterns & Insights':ChartNoAxesCombined,'Client Engagement':Users,'Participant Needs & Accessibility':HeartHandshake,'SPPB Assessments':Activity};
  const primaryTabs=STAFF_PAGES.filter(item=>!item.staffOnly||user?.role!=='viewer').map(item=>({name:item.id,label:item.label,icon:pageIcons[item.id]}));
  const staffTabs=user?.role==='admin'?[{name:'Data management',label:'Import and manage data',icon:Database}]:[];
  const navItem = (t: { name: string; label?: string; icon: typeof Users }) => (
    <button
      key={t.name}
      className={tab === t.name ? "nav-item active" : "nav-item"}
      aria-current={tab === t.name ? "page" : undefined}
      onClick={() => {
        setTab(t.name);
        setPatternsInitial("");
        setSppbSection("Overview");
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
    "SPPB Assessments",
    "Participation Patterns & Insights",
    "Data management",
    "Client Engagement",
    "Participant Needs & Accessibility",
  ].includes(tab)
    ? tab === 'Participation Patterns & Insights' ? 'Participation Insights' : tab === "Client Engagement"
      ? "Client Engagement & Outreach"
      : tab
    : tab === "Overview"
      ? "Management Overview"
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
      <div className={`app${embedded ? " embedded-app" : ""}${navigationOpen ? " navigation-open" : ""}`}>
        {!embedded && <aside className="sidebar">
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
                staffTabs.some((t) => t.name === tab) ||
                undefined
              }
            >
              <summary>
                <Users size={19} />
                Data &amp; settings
                <ChevronRight size={16} />
              </summary>
              {staffTabs.map(navItem)}

              <button
                className="nav-item"
                onClick={() => {
                  setModal("export");
                  setNavigationOpen(false);
                }}
              >
                Download reports
              </button>
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
        </aside>}
        <div className="main-shell">
          {!embedded && <header className="topbar">
            <span>
              <span className="green-dot" /> Programme intelligence
            </span>
            <div>
              {user.username !== "Local workspace" && (
                <button
                  className="text-button"
                  onClick={async () => {
                    await api("/api/logout", { method: "POST" });
                    onAuthChanged?.();
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
          </header>}
          <main id="main">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  CENTRE INTELLIGENCE <span>/</span> PLANNING WITH PURPOSE
                </div>
                <h1>{title}</h1>
                <p className="muted">
                  {tab === "Participation Patterns & Insights"
                    ? "Understand who attends, how often they return and which programmes attract them."
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
                {!['Participation Patterns & Insights','SPPB Assessments','Client Engagement'].includes(tab)&&<Button
                  disabled={loading}
                  onClick={() =>
                    refresh("Dashboard refreshed from saved records.")
                  }
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>}
                {!embedded&&![
                  "Overview",
                  "Data management",
                  "SPPB Assessments",
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
                    "SPPB Assessments",
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
              "SPPB Assessments",
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
              "SPPB Assessments",
              "Client Engagement",
              "Participation Patterns & Insights",
            ].includes(tab) && (
              <ActiveFilters
                filters={filters}
                data={data}
                setFilters={setFilters}
              />
            )}
            {data && currentCentre() && !data.coverage.from && <section className="panel centre-empty"><h2>No programme attendance data has been imported for this centre.</h2><p>{currentCentre()!.name}. Registered-client participation rates require a verified centre client registry. Other centres and the unassigned legacy archive are excluded.</p>{user.role==='admin'&&<Button primary onClick={()=>setModal('import')}>Import centre attendance</Button>}</section>}
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
                {!['Data management','SPPB Assessments','Participation Patterns & Insights'].includes(tab) && <AnalysisStamp metadata={data.metadata} coverage={data.coverage} />}
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
                  ) : tab === "SPPB Assessments" ? (
                    <SppbAssessments user={user} initialSection={sppbSection} />
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
                      onSppb={() => { setSppbSection("Data quality & import"); setTab("SPPB Assessments"); }}
                      onChanged={refresh}
                    />
                  ) : tab === "Participant Needs & Accessibility" ? (
                    <NeedsExperience
                      filters={filters}
                      user={user}
                      onRefresh={() => refresh()}
                    />
                  ) : currentCentre() && !data.coverage.from && tab === "Overview" ? null : data.coverage.from === null &&
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
                    user.role==='viewer'?<Programmes data={data} onProgramme={setProgramme} user={user} filters={filters}/>:<><Suspense fallback={<p>Loading programme classifications…</p>}><EventTypeInsights user={user} revision={revision} initial={Object.fromEntries(Object.entries(filters).filter(([k])=>['from','to','domain','programme','gender','race','ageBand','cfs','client','boundary'].includes(k)))} onProgramme={id=>{const p=data.programmes.find(p=>p.id===id);if(p)setProgramme(p);}}/></Suspense><details className="panel" onToggle={e=>setProgrammeDetails(e.currentTarget.open)}><summary>Browse all programmes and detailed comparisons</summary>{programmeDetails&&<Suspense fallback={<p>Loading programme details...</p>}><Programmes data={data} onProgramme={setProgramme} user={user} filters={filters}/></Suspense>}</details></>
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
                Use the filters in each analysis page. Saved client views are
                available in Client Engagement.
              </p>
              <Button
                onClick={() => {
                  setModal("");
                  setTab("Client Engagement");
                }}
              >
                Open client view settings
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
                  href={centreUrl("/api/export/csv?" + new URLSearchParams(filters))}
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
                  href={centreUrl("/api/export/report?" + new URLSearchParams(filters))}
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
            user={user||undefined}
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
export function ProgrammeDialog({
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
        <span className="badge soft">{(p.combinedDomains??activityDomains(p.domain,p.eventTypes||(p.sessionList||[]).flatMap(s=>s.eventTypes||[]))).join(', ')}</span>
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
      <ProgrammeDiagnosticLabels diagnostics={p.diagnostics} audience="seniors" />
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
            <span>{(s.combinedDomains??activityDomains(s.sourceDomain??p.sourceDomain??p.domain,s.eventTypes)).join(', ')}</span>
          </div>
        ))}
      </div>
      <details><summary>Raw session classification audit</summary><p>Original imported labels are retained for review. Programme Domains above use only recognised labels and approved exact aliases.</p><div className="work-table"><table><thead><tr><th>Session date</th><th>Source AAP Domain</th><th>Source Event Type</th></tr></thead><tbody>{p.sessionList.map(s=><tr key={s.id}><td>{pretty(s.date)}</td><td>{s.sourceDomain??p.sourceDomain??'Not supplied'}</td><td>{s.sourceEventType??'Not supplied'}</td></tr>)}</tbody></table></div></details>
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
  const maxFileMb = MAX_IMPORT_MB;
  const [receipt,setReceipt]=useState<Record<string,{imported:number}>|null>(null);
  const [importProgress,setImportProgress]=useState<{centreId:string;processedRows:number;totalRows:number}|null>(null);
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [mode, setMode] = useState("merge"),
    [confirmation, setConfirmation] = useState("");
  const uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    uploadController.current?.abort();
    uploadController.current=new AbortController();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const file = form.get("file");
      if (
        file &&
        typeof file !== "string" &&
        file.size > maxFileMb * 1024 * 1024
      )
        throw Error(
          `Choose a file of ${maxFileMb} MB or less.`,
        );
      setPreview(
        await api<Preview>("/api/import/preview?mode=" + mode, {
          method: "POST",
          body: form,
          signal:uploadController.current.signal,
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
      let result:{pending?:boolean;centreId:string;processedRows:number;totalRows:number;centres?:Record<string,{imported:number}>};
      do{
        result=await api("/api/import/confirm",{method:"POST",body:JSON.stringify({id:preview!.id,confirmation,confirmed:true,...(preview!.centreCounts?{step:true}:{})})});
        if(result.pending)setImportProgress({centreId:result.centreId,processedRows:result.processedRows,totalRows:result.totalRows});
      }while(result.pending);
      setImportProgress(null);
      if(result.centres){setReceipt(result.centres);return;}
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function issuesCsv() {
    if (!preview) return;
    setBusy(true);setError("");
    try {
      const issues=[...preview.issues];
      if(preview.centreCounts && (preview.issueCount ?? issues.length)>issues.length){
        issues.length=0;let page=1,pages=1;
        do {const result=await api<{issues:Preview["issues"];pages:number}>("/api/centres/import/issues?"+new URLSearchParams({id:preview.id,page:String(page),revision:String(preview.classificationRevision)}));issues.push(...result.issues);pages=result.pages;page++;}while(page<=pages);
      }
      const csv="Row,Issue\r\n"+issues.map(i=>`${i.row},"${i.message.replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`).join("\r\n");
      const a=document.createElement("a"), url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.href=url;a.download="import-issues.csv";a.click();URL.revokeObjectURL(url);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const discard = () => {
    uploadController.current?.abort();
    if (preview)
      void api("/api/import/preview/" + preview.id, { method: "DELETE" }).catch(
        () => {},
      );
  };
  if(receipt)return <Modal title="Import receipt by centre" onClose={onDone}><h3>Attendance imported</h3>{Object.entries(receipt).map(([id,r])=><p key={id}>{centreById(id)?.name||id}: {r.imported} entries imported</p>)}<Button primary onClick={onDone}>Done and refresh selected centre</Button></Modal>;
  return (
    <Modal
      title={preview ? "Review attendance import" : "Import attendance"}
      onClose={() => {
        if(busy)return;
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
            {!currentCentre() && <option value="replace">
              Full Replacement ? attendance only, backup required
            </option>}
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
              Excel (.xlsx) or UTF-8 CSV · up to {maxFileMb} MB and up to {MAX_IMPORT_ROWS.toLocaleString("en-SG")}
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
              Name, AAP Domain, Activity Name/Event Type, Session Detail, Centres (or Centre)
            </p>
            <p>
              Headers in row 1 of exactly one worksheet. Session example:
              2026-05-04, 09:00 AM - 09:45 AM. Formula cells and legacy .xls
              files are not accepted.
            </p>
          </details>
          <Note>
            {currentCentre() ? 'Centres (or Centre) is required for automatic location classification. Unknown locations need a reviewed row override. Attendance does not establish client affiliation. ' : ''}
            Attendance is added only after you review and confirm. A temporary
            preview expires after 20 minutes. Raw Member IDs are hashed for
            matching. Temporary import source data expires after 20 minutes.
          </Note>
          <Button primary type="submit" disabled={busy}>
            {busy ? "Validating file…" : "Preview import"}
            <ArrowRight size={16} />
          </Button>
        </form>
      ) : (
        <>
          <div className="import-counts">
            {(preview.centreCounts?[
              ['Total records',preview.rawRows],['Will insert',preview.ready],['Duplicates - skipped',preview.duplicates],['Invalid rows',preview.invalid],['Conflicts - skipped',preview.skipped],['Profile updates',preview.updatedProfiles??0],['Session classification updates',preview.updatedSessions??0],['Rows flagged',preview.flaggedRows??preview.invalid],
            ]:[
              ["Raw rows", preview.rawRows],
              ["Existing matches", preview.matched ?? 0],
              ["Profile updates", preview.updatedProfiles ?? 0],
              ["Session classification updates", preview.updatedSessions ?? 0],
              ["Missing values", preview.missing ?? 0],
              ["Resulting attendance", preview.resultingAttendance ?? 0],
              ["Resulting profiles", preview.resultingParticipants ?? 0],
              ["Ready to import", preview.ready],
              ["Duplicates", preview.duplicates],
              ["Invalid", preview.invalid],
              ["Conflicts · skipped", preview.skipped],
            ]).map(([k, v]) => (
              <div key={k}>
                <strong>{v}</strong>
                <span>{k}</span>
              </div>
            ))}
          </div>
          <CentreImportReview preview={preview} onReviewed={p=>{setPreview(p);setConsent(false);}}/>
          <Note>
            Attendance identity uses Member ID, exact trimmed programme name,
            date and both session times. Separate sessions on the same day
            remain separate. Existing member details and programme domains are
            retained in Add mode. Merge updates reviewed nonblank profile fields
            and preserves blank incoming values; programme-domain conflicts
            remain skipped. Future sessions are stored but excluded from
            delivered attendance until their date.
            {' '}Merge also applies the previewed session classification changes. Older or blank Event Types never erase existing classifications.
          </Note>
          {!!preview.sessionChanges?.length&&<details><summary>Review session classification changes · {preview.updatedSessions}</summary><div className="work-table"><table><thead><tr><th>Programme / date</th><th>Existing source</th><th>Incoming source</th></tr></thead><tbody>{preview.sessionChanges.map((s,i)=><tr key={i}><th>{s.programme} · {s.date}</th><td>{s.before}</td><td>{s.after}</td></tr>)}</tbody></table></div><p>Up to 100 changes shown; all proposed session updates are counted above.</p></details>}
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
              Validation report · {preview.issueCount ?? preview.issues.length} issues & warnings
            </summary>
            <Button disabled={busy} onClick={issuesCsv}>
              <Download size={16} />
              Download row issues
            </Button>
            <div className="issue-list">
              {preview.issues.slice(0, 100).map((i, n) => (
                <p key={n}>
                  <b>Row {i.row}:</b> {i.message}
                </p>
              ))}
              {(preview.issueCount ?? preview.issues.length) > 100 && (
                <p>Download the full report for remaining issues.</p>
              )}
              {!preview.issues.length && (
                <p>No invalid rows or demographic warnings detected.</p>
              )}
            </div>
          </details>
          {!preview.centreCounts&&<><h3>Preview · first {preview.preview.length} valid rows</h3>
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
          </div></>}
          {!!Object.keys(preview.expectedReference).length&&<details>
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
          </details>}
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
              I reviewed the preview, mode, profile updates, session classifications and issue report.
              Apply the displayed changes; skip invalid rows and unresolved
              programme conflicts.
            </span>
          </label>
          {importProgress && <p role="status">{busy ? 'Saving' : 'Saved progress for'} {centreById(importProgress.centreId)?.name || 'selected centre'}: {importProgress.processedRows.toLocaleString('en-SG')} of {importProgress.totalRows.toLocaleString('en-SG')} source rows processed. Completed batches stay saved. If interrupted, retry this same preview to resume.</p>}
          {preview.centreCounts && <p>Large imports save in batches of up to 2,000 source rows. Keep this window open until the final centre receipt appears.</p>}
          <div className="modal-actions">
            <Button
              disabled={busy}
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
                !consent || !!preview.unclassified || !!preview.deniedCentres?.length ||
                (!preview.ready && !preview.updatedProfiles && !preview.updatedSessions) ||
                (mode === "replace" && confirmation !== "REPLACE ATTENDANCE")
              }
              onClick={confirm}
            >
              {busy
                ? "Saving…"
                : importProgress ? "Resume remaining import batches" : `Confirm ${preview.ready} entries, ${preview.updatedProfiles || 0} profile and ${preview.updatedSessions || 0} session updates`}
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
