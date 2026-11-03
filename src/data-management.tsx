import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArrowRight,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "./api";
import "./data-management.css";

type Counts = {
  attendance: number;
  participants: number;
  programmes: number;
  sessions: number;
  profiles: number;
  feedback: number;
  actions: number;
  registryRows: number;
  assessments: number;
  targets: number;
  from?: string | null;
  to?: string | null;
};
type Backup = {
  id: string;
  created: string;
  reason: string;
  attendance: number;
  restorable: boolean;
};
type Inventory = {
  counts: Counts;
  imports: {
    id: number;
    created: string;
    imported: number;
    remaining: number;
  }[];
  backups: Backup[];
};
type Scope = "import" | "date-range" | "all-attendance" | "reset";
type Review = {
  id: string;
  operation: "delete" | "restore";
  selection: { scope?: Scope; from?: string; to?: string; importId?: number };
  counts: Counts;
  current: Counts;
  affectedPeople: number;
  confirmation: string;
};
const n = (value: number) => new Intl.NumberFormat("en-SG").format(value);
const date = (value: string) =>
  new Date(value).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (value: string) =>
  new Date(value + "T00:00:00+08:00").toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const countLabels: [keyof Counts, string][] = [
  ["attendance", "Attendance entries"],
  ["sessions", "Recorded sessions"],
  ["participants", "Participant records"],
  ["programmes", "Programme catalogue entries"],
  ["profiles", "Reviewed profiles"],
  ["feedback", "Feedback responses"],
  ["actions", "Planning actions"],
  ["registryRows", "Member registry records"],
  ["assessments", "Monthly assessment totals"],
  ["targets", "Targets"],
];
function ConfirmDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      className="data-confirm"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close review"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="data-confirm-body">{children}</div>
    </dialog>
  );
}
export function DataManagement({
  onImport,
  onDefinitions,
  onReporting,
  onChanged,
  version = 0,
}: {
  onImport: () => void;
  onDefinitions: () => void;
  onReporting: () => void;
  onChanged: (message: string) => void;
  version?: number;
}) {
  const [data, setData] = useState<Inventory | null>(null),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState<"imports" | "backups">("imports"),
    [deleting, setDeleting] = useState(false),
    [scope, setScope] = useState<Scope>("import"),
    [importId, setImportId] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [removeBackup, setRemoveBackup] = useState<Backup | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dialogError, setDialogError] = useState(""),
    [lastChange, setLastChange] = useState<{
      operation: string;
      backupId: string;
    } | null>(null);
  const deleteRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    api<Inventory>("/api/data-management")
      .then((next) => {
        if (live) {
          setData(next);
          setError("");
        }
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [revision, version]);
  const changed = (message: string) => {
    setRevision((r) => r + 1);
    onChanged(message);
  };
  async function preview(input: object) {
    setBusy(true);
    setError("");
    setDialogError("");
    setConfirmation("");
    try {
      setReview(
        await api<Review>("/api/data-management/preview", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setDialogError("");
    try {
      if (removeBackup) {
        await api("/api/data-management/backups/" + removeBackup.id, {
          method: "DELETE",
          body: JSON.stringify({ confirmation }),
        });
        setRemoveBackup(null);
        changed("Backup permanently deleted.");
      } else if (review) {
        const result = await api<{ operation: string; backupId: string }>(
          "/api/data-management/confirm",
          {
            method: "POST",
            body: JSON.stringify({ id: review.id, confirmation }),
          },
        );
        setLastChange(result);
        setReview(null);
        setDeleting(false);
        changed(
          result.operation === "restore"
            ? "Data restored. Dashboard refreshed."
            : "Selected data deleted. A recovery backup was saved.",
        );
      }
      setConfirmation("");
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const closeReview = () => {
    if (!busy) {
      setReview(null);
      setRemoveBackup(null);
      setDialogError("");
      setConfirmation("");
    }
  };
  const phrase = removeBackup ? "DELETE BACKUP" : review?.confirmation || "";
  const isRestore = review?.operation === "restore";
  return (
    <div className="data-workspace">
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRevision((r) => r + 1)}
          >
            Reload saved data
          </button>
        </div>
      )}
      {!data ? (
        <p role="status">Loading saved data…</p>
      ) : (
        <>
          <section className="data-overview" aria-label="Saved data summary">
            <div className="data-overview-title">
              <span className="data-icon">
                <Database size={24} />
              </span>
              <div>
                <span className="eyebrow">YOUR SAVED RECORDS</span>
                <h2>A clear view of your data</h2>
                <p>
                  {data.counts.from && data.counts.to
                    ? `${day(data.counts.from)} – ${day(data.counts.to)}`
                    : "Ready for your first attendance file"}
                </p>
              </div>
            </div>
            <div className="data-stat-grid">
              {[
                [data.counts.attendance, "Attendance entries"],
                [data.counts.participants, "Participant records"],
                [data.counts.programmes, "Programmes"],
              ].map(([value, label]) => (
                <div key={label}>
                  <strong>{n(Number(value))}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>
          {lastChange && (
            <div className="data-success" role="status">
              <Check size={22} />
              <div>
                <strong>
                  {lastChange.operation === "restore"
                    ? "Your saved data has been restored."
                    : "Your selected data has been deleted."}
                </strong>
                <p>A backup of the previous state is available below.</p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  preview({
                    operation: "restore",
                    backupId: lastChange.backupId,
                  })
                }
              >
                <RotateCcw size={16} /> Review undo
              </button>
            </div>
          )}
          <div className="data-primary-actions">
            <button className="button primary" onClick={onImport}>
              <Upload size={18} /> Import attendance
            </button>
            <button className="button" onClick={onDefinitions}>
              <Settings2 size={17} /> Reporting definitions
            </button>
            <button className="text-button" onClick={onReporting}>
              Risk & staff settings <ArrowRight size={15} />
            </button>
          </div>
          <section className="panel data-records">
            <div className="data-section-head">
              <div className="data-tabs" aria-label="Saved data sections">
                <button
                  aria-pressed={tab === "imports"}
                  onClick={() => setTab("imports")}
                >
                  <FileSpreadsheet size={17} /> Imports{" "}
                  <span>{data.imports.length}</span>
                </button>
                <button
                  aria-pressed={tab === "backups"}
                  onClick={() => setTab("backups")}
                >
                  <ArchiveRestore size={17} /> Backups{" "}
                  <span>{data.backups.length}</span>
                </button>
              </div>
              <span className="muted">
                All saved data · filters do not apply
              </span>
            </div>
            {tab === "imports" ? (
              <>
                <p className="muted">
                  See what was saved, then remove an import or a date range when
                  needed. Profile updates are kept when attendance is deleted.
                </p>
                {data.imports.length === 0 ? (
                  <div className="data-empty">
                    <FileSpreadsheet size={32} />
                    <h3>No attendance imports yet</h3>
                    <p>
                      Upload an Excel or CSV file, review the preview, then
                      confirm.
                    </p>
                    <button className="button" onClick={onImport}>
                      Choose your attendance file <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="data-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Import</th>
                          <th>Saved on</th>
                          <th>Originally added</th>
                          <th>Still saved</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.imports.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <span className="data-file">
                                <FileSpreadsheet size={18} />
                                <strong>Import #{item.id}</strong>
                              </span>
                            </td>
                            <td data-label="Saved on">{date(item.created)}</td>
                            <td data-label="Originally added">
                              {n(item.imported)}
                            </td>
                            <td data-label="Still saved">
                              <span
                                className={
                                  item.remaining ? "data-count" : "muted"
                                }
                              >
                                {n(item.remaining)} entries
                              </span>
                            </td>
                            <td>
                              <button
                                className="text-button data-remove-link"
                                disabled={busy || item.remaining === 0}
                                onClick={() => {
                                  setImportId(String(item.id));
                                  setScope("import");
                                  setDeleting(true);
                                  setTimeout(
                                    () =>
                                      deleteRef.current?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                      }),
                                    0,
                                  );
                                }}
                              >
                                Delete attendance <ArrowRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.imports.length === 100 && (
                  <p className="muted">
                    Showing the most recent 100 imports. Date-range deletion
                    covers the complete history.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="muted">
                  Recovery copies include participant information. Restore
                  replaces current programme data with the selected saved state.
                  Accounts, dashboard preferences and reporting definitions stay
                  in place.
                </p>
                {data.backups.length === 0 ? (
                  <div className="data-empty">
                    <ShieldCheck size={32} />
                    <h3>No recovery copies needed yet</h3>
                    <p>
                      A backup is saved automatically before deleting or
                      restoring data.
                    </p>
                  </div>
                ) : (
                  <div className="data-backup-list">
                    {data.backups.map((b) => (
                      <article key={b.id}>
                        <span className="data-icon">
                          <ArchiveRestore size={20} />
                        </span>
                        <div>
                          <h3>{b.reason}</h3>
                          <p>
                            {date(b.created)} · {n(b.attendance)} attendance
                            entries
                          </p>
                          {!b.restorable && (
                            <small>Older backup · download only</small>
                          )}
                        </div>
                        <div className="data-backup-actions">
                          <a className="button" href={"/api/backups/" + b.id}>
                            <Download size={15} /> Download
                          </a>
                          {b.restorable && (
                            <button
                              className="button"
                              disabled={busy}
                              onClick={() =>
                                preview({
                                  operation: "restore",
                                  backupId: b.id,
                                })
                              }
                            >
                              Review restore
                            </button>
                          )}
                          <button
                            className="icon-button data-remove-link"
                            aria-label={"Delete backup from " + date(b.created)}
                            disabled={busy}
                            onClick={() => {
                              setRemoveBackup(b);
                              setConfirmation("");
                              setDialogError("");
                            }}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
          <section
            className="data-delete-panel"
            ref={deleteRef}
            aria-label="Delete saved data"
          >
            <div className="data-section-head">
              <div className="data-delete-title">
                <Trash2 size={21} />
                <div>
                  <h2>Delete saved data</h2>
                  <p>
                    Choose exactly what to remove. Nothing changes until you
                    review and confirm.
                  </p>
                </div>
              </div>
              <button
                className="button"
                aria-expanded={deleting}
                onClick={() => setDeleting((v) => !v)}
              >
                {deleting ? "Close deletion options" : "Choose data to delete"}
              </button>
            </div>
            {deleting && (
              <form
                className="data-delete-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void preview({
                    scope,
                    ...(scope === "import"
                      ? { importId: Number(importId) }
                      : scope === "date-range"
                        ? { from, to }
                        : {}),
                  });
                }}
              >
                <fieldset className="data-choice-grid">
                  <legend>What would you like to delete?</legend>
                  {(
                    [
                      [
                        "import",
                        "One attendance import",
                        "Remove attendance added by a particular upload.",
                      ],
                      [
                        "date-range",
                        "Attendance in a date range",
                        "Remove entries between two dates, including both dates.",
                      ],
                      [
                        "all-attendance",
                        "All attendance",
                        "Start attendance afresh while keeping participant profiles and plans.",
                      ],
                      [
                        "reset",
                        "Reset programme data",
                        "Clear attendance, people, programmes, registry, needs, feedback, actions and targets.",
                      ],
                    ] as const
                  ).map(([value, label, help]) => (
                    <label
                      key={value}
                      className={
                        scope === value ? "data-choice selected" : "data-choice"
                      }
                    >
                      <input
                        type="radio"
                        name="delete-scope"
                        checked={scope === value}
                        onChange={() => setScope(value)}
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{help}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {scope === "import" && (
                  <label className="field">
                    <span>Attendance import</span>
                    <select
                      required
                      value={importId}
                      onChange={(e) => setImportId(e.target.value)}
                    >
                      <option value="">Choose an import</option>
                      {data.imports
                        .filter((i) => i.remaining > 0)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            Import #{i.id} · {date(i.created)} ·{" "}
                            {n(i.remaining)} entries
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {scope === "date-range" && (
                  <div className="form-row">
                    <label className="field">
                      <span>From date</span>
                      <input
                        type="date"
                        required
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>To date</span>
                      <input
                        type="date"
                        required
                        min={from}
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                <p className="data-retention-note">
                  <ShieldCheck size={18} />
                  {scope === "reset"
                    ? "Accounts, reporting definitions, personal views, audit history and existing backups are kept. Monthly assessment totals are cleared. A new recovery backup is saved."
                    : "Participant profiles, feedback, programme settings and planning actions stay saved. Sessions left without attendance are removed. A recovery backup is saved."}
                </p>
                <button className="button data-review-button" disabled={busy}>
                  {busy ? "Preparing preview…" : "Review deletion"}
                  <ArrowRight size={17} />
                </button>
              </form>
            )}
          </section>
          <p className="data-help">
            <ShieldCheck size={16} /> Backups retain deleted information until
            you remove them from the Backups tab. Original Excel and CSV files
            on your computer are unchanged.
          </p>
        </>
      )}
      {(review || removeBackup) && (
        <ConfirmDialog
          title={
            removeBackup
              ? "Permanently delete backup"
              : isRestore
                ? "Review data restore"
                : "Review data deletion"
          }
          onClose={closeReview}
        >
          <span
            className={
              isRestore ? "data-review-icon restore" : "data-review-icon"
            }
          >
            {isRestore ? <ArchiveRestore size={27} /> : <Trash2 size={27} />}
          </span>
          <h3>
            {removeBackup
              ? "This recovery copy will be removed permanently."
              : isRestore
                ? "Restore this saved state?"
                : review?.selection.scope === "reset"
                  ? "Reset programme data?"
                  : "Delete the selected attendance?"}
          </h3>
          {removeBackup ? (
            <p>
              {removeBackup.reason} · {date(removeBackup.created)}. Saved
              dashboard records will stay as they are. This backup cannot be
              recovered after deletion.
            </p>
          ) : (
            <>
              <p>
                {isRestore
                  ? "Current programme data will be replaced with the backup below. A recovery copy of the current state is saved first."
                  : "A recovery copy of the current state will be saved before this change."}
              </p>
              {!isRestore && (
                <p>
                  <strong>
                    {review?.selection.scope === "import"
                      ? `Import #${review.selection.importId}`
                      : review?.selection.scope === "date-range"
                        ? `${day(review.selection.from!)} – ${day(review.selection.to!)} (both dates included)`
                        : review?.selection.scope === "reset"
                          ? "All saved programme data"
                          : "All saved attendance, across every import and date"}
                  </strong>
                </p>
              )}
              <div className="data-review-counts">
                {countLabels
                  .filter(
                    ([key]) =>
                      typeof review?.counts[key] === "number" &&
                      Number(review.counts[key]) > 0,
                  )
                  .map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <strong>{n(Number(review!.counts[key]))}</strong>
                    </div>
                  ))}
              </div>
              {isRestore && (
                <p className="muted">
                  Currently saved: {n(review!.current.attendance)} attendance
                  entries and {n(review!.current.participants)} participant
                  records. This restore replaces programme data added after the
                  backup.
                </p>
              )}
              <p className="data-retention-note">
                <ShieldCheck size={17} />
                {!isRestore && review?.selection.scope !== "reset"
                  ? "Participant records, reviewed needs, feedback and planning actions are kept."
                  : "Accounts, personal views and reporting definitions are kept."}
              </p>
            </>
          )}
          <label className="field">
            <span>
              Type <strong>{phrase}</strong> to confirm
            </span>
            <input
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoFocus
            />
          </label>
          {dialogError && (
            <p className="error" role="alert">
              {dialogError}
            </p>
          )}
          <div className="data-dialog-actions">
            <button className="button" disabled={busy} onClick={closeReview}>
              Cancel
            </button>
            <button
              className={
                isRestore ? "button primary" : "button data-danger-button"
              }
              disabled={busy || confirmation !== phrase}
              onClick={() => void confirm()}
            >
              {busy
                ? "Saving change…"
                : removeBackup
                  ? "Delete backup permanently"
                  : isRestore
                    ? "Restore data"
                    : "Delete selected data"}
            </button>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
