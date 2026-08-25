"""Idempotency cache for Gemini roadmap/interview generation.

Two-tier: an in-process dict (fastest, per-worker) falling back to a Supabase
kv_cache table (survives across requests/restarts). Purpose is Gemini free-tier
quota protection, not correctness - cache writes are best-effort and never fail
the underlying request.
"""
import hashlib
import json

from app.database import get_supabase

_memory: dict = {}


def hash_key(parts: list) -> str:
    joined = "|".join(str(p) for p in parts)
    return hashlib.sha256(joined.encode()).hexdigest()[:32]


def cache_get(key: str):
    if key in _memory:
        return _memory[key]
    try:
        supabase = get_supabase()
        result = supabase.table("kv_cache").select("value").eq("key", key).execute()
        if result.data:
            value = result.data[0]["value"]
            _memory[key] = value
            return value
    except Exception:
        pass
    return None


def cache_set(key: str, value):
    _memory[key] = value
    try:
        supabase = get_supabase()
        supabase.table("kv_cache").upsert({"key": key, "value": json.loads(json.dumps(value))}).execute()
    except Exception:
        pass
