"""One-off backfill: fixes rows where experience_level='Fresher' but
min_years_experience is NULL (a rule_enrich() bug, now fixed, where the
no-signal-found fallback path returned "Fresher", None instead of
"Fresher", 0 - see app/services/rule_enrich.py's infer_experience()).
"Fresher" with no more specific number should always mean 0 years, not
an unset value - a None here silently excludes the row from every
year-range search bucket, including "0-2 years", despite being labeled
Fresher.

Scope: touches ONLY rows matching experience_level='Fresher' AND
min_years_experience IS NULL, regardless of enrichment_source (rule-based
rows hit the code bug directly; a handful of Gemini-enriched rows can also
land here since min_years_experience isn't a required field in that
schema). Does not call Gemini, does not touch any other field.

Usage: python scripts/backfill_fresher_years.py
"""
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

from app.database import get_supabase  # noqa: E402

PAGE_SIZE = 500


def run():
    supabase = get_supabase()
    updated = 0

    while True:
        page = (
            supabase.table("jobs")
            .select("id")
            .eq("experience_level", "Fresher")
            .is_("min_years_experience", "null")
            .order("id")
            .limit(PAGE_SIZE)
            .execute()
        )
        if not page.data:
            break

        ids = [row["id"] for row in page.data]
        supabase.table("jobs").update({"min_years_experience": 0}).in_("id", ids).execute()
        updated += len(ids)
        print(f"Progress: updated={updated}", flush=True)

        if len(page.data) < PAGE_SIZE:
            break

    print(f"Backfill complete. Updated={updated}")


if __name__ == "__main__":
    run()
