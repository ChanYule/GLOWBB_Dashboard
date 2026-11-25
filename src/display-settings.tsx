import { useSyncExternalStore } from "react";

type Mode = "number" | "percentage";
const preferenceFallback = new Map<string, string>();
const eventName = "dashboard-display-change";
const read = (key: string, fallback: string) => {
  try {
    return (
      window.localStorage.getItem("glow.display." + key) ||
      fallback
    );
  } catch {
    return preferenceFallback.get(key) || fallback;
  }
};
const write = (key: string, value: string) => {
  preferenceFallback.set(key, value);
  try {
    window.localStorage.setItem("glow.display." + key, value);
  } catch {
    /* Optional storage. */
  }
  window.dispatchEvent(new Event(eventName));
};
function subscribe(update: () => void) {
  window.addEventListener(eventName, update);
  window.addEventListener("storage", update);
  return () => {
    window.removeEventListener(eventName, update);
    window.removeEventListener("storage", update);
  };
}
export function useDisplayOption(key: string, fallback: string) {
  return useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
}
export function useChartMode(
  chart?: string,
): [Mode, string, (value: string) => void] {
  const display = useDisplayOption("values", "number");
  const key = "chart." + (chart || "");
  const override = useDisplayOption(key, "default");
  return [
    (override === "default" ? display : override) === "percentage"
      ? "percentage"
      : "number",
    override,
    (value) => write(key, value),
  ];
}
export function DisplaySettings() {
  const theme = useDisplayOption("theme", "system");
  const values = useDisplayOption("values", "number");
  const size = useDisplayOption("size", "standard");
  return (
    <details
      className="display-settings"
      onKeyDown={(e) => {
        if (e.key === "Escape")
          e.currentTarget.removeAttribute("open");
      }}
    >
      <summary>Display</summary>
      <div className="display-settings-menu">
        <button
          type="button"
          className="text-button"
          onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
          }}
        >
          Close
        </button>
        <label>
          Theme{" "}
          <select
            value={theme}
            onChange={(e) => {
              write("theme", e.target.value);
              document.documentElement.dataset.theme = e.target.value;
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Chart values{" "}
          <select
            value={values}
            onChange={(e) => write("values", e.target.value)}
          >
            <option value="number">Number</option>
            <option value="percentage">Percentage</option>
          </select>
        </label>
        <label>
          Chart size{" "}
          <select
            value={size}
            onChange={(e) => {
              write("size", e.target.value);
              document.documentElement.dataset.chartSize = e.target.value;
            }}
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
            <option value="extra-large">Extra large</option>
          </select>
        </label>
      </div>
    </details>
  );
}
