import { useId } from "react";
import type { ReactNode } from "react";
export function PageHeader({
  title,
  description,
  context,
  action,
}: {
  title: string;
  description?: string;
  context?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="experience-page-header">
      <div>
        {context && <div className="experience-context">{context}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function LoadingState({
  label = "Loading results…",
}: {
  label?: string;
}) {
  return (
    <div className="experience-loading" role="status" aria-label={label}>
      <span>{label}</span>
      <div aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="experience-error" role="alert">
      <h2>Results could not be loaded</h2>
      <p>{message}</p>
      <button className="button" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}
export function InsightCard({
  title,
  finding,
  why,
  check,
  action,
  onAction,
}: {
  title: string;
  finding: string;
  why: string;
  check: string;
  action: string;
  onAction?: () => void;
}) {
  const id = useId();
  return (
    <article className="experience-insight" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <dl>
        <div>
          <dt>What we found</dt>
          <dd>{finding}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{why}</dd>
        </div>
        <div>
          <dt>What to check next</dt>
          <dd>{check}</dd>
        </div>
      </dl>
      {onAction ? (
        <button className="text-button" onClick={onAction}>
          {action}
        </button>
      ) : (
        <p className="experience-action">{action}</p>
      )}
    </article>
  );
}
