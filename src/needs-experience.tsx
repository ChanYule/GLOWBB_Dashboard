import { useEffect, useState } from "react";
import { api } from "./api";
import { NeedsPage, ProtectedDistribution } from "./needs-ui";
import type { NeedsReport } from "./needs-ui";
import { SocialRisk } from "./workspace";
import type { Filters, User } from "./types";
import {LoadingState,ErrorState} from './experience';

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
  const [retry,setRetry]=useState(0);
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
  }, [query, user.role,retry]);
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
      <label className="workspace-view-control">Show<select aria-label="Participant needs view" value={section} onChange={e=>setSection(e.target.value)}>{[["summary","Needs summary"],["profile","Participant records"],["gaps","Participation barriers"],["alignment","Programme accessibility"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {error && (
        <ErrorState message={error} onRetry={()=>setRetry(n=>n+1)}/>
      )}
      {section !== "summary" ? (
        <NeedsPage
          level={section as "profile" | "gaps" | "alignment"}
          filters={filters}
          user={user}
          onRefresh={onRefresh}
        />
      ) : !report ? (
        <LoadingState label="Loading recorded needs…"/>
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
            <div className="needs-accessibility-grid">
              {[
                {title:'Language and communication',series:report.responses.preferences.languages,check:'Languages used during the activity and communication support.',action:'Review language support',response:'languages'},
                {title:'Mobility and physical accessibility',series:report.responses.needs,check:'Verified venue access, seated options and recorded mobility requirements.',action:'Check seated activity options',response:'needs'},
                {title:'Programme timing',series:null,check:'Ask about suitable time slots; attendance alone does not establish a preferred time.',action:'Review suitable time slots',response:'barriers'},
                {title:'Interests and preferences',series:report.responses.interests,check:'Compare recorded interests with staff-reviewed programme descriptions.',action:'Compare interests with programmes',response:'interests'},
                {title:'Social support and reported barriers',series:report.responses.barriers,check:'Use participant or caregiver reports; living arrangements do not establish isolation.',action:'Review reported participation barriers',response:'barriers'},
              ].map(item=><article key={item.title}><h3>{item.title}</h3><dl><dt>What we know</dt><dd>{item.series?.suppressed?'Recorded responses are withheld under the reporting rules.':item.series?.denominator!=null?`${item.series.denominator.toLocaleString('en-SG')} people in this question's recorded response population. Categories may overlap.`:'Structured preference information is not available in this summary.'}</dd><dt>What is missing / what to check</dt><dd>{item.check} A missing response does not mean no support is needed.</dd></dl><button className="text-button" onClick={()=>{setResponse(item.response);setSection(item.response==='barriers'?'gaps':'alignment');}}>{item.action}</button></article>)}
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
