"""Rule-based enrichment (no Gemini call) - a legitimate fallback that lets
every ingested job get useful category/experience/skill tags immediately,
with Gemini used as a progressive top-up rather than a blocking dependency.
Mirrors localEnrich() in the Qwen reference implementation's lib/enrich.ts.
"""
import re

from app.services.skills import normalize_skill

CATEGORY_RULES = [
    ("Data Science", ["data scientist", "machine learning", "ml engineer", "ai engineer", "research scientist"]),
    ("Data Engineering", ["data engineer", "analytics engineer", "data platform", "etl", "data warehouse"]),
    ("DevOps", ["devops", "site reliability", "sre", "platform engineer", "infrastructure", "cloud engineer"]),
    ("Mobile", ["android", "ios developer", "mobile engineer", "flutter", "react native"]),
    ("Frontend", ["frontend", "front-end", "ui engineer", "react developer", "web developer"]),
    ("Backend", ["backend", "back-end", "python developer", "api engineer", "server side", "java developer"]),
    ("Full Stack", ["full stack", "fullstack", "full-stack"]),
    ("QA", ["qa engineer", "sdet", "test automation", "quality assurance", "test engineer"]),
    ("Design", ["product designer", "ux designer", "ui designer", "visual designer"]),
    ("Product", ["product manager", "product owner", "program manager"]),
    ("Data Analytics", ["data analyst", "business analyst", "analytics"]),
]

DOMAIN_RULES = [
    ("FinTech", ["fintech", "payment", "banking", "lending", "insurance", "upi", "wallet"]),
    ("EdTech", ["edtech", "learning platform", "education", "courses", "students"]),
    ("HealthTech", ["healthtech", "healthcare", "clinical", "patients", "medical"]),
    ("E-commerce", ["ecommerce", "e-commerce", "marketplace", "retail", "catalog"]),
    ("SaaS", ["saas", "b2b software", "platform for teams", "subscription"]),
    ("AI/ML", ["generative ai", "llm", "machine learning platform", "ai product"]),
    ("Logistics", ["logistics", "supply chain", "delivery", "fleet", "shipping"]),
    ("Gaming", ["gaming", "game engine", "esports"]),
]

_INTERN_RE = re.compile(r"(intern|trainee|fresher|graduate program|apprentice)", re.IGNORECASE)
_SENIOR_TITLE_RE = re.compile(r"(lead|principal|staff|architect|head of|director)", re.IGNORECASE)
_RANGE_RE = re.compile(r"(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*\+?\s*years?", re.IGNORECASE)
_MAX_YEARS_RE = re.compile(r"(\d+)\+?\s*years?", re.IGNORECASE)

# Job-level suffix on the title itself (e.g. "SDE I", "SDE-2", "Data Scientist
# II", "Backend Developer (SDE 3/4)") - a widely used leveling convention
# (I=entry/junior, II=mid, III=senior, IV+=staff-equivalent) used ONLY as a
# LAST-RESORT signal when the JD states no explicit years of experience
# anywhere (a stated years range/hint always wins - level suffixes are a
# fallback, not an override, per the assignment's "genuinely on the basis of
# JD experience mention" requirement). Never used for deduplication - the raw
# title (numeral included) is always what's hashed, so "SDE I" and "SDE II"
# remain distinct postings regardless of how this tag classifies them.
_LEVEL_SUFFIX_RE = re.compile(
    r"\b(?:sde|sde-|software\s+engineer|data\s+scientist|developer|engineer|"
    r"analyst|associate)\s*[-#]?\s*(i{1,3}|iv|v|[1-5])\b"
    # negative lookahead: reject "Developer - 5 to 10 years" / "Engineer 3+
    # years" style years-range titles, which use the same "word + number"
    # shape but mean something entirely different from a level suffix.
    r"(?!\s*\+?\s*(?:-|to)?\s*\d*\s*(?:years?|yrs?))",
    re.IGNORECASE,
)
_ROMAN_TO_INT = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}


def _level_from_title_suffix(title: str):
    """Returns an approximate level int (1-5+) from an SDE/role-level title
    suffix, or None if no such convention is present. Handles simple ranges
    like "SDE-2/3" or "SDE I / II" by taking the LOWER bound (more
    conservative - avoids overclaiming seniority from an ambiguous posting)."""
    match = _LEVEL_SUFFIX_RE.search(title)
    if not match:
        return None
    raw_level = match.group(1).lower()
    level = _ROMAN_TO_INT.get(raw_level) or int(raw_level)

    # check for a second level number right after (e.g. "SDE-2/3", "SDE I/II")
    tail = title[match.end():match.end() + 6]
    range_match = re.match(r"\s*/\s*(i{1,3}|iv|v|[1-5])\b", tail, re.IGNORECASE)
    if range_match:
        raw_second = range_match.group(1).lower()
        second_level = _ROMAN_TO_INT.get(raw_second) or int(raw_second)
        level = min(level, second_level)

    return level


def _experience_from_level(level: int):
    if level <= 1:
        return "Fresher", 0
    if level <= 2:
        return "Mid", 2
    return "Senior", 5

_HEADER_RE = re.compile(r"^(what you|requirements|perks|benefits|about)", re.IGNORECASE)
_BULLET_RE = re.compile(r"^[-*•]\s*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def infer_category(title: str, description: str) -> str:
    lower = f"{title} {description[:400]}".lower()
    for category, keywords in CATEGORY_RULES:
        if any(k in lower for k in keywords):
            return category
    return "Engineering"


def infer_experience(title: str, description: str, min_exp_hint=None):
    if _INTERN_RE.search(title):
        return "Fresher", 0
    if _SENIOR_TITLE_RE.search(title):
        return "Senior", 6

    lower = description.lower()
    range_match = _RANGE_RE.search(lower)
    if range_match:
        lo, hi = int(range_match.group(1)), int(range_match.group(2))
        if hi <= 1:
            return "Fresher", lo
        if hi <= 5:
            return "Mid", lo
        return "Senior", lo

    if min_exp_hint is not None:
        if min_exp_hint <= 1:
            return "Fresher", min_exp_hint
        if min_exp_hint <= 5:
            return "Mid", min_exp_hint
        return "Senior", min_exp_hint

    years_match = _MAX_YEARS_RE.findall(lower)
    if years_match:
        max_years = max(int(y) for y in years_match)
        if max_years >= 5:
            return "Senior", max_years
        if max_years >= 2:
            return "Mid", max_years
        return "Fresher", max_years

    # No explicit years-of-experience signal anywhere in the JD or hint
    # fields - fall back to the title's own level suffix (SDE I/II/III etc)
    # as a last resort, since that convention IS a genuine (if coarse)
    # seniority signal the employer chose to encode in the title itself.
    level = _level_from_title_suffix(title)
    if level is not None:
        return _experience_from_level(level)

    # No years signal anywhere (JD, hint field, or title level suffix) - the
    # "Fresher" label here is not a claim about zero experience specifically,
    # it's the true default assumption in the absence of any signal. Pair it
    # with 0 (not None) so it participates correctly in year-range filtering -
    # a None here previously caused these rows to silently drop out of every
    # year-range bucket, including "0-2 years", despite being labeled Fresher.
    return "Fresher", 0


def infer_domains(title: str, description: str) -> list:
    lower = f"{title} {description[:400]}".lower()
    tags = []
    for tag, keywords in DOMAIN_RULES:
        if any(k in lower for k in keywords):
            tags.append(tag)
    return tags[:3]


def summarize(description: str) -> list:
    lines = []
    for line in description.split("\n"):
        cleaned = _BULLET_RE.sub("", line).strip()
        if len(cleaned) > 30 and not _HEADER_RE.match(cleaned):
            lines.append(cleaned)
    if len(lines) >= 3:
        return [l[:180] for l in lines[:3]]

    sentences = [s for s in _SENTENCE_SPLIT_RE.split(description.replace("\n", " ")) if len(s) > 30]
    return [s[:180] for s in sentences[:3]]


_NON_SKILL_VALUES = {
    "not mentioned", "not specified", "n/a", "na", "none", "not applicable",
    "unspecified", "not available", "tbd", "-",
}


def extract_skills_from_hint(skills_hint: str) -> list:
    if not skills_hint:
        return []
    raw_skills = [s.strip() for s in skills_hint.split(",") if s.strip()]
    seen = set()
    result = []
    for s in raw_skills:
        if s.strip().lower() in _NON_SKILL_VALUES:
            continue
        norm = normalize_skill(s)
        if norm not in seen:
            seen.add(norm)
            result.append(s.strip())
    return result[:10]


def rule_enrich(title: str, description: str, skills_hint: str = "", domain_hint: str = "", min_exp_hint=None) -> dict:
    experience_level, min_years = infer_experience(title, description, min_exp_hint)
    technical_skills = extract_skills_from_hint(skills_hint)
    domain_tags = [domain_hint] if domain_hint else infer_domains(title, description)

    return {
        "role_category": infer_category(title, description),
        "experience_level": experience_level,
        "min_years_experience": min_years,
        "technical_skills": technical_skills,
        "soft_skills": [],
        "domain_tags": domain_tags,
        "summary_bullets": summarize(description),
        "enrichment_source": "rules",
    }
