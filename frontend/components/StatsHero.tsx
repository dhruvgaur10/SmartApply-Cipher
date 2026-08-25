"use client";

import { useEffect, useState } from "react";
import { getStats, type JobStats } from "@/lib/api";

const TILES: { key: keyof JobStats; label: string }[] = [
  { key: "unique_jobs", label: "live roles to match against" },
  { key: "companies_hiring", label: "companies hiring right now" },
  { key: "sources_aggregated", label: "platforms searched, so you don't have to" },
];

export function StatsHero() {
  const [stats, setStats] = useState<JobStats | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="gradient-mesh rounded-lg p-6 sm:p-8 space-y-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--gold-dim)] uppercase bg-white/5 rounded-full px-3 py-1 border border-border">
        <span className="pulse-dot" />
        Skip the noise. Find your fit.
      </p>
      <h1 className="text-3xl sm:text-4xl font-display font-light text-balance">
        Here&apos;s what&apos;s <span className="text-gradient">actually worth your time.</span>
      </h1>
      <p className="text-muted-foreground max-w-2xl">
        Every role here is ranked against your resume, not just a keyword search &mdash;
        so you spend time applying, not sorting through noise. Upload a resume for a
        match score, a 7-day upskilling roadmap, and interview prep before you apply
        anywhere.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        {TILES.map((tile) => (
          <div
            key={tile.key}
            className="rounded-lg border border-border bg-white/[0.03] p-3"
          >
            <p className="text-2xl font-display font-light text-[var(--gold)]">
              {stats ? (stats[tile.key] as number) : "-"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{tile.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
