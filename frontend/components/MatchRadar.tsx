"use client";

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import type { MatchBreakdown } from "@/lib/types";

// Mirrors backend/app/services/matching.py's SKILL_WEIGHT/SEMANTIC_WEIGHT/
// EXPERIENCE_WEIGHT (0.50/0.35/0.15) - keep these two in sync. Without this,
// the chart previously plotted all three factors on an equal 0-100 scale,
// which made a trivially-easy-to-max experience_alignment (see
// calculate_experience_alignment's gap<=0 case) visually dominate the chart
// even though it only contributes 15% of the real match_score - misleading
// a viewer into thinking experience drove a match when skills/semantic fit
// barely mattered.
const SKILL_WEIGHT = 0.5;
const SEMANTIC_WEIGHT = 0.35;
const EXPERIENCE_WEIGHT = 0.15;

export function MatchRadar({ breakdown }: { breakdown: MatchBreakdown }) {
  const data = [
    {
      metric: "Skills Overlap (50%)",
      value: Math.round(breakdown.skill_overlap * SKILL_WEIGHT * 100),
    },
    {
      metric: "Semantic Fit (35%)",
      value: Math.round(breakdown.semantic_similarity * SEMANTIC_WEIGHT * 100),
    },
    {
      metric: "Experience Fit (15%)",
      value: Math.round(breakdown.experience_alignment * EXPERIENCE_WEIGHT * 100),
    },
  ];

  return (
    <div className="w-full h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
          <PolarRadiusAxis angle={90} domain={[0, 50]} tick={{ fontSize: 10 }} />
          <Radar dataKey="value" fill="var(--gold)" fillOpacity={0.35} stroke="var(--gold)" />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
