import { useEffect } from "react";
import { AnalysisStamp } from "./analysis-stamp";
import {currentCentre} from './api';
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Cards, Coverage, ReportBars, useBriefing } from "./management";
import { TrendChart } from "./analytics-ui";
import type { Briefing } from "./management";
import type { Dashboard, Filters } from "./types";
const fmt = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
function usePresentation(close: () => void) {
  useEffect(() => {
    const old = document.title;
    document.title = (currentCentre()?.name || "Programme & Outreach Dashboard") + " / Management report";
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("presenting");
    const previousFocus = document.activeElement as HTMLElement | null;
    const underlying = [
      ...document.querySelectorAll<HTMLElement>(".sidebar, .main-shell"),
    ];
    underlying.forEach((e) => (e.inert = true));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            ".presentation button:not(:disabled),.presentation a[href]",
          ),
        ].filter((e) => e.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.title = old;
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("presenting");
      underlying.forEach((e) => (e.inert = false));
      previousFocus?.focus();
      document.removeEventListener("keydown", key);
    };
  }, [close]);
}
export function PresentationFrame({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  usePresentation(close);
  useEffect(() => {
    document.body.classList.add("patterns-presenting");
    return () => document.body.classList.remove("patterns-presenting");
  }, []);
  return createPortal(
    <div
      className="presentation patterns-report"
      role="dialog"
      aria-modal="true"
      aria-label="Presentation View"
    >
      <div className="presentation-toolbar">
        <button className="button" autoFocus onClick={close}>
          Back to analysis
        </button>
        <strong>{title}</strong>
        <button className="button primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {currentCentre() && <p className="centre-report-scope">Centre: {currentCentre()!.name}</p>}
      {children}
    </div>,
    document.body,
  );
}
export function PresentationView({
  data,
  filters,
  revision,
  close,
  briefing,
}: {
  data: Dashboard;
  filters: Filters;
  revision: number;
  close: () => void;
  briefing?: Briefing;
}) {
  const fetchRegistry = !!briefing?.registryOmitted;
  const remote = useBriefing(filters, revision, !briefing || fetchRegistry);
  // Preserve the displayed outreach/needs/action snapshot. Registry coverage is
  // requested only when opening the report, rather than on the main dashboard.
  const value =
      fetchRegistry && briefing
        ? { ...briefing, clients: remote.value?.clients || null }
        : briefing || remote.value,
    error = !briefing || fetchRegistry ? remote.error : "",
    pending = !briefing || fetchRegistry ? remote.pending : false;
  usePresentation(close);
  const titles = [
    "Executive summary",
    "Client engagement",
    "Programme performance",
    "Needs and accessibility",
    "Planning and actions",
    "Follow-up plan",
    ...(value?.programmeMix?['Programme Mix and Engagement Types']:[]),
  ];
  const audience =
    ["gender", "race", "ageBand", "client", "boundary"].some(
      (k) => filters[k as keyof Filters],
    ) || filters.target !== "all";
  return (
    <div
      className="presentation"
      role="dialog"
      aria-modal="true"
      aria-label="Presentation View"
    >
      <div className="presentation-toolbar">
        <button className="button" autoFocus onClick={close}>
          Back to dashboard
        </button>
        <nav aria-label="Report sections">
          {titles.map((t, i) => (
            <a href={`#report-${i}`} key={t}>
              {i + 1}. {t}
            </a>
          ))}
        </nav>
        <button
          className="button primary"
          disabled={!value || pending || !!error || audience}
          onClick={() => window.print()}
        >
          Print / Save as PDF
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {audience ? (
        <p className="note">
          Reset audience filters before opening a shared presentation. This
          prevents small groups being inferred from filtered totals.
        </p>
      ) : (
        <>
          <section className="report-slide" id="report-0">
            <span className="eyebrow">
              PROGRAMME &amp; OUTREACH / MANAGEMENT REPORT
            </span>
            <h1>{titles[0]}</h1>{currentCentre() && <p className="centre-report-scope">Centre: {currentCentre()!.name}</p>}
            <p>
              {data.period.from || "Available history"} to {data.period.to} ·
              Generated {new Date().toLocaleDateString("en-SG")}
            </p>
            <AnalysisStamp metadata={data.metadata} coverage={data.coverage} />
            <Cards data={data} briefing={value} />
            <p>
              Attendance describes recorded participation. It does not establish
              programme impact or explain non-participation.
            </p>
          </section>
          <section className="report-slide" id="report-1">
            <h1>{titles[1]}</h1>
            <Coverage briefing={value} />
            <h2>Senior participation over time</h2>
            <TrendChart rows={data.trends} />
          </section>
          <section className="report-slide" id="report-2">
            <h1>{titles[2]}</h1>
            <p>
              {fmt(data.summary.sessions)} sessions ·{" "}
              {fmt(data.summary.programmes)} programmes ·{" "}
              {fmt(data.summary.average)} average attendance per session
            </p>
            <h2>Top five programmes by unique senior reach</h2>
            <ReportBars
              rows={[...data.programmes]
                .sort((a, b) => b.unique - a.unique)
                .slice(0, 5)
                .map((p) => ({
                  label: p.name,
                  value: p.unique,
                  detail: `${fmt(p.sessions)} sessions`,
                }))}
            />
          </section>
          <section className="report-slide" id="report-3">
            <h1>{titles[3]}</h1>
            <p>
              {fmt(value?.needs?.interests.denominator)} interest respondents;{" "}
              {fmt(value?.needs?.respondents)} people with any recorded
              response. Multiple interests may overlap.
            </p>
            {value?.needs?.interests && !value.needs.interests.suppressed ? (
              <ReportBars
                rows={value.needs.interests.values
                  .slice(0, 8)
                  .map((r) => ({ label: r.label, value: r.unique }))}
              />
            ) : (
              <p>
                Data required or withheld under privacy rules. Ask about
                preferences before planning.
              </p>
            )}
            <p>
              Verify language, venue access, seated options and mobility
              requirements with staff. Clinical profile codes do not establish
              programme eligibility.
            </p>
          </section>
          {value?.programmeMix&&<section className="report-slide" id="report-6"><h1>Programme Mix and Engagement Types</h1><h2>Primary AAP Domain distribution</h2><ReportBars rows={value.programmeMix.domains.map(d=>({label:d.label,value:d.sessions,detail:'delivered sessions'}))}/><h2>Selected secondary classifications</h2><p>{value.programmeMix.types.map(t=>`${t.label}: ${fmt(t.sessions)} sessions, ${fmt(t.unique)} unique seniors, ${fmt(t.repeat)} same-programme repeat`).join(' · ')}</p><p>{value.programmeMix.findings[0]?.action}</p><p>{value.programmeMix.note}</p></section>}
          <section className="report-slide" id="report-4">
            <h1>{titles[4]}</h1>
            <p>
              {fmt(value?.actions?.total)} recorded planning entries. Individual
              details and private notes are excluded.
            </p>
            <ReportBars
              rows={Object.entries(value?.actions?.stages || {}).map(
                ([label, n]) => ({ label, value: n }),
              )}
            />
            <h2>Configured outreach targets</h2>
            {data.targets.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Measure</th>
                    <th>Period</th>
                    <th>Current / target</th>
                  </tr>
                </thead>
                <tbody>
                  {data.targets.map((t) => (
                    <tr key={t.id}>
                      <td>{t.metric}</td>
                      <td>
                        {t.start} to {t.end}
                      </td>
                      <td>
                        {fmt(t.current)} / {fmt(t.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>
                No targets configured. Agree a target, owner and review date in
                Planning & Actions.
              </p>
            )}
          </section>
          <section className="report-slide" id="report-5">
            <h1>{titles[5]}</h1>
            <ol>
              <li>
                Review private client follow-up records and confirm contact
                preferences.
              </li>
              <li>
                Validate interests and accessibility requirements directly with
                participants.
              </li>
              <li>Agree owners and 3–6 month targets in the action tracker.</li>
              <li>
                Review progress at the next reporting period using the same
                definitions.
              </li>
            </ol>
            <p>
              Coverage: {data.coverage.from || "No attendance"} to{" "}
              {data.coverage.to || "No attendance"}. Profiles reflect latest
              recorded information. Missing responses do not mean no needs.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
