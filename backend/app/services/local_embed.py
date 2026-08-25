"""Deterministic local embedding (hashed bag-of-words, unigrams + bigrams),
ported from the reference implementation's lib/embeddings.ts. Zero external
API calls - used for L2 semantic dedup across the full ~57k-record corpus,
where per-job Gemini embedding calls would be both slow and quota-risky at
that volume. L2-normalized so dot product equals cosine similarity.
"""
import math
import re

LOCAL_DIM = 384

STOPWORDS = {
    "the", "and", "for", "with", "you", "our", "are", "will", "that", "this",
    "have", "has", "your", "their", "they", "them", "from", "into", "about",
    "who", "what", "when", "where", "how", "why", "can", "able", "been", "being",
    "was", "were", "its", "also", "more", "most", "some", "such", "than", "then",
    "there", "here", "all", "any", "each", "very", "just", "not", "but", "per",
    "via", "use", "using", "used", "work", "working", "team", "role", "job",
}

_TOKEN_CLEAN_RE = re.compile(r"[^a-z0-9+#. ]+")
_WHITESPACE_RE = re.compile(r"\s+")


def tokenize(text: str) -> list:
    cleaned = _TOKEN_CLEAN_RE.sub(" ", text.lower())
    tokens = _WHITESPACE_RE.split(cleaned)
    return [t for t in tokens if len(t) > 1 and t not in STOPWORDS]


def _fnv1a(s: str, mod: int) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % mod


def local_embed(text: str, dim: int = LOCAL_DIM) -> list:
    tokens = tokenize(text)
    vec = [0.0] * dim
    for t in tokens:
        vec[_fnv1a(t, dim)] += 1.0
    for i in range(len(tokens) - 1):
        bigram = f"{tokens[i]}_{tokens[i + 1]}"
        vec[_fnv1a(bigram, dim)] += 0.5

    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


def cosine(a: list, b: list) -> float:
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = math.sqrt(sum(a[i] * a[i] for i in range(n)))
    nb = math.sqrt(sum(b[i] * b[i] for i in range(n)))
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


def job_embed_text(title: str, description: str) -> str:
    return f"{title}. {title}. {(description or '')[:500]}"
