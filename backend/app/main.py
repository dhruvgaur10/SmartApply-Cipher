import asyncio
import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import jobs, resume, chat, agent, stats, feedback

app = FastAPI(title="Smart Apply API")


@app.on_event("startup")
async def _start_stats_warm_up():
    # Fire-and-forget background task - proactively keeps the shared stats
    # cache (backend/app/routers/stats.py) warm so /market and friends never
    # block a real request on the ~35s cold full-table scan.
    asyncio.create_task(stats.warm_stats_cache_periodically())

origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(resume.router)
app.include_router(chat.router)
app.include_router(agent.router)
app.include_router(stats.router)
app.include_router(feedback.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "job-dekho-api"}
