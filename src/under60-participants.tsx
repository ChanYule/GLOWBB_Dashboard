import { useEffect, useState } from "react";
import { api } from "./api";
import type { Report } from "./patterns-ui";

export function Under60Participants({ query, revision, onExplore }: {
  query: Record<string, string>; revision: string; onExplore: () => void;
}) {
  const params = new URLSearchParams({ dimension: "age", scope: "overall", group: "Below 60",
    basis: query.basis || "current", from: query.from || "", to: query.to || "", domain: query.domain || "",
  }).toString();
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${params}:${revision}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    api<Report>(`/api/participation-patterns?${params}`, { signal: controller.signal })
      .then(report => { if (!controller.signal.aborted) setResult({ key, report }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [params, key]);
  const current = result?.key === key ? result : null;
  const report = current?.report;
  const group = report?.groups.find(g => g.label === "Below 60");
  const withheld = report?.comparisonSuppressed || group?.suppressed;
  return <section className="panel" aria-labelledby="under60-title">
    <h2 id="under60-title">Below 60 · attendance participants</h2>
    <p>Shown separately from registered-client analysis. These attendance figures do not add anyone to the client registry or client-rate denominator.</p>
    {!current && <p role="status">Loading participants below 60…</p>}
    {current?.error && <div role="alert"><p>{current.error}</p><button className="button" onClick={() => setRetry(n => n + 1)}>Retry below-60 attendance</button></div>}
    {report && (withheld ? <p className="note">Below-60 figures are withheld under the current data-access rules. Withheld values are not zero.</p> : <>
      <p><strong>{group?.unique == null ? "Unique participant count unavailable" : `${group.unique} unique participants`}</strong> · {group?.attendance == null ? "Attendance entries unavailable" : `${group.attendance} attendance entries`} · {group?.programmes == null ? "Programme count unavailable" : `${group.programmes} programmes`}</p>
      <p className="table-note">Same selected period, domain and profile basis. No client participation rate applies; people without a known age are not counted as below 60.</p>
      <button className="button" onClick={onExplore}>View below-60 attendance and programmes</button>
    </>)}
  </section>;
}
