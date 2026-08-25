import asyncio
import time
from collections import Counter, defaultdict
from typing import List

from fastapi import APIRouter, Body, HTTPException, Query

from app.database import get_supabase

router = APIRouter(prefix="/api", tags=["stats"])

_CACHE_TTL_SECONDS = 300
_cache = {"data": None, "expires_at": 0}

PAGE_SIZE = 1000
MIN_JOBS_FOR_COMPANY_SALARY_STAT = 2

# Every column any of the three endpoints below needs, fetched together in
# ONE full-table scan behind one shared cache - the endpoints used to each
# run their own independent 45k-row paginated fetch (confirmed ~11-19s cold,
# per endpoint, since all three could miss the cache at once after a
# restart/expiry). Sharing one fetch means a cold hit on any one endpoint
# warms all three, and a user landing on /market (which calls both trends
# and salary) only pays the full-scan cost once, not twice.
_SHARED_COLUMNS = (
    "company, sources, role_category, salary_min_lpa, salary_max_lpa, "
    "experience_level, domain_tags, technical_skills, enrichment_source"
)


def _fetch_all_rows(supabase, columns: str):
    rows = []
    offset = 0
    while True:
        page = (
            supabase.table("jobs")
            .select(columns)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        if not page.data:
            break
        rows.extend(page.data)
        if len(page.data) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def _refresh_cache():
    supabase = get_supabase()
    _cache["data"] = _fetch_all_rows(supabase, _SHARED_COLUMNS)
    _cache["expires_at"] = time.time() + _CACHE_TTL_SECONDS


def _get_cached_rows():
    now = time.time()
    if _cache["data"] is None or now >= _cache["expires_at"]:
        _refresh_cache()
    return _cache["data"]


# Background warm-up: refresh the cache proactively before it expires so no
# real request ever blocks on the ~35s cold full-table-scan (confirmed live -
# see the shared-cache comment above). Runs the blocking supabase-py fetch in
# a thread so it never stalls the event loop for concurrent requests.
_WARM_UP_MARGIN_SECONDS = 60


async def warm_stats_cache_periodically():
    loop = asyncio.get_event_loop()
    while True:
        try:
            await loop.run_in_executor(None, _refresh_cache)
        except Exception:
            # Best-effort warm-up - a transient failure here just means the
            # next real request falls back to the normal cold-fetch path,
            # not a crash of the background task.
            pass
        await asyncio.sleep(max(1, _CACHE_TTL_SECONDS - _WARM_UP_MARGIN_SECONDS))


@router.get("/stats")
def get_stats():
    rows = _get_cached_rows()
    total_jobs = len(rows)
    companies = {r["company"] for r in rows if r.get("company")}

    source_counts = Counter()
    duplicates_merged = 0
    for r in rows:
        sources = r.get("sources") or []
        for s in sources:
            source_counts[s] += 1
        if len(sources) > 1:
            duplicates_merged += len(sources) - 1

    category_counts = Counter(r["role_category"] for r in rows if r.get("role_category"))
    top_categories = [
        {"category": cat, "count": count}
        for cat, count in category_counts.most_common(6)
    ]

    result = {
        "unique_jobs": total_jobs,
        "companies_hiring": len(companies),
        "duplicates_merged": duplicates_merged,
        "sources_aggregated": len(source_counts),
        "source_breakdown": dict(source_counts),
        "top_categories": top_categories,
    }
    return result


def _median(values):
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2
    return ordered[mid]


def _compute_salary_stats(rows):
    by_company = defaultdict(list)
    by_experience_level = defaultdict(list)
    all_mins, all_maxs = [], []
    jobs_with_salary_data = 0

    for r in rows:
        lo, hi = r.get("salary_min_lpa"), r.get("salary_max_lpa")
        if lo is None and hi is None:
            continue
        jobs_with_salary_data += 1
        company = r.get("company") or "Unknown"
        level = r.get("experience_level") or "Unspecified"
        values_for_row = []
        if lo is not None:
            all_mins.append(lo)
            by_company[company].append(lo)
            values_for_row.append(lo)
        if hi is not None:
            all_maxs.append(hi)
            by_company[company].append(hi)
            values_for_row.append(hi)
        by_experience_level[level].extend(values_for_row)

    global_stats = {
        "highest_lpa": round(max(all_maxs), 2) if all_maxs else None,
        "lowest_lpa": round(min(all_mins), 2) if all_mins else None,
        "average_lpa": round(sum(all_mins + all_maxs) / len(all_mins + all_maxs), 2)
        if (all_mins or all_maxs)
        else None,
        "jobs_with_salary_data": jobs_with_salary_data,
    }

    company_stats = []
    for company, values in by_company.items():
        if len(values) < MIN_JOBS_FOR_COMPANY_SALARY_STAT:
            continue
        company_stats.append(
            {
                "company": company,
                "min_lpa": round(min(values), 2),
                "max_lpa": round(max(values), 2),
                "average_lpa": round(sum(values) / len(values), 2),
                "sample_size": len(values),
            }
        )

    experience_bands = {}
    for level, values in by_experience_level.items():
        if len(values) < MIN_JOBS_FOR_COMPANY_SALARY_STAT:
            continue
        median = _median(values)
        experience_bands[level] = {
            "median_lpa": round(median, 2) if median is not None else None,
            "min_lpa": round(min(values), 2),
            "max_lpa": round(max(values), 2),
            "sample_size": len(values),
        }

    return {"global": global_stats, "by_company": company_stats, "by_experience_level": experience_bands}


@router.get("/stats/salary")
def get_salary_stats(
    company: str = Query(default="", description="Filter to a single company (case-insensitive substring match)"),
    category: str = Query(default="", description="Scope the experience-level bands to one role_category"),
):
    raw_rows = _get_cached_rows()
    scoped_rows = (
        [r for r in raw_rows if r.get("role_category") == category] if category else raw_rows
    )
    data = _compute_salary_stats(scoped_rows)

    if not company:
        reliable = [c for c in data["by_company"] if c["sample_size"] >= 4]
        top_companies = sorted(reliable, key=lambda c: c["average_lpa"], reverse=True)[:20]
        return {
            "global": data["global"],
            "top_companies": top_companies,
            "by_experience_level": data["by_experience_level"],
        }

    matches = [c for c in data["by_company"] if company.lower() in c["company"].lower()]
    if not matches:
        raise HTTPException(404, f"No salary data found for companies matching '{company}'")
    return {"global": data["global"], "companies": matches, "by_experience_level": data["by_experience_level"]}


_NON_SKILL_VALUES = {
    "not mentioned", "not specified", "n/a", "na", "none", "not applicable",
    "unspecified", "not available", "tbd", "-",
}


def _compute_trends(rows):
    total_jobs = len(rows)
    category_counts = Counter(r["role_category"] for r in rows if r.get("role_category"))
    domain_counts = Counter()
    skill_counts = Counter()
    experience_counts = Counter(r["experience_level"] for r in rows if r.get("experience_level"))

    for r in rows:
        for tag in r.get("domain_tags") or []:
            domain_counts[tag] += 1
        for skill in r.get("technical_skills") or []:
            if skill.strip().lower() in _NON_SKILL_VALUES:
                continue
            skill_counts[skill] += 1

    def _pct(count):
        return round((count / total_jobs) * 100, 1) if total_jobs else 0

    return {
        "total_jobs": total_jobs,
        "categories": [{"name": k, "count": v, "pct": _pct(v)} for k, v in category_counts.most_common(15)],
        "domains": [{"name": k, "count": v, "pct": _pct(v)} for k, v in domain_counts.most_common(12)],
        "top_skills": [{"name": k, "count": v, "pct": _pct(v)} for k, v in skill_counts.most_common(20)],
        "experience_levels": [
            {"name": k, "count": v, "pct": _pct(v)} for k, v in experience_counts.most_common()
        ],
    }


@router.get("/stats/trends")
def get_trends(category: str = Query(default="", description="Scope trends to one role_category, e.g. 'Data Science'")):
    rows = _get_cached_rows()
    if category:
        rows = [r for r in rows if r.get("role_category") == category]
    return _compute_trends(rows)


MIN_SKILL_ROI_SAMPLE = 5


def _compute_skill_roi(rows, resume_skills_norm: set, candidate_skills: list):
    """For each candidate missing skill, count how many additional jobs in
    `rows` list that skill - i.e. how many more roles the user would newly
    qualify for (on skill grounds) if they had it. Pure aggregation, no
    Gemini call, so it is near-zero marginal cost on top of a resume upload
    that already ran.

    Restricted to rows the caller has already filtered to Gemini-enriched
    (enrichment_source == "gemini") before calling this, since rule-based
    tagging is sparse and inconsistent (91% of the corpus, often empty or
    hint-derived) - counting jobs from that slice would systematically
    overstate a skill's value for tags that happen to be well-represented in
    rule-based data, not because the skill is actually more in-demand. The
    caller is responsible for that filtering; this function only aggregates."""
    from app.services.skills import normalize_skill

    counts = Counter()
    for r in rows:
        job_skills_norm = {normalize_skill(s) for s in (r.get("technical_skills") or [])}
        for skill in candidate_skills:
            if normalize_skill(skill) in job_skills_norm:
                counts[skill] += 1

    ranked = [
        {"skill": skill, "roles_unlocked": count}
        for skill, count in counts.most_common()
        if count >= MIN_SKILL_ROI_SAMPLE
    ]
    return ranked


@router.post("/stats/skill-roi")
def get_skill_roi(missing_skills: List[str] = Body(..., embed=True)):
    """Rank a candidate's missing skills by how many additional jobs each
    would newly unlock, so "learn Docker, opens 340 more roles" replaces an
    unranked badge list. Counts are a lower bound: only Gemini-enriched rows
    (the ~9% of the corpus with trustworthy skill tags) are counted, so the
    real number of roles asking for a given skill is likely higher."""
    if not missing_skills:
        return {"ranked": []}

    rows = _get_cached_rows()
    gemini_rows = [r for r in rows if r.get("enrichment_source") == "gemini"]
    ranked = _compute_skill_roi(gemini_rows, set(), missing_skills)
    return {"ranked": ranked, "sample_note": "Counted against Gemini-enriched jobs only; treat as a lower bound."}
