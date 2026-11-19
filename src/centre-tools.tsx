import { useEffect, useState } from "react";
import { api } from "./api";
import { CENTRES } from "../shared/centres.js";
import type { User } from "./types";
import {PageHeader,LoadingState,ErrorState} from './experience';
type Staff = User & { canCompare: boolean; centres?: { id: string }[] };
export function CentreTools({
  staff,
  onChanged,
}: {
  staff: Staff;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState(
      "overview",
    ),
    [snapshot, setSnapshot] = useState<{
      key: string;
      value: Record<string, unknown>;
    } | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),[retry,setRetry]=useState(0);
  const [assignments, setAssignments] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [registry, setRegistry] = useState(false),
    [configurationCentre, setConfigurationCentre] = useState(""),
    [preview, setPreview] = useState<{
      id: string;
      centres: {
        name: string;
        programmes: number;
        sessions: number;
        registry: number;
      }[];
      unassigned: number;
    } | null>(null),
    [phrase, setPhrase] = useState("");
  const [backups, setBackups] = useState<{ id: string; created: string }[]>([]);
  const [pair, setPair] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const comparisonQuery = new URLSearchParams({
    ...(pair ? { centreIds: pair } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString();
  const requestKey = tab + "?" + comparisonQuery;
  const value = snapshot?.key === requestKey ? snapshot.value : null;
  const [userId, setUserId] = useState(""),
    [grants, setGrants] = useState<string[]>([]),
    [compare, setCompare] = useState(false),
    [verified, setVerified] = useState(false);
  useEffect(() => {
    const controller=new AbortController();
    setSnapshot(null);
    setError("");
    api<Record<string, unknown>>(
      tab==='overview'?'/api/centres/status':tab === "migration"
        ? "/api/centres/migration"
        : tab === "access"
          ? "/api/centres/access"
          : "/api/centres/compare?" + comparisonQuery,
      {signal:controller.signal},
    )
      .then((v) => {
        if (!controller.signal.aborted) setSnapshot({ key: requestKey, value: v });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
    };
  }, [tab, comparisonQuery, requestKey,retry]);
  const run = async (task: () => Promise<unknown>) => {
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const users = value?.users as
      { id: number; username: string; role: string }[] | undefined,
    programmes = value?.programmes as
      | {
          id: string;
          name: string;
          sessions: number;
          attendance: number;
          assignedCentreId?: string;
          assignmentStatus?: string;
        }[]
      | undefined;
  return (
    <main className="centre-tools panel">
      <PageHeader title="Centre Administration" description="Check data availability, manage staff access and compare authorised centres." />
      <div className="work-actions" role="tablist" aria-label="Centre administration sections">
        <button role="tab" aria-selected={tab==='overview'} className="button" onClick={()=>setTab('overview')}>Centre Overview</button>
        {staff.role === "admin" && (
          <>
            <button role="tab" aria-selected={tab==='migration'} className="button" onClick={() => setTab("migration")}>
              Historical Data Review
            </button>
            <button role="tab" aria-selected={tab==='access'} className="button" onClick={() => setTab("access")}>
              Staff Access
            </button>
          </>
        )}
        {staff.canCompare && (
          <button role="tab" aria-selected={tab==='compare'} className="button" onClick={() => setTab("compare")}>
            Centre Comparisons
          </button>
        )}
      </div>
      {error && <ErrorState message={error} onRetry={()=>setRetry(n=>n+1)}/>}
      {message && <p role="status">{message}</p>}
      {!value && !error && <LoadingState label="Loading centre information…"/>}
      {tab==='overview'&&value&&<div className="centre-overview-grid">{(value.rows as {id:string;name:string;participants:number;attendance:number;sessions:number;lastImport:string|null;registryComplete:boolean}[]).map(c=><article key={c.id}><h2>{c.name}</h2><p>{c.participants.toLocaleString('en-SG')} stored participant profiles · {c.sessions.toLocaleString('en-SG')} sessions</p><p>{c.attendance.toLocaleString('en-SG')} programme attendances</p><p>Last attendance import: {c.lastImport?new Date(c.lastImport).toLocaleDateString('en-SG',{timeZone:'Asia/Singapore'}):'No import recorded'}</p><p>{c.registryComplete?'Complete client registry recorded':'Client registry completeness needs review'}</p>{staff.role==='admin'&&<button className="text-button" onClick={()=>setTab('migration')}>Review Centre Records</button>}</article>)}</div>}
      {tab === "migration" && value && (
        <>
          <button
            className="button"
            onClick={() =>
              run(async () =>
                setBackups(await api("/api/centres/migration/backups")),
              )
            }
          >
            Show legacy recovery snapshots
          </button>
          {backups.map((b) => (
            <p key={b.id}>
              <a
                href={
                  "/api/centres/migration/backups/" + encodeURIComponent(b.id)
                }
              >
                Download protected legacy recovery snapshot ({b.created})
              </a>
            </p>
          ))}
          <h2>Historical records require reviewed centre allocation</h2>
          <p>
            {String(value.note)} Unallocated attendance:{" "}
            {String(value.attendance)} entries across {programmes?.length}{" "}
            programmes. No location is inferred from the old application
            branding.
          </p>
          <div className="work-table">
            <table>
              <thead>
                <tr>
                  <th>Programme</th>
                  <th>Sessions / entries</th>
                  <th>Reviewed centre</th>
                </tr>
              </thead>
              <tbody>
                {programmes?.map((p) => (
                  <tr key={p.id}>
                    <th>{p.name}</th>
                    <td>
                      {p.sessions} / {p.attendance}
                      <small>{p.assignmentStatus || "Unassigned"}</small>
                    </td>
                    <td>
                      <select
                        aria-label={"Allocate " + p.name}
                        disabled={!!p.assignedCentreId}
                        value={p.assignedCentreId || assignments[p.id] || ""}
                        onChange={(e) =>
                          setAssignments((old) => ({
                            ...old,
                            [p.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned — needs evidence</option>
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
            Provenance and review reason
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={registry}
              onChange={(e) => setRegistry(e.target.checked)}
            />{" "}
            Include the earlier registered-client population as GLOW Bukit Batok
            affiliation only
          </label>
          <label>
            Move earlier settings, actions, targets and personal views to
            <select
              value={configurationCentre}
              onChange={(e) => setConfigurationCentre(e.target.value)}
            >
              <option value="">Leave in legacy archive for review</option>
              {CENTRES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            Existing target configuration is never replaced. Legacy location
            configuration can only go to GLOW Bukit Batok. Per-centre imports
            and recovery snapshots remain separate.
          </p>
          <button
            className="button primary"
            disabled={reason.trim().length < 10}
            onClick={() =>
              run(async () =>
                setPreview(
                  await api("/api/centres/migration/preview", {
                    method: "POST",
                    body: JSON.stringify({
                      assignments: {
                        ...Object.fromEntries(
                          (programmes || [])
                            .filter((p) => p.assignmentStatus === "Pending")
                            .map((p) => [p.id, p.assignedCentreId]),
                        ),
                        ...Object.fromEntries(
                          Object.entries(assignments).filter(([, v]) => v),
                        ),
                      },
                      reason,
                      includeGlowRegistry: registry,
                      configurationCentre,
                    }),
                  }),
                ),
              )
            }
          >
            Preview reviewed migration
          </button>
          {preview && (
            <section className="panel">
              <h3>Migration preview</h3>
              {preview.centres.map((c) => (
                <p key={c.name}>
                  {c.name}: {c.programmes} programmes · {c.sessions} sessions ·{" "}
                  {c.registry} registry rows
                </p>
              ))}
              <p>
                {preview.unassigned} programmes remain unassigned. A server-side
                backup precedes copying; the legacy workspace is retained.
              </p>
              <label>
                Type MIGRATE REVIEWED RECORDS
                <input
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={phrase !== "MIGRATE REVIEWED RECORDS"}
                onClick={() =>
                  run(async () => {
                    await api("/api/centres/migration/confirm", {
                      method: "POST",
                      body: JSON.stringify({
                        id: preview.id,
                        confirmation: phrase,
                      }),
                    });
                    setMessage(
                      "Reviewed records copied. Legacy data and recovery snapshot retained.",
                    );
                    setPreview(null);
                    setAssignments({});
                    setPhrase("");
                    setSnapshot({
                      key: requestKey,
                      value: await api("/api/centres/migration"),
                    });
                  })
                }
              >
                Confirm reviewed allocation
              </button>
            </section>
          )}
        </>
      )}
      {tab === "access" && value && (
        <>
          <h2>Staff centre access</h2>
          <label>
            Staff account
            <select
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                const id = Number(e.target.value);
                setGrants(
                  (value.grants as { user_id: number; centre_id: string }[])
                    .filter((g) => g.user_id === id)
                    .map((g) => g.centre_id),
                );
                setCompare(
                  !!(
                    value.preferences as {
                      user_id: number;
                      can_compare: number;
                    }[]
                  ).find((p) => p.user_id === id)?.can_compare,
                );
              }}
            >
              <option value="">Choose an account</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} · {u.role}
                </option>
              ))}
            </select>
          </label>
          {CENTRES.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={grants.includes(c.id)}
                onChange={(e) =>
                  setGrants((old) =>
                    e.target.checked
                      ? [...old, c.id]
                      : old.filter((id) => id !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />{" "}
            Management cross-centre comparison permission
          </label>
          <button
            className="button primary"
            disabled={!userId}
            onClick={() =>
              run(async () => {
                await api("/api/centres/access", {
                  method: "PUT",
                  body: JSON.stringify({
                    userId: Number(userId),
                    centreIds: grants,
                    canCompare: compare,
                  }),
                });
                setMessage(
                  "Access updated. Each API request checks current access.",
                );
              })
            }
          >
            Save centre access
          </button>
          <h3>Global identity verification</h3>
          <p>
            Combined unique reach is unavailable until the organisation verifies
            that exact source Member IDs are globally unique. Repeated names are
            not proof.
          </p>
          <label>
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />{" "}
            Globally unique Member IDs verified against source documentation
          </label>
          <label>
            Identity evidence
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            className="button"
            disabled={reason.trim().length < 10}
            onClick={() =>
              run(async () => {
                await api("/api/centres/identity-policy", {
                  method: "PUT",
                  body: JSON.stringify({ verified, reason }),
                });
                setMessage("Global identity policy saved.");
              })
            }
          >
            Save identity review
          </button>
          <button className="text-button" onClick={onChanged}>
            Reload authorised centres
          </button>
        </>
      )}
      {tab === "compare" && (
        <div className="patterns-filter-grid">
          <label>
            Comparison scope
            <select
              aria-label="Cross-centre comparison scope"
              value={pair}
              onChange={(e) => setPair(e.target.value)}
            >
              <option value="">All authorised centres</option>
              {[
                [
                  "glow_bukit_batok,seen_bukit_batok",
                  "GLOW and SEEN at Bukit Batok",
                ],
                ["glow_nanyang,seen_nanyang", "GLOW and SEEN at Nanyang"],
                ["glow_bukit_batok,glow_nanyang", "GLOW across locations"],
                ["seen_bukit_batok,seen_nanyang", "SEEN across locations"],
              ]
                .filter(([ids]) =>
                  ids
                    .split(",")
                    .every((id) =>
                      (staff.centres || CENTRES).some((c) => c.id === id),
                    ),
                )
                .map(([ids, label]) => (
                  <option key={ids} value={ids}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Comparison from
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Comparison to
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}
      {tab === "compare" && value && (
        <>
          <h2>Authorised centre comparison</h2>
          <p>
            Period: {from || "Available history"} to{" "}
            {to || "Latest available records"}. Coverage can differ; use a
            shared covered date range for like-for-like comparisons. Senior
            thresholds and approved minority mappings follow each centre's
            settings.
          </p>
          <p>{String(value.note)}</p>
          <div className="work-table">
            <table>
              <thead>
                <tr>
                  {[
                    "Centre",
                    "Coverage",
                    "Senior age",
                    "Unique seniors",
                    "Male seniors",
                    "Minority seniors",
                    "Sessions",
                    "Entries",
                    "Registered clients",
                    "Client participation",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(value.rows as Record<string, unknown>[]).map((r) => (
                  <tr key={String(r.id)}>
                    {[
                      "name",
                      "coverage",
                      "seniorAge",
                      "unique",
                      "male",
                      "minority",
                      "sessions",
                      "attendance",
                      "registered",
                      "clientRate",
                    ].map((k) => (
                      <td key={k}>
                        {k === "coverage"
                          ? String(
                              (r.coverage as { from?: string }).from ||
                                "Unavailable",
                            ) +
                            " to " +
                            String(
                              (r.coverage as { to?: string }).to ||
                                "Unavailable",
                            )
                          : r[k] == null
                            ? "Unavailable"
                            : typeof r[k] === "number"
                              ? new Intl.NumberFormat("en-SG", {
                                  maximumFractionDigits: 1,
                                }).format(r[k] as number) +
                                (k === "clientRate" ? "%" : "")
                              : String(r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Programme mix and repeat participation</summary>
            <p>
              Repeat participation is the percentage of reached seniors
              attending at least two distinct sessions in the selected period,
              across programmes. Domain figures count distinct sessions in each
              primary domain.
            </p>
            {(value.rows as Record<string, unknown>[]).map((r) => (
              <p key={String(r.id)}>
                <strong>{String(r.name)}</strong>:{" "}
                {String(r.programmeMix || "Unavailable")}. Repeat senior
                participation:{" "}
                {r.repeatRate == null
                  ? "Unavailable"
                  : Number(r.repeatRate).toFixed(1) + "%"}
                .
              </p>
            ))}
          </details>
          <p>
            Combined deduplicated senior reach:{" "}
            {String(
              (value.combined as Record<string, unknown>).unique ??
                "Unavailable",
            )}
            . Do not sum centre-level unique counts.
          </p>
          <a
            className="button"
            href={"/api/centres/compare?" + comparisonQuery + "&format=csv"}
          >
            Download Excel-compatible CSV
          </a>
          <button
            className="button"
            onClick={() => {
              const old = document.title;
              document.title =
                "Authorised centre comparison / Programme & Outreach";
              window.addEventListener(
                "afterprint",
                () => {
                  document.title = old;
                },
                { once: true },
              );
              window.print();
            }}
          >
            Print comparison / Save as PDF
          </button>
        </>
      )}
    </main>
  );
}
