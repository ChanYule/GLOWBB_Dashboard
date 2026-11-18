import { TrendChart as LineChart } from "./analytics-ui";
const ProgrammeCompare = lazy(() =>
  import("./workspace").then((m) => ({ default: m.ProgrammeCompare })),
);
const ProgrammeGroupDiagnostics = lazy(() =>
  import("./programme-group-diagnostics").then((m) => ({
    default: m.ProgrammeGroupDiagnostics,
  })),
);
import { Button, Select, Panel, Note, Bars } from "./ui-primitives";
import { HorizontalRankingChart, ChartCard } from "./chart-system";
import { ProgrammeDiagnosticLabels } from "./programme-diagnostic-ui";
import { MetricHelp } from "./metric-help";
import { activityDomains } from "../shared/activity-domains.js";
import { api } from "./api";
import { metrics } from "./view-config";
import { DomainPortfolio } from "./management";
import { useEffect, useState, Suspense, lazy } from "react";
import { ArrowRight, Search, Users } from "lucide-react";
import type { Dashboard, Filters, Programme, Stats, User } from "./types";
import {
  KpiDeck,
  InsightCards,
  Portfolio,
  DemographicBars,
  TimingMatrix,
} from "./analytics-ui";
const number = (x: number) =>
  new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(x);
const pct = (x: number | null) =>
  x === null ? "Not available" : `${number(x)}%`;
function Kpis({ data }: { data: Dashboard }) {
  return <KpiDeck data={data} />;
}
export function Overview({
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
export function Programmes({
  data,
  onProgramme,
  user,
  filters,
}: {
  data: Dashboard;
  onProgramme: (p: Programme) => void;
  user?: User;
  filters?: Filters;
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
    [groupDiagnosticsOpen, setGroupDiagnosticsOpen] = useState(false),
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
      <ChartCard
        title="Which programmes lead on the selected measure?"
        description="Top five programmes; compare session frequency before deciding what to expand."
        toolbar={
          <label>
            Ranking metric
            <select
              aria-label="Top programme ranking metric"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as typeof sort);
                setPage(0);
              }}
            >
              <option value="unique">Unique seniors</option>
              <option value="attendance">Attendance entries</option>
              <option value="repeat">Repeat participants</option>
              <option value="average">Average attendance per session</option>
            </select>
          </label>
        }
      >
        <HorizontalRankingChart
          rows={[...list]
            .sort((a, b) => Number(b[sort]) - Number(a[sort]))
            .slice(0, 5)
            .map((p) => ({
              label: p.name,
              value: Number(p[sort]),
              detail: `${number(p.sessions)} sessions; ${number(p.unique)} distinct seniors`,
            }))}
          onSelect={(name) => {
            const p = data.programmes.find((p) => p.name === name);
            if (p) onProgramme(p);
          }}
        />
      </ChartCard>
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
                <th scope="col">Programme diagnostics</th>
                {columns
                  .filter((k) => metrics[k])
                  .map((k) => (
                    <th scope="col" key={k}>
                      {metrics[k][0]}
                      <MetricHelp
                        label={metrics[k][0]}
                        definition={
                          metrics[k][1] +
                          " Selected reporting period and filters apply."
                        }
                      />
                    </th>
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
                      <ul
                        className="programme-domains"
                        aria-label="Programme domains"
                      >
                        {activityDomains(
                          p.domain,
                          p.eventTypes ||
                            (p.sessionList || []).flatMap(
                              (s) => s.eventTypes || [],
                            ),
                        ).map((domain) => (
                          <li key={domain}>{domain}</li>
                        ))}
                      </ul>
                    </th>
                    <td>
                      <small>
                        {p.unique} unique seniors · {p.sessions} sessions ·{" "}
                        {p.attendance} entries (all ages)
                      </small>
                      <ProgrammeDiagnosticLabels
                        diagnostics={p.diagnostics}
                        audience="seniors"
                      />
                    </td>
                    {columns
                      .filter((k) => metrics[k])
                      .map((k) => (
                        <td key={k}>
                          {p[k as keyof Stats] == null
                            ? "Unavailable"
                            : number(Number(p[k as keyof Stats]))}
                        </td>
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
      {user && ["admin", "planner"].includes(user.role) && (
        <details
          className="panel"
          onToggle={(e) => setGroupDiagnosticsOpen(e.currentTarget.open)}
        >
          <summary>Compare programme reach by participant group</summary>
          {groupDiagnosticsOpen && (
            <Suspense fallback={<p>Loading programme group diagnostics…</p>}>
              <ProgrammeGroupDiagnostics
                user={user}
                from={filters?.from || data.period.from || ""}
                to={filters?.to || data.period.to || ""}
                domain={filters?.domain || ""}
                revision={
                  data.metadata?.lastUpdatedAt ||
                  data.metadata?.generatedAt ||
                  String(data.summary.attendance)
                }
              />
            </Suspense>
          )}
        </details>
      )}
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
export function Audience({
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
