"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/types";
import type { ExperienceLevelBand } from "@/lib/api";
import { toggleSavedJob } from "@/lib/savedJobs";
import { SalaryRangeBar } from "@/components/SalaryRangeBar";
import { MapPin, Building2, Calendar, Bookmark, IndianRupee, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const EXPERIENCE_TONE: Record<string, "warn" | "accent" | "good"> = {
  Fresher: "good",
  Mid: "accent",
  Senior: "warn",
};

export const JobCard = memo(function JobCard({
  job,
  compact = false,
  highlightQuery = "",
  salaryBands,
  applied = false,
  saved = false,
}: {
  job: Job;
  compact?: boolean;
  highlightQuery?: string;
  salaryBands?: Record<string, ExperienceLevelBand>;
  applied?: boolean;
  saved?: boolean;
}) {
  const router = useRouter();
  const normalizedQuery = highlightQuery.trim().toLowerCase();

  function handleSaveToggle(e: React.MouseEvent) {
    e.stopPropagation();
    const nowSaved = toggleSavedJob(job.id);
    toast.success(nowSaved ? "Saved for later" : "Removed from saved jobs");
  }

  function handleCardClick() {
    router.push(`/jobs/${job.id}`);
  }

  return (
    <Card
      onClick={handleCardClick}
      className="card-flat hover:shadow-md transition-shadow cursor-pointer"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-display hover:underline">{job.title}</CardTitle>
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <Building2 className="h-3.5 w-3.5" />
              {job.company}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {job.sources.map((s) => (
              <Badge key={s} variant="accent" className="text-xs">
                {s}
              </Badge>
            ))}
            {applied && (
              <Badge variant="good" className="text-xs">
                Applied
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {job.location}
            </span>
          )}
          {job.posted_date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {job.posted_date}
            </span>
          )}
          {job.experience_level && (
            <Badge variant={EXPERIENCE_TONE[job.experience_level] ?? "outline"}>
              {job.experience_level}
            </Badge>
          )}
          {(job.salary_min_lpa || job.salary_max_lpa) && (
            <span className="flex items-center gap-1 text-[var(--good)] font-medium">
              <IndianRupee className="h-3 w-3" />
              {job.salary_min_lpa ?? "?"}-{job.salary_max_lpa ?? "?"} LPA
            </span>
          )}
        </div>
        {!compact && salaryBands && job.experience_level && (
          <SalaryRangeBar
            minLpa={job.salary_min_lpa}
            maxLpa={job.salary_max_lpa}
            band={salaryBands[job.experience_level]}
          />
        )}
        {!compact && job.summary_bullets.length > 0 && (
          <ul className="text-sm list-disc list-inside space-y-0.5 text-muted-foreground">
            {job.summary_bullets.slice(0, 2).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {job.technical_skills.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {job.technical_skills.slice(0, compact ? 4 : 8).map((skill) => {
              const isMatch = normalizedQuery.length > 0 && skill.toLowerCase().includes(normalizedQuery);
              return (
                <Badge
                  key={skill}
                  variant={isMatch ? "accent" : "outline"}
                  className={`text-xs ${isMatch ? "font-semibold" : "font-normal"}`}
                >
                  {skill}
                </Badge>
              );
            })}
          </div>
        )}
        {!compact && (
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant={saved ? "default" : "outline"}
              onClick={handleSaveToggle}
            >
              <Bookmark className={`h-3.5 w-3.5 mr-1 ${saved ? "fill-current" : ""}`} />
              {saved ? "Saved" : "Save for later"}
            </Button>
            {job.apply_url && (
              <a
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Apply <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
