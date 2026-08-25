from fastapi import APIRouter
from pydantic import BaseModel

from app.database import get_supabase

router = APIRouter(prefix="/api", tags=["feedback"])


class MatchFeedbackRequest(BaseModel):
    anon_id: str
    job_id: str
    relevant: bool
    match_score: float | None = None
    skill_overlap: float | None = None
    semantic_similarity: float | None = None
    experience_alignment: float | None = None
    confidence: str | None = None


@router.post("/feedback/match")
def submit_match_feedback(request: MatchFeedbackRequest):
    """Logs a thumbs up/down on a match, with its full score breakdown
    attached. This is the actual missing ingredient for improving
    match_score: real relevance labels, collected immediately rather than
    inferred weeks later from a self-reported outcome. Best-effort, mirrors
    cache.py's defensive pattern - a logging failure must never break the
    user-facing action they just took (clicking thumbs up/down)."""
    try:
        supabase = get_supabase()
        supabase.table("match_feedback").insert(
            {
                "anon_id": request.anon_id,
                "job_id": request.job_id,
                "relevant": request.relevant,
                "match_score": request.match_score,
                "skill_overlap": request.skill_overlap,
                "semantic_similarity": request.semantic_similarity,
                "experience_alignment": request.experience_alignment,
                "confidence": request.confidence,
            }
        ).execute()
        return {"ok": True}
    except Exception:
        # The match_feedback table may not exist yet in every environment
        # (created via manual SQL, not an automated migration) - a missing
        # table or any other write failure should not surface as an error to
        # the user for something as low-stakes as a feedback click.
        return {"ok": False}
