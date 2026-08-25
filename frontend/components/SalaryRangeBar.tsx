"use client";

import type { ExperienceLevelBand } from "@/lib/api";

// Pure data, no AI - positions this job's salary range against the market
// median for its experience tier as a compact horizontal bar.
export function SalaryRangeBar({
  minLpa,
  maxLpa,
  band,
}: {
  minLpa: number | null;
  maxLpa: number | null;
  band: ExperienceLevelBand | undefined;
}) {
  if (!band || (minLpa == null && maxLpa == null)) return null;

  const jobMid = minLpa != null && maxLpa != null ? (minLpa + maxLpa) / 2 : minLpa ?? maxLpa ?? 0;
  const scaleMax = Math.max(band.max_lpa, jobMid) * 1.05;
  const scaleMin = Math.min(band.min_lpa, jobMid) * 0.95;
  const range = scaleMax - scaleMin || 1;

  const clamp = (v: number) => Math.min(100, Math.max(0, ((v - scaleMin) / range) * 100));
  const medianPct = band.median_lpa != null ? clamp(band.median_lpa) : null;
  const jobPct = clamp(jobMid);

  return (
    <div className="space-y-1">
      <div className="relative h-1.5 rounded-full bg-muted">
        {medianPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-muted-foreground/50"
            style={{ left: `${medianPct}%` }}
            title={`Market median: ${band.median_lpa} LPA`}
          />
        )}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background"
          style={{ left: `${jobPct}%`, transform: "translate(-50%, -50%)" }}
          title={`This role: ~${jobMid.toFixed(1)} LPA`}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        {jobMid > (band.median_lpa ?? jobMid)
          ? "Above median for this experience level"
          : jobMid < (band.median_lpa ?? jobMid)
            ? "Below median for this experience level"
            : "At market median"}
      </p>
    </div>
  );
}
