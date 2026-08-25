"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AtsScoreCard } from "@/components/AtsScoreCard";
import { getApiKey } from "@/lib/apiKeyStore";
import {
  uploadResume,
  generateRoadmap,
  getTrends,
  getSalaryStats,
  getSkillRoi,
  getDigest,
  submitMatchFeedback,
  type ExperienceLevelBand,
  type SkillRoiEntry,
} from "@/lib/api";
import { getAnonId } from "@/lib/anonId";
import { consumeLastMatchesVisit } from "@/lib/lastVisit";
import { isJobSaved, toggleSavedJob } from "@/lib/savedJobs";
import { getNegotiationScript } from "@/lib/negotiationScript";
import { fallbackVerdict } from "@/lib/matchVerdict";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import type { ResumeUploadResponse, Roadmap, MatchedJob, Job } from "@/lib/types";
import { toast } from "sonner";
import {
  Loader2,
  UploadCloud,
  Sparkles,
  ExternalLink,
  Wrench,
  CheckCircle2,
  Compass,
  ThumbsUp,
  ThumbsDown,
  Bell,
  Bookmark,
} from "lucide-react";

// "Posted 2 days ago" style label for the row's company line, matching the
// mockup's .jco. Returns null rather than a guess when there is no date, so
// a missing posted_date simply drops the clause instead of inventing one.
function relativePosted(postedDate: string | null): string | null {
  if (!postedDate) return null;
  const then = new Date(postedDate);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Posted today";
  if (days === 1) return "Posted 1 day ago";
  return `Posted ${days} days ago`;
}

// Seniority pill text: the tier label qualified by the years the role
// actually asks for, e.g. "Senior · 6+ yrs". min_years_experience is present
// on effectively the whole corpus, so the years clause almost always shows;
// when it is missing or zero the tier label stands alone rather than
// claiming "0 yrs", which would read as a stated requirement rather than
// an absent one.
function seniorityLabel(
  experienceLevel: string | null,
  minYears: number | null
): string | null {
  if (!experienceLevel) return null;
  if (minYears == null || minYears <= 0) return experienceLevel;
  return `${experienceLevel} · ${minYears}+ yrs`;
}

function MatchSaveButton({ jobId }: { jobId: string }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(isJobSaved(jobId));
  }, [jobId]);

  function handleClick() {
    const nowSaved = toggleSavedJob(jobId);
    setSaved(nowSaved);
    toast.success(nowSaved ? "Saved for later" : "Removed from saved jobs");
  }

  return (
    <Button size="sm" variant={saved ? "default" : "outline"} onClick={handleClick}>
      <Bookmark className={`h-3.5 w-3.5 mr-1 ${saved ? "fill-current" : ""}`} />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}

function MatchFeedbackButtons({ match }: { match: MatchedJob }) {
  const [given, setGiven] = useState<"relevant" | "irrelevant" | null>(null);

  function send(relevant: boolean) {
    setGiven(relevant ? "relevant" : "irrelevant");
    submitMatchFeedback({
      anonId: getAnonId(),
      jobId: match.job_id,
      relevant,
      matchScore: match.match_score,
      skillOverlap: match.breakdown.skill_overlap,
      semanticSimilarity: match.breakdown.semantic_similarity,
      experienceAlignment: match.breakdown.experience_alignment,
      confidence: match.breakdown.confidence,
    });
  }

  if (given) {
    return (
      <p className="text-xs text-muted-foreground">
        Thanks - that helps us get better at this.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Is this relevant to you?</span>
      <button
        type="button"
        onClick={() => send(true)}
        className="p-1 rounded hover:bg-muted hover:text-[var(--good)] transition-colors"
        aria-label="Relevant"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => send(false)}
        className="p-1 rounded hover:bg-muted hover:text-[var(--bad)] transition-colors"
        aria-label="Not relevant"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function dominantCategory(resume: ResumeUploadResponse): string | null {
  const counts = new Map<string, number>();
  for (const m of resume.top_matches) {
    if (!m.role_category) continue;
    counts.set(m.role_category, (counts.get(m.role_category) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  counts.forEach((count, category) => {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  });
  return best;
}

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<ResumeUploadResponse | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [roadmapLoading, setRoadmapLoading] = useState(false);

  const [marketLoading, setMarketLoading] = useState(false);
  const [totalJobsInCategory, setTotalJobsInCategory] = useState<number | null>(null);
  const [missingSkills, setMissingSkills] = useState<{ name: string; pct: number }[]>([]);
  const [experienceBands, setExperienceBands] = useState<Record<string, ExperienceLevelBand>>({});
  const [skillRoi, setSkillRoi] = useState<SkillRoiEntry[]>([]);
  const [digestJobs, setDigestJobs] = useState<Job[]>([]);
  const [digestDismissed, setDigestDismissed] = useState(false);
  const [lastVisit, setLastVisit] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("resume_results");
    if (stored) {
      try {
        const parsed: ResumeUploadResponse = JSON.parse(stored);
        // Results cached before the match payload gained its seniority and
        // salary fields would render with the level pill and pay silently
        // missing, looking like a bug with no way for the user to know a
        // re-upload fixes it. Detect that shape and drop the cache instead.
        const isStale =
          parsed.top_matches?.length > 0 &&
          !("experience_level" in (parsed.top_matches[0] as object));
        if (isStale) {
          sessionStorage.removeItem("resume_results");
        } else {
          setResults(parsed);
        }
      } catch {
        sessionStorage.removeItem("resume_results");
      }
    }
    setChecking(false);

    // consumeLastMatchesVisit both reads the PREVIOUS visit and immediately
    // stamps a new one, so this must run exactly once per page load, not
    // once per re-render - a null previous value means this is the user's
    // first-ever visit, so there is nothing to diff a digest against yet.
    // The consumed value is kept in state (not re-consumed) so the
    // resume-aware digest refinement below can reuse the same cutoff.
    const previousVisit = consumeLastMatchesVisit();
    setLastVisit(previousVisit);
    if (!previousVisit) return;
    getDigest({ since: previousVisit })
      .then((r) => setDigestJobs(r.jobs))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!results || !lastVisit) return;
    const category = dominantCategory(results);
    if (!category) return;
    // Re-run scoped to the resume's dominant category and detected skills
    // once a resume is on hand, so the digest ranks by actual relevance
    // instead of the unscoped, recency-only first pass above.
    getDigest({ since: lastVisit, skills: results.resume_skills, category })
      .then((r) => setDigestJobs(r.jobs))
      .catch(() => {});
  }, [results, lastVisit]);

  useEffect(() => {
    if (!results) return;
    const category = dominantCategory(results);
    if (!category) return;

    setMarketLoading(true);
    Promise.all([getTrends(category), getSalaryStats({ category })])
      .then(([trends, salary]) => {
        setTotalJobsInCategory(trends.total_jobs);
        setMissingSkills(
          trends.top_skills
            .filter((s) => !results.resume_skills.some((rs) => rs.toLowerCase() === s.name.toLowerCase()))
            .slice(0, 8)
        );
        setExperienceBands(salary.by_experience_level || {});
      })
      .catch(() => {})
      .finally(() => setMarketLoading(false));
  }, [results]);

  useEffect(() => {
    if (!results) return;
    const allMissing = new Set<string>();
    results.top_matches.forEach((m) => m.breakdown.missing_skills.forEach((s) => allMissing.add(s)));
    if (allMissing.size === 0) return;
    getSkillRoi(Array.from(allMissing))
      .then((r) => setSkillRoi(r.ranked))
      .catch(() => {});
  }, [results]);

  async function handleUpload() {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadResume(file, apiKey);
      sessionStorage.setItem("resume_results", JSON.stringify(result));
      setResults(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resume upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRoadmap() {
    if (!results) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    const allMissing = new Set<string>();
    results.top_matches.forEach((m) => m.breakdown.missing_skills.forEach((s) => allMissing.add(s)));

    setRoadmapLoading(true);
    try {
      const r = await generateRoadmap(Array.from(allMissing).slice(0, 8), results.resume_skills, apiKey);
      setRoadmap(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate roadmap");
    } finally {
      setRoadmapLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!results) {
    return (
      <div className="max-w-xl mx-auto space-y-6 py-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-semibold tracking-wide uppercase text-secondary-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Skip the noise. Find your fit.
          </div>
          <h1 className="text-3xl font-display font-light">Find the jobs that actually fit you</h1>
          <p className="text-muted-foreground">
            Upload your resume once. We&apos;ll rank the 45,000+ roles in our dataset by how well
            they match your skills, experience, and semantic fit &mdash; with the reasoning shown,
            not just a list.
          </p>
        </div>
        <div className="card-flat p-6 space-y-4">
          <div className="flex flex-col items-center gap-3 border-2 border-dashed border-border rounded-lg py-8">
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <Input
              type="file"
              accept="application/pdf"
              className="max-w-xs"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <p className="text-xs text-muted-foreground">PDF only, text-based resumes work best.</p>
          </div>
          <Button onClick={handleUpload} disabled={!file || uploading} className="w-full">
            {uploading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {uploading ? "Analyzing..." : "Find my matches"}
          </Button>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Prefer to look around first?{" "}
          <Link href="/browse" className="underline underline-offset-2 hover:text-foreground">
            Browse all jobs
          </Link>
        </p>
      </div>
    );
  }

  const topMissingSkills = (() => {
    const counts = new Map<string, number>();
    results.top_matches.forEach((m) =>
      m.breakdown.missing_skills.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1))
    );
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([skill]) => skill);
  })();

  const actionItems: string[] = [];
  results.ats_report.issues.forEach((issue) => actionItems.push(issue.message));
  if (topMissingSkills.length > 0) {
    actionItems.push(
      `Add or highlight: ${topMissingSkills.join(", ")} - these show up most often across your top matches.`
    );
  }

  const resumeCategory = dominantCategory(results);
  const experienceBandEntries = Object.entries(experienceBands);
  const topLevel = experienceBandEntries[0];
  const strongestSkills = results.resume_skills.slice(0, 2).join(" and ");

  // The mockup's bottom panel expands the single best match inline, so the
  // user can read its numbers and salary phrasing without leaving the page.
  const topMatch = results.top_matches[0] ?? null;
  const topMatchBand = topLevel?.[1];
  const topMatchNegotiation = topMatch
    ? getNegotiationScript(topLevel?.[0] ?? null, topMatchBand)
    : null;

  return (
    <div className="space-y-6">
      {digestJobs.length > 0 && !digestDismissed && (
        <div className="panel-flat p-5 flex items-start gap-3">
          <Bell className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {digestJobs.length} new role{digestJobs.length === 1 ? "" : "s"} since your last visit
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
              {digestJobs.slice(0, 5).map((j) => (
                <Link key={j.id} href={`/jobs/${j.id}`} className="hover:text-foreground hover:underline">
                  {j.title} · {j.company}
                </Link>
              ))}
              {digestJobs.length > 5 && <span>+{digestJobs.length - 5} more</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDigestDismissed(true)}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* "Your read" summary strip, matching the App mockup's top panel */}
      <div className="panel-flat grid sm:grid-cols-[1.35fr_1fr_1fr_1fr] overflow-hidden">
        <div className="p-6 border-b sm:border-b-0 sm:border-r border-border">
          <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">Your read</p>
          <p className="text-sm mt-2 leading-relaxed">
            {strongestSkills ? (
              <>Strongest in <span className="text-primary">{strongestSkills}</span>.</>
            ) : (
              "Resume analyzed."
            )}{" "}
            {resumeCategory && (
              <>Best fit for <span className="text-primary">{resumeCategory}</span> roles.</>
            )}
          </p>
        </div>
        <div className="p-6 border-b sm:border-b-0 sm:border-r border-border">
          <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">Resume health</p>
          <p className="font-display font-light mt-2" style={{ fontSize: 32, lineHeight: 1.1 }}>
            {results.ats_report.checks_passed}
            <span className="text-sm font-sans text-muted-foreground"> / {results.ats_report.checks_total}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">Formatting checks passed</p>
        </div>
        <div className="p-6 border-b sm:border-b-0 sm:border-r border-border">
          <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">Roles open to you</p>
          <p className="font-display font-light mt-2" style={{ fontSize: 32, lineHeight: 1.1 }}>
            {marketLoading ? "-" : (totalJobsInCategory ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{resumeCategory ?? "Matching"}, your level</p>
        </div>
        <div className="p-6">
          <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">Median pay, your level</p>
          <p className="font-display font-light mt-2" style={{ fontSize: 32, lineHeight: 1.1 }}>
            {topLevel ? (
              <>
                {topLevel[1].median_lpa}
                <span className="text-sm font-sans text-muted-foreground"> LPA</span>
              </>
            ) : (
              "-"
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {topLevel ? `Range ${topLevel[1].min_lpa} to ${topLevel[1].max_lpa}` : "Awaiting data"}
          </p>
        </div>
      </div>

      <AtsScoreCard report={results.ats_report} />

      {actionItems.length > 0 && (
        <div className="panel-flat p-5 space-y-3">
          <h2 className="font-display font-light text-xl flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Strengthen your resume
          </h2>
          <p className="text-xs text-muted-foreground">
            Concrete changes that would make your resume score higher against these roles.
          </p>
          <ul className="space-y-2">
            {actionItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {resumeCategory && !marketLoading && (missingSkills.length > 0 || experienceBandEntries.length > 0) && (
        <section className="panel-flat p-6 space-y-5">
          <h2 className="font-display font-light text-xl flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            Your Market Position
          </h2>
          <div className="grid sm:grid-cols-3">
            <div className={experienceBandEntries.length || missingSkills.length ? "sm:border-r border-border sm:pr-6" : ""}>
              <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">
                {resumeCategory} roles open
              </p>
              <p className="font-display font-light mt-1.5" style={{ fontSize: 28, lineHeight: 1 }}>
                {(totalJobsInCategory ?? 0).toLocaleString()}
              </p>
            </div>
            {missingSkills.length > 0 && (
              <div className="sm:px-6 sm:border-r border-border mt-4 sm:mt-0">
                <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">
                  Top missing skill
                </p>
                <p
                  className="font-display font-light mt-1.5 text-[var(--warn)]"
                  style={{ fontSize: 28, lineHeight: 1 }}
                >
                  {missingSkills[0].name}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {missingSkills[0].pct}% of roles ask for it
                </p>
              </div>
            )}
            {experienceBandEntries.length > 0 && (
              <div className="sm:pl-6 mt-4 sm:mt-0">
                <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">
                  Median pay, {experienceBandEntries[0][0]}
                </p>
                <p
                  className="font-display font-light mt-1.5 text-[var(--good)]"
                  style={{ fontSize: 28, lineHeight: 1 }}
                >
                  {experienceBandEntries[0][1].median_lpa} LPA
                </p>
              </div>
            )}
          </div>
          {missingSkills.length > 1 && (() => {
            const roiBySkill = new Map(skillRoi.map((r) => [r.skill.toLowerCase(), r.roles_unlocked]));
            const rest = missingSkills.slice(1);
            // Rank by roles-unlocked when we have it, otherwise keep the
            // original demand-percentage order - "learn Docker, opens 340
            // more roles" is a far more actionable ranking than an unranked
            // badge list, since it prioritizes by payoff, not just frequency.
            const ranked = [...rest].sort((a, b) => {
              const roiA = roiBySkill.get(a.name.toLowerCase()) ?? -1;
              const roiB = roiBySkill.get(b.name.toLowerCase()) ?? -1;
              return roiB - roiA;
            });
            return (
              <div className="border-t border-border pt-4">
                <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground mb-2">
                  Other in-demand skills you&apos;re missing
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {ranked.map((s) => {
                    const roi = roiBySkill.get(s.name.toLowerCase());
                    return (
                      <span key={s.name} className="text-[var(--warn)]">
                        {s.name}
                        <span className="text-muted-foreground">
                          {roi ? ` · +${roi} roles` : ` · ${s.pct}%`}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {experienceBandEntries.length > 0 && (
            <div className="grid sm:grid-cols-3 border-t border-border pt-4">
              {experienceBandEntries.map(([level, band], i) => (
                <div key={level} className={i > 0 ? "sm:pl-6 sm:border-l border-border mt-4 sm:mt-0" : ""}>
                  <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground">{level}</p>
                  <p className="font-display font-light mt-1.5" style={{ fontSize: 20 }}>
                    {band.median_lpa ?? "-"}{" "}
                    <span className="text-sm font-sans text-muted-foreground">LPA median</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {band.min_lpa}-{band.max_lpa} LPA range &middot; {band.sample_size} listings
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div>
        {/* Two-tone heading, matching the mockup's section titles ("The
            approach", "What happens before you apply") - white lead, gold
            emphasis on the phrase that carries the meaning. */}
        <h1 className="text-2xl font-display font-light">
          {results.top_matches.length > 0 ? (
            <>
              {results.top_matches.length} job
              {results.top_matches.length === 1 ? "" : "s"}{" "}
              <span className="text-primary">actually worth your time</span>
            </>
          ) : (
            <>
              No <span className="text-primary">strong matches</span> yet
            </>
          )}
        </h1>
        <p className="text-muted-foreground mt-1">
          Ranked by skill overlap, semantic fit, and experience alignment &mdash; based on{" "}
          {results.resume_skills.length} skills detected in your resume, not keyword guessing.
        </p>
        {/* Plain dot-separated text, not pills: a resume routinely detects 25+
            skills, and rendering each as a filled badge produced two dense
            rows of colour that dominated the page and buried the job list
            underneath it. The list is context, not a control. */}
        {results.resume_skills.length > 0 && (
          <p className="text-muted-foreground mt-2" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            {results.resume_skills.join(" · ")}
          </p>
        )}
      </div>

      {results.top_matches.length === 0 ? (
        <p className="text-muted-foreground">
          No matching jobs found for your profile.{" "}
          <Link href="/browse" className="underline underline-offset-2">
            Browse all jobs
          </Link>{" "}
          instead.
        </p>
      ) : (
        <div className="panel-flat px-6">
          {results.top_matches.map((match, i) => (
            <div
              key={match.job_id}
              onClick={() => router.push(`/jobs/${match.job_id}`)}
              className={`grid sm:grid-cols-[1fr_auto] gap-5 py-5 cursor-pointer transition-colors hover:bg-muted/30 ${i > 0 ? "border-t border-border" : ""}`}
            >
              <div>
                {/* Plain white title, matching the mockup's .jtitle - not a
                    link, since the whole row is the click target now, and an
                    <a> would inherit the global gold anchor color. */}
                <p className="font-semibold text-base text-foreground">{match.title}</p>
                <p className="text-muted-foreground mt-0.5" style={{ fontSize: 13 }}>
                  {[match.company, match.location, relativePosted(match.posted_date)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p
                  className="text-[var(--good)] mt-2"
                  style={{ fontSize: 13.5, lineHeight: 1.5 }}
                >
                  {match.verdict || fallbackVerdict(match.breakdown)}
                </p>
                {/* meta row, matching the mockup's .jmeta: an outlined .tag
                    pill (hairline border, gold-dim text, no filled background)
                    followed by plain-text salary and level facts. */}
                <div className="flex flex-wrap items-center gap-4 mt-2.5" style={{ fontSize: 12.5 }}>
                  {/* The pill is strictly a seniority tag. It used to fall back
                      to role_category when experience_level was absent, which
                      put values like "Junior Data Scientist" in a slot the eye
                      reads as a level - worse than showing nothing. */}
                  {seniorityLabel(match.experience_level, match.min_years_experience) && (
                    <span
                      className="uppercase text-[var(--gold-dim)] border border-border"
                      style={{ fontSize: 11, letterSpacing: "0.08em", padding: "3px 8px" }}
                    >
                      {seniorityLabel(match.experience_level, match.min_years_experience)}
                    </span>
                  )}
                  {(match.salary_min_lpa != null || match.salary_max_lpa != null) && (
                    <span className="text-muted-foreground">
                      {match.salary_min_lpa ?? "?"} to {match.salary_max_lpa ?? "?"} LPA
                    </span>
                  )}
                  {match.role_category && (
                    <span className="text-muted-foreground">{match.role_category}</span>
                  )}
                </div>
                <div className="mt-2.5" style={{ fontSize: 12.5 }}>
                  {match.breakdown.matched_skills.length > 0 && (
                    <span className="text-muted-foreground">
                      {match.breakdown.matched_skills.join(" · ")}
                    </span>
                  )}
                  {match.breakdown.missing_skills.length > 0 && (
                    <span className="text-[var(--warn)]">
                      {match.breakdown.matched_skills.length > 0 ? "  ·  " : ""}
                      Missing: {match.breakdown.missing_skills.join(", ")}
                    </span>
                  )}
                </div>
                {/* stopPropagation on the interactive children, so voting or
                    saving does not also navigate to the job detail page via
                    the row's own click handler. */}
                <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                  <MatchFeedbackButtons match={match} />
                </div>
              </div>
              <div
                className="flex sm:flex-col items-end sm:items-end gap-3 justify-between sm:justify-start"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-right">
                  <p
                    className="font-display font-light text-primary leading-none"
                    style={{ fontSize: 40 }}
                  >
                    {Math.round(match.match_score * 100)}%
                  </p>
                  <p className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground mt-1">match</p>
                </div>
                {/* Save (ghost, outlined) + Apply (filled gold) side by side,
                    matching the mockup's .btn-sm.ghost / .btn-sm pair. About
                    10% of the corpus has no apply_url, so those fall back to
                    the job detail page rather than dropping the button and
                    leaving the row with no way to act on it. */}
                <div className="flex items-center gap-2">
                  <MatchSaveButton jobId={match.job_id} />
                  {match.apply_url ? (
                    <a
                      href={match.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ size: "sm" })}
                    >
                      Apply <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  ) : (
                    <Link href={`/jobs/${match.job_id}`} className={buttonVariants({ size: "sm" })}>
                      View role
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded top-match detail + "Close the gap" sidebar, mirroring the
          App.dc.html .detail panel (1.25fr / 0.75fr split). Keeps the live
          roadmap feature intact - the mockup's "Build a 7 day plan" button
          is wired to the real generator, and its output renders below. */}
      {topMatch && (
        <div className="panel-flat grid lg:grid-cols-[1.25fr_0.75fr]">
          <div style={{ padding: "30px 30px" }}>
            <div className="flex items-start justify-between gap-5 border-b border-border pb-5">
              <div>
                <Link
                  href={`/jobs/${topMatch.job_id}`}
                  className="font-display font-light hover:underline text-foreground"
                  style={{ fontSize: 26, lineHeight: 1.15 }}
                >
                  {topMatch.title}
                </Link>
                <p className="text-muted-foreground mt-1.5" style={{ fontSize: 13 }}>
                  {topMatch.company}
                  {topMatch.location ? ` · ${topMatch.location}` : ""}
                  {topLevel ? ` · ${topLevel[0]}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p
                  className="font-display font-light text-primary leading-none"
                  style={{ fontSize: 34 }}
                >
                  {Math.round(topMatch.match_score * 100)}%
                </p>
                <p className="text-[11px] tracking-[0.14em] uppercase text-muted-foreground mt-1">
                  match
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3" style={{ marginTop: 22 }}>
              <div style={{ paddingRight: 22 }}>
                <p className="font-display font-light" style={{ fontSize: 28, lineHeight: 1 }}>
                  {topMatch.breakdown.matched_skills.length} /{" "}
                  {topMatch.breakdown.matched_skills.length + topMatch.breakdown.missing_skills.length}
                </p>
                <p className="text-muted-foreground" style={{ fontSize: 12, marginTop: 7 }}>
                  Skills matched
                </p>
              </div>
              <div className="border-l border-border" style={{ padding: "0 22px" }}>
                <p className="font-display font-light" style={{ fontSize: 28, lineHeight: 1 }}>
                  {topMatchBand?.median_lpa != null ? topMatchBand.median_lpa : "-"}
                </p>
                {/* Median only, not the raw min-max: the band's min/max span
                    the whole corpus for this level (0.96 to 77 LPA in real
                    data), which is an outlier range, not a figure anyone can
                    act on. The median is the honest single number here. */}
                <p className="text-muted-foreground" style={{ fontSize: 12, marginTop: 7 }}>
                  LPA median, your level
                </p>
              </div>
              <div className="border-l border-border" style={{ padding: "0 22px" }}>
                <p className="font-display font-light" style={{ fontSize: 28, lineHeight: 1 }}>
                  {results.ats_report.checks_passed} / {results.ats_report.checks_total}
                </p>
                <p className="text-muted-foreground" style={{ fontSize: 12, marginTop: 7 }}>
                  Resume checks passed
                </p>
              </div>
            </div>

            {topMatchNegotiation && (
              <div className="border-t border-border" style={{ marginTop: 24, paddingTop: 20 }}>
                <Collapsible>
                  <CollapsibleTrigger style={{ fontSize: 13.5 }}>
                    Get the exact phrasing for salary talk
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <p
                      className="text-muted-foreground border-l-2"
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.75,
                        marginTop: 12,
                        paddingLeft: 16,
                        maxWidth: 520,
                        borderColor: "var(--gold-dim)",
                      }}
                    >
                      &quot;{topMatchNegotiation.script}&quot;
                    </p>
                  </CollapsiblePanel>
                </Collapsible>
              </div>
            )}
          </div>

          <div
            className="border-l border-border"
            style={{
              padding: "30px 28px",
              background: "linear-gradient(205deg, oklch(0.175 0.007 55), oklch(0.105 0.004 55) 80%)",
            }}
          >
            <p className="text-[10.5px] tracking-[0.16em] uppercase text-muted-foreground mb-3.5">
              Close the gap
            </p>
            {skillRoi.length > 0 ? (
              <>
                {skillRoi.slice(0, 3).map((r, i) => (
                  <div
                    key={r.skill}
                    className={`flex items-baseline justify-between ${i > 0 ? "border-t border-border" : ""}`}
                    style={{ padding: "12px 0", fontSize: 13 }}
                  >
                    <span>{r.skill}</span>
                    <span className="font-display font-light text-primary" style={{ fontSize: 18 }}>
                      +{r.roles_unlocked}
                    </span>
                  </div>
                ))}
                <p className="text-muted-foreground" style={{ fontSize: 12, marginTop: 12 }}>
                  Roles each skill would open at your level.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                No ranked skill gaps yet. Generate a plan below to work through the
                skills missing from your top matches.
              </p>
            )}

            <button
              type="button"
              onClick={handleRoadmap}
              disabled={roadmapLoading}
              className="w-full border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-60 inline-flex items-center justify-center"
              style={{ padding: 11, fontSize: 12.5, fontWeight: 500, borderRadius: 2, marginTop: 20 }}
            >
              {roadmapLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Build a 7 day plan
            </button>
            <Link
              href={`/jobs/${topMatch.job_id}`}
              className="w-full border border-border text-foreground hover:bg-muted transition-colors inline-flex items-center justify-center"
              style={{ padding: 11, fontSize: 12.5, fontWeight: 500, borderRadius: 2, marginTop: 12 }}
            >
              Rewrite my bullets for this role
            </Link>
            <Link
              href={`/jobs/${topMatch.job_id}`}
              className="w-full border border-border text-foreground hover:bg-muted transition-colors inline-flex items-center justify-center"
              style={{ padding: 11, fontSize: 12.5, fontWeight: 500, borderRadius: 2, marginTop: 12 }}
            >
              Practice interview questions
            </Link>
          </div>
        </div>
      )}

      {roadmap && (
        <div className="panel-flat p-6">
          <p className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--gold-dim)]">
            Close the gap
          </p>
          <h2 className="font-display font-light text-2xl mt-1.5">A week, planned</h2>
          {roadmap.cached && (
            <span className="text-xs text-muted-foreground">Cached</span>
          )}
          <div className="mt-3">
            {roadmap.roadmap.map((day) => (
              <div
                key={day.day}
                className="grid grid-cols-[52px_1fr] gap-3.5 border-t border-border"
                style={{ padding: "13px 0" }}
              >
                <span className="font-display text-[var(--gold-dim)]" style={{ fontSize: 17 }}>
                  {String(day.day).padStart(2, "0")}
                </span>
                <div>
                  <p className="font-semibold" style={{ fontSize: 13.5 }}>
                    {day.skill} &middot; {day.duration}
                  </p>
                  <p className="text-muted-foreground mt-1" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    {day.goal} Project: {day.project}. Resources: {day.resources.join(", ")}.
                  </p>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-3">
              Total estimated time: {roadmap.total_estimated_hours}h
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
