import { MetricHelp } from "./metric-help";
export function AnalysisStamp({
  metadata,
  coverage = {from:null,to:null},
}: {
  metadata?: { lastUpdatedAt?: string | null; generatedAt?: string;reporting?:{label:string;version:number} };
  coverage?: { from: string | null; to: string | null };
}) {
  const stamp = metadata?.lastUpdatedAt;
  return (
    <div className="analysis-stamp">
      {metadata?.reporting&&<strong>{metadata.reporting.label} · Configuration version {metadata.reporting.version}</strong>}
      <span>
        Data last updated:{" "}
        {stamp && Number.isFinite(Date.parse(stamp))
          ? new Date(stamp).toLocaleString("en-SG", {
              timeZone: "Asia/Singapore",
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "Unavailable"}
      </span>
      <span>
        Attendance coverage: {coverage.from || "Unavailable"} to{" "}
        {coverage.to || "Unavailable"}
      </span>
      <MetricHelp
        label="Data last updated"
        definition="Latest recorded attendance import, registry import, profile, feedback or planning-action update supplied by the backend. This is separate from report generation time. Coverage dates describe available attendance, not today's date."
      />
    </div>
  );
}
