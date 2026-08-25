"""Indian city alias normalization for dedup keys.

Different job sources spell the same city differently (colonial names, common
misspellings, abbreviations). Without normalizing before hashing/comparing, the
same real-world opening in "Bombay" vs "Mumbai" is treated as two different
locations (under-merging), while unrelated cities that happen to share a
substring are never conflated (this map is closed/exact-match only, so it
cannot over-merge).
"""
import re

CITY_ALIASES = {
    "bombay": "mumbai",
    "bengaluru": "bangalore",
    "calcutta": "kolkata",
    "madras": "chennai",
    "gurugram": "gurgaon",
    "cochin": "kochi",
    "trivandrum": "thiruvananthapuram",
    "poona": "pune",
    "vizag": "visakhapatnam",
    "baroda": "vadodara",
    "mysuru": "mysore",
    "new delhi": "delhi",
    "ncr": "delhi",
    "delhi ncr": "delhi",
    # Noida and Greater Noida are distinct municipalities but functionally the
    # same NCR job market as Delhi/Gurgaon - already treated as one metro
    # bucket for the other NCR aliases above, so these are included for
    # consistency rather than left as separate, un-mergeable location strings.
    "noida": "delhi",
    "greater noida": "delhi",
    # Secunderabad is administratively and functionally the twin city of
    # Hyderabad (jointly "Hyderabad-Secunderabad") - job postings treat them
    # as the same metro area, not two separate real-world locations.
    "secunderabad": "hyderabad",
}

# "Navi Mumbai" (New Bombay) is a genuinely distinct planned city/municipal
# corporation from Mumbai proper - deliberately NOT aliased to "mumbai" even
# though the name overlaps, since merging them would violate "don't merge
# non-duplicates": a Navi Mumbai posting and a Mumbai posting are different
# real openings in different parts of the metro region.

_NOISE_WORDS = {"india", "in", "ind"}
_WHITESPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9,\s]")
# Google Jobs appends "(+N other(s))" when a listing spans multiple locations.
# Must be stripped BEFORE punctuation removal collapses the parens into noise
# text that would otherwise survive as part of the city name (e.g.
# "Adraspalle (+35 others)" must become "adraspalle", not "adraspalle 35
# others"), and before splitting on comma since it can appear with or without
# a preceding comma-separated state segment.
_OTHER_LOCATIONS_SUFFIX_RE = re.compile(r"\(\s*\+?\s*\d+\s*others?\s*\)", re.IGNORECASE)


def normalize_location(raw: str) -> str:
    """Canonicalize a location string for dedup comparison.

    Not for display - lowercases, strips punctuation/state suffixes/country
    noise/the "(+N others)" multi-location suffix, and maps known city
    aliases to one canonical spelling. Only collapses KNOWN aliases for the
    same real place (closed exact-match map) - never merges genuinely
    different cities, even when names overlap (e.g. Navi Mumbai vs Mumbai).
    """
    if not raw:
        return "not specified"
    text = raw.lower().strip()
    text = _OTHER_LOCATIONS_SUFFIX_RE.sub(" ", text)
    text = _NON_ALNUM_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()

    parts = [p.strip() for p in text.split(",") if p.strip()]
    parts = [p for p in parts if p not in _NOISE_WORDS]
    if not parts:
        return "not specified"

    city = parts[0]
    city = CITY_ALIASES.get(city, city)
    return city
