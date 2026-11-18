import { useEffect, useState } from "react";
import { api } from "./api";
import { NeedsPage, ProtectedDistribution } from "./needs-ui";
import type { NeedsReport } from "./needs-ui";
import { SocialRisk } from "./workspace";
import type { Filters, User } from "./types";

type Offering = {
  id: string;
  name: string;
  optional: { accessibility?: Record<string, string> };
};
export function NeedsExperience({
  filters,
  user,
  onRefresh,
}: {
  filters: Filters;
  user: User;
  onRefresh: () => void;
}) {
  const [report, setReport] = useState<NeedsReport | null>(null),
    [error, setError] = useState(""),
    [section, setSection] = useState("summary"),
    [profile, setProfile] = useState("ages"),
    [response, setResponse] = useState("interests");
  const [showAccess, setShowAccess] = useState(false),
    [offerings, setOfferings] = useState<Offering[]>([]),
    [accessSearch, setAccessSearch] = useState("");
  useEffect(() => {
    if (!showAccess || user.role === "viewer") return;
    const controller = new AbortController();
    api<Offering[]>("/api/needs/programmes", { signal: controller.signal })
      .then(setOfferings)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [showAccess, user.role]);
  const query = new URLSearchParams(filters).toString();
  useEffect(() => {
    if (user.role === "viewer") return;
    const controller = new AbortController();
    api<NeedsReport>("/api/needs/overview?" + query, {
      signal: controller.signal,
    })
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query, user.role]);
  if (user.role === "viewer")
    return (
      <p className="panel">
        Participant needs are available to authorised planning staff.
      </p>
    );
  const series = report
    ? profile === "ages"
      ? report.demographics.ages
      : report.profiles[profile as "cfs" | "living"]
    : null;
  const responses = report
    ? response === "languages"
      ? report.responses.preferences.languages
      : report.responses[
          response as "interests" | "needs" | "barriers" | "hypotheses"
        ]
    : null;
  return (
    <>
      <div className="section-tabs" role="group" aria-label="Needs workspaces">
        {[
          ["summary", "Needs summary"],
          ["profile", "Participant records"],
          ["gaps", "Participation barriers"],
          ["alignment", "Programme accessibility"],
        ].map(([key, label]) => (
          <button
            className={section === key ? "button primary" : "button"}
            aria-pressed={section === key}
            key={key}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {section !== "summary" ? (
        <NeedsPage
          level={section as "profile" | "gaps" | "alignment"}
          filters={filters}
          user={user}
          onRefresh={onRefresh}
        />
      ) : !report ? (
        <p role="status">Loading recorded needs…</p>
      ) : (
        <>
          <div className="needs-experience-grid">
          <section className="panel">
            <div className="report-section-heading">
              <h2>Participant profile</h2>
              <label>
                Profile measure
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="ages">Age</option>
                  <option value="cfs">CFS</option>
                  <option value="living">Living arrangement</option>
                  <option value="risk">Social risk</option>
                </select>
              </label>
            </div>
            {profile === "risk" ? (
              <SocialRisk user={user} />
            ) : (
              series && (
                <ProtectedDistribution
                  series={series}
                  title={profile==='cfs'?'Recorded CFS profile — programme participants':profile==='ages'&&series.population==='registry'?'Age profile — all registered clients':'Recorded profile distribution'}
                />
              )
            )}
            <p className="muted">
              Current recorded information. Missing
              information remains unknown.
            </p>
          </section>
          <section className="panel">
            <div className="report-section-heading">
              <h2>Reported interests and needs</h2>
              <label>
                Response measure
                <select
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                >
                  <option value="interests">Interests</option>
                  <option value="needs">Support needs</option>
                  <option value="barriers">Confirmed barriers</option>
                  <option value="hypotheses">Barriers to investigate</option>
                  <option value="languages">Languages</option>
                </select>
              </label>
            </div>
            <p>
              {report.responses.respondents == null
                ? "Respondent count withheld"
                : `${report.responses.respondents} recorded respondents`}{" "}
              · {report.responses.scope}
            </p>
            {responses && responses.values.length ? (
              <ProtectedDistribution
                series={responses}
                title="Recorded responses"
              />
            ) : (
              <p className="note">
                Data required. Record voluntary responses before drawing
                conclusions.
              </p>
            )}
            <p className="muted">{report.responses.note}</p>
          </section>
          </div>
          <section className="panel">
            <h2>Accessibility review</h2>
            <p>
              Compare stated needs with verified programme information. Missing
              metadata requires staff review.
            </p>
            <div className="work-table">
              <table>
                <thead>
                  <tr>
                    <th>Participant requirement</th>
                    <th>Programme information to verify</th>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Language preference", "Languages used"],
                    [
                      "Mobility or stamina support",
                      "Venue access and seated options",
                    ],
                    ["Preferred timing", "Session dates and times"],
                    ["Reported interests", "Staff-reviewed programme tags"],
                  ].map(([a, b]) => (
                    <tr key={a}>
                      <th>{a}</th>
                      <td>{b}</td>
                      <td>Review programme accessibility</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details onToggle={(e) => setShowAccess(e.currentTarget.open)}>
              <summary>Compare recorded programme accessibility</summary>
              {showAccess && (
                <>
                  <label className="field">
                    Find programme
                    <input
                      value={accessSearch}
                      onChange={(e) => setAccessSearch(e.target.value)}
                    />
                  </label>
                  <div className="work-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Programme</th>
                          <th>Language</th>
                          <th>Venue access</th>
                          <th>Seated option</th>
                          <th>Mobility requirements</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offerings
                          .filter((p) =>
                            p.name
                              .toLowerCase()
                              .includes(accessSearch.toLowerCase()),
                          )
                          .slice(0, 12)
                          .map((p) => (
                            <tr key={p.id}>
                              <th>{p.name}</th>
                              {[
                                "languages",
                                "venueAccessibility",
                                "seatedOption",
                                "mobilityRequirements",
                              ].map((k) => (
                                <td key={k}>
                                  {p.optional.accessibility?.[k] ||
                                    "Data required"}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted">
                    Showing up to 12 matching programmes. Search to narrow the
                    list. Values are staff-reviewed descriptions; they do not
                    prove that a need was met.
                  </p>
                </>
              )}
            </details>
            <button className="button" onClick={() => setSection("alignment")}>
              Review programme accessibility
            </button>
            <p className="muted">
              CFS, social risk and living arrangements do not establish
              eligibility or a diagnosis.
            </p>
          </section>
        </>
      )}
    </>
  );
}
