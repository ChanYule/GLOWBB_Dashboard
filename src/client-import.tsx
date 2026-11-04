import { ImportProgress } from "./import-progress";
import { useState } from "react";
import { FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import { api } from "./api";
type Conflict = {
  key: string;
  memberId: string;
  label: string;
  existing: unknown;
  incoming: unknown;
  protectedReview: boolean;
  source: string;
};
type Preview = {
  id: string;
  rows: number;
  matched: number;
  newProfiles: number;
  clients: number;
  withinBoundary: number;
  missingLiving: number;
  enrichments: number;
  omitted: number;
  duplicates: number;
  issues: { row: number; message: string }[];
  conflicts: Conflict[];
  note: string;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function ClientRegistryImport({ onSaved }: { onSaved: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [asOf, setAsOf] = useState(today()),
    [complete, setComplete] = useState(false),
    [consent, setConsent] = useState(false),
    [approved, setApproved] = useState<string[]>([]);
  return (
    <section className="panel client-import">
      <div className="client-section-title">
        <span className="client-icon">
          <FileSpreadsheet size={22} />
        </span>
        <div>
          <span className="eyebrow">LINK PEOPLE TO PARTICIPATION</span>
          <h2>Import client registry</h2>
        </div>
      </div>
      <p>
        Upload the full client list. Member ID links clients to existing
        attendance; it never replaces programme records or removes non-client
        participants.
      </p>
      <ImportProgress
        step={message ? 5 : !preview ? 1 : consent && complete ? 4 : 3}
      />
      {!preview ? (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              setPreview(
                await api<Preview>("/api/client-registry/preview", {
                  method: "POST",
                  body: new FormData(e.currentTarget),
                }),
              );
              setApproved([]);
              setConsent(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="client-upload">
            <Upload size={26} />
            <strong>Choose your client registry workbook</strong>
            <span>Excel (.xlsx) or UTF-8 CSV · original ten-column layout</span>
            <input
              name="file"
              type="file"
              accept=".xlsx,.csv"
              aria-label="Client registry file"
              required
            />
          </label>
          <details>
            <summary>Required source columns</summary>
            <p>
              Member ID, Gender, Current Living Arrangement, Age, Race, CFS,
              Social Risk Factor(s), Is Client, Within Boundary, Block /
              Building No.
            </p>
            <p>
              Registration Date and Preferred Language are optional. Block
              numbers are retained as source identifiers; no addresses or
              distances are inferred.
            </p>
          </details>
          <button className="button primary" disabled={busy}>
            {busy ? "Reading workbook…" : "Preview client registry"}
          </button>
        </form>
      ) : (
        <div className="form-stack">
          <div className="client-import-counts">
            {[
              [preview.rows, "Valid records"],
              [preview.matched, "Existing profiles"],
              [preview.newProfiles, "New profiles"],
              [preview.conflicts.length, "Fields to review"],
            ].map(([v, label]) => (
              <div key={label}>
                <strong>{Number(v).toLocaleString("en-SG")}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="note">
            <ShieldCheck size={17} /> {preview.note}
          </p>
          <p>
            {preview.clients} records marked as clients ·{" "}
            {preview.withinBoundary} within boundary · {preview.missingLiving}{" "}
            missing living arrangements.
          </p>
          {preview.omitted > 0 && (
            <p className="client-notice">
              {preview.omitted} previously registered clients are absent from
              this file and will stay registered. Archive a client only through
              their authorised membership workflow.
            </p>
          )}
          {preview.issues.length > 0 && (
            <div className="error" role="alert">
              <strong>
                Resolve {preview.issues.length} source issues before confirming.
              </strong>
              {preview.issues.slice(0, 20).map((i, n) => (
                <p key={n}>
                  Row {i.row}: {i.message}
                </p>
              ))}
            </div>
          )}
          <details open={preview.conflicts.length > 0}>
            <summary>
              Review conflicting values ({preview.conflicts.length})
            </summary>
            <p>
              Saved nonblank values are kept unless you approve a specific
              source update. Staff-reviewed profile corrections remain protected
              and must be changed in the profile.
            </p>
            <div className="client-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Member ID</th>
                    <th>Field</th>
                    <th>Saved value</th>
                    <th>Registry value</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.conflicts.map((c) => (
                    <tr key={c.key}>
                      <th>{c.memberId}</th>
                      <td>{c.label}</td>
                      <td>
                        {String(c.existing)}
                        <small>{c.source}</small>
                      </td>
                      <td>{String(c.incoming)}</td>
                      <td>
                        {c.protectedReview ? (
                          "Staff correction kept"
                        ) : (
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Approve ${c.label} for ${c.memberId}`}
                              checked={approved.includes(c.key)}
                              onChange={(e) =>
                                setApproved((p) =>
                                  e.target.checked
                                    ? [...p, c.key]
                                    : p.filter((k) => k !== c.key),
                                )
                              }
                            />{" "}
                            Approve update
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <label className="field">
            <span>Registry snapshot date</span>
            <input
              type="date"
              value={asOf}
              max={today()}
              required
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={complete}
              onChange={(e) => setComplete(e.target.checked)}
            />{" "}
            I verified this is the complete registered-client population as of
            this date.
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            I reviewed the matches, missing fields and selected updates.
          </label>
          <div className="client-actions">
            <button
              className="button primary"
              disabled={
                busy ||
                !consent ||
                preview.issues.length > 0 ||
                approved.length > 500
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api<{
                    created: number;
                    changed: number;
                    conflictsKept: number;
                  }>("/api/client-registry/confirm", {
                    method: "POST",
                    body: JSON.stringify({
                      id: preview.id,
                      complete,
                      asOf,
                      approvedFields: approved,
                    }),
                  });
                  setPreview(null);
                  setConsent(false);
                  setMessage(
                    `Registry saved: ${result.created} new profiles; ${result.changed} client records created or updated; ${result.conflictsKept} conflicting values retained. Attendance preserved.`,
                  );
                  onSaved();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving reviewed registry…" : "Confirm client registry"}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                void api("/api/import/preview/" + preview.id, {
                  method: "DELETE",
                }).catch(() => {});
                setPreview(null);
                setError("");
              }}
            >
              Discard preview
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="client-success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
