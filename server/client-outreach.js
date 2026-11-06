import { clientContext } from "./client-domain.js";
import { todaySG } from "./domain.js";
const fail = (message) => Object.assign(Error(message), { status: 400 });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const employment = (p) => p.employmentStatus || "Not recorded";
export function clientOutreach(state, input = {}, now = todaySG()) {
  const {
    cohort = "all",
    status = "no-attendance",
    employment: work = "",
    page = 0,
    pageSize = 25,
    filters = {},
  } = input;
  if (
    Object.keys(input).some(
      (k) =>
        ![
          "cohort",
          "status",
          "employment",
          "page",
          "pageSize",
          "filters",
        ].includes(k),
    ) ||
    !["all", "young", "minority", "alone", "inactive"].includes(cohort) ||
    !["all", "attending", "no-attendance"].includes(status) ||
    ![
      "",
      "Working",
      "Not working",
      "Retired",
      "Unknown",
      "Not recorded",
      "Prefers not to say",
    ].includes(work) ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !filters ||
    typeof filters !== "object" ||
    Array.isArray(filters)
  )
    throw fail("Choose supported outreach filters and pagination.");
  if (filters.status)
    throw fail(
      "Use the outreach attendance selector to keep registry denominators intact.",
    );
  const ctx = clientContext(state, filters, now),
    { settings, members } = ctx;
  if (cohort === "inactive" && !ctx.historyCurrent)
    throw fail(
      "Inactivity is unavailable beyond attendance coverage. Choose a reporting date on or before " +
        (ctx.coverage.to || "the latest imported attendance") +
        ".",
    );
  const young = (p) => p.age != null && p.age >= 60 && p.age <= 69;
  const senior = (p) => p.age != null && p.age >= 60;
  const minority = (p) => senior(p) && settings.minority.includes(p.race);
  const alone = (p) =>
    senior(p) &&
    (settings.livingGroups?.[p.livingRaw] || p.livingRaw) === "Alone";
  const inactive = (p) => ctx.historyCurrent && p.status.startsWith("inactive");
  const summary = (rows) => {
    const attended = rows.filter((p) => p.selectedSessions > 0).length;
    return {
      registered: rows.length,
      attending: ctx.coverage.from ? attended : null,
      noAttendance: ctx.coverage.from ? rows.length - attended : null,
      rate: ctx.coverage.from ? pct(attended, rows.length) : null,
      inactive: ctx.historyCurrent ? rows.filter(inactive).length : null,
      working: rows.filter((p) => employment(p) === "Working").length,
      employmentNotRecorded: rows.filter((p) =>
        ["Unknown", "Not recorded"].includes(employment(p)),
      ).length,
    };
  };
  const eligible = (p) =>
    cohort === "young"
      ? young(p)
      : cohort === "minority"
        ? minority(p)
        : cohort === "alone"
          ? alone(p)
          : cohort === "inactive"
            ? inactive(p)
            : true;
  const selected = ctx.selected.filter(
    (p) => eligible(p) && (!work || employment(p) === work),
  );
  const grouped = (rows, label) => {
    const groups = new Map();
    for (const p of rows) {
      const value = label(p),
        key = value == null || value === "" ? "Not recorded" : String(value);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups].map(([label, rows]) => ({ label, ...summary(rows) }));
  };
  const ageProfile = grouped(members, (p) =>
    p.age == null
      ? "Age not recorded"
      : p.age < 60
        ? "Below 60"
        : p.age < 70
          ? "60–69"
          : p.age < 80
            ? "70–79"
            : "80+",
  );
  const order = ["Below 60", "60–69", "70–79", "80+", "Age not recorded"];
  ageProfile.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  const rows = selected
    .filter((p) =>
      status === "attending"
        ? p.selectedSessions > 0
        : status === "no-attendance"
          ? p.selectedSessions === 0
          : true,
    )
    .sort(
      (a, b) =>
        String(a.blockRaw || "").localeCompare(String(b.blockRaw || ""), "en", {
          numeric: true,
        }) || String(a.memberId).localeCompare(String(b.memberId)),
    );
  const people = rows
    .slice(page * pageSize, (page + 1) * pageSize)
    .map((p) => ({
      id: p.id,
      memberId: p.memberId || "ID not recorded",
      age: p.age ?? null,
      living: p.livingRaw || "Not recorded",
      race: p.race || "Not recorded",
      block: p.blockRaw || "Not recorded",
      cfs: p.cfs || "Not recorded",
      risk: p.riskRaw ?? "Not recorded",
      employment: employment(p),
      employmentSource: p.employmentSource || "",
      employmentRecordedOn: p.employmentRecordedOn || null,
      last: p.last,
      days: p.days,
      status: p.status,
      attendance: p.selectedSessions,
      followUp: p.contact?.outcome || "Not contacted",
      assigned: p.contact?.assigned || p.profile.followUp?.assigned || "",
      lastContact: p.contact?.date || null,
      profileRevision: p.profile.revision || 0,
      membershipRevision: p.revision || 0,
    }));
  const blocks = grouped(selected, (p) => p.blockRaw).sort(
    (a, b) =>
      (b.noAttendance || 0) - (a.noAttendance || 0) ||
      b.registered - a.registered ||
      a.label.localeCompare(b.label, "en", { numeric: true }),
  );
  return {
    available: members.length > 0,
    complete:
      settings.registry?.complete === true &&
      settings.registry?.type === "clients",
    registryAsOf: settings.registry?.asOf || null,
    period: {
      from: filters.from || ctx.coverage.from,
      to: filters.to || filters.asOf || now,
      asOf: ctx.q.asOf,
    },
    coverage: ctx.coverage,
    historyCurrent: ctx.historyCurrent,
    historyNote: ctx.historyNote,
    inactiveAfterDays: settings.inactivityBands[1],
    cohort,
    summary: summary(selected),
    fullRegistry: summary(members),
    ageProfile,
    priorities: [
      ["all", "All registered clients", members],
      ["young", "Young seniors · 60–69", members.filter(young)],
      [
        "minority",
        "Minority seniors · configured races",
        members.filter(minority),
      ],
      ["alone", "Seniors recorded living alone", members.filter(alone)],
      [
        "inactive",
        "Previously attended, now inactive",
        members.filter(inactive),
      ],
    ].map(([id, label, rows]) => ({ id, label, ...summary(rows) })),
    blocks,
    people: { rows: people, total: rows.length, page, pageSize },
    profiles: {
      cfs: grouped(
        selected,
        (p) => settings.cfsMappings?.[p.cfs]?.label || p.cfs,
      ),
      risk: grouped(
        selected,
        (p) => settings.riskMappings?.[p.riskRaw]?.label || p.riskRaw,
      ),
      age: grouped(selected, (p) => p.ageGroup),
    },
    options: {
      cfs: [...new Set(members.map((p) => p.cfs).filter(Boolean))].sort(),
      risk: [
        ...new Set(
          members.map((p) => p.riskRaw).filter((v) => v != null && v !== ""),
        ),
      ].sort(),
      blocks: [...new Set(members.map((p) => p.blockRaw).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "en", { numeric: true }),
      ),
    },
    note: "Current registered-client population, all ages. Attendance uses the selected period; work-list attendance filters do not change coverage denominators. Block labels are retained exactly; streets are not inferred. Employment is never inferred from age or attendance. CFS/SRF are recorded profiles, not evidence of a reason for non-participation.",
  };
}
