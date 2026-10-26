import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Filter,
  HeartHandshake,
  Info,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Target,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  Dashboard,
  Filters,
  Programme,
  Recommendation,
  Settings,
  Stats,
  Trend,
  User,
  Count,
  Preview,
  Decision,
} from "./types";
import "./styles.css";
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
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await res.json();
  if (res.status === 401 && url !== "/api/login")
    document.dispatchEvent(new Event("staff-session-expired"));
  if (!res.ok) throw Error(data.error || "Unable to complete request.");
  return data;
}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
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
}: {
  items: Count[];
  unit?: string;
  color?: string;
}) {
  const max = Math.max(...items.map((x) => x.value), 1);
  return items.length ? (
    <div className="bars">
      {items.map((x, i) => (
        <div className="bar-row" key={x.label}>
          <div className="bar-caption">
            <span>{x.label}</span>
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
function LineChart({
  rows,
  metric = "unique",
}: {
  rows: Trend[];
  metric?: "unique" | "male" | "minority" | "attendance";
}) {
  const [active, setActive] = useState<Trend | null>(null);
  const max = Math.max(...rows.map((r) => r[metric]), 1),
    w = 680,
    h = 210,
    pad = 35;
  const x = (i: number) =>
      pad + (i * (w - pad * 2)) / Math.max(rows.length - 1, 1),
    y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  return rows.length ? (
    <div className="line-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${metric} participation over time. Exact figures are available in the table below.`}
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1={pad}
              x2={w - pad}
              y1={y(v * max)}
              y2={y(v * max)}
              stroke="#e1e9e9"
              strokeDasharray="4 4"
            />
            <text x="4" y={y(v * max) + 4} className="axis">
              {number(v * max)}
            </text>
          </g>
        ))}
        <polyline
          points={rows.map((r, i) => `${x(i)},${y(r[metric])}`).join(" ")}
          fill="none"
          stroke="#21877a"
          strokeWidth="3"
        />
        {rows.map((r, i) => (
          <g key={r.label}>
            <circle
              cx={x(i)}
              cy={y(r[metric])}
              r={r.partial ? 6 : 4}
              fill={r.partial ? "#fff" : "#21877a"}
              stroke="#21877a"
              strokeWidth="2"
            />
            <circle
              cx={x(i)}
              cy={y(r[metric])}
              r="15"
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${r.label}: ${r[metric]}${r.partial ? ", period in progress" : ""}`}
              onFocus={() => setActive(r)}
              onPointerEnter={() => setActive(r)}
              onClick={() => setActive(r)}
              onKeyDown={(e) => {
                if (["Enter", " "].includes(e.key)) setActive(r);
              }}
            />
            {(rows.length < 9 ||
              i % Math.ceil(rows.length / 6) === 0 ||
              i === rows.length - 1) && (
              <text x={x(i)} y={h - 8} textAnchor="middle" className="axis">
                {r.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-readout" aria-live="polite">
        {active
          ? `${active.label} · ${number(active[metric])} ${metric === "attendance" ? "attendance entries" : "unique seniors"}${active.partial ? " · period in progress" : ""}`
          : "Select a point to view its count. Hollow point = period in progress."}
      </div>
      <details>
        <summary>View chart figures</summary>
        <div className="trend-table">
          {rows.map((r) => (
            <div key={r.label}>
              <span>
                {r.label}
                {r.partial ? " · in progress" : ""}
              </span>
              <strong>{number(r[metric])}</strong>
            </div>
          ))}
        </div>
      </details>
    </div>
  ) : (
    <div className="chart-empty">
      Import attendance to see participation over time.
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
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
      className={wide ? "modal wide" : "modal"}
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
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<User>("/api/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(fd)),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-brand">
        <Brand />
        <span className="eyebrow">GLOW BUKIT BATOK</span>
        <h1>
          Better programmes.
          <br />
          Meaningful connections.
        </h1>
        <p>
          Understand participation, explore outreach opportunities and plan the
          next chapter.
        </p>
        <div className="login-art">
          <div>
            <Users size={38} />
            <span>
              People at the heart
              <br />
              of every programme.
            </span>
          </div>
        </div>
        <span className="muted">
          Programme impact & outreach · Staff workspace
        </span>
      </div>
      <main className="login-main">
        <form className="login-card" onSubmit={submit}>
          <div className="icon-tile">
            <ShieldCheck />
          </div>
          <h2>Welcome to your workspace</h2>
          <p className="muted">Sign in with your authorised staff account.</p>
          <label className="field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={200}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={512}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Button primary type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight size={18} />
          </Button>
          <Note>
            Access is restricted to staff. An administrator must configure your
            account before you can sign in.
          </Note>
        </form>
      </main>
    </div>
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
    [checked, setChecked] = useState(false),
    [tab, setTab] = useState("Overview"),
    [filters, setFilters] = useState<Filters>(emptyFilters),
    [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState(""),
    [programme, setProgramme] = useState<Programme | null>(null),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState("");
  useEffect(() => {
    const expire = () => {
      setUser(null);
      setData(null);
      setModal("");
      setProgramme(null);
    };
    document.addEventListener("staff-session-expired", expire);
    return () => document.removeEventListener("staff-session-expired", expire);
  }, []);
  useEffect(() => {
    api<User>("/api/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);
  useEffect(() => {
    if (!user) return;
    let live = true;
    setLoading(true);
    api<Dashboard>("/api/dashboard?" + new URLSearchParams(filters))
      .then((d) => {
        if (live) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setData(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user, filters, revision]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const refresh = (message = "Saved successfully.") => {
    setRevision((n) => n + 1);
    setToast(message);
  };
  if (!checked) return <div className="loading">Opening staff workspace…</div>;
  if (!user) return <Login onLogin={setUser} />;
  const tabs = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "Programme Performance", icon: BarChart3 },
    { name: "Audience & Outreach", icon: Users },
    { name: "Planning & Recommendations", icon: ClipboardList },
  ];
  const title =
    tab === "Overview"
      ? "Programme impact & outreach"
      : tab === "Programme Performance"
        ? "Programme performance"
        : tab === "Audience & Outreach"
          ? "Audience & outreach gaps"
          : "Programme planning recommendations";
  const sensitive =
    ["gender", "race", "ageBand", "client", "boundary"].some(
      (k) => filters[k as keyof Filters],
    ) || filters.target !== "all";
  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">STAFF WORKSPACE</div>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.name}
              className={tab === t.name ? "nav-item active" : "nav-item"}
              aria-current={tab === t.name ? "page" : undefined}
              onClick={() => setTab(t.name)}
            >
              <t.icon size={20} />
              <span>{t.name}</span>
              {tab === t.name && <ChevronRight size={16} />}
            </button>
          ))}
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
          {user.role === "admin" && (
            <button className="nav-item" onClick={() => setModal("settings")}>
              <Settings2 size={20} />
              Data & settings
            </button>
          )}
          <div className="staff">
            <div className="avatar">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{user.username}</strong>
              <small>{user.role}</small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={async () => {
                await api("/api/logout", { method: "POST" });
                setUser(null);
                setData(null);
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            <span className="green-dot" /> Programme intelligence
          </span>
          <div>
            <span className="restricted">
              <ShieldCheck size={15} /> Staff only
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
                {tab === "Overview"
                  ? "A clearer view of who we reach, and where we can go next."
                  : tab === "Programme Performance"
                    ? "Compare reach and engagement with the right context."
                    : tab === "Audience & Outreach"
                      ? "Explore participation patterns and opportunities to connect."
                      : "Turn observed participation into thoughtful plans for the next 3–6 months."}
              </p>
            </div>
            <div className="heading-actions">
              <Button onClick={() => setModal("export")}>
                <Download size={17} />
                Export report
              </Button>
              {user.role === "admin" && (
                <Button primary onClick={() => setModal("import")}>
                  <Upload size={17} />
                  Import attendance
                </Button>
              )}
            </div>
          </div>
          <FilterBar filters={filters} setFilters={setFilters} data={data} />
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
              Updating dashboard…
            </div>
          )}
          {data && (
            <div
              className={
                loading ? "dashboard-content updating" : "dashboard-content"
              }
              aria-busy={loading}
            >
              <div className="period-caption">
                <span>
                  <CalendarDays size={15} />
                  {pretty(data.period.from)} — {pretty(data.period.to)}
                </span>
                <span>Available records · Singapore time</span>
              </div>
              {data.coverage.from === null &&
              tab !== "Planning & Recommendations" ? (
                <div className="welcome panel">
                  <div className="icon-tile">
                    <ChartNoAxesCombined size={30} />
                  </div>
                  <span className="eyebrow">
                    YOUR NEXT CHAPTER STARTS WITH DATA
                  </span>
                  <h2>Make every connection count.</h2>
                  <p>
                    Bring your attendance records together to understand your
                    reach,
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
                      Ask an administrator to import the attendance workbook.
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
                    No sample statistics are shown. Your dashboard is calculated
                    from confirmed, saved attendance.
                  </Note>
                </div>
              ) : data.summary.attendance === 0 &&
                tab !== "Planning & Recommendations" ? (
                <div className="panel empty">
                  <Search size={28} />
                  <h2>No attendance matches this view</h2>
                  <p>Try a wider date range or reset your filters.</p>
                  <Button onClick={() => setFilters(emptyFilters)}>
                    Reset filters
                  </Button>
                </div>
              ) : tab === "Overview" ? (
                <Overview
                  data={data}
                  filters={filters}
                  setFilters={setFilters}
                  onProgramme={setProgramme}
                />
              ) : tab === "Programme Performance" ? (
                <Programmes data={data} onProgramme={setProgramme} />
              ) : tab === "Audience & Outreach" ? (
                <Audience data={data} />
              ) : (
                <Planning
                  data={data}
                  user={user}
                  refresh={refresh}
                  onTarget={() => setModal("target")}
                />
              )}
              {data.coverage.from !== null && (
                <footer className="data-footnote">
                  <ShieldCheck size={16} />
                  <p>
                    Measured within available records:{" "}
                    {pretty(data.coverage.from!)} – {pretty(data.coverage.to!)}.
                    Attendance shows participation; it does not establish
                    programme impact or causation. Unique counts must not be
                    added across programmes or periods.
                  </p>
                </footer>
              )}
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
            refresh("Import confirmed. Dashboard updated from saved records.");
          }}
        />
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
        <Modal title="Export a management report" onClose={() => setModal("")}>
          <p>
            Exports include the active period and programme/domain filters.
            Shared reports omit all demographic breakdowns, target-group counts
            and staff notes.
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
      {programme && data && (
        <ProgrammeDialog
          programme={programme}
          data={data}
          onClose={() => setProgramme(null)}
        />
      )}
    </div>
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
  return (
    <div className="filter-panel">
      <div className="filters">
        <Select label="Reporting period" value={preset} onChange={choose}>
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
        <Select
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
        </div>
      )}
    </div>
  );
}
function Kpis({ data }: { data: Dashboard }) {
  const items: {
    key: "unique" | "male" | "minority" | "attendance";
    title: string;
    description: string;
    percent?: string;
    icon: typeof Users;
  }[] = [
    {
      key: "unique",
      title: "Unique seniors reached",
      description: `Different participants aged ${data.settings.seniorAge}+`,
      icon: Users,
    },
    {
      key: "male",
      title: "Male seniors reached",
      description: `Of ${data.summary.knownGender} seniors with known gender`,
      percent: pct(data.summary.malePct),
      icon: Users,
    },
    {
      key: "minority",
      title: "Minority seniors reached",
      description: `Of ${data.summary.knownRace} seniors with known race`,
      percent: pct(data.summary.minorityPct),
      icon: HeartHandshake,
    },
    {
      key: "attendance",
      title: "Attendance entries",
      description: "Valid entries · all participant ages",
      icon: ClipboardList,
    },
  ];
  return (
    <div className="kpi-grid">
      {items.map((item, i) => {
        const prev = data.previous?.[item.key],
          value = data.summary[item.key];
        return (
          <section className={`kpi-card kpi-${i}`} key={item.key}>
            <div className="kpi-top">
              <span>{item.title}</span>
              <item.icon size={20} />
            </div>
            <div className="kpi-value">
              {number(value)}
              {item.percent && <span>{item.percent}</span>}
            </div>
            <p>{item.description}</p>
            <div className="kpi-change">
              {prev !== undefined ? (
                <>
                  <span className="change-value">
                    {value - prev >= 0 ? "+" : ""}
                    {number(value - prev)}
                  </span>{" "}
                  vs {pretty(data.previous!.from)}–{pretty(data.previous!.to)}
                </>
              ) : (
                <>No comparable previous period in available records</>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
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
  const [group, setGroup] = useState<"unique" | "male" | "minority">("unique"),
    [rank, setRank] = useState<"unique" | "male" | "minority">("unique");
  const top = [...data.programmes]
      .sort((a, b) => b[rank] - a[rank])
      .slice(0, 5),
    s = data.summary;
  const maleTop = [...data.programmes].sort((a, b) => b.male - a.male)[0],
    minorityTop = [...data.programmes].sort(
      (a, b) => b.minority - a.minority,
    )[0];
  const insights = [
    data.programmes[0] && {
      title: "Broadest programme reach",
      p: data.programmes[0],
      text: `${data.programmes[0].name} reached ${data.programmes[0].unique} different seniors across ${data.programmes[0].sessions} sessions.`,
      action: "Review interest, capacity and resources before another cycle.",
    },
    maleTop?.male > 0 && {
      title: "Connecting with male seniors",
      p: maleTop,
      text: `${maleTop.name} reached ${maleTop.male} male seniors (${pct(maleTop.malePct)} of known-gender senior participants).`,
      action: "Ask participants which parts of the format they value.",
    },
    minorityTop?.minority > 0 && {
      title: "Minority participation pattern",
      p: minorityTop,
      text: `${minorityTop.name} reached ${minorityTop.minority} minority seniors across ${minorityTop.sessions} sessions.`,
      action:
        minorityTop.minority < 5
          ? "Treat this small sample cautiously; gather more evidence."
          : "Discuss language preferences and interest before future outreach.",
    },
    data.programmes[0] && {
      title: "Returning engagement",
      p: data.programmes[0],
      text: `${s.repeat} of ${s.unique} seniors attended two or more distinct sessions in this view. Senior attendance frequency was ${number(s.frequency)} entries per person.`,
      action:
        "Ask occasional attendees what would support their return and compare recurring programme formats.",
    },
    data.programmes[0] && {
      title: "Demographic coverage matters",
      p: data.programmes[0],
      text: `${s.unknownRace} seniors have missing or UNKNOWN race; ${s.unknownGender} have unknown or other recorded gender. These people remain in overall reach.`,
      action:
        "Check missing information through your approved member records process before interpreting participation shares.",
    },
  ]
    .filter(Boolean)
    .slice(0, 4) as {
    title: string;
    p: Programme;
    text: string;
    action: string;
  }[];
  return (
    <>
      <Kpis data={data} />
      <div className="overview-grid">
        <Panel
          title="Outreach over time"
          subtitle="Different seniors in each period · counts are not additive"
          action={
            <span className="badge soft">
              <span className="green-dot" />
              Observed participation
            </span>
          }
        >
          <div className="chart-controls">
            <div className="segmented">
              {(["unique", "male", "minority"] as const).map((g) => (
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
                      : "Minority seniors"}
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
          <Bars items={top.map((p) => ({ label: p.name, value: p[rank] }))} />
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
            {data.domains
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
      <section className="insights-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FROM NUMBERS TO NEXT STEPS</span>
            <h2>What the Data Is Telling Us</h2>
          </div>
          <span className="badge soft">
            Transparent, attendance-led findings
          </span>
        </div>
        <div className="insight-grid">
          {insights.map((insight, i) => (
            <article className="insight-card" key={insight.title}>
              <span className="insight-number">0{i + 1}</span>
              <h3>{insight.title}</h3>
              <p>{insight.text}</p>
              <div className="suggestion">
                <strong>Suggested next step</strong>
                <p>{insight.action}</p>
              </div>
              <button
                className="text-button"
                onClick={() => onProgramme(insight.p)}
              >
                View programme
                <ArrowRight size={15} />
              </button>
            </article>
          ))}
        </div>
      </section>
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
          "unique" | "male" | "minority" | "sessions" | "repeat" | "average"
        >
      >("unique");
  const list = data.programmes
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name));
  return (
    <Panel
      title="A clearer picture of programme performance"
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
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div className="programme-table">
        <div className="programme-row table-header">
          <span>Programme / AAP domain</span>
          <span>Sessions</span>
          <span>Unique seniors</span>
          <span>Male reach</span>
          <span>Minority reach</span>
          <span />
        </div>
        {list.map((p) => (
          <button
            className="programme-row"
            key={p.id}
            onClick={() => onProgramme(p)}
          >
            <span className="programme-name">
              <strong>{p.name}</strong>
              <small>
                {p.domain} ·{" "}
                {p.sessions === 1
                  ? "One observed session"
                  : "Recurring in available records"}
              </small>
            </span>
            <span data-label="Sessions">{p.sessions}</span>
            <span data-label="Unique seniors">
              <b>{p.unique}</b>
            </span>
            <span data-label="Male reach">
              {p.male}
              <small>{pct(p.malePct)} of known gender</small>
            </span>
            <span data-label="Minority reach">
              {p.minority}
              <small>{pct(p.minorityPct)} of known race</small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <div className="empty">No programmes match your search.</div>
      )}
      <Note>
        One-time workshops and recurring activities have different delivery
        frequencies. Open a programme for attendance per session, engagement and
        evidence limitations.
      </Note>
    </Panel>
  );
}
function Audience({ data }: { data: Dashboard }) {
  const [metric, setMetric] = useState<"male" | "minority">("male");
  const max = Math.max(...data.timing.map((t) => t.unique), 1);
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
          <Bars items={data.gender} />
          <Note>
            Unknown and other recorded values are shown separately and excluded
            from the male percentage denominator.
          </Note>
        </Panel>
        <Panel
          title="Recorded race & minority outreach"
          subtitle={`Configured minority groups: ${data.settings.minority.join(", ")}`}
        >
          <Bars items={data.race} />
          <Note>
            Staff-only detail. Counts below five are small samples. All
            demographic breakdowns are omitted from shared reports.
          </Note>
        </Panel>
        <Panel
          title="Senior age groups"
          subtitle={`Age eligibility: ${data.settings.seniorAge}+`}
        >
          <Bars items={data.ages} />
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
          {data.summary.sessions >= data.settings.minSessions ? (
            <div className="timing-grid">
              {data.timing.map((t) => (
                <div
                  className="timing-cell"
                  key={t.label}
                  style={{
                    background: `rgba(33,135,122,${0.05 + (t.unique / max) * 0.13})`,
                  }}
                >
                  <b>{t.label}</b>
                  <strong>{t.unique} seniors</strong>
                  <small>
                    {t.sessions} sessions · {t.male} male · {t.minority}{" "}
                    minority
                  </small>
                  <small>
                    {t.sessions < data.settings.minSessions
                      ? "Limited session evidence"
                      : "Observed participation"}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <Note>
              At least {data.settings.minSessions} recorded sessions are needed
              for a timing comparison.
            </Note>
          )}
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
              Venue analysis <b>Not supplied</b>
            </span>
            <span>
              Living arrangements <b>Not supplied</b>
            </span>
            <span>
              Language & transport barriers <b>Not supplied</b>
            </span>
          </div>
          <Note>
            Optional fields are reserved in the data model. No assumptions are
            made about isolation, frailty or language from race, age or CFS.
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
}: {
  data: Dashboard;
  user: User;
  refresh: (s?: string) => void;
  onTarget: () => void;
}) {
  const [horizon, setHorizon] = useState("3"),
    [category, setCategory] = useState("All"),
    [edit, setEdit] = useState<Recommendation | null>(null);
  const canEdit = user.role !== "viewer";
  const list = data.recommendations.filter(
    (r) => category === "All" || r.category === category,
  );
  const gaps = data.targets.filter((t) => t.gap > 0);
  return (
    <>
      <Panel
        title="Your outreach goals"
        subtitle="Target progress uses each target’s own date range and programme scope, independently of dashboard filters."
        action={
          canEdit && (
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
                      data.options.programmes.find(
                        (p) => p.id === t.programme_id,
                      )?.name
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
                Set your own outreach targets. No organisational targets have
                been assumed.
              </p>
            </div>
            {canEdit && (
              <Button onClick={onTarget}>
                Set your first target
                <ArrowRight size={16} />
              </Button>
            )}
          </div>
        )}
      </Panel>
      <div className="planning-header">
        <div>
          <span className="eyebrow">EVIDENCE INTO ACTION</span>
          <h2>A thoughtful plan for the next {horizon} months</h2>
          <p className="muted">
            Staff decisions stay separate from observed attendance. No programme
            is automatically changed.
          </p>
        </div>
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
      </div>
      <div className="plan-timeline">
        {Array.from({ length: Number(horizon) }, (_, i) => {
          const now = sgToday(),
            d = new Date(
              Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) + i, 1),
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
        assumptions can be recorded in planning notes; no attendance or reach is
        projected.
      </Note>
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
      <div className="recommendation-list">
        {list.map((r) => {
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
                <p>{r.reason}</p>
                <p className="muted">
                  <strong>Next step:</strong> {r.next}
                </p>
                <details>
                  <summary>Evidence rules & limitations</summary>
                  <p>
                    {r.limitations} Sufficient evidence requires at least{" "}
                    {data.settings.minSessions} sessions and{" "}
                    {data.settings.minParticipants} unique seniors. Expand flags
                    reach of at least 25% of selected senior reach; Improve
                    flags a decline over 25% between two complete observed
                    months, each meeting the session threshold. Otherwise
                    sufficient-evidence programmes are Maintain. These rules are
                    prompts for review.
                  </p>
                </details>
                {decision?.notes && (
                  <p className="planning-notes">
                    Staff planning notes: {decision.notes}
                  </p>
                )}
                {canEdit && (
                  <button className="text-button" onClick={() => setEdit(r)}>
                    Update planning decision
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {(category === "All" || category === "Pilot") &&
          gaps.map((t) => (
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
}: {
  programme: Programme;
  data: Dashboard;
  onClose: () => void;
}) {
  const rec = data.recommendations.find((r) => r.id === p.id);
  return (
    <Modal title={p.name} onClose={onClose} wide>
      <div className="detail-intro">
        <span className="badge soft">{p.domain}</span>
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
          ["Delivered sessions", p.sessions],
          ["Attendance · all ages", p.attendance],
          ["Average attendance / session", number(p.average)],
          ["Repeat seniors · 2+ sessions", p.repeat],
          ["First observed in period", p.firstObserved],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <h3>Attendance trend · all ages</h3>
      <LineChart rows={p.trend} metric="attendance" />
      <h3>Recorded session timing</h3>
      <div className="session-list">
        {p.sessionList.map((s) => (
          <div key={s.id}>
            <span>{pretty(s.date)}</span>
            <span>
              {time(s.start)}–{time(s.end)} SGT
            </span>
            <span>{s.venue || "Venue not supplied"}</span>
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
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/decisions/" + r.id, {
        method: "PUT",
        body: JSON.stringify({ status, notes }),
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
          <span>Planning notes & resource assumptions</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder="Record the next action, capacity assumptions, staff hours or questions to check. Avoid participant information."
          />
        </label>
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
    [busy, setBusy] = useState(false);
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
        <div className="form-row">
          <label className="field">
            <span>Start date</span>
            <input name="start" type="date" defaultValue={sgToday()} required />
          </label>
          <label className="field">
            <span>End date</span>
            <input name="end" type="date" required />
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
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setPreview(
        await api<Preview>("/api/import/preview", {
          method: "POST",
          body: new FormData(e.currentTarget),
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
        body: JSON.stringify({ id: preview!.id }),
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
      {!preview ? (
        <form onSubmit={upload} className="form-stack">
          <div className="upload-area">
            <Upload size={32} />
            <h3>Bring your attendance records together</h3>
            <p>Excel (.xlsx) or UTF-8 CSV · maximum 8 MB and 50,000 rows</p>
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
              Name/Member ID, Gender, Name/Age, Name/Race, Name/CFS, Is Client,
              Within Boundary, Activity Name, AAP Domain, Session Detail
            </p>
            <p>
              Headers in row 1 of exactly one worksheet. Session example:
              2026-05-04, 09:00 AM - 09:45 AM. Formula cells and legacy .xls
              files are not accepted.
            </p>
          </details>
          <Note>
            Nothing is saved until you review and confirm. Raw Member IDs are
            hashed for stable matching and are not retained; the file itself is
            not stored.
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
            retained; conflicting rows are skipped. Future sessions are stored
            but excluded from delivered attendance until their date.
          </Note>
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I reviewed the preview and issue report. Import ready rows only;
              retain existing records and skip conflicts.
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
              disabled={busy || !consent || !preview.ready}
              onClick={confirm}
            >
              {busy ? "Saving…" : `Confirm ${preview.ready} attendance entries`}
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
function SettingsDialog({
  data,
  onClose,
  refresh,
}: {
  data: Dashboard;
  onClose: () => void;
  refresh: (s?: string) => void;
}) {
  const [s, setS] = useState<Settings>(data.settings),
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
    api<typeof quality>("/api/quality")
      .then(setQuality)
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button primary type="submit" disabled={busy}>
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
  Login,
};
