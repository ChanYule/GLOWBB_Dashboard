import { Children, isValidElement, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Info, X } from "lucide-react";
import { HorizontalRankingChart } from "./chart-system";
import type { Count } from "./types";
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`${primary ? "button primary" : "button"} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Select({
  label,
  value,
  onChange,
  children,
  multiple = false,
}: {
  multiple?: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  if (multiple) {
    let selected: string[] = [];
    try {
      selected = value.startsWith("[")
        ? JSON.parse(value)
        : value
          ? [value]
          : [];
    } catch {
      selected = [];
    }
    return (
      <div className="field work-multiselect">
        <span>{label}</span>
        <details>
          <summary>
            {selected.length ? `${selected.length} selected` : "All"}
          </summary>
          <button className="text-button" onClick={() => onChange("")}>
            Clear {label.toLowerCase()}
          </button>
          {Children.toArray(children)
            .filter(isValidElement<{ value?: string; children?: ReactNode }>)
            .map((child, i) => {
              const v = String(child.props.value ?? child.props.children ?? "");
              return v ? (
                <label key={i} className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.includes(v)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, v]
                        : selected.filter((x) => x !== v);
                      onChange(
                        next.length > 1 ? JSON.stringify(next) : next[0] || "",
                      );
                    }}
                  />
                  {child.props.children}
                </label>
              ) : null;
            })}
        </details>
      </div>
    );
  }
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="note">
      <Info size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
export function Bars({
  items,
  unit = "seniors",
  color = "teal",
  onSelect,
}: {
  items: Count[];
  unit?: string;
  color?: string;
  onSelect?: (label: string) => void;
}) {
  return (
    <HorizontalRankingChart
      rows={items.map((item) => ({ ...item, detail: unit }))}
      onSelect={onSelect}
      tone={color === "teal" ? "attendance" : "demographic"}
    />
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`${wide ? "modal wide" : "modal"} ${drawer ? "programme-drawer" : ""}`}
      onCancel={onClose}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
