import { useState } from "react";

export type MeetingLayout = {
  name: string;
  sections: number[];
  period: "selected" | "month" | "quarter";
};
const storageKey = "glow.display.seen_nanyang.layouts";
const templates: MeetingLayout[] = [
  {
    name: "Monthly Management Meeting",
    sections: [0, 1, 2, 5, 7],
    period: "month",
  },
  {
    name: "Quarterly Performance Review",
    sections: [0, 1, 2, 3, 4, 5, 6, 7],
    period: "quarter",
  },
  {
    name: "Programme Planning Meeting",
    sections: [2, 3, 7],
    period: "selected",
  },
  {
    name: "Male and Minority Outreach",
    sections: [4, 1, 7],
    period: "selected",
  },
  {
    name: "Participant Engagement Review",
    sections: [5, 1, 3],
    period: "selected",
  },
  {
    name: "Participant Needs and Accessibility",
    sections: [6, 5, 7],
    period: "selected",
  },
];
export function meetingPeriod(
  preset: MeetingLayout["period"],
  selected: { from: string; to: string },
  today: string,
) {
  if (preset === "selected" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return selected;
  const [year, month] = today.split("-").map(Number);
  const boundary =
    preset === "month" ? month - 1 : Math.floor((month - 1) / 3) * 3;
  return {
    from: new Date(Date.UTC(year, boundary - (preset === "month" ? 1 : 3), 1))
      .toISOString()
      .slice(0, 10),
    to: new Date(Date.UTC(year, boundary, 0)).toISOString().slice(0, 10),
  };
}
function savedLayouts(count: number): MeetingLayout[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) || "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (item) =>
              item &&
              typeof item.name === "string" &&
              ["selected", "month", "quarter"].includes(item.period) &&
              Array.isArray(item.sections) &&
              item.sections.length > 0 &&
              item.sections.every(
                (n: unknown) =>
                  typeof n === "number" &&
                  Number.isInteger(n) &&
                  n >= 0 &&
                  n < count,
              ),
          )
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function MeetingLayouts({
  sections,
  onOpen,
}: {
  sections: string[];
  onOpen: (layout: MeetingLayout) => void;
}) {
  const [saved, setSaved] = useState(() => savedLayouts(sections.length));
  const [selected, setSelected] = useState("template:0");
  const [draft, setDraft] = useState<MeetingLayout>(templates[0]);
  const [notice, setNotice] = useState("");
  function choose(value: string) {
    setSelected(value);
    const [kind, index] = value.split(":");
    setDraft(
      (kind === "saved" ? saved : templates)[Number(index)] || {
        name: "",
        sections: sections.map((_, i) => i),
        period: "selected",
      },
    );
  }
  function persist(next: MeetingLayout[]) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(next);
      return true;
    } catch {
      setNotice("This browser could not save the layout.");
      return false;
    }
  }
  function save(duplicate = false) {
    const name = draft.name.trim();
    if (!name || !draft.sections.length) {
      setNotice("Enter a name and choose at least one section.");
      return;
    }
    const next = [...saved],
      index =
        !duplicate && selected.startsWith("saved:")
          ? Number(selected.split(":")[1])
          : next.length;
    if (index >= 20) {
      setNotice("Delete a saved layout before adding another.");
      return;
    }
    next[index] = { ...draft, name: duplicate ? name + " copy" : name };
    if (persist(next)) {
      setSelected("saved:" + index);
      setDraft(next[index]);
      setNotice("Layout saved on this device.");
    }
  }
  function move(index: number, direction: number) {
    const order = [...draft.sections];
    [order[index], order[index + direction]] = [
      order[index + direction],
      order[index],
    ];
    setDraft({ ...draft, sections: order });
  }
  return (
    <details className="panel meeting-layouts seen-meeting-controls">
      <summary>My Meeting Layouts</summary>
      <label>
        Open layout{" "}
        <select value={selected} onChange={(e) => choose(e.target.value)}>
          <option value="new">Create layout</option>
          {templates.map((layout, i) => (
            <option key={layout.name} value={"template:" + i}>
              {layout.name}
            </option>
          ))}
          {saved.map((layout, i) => (
            <option key={i} value={"saved:" + i}>
              {layout.name} (saved)
            </option>
          ))}
        </select>
      </label>
      <label>
        Layout name{" "}
        <input
          value={draft.name}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        Reporting period{" "}
        <select
          value={draft.period}
          onChange={(e) =>
            setDraft({
              ...draft,
              period: e.target.value as MeetingLayout["period"],
            })
          }
        >
          <option value="selected">Current dashboard dates</option>
          <option value="month">Previous completed month</option>
          <option value="quarter">Previous completed quarter</option>
        </select>
      </label>
      <ol>
        {draft.sections.map((id, index) => (
          <li key={id}>
            {sections[id]}{" "}
            <button
              className="button"
              aria-label={"Move " + sections[id] + " up"}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>{" "}
            <button
              className="button"
              aria-label={"Move " + sections[id] + " down"}
              disabled={index === draft.sections.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>{" "}
            <button
              className="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  sections: draft.sections.filter((item) => item !== id),
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <label>
        Add section{" "}
        <select
          value=""
          onChange={(e) => {
            if (e.target.value !== "")
              setDraft({
                ...draft,
                sections: [...draft.sections, Number(e.target.value)],
              });
          }}
        >
          <option value="">Choose a section</option>
          {sections.map(
            (title, id) =>
              !draft.sections.includes(id) && (
                <option key={id} value={id}>
                  {title}
                </option>
              ),
          )}
        </select>
      </label>
      <div className="work-actions">
        <button
          className="button primary"
          disabled={!draft.sections.length}
          onClick={() => onOpen(draft)}
        >
          Present now
        </button>
        <button className="button" onClick={() => save()}>
          Save layout
        </button>
        <button className="button" onClick={() => save(true)}>
          Duplicate layout
        </button>
        {selected.startsWith("saved:") && (
          <button
            className="button"
            onClick={() => {
              if (
                persist(
                  saved.filter(
                    (_, index) => index !== Number(selected.split(":")[1]),
                  ),
                )
              ) {
                choose("template:0");
                setNotice("Saved layout deleted.");
              }
            }}
          >
            Delete layout
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
