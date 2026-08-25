"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { getJob, generateInterview, generateRoadmap, searchJobs, getSalaryStats, rewriteBullets, getSkillRoi, type ExperienceLevelBand, type SkillRoiEntry } from "@/lib/api";
import { getNegotiationScript } from "@/lib/negotiationScript";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { PreviewCard, PreviewCardTrigger, PreviewCardContent } from "@/components/ui/preview-card";
import { SalaryRangeBar } from "@/components/SalaryRangeBar";
import { getApiKey } from "@/lib/apiKeyStore";
import {
  trackApplication,
  getApplicationStatus,
  updateApplicationStatus,
} from "@/lib/applicationTracker";
import { isJobSaved, toggleSavedJob } from "@/lib/savedJobs";
import { useJobStatusMap } from "@/lib/useJobStatusMap";
import type {
  Job,
  InterviewQuestion,
  ApplicationStatusValue,
  Roadmap,
  ResumeUploadResponse,
  BulletSuggestion,
} from "@/lib/types";
import { toast } from "sonner";
import { Loader2, ExternalLink, MapPin, Building2, Bookmark, Copy, Sparkles, Info, CheckCircle2, Circle, X } from "lucide-react";
import { JobCard } from "@/components/JobCard";
import { ChatDrawer } from "@/components/ChatDrawer";

const STATUS_OPTIONS: ApplicationStatusValue[] = ["applied", "interview", "rejected", "offer"];
const EXPERIENCE_TONE: Record<string, "good" | "accent" | "warn"> = {
  Fresher: "good",
  Mid: "accent",
  Senior: "warn",
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<ApplicationStatusValue | null>(null);
  const [interview, setInterview] = useState<InterviewQuestion[] | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [difficulty, setDifficulty] = useState("medium");
  const [gapInput, setGapInput] = useState("");
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [resumeSkills, setResumeSkills] = useState<string[]>([]);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [bulletSuggestions, setBulletSuggestions] = useState<BulletSuggestion[] | null>(null);
  const [bulletsLoading, setBulletsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [similarJobs, setSimilarJobs] = useState<Job[]>([]);
  const [salaryBand, setSalaryBand] = useState<ExperienceLevelBand | undefined>();
  const [atsScore, setAtsScore] = useState<{ score: number; checksPassed: number; checksTotal: number } | null>(null);
  const [matchTier, setMatchTier] = useState<"strong" | "moderate" | "weak" | null>(null);
  const [matchPercent, setMatchPercent] = useState<number | null>(null);
  const [matchedSkillsCount, setMatchedSkillsCount] = useState<{ have: number; total: number } | null>(null);
  const [skillRoi, setSkillRoi] = useState<SkillRoiEntry[]>([]);
  const [readinessDismissed, setReadinessDismissed] = useState(false);
  const interviewSectionRef = useRef<HTMLDivElement | null>(null);
  const { applications: similarJobsApplications, savedIds: similarJobsSavedIds } = useJobStatusMap();

  useEffect(() => {
    getJob(params.id).then(setJob).catch(() => toast.error("Job not found"));
    const existing = getApplicationStatus(params.id);
    setStatus(existing?.status || null);
    setSaved(isJobSaved(params.id));
    const stored = sessionStorage.getItem("resume_results");
    if (stored) {
      try {
        const parsed: ResumeUploadResponse = JSON.parse(stored);
        setResumeSkills(parsed.resume_skills);
        setResumeText(parsed.resume_text ?? null);
        setAtsScore({
          score: parsed.ats_report.score,
          checksPassed: parsed.ats_report.checks_passed,
          checksTotal: parsed.ats_report.checks_total,
        });
        const match = parsed.top_matches.find((m) => m.job_id === params.id);
        if (match) {
          setGapInput(match.breakdown.missing_skills.join(", "));
          setMatchTier(
            match.match_score >= 0.7 ? "strong" : match.match_score >= 0.45 ? "moderate" : "weak"
          );
          setMatchPercent(Math.round(match.match_score * 100));
          setMatchedSkillsCount({
            have: match.breakdown.matched_skills.length,
            total: match.breakdown.matched_skills.length + match.breakdown.missing_skills.length,
          });
          if (match.breakdown.missing_skills.length > 0) {
            getSkillRoi(match.breakdown.missing_skills)
              .then((r) => setSkillRoi(r.ranked))
              .catch(() => {});
          }
        }
      } catch {
        sessionStorage.removeItem("resume_results");
      }
    }
    setReadinessDismissed(sessionStorage.getItem(`readiness_dismissed_${params.id}`) === "1");
  }, [params.id]);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;

    async function loadSimilar() {
      // Prefer resume-matched jobs sharing this job's category when resume
      // data exists in session - ties "similar" back to the user's actual
      // fit rather than pure category matching.
      const stored = sessionStorage.getItem("resume_results");
      let fromResume: Job[] = [];
      if (stored) {
        try {
          const parsed: ResumeUploadResponse = JSON.parse(stored);
          fromResume = parsed.top_matches
            .filter((m) => m.job_id !== params.id && m.role_category === job!.role_category)
            .slice(0, 6)
            .map((m) => ({
              id: m.job_id,
              title: m.title,
              company: m.company,
              location: m.location,
              description: null,
              posted_date: null,
              apply_url: m.apply_url,
              sources: m.sources,
              technical_skills: [],
              role_category: m.role_category,
              experience_level: null,
              min_years_experience: null,
              soft_skills: [],
              domain_tags: [],
              summary_bullets: [],
              salary_min_lpa: null,
              salary_max_lpa: null,
            }));
        } catch {
          // ignore malformed session data
        }
      }

      if (fromResume.length >= 4 || !job!.role_category) {
        if (!cancelled) setSimilarJobs(fromResume.slice(0, 6));
        return;
      }

      try {
        const result = await searchJobs({ category: job!.role_category, limit: 8 });
        const filtered = result.jobs.filter((j) => j.id !== params.id).slice(0, 6);
        if (!cancelled) setSimilarJobs(fromResume.length > 0 ? [...fromResume, ...filtered].slice(0, 6) : filtered);
      } catch {
        if (!cancelled) setSimilarJobs(fromResume);
      }
    }

    loadSimilar();
    return () => {
      cancelled = true;
    };
  }, [job, params.id]);

  useEffect(() => {
    if (!job?.experience_level) return;
    const level = job.experience_level;
    getSalaryStats({ category: job.role_category ?? undefined })
      .then((r) => setSalaryBand(r.by_experience_level[level]))
      .catch(() => {});
  }, [job?.experience_level, job?.role_category]);

  function handleSaveToggle() {
    const nowSaved = toggleSavedJob(params.id);
    setSaved(nowSaved);
    toast.success(nowSaved ? "Saved for later" : "Removed from saved jobs");
  }

  function handleStatusChange(newStatus: ApplicationStatusValue) {
    if (status) {
      updateApplicationStatus(params.id, newStatus);
    } else {
      trackApplication(params.id, newStatus);
    }
    setStatus(newStatus);
    toast.success(`Marked as ${newStatus}`);
  }

  async function handleTailorResume() {
    if (!resumeText) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    setBulletsLoading(true);
    try {
      const result = await rewriteBullets(params.id, resumeText, apiKey);
      setBulletSuggestions(result.suggestions);
      if (result.cached) toast.success("Loaded your previous tailored bullets.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to tailor resume bullets");
    } finally {
      setBulletsLoading(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Couldn't copy - copy it manually")
    );
  }

  async function handleInterviewPrep(difficultyOverride?: string) {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    setInterviewLoading(true);
    try {
      const result = await generateInterview(params.id, difficultyOverride ?? difficulty, apiKey);
      setInterview(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate interview questions");
    } finally {
      setInterviewLoading(false);
    }
  }

  function handleApplyClick() {
    if (!status) {
      trackApplication(params.id, "applied");
      setStatus("applied");
    }
    toast.success("Marked as applied. Want to prep for the interview?", {
      action: {
        label: "Prep now",
        onClick: () => {
          interviewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          setDifficulty("medium");
          handleInterviewPrep("medium");
        },
      },
      duration: 8000,
    });
  }

  async function handleRoadmap() {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    const missing = gapInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (missing.length === 0) {
      toast.error("Add at least one skill to build a roadmap for.");
      return;
    }
    setRoadmapLoading(true);
    try {
      const r = await generateRoadmap(missing, resumeSkills, apiKey);
      setRoadmap(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate roadmap");
    } finally {
      setRoadmapLoading(false);
    }
  }

  function addSkillToGap(skill: string) {
    const current = gapInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (current.includes(skill)) return;
    setGapInput([...current, skill].join(", "));
  }

  function dismissReadiness() {
    sessionStorage.setItem(`readiness_dismissed_${params.id}`, "1");
    setReadinessDismissed(true);
  }

  if (!job) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1">
          <h1 className="font-display" style={{ fontSize: 26, lineHeight: 1.15, fontWeight: 300 }}>
            {job.title}
          </h1>
          <div className="flex items-center gap-3 text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Building2 className="h-4 w-4" />
              {job.company}
            </span>
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {job.location}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {job.sources.map((s) => (
              <Badge key={s} variant="accent">
                {s}
              </Badge>
            ))}
            {job.experience_level && (
              <Badge variant={EXPERIENCE_TONE[job.experience_level] ?? "outline"}>
                {job.experience_level}
              </Badge>
            )}
            {job.role_category && <Badge variant="outline">{job.role_category}</Badge>}
            {(job.salary_min_lpa || job.salary_max_lpa) && (
              <Badge variant="good">
                {job.salary_min_lpa ?? "?"}-{job.salary_max_lpa ?? "?"} LPA
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:items-end shrink-0">
          {matchPercent !== null && (
            <div className="text-right">
              <p
                className="font-display font-light text-primary leading-none"
                style={{ fontSize: 34 }}
              >
                {matchPercent}%
              </p>
              <p className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground mt-1">match</p>
            </div>
          )}
          {job.apply_url && (
            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleApplyClick}
              className={buttonVariants({ className: "w-full sm:w-auto" })}
            >
              Apply Now <ExternalLink className="h-4 w-4 ml-1" />
            </a>
          )}
          <Button
            variant={saved ? "default" : "outline"}
            onClick={handleSaveToggle}
            className="w-full sm:w-auto"
          >
            <Bookmark className={`h-4 w-4 mr-1 ${saved ? "fill-current" : ""}`} />
            {saved ? "Saved" : "Save for later"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium text-muted-foreground self-center mr-1">
          Application status:
        </span>
        {STATUS_OPTIONS.map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => handleStatusChange(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {(atsScore || matchTier) && !readinessDismissed && status !== "applied" && (
        <Card className="card-flat border-2 border-primary/20">
          <CardContent className="pt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold font-display flex items-center gap-2 text-sm">
                Ready to apply?
              </h3>
              <button
                onClick={dismissReadiness}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 text-sm">
              {atsScore && (
                <div className="flex items-center gap-2">
                  {atsScore.score >= 70 ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--good)] shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-[var(--warn)] shrink-0" />
                  )}
                  <span>
                    Resume checks: {atsScore.checksPassed}/{atsScore.checksTotal} passed ({atsScore.score}%)
                  </span>
                </div>
              )}
              {matchTier && (
                <div className="flex items-center gap-2">
                  {matchTier === "strong" ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--good)] shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-[var(--warn)] shrink-0" />
                  )}
                  <span>
                    Match for this role: {matchTier === "strong" ? "strong" : matchTier === "moderate" ? "moderate" : "weak"}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                {bulletSuggestions ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--good)] shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span>
                  {bulletSuggestions
                    ? "Resume bullets tailored for this role"
                    : "Resume not yet tailored for this role"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(matchedSkillsCount || salaryBand?.median_lpa != null || atsScore) && (
        <div className="grid sm:grid-cols-3 panel-flat overflow-hidden">
          <div className="p-5 border-b sm:border-b-0 sm:border-r border-border">
            <p className="font-display font-light" style={{ fontSize: 28, lineHeight: 1 }}>
              {matchedSkillsCount ? `${matchedSkillsCount.have} / ${matchedSkillsCount.total}` : "-"}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">Skills matched</p>
          </div>
          <div className="p-5 border-b sm:border-b-0 sm:border-r border-border">
            <p className="font-display font-light" style={{ fontSize: 28, lineHeight: 1 }}>
              {job.salary_min_lpa || job.salary_max_lpa
                ? `${job.salary_min_lpa ?? "?"}-${job.salary_max_lpa ?? "?"}`
                : "-"}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">
              LPA{salaryBand?.median_lpa != null ? `, median ${salaryBand.median_lpa}` : ""}
            </p>
          </div>
          <div className="p-5">
            <p className="font-display font-light" style={{ fontSize: 28, lineHeight: 1 }}>
              {atsScore ? `${atsScore.checksPassed} / ${atsScore.checksTotal}` : "-"}
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">Resume checks passed</p>
          </div>
        </div>
      )}

      {/* main content / "close the gap" sidebar split, matching App.dc.html's
          .detail{grid-template-columns:1.25fr 0.75fr} - the sidebar stays
          sticky alongside the longer-form content in the left column */}
      <div className="grid lg:grid-cols-[1.25fr_0.75fr] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {salaryBand && salaryBand.median_lpa != null && (() => {
            const negotiation = getNegotiationScript(job.experience_level, salaryBand);
            return (
              <Card className="card-flat">
                <CardContent className="pt-4 space-y-3">
                  <h3 className="font-semibold font-display flex items-center gap-2">Know your worth</h3>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Market median for {job.experience_level} {job.role_category ?? "roles"}:{" "}
                      <span className="font-semibold text-foreground">{salaryBand.median_lpa} LPA</span>{" "}
                      ({salaryBand.min_lpa}-{salaryBand.max_lpa} LPA range, {salaryBand.sample_size} listings)
                    </p>
                    <div className="mt-2 max-w-xs">
                      <SalaryRangeBar minLpa={job.salary_min_lpa} maxLpa={job.salary_max_lpa} band={salaryBand} />
                    </div>
                  </div>
                  {negotiation && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{negotiation.headline}</p>
                      <Collapsible>
                        <CollapsibleTrigger style={{ fontSize: 13.5 }}>Get the exact phrasing</CollapsibleTrigger>
                        <CollapsiblePanel>
                          <p
                            className="text-muted-foreground bg-muted rounded-lg p-3 mt-2"
                            style={{ fontSize: 13.5, lineHeight: 1.75 }}
                          >
                            &quot;{negotiation.script}&quot;
                          </p>
                        </CollapsiblePanel>
                      </Collapsible>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {job.summary_bullets.length > 0 && (
            <Card className="card-flat">
              <CardContent className="pt-4">
                <h3 className="font-semibold mb-2 font-display">Summary</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {job.summary_bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div>
            <h3 className="font-semibold mb-2">Technical Skills</h3>
            <div className="flex flex-wrap gap-1">
              {job.technical_skills.map((s) => (
                <button key={s} onClick={() => addSkillToGap(s)} type="button">
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                    + {s}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Full Description</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{job.description}</p>
          </div>

          {resumeText && (
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="font-display font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Tailor my resume for this role
                <PreviewCard>
                  <PreviewCardTrigger className="text-muted-foreground hover:text-foreground">
                    <Info className="h-3.5 w-3.5" />
                  </PreviewCardTrigger>
                  <PreviewCardContent>
                    3 bullet points that reframe your real experience toward this job&apos;s language,
                    grounded in what&apos;s already on your resume, nothing invented.
                  </PreviewCardContent>
                </PreviewCard>
              </h3>
              <Button onClick={handleTailorResume} disabled={bulletsLoading}>
                {bulletsLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Generate tailored bullets
              </Button>
              {bulletSuggestions && (
                <div className="space-y-3 mt-2">
                  {bulletSuggestions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Couldn&apos;t confidently ground any suggestions in your resume text. Try adding more
                      detail to your experience section.
                    </p>
                  ) : (
                    bulletSuggestions.map((s, i) => (
                      <Card key={i} className="card-flat">
                        <CardContent className="pt-4 grid sm:grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                              Your original
                            </p>
                            <p className="text-muted-foreground">{s.original ?? "(no close match found)"}</p>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs font-medium text-primary uppercase tracking-wide">
                                AI-optimized
                              </p>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(s.rewritten)}
                                aria-label="Copy to clipboard"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <p>{s.rewritten}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {similarJobs.length > 0 && (
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="font-display font-semibold">Jobs like this</h3>
              <p className="text-sm text-muted-foreground">
                {resumeSkills.length > 0
                  ? "Other roles matching your resume in the same category."
                  : "Other roles in the same category."}
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {similarJobs.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    compact
                    applied={!!similarJobsApplications[j.id]}
                    saved={similarJobsSavedIds.has(j.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={interviewSectionRef} className="border-t border-border pt-4 space-y-3">
            <h3 className="font-display font-semibold">Interview prep mode</h3>
            <p className="text-sm text-muted-foreground">Mock technical questions tailored to this role.</p>
            <div className="flex gap-2">
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v ?? "medium")}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue>
                    {(v: string) => (v.charAt(0).toUpperCase() + v.slice(1))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => handleInterviewPrep()} disabled={interviewLoading}>
                {interviewLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Generate
              </Button>
            </div>
            {interview && (
              <div className="mt-2 space-y-4">
                {interview.map((q, i) => (
                  <Card key={i} className="card-flat">
                    <CardContent className="pt-4 space-y-2 text-sm">
                      <p className="font-medium">{i + 1}. {q.question}</p>
                      <p className="text-muted-foreground">
                        Hints: {q.hints.join(" | ")}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {q.expected_concepts.map((c) => (
                          <Badge key={c} variant="good" className="text-xs">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <h3 className="font-display font-semibold">Upskilling roadmap</h3>
            <p className="text-sm text-muted-foreground">
              AI-generated 7-day plan to close this role&apos;s skill gaps.
            </p>
            {resumeSkills.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Tip: run Resume Match first to auto-fill gaps, or type skills manually.
              </p>
            )}
            <Input
              placeholder="docker, kubernetes, aws"
              value={gapInput}
              onChange={(e) => setGapInput(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {job.technical_skills.slice(0, 6).map((s) => (
                <button key={s} onClick={() => addSkillToGap(s)} type="button">
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted text-xs">
                    + {s}
                  </Badge>
                </button>
              ))}
            </div>
            <Button onClick={handleRoadmap} disabled={roadmapLoading}>
              {roadmapLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Generate 7-day roadmap
            </Button>
            {roadmap && (
              <div className="mt-2 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    Total estimated time: {roadmap.total_estimated_hours}h
                  </p>
                  {roadmap.cached && (
                    <Badge variant="outline" className="text-xs">
                      Cached
                    </Badge>
                  )}
                </div>
                {roadmap.roadmap.map((day) => (
                  <Card key={day.day} className="card-flat">
                    <CardContent className="pt-4 text-sm space-y-1">
                      <p className="font-semibold font-display">
                        Day {day.day}: {day.skill} ({day.duration})
                      </p>
                      <p>{day.goal}</p>
                      <p className="text-muted-foreground">Project: {day.project}</p>
                      <p className="text-muted-foreground">Resources: {day.resources.join(", ")}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {skillRoi.length > 0 && (
          <div
            className="p-6 lg:sticky lg:top-20"
            style={{ background: "linear-gradient(205deg, oklch(0.175 0.007 55), oklch(0.105 0.004 55) 80%)" }}
          >
            <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground mb-3">
              Close the gap
            </p>
            <div>
              {skillRoi.map((r, i) => (
                <div
                  key={r.skill}
                  className={`flex items-center justify-between py-3 text-sm ${i > 0 ? "border-t border-border" : ""}`}
                >
                  <span>{r.skill}</span>
                  <span className="font-display font-light text-lg text-primary">+{r.roles_unlocked}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Roles each skill would open at your level.
            </p>
            <Button variant="outline" className="w-full mt-4" onClick={handleRoadmap} disabled={roadmapLoading}>
              {roadmapLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Build a 7-day plan
            </Button>
          </div>
        )}
      </div>

      <ChatDrawer
        userSkills={resumeSkills}
        jobPrompt={{
          jobId: job.id,
          question: `Summarize this job in a few sentences: ${job.title} at ${job.company}. Job ID: ${job.id}`,
          label: "Want me to summarize this job description?",
        }}
      />
    </div>
  );
}
