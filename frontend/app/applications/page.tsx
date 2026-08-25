"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getApplications, updateApplicationStatus, removeApplication } from "@/lib/applicationTracker";
import { getSavedJobIds, removeSavedJob, onSavedJobsChange } from "@/lib/savedJobs";
import { getJob, compareJobs } from "@/lib/api";
import type { ApplicationStatus, ApplicationStatusValue, Job, NWayComparisonResult } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Trash2, ExternalLink, Bookmark, Scale, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_COMPARE = 4;

const STATUS_OPTIONS: ApplicationStatusValue[] = ["applied", "interview", "rejected", "offer"];

const STATUS_TONE: Record<ApplicationStatusValue, "accent" | "warn" | "bad" | "good"> = {
  applied: "accent",
  interview: "warn",
  rejected: "bad",
  offer: "good",
};

type Tab = "applications" | "saved";

function ComparisonTable({ result, onClose }: { result: NWayComparisonResult; onClose: () => void }) {
  const { jobs, common_skills } = result.comparison;
  return (
    <Card className="card-flat">
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            Side by side
          </h3>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close comparison">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                <th className="py-2 pr-4 font-medium">&nbsp;</th>
                {jobs.map((j) => (
                  <th key={j.job_id} className="py-2 pr-4 font-medium min-w-[160px]">
                    <Link href={`/jobs/${j.job_id}`} className="text-foreground hover:underline font-display">
                      {j.title}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-border">
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Company</td>
                {jobs.map((j) => (
                  <td key={j.job_id} className="py-2 pr-4">{j.company}</td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Location</td>
                {jobs.map((j) => (
                  <td key={j.job_id} className="py-2 pr-4">{j.location ?? "-"}</td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Level</td>
                {jobs.map((j) => (
                  <td key={j.job_id} className="py-2 pr-4">{j.experience_level ?? "-"}</td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground">Salary</td>
                {jobs.map((j) => (
                  <td key={j.job_id} className="py-2 pr-4">
                    {j.salary_min_lpa || j.salary_max_lpa
                      ? `${j.salary_min_lpa ?? "?"}-${j.salary_max_lpa ?? "?"} LPA`
                      : "-"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted-foreground align-top">Distinct skills</td>
                {jobs.map((j) => (
                  <td key={j.job_id} className="py-2 pr-4 align-top">
                    <div className="flex flex-wrap gap-1">
                      {j.unique_skills.length > 0 ? (
                        j.unique_skills.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {common_skills.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              Common to all
            </p>
            <div className="flex flex-wrap gap-1.5">
              {common_skills.map((s) => (
                <Badge key={s} variant="good" className="text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ApplicationsPage() {
  const [tab, setTab] = useState<Tab>("applications");
  const [applications, setApplications] = useState<ApplicationStatus[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [jobDetails, setJobDetails] = useState<Record<string, Job>>({});
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<NWayComparisonResult | null>(null);

  useEffect(() => {
    const apps = Object.values(getApplications());
    setApplications(apps);
    setSavedIds(getSavedJobIds());

    return onSavedJobsChange(() => setSavedIds(getSavedJobIds()));
  }, []);

  useEffect(() => {
    const idsToLoad = new Set([...applications.map((a) => a.jobId), ...savedIds]);
    idsToLoad.forEach((jobId) => {
      if (jobDetails[jobId]) return;
      getJob(jobId)
        .then((job) => setJobDetails((prev) => ({ ...prev, [jobId]: job })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applications, savedIds]);

  function handleStatusChange(jobId: string, status: ApplicationStatusValue) {
    updateApplicationStatus(jobId, status);
    setApplications(Object.values(getApplications()));
  }

  function handleRemove(jobId: string) {
    removeApplication(jobId);
    setApplications(Object.values(getApplications()));
    toast.success("Removed from your applications");
  }

  function toggleCompareSelection(jobId: string) {
    setComparisonResult(null);
    setCompareSelection((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      if (prev.length >= MAX_COMPARE) {
        toast.error(`You can compare up to ${MAX_COMPARE} jobs at once.`);
        return prev;
      }
      return [...prev, jobId];
    });
  }

  async function handleCompare() {
    if (compareSelection.length < 2) return;
    setComparing(true);
    try {
      const result = await compareJobs(compareSelection);
      setComparisonResult(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't compare these jobs");
    } finally {
      setComparing(false);
    }
  }

  function handleUnsave(jobId: string) {
    removeSavedJob(jobId);
    toast.success("Removed from saved jobs");
  }

  const statusCounts = STATUS_OPTIONS.map((s) => ({
    status: s,
    count: applications.filter((a) => a.status === s).length,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-display font-semibold">Your Applications</h1>
        <div className="flex flex-wrap gap-2 mt-2">
          {statusCounts.map(({ status, count }) => (
            <Badge key={status} variant={STATUS_TONE[status]}>
              {count} {status}
            </Badge>
          ))}
          <Badge variant="outline">{savedIds.length} saved</Badge>
        </div>
      </div>

      <div className="flex rounded-full bg-muted p-1 text-sm font-medium w-fit">
        <button
          type="button"
          onClick={() => setTab("applications")}
          className={cn(
            "rounded-full px-4 py-1.5 transition-colors",
            tab === "applications" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          Applications
        </button>
        <button
          type="button"
          onClick={() => setTab("saved")}
          className={cn(
            "rounded-full px-4 py-1.5 transition-colors",
            tab === "saved" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          Saved
        </button>
      </div>

      {tab === "applications" ? (
        applications.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-muted-foreground">You haven&apos;t tracked any applications yet.</p>
            <Link href="/browse" className="underline text-sm text-primary">
              Browse jobs
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {applications.map((app) => {
              const job = jobDetails[app.jobId];
              return (
                <Card key={app.jobId} className="card-flat">
                  <CardContent className="pt-4 flex items-center justify-between gap-4">
                    <div>
                      <Link href={`/jobs/${app.jobId}`} className="font-medium hover:underline">
                        {job?.title || "Loading..."}
                      </Link>
                      {job && <p className="text-sm text-muted-foreground">{job.company}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        Applied {new Date(app.appliedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_TONE[app.status]}>{app.status}</Badge>
                      <Select
                        value={app.status}
                        onValueChange={(v) => handleStatusChange(app.jobId, v as ApplicationStatusValue)}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleRemove(app.jobId)}
                        aria-label="Remove application"
                      >
                        <Trash2 className="h-4 w-4 text-[var(--bad)]" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : savedIds.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground">No saved jobs yet.</p>
          <Link href="/browse" className="underline text-sm text-primary">
            Browse jobs
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {compareSelection.length > 0 && (
            <div className="card-flat p-3 flex items-center justify-between gap-3 border-2 border-primary/20">
              <p className="text-sm text-muted-foreground">
                {compareSelection.length} selected {compareSelection.length === 1 && "- pick at least one more"}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCompareSelection([])}>
                  Clear
                </Button>
                <Button size="sm" onClick={handleCompare} disabled={compareSelection.length < 2 || comparing}>
                  {comparing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  <Scale className="h-3.5 w-3.5 mr-1" />
                  Compare
                </Button>
              </div>
            </div>
          )}
          {comparisonResult && (
            <ComparisonTable result={comparisonResult} onClose={() => setComparisonResult(null)} />
          )}
          {savedIds.map((jobId) => {
            const job = jobDetails[jobId];
            const selected = compareSelection.includes(jobId);
            return (
              <Card key={jobId} className={cn("card-flat", selected && "ring-2 ring-primary/40")}>
                <CardContent className="pt-4 flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleCompareSelection(jobId)}
                      className="mt-1.5 h-4 w-4 accent-primary shrink-0"
                      aria-label={`Select ${job?.title ?? "job"} for comparison`}
                    />
                    <div>
                      <Link href={`/jobs/${jobId}`} className="font-medium hover:underline">
                        {job?.title || "Loading..."}
                      </Link>
                      {job && <p className="text-sm text-muted-foreground">{job.company}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {job?.apply_url ? (
                      <a
                        href={job.apply_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ size: "sm" })}
                      >
                        Apply <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </a>
                    ) : (
                      job && (
                        <Link href={`/jobs/${jobId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                          View details
                        </Link>
                      )
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleUnsave(jobId)}
                      aria-label="Remove saved job"
                    >
                      <Bookmark className="h-4 w-4 fill-current text-primary" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
