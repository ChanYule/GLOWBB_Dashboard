import { MeetingLayouts, meetingPeriod } from "./meeting-layouts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, currentCentre } from "./api";
import { PresentationFrame } from "./presentation";
import { DisplaySettings } from "./display-settings";
import { HorizontalRankingChart, MetricCard } from "./chart-system";
import type { Briefing } from "./management";
import { TrendChart } from "./analytics-ui";
import type { Dashboard, Filters } from "./types";
import type { EventReport } from "./event-types-ui";

const sections = [
  "Centre performance",
  "Participation trends",
  "Programme domains",
  "Programme rankings",
  "Participant demographics",
  "Client engagement",
  "Participant needs",
  "Planning findings",
];
const measures = ["programmes", "sessions", "unique", "attendance"] as const;
const labels = {
  programmes: "Programmes",
  sessions: "Delivered sessions",
  unique: "Unique seniors",
  attendance: "Attendance entries",
};
const layoutKey = "glow.display.seen_nanyang.meeting";

export function SeenPresentation({
  filters,
  close,
}: {
  filters: Filters;
  close: () => void;
}) {
  const [order, setOrder] = useState(sections.map((_, i) => i));
  const [dates, setDates] = useState({ from: filters.from, to: filters.to });
  const [printAll, setPrintAll] = useState(false);
  const [section, setSection] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(layoutKey));
      return sections[saved] ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [snapshot, setSnapshot] = useState<{
    revision: string | null;
    overview: Dashboard;
    domains: EventReport;
    briefing: Briefing;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(true);
  const data = snapshot?.overview,
    domains = snapshot?.domains,
    briefing = snapshot?.briefing;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const onClose = useCallback(() => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    closeRef.current();
  }, []);
  const toggleFullscreen = useCallback(() => {
    const element = root.current?.closest(".presentation");
    if (document.fullscreenElement) {
      void document
        .exitFullscreen()
        .catch(() => setNotice("Could not exit full screen."));
      return;
    }
    if (element?.requestFullscreen)
      void element
        .requestFullscreen()
        .catch(() => setNotice("Full screen is unavailable in this browser."));
    else setNotice("Full screen is unavailable in this browser.");
  }, []);
  const query = new URLSearchParams({
    from: dates.from,
    to: dates.to,
  }).toString();
  useEffect(() => {
    if (currentCentre()?.id !== "seen_nanyang") return;
    const abort = new AbortController();
    setPending(true);
    setError("");
    api<typeof snapshot>("/api/reporting/meeting?" + query, {
      signal: abort.signal,
    })
      .then((result) => {
        if (!abort.signal.aborted) setSnapshot(result);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setPending(false);
      });
    return () => abort.abort();
  }, [query, refresh]);
  const [newData, setNewData] = useState(false);
  const meetingRevision = snapshot?.revision;
  useEffect(() => {
    setNewData(false);
    if (!meetingRevision || currentCentre()?.id !== "seen_nanyang") return;
    const controller = new AbortController();
    const check = () => {
      if (document.visibilityState !== "visible") return;
      api<{ revision: string | null }>("/api/reporting/meeting-status", {
        signal: controller.signal,
      })
        .then((result) => {
          if (
            !controller.signal.aborted &&
            result.revision &&
            result.revision !== meetingRevision
          )
            setNewData(true);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [meetingRevision]);
  const changeSection = useCallback(
    (offset: number) => {
      setSection(
        (current) =>
          order[
            Math.min(
              order.length - 1,
              Math.max(0, order.indexOf(current) + offset),
            )
          ],
      );
    },
    [order],
  );
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("select,input,textarea,.expanded-dashboard-chart")
      )
        return;
      if (
        event.key.toLowerCase() === "f" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      )
        toggleFullscreen();
      if (event.key === "ArrowRight") changeSection(1);
      if (event.key === "Home") setSection(order[0]);
      if (event.key === "End") setSection(order.at(-1)!);
      if (event.key === "ArrowLeft") changeSection(-1);
    };
    document.addEventListener("keydown", navigate);
    return () => document.removeEventListener("keydown", navigate);
  }, [order, changeSection, toggleFullscreen]);
  if (currentCentre()?.id !== "seen_nanyang") return null;
  return (
    <PresentationFrame
      title="SEEN Nanyang meeting presentation"
      close={onClose}
      printReady={Boolean(snapshot && !pending && !error)}
    >
      <div ref={root} className="seen-presentation">
        <div className="seen-meeting-controls">
          <button className="button" onClick={toggleFullscreen}>
            Full screen
          </button>
          {pending && <span role="status">Preparing meeting figures...</span>}
          <label>
            Section{" "}
            <select
              value={section}
              onChange={(e) => {
                setSection(Number(e.target.value));
              }}
            >
              {order.map((i) => (
                <option key={i} value={i}>
                  {sections[i]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            disabled={section === order[0]}
            onClick={() => {
              changeSection(-1);
            }}
          >
            Previous
          </button>
          <button
            className="button"
            disabled={section === order.at(-1)}
            onClick={() => {
              changeSection(1);
            }}
          >
            Next
          </button>
          <span>
            Section {order.indexOf(section) + 1} of {order.length}
          </span>
          <details className="meeting-tools">
            <summary>Presentation tools</summary>
            <div className="work-actions">
              <DisplaySettings />
              <button
                className="button"
                disabled={!snapshot || pending || Boolean(error)}
                onClick={() => {
                  setPrintAll(true);
                }}
              >
                Prepare selected sections for PDF
              </button>
              <button
                className="button"
                disabled={pending}
                onClick={() => setRefresh((value) => value + 1)}
              >
                Refresh presentation
              </button>
              <button
                className="button"
                onClick={() => {
                  try {
                    window.localStorage.setItem(layoutKey, String(section));
                    setNotice("Opening section saved.");
                  } catch {
                    setNotice("This browser did not save the opening section.");
                  }
                }}
              >
                Save opening section
              </button>
            </div>
          </details>
          {notice && <span role="status">{notice}</span>}
          {newData && (
            <span role="status">
              New data is available. Refresh when ready.
            </span>
          )}
        </div>
        <MeetingLayouts
          sections={sections}
          onOpen={(layout) => {
            const today = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Singapore",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date());
            setOrder(layout.sections);
            setSection(layout.sections[0]);
            setPrintAll(false);
            setDates(
              meetingPeriod(
                layout.period,
                { from: filters.from, to: filters.to },
                today,
              ),
            );
          }}
        />
        {printAll && (
          <div className="seen-meeting-controls">
            <button className="button" onClick={() => setPrintAll(false)}>
              Return to single section
            </button>
            <span>
              Use Print / Save as PDF to export the selected sections below.
            </span>
          </div>
        )}
        {error ? (
          <p role="alert">{error}</p>
        ) : !data || !domains ? (
          <p role="status">Loading meeting figures…</p>
        ) : (
          (printAll ? order : [section]).map((section) => (
            <section className="report-slide" key={section}>
              <h1>{sections[section]}</h1>
              <p>
                SEEN Nanyang ·{" "}
                {data.period.from || data.coverage.from || "Available history"}{" "}
                to {data.period.to}
              </p>
              <p>
                Data updated:{" "}
                {data.metadata?.lastUpdatedAt
                  ? new Date(data.metadata.lastUpdatedAt).toLocaleString(
                      "en-SG",
                      { timeZone: "Asia/Singapore" },
                    )
                  : "Unavailable"}{" "}
                / {data.metadata?.reporting?.label} / Configuration{" "}
                {data.metadata?.reporting?.version}
              </p>
              {section === 0 && (
                <div className="seen-chart-grid">
                  {measures.map((metric) => (
                    <MetricCard
                      key={metric}
                      label={labels[metric]}
                      value={data.summary[metric].toLocaleString("en-SG")}
                      note={
                        data.previous
                          ? `Previous ${data.previous.from} to ${data.previous.to}: ${data.previous[metric].toLocaleString("en-SG")} (${(data.summary[metric] - data.previous[metric]).toLocaleString("en-SG", { signDisplay: "always" })})`
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
              {section === 1 && (
                <div className="seen-chart-grid">
                  {(["unique", "attendance", "male", "minority"] as const).map(
                    (metric) => (
                      <article className="domain-comparison-chart" key={metric}>
                        <h2>
                          {
                            {
                              unique: "Unique seniors",
                              attendance: "Attendance entries",
                              male: "Male seniors",
                              minority: "Minority seniors",
                            }[metric]
                          }
                        </h2>
                        {data.trends.some((row) => row[metric] == null) ? (
                          <p>Trend withheld for this selection.</p>
                        ) : (
                          <TrendChart rows={data.trends} metric={metric} />
                        )}
                      </article>
                    ),
                  )}
                </div>
              )}
              {section === 2 && (
                <>
                  <div className="seen-chart-grid">
                    {measures.map((metric) => (
                      <article key={metric} className="domain-comparison-chart">
                        <h2>{labels[metric]}</h2>
                        <HorizontalRankingChart
                          chartId={"domain." + metric}
                          allowDownload
                          label={labels[metric]}
                          denominator={domains.total[metric]}
                          hideOverride
                          rows={domains.domains.map((row) => ({
                            label: row.label,
                            value:
                              row.unique != null &&
                              row.unique >= Math.max(5, domains.minimum)
                                ? row[metric]
                                : null,
                          }))}
                        />
                      </article>
                    ))}
                  </div>
                  <p>
                    Domains can overlap. Each percentage uses the exact overall
                    total for the same measure.
                  </p>
                </>
              )}
              {section === 3 && (
                <HorizontalRankingChart
                  chartId="seen-programme-ranking"
                  allowDownload
                  label="Unique seniors by programme"
                  denominator={data.summary.unique}
                  hideOverride
                  rows={data.programmes.slice(0, 10).map((row) => ({
                    label: row.name,
                    value:
                      row.unique >= Math.max(5, data.settings.privacyMinimum)
                        ? row.unique
                        : null,
                  }))}
                />
              )}
              {section === 4 && (
                <div className="seen-chart-grid">
                  {(
                    [
                      ["Male seniors", "male", "knownGender"],
                      ["Minority seniors", "minority", "knownRace"],
                    ] as const
                  ).map(([label, key, denominator]) => {
                    const amount = data.summary[key],
                      total = data.summary[denominator];
                    const minimum = Math.max(5, data.settings.privacyMinimum);
                    return (
                      <article className="domain-comparison-chart" key={key}>
                        <h2>{label}</h2>
                        <HorizontalRankingChart
                          label={label}
                          chartId={"seen-demographics." + key}
                          denominator={total >= minimum ? total : null}
                          hideOverride
                          rows={[
                            {
                              label,
                              value:
                                amount >= minimum && total - amount >= minimum
                                  ? amount
                                  : null,
                            },
                          ]}
                        />
                        <p>
                          Percentage uses the seniors with a known{" "}
                          {key === "male" ? "gender" : "race"}.
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
              {(section === 5 || section === 6) &&
                (section === 5 ? (
                  <p>
                    {briefing?.clients?.available
                      ? `${briefing?.clients.summary.registered?.toLocaleString("en-SG") ?? "Unavailable"} registered clients in the selected population.`
                      : "A verified registry is required for a client participation rate."}
                  </p>
                ) : (
                  <p>
                    {briefing?.needs?.respondents == null
                      ? "Respondent counts are unavailable for this selection."
                      : `${briefing?.needs.respondents.toLocaleString("en-SG")} participants reported needs or preferences.`}
                  </p>
                ))}
              {section === 7 && (
                <ul>
                  {domains.findings.slice(0, 4).map((finding, i) => (
                    <li key={i}>
                      <strong>{finding.finding}</strong>
                      <p>{finding.evidence}</p>
                      <p>{finding.action}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </PresentationFrame>
  );
}
