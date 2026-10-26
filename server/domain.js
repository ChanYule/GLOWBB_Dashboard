import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import unzipper from "unzipper";
import { parse } from "csv-parse/sync";
export const HEADERS = [
  "Name/Member ID",
  "Gender",
  "Name/Age",
  "Name/Race",
  "Name/CFS",
  "Is Client",
  "Within Boundary",
  "Activity Name",
  "AAP Domain",
  "Session Detail",
];
export const defaults = {
  seniorAge: 60,
  minority: ["MALAY", "INDIAN", "OTHERS"],
  ageBands: [70, 80],
  minSessions: 3,
  minParticipants: 5,
  privacyMinimum: 5,
};
export const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
export const todaySG = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const str = (x) => String(x ?? "").trim();
const upper = (x) => str(x).toUpperCase();
export function parseSession(value) {
  const m = str(value).match(
    /^(\d{4}-\d{2}-\d{2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (!m)
    throw Error("Use YYYY-MM-DD, hh:mm AM - hh:mm PM for Session Detail.");
  const date = m[1];
  if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw Error("Session date does not exist.");
  const time = (h, min, ap) => {
    h = Number(h);
    min = Number(min);
    if (h < 1 || h > 12 || min > 59) throw Error("Invalid session time.");
    return ((h % 12) + (upper(ap) === "PM" ? 12 : 0)) * 60 + min;
  };
  const start = time(m[2], m[3], m[4]),
    end = time(m[5], m[6], m[7]);
  if (end <= start)
    throw Error("End time must be after start time on the same day.");
  return { date, start, end };
}
function boolean(x) {
  if (["YES", "TRUE", "1", "Y"].includes(upper(x))) return true;
  if (["NO", "FALSE", "0", "N"].includes(upper(x))) return false;
  return null;
}
export function parseRows(matrix) {
  if (!matrix.length) throw Error("The file is empty.");
  const headers = matrix[0].map(str);
  const missing = HEADERS.filter((x) => !headers.includes(x));
  if (missing.length)
    throw Error("Missing required headers: " + missing.join(", "));
  if (new Set(headers).size !== headers.length)
    throw Error("Duplicate column headers are not supported.");
  const rows = [],
    issues = [],
    seen = new Set();
  let exactDuplicates = 0,
    blank = 0;
  matrix.slice(1).forEach((values, i) => {
    const row = i + 2;
    if (values.every((x) => !str(x))) {
      blank++;
      return;
    }
    const raw = Object.fromEntries(headers.map((h, j) => [h, str(values[j])]));
    const signature = hash(HEADERS.map((h) => raw[h]));
    if (seen.has(signature)) exactDuplicates++;
    seen.add(signature);
    try {
      const member = raw["Name/Member ID"];
      if (!member) throw Error("Member ID is required.");
      if (member.length > 200) throw Error("Member ID exceeds 200 characters.");
      const name = raw["Activity Name"];
      if (!name) throw Error("Activity Name is required.");
      if (name.length > 500)
        throw Error("Activity name exceeds 500 characters.");
      const session = parseSession(raw["Session Detail"]);
      const ageText = raw["Name/Age"];
      const age = ageText === "" ? null : Number(ageText);
      const warnings = [];
      if (age === null)
        warnings.push("Missing age: excluded from senior reach.");
      if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120))
        throw Error("Age must be a whole number from 0 to 120.");
      const gender = upper(raw.Gender) || "UNKNOWN",
        race = upper(raw["Name/Race"]) || "MISSING";
      if (!["MALE", "FEMALE"].includes(gender))
        warnings.push(
          "Gender is unknown or outside MALE/FEMALE; excluded from gender denominator.",
        );
      if (["UNKNOWN", "MISSING"].includes(race))
        warnings.push(
          "Race is " + race.toLowerCase() + "; excluded from race denominator.",
        );
      const client = boolean(raw["Is Client"]),
        boundary = boolean(raw["Within Boundary"]);
      if (client === null)
        warnings.push("Client status is missing or unrecognised.");
      if (boundary === null)
        warnings.push("Boundary status is missing or unrecognised.");
      const domain = raw["AAP Domain"] || "Unspecified";
      const programmeId = hash([name]);
      const sessionId = hash([
        programmeId,
        session.date,
        session.start,
        session.end,
        null,
      ]);
      const participant = {
        id: hash([member]),
        age,
        gender,
        race,
        cfs: raw["Name/CFS"] || null,
        client,
        boundary,
      };
      rows.push({
        row,
        participant,
        programme: { id: programmeId, name, domain },
        session: { id: sessionId, programmeId, ...session },
        id: hash([participant.id, sessionId]),
        warnings,
        sourceSession: raw["Session Detail"],
      });
    } catch (e) {
      const code = e.message.startsWith("Age must")
        ? "invalidAge"
        : /Session|session|time|date|End time/.test(e.message)
          ? "invalidSession"
          : "requiredField";
      issues.push({ row, message: e.message, code });
    }
  });
  return {
    rawRows: matrix.length - 1 - blank,
    rows,
    issues,
    exactDuplicates,
    blank,
  };
}
export async function readFile(buffer, name) {
  if (/\.csv$/i.test(name)) {
    let matrix;
    try {
      matrix = parse(
        new TextDecoder("utf-8", { fatal: true })
          .decode(buffer)
          .replace(/^\uFEFF/, ""),
        {
          bom: true,
          skip_empty_lines: true,
          relax_column_count: false,
          max_record_size: 65536,
        },
      );
    } catch {
      throw Error(
        "CSV could not be read. Check UTF-8 encoding, quoted fields and consistent column counts.",
      );
    }
    return parseRows(matrix);
  }
  if (!/\.xlsx$/i.test(name))
    throw Error("Upload an .xlsx workbook or UTF-8 .csv file.");
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
    throw Error("This is not a valid XLSX workbook.");
  const zip = await unzipper.Open.buffer(buffer);
  if (
    zip.files.length > 1000 ||
    zip.files.reduce((n, f) => n + f.uncompressedSize, 0) > 64 * 1024 * 1024
  )
    throw Error(
      "Workbook expands beyond the 64 MB safety limit. Export a smaller attendance file.",
    );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets.filter((s) =>
    HEADERS.every((h) => s.getRow(1).values.slice(1).map(str).includes(h)),
  );
  if (sheets.length !== 1)
    throw Error(
      "Exactly one worksheet must contain all attendance headers in row 1.",
    );
  const s = sheets[0];
  if (s.columnCount > 100) throw Error("Maximum 100 columns per worksheet.");
  if (s.rowCount > 50001)
    throw Error("Maximum 50,000 attendance rows per upload.");
  const matrix = [];
  s.eachRow({ includeEmpty: true }, (r) =>
    matrix.push(
      Array.from(
        { length: Math.max(HEADERS.length, s.columnCount) },
        (_, i) => {
          const c = r.getCell(i + 1);
          if (c.type === ExcelJS.ValueType.Formula)
            throw Error("Formula cells are not accepted. Export values only.");
          return c.text;
        },
      ),
    ),
  );
  return parseRows(matrix);
}
export function inspectImport(parsed, existing) {
  const participants = new Map(existing.participants.map((p) => [p.id, p])),
    programmes = new Map(existing.programmes.map((p) => [p.id, p])),
    att = new Set(existing.attendance.map((a) => a.id));
  const fresh = [],
    duplicates = [],
    conflicts = [],
    warnings = [],
    variants = [];
  const names = new Map();
  for (const p of [
    ...existing.programmes,
    ...parsed.rows.map((r) => r.programme),
  ]) {
    const key = p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (names.has(key) && names.get(key) !== p.name)
      variants.push([names.get(key), p.name]);
    else names.set(key, p.name);
  }
  for (const r of parsed.rows) {
    const old = participants.get(r.participant.id),
      pg = programmes.get(r.programme.id);
    const changes = old
      ? ["age", "gender", "race", "cfs", "client", "boundary"].filter(
          (k) => old[k] !== r.participant[k],
        )
      : [];
    if (changes.length || (pg && pg.domain !== r.programme.domain)) {
      conflicts.push({
        row: r.row,
        message: changes.length
          ? "Member details differ (" +
            changes.join(", ") +
            "). Row skipped; existing details retained."
          : "Programme domain differs. Row skipped; existing domain retained.",
      });
      continue;
    }
    if (att.has(r.id)) {
      duplicates.push(r.row);
      continue;
    }
    participants.set(r.participant.id, r.participant);
    programmes.set(r.programme.id, r.programme);
    att.add(r.id);
    fresh.push(r);
    warnings.push(...r.warnings.map((message) => ({ row: r.row, message })));
  }
  return {
    fresh,
    duplicates,
    conflicts,
    warnings,
    variants: [
      ...new Map(variants.map((v) => [JSON.stringify(v), v])).values(),
    ],
  };
}
const distinct = (arr, key) => new Set(arr.map(key)).size;
export function analytics(
  data,
  settings = defaults,
  filters = {},
  now = todaySG(),
) {
  const pmap = new Map(data.participants.map((p) => [p.id, p]));
  const pgmap = new Map(data.programmes.map((p) => [p.id, p]));
  const smap = new Map(data.sessions.map((s) => [s.id, s]));
  const all = data.attendance
    .map((a) => ({
      ...a,
      p: pmap.get(a.participantId),
      s: smap.get(a.sessionId),
    }))
    .filter((a) => a.p && a.s)
    .map((a) => ({ ...a, pg: pgmap.get(a.s.programmeId) }))
    .filter((a) => a.pg && a.s.date <= now);
  const first = new Map();
  for (const a of all) {
    if (!first.has(a.p.id) || a.s.date < first.get(a.p.id))
      first.set(a.p.id, a.s.date);
  }
  const isSenior = (p) => p.age !== null && p.age >= settings.seniorAge;
  const isMinority = (p) => settings.minority.includes(p.race);
  const base = all.filter(
    (a) =>
      (!filters.from || a.s.date >= filters.from) &&
      (!filters.to || a.s.date <= filters.to) &&
      (!filters.domain || a.pg.domain === filters.domain) &&
      (!filters.programme || a.pg.id === filters.programme) &&
      (!filters.gender || a.p.gender === filters.gender) &&
      (!filters.race || a.p.race === filters.race) &&
      (!filters.client || String(a.p.client) === filters.client) &&
      (!filters.boundary || String(a.p.boundary) === filters.boundary) &&
      (!filters.ageBand ||
        (a.p.age !== null &&
          a.p.age >= Number(filters.ageBand.split("-")[0]) &&
          a.p.age <= Number(filters.ageBand.split("-")[1]))) &&
      (!filters.target ||
        filters.target === "all" ||
        (filters.target === "male" && isSenior(a.p) && a.p.gender === "MALE") ||
        (filters.target === "minority" && isSenior(a.p) && isMinority(a.p))),
  );
  function stats(rows) {
    const seniors = rows.filter((a) => isSenior(a.p)),
      people = [...new Map(seniors.map((a) => [a.p.id, a.p])).values()];
    const counts = new Map();
    for (const a of seniors) {
      if (!counts.has(a.p.id)) counts.set(a.p.id, new Set());
      counts.get(a.p.id).add(a.s.id);
    }
    const male = people.filter((p) => p.gender === "MALE").length,
      minority = people.filter(isMinority).length,
      knownGender = people.filter((p) =>
        ["MALE", "FEMALE"].includes(p.gender),
      ).length,
      knownRace = people.filter(
        (p) => !["UNKNOWN", "MISSING"].includes(p.race),
      ).length;
    return {
      unique: people.length,
      male,
      minority,
      knownGender,
      knownRace,
      malePct: knownGender ? (male / knownGender) * 100 : null,
      minorityPct: knownRace ? (minority / knownRace) * 100 : null,
      unknownGender: people.length - knownGender,
      unknownRace: people.length - knownRace,
      missingRace: people.filter((p) => p.race === "MISSING").length,
      recordedUnknownRace: people.filter((p) => p.race === "UNKNOWN").length,
      attendance: rows.length,
      seniorAttendance: seniors.length,
      sessions: distinct(rows, (a) => a.s.id),
      repeat: [...counts.values()].filter((s) => s.size > 1).length,
      firstObserved: people.filter((p) => {
        const d = first.get(p.id);
        return (
          (!filters.from || d >= filters.from) &&
          (!filters.to || d <= filters.to)
        );
      }).length,
      frequency: people.length ? seniors.length / people.length : 0,
      average: distinct(rows, (a) => a.s.id)
        ? rows.length / distinct(rows, (a) => a.s.id)
        : 0,
      allAges: distinct(rows, (a) => a.p.id),
    };
  }
  const summary = stats(base),
    seniors = base.filter((a) => isSenior(a.p));
  const group = (rows, key) => {
    const map = new Map();
    for (const a of rows) {
      const k = key(a);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(a);
    }
    return [...map].map(([label, r]) => ({ label, ...stats(r) }));
  };
  const period = filters.interval || "month";
  const bucket = (date) => {
    if (period === "quarter")
      return date.slice(0, 4) + "-Q" + Math.ceil(Number(date.slice(5, 7)) / 3);
    if (period === "week") {
      const d = new Date(date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    return date.slice(0, 7);
  };
  let trends = group(base, (a) => bucket(a.s.date)).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const start = filters.from || all.map((a) => a.s.date).sort()[0],
    end = filters.to && filters.to < now ? filters.to : now;
  if (start && start <= end) {
    const d = new Date(start + "T00:00:00Z");
    const keys = new Set(trends.map((t) => t.label));
    let guard = 0;
    while (d.toISOString().slice(0, 10) <= end && guard++ < 36600) {
      const key = bucket(d.toISOString().slice(0, 10));
      if (!keys.has(key)) {
        trends.push({ label: key, ...stats([]) });
        keys.add(key);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    trends.sort((a, b) => a.label.localeCompare(b.label));
  }
  trends = trends.map((t) => ({ ...t, partial: t.label === bucket(now) }));
  const programmes = group(base, (a) => a.pg.id)
    .map((g) => {
      const r = base.filter((a) => a.pg.id === g.label),
        pg = pgmap.get(g.label),
        trend = group(r, (a) => a.s.date.slice(0, 7)).sort((a, b) =>
          a.label.localeCompare(b.label),
        );
      const sessionList = [
        ...new Map(r.map((a) => [a.s.id, a.s])).values(),
      ].sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...g,
        id: pg.id,
        name: pg.name,
        domain: pg.domain,
        optional: pg.optional || {},
        trend,
        sessionList,
        recurring: g.sessions > 1,
      };
    })
    .sort((a, b) => b.unique - a.unique || a.name.localeCompare(b.name));
  const people = [...new Map(seniors.map((a) => [a.p.id, a.p])).values()];
  const breakdown = (fn) =>
    Object.entries(
      people.reduce((o, p) => {
        const k = fn(p);
        o[k] = (o[k] || 0) + 1;
        return o;
      }, {}),
    ).map(([label, value]) => ({ label, value }));
  const frequencies = new Map();
  for (const a of seniors) {
    if (!frequencies.has(a.p.id)) frequencies.set(a.p.id, new Set());
    frequencies.get(a.p.id).add(a.s.id);
  }
  const frequency = [
    {
      label: "Once · 1 session",
      value: [...frequencies.values()].filter((s) => s.size === 1).length,
    },
    {
      label: "Occasionally · 2–4 sessions",
      value: [...frequencies.values()].filter((s) => s.size >= 2 && s.size <= 4)
        .length,
    },
    {
      label: "Frequently · 5+ sessions",
      value: [...frequencies.values()].filter((s) => s.size >= 5).length,
    },
  ];
  const timing = group(
    base,
    (a) =>
      [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][new Date(a.s.date + "T00:00:00Z").getUTCDay()] +
      " · " +
      (a.s.start < 720
        ? "Morning"
        : a.s.start < 1080
          ? "Afternoon"
          : "Evening"),
  );
  const recommendations = programmes.map((p) => {
    const evidence =
      p.sessions >= settings.minSessions && p.unique >= settings.minParticipants
        ? "Sufficient"
        : p.unique
          ? "Limited"
          : "Insufficient";
    // Only compare two fully observed calendar months, and require enough sessions in each.
    const full = p.trend.filter(
      (t) =>
        t.label < now.slice(0, 7) &&
        (!filters.from || filters.from <= t.label + "-01") &&
        (!filters.to ||
          filters.to >=
            new Date(
              Date.UTC(
                Number(t.label.slice(0, 4)),
                Number(t.label.slice(5, 7)),
                0,
              ),
            )
              .toISOString()
              .slice(0, 10)),
    );
    const recent = full.slice(-2);
    const decline =
      recent.length === 2 &&
      recent.every((t) => t.sessions >= settings.minSessions) &&
      recent[1].unique < recent[0].unique * 0.75;
    const category =
      evidence !== "Sufficient"
        ? "Review"
        : decline
          ? "Improve"
          : p.unique >=
              Math.max(settings.minParticipants, summary.unique * 0.25)
            ? "Expand"
            : "Maintain";
    const reason =
      evidence !== "Sufficient"
        ? "Evidence is limited; gather attendance and participant feedback before changing delivery."
        : decline
          ? "Reach fell by more than 25% between the last two complete observed months."
          : "Observed reach and repeat engagement support a planning discussion.";
    return {
      id: p.id,
      programme: p.name,
      category,
      target: "Seniors aged " + settings.seniorAge + "+",
      evidence,
      figures: `${p.unique} unique seniors · ${p.sessions} sessions · ${p.repeat} repeat participants`,
      reason,
      action:
        category === "Expand"
          ? "Assess an additional cycle or capacity."
          : category === "Improve"
            ? "Discuss attendance patterns and accessibility."
            : category === "Maintain"
              ? "Review continuing the current format."
              : "Collect more evidence before changing delivery.",
      next: "Check participant interest, staff availability and resources for the next 3–6 months.",
      limitations:
        "Attendance describes participation, not impact or causation. Cost, capacity, feedback and complete centre history are unavailable unless separately recorded.",
    };
  });
  let previous = null;
  if (!filters._noPrevious && filters.from && filters.to) {
    const from = new Date(filters.from + "T00:00:00Z"),
      to = new Date((filters.to < now ? filters.to : now) + "T00:00:00Z"),
      days = Math.round((to - from) / 86400000) + 1;
    const prevTo = new Date(+from - 86400000).toISOString().slice(0, 10),
      prevFrom = new Date(+from - days * 86400000).toISOString().slice(0, 10);
    if (all.some((a) => a.s.date <= prevFrom) && days > 0) {
      const prior = analytics(
        data,
        settings,
        { ...filters, from: prevFrom, to: prevTo, _noPrevious: true },
        now,
      );
      previous = { ...prior.summary, from: prevFrom, to: prevTo };
    }
  }
  return {
    summary,
    previous,
    trends,
    programmes,
    domains: group(base, (a) => a.pg.domain),
    gender: breakdown((p) => p.gender),
    race: breakdown((p) => p.race),
    ages: breakdown((p) =>
      p.age < settings.ageBands[0]
        ? `${settings.seniorAge}–${settings.ageBands[0] - 1}`
        : p.age < settings.ageBands[1]
          ? `${settings.ageBands[0]}–${settings.ageBands[1] - 1}`
          : `${settings.ageBands[1]}+`,
    ),
    clients: breakdown((p) =>
      p.client === null
        ? "Unknown"
        : p.client
          ? "Existing client"
          : "Other attendee",
    ),
    boundary: breakdown((p) =>
      p.boundary === null
        ? "Unknown"
        : p.boundary
          ? "Within boundary"
          : "Outside boundary",
    ),
    frequency,
    timing,
    recommendations,
    period: {
      from: filters.from || all.map((a) => a.s.date).sort()[0] || "",
      to: filters.to || now,
      now,
    },
    coverage: {
      from: all.map((a) => a.s.date).sort()[0] || null,
      to:
        all
          .map((a) => a.s.date)
          .sort()
          .at(-1) || null,
    },
    quality: {
      missingAge: data.participants.filter((p) => p.age === null).length,
      unknownGender: data.participants.filter(
        (p) => !["MALE", "FEMALE"].includes(p.gender),
      ).length,
      unknownRace: data.participants.filter((p) => p.race === "UNKNOWN").length,
      missingRace: data.participants.filter((p) => p.race === "MISSING").length,
      futureSessions: data.sessions.filter((s) => s.date > now).length,
      missingVenue: data.sessions.filter((s) => !s.venue).length,
    },
    options: {
      domains: [...new Set(data.programmes.map((p) => p.domain))].sort(),
      programmes: data.programmes.map((p) => ({ id: p.id, name: p.name })),
      races: [...new Set(data.participants.map((p) => p.race))].sort(),
    },
  };
}
