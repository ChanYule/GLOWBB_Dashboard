export function MetricHelp({
  label,
  definition,
}: {
  label: string;
  definition: string;
}) {
  return (
    <details className="metric-help">
      <summary aria-label={"About " + label} title={definition}>
        Info
      </summary>
      <p>{definition}</p>
    </details>
  );
}
