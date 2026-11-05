import { useEffect, useState, useRef } from "react";
import { api } from "./api";
type Location = {
  id?: string;
  block: string;
  street: string;
  postal: string;
  address: string;
  lat: number | null;
  lon: number | null;
  status: string;
  source: string;
  venueName?: string;
};
type Store = {
  revision: number;
  centre: Location;
  bands: number[];
  timeBands: number[];
  buildings: Record<string, Location>;
  venues: Record<string, Location>;
  serviceConfigured: boolean;
  sessionVenues: string[];
  bindings: Record<string, { buildingId: string }>;
};
const empty: Location = {
  block: "",
  street: "",
  postal: "",
  address: "",
  lat: null,
  lon: null,
  status: "Awaiting verification",
  source: "",
};
const statuses = [
  "Verified",
  "Awaiting verification",
  "Ambiguous",
  "Unable to locate",
];
function LocationForm({
  value,
  centre = false,
  venue = false,
  revision,
  save,
  venues = [],
}: {
  value: Location;
  centre?: boolean;
  venue?: boolean;
  revision: number;
  save: (body: Record<string, unknown>) => Promise<void>;
  venues?: string[];
}) {
  const [form, setForm] = useState(value),
    [lat, setLat] = useState(value.lat == null ? "" : String(value.lat)),
    [lon, setLon] = useState(value.lon == null ? "" : String(value.lon)),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [candidates, setCandidates] = useState<Location[]>([]);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const valueKey = JSON.stringify(value);
  useEffect(() => {
    const next = JSON.parse(valueKey) as Location;
    setForm(next);
    setLat(next.lat == null ? "" : String(next.lat));
    setLon(next.lon == null ? "" : String(next.lon));
    setConfirm(false);
  }, [valueKey]);
  useEffect(() => setCurrentRevision(revision), [revision]);
  const update = (k: keyof Location, v: string) => {
    setForm((old) => ({ ...old, [k]: v }));
    setConfirm(false);
  };
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await save({
            ...form,
            lat: lat.trim() ? Number(lat) : null,
            lon: lon.trim() ? Number(lon) : null,
            confirm,
            revision: currentRevision,
          });
          setMessage("Reviewed location saved.");
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {centre && (
        <label>
          Centre display address
          <input
            aria-label="Centre display address"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </label>
      )}
      {venue && (
        <label>
          Exact recorded programme venue
          <select
            value={form.venueName || ""}
            onChange={(e) => update("venueName", e.target.value)}
            required
          >
            <option value="">Choose a recorded venue</option>
            {venues.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      )}
      <div className="patterns-filter-grid">
        <label>
          Building block
          <input
            aria-label="Building block"
            value={form.block}
            onChange={(e) => update("block", e.target.value)}
          />
        </label>
        <label>
          Verified street
          <input
            aria-label="Building street"
            value={form.street}
            onChange={(e) => update("street", e.target.value)}
          />
        </label>
        <label>
          Postal code
          <input
            aria-label="Building postal code"
            value={form.postal}
            onChange={(e) => update("postal", e.target.value)}
            maxLength={6}
          />
        </label>
      </div>
      <p className="muted">
        Enter building information only. No names, Member IDs, unit numbers or
        participant characteristics are sent to OneMap. A block number alone is
        not a unique address.
      </p>
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const r = await api<{
              status: string;
              candidates: Location[];
              revision: number;
            }>("/api/locations/search", {
              method: "POST",
              body: JSON.stringify({
                block: form.block,
                street: form.street,
                postal: form.postal,
              }),
            });
            setCandidates(r.candidates);
            setCurrentRevision(r.revision);
            setForm((old) => ({ ...old, status: r.status }));
            setConfirm(false);
            setMessage(
              r.status + ". Review a candidate before verifying coordinates.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Find building candidates
      </button>
      {candidates.map((c, i) => (
        <div className="panel" key={i}>
          <p>{c.address}</p>
          <p>
            {c.lat}, {c.lon}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setForm({
                ...c,
                ...(centre ? { address: form.address } : {}),
                id: form.id,
                venueName: form.venueName,
                status: "Awaiting verification",
              });
              setLat(String(c.lat));
              setLon(String(c.lon));
              setConfirm(false);
            }}
          >
            Review this candidate
          </button>
        </div>
      ))}
      <div className="patterns-filter-grid">
        <label>
          Latitude
          <input
            aria-label="Building latitude"
            type="number"
            step="any"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              setConfirm(false);
            }}
          />
        </label>
        <label>
          Longitude
          <input
            aria-label="Building longitude"
            type="number"
            step="any"
            value={lon}
            onChange={(e) => {
              setLon(e.target.value);
              setConfirm(false);
            }}
          />
        </label>
        <label>
          Verification status
          <select
            aria-label="Location verification status"
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
          >
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Verification source
        <input
          value={form.source}
          onChange={(e) => update("source", e.target.value)}
          maxLength={500}
          placeholder="Record the reviewed address/coordinate source"
        />
      </label>
      <label className="location-confirm">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />{" "}
        I checked the full building address and coordinates. This verification
        is not based only on a block number.
      </label>
      <button
        className="button primary"
        type="submit"
        disabled={busy || (form.status === "Verified" && !confirm)}
      >
        Save reviewed location
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function LocationAdmin({ onChanged }: { onChanged: () => void }) {
  const [store, setStore] = useState<Store | null>(null),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<Location | null>(null),
    [venue, setVenue] = useState<Location | null>(null),
    [bands, setBands] = useState("500,1000,2000"),
    [times, setTimes] = useState("5,10,20");
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [clients, setClients] = useState<{
      rows: {
        id: string;
        memberId: string;
        block: string;
        sourceKey: string;
        binding: { buildingId: string } | null;
      }[];
      total: number;
      revision: number;
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [buildingId, setBuildingId] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [destination, setDestination] = useState("centre"),
    [routing, setRouting] = useState(false),
    [message, setMessage] = useState("");
  const [matchesOpen, setMatchesOpen] = useState(false),
    [forceRoutes, setForceRoutes] = useState(false);
  const stop = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      stop.current = true;
      alive.current = false;
    };
  }, []);
  const reload = async () => {
    const r = await api<Store>("/api/locations");
    setStore(r);
    setBands(r.bands.join(","));
    setTimes(r.timeBands.join(","));
    return r;
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!matchesOpen) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      api<typeof clients>(
        "/api/locations/clients?" +
          new URLSearchParams({ search, page: String(page) }),
        { signal: c.signal },
      )
        .then((r) => {
          setClients(r);
          setSelected([]);
          setConfirmed(false);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [search, page, store?.revision, matchesOpen]);
  if (!store)
    return (
      <p role="status">{error || "Loading administrator location review..."}</p>
    );
  const saved = async (path: string, body: Record<string, unknown>) => {
    await api(path, { method: "PUT", body: JSON.stringify(body) });
    await reload();
    onChanged();
  };
  return (
    <section className="location-admin">
      <button
        className="button"
        onClick={() =>
          reload()
            .then(() => setError(""))
            .catch((e) => setError(e.message))
        }
      >
        Reload location records
      </button>
      <p className="note">
        {store.serviceConfigured
          ? "OneMap server credentials are configured. Address candidates and routes still require review."
          : "OneMap credentials are not configured. You can record reviewed coordinates manually; walking distances stay unknown until valid routing results are available."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details>
        <summary>Centre coordinates and reporting bands</summary>
        <label>
          Distance limits in metres
          <input
            aria-label="Distance band limits"
            value={bands}
            onChange={(e) => setBands(e.target.value)}
          />
        </label>
        <label>
          Walking-time limits in minutes
          <input
            aria-label="Walking-time band limits"
            value={times}
            onChange={(e) => setTimes(e.target.value)}
          />
        </label>
        <LocationForm
          value={store.centre}
          centre
          revision={store.revision}
          save={(b) =>
            saved("/api/locations/settings", {
              ...b,
              centre: b,
              bands: bands.split(",").map(Number),
              timeBands: times.split(",").map(Number),
            })
          }
        />
      </details>
      <details>
        <summary>Review residential buildings</summary>
        <div className="work-actions">
          <button
            className="button"
            onClick={() => setEdit({ ...empty, id: crypto.randomUUID() })}
          >
            Add residential building
          </button>
          <select
            aria-label="Review saved building"
            value={edit?.id || ""}
            onChange={(e) => setEdit(store.buildings[e.target.value] || null)}
          >
            <option value="">Choose a saved building</option>
            {Object.values(store.buildings).map((b) => (
              <option key={b.id} value={b.id}>
                {b.address} · {b.status}
              </option>
            ))}
          </select>
        </div>
        {edit && (
          <LocationForm
            key={edit.id}
            value={edit}
            revision={store.revision}
            save={(b) => saved("/api/locations/buildings/" + edit.id, b)}
          />
        )}
      </details>
      <details onToggle={(e) => setMatchesOpen(e.currentTarget.open)}>
        <summary>Match reviewed client addresses to a building</summary>
        <p>
          Review the source records below. A shared block number does not prove
          that clients live at the same building. Only the selected clients are
          linked; their registry and attendance records are unchanged.
        </p>
        <label>
          Find Member ID or imported block
          <input
            aria-label="Find clients for building review"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="work-actions">
          <button
            className="button"
            onClick={() => {
              setSelected(clients?.rows.map((p) => p.id) || []);
              setConfirmed(false);
            }}
          >
            Select this reviewed page
          </button>
          <button
            className="button"
            onClick={() => {
              setSelected([]);
              setConfirmed(false);
            }}
          >
            Clear client selection
          </button>
        </div>
        <div className="work-table">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Member ID</th>
                <th>Imported block</th>
                <th>Building review</th>
              </tr>
            </thead>
            <tbody>
              {clients?.rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      aria-label={"Select client " + p.memberId}
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={(e) => {
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, p.id]
                            : old.filter((id) => id !== p.id),
                        );
                        setConfirmed(false);
                      }}
                    />
                  </td>
                  <th>{p.memberId || "Stored client record"}</th>
                  <td>{p.block || "Missing"}</td>
                  <td>
                    {p.binding
                      ? store.buildings[p.binding.buildingId]?.address ||
                        "Building requires review"
                      : "Awaiting verification"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="work-actions">
          <button
            className="button"
            disabled={!page}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous clients
          </button>
          <button
            className="button"
            disabled={(page + 1) * 50 >= (clients?.total || 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next clients
          </button>
        </div>
        <label>
          Reviewed building
          <select
            aria-label="Building for selected clients"
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">Choose a building record</option>
            {Object.values(store.buildings).map((b) => (
              <option key={b.id} value={b.id}>
                {b.address} · {b.status}
              </option>
            ))}
          </select>
        </label>
        <label className="location-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          I reviewed these selected clients against full address evidence and
          confirmed this building match.
        </label>
        <button
          className="button primary"
          disabled={!confirmed || !buildingId || !selected.length}
          onClick={async () => {
            try {
              await api("/api/locations/bind", {
                method: "POST",
                body: JSON.stringify({
                  revision: clients?.revision,
                  buildingId,
                  confirm: true,
                  clients: clients?.rows
                    .filter((p) => selected.includes(p.id))
                    .map(({ id, sourceKey }) => ({ id, sourceKey })),
                }),
              });
              await reload();
              onChanged();
              setMessage(
                "Selected building matches saved. Unverified building coordinates still produce unknown distance.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save selected building matches
        </button>
      </details>
      <details>
        <summary>Actual programme venues</summary>
        <p>
          Venue analysis includes sessions whose recorded venue name matches
          this reviewed entry exactly. Missing session venues are not assumed to
          be the main centre.
        </p>
        <button
          className="button"
          onClick={() => setVenue({ ...empty, id: crypto.randomUUID() })}
        >
          Review a programme venue
        </button>
        {venue && (
          <LocationForm
            key={venue.id}
            value={venue}
            venue
            venues={store.sessionVenues}
            revision={store.revision}
            save={(b) => saved("/api/locations/venues/" + venue.id, b)}
          />
        )}
      </details>
      <details>
        <summary>Refresh cached walking routes</summary>
        <p>
          Process up to three distinct verified buildings per request.
          Navigation and chart filters never call OneMap. Cached routes are
          reused for 30 days; straight-line distances remain a separate measure.
        </p>
        <label>
          Destination
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="centre">Main centre</option>
            {Object.values(store.venues)
              .filter((v) => v.status === "Verified")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.venueName}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button"
          disabled={routing}
          onClick={async () => {
            setRouting(true);
            stop.current = false;
            setMessage("");
            try {
              const ids = Object.keys(store.buildings).filter(
                (id) => store.buildings[id].status === "Verified",
              );
              if (!ids.length)
                setMessage(
                  "Verify residential buildings before refreshing routes.",
                );
              let completed = 0;
              for (let offset = 0; offset < ids.length; offset += 3) {
                if (stop.current) break;
                const r = await api<{
                  completed: { id: string; status: string }[];
                  remaining: string[];
                }>("/api/locations/refresh", {
                  method: "POST",
                  body: JSON.stringify({
                    destination,
                    force: forceRoutes,
                    buildingIds: ids.slice(offset, offset + 3),
                  }),
                });
                completed += r.completed.length;
                setMessage(
                  `${completed} of ${ids.length} buildings processed. ${r.completed.map((b) => b.status).join("; ")}`,
                );
                if (
                  r.remaining.length ||
                  r.completed.some((b) => b.status === "Rate limited")
                )
                  break;
              }
              if (alive.current) {
                await reload();
                onChanged();
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setRouting(false);
            }
          }}
        >
          {routing
            ? "Refreshing building routes..."
            : "Refresh verified buildings"}
        </button>
        {routing && (
          <button
            className="button"
            onClick={() => {
              stop.current = true;
              setMessage(
                "Stopping after the current building batch. Completed cache records are retained.",
              );
            }}
          >
            Stop after current batch
          </button>
        )}
        <label className="location-confirm">
          <input
            type="checkbox"
            checked={forceRoutes}
            disabled={routing}
            onChange={(e) => setForceRoutes(e.target.checked)}
          />{" "}
          Recalculate routes even when their cache is current
        </label>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
