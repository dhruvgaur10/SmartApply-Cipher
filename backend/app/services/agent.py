import json

from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.database import get_supabase
from app.services.gemini_client import get_model, call_gemini
from app.services.cache import cache_get, cache_set, hash_key

ROADMAP_PROMPT = """Generate a structured 7-day learning roadmap to acquire these skills: {missing_skills}
Current skills: {current_skills}

Return only JSON matching this structure, no other text:
{{
  "roadmap": [
    {{"day": 1, "skill": "...", "goal": "...", "resources": ["...", "..."], "project": "...", "duration": "..."}}
  ],
  "total_estimated_hours": 15
}}"""

INTERVIEW_PROMPT = """Generate 5 {difficulty} technical interview questions for this role:
Title: {title}
Skills: {skills}
Experience: {experience}

Return only a JSON array, no other text:
[
  {{"question": "...", "hints": ["...", "..."], "expected_concepts": ["...", "..."]}}
]"""

REWRITE_BULLETS_PROMPT = """You are helping a job applicant tailor their resume to a specific job, using ONLY their real, existing experience - never invent skills, tools, or achievements that are not already present in their resume text below.

Job title: {title}
Job's required skills: {skills}
Job description excerpt: {description}

Candidate's resume text:
{resume_text}

Task: write exactly 3 ATS-optimized resume bullet points that reframe the candidate's REAL, EXISTING experience (from the resume text above) using language and keywords that match this job posting. Each bullet must be grounded in something the candidate actually wrote - do not fabricate metrics, technologies, or responsibilities not present in the resume text.

Return only JSON matching this structure, no other text:
{{
  "suggestions": [
    {{"original": "the closest matching original resume line, or null if none found", "rewritten": "the tailored bullet point"}}
  ]
}}"""


def _generate_json(api_key: str, prompt: str):
    model = get_model(api_key)
    response = call_gemini(
        model.generate_content, prompt, generation_config={"response_mime_type": "application/json"}
    )
    return json.loads(response.text)


def generate_learning_roadmap(api_key: str, missing_skills: list, current_skills: list = None):
    current_skills = current_skills or []
    key = hash_key(["roadmap", sorted(missing_skills), sorted(current_skills)])
    cached = cache_get(key)
    if cached is not None:
        return {**cached, "cached": True}

    prompt = ROADMAP_PROMPT.format(missing_skills=missing_skills, current_skills=current_skills)
    result = _generate_json(api_key, prompt)
    cache_set(key, result)
    return {**result, "cached": False}


def generate_interview_questions(api_key: str, job_id: str, difficulty: str = "medium"):
    key = hash_key(["interview", job_id, difficulty])
    cached = cache_get(key)
    if cached is not None:
        return cached

    supabase = get_supabase()
    result = supabase.table("jobs").select("*").eq("id", job_id).execute()
    if not result.data:
        raise HTTPException(404, "Job not found")
    job = result.data[0]
    prompt = INTERVIEW_PROMPT.format(
        difficulty=difficulty,
        title=job["title"],
        skills=job.get("technical_skills", []),
        experience=job.get("experience_level"),
    )
    questions = _generate_json(api_key, prompt)
    cache_set(key, questions)
    return questions


def rewrite_resume_bullets(api_key: str, job_id: str, resume_text: str):
    # Cache keyed by (job_id, hash of resume text) - re-viewing the same job
    # with the same resume doesn't burn another Gemini call against the
    # 500/day BYOK quota.
    resume_hash = hash_key([resume_text])
    key = hash_key(["rewrite_bullets", job_id, resume_hash])
    cached = cache_get(key)
    if cached is not None:
        return {**cached, "cached": True}

    supabase = get_supabase()
    result = supabase.table("jobs").select("*").eq("id", job_id).execute()
    if not result.data:
        raise HTTPException(404, "Job not found")
    job = result.data[0]

    prompt = REWRITE_BULLETS_PROMPT.format(
        title=job["title"],
        skills=job.get("technical_skills", []),
        description=(job.get("description") or "")[:1500],
        resume_text=resume_text[:6000],
    )
    result_json = _generate_json(api_key, prompt)

    # Defensive guard against hallucinated bullets: keep only suggestions
    # whose "original" line (when provided) actually appears in the source
    # resume text, mirroring the same hallucination-filter pattern used for
    # skill extraction - a rewritten bullet grounded in a fabricated
    # "original" line isn't a tailored bullet, it's an invented one.
    resume_lower = resume_text.lower()
    verified = []
    for s in result_json.get("suggestions", []):
        original = s.get("original")
        if original and original.strip().lower() not in resume_lower:
            continue
        verified.append({"original": original, "rewritten": s.get("rewritten", "")})

    output = {"suggestions": verified}
    cache_set(key, output)
    return {**output, "cached": False}


def _fetch_jobs_for_comparison(job_ids: list) -> list:
    supabase = get_supabase()
    try:
        rows = supabase.table("jobs").select("*").in_("id", job_ids).execute().data
    except APIError as e:
        # job_id is a Postgres UUID column - a malformed id (not just an
        # unmatched one) raises here rather than simply returning no rows,
        # so a bad id from a client must be reported as 404, not surfaced as
        # an unhandled 500.
        raise HTTPException(404, "One or more job ids are invalid") from e
    by_id = {row["id"]: row for row in rows}
    missing = [jid for jid in job_ids if jid not in by_id]
    if missing:
        raise HTTPException(404, f"Job(s) not found: {', '.join(missing)}")
    return [by_id[jid] for jid in job_ids]


def compare_jobs_detailed(job_id_1: str, job_id_2: str):
    """Chat tool's fixed 2-job comparison (routers/chat.py's compare_jobs
    function-calling contract, rendered by ChatDrawer.tsx's `comparison`
    message kind) - kept as its own function, with its own fixed response
    shape, rather than folded into compare_jobs_n_way with a shape that
    varies by job count. A response whose shape depends on len(job_ids) is
    exactly the kind of implicit contract that breaks a caller silently:
    the N-way comparison view expects `comparison.jobs`/`common_skills`
    unconditionally, and a 2-job request into a count-dependent endpoint
    would get back `comparison.titles` instead, with no error, just wrong
    data hitting a `.map()` deeper in the code."""
    if not job_id_1 or not job_id_2:
        raise HTTPException(400, "Both job_id_1 and job_id_2 are required")
    job1, job2 = _fetch_jobs_for_comparison([job_id_1, job_id_2])
    skills1 = set(job1.get("technical_skills", []))
    skills2 = set(job2.get("technical_skills", []))

    return {
        "comparison": {
            "titles": {"job1": job1["title"], "job2": job2["title"]},
            "companies": {"job1": job1["company"], "job2": job2["company"]},
            "locations": {"job1": job1.get("location"), "job2": job2.get("location")},
            "experience_levels": {
                "job1": job1.get("experience_level"),
                "job2": job2.get("experience_level"),
            },
            "skills": {
                "common": sorted(skills1 & skills2),
                "only_in_job1": sorted(skills1 - skills2),
                "only_in_job2": sorted(skills2 - skills1),
            },
            "sources": {"job1": job1.get("sources", []), "job2": job2.get("sources", [])},
        }
    }


def compare_jobs_n_way(job_ids: list):
    """The dedicated shortlist-comparison view's endpoint (2-4 jobs, from
    the Saved tab). Always returns the same shape regardless of job count -
    `comparison.jobs[]` plus `common_skills` - so the frontend never has to
    branch on how many jobs it asked for."""
    if not job_ids or len(job_ids) < 2:
        raise HTTPException(400, "Comparison needs at least 2 job ids")

    jobs = _fetch_jobs_for_comparison(job_ids)
    skill_sets = [set(j.get("technical_skills", [])) for j in jobs]
    common_skills = set.intersection(*skill_sets) if skill_sets else set()

    return {
        "comparison": {
            "jobs": [
                {
                    "job_id": j["id"],
                    "title": j["title"],
                    "company": j["company"],
                    "location": j.get("location"),
                    "experience_level": j.get("experience_level"),
                    "salary_min_lpa": j.get("salary_min_lpa"),
                    "salary_max_lpa": j.get("salary_max_lpa"),
                    "sources": j.get("sources", []),
                    "unique_skills": sorted(skill_sets[i] - common_skills),
                }
                for i, j in enumerate(jobs)
            ],
            "common_skills": sorted(common_skills),
        }
    }
