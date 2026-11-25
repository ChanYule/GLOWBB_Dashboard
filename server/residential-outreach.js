import { analytics, todaySG } from "./domain.js";
import { readEffectiveData } from "./needs-domain.js";

export function normalizeResidence(block, street) {
  const parsed = String(block ?? "")
    .trim()
    .toUpperCase()
    .match(/^(?:BLK\s+)?([1-9]\d{0,3})\s*([A-Z]?)$/);
  const streetKey = String(street ?? "")
    .trim()
    .toUpperCase()
    .replace(/\bST\.?\s+(?=\d)/g, "STREET ")
    .replace(/\s+/g, " ");
  if (!parsed || !streetKey) return null;
  return {
    block: parsed[1] + parsed[2],
    number: Number(parsed[1]),
    suffix: parsed[2],
    street: streetKey,
  };
}

export function targetArea(address) {
  if (!address) return null;
  if (
    address.number >= 900 &&
    address.number <= 999 &&
    /^JURONG WEST STREET 9[123]$/.test(address.street)
  )
    return "900";
  if (
    address.number >= 701 &&
    address.number <= 710 &&
    /^JURONG WEST (?:STREET|AVENUE|CENTRAL) \d+$/.test(address.street)
  )
    return "701";
  return null;
}

export function mountResidentialOutreach(
  app,
  { db, storage, filters, aggregateCache },
) {
  app.get(
    ["/api/residential-outreach", "/api/residential-distribution"],
    async (req, res) => {
      const targeted = req.path === "/api/residential-outreach";
      const settings = await storage.getSettings(db);
      if (
        (targeted && req.authorizedCentreId !== "glow_nanyang") ||
        !["admin", "planner"].includes(req.user.role)
      ) {
        return res
          .status(403)
          .json({
            error: targeted
              ? "Targeted residential outreach requires authorised GLOW Nanyang access."
              : "Residential participation requires authorised staff access.",
          });
      }
      const requested = filters(req);
      const period = {
        from: requested.from,
        to: requested.to,
        interval: "month",
      };
      const report = await aggregateCache.run(
        req,
        targeted ? "residential-outreach" : "residential-distribution",
        async () => {
          const data = await readEffectiveData(db, storage);
          const observations =
            db.dialect === "postgres"
              ? (
                  await db.query(
                    `SELECT DISTINCT participant_id,
            jsonb_build_object('block',raw::jsonb->>'block','street',raw::jsonb->>'street') AS address
            FROM glowbb.profile_observations WHERE field=$1`,
                    ["residentialObservation"],
                  )
                ).rows
              : await db
                  .prepare(
                    "SELECT participant_id,raw FROM profile_observations WHERE field=?",
                  )
                  .all("residentialObservation");
          const byPerson = new Map();
          for (const row of observations) {
            const raw = row.address || JSON.parse(row.raw);
            const address = normalizeResidence(raw.block, raw.street);
            if (!byPerson.has(row.participant_id))
              byPerson.set(row.participant_id, new Set());
            byPerson
              .get(row.participant_id)
              .add(address ? JSON.stringify(address) : "");
          }
          const consistentAddresses = new Map();
          for (const [id, values] of byPerson) {
            if (values.size === 1 && !values.has("")) {
              consistentAddresses.set(id, JSON.parse([...values][0]));
            }
          }
          if (!targeted) {
            const today = todaySG();
            const sessions = new Map(
              data.sessions.map((session) => [session.id, session]),
            );
            const people = new Map(
              data.participants.map((person) => [person.id, person]),
            );
            const streets = new Map(),
              buildings = new Map();
            for (const row of data.attendance) {
              const session = sessions.get(row.sessionId);
              if (
                !session ||
                session.date > today ||
                (period.from && session.date < period.from) ||
                (period.to && session.date > period.to)
              )
                continue;
              const address = consistentAddresses.get(row.participantId);
              if (!address) continue;
              // Restrict released labels to recognisable street formats, excluding free text.
              if (
                !/^[A-Z]+(?: [A-Z]+)* (?:STREET|AVENUE|ROAD|DRIVE|CRESCENT|CLOSE|LANE|CENTRAL)(?: [0-9]+)?$/.test(
                  address.street,
                )
              )
                continue;
              for (const [index, label] of [
                [streets, address.street],
                [buildings, address.block + " " + address.street],
              ]) {
                if (!index.has(label))
                  index.set(label, {
                    people: new Set(),
                    seniors: new Set(),
                    attendance: 0,
                  });
                const group = index.get(label);
                group.people.add(row.participantId);
                if (people.get(row.participantId)?.age >= 60)
                  group.seniors.add(row.participantId);
                group.attendance++;
              }
            }
            const minimum = Math.max(5, settings.privacyMinimum || 5);
            const rows = (index) =>
              [...index.entries()]
                .filter(([, group]) => group.people.size >= minimum)
                .map(([label, group]) => ({
                  label,
                  residents: group.people.size,
                  seniors:
                    group.seniors.size >= minimum ? group.seniors.size : null,
                  attendance: group.attendance,
                }))
                .sort(
                  (a, b) =>
                    b.residents - a.residents || a.label.localeCompare(b.label),
                )
                .slice(0, 25);
            return {
              streets: rows(streets),
              buildings: rows(buildings),
              note: "Top 25 areas with sufficient recorded attendance. Uses consistent recorded residential observations.",
            };
          }
          const members = { 900: new Set(), 701: new Set() };
          let unresolved = 0;
          const sessionDates = new Map(
            data.sessions.map((s) => [s.id, s.date]),
          );
          const today = todaySG();
          const attendees = new Set(
            data.attendance
              .filter((a) => {
                const date = sessionDates.get(a.sessionId);
                return (
                  date &&
                  date <= today &&
                  (!period.from || date >= period.from) &&
                  (!period.to || date <= period.to)
                );
              })
              .map((a) => a.participantId),
          );
          for (const person of data.participants) {
            const address = consistentAddresses.get(person.id);
            if (!address) {
              if (attendees.has(person.id)) unresolved++;
              continue;
            }
            const area = targetArea(address);
            if (area) members[area].add(person.id);
            else if (
              !/^JURONG WEST (?:STREET|AVENUE|CENTRAL) \d+$/.test(
                address.street,
              ) &&
              ((address.number >= 701 && address.number <= 710) ||
                (address.number >= 900 && address.number <= 999)) &&
              attendees.has(person.id)
            )
              unresolved++;
          }
          const minimum = Math.max(5, settings.privacyMinimum || 5);
          const metrics = (row) => ({
            residents: row.allAges,
            seniors: row.unique,
            attendance: row.attendance,
            maleSeniors:
              row.male >= minimum && row.unique - row.male >= minimum
                ? row.male
                : null,
            minoritySeniors:
              row.minority >= minimum && row.unique - row.minority >= minimum
                ? row.minority
                : null,
            repeatSeniors:
              row.repeat >= minimum && row.unique - row.repeat >= minimum
                ? row.repeat
                : null,
          });
          const groups = Object.entries(members).map(([id, ids]) => {
            const report = analytics(
              {
                ...data,
                participants: data.participants.filter((p) => ids.has(p.id)),
                attendance: data.attendance.filter((a) =>
                  ids.has(a.participantId),
                ),
              },
              { ...settings, seniorAge: 60 },
              period,
              today,
              "overview",
            );
            return {
              id,
              label:
                id === "900"
                  ? "Jurong West 900 Series · Streets 91–93"
                  : "Jurong West Blocks 701–710",
              summary:
                report.summary.allAges >= minimum
                  ? metrics(report.summary)
                  : null,
              trends: report.trends
                .filter((r) => r.allAges >= minimum)
                .map((r) => ({ month: r.label, ...metrics(r) })),
              programmes: report.programmes
                .filter((p) => p.allAges >= minimum)
                .slice(0, 10)
                .map((p) => ({
                  name: p.name,
                  domains: p.combinedDomains,
                  sessions: p.sessions,
                  ...metrics(p),
                })),
            };
          });
          return {
            groups,
            unresolved: unresolved >= minimum ? unresolved : null,
            note: "Uses one consistent recorded address across available attendance observations. Conflicting or unresolved addresses are excluded. The address may differ from where a participant lived at the time of attendance.",
          };
        },
      );
      if (targeted && req.query.format === "print") {
        const escape = (value) =>
          String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
        const sections = report.groups
          .map(
            (group) =>
              `<section><h2>${escape(group.label)}</h2><p>${
                group.summary
                  ? Object.entries(group.summary)
                      .map(
                        ([key, value]) =>
                          escape(key) + ": " + (value ?? "Withheld"),
                      )
                      .join(" ? ")
                  : "No releasable results"
              }</p><h3>Top programmes</h3><ul>${group.programmes.map((row) => `<li>${escape(row.name)}: ${row.seniors} seniors</li>`).join("")}</ul></section>`,
          )
          .join("");
        return res
          .type("html")
          .send(
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>GLOW Nanyang residential outreach</title><h1>Targeted Residential Outreach</h1><p>${escape(period.from || "Available history")} to ${escape(period.to || todaySG())}</p><p>${escape(report.note)}</p>${sections}<p>Use your browser Print menu to save as PDF.</p></html>`,
          );
      }
      res.json(report);
    },
  );
}
