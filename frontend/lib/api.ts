import type {
  JobSearchResponse,
  Job,
  ResumeUploadResponse,
  Roadmap,
  InterviewQuestion,
  RewriteBulletsResponse,
  NWayComparisonResult,
  DigestResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function searchJobs(params: {
  q?: string;
  platform?: string;
  minYears?: number;
  maxYears?: number;
  category?: string;
  location?: string;
  limit?: number;
  offset?: number;
}): Promise<JobSearchResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.platform) query.set("platform", params.platform);
  if (params.minYears !== undefined) query.set("min_years", String(params.minYears));
  if (params.maxYears !== undefined) query.set("max_years", String(params.maxYears));
  if (params.category) query.set("category", params.category);
  if (params.location) query.set("location", params.location);
  query.set("limit", String(params.limit ?? 20));
  query.set("offset", String(params.offset ?? 0));

  const res = await fetch(`${API_URL}/api/jobs/search?${query}`);
  return handleResponse(res);
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}`);
  return handleResponse(res);
}

export async function getSources(): Promise<{ sources: string[] }> {
  const res = await fetch(`${API_URL}/api/jobs/meta/sources`);
  return handleResponse(res);
}

export async function getCategories(): Promise<{ categories: string[] }> {
  const res = await fetch(`${API_URL}/api/jobs/meta/categories`);
  return handleResponse(res);
}

export interface JobStats {
  unique_jobs: number;
  companies_hiring: number;
  duplicates_merged: number;
  sources_aggregated: number;
  source_breakdown: Record<string, number>;
  top_categories: { category: string; count: number }[];
}

export async function getStats(): Promise<JobStats> {
  const res = await fetch(`${API_URL}/api/stats`);
  return handleResponse(res);
}

export interface CompanySalary {
  company: string;
  min_lpa: number;
  max_lpa: number;
  average_lpa: number;
  sample_size: number;
}

export interface SalaryGlobalStats {
  highest_lpa: number | null;
  lowest_lpa: number | null;
  average_lpa: number | null;
  jobs_with_salary_data: number;
}

export interface ExperienceLevelBand {
  median_lpa: number | null;
  min_lpa: number;
  max_lpa: number;
  sample_size: number;
}

export async function getSalaryStats(params?: { company?: string; category?: string }): Promise<{
  global: SalaryGlobalStats;
  top_companies?: CompanySalary[];
  companies?: CompanySalary[];
  by_experience_level: Record<string, ExperienceLevelBand>;
}> {
  const query = new URLSearchParams();
  if (params?.company) query.set("company", params.company);
  if (params?.category) query.set("category", params.category);
  const qs = query.toString();
  const res = await fetch(`${API_URL}/api/stats/salary${qs ? `?${qs}` : ""}`);
  return handleResponse(res);
}

export interface NamedCount {
  name: string;
  count: number;
  pct: number;
}

export interface TrendsData {
  total_jobs: number;
  categories: NamedCount[];
  domains: NamedCount[];
  top_skills: NamedCount[];
  experience_levels: NamedCount[];
}

export async function getTrends(category?: string): Promise<TrendsData> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`${API_URL}/api/stats/trends${query}`);
  return handleResponse(res);
}

export async function getDigest(params: {
  since: string;
  skills?: string[];
  category?: string;
}): Promise<DigestResponse> {
  const query = new URLSearchParams({ since: params.since });
  if (params.skills?.length) query.set("skills", params.skills.join(","));
  if (params.category) query.set("category", params.category);
  const res = await fetch(`${API_URL}/api/resume/digest?${query}`);
  return handleResponse(res);
}

export async function uploadResume(file: File, apiKey: string): Promise<ResumeUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/api/resume/upload`, {
    method: "POST",
    headers: { "X-Gemini-API-Key": apiKey },
    body: formData,
  });
  return handleResponse(res);
}

export async function generateRoadmap(
  missingSkills: string[],
  currentSkills: string[],
  apiKey: string
): Promise<Roadmap> {
  const res = await fetch(`${API_URL}/api/roadmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gemini-API-Key": apiKey },
    body: JSON.stringify({ missing_skills: missingSkills, current_skills: currentSkills }),
  });
  return handleResponse(res);
}

export async function generateInterview(
  jobId: string,
  difficulty: string,
  apiKey: string
): Promise<InterviewQuestion[]> {
  const res = await fetch(`${API_URL}/api/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gemini-API-Key": apiKey },
    body: JSON.stringify({ job_id: jobId, difficulty }),
  });
  return handleResponse(res);
}

export async function rewriteBullets(
  jobId: string,
  resumeText: string,
  apiKey: string
): Promise<RewriteBulletsResponse> {
  const res = await fetch(`${API_URL}/api/resume/rewrite-bullets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gemini-API-Key": apiKey },
    body: JSON.stringify({ job_id: jobId, resume_text: resumeText }),
  });
  return handleResponse(res);
}

export async function compareJobs(jobIds: string[]): Promise<NWayComparisonResult> {
  const res = await fetch(`${API_URL}/api/compare/shortlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds }),
  });
  return handleResponse(res);
}

export function chatUrl(): string {
  return `${API_URL}/api/chat`;
}

export interface SkillRoiEntry {
  skill: string;
  roles_unlocked: number;
}

export async function getSkillRoi(missingSkills: string[]): Promise<{ ranked: SkillRoiEntry[] }> {
  const res = await fetch(`${API_URL}/api/stats/skill-roi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ missing_skills: missingSkills }),
  });
  return handleResponse(res);
}

export async function submitMatchFeedback(payload: {
  anonId: string;
  jobId: string;
  relevant: boolean;
  matchScore?: number;
  skillOverlap?: number;
  semanticSimilarity?: number;
  experienceAlignment?: number;
  confidence?: string;
}): Promise<void> {
  // Best-effort, fire-and-forget from the caller's perspective - a feedback
  // click should never surface a network error to the user.
  try {
    await fetch(`${API_URL}/api/feedback/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anon_id: payload.anonId,
        job_id: payload.jobId,
        relevant: payload.relevant,
        match_score: payload.matchScore,
        skill_overlap: payload.skillOverlap,
        semantic_similarity: payload.semanticSimilarity,
        experience_alignment: payload.experienceAlignment,
        confidence: payload.confidence,
      }),
    });
  } catch {
    // ignored - see comment above
  }
}

export { API_URL };
