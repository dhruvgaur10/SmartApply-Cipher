"""One-off backfill: re-run rule_enrich() against all rows still tagged
enrichment_source='rules' to pick up dedup/experience-level fixes made after
the initial full-corpus ingestion (city-alias location fixes, JD-years-first
+ SDE-I/II/III-fallback experience inference). Does NOT touch rows already
upgraded to enrichment_source='gemini' - those are left alone. No Gemini
calls, no dedup re-run (dedup only matters at ingest time) - purely
recomputes role_category/experience_level/min_years_experience/domain_tags/
summary_bullets from the existing stored title/description/skills_hint.

Usage: python scripts/backfill_rule_enrich.py
"""
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

from app.database import get_supabase  # noqa: E402
from app.services.rule_enrich import rule_enrich  # noqa: E402

PAGE_SIZE = 500


def run():
    supabase = get_supabase()
    updated = 0
    offset = 0

    while True:
        page = (
            supabase.table("jobs")
            .select("id, title, description, technical_skills, domain_tags")
            .eq("enrichment_source", "rules")
            .order("id")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        if not page.data:
            break

        for job in page.data:
            skills_hint = ", ".join(job.get("technical_skills") or [])
            domain_hint = (job.get("domain_tags") or [None])[0]
            enrichment = rule_enrich(
                job["title"], job.get("description") or "", skills_hint, domain_hint or ""
            )
            supabase.table("jobs").update(
                {
                    "role_category": enrichment["role_category"],
                    "experience_level": enrichment["experience_level"],
                    "min_years_experience": enrichment["min_years_experience"],
                    "domain_tags": enrichment["domain_tags"],
                    "summary_bullets": enrichment["summary_bullets"],
                }
            ).eq("id", job["id"]).execute()
            updated += 1

        print(f"Progress: updated={updated}", flush=True)

        if len(page.data) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    print(f"Backfill complete. Updated={updated}")


if __name__ == "__main__":
    run()
