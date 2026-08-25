import re

from app.services.skills import normalize_skill

SKILL_WEIGHT = 0.50
SEMANTIC_WEIGHT = 0.35
EXPERIENCE_WEIGHT = 0.15

TOTAL_EXPERIENCE_PATTERN = re.compile(
    r"(\d+)\+?\s*years?\s*(?:of\s+)?(?:total\s+|overall\s+|professional\s+|relevant\s+|work\s+)?experience",
    re.IGNORECASE,
)
YEARS_PATTERN = re.compile(r"(\d+)\+?\s*years?", re.IGNORECASE)
# Per-skill year mentions like "Python (5 years)" or "Java - 3 years" must not
# be counted as total experience - only lines with no nearby skill-in-parens/
# dash context, or an explicit "years of experience" phrase, qualify.
SKILL_QUALIFIED_YEARS_PATTERN = re.compile(
    r"[\w+.#]+\s*[\(\-:]\s*\d+\+?\s*years?", re.IGNORECASE
)


# Approximate years-required midpoint per tier, used only as a fallback when
# a job has no numeric min_years_experience (older/rule-tagged rows) - the
# numeric field, when present, is always preferred since it's precise rather
# than a bucketed label.
_TIER_REQUIRED_YEARS = {"Fresher": 0, "Mid": 3, "Senior": 6}

# Below this many years short of what a role requires, alignment bottoms out
# at MIN_UNDERQUALIFIED_SCORE rather than continuing toward 0 - a 6+ year gap
# (e.g. fresher vs. Senior) is unambiguously a bad match, but we don't need a
# literal 0 to make that point once the gap is already this large.
MAX_PENALIZED_GAP_YEARS = 6
MIN_UNDERQUALIFIED_SCORE = 0.05

# When a job has NEITHER a numeric min_years_experience NOR a recognized
# experience_level string, we genuinely don't know what experience it wants -
# this is a distinct "no signal" case, not the same as a job that explicitly
# wants a Fresher (0 years required). Returning a full 1.0 here would be
# rewarding an absence of information as if it were a confirmed match;
# returning a neutral score instead means "unknown requirement" never looks
# like a stronger signal than a genuinely-verified match.
UNKNOWN_REQUIREMENT_SCORE = 0.65


def _extract_candidate_years(resume_text: str) -> int:
    total_matches = TOTAL_EXPERIENCE_PATTERN.findall(resume_text)
    if total_matches:
        return max(int(m) for m in total_matches)

    # Fall back to a bare years-mention scan, but exclude matches that are
    # actually skill-qualified ("Python (5 years)") since those describe
    # per-skill duration, not total years of experience.
    skill_qualified_spans = {m.span() for m in SKILL_QUALIFIED_YEARS_PATTERN.finditer(resume_text)}
    candidates = []
    for m in YEARS_PATTERN.finditer(resume_text):
        if any(start <= m.start() < end for start, end in skill_qualified_spans):
            continue
        candidates.append(int(m.group(1)))
    return max(candidates, default=0)


def calculate_experience_alignment(
    resume_text: str, job_experience_level, job_min_years_experience: int = None
):
    """Graduated alignment score based on the actual gap between the
    candidate's detected years and the job's required years - NOT a flat
    0.5 for every mismatch (the previous behavior scored a 0-year fresher
    applying to a Senior role identically to a merely-one-tier-off match,
    since every non-exact tier collapsed to the same neutral 0.5). Being
    under-qualified by a large margin now scores near 0; being
    over-qualified is never penalized, since a senior candidate choosing a
    junior role is a legitimate choice, not a bad match.

    Returns (score, requirement_is_known). The second value matters because
    38.6% of the corpus (17,649 of 45,698 rows) stores min_years_experience
    as 0, and 17,206 of those are labeled "Fresher" - but rule_enrich reaches
    that same ("Fresher", 0) result BOTH for a genuine entry-level posting AND
    as its documented last-resort default when a JD states no years anywhere
    (see rule_enrich.infer_experience). A plain 0 therefore cannot be trusted
    as "this role wants zero years": for any candidate, gap <= 0 holds and the
    score would be a confident 1.0 on what is often no evidence at all. We
    keep storing 0 rather than None (a None there previously dropped these
    rows out of every year-range filter, including "0-2 years"), and instead
    resolve the ambiguity here, at the scoring boundary, where it belongs."""
    max_years = _extract_candidate_years(resume_text)

    if job_min_years_experience is not None and job_min_years_experience > 0:
        required_years = job_min_years_experience
    elif job_min_years_experience == 0 and job_experience_level == "Fresher":
        # Ambiguous: either an explicit fresher role or rule_enrich's no-signal
        # default. Treat as unknown rather than assert a confident full match.
        return UNKNOWN_REQUIREMENT_SCORE, False
    elif job_experience_level in _TIER_REQUIRED_YEARS:
        required_years = _TIER_REQUIRED_YEARS[job_experience_level]
    else:
        # No numeric field and no recognized tier string - we don't actually
        # know what this job requires, so don't let that absence of
        # information masquerade as a confirmed 1.0 match.
        return UNKNOWN_REQUIREMENT_SCORE, False

    gap = required_years - max_years
    if gap <= 0:
        # At or above the required years - always a full or near-full match,
        # regardless of how much more experience the candidate has.
        return 1.0, True

    # Linearly interpolate down to MIN_UNDERQUALIFIED_SCORE as the shortfall
    # grows toward MAX_PENALIZED_GAP_YEARS, e.g. a 1-year-short candidate
    # still scores well (near-miss), while a 5+ year shortfall (fresher vs.
    # Senior) scores near the floor.
    penalty_fraction = min(gap, MAX_PENALIZED_GAP_YEARS) / MAX_PENALIZED_GAP_YEARS
    score = max(MIN_UNDERQUALIFIED_SCORE, 1.0 - penalty_fraction * (1.0 - MIN_UNDERQUALIFIED_SCORE))
    return score, True


def score_job(resume_text: str, resume_skills_norm: set, job: dict, semantic_sim: float) -> dict:
    job_skills_norm = {normalize_skill(s) for s in job.get("technical_skills", [])}
    intersection = resume_skills_norm & job_skills_norm
    # Precision against the JOB's tag list, not Jaccard against the union of
    # both sets. Jaccard's denominator grows with resume skill count
    # regardless of relevance, so a candidate who knows MORE than a job's
    # short technical_skills list (real postings: 2-10 generic tags) is
    # structurally penalized for it - confirmed live: a 29-skill resume vs a
    # 5-tag job sharing 3 skills scored 3/31=9.7% under Jaccard despite a
    # genuinely strong match. This answers "how much of what the job asks
    # for does the resume cover" instead, which is what a candidate actually
    # cares about: 3/5=60% for the same example.
    has_skill_signal = bool(job_skills_norm)
    skill_overlap = len(intersection) / len(job_skills_norm) if has_skill_signal else 0.0

    exp_alignment, exp_is_known = calculate_experience_alignment(
        resume_text, job.get("experience_level"), job.get("min_years_experience")
    )

    # 16.6% of the corpus (7,585 of 45,698 rows, overwhelmingly rule-enriched)
    # has NO technical_skills at all, because rule_enrich only derives skills
    # from an explicit skills_hint field and returns [] when the source data
    # had none. Scoring skill_overlap as a hard 0.0 there would spend the
    # single largest weight (50%) punishing a job for what the SCRAPER didn't
    # capture, which has nothing to do with candidate fit - it made those rows
    # effectively unrankable and near-invisible in results regardless of how
    # well the candidate actually matched. Instead, drop the missing term and
    # renormalize the remaining weights over the signals that do exist, so a
    # tagless job is ranked on its real evidence rather than penalized for an
    # absent field. Confidence is reported separately so the UI can be honest
    # that less was known here.
    weights = {"semantic": SEMANTIC_WEIGHT}
    if has_skill_signal:
        weights["skill"] = SKILL_WEIGHT
    if exp_is_known:
        weights["experience"] = EXPERIENCE_WEIGHT

    total_weight = sum(weights.values())
    match_score = (
        weights.get("skill", 0.0) * skill_overlap
        + weights["semantic"] * semantic_sim
        + weights.get("experience", 0.0) * exp_alignment
    ) / total_weight

    breakdown = {
        "skill_overlap": round(skill_overlap, 4),
        "semantic_similarity": round(semantic_sim, 4),
        "experience_alignment": round(exp_alignment, 4),
        "matched_skills": sorted(intersection),
        "missing_skills": sorted(job_skills_norm - resume_skills_norm),
        # Which signals actually backed this score, so the UI can show
        # "details incomplete" instead of implying full confidence.
        "has_skill_signal": has_skill_signal,
        "has_experience_signal": exp_is_known,
        "confidence": _confidence_label(has_skill_signal, exp_is_known),
    }

    return {
        "job_id": job["id"],
        "title": job["title"],
        "company": job["company"],
        "location": job.get("location"),
        "sources": job.get("sources", []),
        "apply_url": job.get("apply_url"),
        "role_category": job.get("role_category"),
        "experience_level": job.get("experience_level"),
        "min_years_experience": job.get("min_years_experience"),
        "salary_min_lpa": job.get("salary_min_lpa"),
        "salary_max_lpa": job.get("salary_max_lpa"),
        "posted_date": job.get("posted_date"),
        "match_score": round(match_score, 4),
        "verdict": generate_match_verdict(breakdown),
        "breakdown": breakdown,
    }


def generate_match_verdict(breakdown: dict) -> str:
    """A one-line, deterministic summary of a match, built directly from the
    real matched/missing skills and confidence already in the breakdown - not
    a free-form Gemini paraphrase. A director-level review of this pipeline
    found the "semantic similarity" signal is a hashed bag-of-words vector
    reused outside what it was validated for, so match_score is not yet fully
    trustworthy; having an LLM narrate an uncertain number in confident prose
    would launder that uncertainty rather than surface it. A template cannot
    hallucinate, costs no API call, runs instantly, and can name its own
    confidence honestly - strictly better here than a generated sentence."""
    matched = breakdown["matched_skills"]
    missing = breakdown["missing_skills"]
    confidence = breakdown.get("confidence", "high")
    total_skills = len(matched) + len(missing)
    exp_alignment = breakdown.get("experience_alignment", 0)
    has_exp_signal = breakdown.get("has_experience_signal", True)

    # Lead with whatever actually decides this match, rather than always
    # emitting the same "{prefix}. N of M skills match, and {experience}."
    # shape - a fixed template makes every row read identically even when the
    # underlying situations differ a lot, which is what the row is for.
    if not total_skills:
        if confidence == "low":
            return (
                "Fit unclear. This posting lists no skills, so the score leans on "
                "text similarity alone."
            )
        return "Fit unclear. This posting lists no skills to compare against yours."

    # Name the specific gap when it is small enough to act on - "one core
    # skill is missing: Kubernetes" is decision-useful in a way that
    # "5 of 6 skills match" is not.
    if not missing:
        base = f"Strong fit. You have all {total_skills} listed skills"
    elif len(missing) == 1:
        base = f"Close fit. You have {len(matched)} of {total_skills} skills, missing only {missing[0]}"
    elif len(missing) == 2:
        base = (
            f"Good fit. You have {len(matched)} of {total_skills} skills, "
            f"missing {missing[0]} and {missing[1]}"
        )
    elif len(matched) >= len(missing):
        base = f"Good fit. You have {len(matched)} of {total_skills} skills"
    elif len(matched):
        base = f"Partial fit. Only {len(matched)} of {total_skills} skills line up"
    else:
        base = f"Weak fit. None of the {total_skills} listed skills match yours"

    if not has_exp_signal:
        tail = ", and the posting does not state an experience requirement"
    elif exp_alignment >= 0.85:
        tail = ", and the seniority matches your level"
    elif exp_alignment >= 0.5:
        tail = ", though the seniority is a slight stretch"
    elif exp_alignment >= 0.2:
        tail = ", but it asks for more experience than you have"
    else:
        tail = ", but it is aimed well above your current experience"

    suffix = " Details here were auto-extracted and may be incomplete." if confidence == "low" else ""
    return f"{base}{tail}.{suffix}"


def _confidence_label(has_skill_signal: bool, exp_is_known: bool) -> str:
    """How much real evidence backed a score. A job missing its skill tags is
    scored mostly on text similarity alone, which is a genuinely weaker basis
    than one with tags - saying so is more useful than a confident number."""
    if has_skill_signal and exp_is_known:
        return "high"
    if has_skill_signal or exp_is_known:
        return "medium"
    return "low"
