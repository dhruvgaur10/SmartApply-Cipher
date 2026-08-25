"""One-off cleanup: remove 'Not mentioned' and other placeholder strings from
technical_skills arrays that were stored before the extract_skills_from_hint()
filter fix (app/services/rule_enrich.py). Only strips the placeholder values in
place - does not otherwise re-enrich the row.

Usage: python scripts/cleanup_skill_placeholders.py
"""
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

from app.database import get_supabase  # noqa: E402
from app.services.rule_enrich import _NON_SKILL_VALUES  # noqa: E402

PAGE_SIZE = 500


def run():
    supabase = get_supabase()
    updated = 0
    offset = 0

    while True:
        page = (
            supabase.table("jobs")
            .select("id, technical_skills")
            .contains("technical_skills", ["Not mentioned"])
            .order("id")
            .range(0, PAGE_SIZE - 1)
            .execute()
        )
        if not page.data:
            break

        for job in page.data:
            cleaned = [
                s for s in (job.get("technical_skills") or [])
                if s.strip().lower() not in _NON_SKILL_VALUES
            ]
            supabase.table("jobs").update({"technical_skills": cleaned}).eq("id", job["id"]).execute()
            updated += 1

        print(f"Progress: updated={updated}", flush=True)

        if len(page.data) < PAGE_SIZE:
            break

    print(f"Cleanup complete. Updated={updated}")


if __name__ == "__main__":
    run()
