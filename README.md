<div align="center">

# Smart Apply

**A resume-matching engine that scores every job against your actual skills, not your keywords.**

45,698 jobs indexed. Hybrid scoring across skill overlap, semantic similarity, and experience fit. Explainable end to end, deployed on a fully free-tier stack.

[![Backend](https://img.shields.io/badge/backend-FastAPI-009485?logo=fastapi&logoColor=white)](backend)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2014-black?logo=next.js&logoColor=white)](frontend)
[![Vector DB](https://img.shields.io/badge/vectors-Qdrant-DC244C?logo=qdrant&logoColor=white)](https://qdrant.tech)
[![Database](https://img.shields.io/badge/data-Supabase%20Postgres-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

## The problem

Job boards return everything that matches a keyword and leave the ranking to you. A search for "Data Scientist" surfaces analysts, ML engineers, and BI leads in one undifferentiated list, and nothing on the page tells you why a result showed up or whether your resume is even close to qualifying.

Smart Apply inverts that. Upload a resume once, and every job in the corpus is scored against it directly: which of its required skills you have, which you don't, how close your experience is to what it asks for, and a plain-language verdict for each match. No result appears without a reason attached to it.

## What it actually does

| Capability | How |
| --- | --- |
| Resume-to-job matching | Hybrid score across skill overlap, semantic similarity, and experience alignment, reranked over a wide retrieval pool |
| Match verdicts | Deterministic templates built from the real matched/missing skill lists, not free-form LLM prose that can hallucinate a fit that isn't there |
| ATS resume check | Rule-based formatting and parseability audit, scored independent of any single job |
| Skill gap roadmap | A generated 7-day plan targeting the specific skills missing from your top match |
| Mock interview prep | Role-specific technical questions with difficulty tuning, cached per role |
| Resume bullet rewriting | Tailors existing bullets toward one target job's actual listed requirements |
| Job comparison | Side-by-side and N-way diffing across skills, salary bands, and experience level |
| Market intelligence | Live salary bands, trending skills, and role-category demand computed from the full corpus |
| Conversational agent | A chat interface that can pull job cards, run comparisons, and generate roadmaps mid-conversation via function calling |
| New-role digest | Surfaces jobs added since your last visit, ranked against your resume's skill profile |

## How a match happens

```mermaid
flowchart LR
    A[Resume upload] --> B[Text extraction]
    B --> C[Skill + experience parsing]
    C --> D[Local embedding]
    D --> E[Qdrant vector search<br/>wide candidate pool]
    E --> F[Rerank by skill overlap]
    F --> G[Hybrid score]
    G --> H[Verdict template]
    H --> I[Ranked results]

    subgraph Score [" "]
    S1["Skill overlap · 0.50"]
    S2["Semantic similarity · 0.35"]
    S3["Experience alignment · 0.15"]
    end
    Score --> G
```

The score is a weighted sum, not a black box:

```
match_score = 0.50 × skill_overlap + 0.35 × semantic_similarity + 0.15 × experience_alignment
```

Every component is inspectable on the results page: which skills matched, which are missing, and how the candidate's detected experience compares against what the role actually asks for. Experience alignment is graduated, not binary — a one-year gap and a six-year gap don't score the same, and a role with no stated experience requirement is flagged as unknown rather than silently scored as a perfect match.

## Under the hood

```mermaid
flowchart TB
    subgraph Client["Next.js 14 · client"]
        UI[Browse / Match / Detail pages]
        LS[(localStorage<br/>saved jobs, applications)]
        SS[(sessionStorage<br/>resume results, Gemini key)]
    end

    subgraph API["FastAPI backend"]
        R1[jobs]
        R2[resume]
        R3[agent]
        R4[chat]
        R5[stats]
        R6[feedback]
    end

    subgraph Data["Storage"]
        PG[(Supabase Postgres<br/>45,698 jobs)]
        QD[(Qdrant Cloud<br/>384-dim vectors)]
    end

    Gemini[Gemini API<br/>bring-your-own-key]

    UI <--> API
    UI -.-> LS
    UI -.-> SS
    R1 --> PG
    R2 --> PG
    R2 --> QD
    R3 --> Gemini
    R4 --> Gemini
    R5 --> PG
    UI -. X-Gemini-API-Key header .-> R2
    UI -. X-Gemini-API-Key header .-> R3
    UI -. X-Gemini-API-Key header .-> R4
```

Frontend and backend are fully decoupled — the browser talks to FastAPI exclusively over HTTP, and no business logic lives in a Next.js API route. Every Gemini-backed feature runs bring-your-own-key: an end user's key lives only in browser session storage and rides along in a request header, never touching a database or a server-side log.

## Deduplication

The raw corpus arrives with duplicate postings across sources — the same role mirrored on LinkedIn, Naukri, and an aggregator, with slightly different formatting each time. Two passes clean it before scoring ever runs:

- **Exact match** — company, title, and normalized location hashed together
- **Semantic match** — cosine similarity ≥ 0.88 on a local 384-dimension embedding, scoped to the same company and location and a bounded date window, catching near-duplicates that differ only in wording

The embedding used for this pass is a deterministic hashed bag-of-words, not a learned model. It costs nothing to run and needs no external API, which matters at 45,000-plus rows — it earns its keep on duplicate detection specifically, where two postings sharing the same real words is exactly the signal being tested for.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS v4 |
| UI primitives | shadcn on base-ui, Recharts for stats visualization |
| Backend | FastAPI, Python 3.11, Pydantic v2 |
| Structured data | Supabase (Postgres), full-text search via a Postgres RPC with GIN indexes |
| Vector search | Qdrant Cloud |
| Generative AI | Google Gemini, bring-your-own-key from the browser |
| Hosting | Vercel (frontend) and Render (backend), both free tier |

## Running it locally

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python scripts/setup_db.py
python scripts/ingest.py
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
```

```bash
curl http://127.0.0.1:8000/api/health
curl http://localhost:3000/
```

Both services also start together on Windows via `run_local.bat`.

## Deployment

Backend on Render, frontend on Vercel, both on free tiers, both auto-deploying on push.

1. Render: new web service from this repo, Docker build against `backend/Dockerfile`, environment variables for Supabase and Qdrant credentials, `CORS_ORIGINS` set to the Vercel domain once it exists.
2. Vercel: import the repo, root directory `frontend/`, environment variables pointing at the Render API URL and the Supabase project.

Free-tier instances spin down on inactivity, so the first request after a period of idle takes a few seconds to cold start.

## Engineering tradeoffs, stated plainly

- **Search covers title and skills, not full description text.** A description-body full-text query on a common term returned matches in the tens of thousands and blew past Supabase's free-tier statement timeout under real load testing. Narrowing the indexed surface to title and the skills array keeps the same query under a second, at the cost of not surfacing a job whose only mention of a term sits deep in the description body.
- **Most of the corpus is rule-tagged, not LLM-tagged, and that split is visible in the API.** Gemini enrichment covers roughly 9% of the corpus; the free-tier request quota makes covering the rest a matter of wall-clock time, not engineering effort, so the remainder runs on deterministic rule-based extraction. Every job record carries which path it came from.
- **The semantic score is a hashed embedding, not a trained one.** It is honest about what it is: strong at catching literal duplicate phrasing, weaker at true conceptual similarity between differently-worded postings. It is weighted accordingly rather than treated as a silver bullet.
- **No login.** Saved jobs and application tracking live in the browser. Fewer moving parts, faster to actually use, and there is no server-side account data to protect in the first place.

## Project layout

```
job-dekho/
  backend/     FastAPI app, matching engine, ingestion + enrichment scripts
  frontend/    Next.js 14 App Router, all pages client-rendered against the API
```
