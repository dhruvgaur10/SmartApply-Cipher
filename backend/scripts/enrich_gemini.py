"""Progressive Gemini enrichment top-up: upgrades rows from
enrichment_source='rules' to 'gemini' by re-tagging them with actual LLM-based
classification, satisfying the assignment's "AI/LLM-based processing" requirement
across the full corpus over time without blocking full-corpus availability
(scripts/ingest.py already gives every job real rule-based tags immediately).

Usage: python scripts/enrich_gemini.py [--limit N]
Requires backend/.env with SUPABASE_URL, SUPABASE_SERVICE_KEY,
INGEST_GEMINI_API_KEY.

Resumable by construction: always queries for enrichment_source='rules' rows,
so re-running after a quota reset (or any interruption) simply continues where
it left off. Stops cleanly on quota exhaustion instead of retrying uselessly
(same lesson learned from the original ingest.py's first run - see build.md).

Batches BATCH_SIZE jobs per Gemini call (token-cost optimization) using
gemini-3.5-flash-lite (NOT gemini-3.6-flash, which free tier caps at
20 requests/day - see build.md for the incident that established this).
"""
import json
import os
import sys

from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_not_exception_type

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

import google.generativeai as genai  # noqa: E402

from app.database import get_supabase  # noqa: E402

BATCH_SIZE = 10
GEN_MODEL = "gemini-3.5-flash-lite"
DEFAULT_LIMIT = 2000

genai.configure(api_key=os.environ["INGEST_GEMINI_API_KEY"])
gen_model = genai.GenerativeModel(GEN_MODEL)

ENRICHMENT_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "role_category": {"type": "string"},
            "experience_level": {"type": "string", "enum": ["Fresher", "Mid", "Senior"]},
            "min_years_experience": {"type": "integer"},
            "technical_skills": {"type": "array", "items": {"type": "string"}},
            "soft_skills": {"type": "array", "items": {"type": "string"}},
            "domain_tags": {"type": "array", "items": {"type": "string"}},
            "summary_bullets": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["role_category", "experience_level", "technical_skills", "summary_bullets"],
    },
}


class QuotaExhausted(Exception):
    pass


def _is_quota_error(exc: Exception) -> bool:
    return "429" in str(exc) or "ResourceExhausted" in type(exc).__name__


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30),
       retry=retry_if_not_exception_type(QuotaExhausted))
def enrich_batch(jobs: list) -> list:
    prompt = (
        f"Extract structured data from these {len(jobs)} job descriptions. "
        f"Return a JSON array with one object per job, in the same order, matching the schema.\n\n"
    )
    for idx, job in enumerate(jobs):
        prompt += (
            f"Job {idx + 1}:\n"
            f"Title: {job['title']}\n"
            f"Existing skill tags: {job.get('technical_skills', [])}\n"
            f"Description: {(job.get('description') or '')[:400]}\n---\n"
        )
    try:
        response = gen_model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=ENRICHMENT_SCHEMA,
            ),
        )
    except Exception as e:
        if _is_quota_error(e):
            raise QuotaExhausted(str(e)) from e
        raise
    return json.loads(response.text)


def run(limit: int):
    supabase = get_supabase()

    upgraded, errors = 0, 0
    offset = 0
    quota_hit = False

    try:
        while upgraded < limit:
            page = (
                supabase.table("jobs")
                .select("id, title, description, technical_skills")
                .eq("enrichment_source", "rules")
                .range(0, BATCH_SIZE - 1)
                .execute()
            )
            if not page.data:
                print("No more rule-tagged jobs remaining - full corpus is Gemini-enriched.")
                break

            try:
                enrichments = enrich_batch(page.data)
            except QuotaExhausted:
                raise
            except Exception as e:
                print(f"Enrichment failed for batch: {e}")
                errors += len(page.data)
                # mark as attempted so a permanently-broken batch doesn't loop forever
                for job in page.data:
                    supabase.table("jobs").update({"enrichment_source": "rules_failed"}).eq(
                        "id", job["id"]
                    ).execute()
                continue

            for job, enrichment in zip(page.data, enrichments):
                supabase.table("jobs").update(
                    {
                        "role_category": enrichment.get("role_category"),
                        "experience_level": enrichment.get("experience_level"),
                        "min_years_experience": enrichment.get("min_years_experience"),
                        "technical_skills": enrichment.get("technical_skills", [])[:10],
                        "soft_skills": enrichment.get("soft_skills", [])[:5],
                        "domain_tags": enrichment.get("domain_tags", []),
                        "summary_bullets": enrichment.get("summary_bullets", []),
                        "enrichment_source": "gemini",
                    }
                ).eq("id", job["id"]).execute()
                upgraded += 1

            print(f"Progress: upgraded={upgraded} errors={errors}", flush=True)
    except QuotaExhausted as e:
        quota_hit = True
        print(
            f"\nGemini free-tier quota exhausted for model '{GEN_MODEL}'. Stopping cleanly - "
            f"already-upgraded rows are safe. Re-run this script later (or tomorrow, once the "
            f"daily quota resets) to continue upgrading the remaining rule-tagged rows.\n"
            f"Detail: {e}",
            flush=True,
        )

    print("Enrichment top-up stopped (quota exhausted)." if quota_hit else "Enrichment top-up batch complete.")
    print(f"Upgraded={upgraded} Errors={errors}")


if __name__ == "__main__":
    limit_arg = DEFAULT_LIMIT
    if "--limit" in sys.argv:
        limit_arg = int(sys.argv[sys.argv.index("--limit") + 1])
    run(limit_arg)
