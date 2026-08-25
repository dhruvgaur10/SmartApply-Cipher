"""Parse the raw dataset's double-JSON-encoded `salaries` field into an
annualized LPA (lakhs per annum, INR) range.

Source values are third-party market-rate estimates (Payscale/Glassdoor/
Levels.fyi/etc), not employer-quoted figures, and the array mixes units:
- No `salary_currency` key: INR. `year` periodicity is already in lakhs
  (e.g. 5.2 = 5.2 LPA). `month`/`hour` periodicity is in raw rupees and must
  be annualized then divided by 100000 to get lakhs.
- `salary_currency: "$"`: USD, always in raw dollars regardless of
  periodicity - must be annualized (if needed), converted to INR, then to lakhs.
Entries are also sometimes internally inconsistent (e.g. salary_from in one
unit, salary_to in another within the same object) - a per-value plausibility
bound rejects individual figures outside a realistic LPA range rather than
discarding the whole job's salary data.
"""
import json

USD_TO_INR = 83
HOUR_TO_ANNUAL = 8 * 22 * 12  # 8h/day, 22 working days/month, 12 months
MONTH_TO_ANNUAL = 12

# Plausibility bound for a single annualized LPA figure. Below ~0.5 LPA or
# above ~500 LPA, treat as a unit-conversion error rather than a real salary.
MIN_PLAUSIBLE_LPA = 0.5
MAX_PLAUSIBLE_LPA = 500


def _to_lpa(value, periodicity: str, currency: str) -> float | None:
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None

    if currency == "$":
        annual_usd = value * (HOUR_TO_ANNUAL if periodicity == "hour" else MONTH_TO_ANNUAL if periodicity == "month" else 1)
        lpa = annual_usd * USD_TO_INR / 100000
    else:
        if periodicity == "hour":
            lpa = value * HOUR_TO_ANNUAL / 100000
        elif periodicity == "month":
            lpa = value * MONTH_TO_ANNUAL / 100000
        else:
            lpa = value  # already in lakhs/year

    if lpa < MIN_PLAUSIBLE_LPA or lpa > MAX_PLAUSIBLE_LPA:
        return None
    return round(lpa, 2)


def parse_salary_range(raw: str):
    """Returns (min_lpa, max_lpa) as floats, or (None, None) if unparseable."""
    if not raw or raw == "null":
        return None, None
    try:
        decoded = json.loads(raw)
        entries = json.loads(decoded)
    except (json.JSONDecodeError, TypeError):
        return None, None

    if not entries or not isinstance(entries, list):
        return None, None

    mins, maxs = [], []
    for entry in entries:
        periodicity = entry.get("salary_periodicity", "year")
        currency = entry.get("salary_currency", "")
        lo = _to_lpa(entry.get("salary_from"), periodicity, currency)
        hi = _to_lpa(entry.get("salary_to"), periodicity, currency)
        if lo is not None:
            mins.append(lo)
        if hi is not None:
            maxs.append(hi)

    if not mins and not maxs:
        return None, None

    min_lpa = min(mins) if mins else None
    max_lpa = max(maxs) if maxs else None
    return min_lpa, max_lpa
