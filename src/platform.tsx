import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { Building2 } from "lucide-react";
import { App } from "./main";
import type { Filters, User } from "./types";
import { api, setCentreContext,setReportingMode } from "./api";
import type { Centre } from "../shared/centres.js";
import "./platform.css";
const CentreTools = lazy(() =>
  import("./centre-tools").then((m) => ({ default: m.CentreTools })),
);
const ConfigurationCentre=lazy(()=>import('./configuration-centre').then(m=>({default:m.ConfigurationCentre})));
type Staff = User & {
  id: number;
  centres: Centre[];
  preferredCentre: string | null;
  canCompare: boolean;
};
export function PlatformApp() {
  const [staff, setStaff] = useState<Staff | null>(null),
    [centre, setCentre] = useState<Centre | null>(null),
    [error, setError] = useState(""),
    [tools, setTools] = useState(false),[configuration,setConfiguration]=useState(false),[mode,setMode]=useState<'official'|'exploratory'>('official'),[dataRevision,setDataRevision]=useState(0);
  const dates = useRef<Partial<Filters> | undefined>(undefined),
    header = useRef<HTMLElement>(null);
  const rememberDates = useCallback((value: Partial<Filters>) => {
    dates.current = value;
  }, []);
  const load = useCallback(() => {
    setStaff(null);
    setCentre(null);
    setCentreContext(null);
    setMode('official');
    api<Staff>("/api/me")
      .then((value) => {
        const c =
          value.centres.find((c) => c.id === value.preferredCentre) ||
          value.centres[0] ||
          null;
        setCentreContext(c);
        setCentre(c);
        setStaff(value);
        setError("");
      })
      .catch((e) => {
        setError(e.message);
      });
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
    const el = header.current;
    if (!el) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--platform-header-height",
        el.getBoundingClientRect().height + "px",
      );
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [staff]);
  if (!staff)
    return (
      <main className="login-shell">
        <section className="panel">
          <h1>Programme &amp; Outreach Dashboard</h1>
          <p role={error ? "alert" : "status"}>
            {error || "Loading authorised centres…"}
          </p>
          {error && (
            <button className="button" onClick={load}>
              Retry staff workspace
            </button>
          )}
        </section>
      </main>
    );
  return (
    <>
      <header ref={header} className="platform-header">
        <div>
          <strong>Programme &amp; Outreach Dashboard</strong>
          <small>
            Centre Performance, Participation &amp; Programme Planning
          </small>
        </div>
        <label>
          <Building2 aria-hidden="true" size={20} /> Centre
          <select
            aria-label="Selected centre"
            value={centre?.id || ""}
            onChange={(e) => {
              const next = staff.centres.find((c) => c.id === e.target.value)!;
              setCentreContext(next);
              setCentre(next);
              setTools(false);
              setConfiguration(false);setMode('official');
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
        {(staff.role === "admin" || staff.canCompare) && (
          <button className="button" onClick={() => {setConfiguration(false);setTools((v) => !v);}}>
            {tools
              ? "Return to centre dashboard"
              : "Centre administration & comparisons"}
          </button>
        )}
        {centre&&staff.role!=='viewer'&&<><button className="button" onClick={()=>{setConfiguration(v=>!v);setTools(false);}}>Dashboard &amp; Data Configuration</button><label>Reporting mode<select aria-label="Reporting mode" value={mode} onChange={e=>{const value=e.target.value as 'official'|'exploratory';setReportingMode(value);setMode(value);}}><option value="official">Official reporting</option><option value="exploratory">Explore including excluded activities</option></select></label></>}
        <button className="text-button" onClick={load}>
          Refresh access
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {configuration&&centre?<Suspense fallback={<p>Loading configuration...</p>}><ConfigurationCentre key={centre.id} centre={centre} centres={staff.centres} user={staff} onChanged={()=>{setReportingMode(mode);setDataRevision(n=>n+1);}} onReturn={()=>setConfiguration(false)}/></Suspense>:tools ? (
        <Suspense fallback={<p>Loading centre tools…</p>}>
          <CentreTools staff={staff} onChanged={load} />
        </Suspense>
      ) : centre ? (
        <div key={centre.id+'-'+mode+'-'+dataRevision} className="centre-workspace">
          <div className="selected-centre-name">{centre.name}</div>
          <App
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
    </>
  );
}
