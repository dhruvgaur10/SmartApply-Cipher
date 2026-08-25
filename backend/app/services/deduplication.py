import hashlib
import re
from datetime import date, datetime

from app.services.location import normalize_location

SEMANTIC_DEDUP_THRESHOLD = 0.88
SEMANTIC_DEDUP_MAX_DAYS_APART = 30

# Legal-entity suffixes vary across sources for the same real company
# ("Acme Pvt Ltd" vs "Acme Private Limited" vs "Acme Inc.") - stripping them
# before hashing/comparing prevents these from being treated as different
# companies, which would otherwise block both L1 and L2 dedup outright (L2's
# exact-company gate runs before semantic similarity is even considered).
_COMPANY_SUFFIX_RE = re.compile(
    r"\b(private\s+limited|pvt\.?\s*ltd\.?|ltd\.?|llp|inc\.?|corp\.?|corporation|"
    r"co\.?|company|technologies|technology|solutions|systems|group)\b\.?",
    re.IGNORECASE,
)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9\s]")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_company(company: str) -> str:
    """Canonicalize a company name for dedup comparison - lowercases, strips
    punctuation, and removes common legal-entity/generic suffixes so the same
    real company isn't treated as distinct across sources that format its
    name differently."""
    if not company:
        return ""
    text = company.lower().strip()
    text = _COMPANY_SUFFIX_RE.sub(" ", text)
    text = _NON_ALNUM_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def compute_hash(company: str, title: str, location: str) -> str:
    """L1 exact-dedup key. Location is normalized (city aliases collapsed) but
    NOT dropped: same company+title in two different real cities must remain
    two distinct rows. Only same company+title+same-city collapses here."""
    norm_location = normalize_location(location)
    content = f"{normalize_company(company)}|{title.lower().strip()}|{norm_location}"
    return hashlib.sha256(content.encode()).hexdigest()


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def is_semantic_duplicate(existing_job: dict, candidate: dict, source: str) -> bool:
    """L2 semantic merge check, called only after cosine similarity already
    passed SEMANTIC_DEDUP_THRESHOLD. Requires company AND normalized location
    to match (a Mumbai and a Bangalore posting for the same role are two real
    openings, not duplicates, even with boilerplate-similar descriptions), AND
    posting dates within SEMANTIC_DEDUP_MAX_DAYS_APART (a same-role re-posting
    months later is a fresh req, not the same listing seen on another platform).
    If either date is missing/unparseable, date-proximity is skipped rather than
    blocking the merge, since the source data doesn't always have posted_date.
    """
    if normalize_company(existing_job["company"]) != normalize_company(candidate["company"]):
        return False
    if normalize_location(existing_job.get("location")) != normalize_location(candidate.get("location")):
        return False
    if source in existing_job.get("sources", []):
        return False

    existing_date = _parse_date(existing_job.get("posted_date"))
    candidate_date = _parse_date(candidate.get("posted_date"))
    if existing_date and candidate_date:
        if abs((existing_date - candidate_date).days) > SEMANTIC_DEDUP_MAX_DAYS_APART:
            return False

    return True
