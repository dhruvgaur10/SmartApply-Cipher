from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, Header, HTTPException, Query

from app.database import get_supabase, get_qdrant, QDRANT_COLLECTION
from app.models import (
    DigestResponse,
    JobListItem,
    JOB_LIST_COLUMNS,
    ResumeUploadResponse,
    RewriteBulletsRequest,
    RewriteBulletsResponse,
)

RESUME_MATCH_COLUMNS = (
    "id,title,company,location,sources,apply_url,technical_skills,experience_level,"
    "role_category,min_years_experience,salary_min_lpa,salary_max_lpa,posted_date"
)
from app.services.ats_check import check_ats_friendliness
from app.services.matching import score_job
from app.services.resume import open_and_extract, extract_skills, embed_resume
from app.services.agent import rewrite_resume_bullets
from app.services.skills import normalize_skill

router = APIRouter(prefix="/api/resume", tags=["resume"])

# How many nearest-neighbour candidates to pull from Qdrant before reranking.
# This is deliberately much larger than the 5 matches we return, because
# retrieval and ranking use different signals: Qdrant orders by cosine
# distance on a hashed bag-of-words vector (local_embed), which is a crude
# lexical signal, while score_job reranks with skill overlap and experience
# alignment - the signals that actually decide fit. Retrieving only ~20 meant
# the weakest signal silently capped recall: any job the hashed vector failed
# to surface could never be recovered by reranking, however well it matched.
# A resume saying "RDBMS, ORM, microservices" and a job saying "PostgreSQL,
# Django, distributed systems" share almost no literal tokens and would simply
# never meet. Widening the candidate pool costs one Qdrant query and a larger
# in_() fetch (both well inside free-tier limits) and is pure arithmetic to
# rerank, so it is the cheapest available quality win.
CANDIDATE_POOL_SIZE = 200
TOP_MATCHES_RETURNED = 5


@router.post("/upload", response_model=ResumeUploadResponse)
async def upload_resume(file: UploadFile, api_key: str = Header(..., alias="X-Gemini-API-Key")):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF resumes are supported.")

    pdf, text = open_and_extract(file.file)
    try:
        ats_report = check_ats_friendliness(pdf, text)
    finally:
        pdf.close()

    resume_skills_norm = extract_skills(api_key, text)
    resume_embedding = embed_resume(text)

    qdrant = get_qdrant()
    candidates = qdrant.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=resume_embedding,
        limit=CANDIDATE_POOL_SIZE,
    )

    if not candidates:
        return ResumeUploadResponse(
            resume_skills=sorted(resume_skills_norm), top_matches=[], ats_report=ats_report, resume_text=text
        )

    supabase = get_supabase()
    job_ids = [str(c.id) for c in candidates]
    jobs_data = supabase.table("jobs").select(RESUME_MATCH_COLUMNS).in_("id", job_ids).execute().data
    jobs_dict = {job["id"]: job for job in jobs_data}

    scored_jobs = []
    for candidate in candidates:
        job = jobs_dict.get(str(candidate.id))
        if not job:
            continue
        scored = score_job(text, resume_skills_norm, job, float(candidate.score))
        scored_jobs.append(scored)

    top_matches = sorted(scored_jobs, key=lambda x: x["match_score"], reverse=True)[
        :TOP_MATCHES_RETURNED
    ]
    return ResumeUploadResponse(
        resume_skills=sorted(resume_skills_norm),
        top_matches=top_matches,
        ats_report=ats_report,
        resume_text=text,
    )


# How many new jobs a digest check will return at most - a digest is meant to
# be a quick "here's what's new" glance, not a second full search page, so
# this is capped much lower than the browse page's normal page size.
DIGEST_MAX_RESULTS = 12


@router.get("/digest", response_model=DigestResponse)
def get_digest(
    since: str = Query(..., description="ISO 8601 timestamp - only jobs created after this are considered"),
    skills: str = Query(default="", description="Comma-separated resume skills to rank relevance against"),
    category: str = Query(default="", description="Resume's dominant role_category, narrows the candidate pool"),
):
    """New-jobs-since-last-visit digest, computed entirely from data already
    in Supabase - no Qdrant search and no Gemini call, so this is safe to hit
    on every /matches page load without BYOK-key or rate-limit concerns.
    Ranks by skill overlap against the resume skills the client already has
    cached from its last upload, falling back to plain recency when no
    skills are supplied."""
    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "`since` must be an ISO 8601 timestamp")

    resume_skills_norm = {normalize_skill(s) for s in skills.split(",") if s.strip()}

    supabase = get_supabase()
    query = (
        supabase.table("jobs")
        .select(JOB_LIST_COLUMNS + ",created_at")
        .gt("created_at", since_dt.isoformat())
    )
    if category:
        query = query.eq("role_category", category)
    # Widen past DIGEST_MAX_RESULTS before ranking, same rationale as the
    # resume-match candidate pool: rank on the richer signal (skill overlap)
    # over a larger pool, then trim, rather than trimming to DIGEST_MAX_RESULTS
    # by created_at first and losing better-fitting jobs that happen to be
    # slightly older within the window.
    rows = query.order("created_at", desc=True).limit(200).execute().data

    def _overlap_count(row: dict) -> int:
        if not resume_skills_norm:
            return 0
        job_skills_norm = {normalize_skill(s) for s in (row.get("technical_skills") or [])}
        return len(resume_skills_norm & job_skills_norm)

    ranked = sorted(rows, key=lambda r: (_overlap_count(r), r["created_at"]), reverse=True)
    top = ranked[:DIGEST_MAX_RESULTS]

    return DigestResponse(
        jobs=[JobListItem(**{k: v for k, v in row.items() if k != "created_at"}) for row in top],
        since=since_dt.isoformat(),
        checked_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/rewrite-bullets", response_model=RewriteBulletsResponse)
def rewrite_bullets(request: RewriteBulletsRequest, api_key: str = Header(..., alias="X-Gemini-API-Key")):
    result = rewrite_resume_bullets(api_key, request.job_id, request.resume_text)
    return RewriteBulletsResponse(**result)
