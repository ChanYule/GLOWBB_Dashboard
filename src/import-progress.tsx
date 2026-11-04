export function ImportProgress({ step }: { step: number }) {
  return (
    <ol className="import-progress" aria-label="Import progress">
      {[
        "Choose file",
        "Preview records",
        "Review changes",
        "Confirm save",
        "Result",
      ].map((label, i) => (
        <li
          key={label}
          aria-current={step === i + 1 ? "step" : undefined}
          className={
            step > i + 1 ? "complete" : step === i + 1 ? "current" : ""
          }
        >
          <b>{step > i + 1 ? "✓" : i + 1}</b>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
