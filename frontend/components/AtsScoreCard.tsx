"use client";

import { Badge } from "@/components/ui/badge";
import { PreviewCard, PreviewCardTrigger, PreviewCardContent } from "@/components/ui/preview-card";
import type { AtsReport } from "@/lib/types";
import { ShieldCheck, AlertTriangle, Info } from "lucide-react";

const SEVERITY_TONE: Record<string, "bad" | "warn" | "outline"> = {
  high: "bad",
  medium: "warn",
  low: "outline",
};

function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

export function AtsScoreCard({ report }: { report: AtsReport }) {
  const tone = scoreTone(report.score);
  const toneColor = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : "var(--bad)";

  return (
    <div className="card-flat p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-light text-xl flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          ATS Friendliness
          <PreviewCard>
            <PreviewCardTrigger className="text-muted-foreground hover:text-foreground">
              <Info className="h-3.5 w-3.5" />
            </PreviewCardTrigger>
            <PreviewCardContent>
              How easily an Applicant Tracking System can parse this resume, independent of any specific job.
            </PreviewCardContent>
          </PreviewCard>
        </h2>
        <span className="text-2xl font-display font-light" style={{ color: toneColor }}>
          {report.score}%
        </span>
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        {report.checks_passed}/{report.checks_total} checks passed
      </p>
      {report.issues.length === 0 ? (
        <p className="text-sm text-[var(--good)]">No formatting issues detected.</p>
      ) : (
        <ul className="space-y-2">
          {report.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--warn)]" />
              <span className="flex-1">{issue.message}</span>
              <Badge variant={SEVERITY_TONE[issue.severity]} className="shrink-0 text-xs">
                {issue.severity}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
