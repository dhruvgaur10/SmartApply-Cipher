"""Thin wrapper around google-generativeai using BYOK keys from request headers.

google-generativeai has no per-call credential param; genai.configure() sets a
process-global client. This is acceptable for this app's stated scope (single-user
demonstration, no concurrent-request rate limiting requirement per project_spec.md)
since configure() is called immediately before each use.
"""
from fastapi import HTTPException

import google.generativeai as genai

GEN_MODEL = "gemini-3.5-flash-lite"
EMBED_MODEL = "models/gemini-embedding-001"
EMBED_DIM = 768


def get_model(api_key: str, tools=None):
    genai.configure(api_key=api_key)
    if tools:
        return genai.GenerativeModel(GEN_MODEL, tools=tools)
    return genai.GenerativeModel(GEN_MODEL)


def embed(api_key: str, text: str, task_type: str = "retrieval_query"):
    genai.configure(api_key=api_key)
    result = genai.embed_content(
        model=EMBED_MODEL,
        content=text[:2000],
        task_type=task_type,
        output_dimensionality=EMBED_DIM,
    )
    return result["embedding"]


def translate_gemini_error(e: Exception) -> str:
    """Maps a Gemini SDK exception to the same clean, user-facing message
    call_gemini() raises as an HTTPException - for callers (like chat's SSE
    stream) that can't raise HTTPException mid-stream after headers are already
    sent, and need a plain string to yield instead."""
    message = str(e)
    if "429" in message or "ResourceExhausted" in type(e).__name__:
        return (
            "Your Gemini API key has hit its free-tier quota for today. "
            "Wait for it to reset or use a different key."
        )
    if "API_KEY_INVALID" in message or ("400" in message and "API key" in message):
        return "Invalid Gemini API key. Please check and re-enter it."
    return "Gemini request failed. Please try again."


def call_gemini(fn, *args, **kwargs):
    """Runs a Gemini SDK call and translates common failures into clean,
    user-facing HTTPExceptions instead of a raw 500 - BYOK means every user's
    OWN key can hit its own free-tier quota, an expected/frequent case, not
    an internal error."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        message = translate_gemini_error(e)
        status = 429 if "quota" in message else 401 if "Invalid Gemini API key" in message else 502
        raise HTTPException(status, message) from e
