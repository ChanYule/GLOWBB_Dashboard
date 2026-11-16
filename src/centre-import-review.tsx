import { useState } from "react";
import { api } from "./api";
import type { Preview } from "./types";
import { CENTRES } from "../shared/centres.js";
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
          location: "Classified source row",
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
        Location comes from Centre/Centres. Only a standalone GLOW prefix
        selects GLOW; other valid names select SEEN. Original programme names
        are preserved.
      </p>
      {CENTRES.map((c) => (
        <p key={c.id}>
          <strong>{c.name}</strong>: {preview.centreCounts![c.id] || 0} source
          rows
        </p>
      ))}
      <p>
        Unclassified: {preview.unclassified || 0}. Duplicates:{" "}
        {preview.duplicates}. Invalid/warning rows remain in the validation
        report.
      </p>
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
