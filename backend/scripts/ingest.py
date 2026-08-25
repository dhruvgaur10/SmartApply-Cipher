"""Stream the FULL raw_jobs.json (~57k records), dedupe correctly, tag every
job with rule-based enrichment immediately, and load into Supabase + Qdrant.

Usage: python scripts/ingest.py
Requires backend/.env with SUPABASE_URL, SUPABASE_SERVICE_KEY, QDRANT_URL,
QDRANT_API_KEY.

Scope: the ENTIRE dataset is ingested (no sampling/cap) - every unique job
after correct dedup is stored. AI/LLM enrichment (required by the assignment's
"AI-Based Job Classification" requirement) is applied progressively in a
separate script (scripts/enrich_gemini.py) that upgrades rows in place without
blocking full-corpus availability - this script alone already gives every job
real structured tags via rule-based enrichment (see app/services/rule_enrich.py),
not a placeholder.

Dedup design (see app/services/deduplication.py and app/services/location.py):
- L1 exact: sha256(company|title|normalized_location). City aliases (Bombay/
  Mumbai, Bangalore/Bengaluru, etc) collapse to one canonical spelling before
  hashing, so the same real opening isn't treated as two locations. Different
  real cities for the same company+title remain distinct rows (they are
  genuinely different openings), and the same role reposted later remains
  possible to distinguish because normalization never touches posted_date.
- L2 semantic: cosine >= 0.88 (local hashed bag-of-words embedding, see
  app/services/local_embed.py - avoids ~57k Gemini embedding calls) AND same
  company AND same normalized location AND posted dates within 30 days of each
  other. This prevents two genuinely different req windows (e.g. a Jan and a
  May opening for the same role) from being wrongly merged just because their
  boilerplate descriptions are similar.
- Dedup scope is per-company (in-memory candidate index keyed by
  (company, normalized_location)) to keep the L2 scan fast across 57k records
  without a network round-trip to Qdrant per job.
"""
import json
import os
import sys
import uuid
from collections import defaultdict

import ijson
from dateutil import parser as dateparser
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

from qdrant_client.models import PointStruct  # noqa: E402

from app.database import get_supabase, get_qdrant, QDRANT_COLLECTION  # noqa: E402
from app.services.deduplication import compute_hash, is_semantic_duplicate, normalize_company, SEMANTIC_DEDUP_THRESHOLD  # noqa: E402
from app.services.location import normalize_location  # noqa: E402
from app.services.local_embed import local_embed, cosine, job_embed_text  # noqa: E402
from app.services.rule_enrich import rule_enrich  # noqa: E402
from app.services.salary import parse_salary_range  # noqa: E402

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "raw_jobs.json")
KNOWN_SOURCES = {"linkedin": "LinkedIn", "naukri": "Naukri", "indeed": "Indeed", "internshala": "Internshala"}
SUPABASE_BATCH_SIZE = 200


def extract_source(job: dict) -> str:
    via = (job.get("via") or "").lower()
    for key, label in KNOWN_SOURCES.items():
        if key in via:
            return label
    apply_options = (job.get("apply_options") or "").lower()
    for key, label in KNOWN_SOURCES.items():
        if key in apply_options:
            return label
    return "Other"


def parse_apply_url(apply_options_str):
    # The raw dataset's apply_options field is inconsistently encoded across
    # records - roughly half are double-JSON-encoded (a string containing a
    # JSON-encoded string containing the array) and half are single-encoded
    # (a string containing the array directly). The original implementation
    # assumed double-encoding unconditionally, silently dropping apply_url
    # for every single-encoded record (~half the corpus, confirmed via a
    # live sample: single-encoded and double-encoded records each made up
    # roughly half of a 3000-row sample). Try single-encoding first (one
    # json.loads), and only apply a second json.loads if the first result is
    # itself still a string (the double-encoded case).
    try:
        decoded = json.loads(apply_options_str)
        if isinstance(decoded, str):
            decoded = json.loads(decoded)
        return decoded[0]["link"] if decoded else None
    except Exception:
        return None


def normalize_date(date_str):
    if not date_str:
        return None
    try:
        return dateparser.parse(date_str).date().isoformat()
    except Exception:
        return None


def safe_int(val):
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def normalize_job(raw: dict) -> dict:
    title = (raw.get("title") or "").strip()
    if not title:
        desc = raw.get("description", "")
        title = desc.split("\n")[0].replace("Job Title:", "").strip()
    location = (raw.get("location") or "Not specified").strip()
    min_lpa, max_lpa = parse_salary_range(raw.get("salaries"))
    return {
        "title": title or "Untitled Role",
        "company": (raw.get("company_name") or "Unknown").strip(),
        "location": location,
        "norm_location": normalize_location(location),
        "description": (raw.get("description") or "").strip(),
        "posted_date": normalize_date(raw.get("posted_at") or raw.get("publishedAt") or raw.get("createdAt")),
        "apply_url": parse_apply_url(raw.get("apply_options", '""')),
        "source": extract_source(raw),
        "skills_hint": raw.get("skills") or "",
        "domain_hint": raw.get("domain") or "",
        "min_exp_hint": safe_int(raw.get("minExperienceRequired")),
        "salary_min_lpa": min_lpa,
        "salary_max_lpa": max_lpa,
    }


def raw_job_stream():
    with open(DATA_PATH, "rb") as f:
        for raw in ijson.items(f, "item"):
            job = normalize_job(raw)
            if not job["description"] or not job["company"]:
                continue
            yield job


def run():
    supabase = get_supabase()
    qdrant = get_qdrant()

    # in-memory index scoped by (company, normalized_location) so L2 comparison
    # never has to scan the full corpus - only real candidates for the same
    # employer in the same city.
    candidate_index = defaultdict(list)  # key -> list of {id, vector, posted_date, title}
    seen_hashes = {}  # content_hash -> job_id

    total_raw = 0
    inserted = 0
    exact_dupes = 0
    semantic_merges = 0
    supabase_batch = []
    qdrant_batch = []

    def flush_supabase():
        nonlocal supabase_batch, qdrant_batch
        if supabase_batch:
            supabase.table("jobs").insert(supabase_batch).execute()
            supabase_batch = []
        if qdrant_batch:
            qdrant.upsert(collection_name=QDRANT_COLLECTION, points=qdrant_batch)
            qdrant_batch = []

    for job in raw_job_stream():
        total_raw += 1

        content_hash = compute_hash(job["company"], job["title"], job["location"])
        if content_hash in seen_hashes:
            exact_dupes += 1
            continue

        embed_text = job_embed_text(job["title"], job["description"])
        vector = local_embed(embed_text)

        key = (normalize_company(job["company"]), job["norm_location"])
        merged = False
        for candidate in candidate_index[key]:
            if cosine(vector, candidate["vector"]) < SEMANTIC_DEDUP_THRESHOLD:
                continue
            existing_job = {
                "company": job["company"],
                "location": candidate["location"],
                "posted_date": candidate["posted_date"],
                "sources": candidate["sources"],
            }
            if is_semantic_duplicate(existing_job, job, job["source"]):
                if job["source"] not in candidate["sources"]:
                    candidate["sources"].append(job["source"])
                    supabase.table("jobs").update({"sources": candidate["sources"]}).eq(
                        "id", candidate["id"]
                    ).execute()
                semantic_merges += 1
                merged = True
                break
        if merged:
            continue

        enrichment = rule_enrich(
            job["title"], job["description"], job["skills_hint"], job["domain_hint"], job["min_exp_hint"]
        )

        job_id = str(uuid.uuid4())
        row = {
            "id": job_id,
            "title": job["title"],
            "company": job["company"],
            "location": job["location"],
            "description": job["description"],
            "posted_date": job["posted_date"],
            "apply_url": job["apply_url"],
            "sources": [job["source"]],
            "technical_skills": enrichment["technical_skills"],
            "role_category": enrichment["role_category"],
            "experience_level": enrichment["experience_level"],
            "min_years_experience": enrichment["min_years_experience"],
            "soft_skills": enrichment["soft_skills"],
            "domain_tags": enrichment["domain_tags"],
            "summary_bullets": enrichment["summary_bullets"],
            "content_hash": content_hash,
            "salary_min_lpa": job["salary_min_lpa"],
            "salary_max_lpa": job["salary_max_lpa"],
            "enrichment_source": "rules",
        }
        supabase_batch.append(row)
        qdrant_batch.append(
            PointStruct(
                id=job_id,
                vector=vector,
                payload={
                    "job_id": job_id,
                    "title": job["title"],
                    "company": job["company"],
                    "description_preview": job["description"][:500],
                },
            )
        )

        seen_hashes[content_hash] = job_id
        candidate_index[key].append(
            {
                "id": job_id,
                "vector": vector,
                "location": job["location"],
                "posted_date": job["posted_date"],
                "sources": [job["source"]],
            }
        )
        inserted += 1

        if len(supabase_batch) >= SUPABASE_BATCH_SIZE:
            flush_supabase()
            print(
                f"Progress: raw={total_raw} inserted={inserted} exact_dupes={exact_dupes} "
                f"semantic_merges={semantic_merges}",
                flush=True,
            )

    flush_supabase()
    print("Ingestion complete (full corpus, rule-based tags).")
    print(f"Raw={total_raw} Inserted={inserted} ExactDupes={exact_dupes} SemanticMerges={semantic_merges}")


if __name__ == "__main__":
    run()
