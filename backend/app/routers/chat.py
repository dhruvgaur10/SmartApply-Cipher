import json

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse
import google.generativeai as genai
from google.generativeai.types import FunctionDeclaration

from app.database import get_supabase
from app.models import ChatRequest
from app.routers.jobs import search_jobs
from app.services.agent import compare_jobs_detailed, generate_learning_roadmap, generate_interview_questions
from app.services.gemini_client import get_model, translate_gemini_error
from app.services.cache import cache_get, cache_set

router = APIRouter(prefix="/api", tags=["chat"])

# Bounds per-session history stored in kv_cache (free-tier Supabase row size
# and storage protection, not just Gemini context size) - only the last N
# role/content pairs are kept, oldest dropped first.
MAX_HISTORY_TURNS = 20

# The second (narration) round-trip doubles Gemini calls for these tools -
# real cost against the 500/day BYOK free-tier quota. Only worth it for
# tools whose raw output benefits from a natural-language gloss (a job list
# or comparison table read better with a sentence of context); roadmap/
# interview already render as self-explanatory dedicated UI in ChatDrawer,
# so narrating them again is quota spent for no real UX gain.
#
# get_job_details IS narration-worthy, and was a real bug before this
# comment: without narration, any freeform question about a job (or the
# existing "summarize this job" proactive prompt in ChatDrawer/jobs/[id])
# calls this tool, gets the job's text back, and then the turn ends with NO
# text response at all - confirmed live, a real user-facing dead end, not
# just a missed feature. Narrating it is also what makes it "grounded":
# the system instruction below tells the model to answer only from the
# job_details tool's actual returned text, not general knowledge, so
# questions like "does this mention on-call" or "is it fully remote" are
# answered from the real posting or answered "not mentioned" rather than
# guessed.
NARRATION_WORTHY_TOOLS = {"search_jobs", "compare_jobs", "get_job_details"}

GROUNDED_JOB_QA_INSTRUCTION = (
    "When you call get_job_details and then answer a question about that job, "
    "answer ONLY using the title, company, and description text returned by the "
    "tool. If the answer isn't stated in that text, say plainly that the posting "
    "doesn't mention it - do not guess or fill in from general knowledge about "
    "similar roles or companies. Keep the answer to 1-3 sentences and quote the "
    "relevant phrase from the posting when it directly answers the question."
)

TOOLS = [
    FunctionDeclaration(
        name="search_jobs",
        description="Search jobs by title/skill keyword, source platform, role category, location, and years of experience",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Free-text keyword matched against job title and technical skills only, not the full description"},
                "platform": {"type": "string", "enum": ["LinkedIn", "Naukri", "Indeed", "Internshala"]},
                "min_years": {"type": "integer", "description": "Minimum years of experience required, e.g. 0 for fresher roles, 5 for senior"},
                "max_years": {"type": "integer", "description": "Maximum years of experience required"},
                "category": {"type": "string", "description": "Role category, e.g. Data Science, Frontend, Backend"},
                "location": {"type": "string", "description": "City or location substring, e.g. Chandigarh, Bangalore"},
            },
        },
    ),
    FunctionDeclaration(
        name="compare_jobs",
        description="Detailed side-by-side comparison of two jobs",
        parameters={
            "type": "object",
            "properties": {"job_id_1": {"type": "string"}, "job_id_2": {"type": "string"}},
            "required": ["job_id_1", "job_id_2"],
        },
    ),
    FunctionDeclaration(
        name="generate_learning_roadmap",
        description="Create 7-day learning plan for skill gaps",
        parameters={
            "type": "object",
            "properties": {
                "missing_skills": {"type": "array", "items": {"type": "string"}},
                "current_skills": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["missing_skills"],
        },
    ),
    FunctionDeclaration(
        name="generate_interview_questions",
        description="Generate technical interview questions for a job",
        parameters={
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
            },
            "required": ["job_id"],
        },
    ),
    FunctionDeclaration(
        name="get_job_details",
        description=(
            "Fetch the full description and details of a specific job by its ID. "
            "Use this whenever the user asks anything specific about one job - "
            "remote/hybrid setup, on-call, team size, tech stack, benefits, or to "
            "summarize it - so the answer is grounded in the real posting text."
        ),
        parameters={
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    ),
]


def _history_key(session_id: str) -> str:
    return f"chat_session:{session_id}"


def _load_history(session_id: str) -> list:
    return cache_get(_history_key(session_id)) or []


def _save_history(session_id: str, history: list) -> None:
    # Trim to the last MAX_HISTORY_TURNS role/content entries - bounds the
    # kv_cache row size and Gemini context length as a conversation grows,
    # since this is a free-tier Supabase table shared with other cached data.
    cache_set(_history_key(session_id), history[-MAX_HISTORY_TURNS:])


def _run_tool(func_name: str, func_args: dict, api_key: str):
    """Executes one tool call, returns (sse_events, function_response_dict).

    sse_events are yielded to the client immediately (structured data the UI
    renders directly - job cards, comparison tables, etc). function_response
    is sent back to Gemini so it can narrate a reply in its own words on a
    second turn, per real Gemini function-calling flow (the model never saw
    the tool's actual output before this fix - see build.md's chat audit)."""
    if func_name == "search_jobs":
        result = search_jobs(
            q=func_args.get("query", ""),
            platform=func_args.get("platform"),
            min_years=func_args.get("min_years"),
            max_years=func_args.get("max_years"),
            category=func_args.get("category"),
            location=func_args.get("location"),
        )
        events = [{"type": "job_card", "data": job.model_dump()} for job in result.jobs]
        summary = {"count": len(result.jobs), "titles": [j.title for j in result.jobs[:5]]}
        return events, summary
    if func_name == "compare_jobs":
        comp = compare_jobs_detailed(**func_args)
        return [{"type": "comparison", "data": comp}], comp
    if func_name == "generate_learning_roadmap":
        roadmap = generate_learning_roadmap(api_key, **func_args)
        return [{"type": "roadmap", "data": roadmap}], {"total_estimated_hours": roadmap.get("total_estimated_hours")}
    if func_name == "generate_interview_questions":
        questions = generate_interview_questions(api_key, **func_args)
        return [{"type": "interview", "data": questions}], {"question_count": len(questions)}
    if func_name == "get_job_details":
        supabase = get_supabase()
        rows = (
            supabase.table("jobs")
            .select("title,company,location,technical_skills,experience_level,description,summary_bullets")
            .eq("id", func_args["job_id"])
            .execute()
            .data
        )
        if not rows:
            return [], {"found": False}
        job_data = rows[0]
        return [], {
            "found": True,
            "title": job_data.get("title"),
            "company": job_data.get("company"),
            "location": job_data.get("location"),
            "summary_bullets": job_data.get("summary_bullets") or [],
            "description": (job_data.get("description") or "")[:1500],
        }
    return [], {"error": f"unknown tool {func_name}"}


@router.post("/chat")
async def chat(request: ChatRequest, api_key: str = Header(..., alias="X-Gemini-API-Key")):
    def generate():
        try:
            history = _load_history(request.session_id)
            model = get_model(api_key, tools=TOOLS)
            chat_session = model.start_chat(history=history)

            if not history:
                context_parts = [GROUNDED_JOB_QA_INSTRUCTION]
                if request.user_skills:
                    context_parts.append(
                        f"The user's parsed resume skills are: {', '.join(request.user_skills)}."
                    )
                chat_session.send_message("System Context: " + " ".join(context_parts))

            response = chat_session.send_message(request.messages[-1]["content"])

            for part in response.parts:
                if getattr(part, "function_call", None) and part.function_call.name:
                    func_name = part.function_call.name
                    func_args = dict(part.function_call.args)

                    events, func_result = _run_tool(func_name, func_args, api_key)
                    for event in events:
                        yield f"data: {json.dumps(event)}\n\n"

                    if func_name not in NARRATION_WORTHY_TOOLS:
                        continue

                    # Second round-trip: hand the tool's result back to Gemini
                    # so it can produce a natural-language reply that
                    # references it, instead of the client only ever seeing
                    # raw structured data with no model commentary. Gated to
                    # NARRATION_WORTHY_TOOLS since this doubles the Gemini
                    # call count for the turn - real cost against the BYOK
                    # 500/day free-tier quota.
                    followup = chat_session.send_message(
                        genai.protos.Content(
                            parts=[
                                genai.protos.Part(
                                    function_response=genai.protos.FunctionResponse(
                                        name=func_name, response={"result": func_result}
                                    )
                                )
                            ]
                        )
                    )
                    for fpart in followup.parts:
                        if getattr(fpart, "text", None):
                            yield f"data: {json.dumps({'type': 'text', 'content': fpart.text})}\n\n"
                elif getattr(part, "text", None):
                    yield f"data: {json.dumps({'type': 'text', 'content': part.text})}\n\n"

            _save_history(request.session_id, [
                {"role": m.role, "parts": [p.text for p in m.parts if getattr(p, "text", None)]}
                for m in chat_session.history
                if any(getattr(p, "text", None) for p in m.parts)
            ])
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'text', 'content': translate_gemini_error(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
