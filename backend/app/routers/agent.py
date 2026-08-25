from fastapi import APIRouter, Header

from app.models import RoadmapRequest, InterviewRequest, CompareRequest, CompareNWayRequest
from app.services.agent import (
    compare_jobs_detailed,
    compare_jobs_n_way,
    generate_learning_roadmap,
    generate_interview_questions,
)

router = APIRouter(prefix="/api", tags=["agent"])


@router.post("/roadmap")
def roadmap(request: RoadmapRequest, api_key: str = Header(..., alias="X-Gemini-API-Key")):
    return generate_learning_roadmap(api_key, request.missing_skills, request.current_skills)


@router.post("/interview")
def interview(request: InterviewRequest, api_key: str = Header(..., alias="X-Gemini-API-Key")):
    return generate_interview_questions(api_key, request.job_id, request.difficulty)


@router.post("/compare")
def compare(request: CompareRequest):
    """Fixed 2-job comparison - the chat tool's contract. See
    services/agent.compare_jobs_detailed for why this stays a separate,
    fixed-shape endpoint from /compare/shortlist."""
    return compare_jobs_detailed(request.job_id_1, request.job_id_2)


@router.post("/compare/shortlist")
def compare_shortlist(request: CompareNWayRequest):
    """N-way comparison (2-4 jobs) for the dedicated Saved-tab comparison
    view. Always returns comparison.jobs[]/common_skills regardless of
    count - see services/agent.compare_jobs_n_way."""
    return compare_jobs_n_way(request.job_ids)
