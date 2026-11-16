import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { User } from "./types";
import type { PriorityClient } from "./outreach-priorities-ui";
import { MetricHelp } from "./metric-help";
import "./analysis-quality.css";
export type QualitySummary = {
  asOf: string;
  total: number;
  verified: number;
  verifiedPercent: number | null;
  distanceReady: boolean;
  rows: {
    field: string;
    label: string;
    total: number;
    known: number;
    missing: number;
    knownPercent: number | null;
    missingPercent: number | null;
  }[];
};
type QualityClient = Omit<
  PriorityClient,
  "score" | "reasons" | "missingFields" | "watch" | "days"
>;
type MissingRows = {
  summary: QualitySummary;
  missingField: string;
  page: number;
  pageSize: number;
  total: number;
  rows: QualityClient[];
};
const fmt = (n: number | null) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(n);
const pct = (n: number | null) => (n == null ? "Unavailable" : fmt(n) + "%");
export function AddressVerification({
  summary,
  printing = false,
  onDistance,
}: {
  summary: QualitySummary;
  printing?: boolean;
  onDistance?: () => void;
}) {
  return (
    <div className="address-verification-banner">
      <strong>
        Residential address verification: {pct(summary.verifiedPercent)} ·{" "}
        {summary.verified}/{summary.total} clients verified
      </strong>
      <progress
        aria-label="Clients with verified addresses"
        max="100"
        value={summary.verifiedPercent || 0}
      />
      <p>
        Source block labels do not establish an address or distance. Unverified
        clients remain in Distance unknown. Distance analysis uses only verified
        locations and a verified destination; walking routes still require the
        existing cached route evidence.
      </p>
      {!printing && onDistance && (
        <button
          className="button"
          disabled={!summary.distanceReady}
          onClick={onDistance}
        >
          Open Distance analysis
        </button>
      )}
    </div>
  );
}
export function DataCompleteness({
  user,
  asOf,
  revision = 0,
  summary: provided,
  printing = false,
  onDistance,
  onReview,
  showVerification = true,
}: {
  user: User;
  asOf: string;
  revision?: number;
  summary?: QualitySummary | null;
  printing?: boolean;
  onDistance?: () => void;
  onReview?: (row: QualityClient) => void;
  showVerification?: boolean;
}) {
  const [result, setResult] = useState<{
      key: string;
      value?: MissingRows;
      error?: string;
    } | null>(null),
    [field, setField] = useState(""),
    [page, setPage] = useState(0),
    [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = JSON.stringify({ asOf, field, page, revision, retry });
  useEffect(() => {
    if (printing || user.role === "viewer" || (!field && provided)) return;
    const c = new AbortController();
    api<MissingRows>("/api/clients/data-quality", {
      method: "POST",
      body: JSON.stringify({ asOf, missingField: field, page }),
      signal: c.signal,
    })
      .then((value) => {
        if (!c.signal.aborted) setResult({ key, value });
      })
      .catch((e) => {
        if (!c.signal.aborted) setResult({ key, error: e.message });
      });
    return () => c.abort();
  }, [key, asOf, field, page, revision, retry, user.role, printing, provided]);
  useEffect(() => {
    if (field) {
      const previous = document.activeElement as HTMLElement | null;
      dialog.current?.showModal();
      return () => previous?.focus();
    }
  }, [field]);
  if (user.role === "viewer") return null;
  const current = result?.key === key ? result : null,
    summary = provided || current?.value?.summary;
  return (
    <section className="panel data-completeness">
      <h2>Data completeness</h2>
      <p>
        Current eligible client records as of {asOf}. Denominator:{" "}
        {summary?.total ?? "Unavailable"} registered clients, including
        nonattenders. Unknown, invalid and unrecorded values count as missing;
        recorded blocks are separate from verified addresses.
      </p>
      {summary ? (
        <>
          {showVerification && (
            <AddressVerification
              summary={summary}
              printing={printing}
              onDistance={onDistance}
            />
          )}
          <div className="work-table">
            <table>
              <caption>Known and missing client attributes</caption>
              <thead>
                <tr>
                  <th scope="col">Attribute</th>
                  <th scope="col">Known</th>
                  <th scope="col">Missing</th>
                  {!printing && <th scope="col">Review</th>}
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.field}>
                    <th scope="row">{r.label}</th>
                    <td>
                      {r.known}/{r.total} · {pct(r.knownPercent)}
                    </td>
                    <td>
                      {r.missing}/{r.total} · {pct(r.missingPercent)}
                    </td>
                    {!printing && (
                      <td>
                        <button
                          className="text-button"
                          disabled={!r.missing}
                          onClick={() => {
                            setField(r.field);
                            setPage(0);
                          }}
                        >
                          Review missing {r.label.toLowerCase()}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MetricHelp
            label="Data completeness"
            definition="Known recorded values divided by the eligible registered-client population as of the displayed date. Missing is its complement. Address verification requires a reviewed binding with unchanged address/building evidence; it is not inferred from a block number."
          />
        </>
      ) : current?.error ? (
        <p role="alert">
          {current.error}{" "}
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            Retry data completeness
          </button>
        </p>
      ) : (
        <p role="status">Loading data completeness…</p>
      )}
      {field && !printing && (
        <dialog
          ref={dialog}
          aria-label="Clients with missing information"
          onCancel={() => setField("")}
          className="quality-dialog"
        >
          <h2>
            Review missing{" "}
            {summary?.rows
              .find((r) => r.field === field)
              ?.label.toLowerCase() || field}
          </h2>
          <p>
            Staff-only list from the existing follow-up fields. Viewing does not
            change a record or contact anyone.
          </p>
          {current?.error ? (
            <p role="alert">
              {current.error}
              <button className="button" onClick={() => setRetry((n) => n + 1)}>
                Retry missing list
              </button>
            </p>
          ) : current?.value ? (
            <>
              <p>
                {current.value.total} clients · page {page + 1}
              </p>
              <div className="work-table">
                <table>
                  <caption>Clients missing the selected attribute</caption>
                  <thead>
                    <tr>
                      <th scope="col">Member ID</th>
                      <th scope="col">Recorded block</th>
                      <th scope="col">Last attendance</th>
                      {onReview && <th scope="col">Review</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {current.value.rows.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">{r.memberId}</th>
                        <td>{r.block}</td>
                        <td>{r.last || "No recorded history"}</td>
                        {onReview && (
                          <td>
                            <button
                              className="button"
                              onClick={() => {
                                setField("");
                                onReview(r);
                              }}
                            >
                              Review client / plan follow-up
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="button"
                disabled={!page}
                onClick={() => setPage((n) => n - 1)}
              >
                Previous missing clients
              </button>
              <button
                className="button"
                disabled={(page + 1) * 25 >= current.value.total}
                onClick={() => setPage((n) => n + 1)}
              >
                Next missing clients
              </button>
            </>
          ) : (
            <p role="status">Loading missing clients…</p>
          )}
          <button className="button" onClick={() => setField("")}>
            Close missing list
          </button>
        </dialog>
      )}
    </section>
  );
}
