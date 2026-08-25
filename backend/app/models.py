from typing import List, Optional

from pydantic import BaseModel, Field


class Job(BaseModel):
    id: str
    title: str
    company: str
    location: Optional[str] = None
    description: Optional[str] = None
    posted_date: Optional[str] = None
    apply_url: Optional[str] = None
    sources: List[str] = Field(default_factory=list)
    technical_skills: List[str] = Field(default_factory=list)
    role_category: Optional[str] = None
    experience_level: Optional[str] = None
    min_years_experience: Optional[int] = None
    soft_skills: List[str] = Field(default_factory=list)
    domain_tags: List[str] = Field(default_factory=list)
    summary_bullets: List[str] = Field(default_factory=list)
    salary_min_lpa: Optional[float] = None
    salary_max_lpa: Optional[float] = None
    enrichment_source: Optional[str] = "rules"


class JobListItem(BaseModel):
    id: str
    title: str
    company: str
    location: Optional[str] = None
    posted_date: Optional[str] = None
    apply_url: Optional[str] = None
    sources: List[str] = Field(default_factory=list)
    technical_skills: List[str] = Field(default_factory=list)
    role_category: Optional[str] = None
    experience_level: Optional[str] = None
    min_years_experience: Optional[int] = None
    summary_bullets: List[str] = Field(default_factory=list)
    salary_min_lpa: Optional[float] = None
    salary_max_lpa: Optional[float] = None
    enrichment_source: Optional[str] = "rules"


JOB_LIST_COLUMNS = (
    "id,title,company,location,posted_date,apply_url,sources,technical_skills,"
    "role_category,experience_level,min_years_experience,summary_bullets,"
    "salary_min_lpa,salary_max_lpa,enrichment_source"
)


class JobSearchResponse(BaseModel):
    jobs: List[JobListItem]
    total: Optional[int] = None
    has_more: bool = False


class MatchBreakdown(BaseModel):
    skill_overlap: float
    semantic_similarity: float
    experience_alignment: float
    matched_skills: List[str]
    missing_skills: List[str]
    # Which signals actually backed this score. 16.6% of jobs have no skill
    # tags and 38.6% have an ambiguous zero-years requirement, so a score is
    # not always built on the same evidence - the UI shows this rather than
    # implying every percentage is equally well-founded.
    has_skill_signal: bool = True
    has_experience_signal: bool = True
    confidence: str = "high"


class MatchedJob(BaseModel):
    job_id: str
    title: str
    company: str
    location: Optional[str] = None
    sources: List[str]
    apply_url: Optional[str] = None
    role_category: Optional[str] = None
    # Surfaced on the match row so a user can judge level and pay without
    # opening the job - the same three facts the row's meta line shows.
    experience_level: Optional[str] = None
    min_years_experience: Optional[int] = None
    salary_min_lpa: Optional[float] = None
    salary_max_lpa: Optional[float] = None
    posted_date: Optional[str] = None
    match_score: float
    # A one-line, deterministic (not LLM-generated) summary built from the
    # breakdown, so a user can decide if a job is worth a click without
    # reading the radar chart. See matching.generate_match_verdict.
    verdict: str = ""
    breakdown: MatchBreakdown


class AtsIssue(BaseModel):
    severity: str
    message: str


class AtsReport(BaseModel):
    score: int
    checks_passed: int
    checks_total: int
    issues: List[AtsIssue]


class ResumeUploadResponse(BaseModel):
    resume_skills: List[str]
    top_matches: List[MatchedJob]
    ats_report: AtsReport
    resume_text: str


class ChatRequest(BaseModel):
    messages: List[dict]
    session_id: str
    user_skills: Optional[List[str]] = None


class RoadmapRequest(BaseModel):
    missing_skills: List[str]
    current_skills: Optional[List[str]] = None


class InterviewRequest(BaseModel):
    job_id: str
    difficulty: str = "medium"


class CompareRequest(BaseModel):
    job_id_1: str
    job_id_2: str


class CompareNWayRequest(BaseModel):
    job_ids: List[str] = Field(..., min_length=2, max_length=4)


class RewriteBulletsRequest(BaseModel):
    job_id: str
    resume_text: str


class BulletSuggestion(BaseModel):
    original: Optional[str] = None
    rewritten: str


class RewriteBulletsResponse(BaseModel):
    suggestions: List[BulletSuggestion]
    cached: bool = False


class DigestResponse(BaseModel):
    jobs: List[JobListItem]
    since: str
    checked_at: str
