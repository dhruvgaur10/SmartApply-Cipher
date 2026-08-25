export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  posted_date: string | null;
  apply_url: string | null;
  sources: string[];
  technical_skills: string[];
  role_category: string | null;
  experience_level: string | null;
  min_years_experience: number | null;
  soft_skills: string[];
  domain_tags: string[];
  summary_bullets: string[];
  salary_min_lpa: number | null;
  salary_max_lpa: number | null;
  enrichment_source?: string;
}

export interface JobSearchResponse {
  jobs: Job[];
  total: number | null;
  has_more: boolean;
}

export interface DigestResponse {
  jobs: Job[];
  since: string;
  checked_at: string;
}

export interface MatchBreakdown {
  skill_overlap: number;
  semantic_similarity: number;
  experience_alignment: number;
  matched_skills: string[];
  missing_skills: string[];
  has_skill_signal: boolean;
  has_experience_signal: boolean;
  confidence: "high" | "medium" | "low";
}

export interface MatchedJob {
  job_id: string;
  title: string;
  company: string;
  location: string | null;
  sources: string[];
  apply_url: string | null;
  role_category: string | null;
  experience_level: string | null;
  min_years_experience: number | null;
  salary_min_lpa: number | null;
  salary_max_lpa: number | null;
  posted_date: string | null;
  match_score: number;
  verdict: string;
  breakdown: MatchBreakdown;
}

export interface AtsIssue {
  severity: "high" | "medium" | "low";
  message: string;
}

export interface AtsReport {
  score: number;
  checks_passed: number;
  checks_total: number;
  issues: AtsIssue[];
}

export interface ResumeUploadResponse {
  resume_skills: string[];
  top_matches: MatchedJob[];
  ats_report: AtsReport;
  resume_text: string;
}

export interface BulletSuggestion {
  original: string | null;
  rewritten: string;
}

export interface RewriteBulletsResponse {
  suggestions: BulletSuggestion[];
  cached: boolean;
}

export interface RoadmapDay {
  day: number;
  skill: string;
  goal: string;
  resources: string[];
  project: string;
  duration: string;
}

export interface Roadmap {
  roadmap: RoadmapDay[];
  total_estimated_hours: number;
  cached?: boolean;
}

export interface InterviewQuestion {
  question: string;
  hints: string[];
  expected_concepts: string[];
}

export interface ComparisonResult {
  comparison: {
    titles: { job1: string; job2: string };
    companies: { job1: string; job2: string };
    locations: { job1: string | null; job2: string | null };
    experience_levels: { job1: string | null; job2: string | null };
    skills: { common: string[]; only_in_job1: string[]; only_in_job2: string[] };
    sources: { job1: string[]; job2: string[] };
  };
}

export interface ComparedJob {
  job_id: string;
  title: string;
  company: string;
  location: string | null;
  experience_level: string | null;
  salary_min_lpa: number | null;
  salary_max_lpa: number | null;
  sources: string[];
  unique_skills: string[];
}

export interface NWayComparisonResult {
  comparison: {
    jobs: ComparedJob[];
    common_skills: string[];
  };
}

export type ApplicationStatusValue = "applied" | "interview" | "rejected" | "offer";

export interface ApplicationStatus {
  jobId: string;
  appliedAt: string;
  status: ApplicationStatusValue;
  notes?: string;
}

export type ChatEvent =
  | { type: "job_card"; data: Job }
  | { type: "comparison"; data: ComparisonResult }
  | { type: "roadmap"; data: Roadmap }
  | { type: "interview"; data: InterviewQuestion[] }
  | { type: "text"; content: string }
  | { type: "done" };
