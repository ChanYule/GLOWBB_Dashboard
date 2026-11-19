import { useState } from "react";
import {
  analysisDimensions,
  populations,
  compatibleAnalysis,
} from "../shared/participation-compat.js";
type Query = Record<string, string>;
export function PatternControls({
  query: q,
  onChange,
  onPresent,
  onSave,
  onReset,
  onRefresh,
  loading,
  presentDisabled = false,
  destinations = [],
  onNotice,
}: {
  query: Query;
  onChange: (q: Query) => void;
  onPresent?: () => void;
  onSave: () => void;
  onReset: () => void;
  onRefresh: () => void;
  loading: boolean;
  presentDisabled?: boolean;
  destinations?: { id: string; label: string }[];
  onNotice?: (message: string) => void;
}) {
  const [more, setMore] = useState(false),
    [period, setPeriod] = useState(q.from || q.to ? "custom" : "history");
  const change = (key: string, value: string) => {
    const next = {
      ...q,
      [key]: value,
      page: "0",
      group: "",
      programme: "",
      second: "",
    };
    const compatible = compatibleAnalysis(next.scope, next.dimension);
    if (compatible.notice) onNotice?.(compatible.notice);
    onChange({ ...next, scope: compatible.scope });
  };
  const preset =
    q.dimension === "distance"
      ? "distance"
      : q.dimension === "eventType"
        ? "eventType"
        : q.ranking === "repeat"
          ? "repeat"
          : q.scope === "overall"
            ? "overall"
            : q.dimension;
  return (
    <section className="panel patterns-controls compact-pattern-controls">
      <div className="patterns-toolbar">
        <label>
          Analyse by
          <select
            aria-label="Analyse by"
            value={q.dimension}
            onChange={(e) => change("dimension", e.target.value)}
          >
            {Object.entries(analysisDimensions).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="work-actions">
          {onPresent && (
            <button
              className="button primary"
              disabled={presentDisabled || loading}
              onClick={onPresent}
            >
              Presentation / PDF
            </button>
          )}
          <button className="button" disabled={loading} onClick={onRefresh}>
            Refresh analysis
          </button>
        </div>
      </div>
      <div className="patterns-primary-filters">
        <details className="patterns-guided"><summary>Explore a staff question</summary>
        <label>
          What would you like to understand?
          <select
            aria-label="Analysis preset"
            value={preset}
            onChange={(e) => {
              const v = e.target.value;
              const dimension = ["repeat", "overall"].includes(v)
                ? q.dimension
                : v;
              const scope = v === "overall" ? "overall" : q.scope;
              onChange({
                ...q,
                dimension,
                scope: compatibleAnalysis(scope, dimension).scope,
                ranking: v === "repeat" ? "repeat" : "unique",
                group: "",
                second: "",
                programme: "",
                page: "0",
              });
            }}
          >
            {[
              ["age", "Who attends in each age group?"],
              ["cfs", "Does attendance differ by recorded CFS?"],
              ["risk", "Does participation differ by recorded social risk?"],
              ["race", "Which groups are we reaching?"],
              ["living", "Does attendance differ by living arrangement?"],
              ["repeat", "Which programmes bring people back?"],
              ["overall", "Who attends across all programmes?"],
              ["gender", "Which programmes attract male and female seniors?"],
              ["block", "Which residential blocks have lower participation?"],
              ["distance", "Does participation differ by distance?"],
              ["eventType", "Which programme types attract participants?"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label></details>
        <label>
          Population
          <select
            aria-label="Analysis population"
            value={q.scope}
            onChange={(e) => change("scope", e.target.value)}
          >
            {Object.entries(populations).map(([v, p]) => (
              <option
                value={v}
                key={v}
                disabled={
                  ["distance", "block"].includes(q.dimension) && v !== "clients"
                }
              >
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reporting period
          <select
            aria-label="Patterns reporting period"
            value={period === "history" && (q.from || q.to) ? "custom" : period}
            onChange={(e) => {
              const value = e.target.value;
              setPeriod(value);
              if (value === "custom") {
                setMore(true);
                return;
              }
              const next = { ...q, from: "", to: "", group: "", programme: "" };
              if (value !== "history") {
                const date = new Date();
                const today = new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Asia/Singapore",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).format(date);
                const [year, month] = today.split("-").map(Number);
                next.from = new Date(Date.UTC(year, month - Number(value), 1))
                  .toISOString()
                  .slice(0, 10);
                next.to = today;
              }
              onChange(next);
            }}
          >
            <option value="history">Available history</option>
            <option value="3">Last 3 months</option>
            <option value="6">Last 6 months</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        <button
          className="button"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          More filters
        </button>
      </div>
      {more && (
        <>
          {q.dimension === "distance" && (
            <div className="patterns-filter-grid">
              <label>
                Distance measure
                <select
                  aria-label="Distance measure"
                  value={q.distanceMetric || "walking"}
                  onChange={(e) => change("distanceMetric", e.target.value)}
                >
                  <option value="walking">Walking-route distance</option>
                  <option value="straight">
                    Straight-line distance (not walking)
                  </option>
                  <option value="time">Estimated walking-route time</option>
                </select>
              </label>
              <label>
                Distance destination
                <select
                  aria-label="Distance destination"
                  value={q.destination || "centre"}
                  onChange={(e) => change("destination", e.target.value)}
                >
                  {(destinations.length
                    ? destinations
                    : [{ id: "centre", label: "Selected centre reference location" }]
                  ).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="patterns-extra-filters">
            <div className="patterns-filter-grid">
              <label>
                From
                <input
                  aria-label="Patterns from"
                  type="date"
                  value={q.from || ""}
                  onChange={(e) => {
                    setPeriod("custom");
                    change("from", e.target.value);
                  }}
                />
              </label>
              <label>
                To
                <input
                  aria-label="Patterns to"
                  type="date"
                  value={q.to || ""}
                  onChange={(e) => {
                    setPeriod("custom");
                    change("to", e.target.value);
                  }}
                />
              </label>
              <label>
                Profile basis
                <select
                  aria-label="Profile basis"
                  value={q.basis || "current"}
                  onChange={(e) => change("basis", e.target.value)}
                >
                  <option value="current">Current recorded profiles</option>
                  <option value="dated">Dated snapshots at period end</option>
                </select>
              </label>
            </div>
            <div className="work-actions">
              <button className="button" onClick={onSave}>
                Save preferred view
              </button>
              <button
                className="button"
                onClick={() => {
                  setPeriod("history");
                  onReset();
                }}
              >
                Reset analysis
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
