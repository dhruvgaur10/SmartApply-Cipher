import os
from functools import lru_cache

from supabase import create_client, Client
from qdrant_client import QdrantClient

QDRANT_COLLECTION = "job_embeddings"
EMBEDDING_DIM = 384  # local hashed bag-of-words embedding, see app/services/local_embed.py


@lru_cache
def get_supabase() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


@lru_cache
def get_qdrant() -> QdrantClient:
    return QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ.get("QDRANT_API_KEY"),
    )
