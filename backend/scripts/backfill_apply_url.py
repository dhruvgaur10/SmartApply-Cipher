"""One-off backfill: fixes rows where apply_url is NULL but the raw source
data actually contains a real apply link.

Root cause: raw_jobs.json's apply_options field is inconsistently encoded
across records - roughly half are double-JSON-encoded (a string containing a
JSON-encoded string containing the array) and half are single-encoded (a
string containing the array directly). ingest.py's original parse_apply_url()
assumed double-encoding unconditionally, silently returning None for every
single-encoded record (~half the corpus, confirmed via a live sample: 1401
single-encoded vs 1485 double-encoded in a 3000-row sample). The parser is
now fixed in ingest.py to detect and handle both encodings, but the fix
doesn't retroactively touch the 45,698 already-ingested rows - this script
re-streams the raw file, recomputes each row's apply_url with the fixed
parser, and updates only rows currently missing one.

Correlation: raw_jobs.json has no stable id matching Supabase's row id
(a fresh uuid4 assigned at ingest time), so rows are matched by content_hash
(sha256(company|title|normalized_location)) - the same deterministic key
ingest.py already uses for L1 dedup. This is safe: content_hash is UNIQUE in
the jobs table, so at most one row can match per raw record.

IMPORTANT CAVEAT (discovered on first live run): content_hash is only a
STABLE match key if normalize_location()'s alias map hasn't changed since
the row was originally ingested. This session added Noida/Greater Noida ->
Delhi aliases to app/services/location.py AFTER the corpus was ingested, so
recomputing content_hash for those rows today produces a DIFFERENT hash than
what's stored (confirmed live: a real, unambiguously-identical row's stored
hash did not match a freshly recomputed one for the same company/title/
location). A secondary fallback match key - raw (lowercased, whitespace-
collapsed, UNNORMALIZED) company|title|location, matched against the
company+title+raw-location already stored per row - catches exactly this
class of drift without needing to know which normalization rule changed.

Usage: python scripts/backfill_apply_url.py
"""
import json
import os
import sys

import ijson
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

from app.database import get_supabase  # noqa: E402
from app.services.deduplication import compute_hash  # noqa: E402

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "raw_jobs.json")
UPDATE_BATCH_SIZE = 200


def parse_apply_url(apply_options_str):
    try:
        decoded = json.loads(apply_options_str)
        if isinstance(decoded, str):
            decoded = json.loads(decoded)
        return decoded[0]["link"] if decoded else None
    except Exception:
        return None


def raw_key(company, title, location):
    parts = f"{company}|{title}|{location}".lower().strip()
    return " ".join(parts.split())


def run():
    supabase = get_supabase()

    print("Loading rows currently missing apply_url...", flush=True)
    missing_hashes = {}
    missing_raw_keys = {}
    offset = 0
    page_size = 1000
    while True:
        page = (
            supabase.table("jobs")
            .select("id,content_hash,company,title,location")
            .is_("apply_url", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not page.data:
            break
        for row in page.data:
            missing_hashes[row["content_hash"]] = row["id"]
            missing_raw_keys[raw_key(row["company"], row["title"], row["location"] or "")] = row["id"]
        if len(page.data) < page_size:
            break
        offset += page_size

    print(f"Rows missing apply_url: {len(missing_hashes)}", flush=True)
    if not missing_hashes:
        print("Nothing to backfill.")
        return

    updates = []
    scanned = 0
    matched = 0

    def flush_updates():
        nonlocal updates
        for row_id, apply_url in updates:
            supabase.table("jobs").update({"apply_url": apply_url}).eq("id", row_id).execute()
        updates = []

    with open(DATA_PATH, "rb") as f:
        for raw in ijson.items(f, "item"):
            scanned += 1
            if scanned % 50000 == 0:
                print(f"Scanned {scanned} raw records, matched {matched} so far...", flush=True)

            title = (raw.get("title") or "").strip()
            if not title:
                desc = raw.get("description", "")
                title = desc.split("\n")[0].replace("Job Title:", "").strip()
            title = title or "Untitled Role"
            company = (raw.get("company_name") or "Unknown").strip()
            location = (raw.get("location") or "Not specified").strip()

            content_hash = compute_hash(company, title, location)
            row_id = missing_hashes.get(content_hash)
            rkey = raw_key(company, title, location)
            if not row_id:
                row_id = missing_raw_keys.get(rkey)
            if not row_id:
                continue

            apply_url = parse_apply_url(raw.get("apply_options", '""'))
            if not apply_url:
                continue

            updates.append((row_id, apply_url))
            matched += 1
            missing_hashes.pop(content_hash, None)
            missing_raw_keys.pop(rkey, None)

            if len(updates) >= UPDATE_BATCH_SIZE:
                flush_updates()
                print(f"Progress: matched={matched}, remaining_missing={len(missing_hashes)}", flush=True)

            if not missing_hashes and not missing_raw_keys:
                break

    flush_updates()
    print(f"Backfill complete. Scanned={scanned}, matched_and_updated={matched}")


if __name__ == "__main__":
    run()
