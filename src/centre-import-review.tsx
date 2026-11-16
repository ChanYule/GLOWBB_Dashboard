import { useEffect, useState } from "react";
import { api } from "./api";
import type { Preview } from "./types";
import { CENTRES } from "../shared/centres.js";
type SourceRows = {
  centreId: string;
  page: number;
  pages: number;
  total: number;
  rows: {
    row: number;
    activity: string;
    location: string;
    domain: string;
    eventType: string;
    session: string;
    status: string;
  }[];
};
const fmt = (n: number | undefined) =>
  new Intl.NumberFormat("en-SG").format(n ?? 0);
const rowStatus: Record<string, string> = {
  insert: "Insert",
  duplicate: "Duplicate - no new attendance",
  skipped: "Skip conflicting row",
  invalid: "Invalid - correct source",
  unclassified: "Review centre",
  restricted: "Centre access required",
};
export function CentreImportReview({
  preview,
  onReviewed,
}: {
  preview: Preview;
  onReviewed: (p: Preview) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [bulk, setBulk] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [inspectCentre, setInspectCentre] = useState(""),
    [page, setPage] = useState(1),
    [inspection, setInspection] = useState<{
      key: string;
      data?: SourceRows;
      error?: string;
    } | null>(null);
  const inspectKey =
    preview.id +
    "/" +
    (preview.classificationRevision || 0) +
    "/" +
    inspectCentre +
    "/" +
    page;
  useEffect(() => {
    if (!inspectCentre) return;
    let live = true;
    api<SourceRows>(
      "/api/centres/import/rows?" +
        new URLSearchParams({
          id: preview.id,
          centreId: inspectCentre,
          page: String(page),
        }),
    )
      .then((data) => {
        if (live) setInspection({ key: inspectKey, data });
      })
      .catch((e) => {
        if (live) setInspection({ key: inspectKey, error: e.message });
      });
    return () => {
      live = false;
    };
  }, [preview.id, inspectCentre, page, inspectKey]);
  const inspected = inspection?.key === inspectKey ? inspection : null;
  if (!preview.centreCounts) return null;
  const rows = [
    ...new Map(
      [
        ...(preview.classificationReview || []).map((r) => ({
          ...r,
          centreId: "",
        })),
        ...preview.preview.map((r) => ({
          row: r.row,
          activity: r.programme,
          location: r.location || "Classified source row",
          centreId: r.centreId || "",
          reason: "",
        })),
      ].map((r) => [r.row, r]),
    ).values(),
  ].sort((a, b) => a.row - b.row);
  const apply = async (all = false) => {
    setError("");
    setBusy(true);
    try {
      const result = await api<Preview>("/api/centres/import/review", {
        method: "POST",
        body: JSON.stringify({
          id: preview.id,
          overrides: Object.entries(choices)
            .filter(([, v]) => v)
            .map(([row, centreId]) => ({ row: Number(row), centreId, reason })),
          ...(all ? { unclassifiedCentre: bulk, reason } : {}),
        }),
      });
      onReviewed(result);
      setChoices({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h3>Centre classification review</h3>
      <p>
        Centre/Centres identifies the location, including Tzu Chi SEEN @ Bukit
        Batok and Tzu Chi SEEN @ Nanyang. Only a standalone GLOW prefix in
        Activity Name selects GLOW; other valid names select SEEN. Original
        programme names are preserved. Underscore is a supported prefix
        separator (GLOW_).
      </p>
      <p>
        <strong>Total records: {fmt(preview.rawRows)}</strong>. Duplicate rows:{" "}
        {fmt(preview.duplicates)} (exact source duplicates:{" "}
        {fmt(preview.exactDuplicates)}). Unclassified records:{" "}
        {fmt(preview.unclassified)}.
      </p>
      <div className="centre-import-summary">
        {CENTRES.map((c) => (
          <section key={c.id} aria-label={c.name + " import summary"}>
            <h4>{c.name}</h4>
            <strong>{fmt(preview.centreCounts![c.id])}</strong>
            <span>source rows</span>
            {preview.centreSummaries?.[c.id] && (
              <p>
                {fmt(preview.centreSummaries[c.id].ready)} insert ·{" "}
                {fmt(preview.centreSummaries[c.id].duplicates)} duplicate ·{" "}
                {fmt(preview.centreSummaries[c.id].skipped)} skip ·{" "}
                {fmt(preview.centreSummaries[c.id].invalid)} invalid
              </p>
            )}
            {!!preview.centreSummaries?.[c.id]?.profileUpdates && (
              <p>
                {fmt(preview.centreSummaries[c.id].profileUpdates)} profile
                updates
              </p>
            )}
            {!!preview.centreSummaries?.[c.id]?.sessionUpdates && (
              <p>
                {fmt(preview.centreSummaries[c.id].sessionUpdates)} session
                classification updates
              </p>
            )}
            <button
              className="button"
              disabled={
                !preview.centreCounts![c.id] ||
                preview.deniedCentres?.includes(c.id)
              }
              onClick={() => {
                setInspectCentre(c.id);
                setPage(1);
              }}
            >
              Inspect {c.name} rows
            </button>
          </section>
        ))}
      </div>
      {inspectCentre && (
        <section className="centre-source-rows">
          <h4>
            Source rows for {CENTRES.find((c) => c.id === inspectCentre)?.name}
          </h4>
          <p>
            Programme and source-location details only. Member IDs are omitted.
          </p>
          {!inspected && <p role="status">Loading source rows...</p>}
          {inspected?.error && <p role="alert">{inspected.error}</p>}
          {inspected?.data && (
            <>
              <p>
                {fmt(inspected.data.total)} source rows · Page{" "}
                {inspected.data.page} of {inspected.data.pages}
              </p>
              <div className="work-table">
                <table aria-label="Centre import source rows">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Original activity / location</th>
                      <th>AAP Domain / Event Type</th>
                      <th>Session</th>
                      <th>Import action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspected.data.rows.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>
                          {r.activity || "Missing activity"}
                          <small>
                            {r.location || "Missing centre location"}
                          </small>
                        </td>
                        <td>
                          {r.domain || "Unclassified"}
                          <small>
                            {r.eventType || "No Event Type recorded"}
                          </small>
                        </td>
                        <td>{r.session || "Missing session details"}</td>
                        <td>{rowStatus[r.status] || r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="work-actions">
                <button
                  className="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous source rows
                </button>
                <button
                  className="button"
                  disabled={page >= inspected.data.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next source rows
                </button>
              </div>
            </>
          )}
          <button className="text-button" onClick={() => setInspectCentre("")}>
            Close source rows
          </button>
        </section>
      )}
      {!!preview.deniedCentres?.length && (
        <p role="alert">
          This upload includes centres outside your access:{" "}
          {preview.deniedCentres.join(", ")}. Those centres cannot be imported.
        </p>
      )}
      <details open={!!preview.unclassified}>
        <summary>Review exceptions or unresolved source rows</summary>
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Source row</th>
                <th>Activity / location</th>
                <th>Reviewed centre override</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row}>
                  <th>{r.row}</th>
                  <td>
                    {r.activity || "Missing activity"} · {r.location}
                    <small>{r.reason}</small>
                  </td>
                  <td>
                    <select
                      aria-label={"Centre override for row " + r.row}
                      value={choices[r.row] || ""}
                      onChange={(e) =>
                        setChoices((old) => ({
                          ...old,
                          [r.row]: e.target.value,
                        }))
                      }
                    >
                      <option value="">
                        {CENTRES.find((c) => c.id === r.centreId)?.name ||
                          "Needs review"}
                      </option>
                      {CENTRES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label>
          Source evidence / override reason
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
          />
        </label>
        <button
          className="button"
          disabled={
            busy || reason.trim().length < 5 || !Object.keys(choices).length
          }
          onClick={() => apply()}
        >
          Apply reviewed row overrides
        </button>
        {!!preview.unclassified && (
          <>
            <label>
              One verified centre for all unresolved rows
              <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
                <option value="">
                  Choose only when the source proves a single centre
                </option>
                {CENTRES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button"
              disabled={busy || !bulk || reason.trim().length < 5}
              onClick={() => apply(true)}
            >
              Apply reviewed centre to all unclassified rows
            </button>
            <p>
              Blank Activity Names still require source correction and cannot be
              overridden.
            </p>
          </>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
