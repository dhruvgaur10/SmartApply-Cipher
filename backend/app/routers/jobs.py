import time
from typing import Optional

from fastapi import APIRouter

from app.database import get_supabase
from app.models import JobSearchResponse, JobListItem, JOB_LIST_COLUMNS, Job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

_META_CACHE_TTL_SECONDS = 300
_meta_cache = {}


def _fetch_all_column(supabase, column: str, page_size: int = 1000):
    values = []
    offset = 0
    while True:
        page = supabase.table("jobs").select(column).range(offset, offset + page_size - 1).execute()
        if not page.data:
            break
        values.extend(page.data)
        if len(page.data) < page_size:
            break
        offset += page_size
    return values


@router.get("/search", response_model=JobSearchResponse)
def search_jobs(
    q: str = "",
    platform: Optional[str] = None,
    min_years: Optional[int] = None,
    max_years: Optional[int] = None,
    category: Optional[str] = None,
    location: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
):
    supabase = get_supabase()

    if q:
        # Full-text search via a Postgres RPC (GIN-indexed tsvector) - an
        # unindexed ILIKE '%term%' scan over the description column times
        # out past a few thousand rows (confirmed at 45k+ rows: 8s+ and a
        # Postgres statement-timeout error). See scripts/setup_db.py for
        # the search_jobs_fts() function and index definition.
        #
        # No exact total: ranking + counting every match (e.g. 12,000+ for a
        # common term) before returning page 1 was itself the slow part, even
        # with the index. Fetch limit+1 instead; if that extra row comes
        # back, more results exist. total is omitted for text search - the
        # frontend uses has_more to drive "Load more" instead of a count.
        result = supabase.rpc(
            "search_jobs_fts",
            {
                "search_query": q,
                "platform_filter": platform if platform and platform != "all" else None,
                "min_years_filter": min_years,
                "max_years_filter": max_years,
                "category_filter": category if category and category != "all" else None,
                "location_filter": location if location and location != "all" else None,
                "result_limit": limit + 1,
                "result_offset": offset,
            },
        ).execute()
        rows = result.data
        has_more = len(rows) > limit
        # RPC returns full rows including description; drop it here rather
        # than changing the RPC's RETURNS TABLE signature (would need a live
        # SQL re-apply) - list views never render description anyway.
        jobs = [JobListItem(**row) for row in rows[:limit]]
        return JobSearchResponse(jobs=jobs, has_more=has_more)

    query = supabase.table("jobs").select(JOB_LIST_COLUMNS, count="exact")
    if platform and platform != "all":
        query = query.contains("sources", [platform])
    if min_years is not None:
        query = query.gte("min_years_experience", min_years)
    if max_years is not None:
        query = query.lte("min_years_experience", max_years)
    if category and category != "all":
        query = query.eq("role_category", category)
    if location and location != "all":
        query = query.ilike("location", f"%{location}%")

    # Secondary sort by id: posted_date alone has many ties (including NULLs),
    # and Postgres doesn't guarantee stable ordering across separate paginated
    # queries for tied rows - without a deterministic tiebreaker, consecutive
    # offset-based pages can return overlapping or skipped rows.
    result = (
        query.order("posted_date", desc=True)
        .order("id")
        .range(offset, offset + limit - 1)
        .execute()
    )
    jobs = [JobListItem(**row) for row in result.data]
    total = result.count or len(jobs)
    return JobSearchResponse(jobs=jobs, total=total, has_more=offset + len(jobs) < total)


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str):
    supabase = get_supabase()
    result = supabase.table("jobs").select("*").eq("id", job_id).execute()
    if not result.data:
        from fastapi import HTTPException
        raise HTTPException(404, "Job not found")
    return Job(**result.data[0])


def _cached_meta(key: str, compute_fn):
    now = time.time()
    cached = _meta_cache.get(key)
    if cached and now < cached["expires_at"]:
        return cached["value"]
    value = compute_fn()
    _meta_cache[key] = {"value": value, "expires_at": now + _META_CACHE_TTL_SECONDS}
    return value


@router.get("/meta/sources")
def get_sources():
    def compute():
        supabase = get_supabase()
        rows = _fetch_all_column(supabase, "sources")
        sources = set()
        for row in rows:
            sources.update(row.get("sources", []))
        return {"sources": sorted(sources)}

    return _cached_meta("sources", compute)


@router.get("/meta/categories")
def get_categories():
    def compute():
        supabase = get_supabase()
        rows = _fetch_all_column(supabase, "role_category")
        categories = {row["role_category"] for row in rows if row.get("role_category")}
        return {"categories": sorted(categories)}

    return _cached_meta("categories", compute)
