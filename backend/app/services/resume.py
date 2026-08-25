import json

import pdfplumber
from fastapi import HTTPException

from app.services.gemini_client import get_model, call_gemini
from app.services.local_embed import local_embed
from app.services.skills import normalize_skill

SKILL_EXTRACTION_PROMPT = (
    "Extract technical skills mentioned in this resume as a JSON array of lowercase strings. "
    "Only include hard/technical skills (programming languages, frameworks, libraries, tools, "
    "databases, cloud platforms) that are EXPLICITLY WRITTEN in the resume text below - do not "
    "infer, guess, or add related skills that are not literally present. "
    "Example output: [\"python\", \"react\", \"postgresql\", \"docker\"]\n"
    "Return only the JSON array, no other text.\n\nResume:\n{text}"
)

# Extraction reads the whole resume (up to this cap) so skills listed near the
# end of longer resumes (e.g. a Skills section after Experience/Projects)
# aren't silently dropped by an earlier, tighter truncation.
SKILL_EXTRACTION_MAX_CHARS = 6000

MIN_EXTRACTED_TEXT_LENGTH = 80


def open_and_extract(file):
    """Returns (pdfplumber.PDF, extracted_text). Caller is responsible for
    closing the PDF object. Kept as a single open() so both text extraction
    and ATS structural checks (tables/columns) read the same parsed pages."""
    pdf = pdfplumber.open(file)
    text_parts = [page.extract_text() for page in pdf.pages if page.extract_text()]
    text = "\n".join(text_parts)
    if len(text.strip()) < MIN_EXTRACTED_TEXT_LENGTH:
        pdf.close()
        raise HTTPException(
            400,
            "No extractable text found in PDF. Please upload a text-based (not scanned/image) PDF.",
        )
    return pdf, text


def extract_skills(api_key: str, text: str) -> set:
    model = get_model(api_key)
    prompt = SKILL_EXTRACTION_PROMPT.format(text=text[:SKILL_EXTRACTION_MAX_CHARS])
    response = call_gemini(
        model.generate_content,
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    try:
        raw_skills = json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        raw_skills = []

    text_lower = text.lower()
    verified_skills = set()
    for s in raw_skills:
        if not isinstance(s, str) or not s.strip():
            continue
        # Reject hallucinated skills the model added but that don't actually
        # appear in the resume text - skill_overlap is the highest-weighted
        # (0.50) component of the match score, so an unverified LLM skill list
        # would silently inflate/distort every downstream match.
        if s.strip().lower() not in text_lower:
            continue
        verified_skills.add(normalize_skill(s))
    return verified_skills


def embed_resume(text: str):
    return local_embed(text[:5000])
