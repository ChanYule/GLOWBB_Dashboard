import { useEffect, useState } from "react";
import { api } from "./api";
import type { Report } from "./patterns-ui";
import { attendanceAnswer, attendanceQuestions } from "./attendance-questions";
import "./attendance-questions.css";

function Question({ item, query, revision, onReview }: {
  item: typeof attendanceQuestions[number]; query: string; revision: string;
  onReview: (dimension: string) => void;
}) {
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = query + revision + retry;
  useEffect(() => {
    const controller = new AbortController();
    api<Report>(`/api/participation-patterns?${query}&dimension=${item.dimension}`, { signal: controller.signal })
      .then(report => { if (!controller.signal.aborted) setResult({ key, report }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [query, item.dimension, key]);
  const current = result?.key === key ? result : null;
  const answer = current?.report ? attendanceAnswer(current.report) : null;
  return <article className="attendance-question">
    <h3>{item.question}</h3>
    {!current && <p role="status">Checking recorded data…</p>}
    {current?.error && <div role="alert"><p>Answer unavailable. {current.error}</p><button className="text-button" onClick={() => setRetry(n => n + 1)}>Retry answer</button></div>}
    {answer && <>
      <p>{answer.answer}</p>
      <p className="attendance-question-action"><strong>Staff follow-up:</strong> {answer.rows.length ? item.action : "Check registry coverage and profile completeness before drawing conclusions."}</p>
      <details>
        <summary>Evidence and limits</summary>
        <p>{current?.report?.period.from || "No recorded history"} to {current?.report?.period.to || "—"}. {current?.report?.basis === "dated" ? "Dated profiles at period end." : "Current recorded profiles; historical profiles may differ."}</p>
        {answer.rows.length > 0 && <div className="work-table"><table>
          <caption className="sr-only">Evidence for: {item.question}</caption>
          <thead><tr><th scope="col">Group</th><th scope="col">Attended / registered</th><th scope="col">Participation</th></tr></thead>
          <tbody>{answer.rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.unique} / {row.registered}</td><td>{row.rate}%</td></tr>)}</tbody>
        </table></div>}
        {answer.note && <p>{answer.note}</p>}
      </details>
      <button className="text-button" onClick={() => onReview(item.dimension)}>Explore this comparison</button>
    </>}
  </article>;
}

export function AttendanceQuestions({ query, revision, onReview }: {
  query: Record<string, string>; revision: string; onReview: (dimension: string) => void;
}) {
  const filters = new URLSearchParams({ scope: "clients", basis: query.basis || "current",
    ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}),
    ...(query.domain ? { domain: query.domain } : {}),
  }).toString();
  return <section className="panel attendance-questions" aria-labelledby="attendance-questions-title">
    <h2 id="attendance-questions-title">Attendance questions that matter</h2>
    <p>Registered-client analysis, including clients with no recorded attendance. Uses the selected period, domain and profile basis; independent of the population and group selected below.</p>
    <p className="table-note">Participation = clients who attended at least once ÷ registered clients in each group. This is not a session attendance rate; bookings and absences are not recorded. Differences do not prove cause.</p>
    <div className="attendance-questions-grid">{attendanceQuestions.map(item => <Question key={item.dimension} item={item} query={filters} revision={revision} onReview={onReview} />)}</div>
  </section>;
}
