"""Create Supabase jobs table and Qdrant job_embeddings collection.

Run once before ingest.py. Requires SUPABASE_URL, SUPABASE_SERVICE_KEY,
QDRANT_URL, QDRANT_API_KEY in backend/.env.
"""
import os
import sys

from dotenv import load_dotenv
from qdrant_client.models import Distance, VectorParams

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
load_dotenv()

from app.database import get_qdrant, QDRANT_COLLECTION, EMBEDDING_DIM  # noqa: E402

JOBS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    description TEXT,
    posted_date DATE,
    apply_url TEXT,
    sources TEXT[] NOT NULL DEFAULT '{}',
    technical_skills TEXT[] DEFAULT '{}',
    role_category TEXT,
    experience_level TEXT,
    min_years_experience INTEGER,
    soft_skills TEXT[] DEFAULT '{}',
    domain_tags TEXT[] DEFAULT '{}',
    summary_bullets TEXT[] DEFAULT '{}',
    content_hash CHAR(64) UNIQUE NOT NULL,
    salary_min_lpa NUMERIC,
    salary_max_lpa NUMERIC,
    enrichment_source TEXT DEFAULT 'rules',
    created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min_lpa NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max_lpa NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS enrichment_source TEXT DEFAULT 'rules';

-- Full-text search (Option A - title + technical_skills only, NOT
-- description): an unindexed ILIKE '%term%' on description forces a
-- sequential scan across all rows' full description text and times out at
-- 45k+ rows. A title+description GIN-indexed tsvector was ALSO tried and
-- still timed out - the GIN index itself resolved in ~9ms, but the
-- subsequent Bitmap Heap Scan fetching each matching row's full (1-3KB)
-- description text from disk took 9.8-12.6s on Supabase free-tier disk I/O
-- for common terms (e.g. "python", 12,608 matches) - a raw throughput
-- ceiling, not an indexing or query-shape problem (see build.md). Title
-- text is short (~50-100 bytes), so far fewer AND much smaller heap pages
-- are touched per match. technical_skills is a small GIN-indexed array
-- column searched separately as a second fast path, so skill-keyword
-- queries stay accurate without ever touching description. Tradeoff:
-- misses jobs where the term appears ONLY in the description body, not the
-- title or skills list - accepted as most meaningful search terms (a
-- skill, a role name) do appear in one of those two places.
ALTER TABLE jobs DROP COLUMN IF EXISTS search_vector;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_title_search_vector ON jobs USING GIN(title_search_vector);
DROP INDEX IF EXISTS idx_search_vector;

CREATE INDEX IF NOT EXISTS idx_company_title ON jobs(company, title);
CREATE INDEX IF NOT EXISTS idx_skills ON jobs USING GIN(technical_skills);
CREATE INDEX IF NOT EXISTS idx_category ON jobs(role_category);
CREATE INDEX IF NOT EXISTS idx_experience ON jobs(experience_level);
CREATE INDEX IF NOT EXISTS idx_min_years_experience ON jobs(min_years_experience);
CREATE INDEX IF NOT EXISTS idx_hash ON jobs(content_hash);
CREATE INDEX IF NOT EXISTS idx_posted_date ON jobs(posted_date DESC NULLS LAST);

-- RPC wrapper: supabase-py's query builder has no native tsvector @@ query
-- operator, so full-text search is exposed as a Postgres function callable
-- via supabase.rpc(). Matches on title_search_vector OR a case-insensitive
-- technical_skills array match (both narrow, GIN-indexed, disk-cheap
-- columns) - see Option A rationale on title_search_vector above. Ranks
-- title matches by ts_rank; skill-only matches sort after title matches.
--
-- Still a TWO-STAGE query (rank/filter on id + posted_date in a CTE, join
-- back for full rows only for the ~20 winning ids) even though title rows
-- are individually cheap - this keeps the wide-row fetch bounded at
-- result_limit regardless of how many rows match, consistent with the
-- fetch-limit+1 has_more pattern used everywhere else.
--
-- NO exact total count: total is omitted for text search - the API uses
-- has_more (fetches limit+1) to drive "Load more" instead.
--
-- location_filter added for the heuristic conversational search feature
-- ("jobs in chandigarh") - a changed parameter list makes this a DISTINCT
-- overload in Postgres, so the DROP below runs first to remove the OLD
-- 7-arg signature before CREATE OR REPLACE, or both overloads would coexist
-- and supabase-py's RPC call would become ambiguous. See build.md's
-- documented lesson on this exact pattern from the min_years/max_years
-- migration.
DROP FUNCTION IF EXISTS search_jobs_fts(TEXT, TEXT, INT, INT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION search_jobs_fts(
    search_query TEXT,
    platform_filter TEXT DEFAULT NULL,
    min_years_filter INT DEFAULT NULL,
    max_years_filter INT DEFAULT NULL,
    category_filter TEXT DEFAULT NULL,
    location_filter TEXT DEFAULT NULL,
    result_limit INT DEFAULT 20,
    result_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID, title TEXT, company TEXT, location TEXT, description TEXT,
    posted_date DATE, apply_url TEXT, sources TEXT[], technical_skills TEXT[],
    role_category TEXT, experience_level TEXT, min_years_experience INTEGER,
    soft_skills TEXT[], domain_tags TEXT[], summary_bullets TEXT[],
    salary_min_lpa NUMERIC, salary_max_lpa NUMERIC, enrichment_source TEXT
) AS $$
DECLARE
    tsq tsquery := plainto_tsquery('english', search_query);
    -- Escape ILIKE metacharacters in user input so a literal '%' or '_' in a
    -- search term isn't interpreted as a wildcard/single-char match.
    like_term TEXT := '%' || replace(replace(search_query, '%', '\%'), '_', '\_') || '%';
BEGIN
    RETURN QUERY
    WITH ranked AS (
        SELECT j.id,
               ts_rank(j.title_search_vector, tsq) AS title_rank,
               EXISTS (
                   SELECT 1 FROM unnest(j.technical_skills) s WHERE s ILIKE like_term
               ) AS skill_hit
        FROM jobs j
        WHERE (
                j.title_search_vector @@ tsq
                OR EXISTS (SELECT 1 FROM unnest(j.technical_skills) s WHERE s ILIKE like_term)
            )
            AND (platform_filter IS NULL OR j.sources @> ARRAY[platform_filter])
            AND (min_years_filter IS NULL OR j.min_years_experience >= min_years_filter)
            AND (max_years_filter IS NULL OR j.min_years_experience <= max_years_filter)
            AND (category_filter IS NULL OR j.role_category = category_filter)
            AND (location_filter IS NULL OR j.location ILIKE '%' || location_filter || '%')
        -- id as final tiebreaker: title_rank/skill_hit/posted_date all have
        -- heavy ties (most non-matching rows share title_rank=0), and without
        -- a deterministic tiebreaker, separate LIMIT/OFFSET calls can return
        -- overlapping or skipped rows across pages.
        ORDER BY title_rank DESC, skill_hit DESC, j.posted_date DESC NULLS LAST, j.id
        LIMIT result_limit OFFSET result_offset
    )
    SELECT j.id, j.title, j.company, j.location, j.description, j.posted_date,
           j.apply_url, j.sources, j.technical_skills, j.role_category,
           j.experience_level, j.min_years_experience, j.soft_skills,
           j.domain_tags, j.summary_bullets, j.salary_min_lpa, j.salary_max_lpa,
           j.enrichment_source
    FROM jobs j
    JOIN ranked r ON r.id = j.id
    ORDER BY r.title_rank DESC, r.skill_hit DESC, j.posted_date DESC NULLS LAST, j.id;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read" ON jobs;
CREATE POLICY "public_read" ON jobs FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS kv_cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE kv_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_cache" ON kv_cache;
CREATE POLICY "public_read_cache" ON kv_cache FOR SELECT USING (true);

-- Per-match relevance feedback ("is this job relevant to you?", not a
-- reported outcome). This is the actual missing ingredient for evaluating
-- match_score: an outcome-based signal (interviews/offers) is sparse, weeks
-- delayed and confounded by everything else in a job search, while a
-- thumbs up/down given right when a match is shown is immediate, cheap, and
-- gives real relevance labels. The full breakdown is stored WITH each
-- judgment (not just job_id) so this data stays usable later for exactly
-- what it is for: fitting a small global model (e.g. logistic regression on
-- skill_overlap/semantic_similarity/experience_alignment) once enough
-- labels exist, replacing the current hand-tuned 0.50/0.35/0.15 weights with
-- weights actually backed by evidence. anon_id is a browser-local id (no
-- auth required), so this works with the BYOK/no-login model as-is.
CREATE TABLE IF NOT EXISTS match_feedback (
    id BIGSERIAL PRIMARY KEY,
    anon_id TEXT NOT NULL,
    job_id UUID NOT NULL,
    relevant BOOLEAN NOT NULL,
    match_score FLOAT,
    skill_overlap FLOAT,
    semantic_similarity FLOAT,
    experience_alignment FLOAT,
    confidence TEXT,
    created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_feedback_job_id ON match_feedback(job_id);
CREATE INDEX IF NOT EXISTS idx_match_feedback_created_at ON match_feedback(created_at);

ALTER TABLE match_feedback ENABLE ROW LEVEL SECURITY;

-- Anonymous write, no read policy: feedback is written by anyone (no login),
-- but never read back to the browser - only aggregated server-side for the
-- future recalibration work. Mirrors kv_cache's public-read stance inverted:
-- here it's public-write, not public-read, since the data is one-directional
-- (users submit judgments, they don't need to see others').
DROP POLICY IF EXISTS "public_insert_feedback" ON match_feedback;
CREATE POLICY "public_insert_feedback" ON match_feedback FOR INSERT WITH CHECK (true);
"""


def setup_supabase():
    print("Supabase schema setup requires running SQL directly in the Supabase")
    print("SQL Editor (supabase-py has no DDL execution method). Copy this SQL:")
    print("-" * 70)
    print(JOBS_TABLE_SQL)
    print("-" * 70)


def setup_qdrant(reset: bool = False):
    client = get_qdrant()
    existing = [c.name for c in client.get_collections().collections]
    if QDRANT_COLLECTION in existing:
        if not reset:
            print(f"Qdrant collection '{QDRANT_COLLECTION}' already exists. Skipping (pass --reset to recreate).")
            return
        client.delete_collection(QDRANT_COLLECTION)
        print(f"Deleted existing Qdrant collection '{QDRANT_COLLECTION}'.")
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
    )
    print(f"Created Qdrant collection '{QDRANT_COLLECTION}' (dim={EMBEDDING_DIM}, cosine).")


def reset_supabase_jobs():
    from app.database import get_supabase
    supabase = get_supabase()
    supabase.table("jobs").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("Truncated Supabase 'jobs' table.")


if __name__ == "__main__":
    reset = "--reset" in sys.argv
    setup_supabase()
    setup_qdrant(reset=reset)
    if reset:
        reset_supabase_jobs()
