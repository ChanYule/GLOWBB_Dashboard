const bins = [
  { label: "1", from: 1, to: 1 },
  { label: "2–3", from: 2, to: 3 },
  { label: "4–5", from: 4, to: 5 },
  { label: "6–10", from: 6, to: 10 },
  { label: "11–20", from: 11, to: 20 },
  { label: "21+", from: 21, to: Infinity },
];

// Attendees only: one distinct person-session count per participating person.
// Linear interpolation at (n - 1) * p, including for small samples. Never send
// the source values/identities to the browser; return aggregate summaries only.
export function sessionDistribution(counts) {
  if (
    !Array.isArray(counts) ||
    counts.some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    return null;
  const sorted = [...counts].sort((a, b) => a - b);
  const quantile = (p) => {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position),
      fraction = position - lower;
    return (
      sorted[lower] + fraction * (sorted[Math.ceil(position)] - sorted[lower])
    );
  };
  return {
    participants: sorted.length,
    median: quantile(0.5),
    q1: quantile(0.25),
    q3: quantile(0.75),
    mean: sorted.length
      ? sorted.reduce((sum, n) => sum + n, 0) / sorted.length
      : null,
    bins: bins.map((bin) => ({
      label: bin.label,
      count: sorted.filter((n) => n >= bin.from && n <= bin.to).length,
    })),
  };
}
