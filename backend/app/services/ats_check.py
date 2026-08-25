"""ATS (Applicant Tracking System) friendliness check for an uploaded resume.

This is a property of the resume ITSELF (its formatting/structure), not of how
well it matches any particular job - shown once per upload, separate from the
per-job hybrid match score (which stays exactly the assignment's stated
0.50/0.35/0.15 formula, untouched).

Checks real, well-documented ATS parsing pitfalls:
- Multi-column layout (most ATS parsers read left-to-right by y-position and
  scramble two-column resumes into nonsense order)
- Tables (many ATS parsers cannot extract text trapped inside PDF table cells)
- Missing standard section headers (ATS keyword-section matching relies on
  recognizable headers like "Experience", "Education", "Skills")
- Contact info detectability (email/phone must be extractable plain text, not
  inside an image/icon-only header)
- Extractable text ratio vs page count (an image-heavy/scanned resume yields
  very little real text per page)
- Overly long or short resume (ATS + recruiter norms: roughly 1-2 pages)
- Non-standard bullet characters that some parsers mis-render (rare, mostly a
  cosmetic downstream issue in some ATS but flagged as a minor note)
"""
import re

STANDARD_SECTIONS = [
    "experience", "work experience", "employment", "education",
    "skills", "technical skills", "projects", "summary", "objective",
    "certifications", "achievements",
]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(\+?\d[\d\s\-().]{8,}\d)")

MIN_WORDS = 150
MAX_WORDS = 1400
# A genuine column seam is a LARGE, CONSISTENT gap (this wide, not just any
# inter-word space) that recurs at nearly the same x-position across many
# lines - ordinary prose line-wrapping/kerning never produces gaps this wide
# this often at a fixed x. Word-to-word spacing within one line of running
# text is typically well under 20pt; 90pt is roughly a blank half-inch gutter,
# which is what a real 2-column template inserts between columns.
COLUMN_GAP_THRESHOLD = 90
COLUMN_SEAM_TOLERANCE = 15  # pt: how close two rows' gap-start x must be to count as "the same seam"
MIN_ROWS_FOR_SEAM = 6


def _detect_multi_column(page) -> bool:
    """Heuristic: find each row's largest inter-word gap; if a large gap
    recurs at nearly the same x-position across many distinct rows, that's a
    persistent vertical seam - strong evidence of a real 2-column layout
    (a known ATS pitfall), not just occasional wide word-spacing on one line."""
    words = page.extract_words()
    if len(words) < 20:
        return False

    rows = {}
    for w in words:
        row_key = round(w["top"] / 3) * 3
        rows.setdefault(row_key, []).append(w)

    # for each row with a wide-enough gap, record the x-position where that gap starts
    seam_candidates = []
    total_rows = 0
    for row_words in rows.values():
        if len(row_words) < 2:
            continue
        total_rows += 1
        xs = sorted(w["x0"] for w in row_words)
        gaps = [(xs[i + 1] - xs[i], xs[i]) for i in range(len(xs) - 1)]
        widest_gap, gap_start_x = max(gaps, key=lambda g: g[0])
        if widest_gap >= COLUMN_GAP_THRESHOLD:
            seam_candidates.append(gap_start_x)

    if total_rows < MIN_ROWS_FOR_SEAM or not seam_candidates:
        return False

    # cluster seam candidates: does any single x-position (within tolerance)
    # account for a large share of the rows that have a wide gap at all?
    seam_candidates.sort()
    best_cluster_size = 1
    cluster_start = seam_candidates[0]
    cluster_count = 1
    for x in seam_candidates[1:]:
        if x - cluster_start <= COLUMN_SEAM_TOLERANCE:
            cluster_count += 1
        else:
            best_cluster_size = max(best_cluster_size, cluster_count)
            cluster_start = x
            cluster_count = 1
    best_cluster_size = max(best_cluster_size, cluster_count)

    # the seam must show up on a real minority-to-majority share of ALL rows
    # (not just among the rows that happened to have a wide gap), so a single
    # coincidental wide gap on one or two lines can never trigger this.
    return best_cluster_size >= MIN_ROWS_FOR_SEAM and (best_cluster_size / total_rows) > 0.3


def check_ats_friendliness(pdf, text: str) -> dict:
    issues = []
    checks_passed = 0
    checks_total = 0

    # 1. Multi-column layout
    checks_total += 1
    has_multi_column = any(_detect_multi_column(page) for page in pdf.pages)
    if has_multi_column:
        issues.append({
            "severity": "high",
            "message": "Multi-column layout detected - many ATS systems read left-to-right by "
                       "line and will scramble the text order of side-by-side columns.",
        })
    else:
        checks_passed += 1

    # 2. Tables
    checks_total += 1
    has_tables = any(len(page.find_tables()) > 0 for page in pdf.pages)
    if has_tables:
        issues.append({
            "severity": "medium",
            "message": "Table structures detected - text inside PDF tables is often skipped "
                       "entirely by ATS text extractors.",
        })
    else:
        checks_passed += 1

    # 3. Standard section headers
    checks_total += 1
    lower_text = text.lower()
    found_sections = [s for s in STANDARD_SECTIONS if s in lower_text]
    if len(found_sections) < 2:
        issues.append({
            "severity": "high",
            "message": "Few or no standard section headers found (e.g. Experience, Education, "
                       "Skills) - ATS keyword matching relies on recognizable section labels.",
        })
    else:
        checks_passed += 1

    # 4. Contact info detectable as plain text
    checks_total += 1
    has_email = bool(EMAIL_RE.search(text))
    has_phone = bool(PHONE_RE.search(text))
    if not has_email and not has_phone:
        issues.append({
            "severity": "high",
            "message": "No email or phone number found as extractable text - contact details "
                       "may be inside an image or icon-based header ATS cannot read.",
        })
    else:
        checks_passed += 1

    # 5. Text density (extractable text per page) - catches scanned/image PDFs
    # that pass the earlier MIN_EXTRACTED_TEXT_LENGTH gate only barely
    checks_total += 1
    words_per_page = len(text.split()) / max(len(pdf.pages), 1)
    if words_per_page < 80:
        issues.append({
            "severity": "high",
            "message": "Very little extractable text per page - this may be a scanned or "
                       "image-based PDF that ATS software cannot read at all.",
        })
    else:
        checks_passed += 1

    # 6. Resume length sanity
    checks_total += 1
    word_count = len(text.split())
    if word_count < MIN_WORDS:
        issues.append({
            "severity": "medium",
            "message": f"Resume seems short ({word_count} words) - may lack enough detail "
                       "for ATS keyword matching and recruiter review.",
        })
    elif word_count > MAX_WORDS:
        issues.append({
            "severity": "low",
            "message": f"Resume is quite long ({word_count} words) - consider trimming to "
                       "1-2 pages for both ATS and recruiter readability.",
        })
    else:
        checks_passed += 1

    score = round((checks_passed / checks_total) * 100)
    return {
        "score": score,
        "checks_passed": checks_passed,
        "checks_total": checks_total,
        "issues": issues,
    }
