# Medical Reviewer Agent — System Design & Implementation Plan

## 1. Context

**ปัญหา:** นักวิจัย/แพทย์ตามอ่าน paper ใหม่ไม่ทัน
**สิ่งที่สร้าง:** Web app สาธารณะ (ไม่ต้อง login) + REST API + MCP server ที่ผู้ใช้พิมพ์ชื่อโรค/สาร → Agent ค้น PubMed/arXiv/Semantic Scholar ฯลฯ ผ่าน **searxng-LDR-academic** → คัดกรอง ~100 → 10 ฉบับ → อ่าน methodology/results (abstract + full text ถ้า Open Access) → สรุปเป็น **ตารางเปรียบเทียบ** ว่า paper ไหนให้ผลสอดคล้อง/ขัดแย้งกัน
**จุดขาย:** ใช้ Claude ประมวล "Fat Context" (หลาย paper พร้อมกัน) และย่นเวลาการทำ literature review

**การตัดสินใจที่ยืนยันกับผู้ใช้แล้ว**
| หัวข้อ | เลือก |
|---|---|
| LLM | Claude API (Anthropic SDK ผ่าน `langchain-anthropic`) |
| Deploy | Docker Compose บนเครื่องเดียว (Windows/VPS) |
| ความลึก | Abstract + Full text เมื่อเป็น Open Access |
| ภาษาผลลัพธ์ | ผู้ใช้เลือก ไทย/อังกฤษ (ค่าเริ่มต้นไทย) |
| Runtime | FastAPI + Worker แยก (arq บน Redis) + Postgres checkpointer |
| Frontend | Next.js 16 + React 19 + Tailwind v4 + shadcn/ui |

**ข้อค้นพบจาก repo searxng-LDR-academic** (ตรวจแล้ว 2026-10-04)
- Engine วิชาการเปิดไว้แล้วใน category `academic`: `pubmed, arxiv, semantic scholar, openalex, crossref, google scholar, base, openairepublications, openairedatasets, pdbe, loc`
- `search.formats` มีแค่ `html` → **ต้อง override `settings.yml` เพิ่ม `json`** มิฉะนั้น `format=json` ได้ 403
- `server.limiter: false` อยู่แล้ว; รับ env `SEARXNG_PORT/BIND_ADDRESS/SECRET/BASE_URL`; config ที่ `/etc/searxng/settings.yml`
- ไม่มี image บน Docker Hub → build จาก git context (pin commit SHA)
- SearXNG ให้แค่ title/url/snippet → ต้องเสริม metadata/abstract/full text จาก **Europe PMC** (หลัก), arXiv API, Unpaywall (fallback)
- ข้อควรระวัง: ถ้าส่ง `categories=` และ `engines=` พร้อมกัน SearXNG จะ **union** → ใช้ `engines=` อย่างเดียว; ชื่อ engine ที่มีช่องว่างต้อง URL-encode (`semantic%20scholar`)

---

## 2. Architecture

```
                 ┌──────────────────────── Caddy (reverse proxy, :80/:443) ────────────────────────┐
                 │   /            → web (Next.js 16)                                               │
                 │   /api/*       → api (FastAPI)        /mcp → api (MCPServer streamable-http)     │
                 └──────────────────────────────┬──────────────────────────────────────────────────┘
                                                │
   Browser ──SSE/REST──►  api (FastAPI, uvicorn, N replicas, stateless)  ◄──REST/MCP── External systems / Agents
                                 │  enqueue job (arq, _job_id=review:{id})      ▲ Redis Streams (XREAD) progress
                                 ▼                                              │
                       Redis 7 (arq queue + Streams + cache + quota counters)
                                 │
                                 ▼
                 worker (arq, M replicas) ── graph.astream(stream_mode=["custom","updates"]) → EventSink (DB seq + XADD)
                     │            │                │
                     │            │                └── langchain.mcp.MCPAdapter → external MCP servers (optional node)
                     │            └── Claude API (Anthropic)
                     ▼
        searxng-LDR-academic (:8080, format=json)  +  Europe PMC REST / arXiv API / Unpaywall / (optional) NCBI esearch
                     │
                     ▼
        Postgres 17 (reviews, papers, review_papers, review_events, api_keys + LangGraph checkpoints via AsyncPostgresSaver)
```

**ทำไมรองรับผู้ใช้พร้อมกันได้:** API ไม่รัน LLM เอง แค่ enqueue แล้วตอบ `review_id` ทันที; worker ขยายด้วย `docker compose up --scale worker=3`; progress เก็บใน `review_events` (seq) + Redis Streams → SSE ทุก replica ของ api เห็นเหมือนกันและ replay ได้ด้วย `Last-Event-ID`; LangGraph checkpoint (`durability="sync"`) ลง Postgres → งาน resume ได้หลัง worker restart; request ที่ `hash(topic+language+options)` ตรงกับงานที่กำลังรัน/เสร็จภายใน 24 ชม. จะ subscribe งานเดิมแทนรันใหม่

---

## 3. Tech Stack

### Backend (`backend/`) — Python 3.12, จัดการด้วย `uv`
| ส่วน | เทคโนโลยี / การตั้งค่าที่ยืนยันแล้ว |
|---|---|
| Web | FastAPI + uvicorn (`--loop uvloop`), `sse-starlette`, `slowapi` (อ่าน IP จาก header ของ Caddy เท่านั้น) |
| Agent | **LangGraph 1.x** StateGraph + `Send` fan-out; `langgraph-checkpoint-postgres` (`AsyncPostgresSaver` บน `AsyncConnectionPool` ต่อ worker process, `autocommit=True, row_factory=dict_row, prepare_threshold=0`; `setup()` รันครั้งเดียวผ่าน migration step) |
| LLM | `langchain-anthropic` (pin เวอร์ชัน) — `with_structured_output(T, method="json_schema", include_raw=True)` **ห้ามใช้ default function_calling** (forced tool_choice คืน 400 บน Opus 5.5/Sonnet 5.5). Models: `claude-opus-5-5` synthesize (`output_config.effort="high"` ตั้งชัดเจน เพราะ default = medium), `claude-sonnet-5-5` plan/extract, `claude-haiku-4-5` screening/topic-guard (ไม่ส่ง adaptive thinking). ทุก node รับ `StructuredLLM[T]` Protocol (inject ได้ → test ด้วย fake) |
| Queue | `arq` 0.28: `job_timeout=1800, max_tries=2, retry_jobs=False, max_jobs=MAX_CONCURRENT_REVIEWS_PER_WORKER (2-3), allow_abort_jobs=True`; resume ผ่าน checkpoint ไม่ใช่ retry |
| DB | Postgres 17, SQLAlchemy 2 async + Alembic |
| Cache/Streams | Redis 7 (arq, Redis Streams สำหรับ events, quota/budget counters, cache ผลค้นหา) |
| Sources | `httpx` async + per-host token bucket (`services/http.py`): SearXNG JSON; **Europe PMC REST** (`resultType=core` → abstract, pmcid, doi, isOpenAccess, fullTextUrlList; `/{PMCID}/fullTextXML` → JATS; ไม่ต้องใช้ key); arXiv API (Atom); Unpaywall (`CONTACT_EMAIL`) เฉพาะ DOI ที่ไม่มี PMC; NCBI `esearch` optional (`NCBI_API_KEY`); `pymupdf` ใน `asyncio.to_thread` + page cap |
| MCP server | `mcp` SDK **v2** (`mcp.server.mcpserver.MCPServer`), `streamable_http_app(stateless_http=True, json_response=True, streamable_http_path="/")` mount ที่ `/mcp`; FastAPI lifespan ต้อง `async with mcp.session_manager.run()`; CORS `allow_headers` รวม `Mcp-Protocol-Version, Mcp-Session-Id`, `expose_headers=["Mcp-Session-Id"]` |
| MCP client | `langchain[mcp]` (`langchain.mcp.MCPAdapter`) — **ไม่ใช้ `langchain-mcp-adapters` (archived)**; config `mcp_servers.json` รูปแบบ `{"mcpServers": {...}}`; hot reload ผ่าน endpoint admin |
| Config/Logs | `pydantic-settings`, `structlog`; LangSmith optional |
| Tests | `pytest`, `pytest-asyncio`, `respx`, fixtures จริง (Europe PMC JSON, JATS XML, arXiv Atom) |

### Frontend (`frontend/`) — Node 22, `pnpm`
| ส่วน | เทคโนโลยี / ข้อควรระวัง Next.js 16 |
|---|---|
| Framework | **Next.js 16** App Router, Turbopack (ห้ามใส่ custom webpack), `output: "standalone"`; `proxy.ts` แทน `middleware.ts`; `params/searchParams` เป็น Promise (`await props.params`); ไม่เปิด `cacheComponents` ใน v1 |
| UI | Tailwind CSS v4 + shadcn/ui + lucide-react + `motion` |
| Data | TanStack Query v5, `EventSource` (same-origin ผ่าน Caddy, ส่ง `Last-Event-ID` อัตโนมัติ), `zod`; `NEXT_PUBLIC_API_BASE=/api/v1` |
| Table/Chart | TanStack Table v8, Recharts (ตาม `dataviz` skill) |
| i18n | `next-intl` — routing ใน `proxy.ts` (`createMiddleware` export เป็น `proxy`), `getRequestConfig` คืน `locale` |
| Design | gstack **`design-consultation` → `design-html` → `design-review`** |
| E2E | Playwright (mock SSE ด้วย `route()`), `msw` สำหรับ REST |

### Infra
`docker-compose.yml`: `caddy` (`/mcp` และ `/events` ตั้ง `flush_interval -1`), `web`, `api`, `worker`, `redis`, `postgres`, `searxng` (`build.context: https://github.com/porespellar/searxng-LDR-academic.git#<commit-sha>`; mount `infra/searxng/settings.yml` = `use_default_settings: true` + `search.formats: [html, json]` + `server.secret_key` → `/etc/searxng/settings.yml:ro`; healthcheck curl `?format=json`); `.env.example`; `justfile`

---

## 4. LangGraph `review_graph`

### State (`graph/state.py`)
```python
class ReviewState(TypedDict):
    review_id: str; topic: str; language: str; options: ReviewOptions
    criteria: Criteria | None            # จาก plan_queries
    queries: list[str]
    candidates: list[Candidate]          # หลัง enrich_dedupe (deterministic)
    screened: Annotated[list[ScreenResult], operator.add]   # Send fan-out → reducer
    selected: list[Candidate]            # join node select_top
    fulltexts: Annotated[list[FullText], operator.add]
    cards: Annotated[list[PaperCard], operator.add]
    synthesis: Synthesis | None
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
```
Send targets มี private input schema (`ScreenBatchInput`, `PaperInput`) เพื่อไม่ให้ payload ปนเข้า state หลัก; join nodes dedupe ด้วย `paper_id` (กัน `operator.add` ซ้ำเมื่อ resume)

### Nodes
| # | Node | Model/บริการ | หน้าที่ |
|---|---|---|---|
| 0 | `topic_guard` | Haiku 4.5 | ปฏิเสธ topic ที่ไม่ใช่การแพทย์/ชีววิทยา หรือ abusive → status `rejected` (ประหยัดเงิน + กันหน้า public) |
| 1 | `plan_queries` | Sonnet 5.5 | topic (ไทย/อังกฤษ) → 3-6 query (PICO, MeSH/synonym) + `Criteria` (inclusion/exclusion, outcomes ที่สนใจ) |
| 2 | `search` | SearXNG `/search?q&format=json&engines=pubmed,arxiv,semantic%20scholar,openalex,crossref&pageno=` (+ NCBI esearch ถ้ามี key) | `asyncio.gather` ทุก query → candidate ~100 |
| 3 | `enrich_dedupe` | Europe PMC batch (`query=PMID:.. OR DOI:..`), arXiv API | abstract เต็ม, pmcid/doi, ปี, journal, OA flag, cited_by; รวมซ้ำ DOI → PMID → title fuzzy (`rapidfuzz`); upsert `papers` |
| 4 | `screen_batch` (Send, 10 ฉบับ/batch) | Haiku 4.5 | relevance 0-100 + เหตุผล เทียบ `Criteria` |
| 4b | `select_top` (join) | — | sort/cut `max_papers`, dedupe |
| 5 | `fetch_fulltext` (Send ต่อ paper) | Europe PMC JATS → arXiv PDF → Unpaywall PDF → `pymupdf` | parse JATS เก็บเฉพาะ Abstract/Methods/Results/Discussion, cap ~15k tokens/paper; fallback abstract; บันทึก `fulltext_source` |
| 6 | `extract` (Send ต่อ paper) | Sonnet 5.5 → `PaperCard` | design, population(n), intervention, comparator, outcomes + effect size/CI/p, findings, limitations, funding/COI, risk-of-bias ย่อ, `direction: positive/negative/null/mixed` (ไม่มี free-form instruction field; paper text อยู่ใน user turn ภายใน delimiter) |
| 6b | `collect_cards` (join) | — | dedupe, upsert `review_papers.extraction` |
| 6c | `external_enrich` (optional, ข้ามเมื่อ `mcp_servers.json` ว่าง) | Sonnet 5.5 ReAct ≤3 tool calls | เรียก tools จาก MCP ภายนอก (เช่น ฐานข้อมูลสถาบัน) เพิ่ม context ให้ cards |
| 7 | `synthesize` | **Opus 5.5** effort high, streaming | รับเฉพาะ `PaperCard`s (ไม่ใช่ full text → ต้นทุนคาดการณ์ได้) → `Synthesis`: executive summary, comparison matrix (outcome × paper), consensus/conflict clusters + เหตุผล (population/dose/design), evidence strength, gaps; ภาษาตามเลือก; อ้าง `[P3]` |
| 8 | `finalize` | DB | result JSON, `status=done`, `cost_usd`, `model_versions`, `prompt_version` |

### Streaming / resume / errors
- Node เรียก `writer = get_stream_writer(); writer({"type": "screening", "kept": n, "total": m})` (no-op ใน unit test); arq task รัน `graph.astream(input, config, stream_mode=["custom","updates"], durability="sync")` → `EventSink` เขียน `review_events(seq)` แล้ว `XADD review:{id}` — ที่เดียวที่แตะ infra
- Worker `on_startup`: สร้าง pool + saver + compile graph เก็บใน `ctx`; `on_shutdown` ปิด pool; task `resume_review` เรียก `graph.ainvoke(None, config)`; เมื่อ worker start สแกน `reviews.status='running'` ที่ค้างเกิน threshold แล้ว re-enqueue (`_job_id` กันซ้ำ); DB writes เป็น upsert ทั้งหมด
- Source ล้มเหลว → `errors` แล้วไปต่อ; `stop_reason=refusal` → error อ่านรู้เรื่อง; `tenacity` retry เฉพาะ 429/5xx; timeout ต่อ node; LLM wrapper สะสม `usage` → ยกเลิกเมื่อเกิน `MAX_COST_PER_REVIEW_USD`

---

## 5. Public surfaces

### REST (`/api/v1`, OpenAPI ที่ `/api/docs`, tag `integration`)
| Method | Path | หน้าที่ |
|---|---|---|
| POST | `/reviews` | `{topic, language, options, callback_url?}` → `{review_id, status, cached}`; pre-flight ตรวจ budget; dedupe งาน in-flight |
| GET | `/reviews/{id}` | status + result |
| GET | `/reviews/{id}/events` | SSE: subscribe stream ก่อน → replay `seq > Last-Event-ID` → live (drop seq ซ้ำ); `: ping` ทุก 15s; ปิดหลัง done/error; จำกัด 5 connection/IP |
| GET | `/reviews/{id}/export?format=md\|csv\|json` | export |
| DELETE | `/reviews/{id}` | ยกเลิก (`Job.abort()`), ต้องมี API key |
| GET | `/reviews?recent=20` | เฉพาะ `done` และ `is_listed=true` |
| GET | `/papers/search?q=&limit=` | SearXNG + Europe PMC เท่านั้น, rate limit แยก |
| POST | `/admin/mcp/reload` | reload `mcp_servers.json` (API key) |
| GET | `/healthz`, `/metrics` | health / Prometheus |

- **API keys:** ตาราง `api_keys(hash, name, daily_quota, created_at, revoked_at)` + คำสั่ง `just mint-key`; key ปลดล็อก quota สูง, `callback_url`, DELETE, admin
- **Webhook:** POST `{review_id, status, result_url}` + `X-Signature: sha256=HMAC(body, key_secret)`; retry 3 ครั้ง (arq task); HTTPS public host เท่านั้น (SSRF guard: reject private/loopback)

### MCP server (`/mcp`, streamable HTTP, stateless)
Tools: `search_papers(query, limit)`, `start_review(topic, language, max_papers)`, `get_review_status(review_id)`, `get_review_result(review_id)`, `get_fulltext(pmcid)`
Resources: `review://{id}`, `review://{id}/report.md` — Prompt: `literature_review(topic)`
Tools เรียก service layer เดียวกับ REST (ไม่แตะ graph ตรง)

### Web (Next.js)
- `/` — hero + ช่องค้นหา + ตัวเลือก (ภาษา, จำนวน paper, ช่วงปี, ชนิดงานวิจัย) + ตัวอย่าง topic + review สาธารณะล่าสุด + banner เมื่อ quota หมด
- `/r/[id]` — timeline live → dashboard: summary cards, **comparison matrix** (sticky header, badge ทิศทางผล), consensus/conflict panel, paper cards (abstract/extraction, DOI/PMC links), charts, export/share
- `/about` — วิธีต่อ API/MCP (คัดลอก config ได้)

---

## 6. Data model (Postgres)
- `reviews(id uuid, topic, cache_key, language, options jsonb, status enum[queued,running,done,error,rejected,cancelled], progress jsonb, result jsonb, error, ip_hash, api_key_id?, callback_url?, cost_usd, model_versions jsonb, prompt_version, is_listed bool, created_at, started_at, finished_at)`
- `papers(id uuid, doi, pmid, pmcid, arxiv_id, title, authors jsonb, year, journal, abstract, oa_url, fulltext_source, metadata jsonb, updated_at)` — unique partial index บน doi/pmid/pmcid/arxiv_id
- `review_papers(review_id, paper_id, rank, relevance_score, screen_reason, included, extraction jsonb)` PK `(review_id, paper_id)`
- `review_events(id, review_id, seq, type, payload jsonb, created_at)` `UNIQUE(review_id, seq)`
- `api_keys(...)`; LangGraph `checkpoints*` จาก `AsyncPostgresSaver.setup()`

---

## 7. ความปลอดภัย/ต้นทุนสำหรับหน้า public
- Rate limit ต่อ IP (slowapi + Redis) + global `MAX_REVIEWS_PER_DAY`, `MAX_USD_PER_DAY` (429 + `Retry-After`)
- Pre-flight estimate (`max_papers × avg tokens`) vs budget คงเหลือก่อน enqueue; hard cap ต่อ review
- `topic_guard` node (Haiku) + จำกัดความยาว topic; Cloudflare Turnstile เปิดเป็นค่าเริ่มต้นใน production compose (`TURNSTILE_SECRET` ว่าง = ปิดสำหรับ dev)
- เก็บเฉพาะ hash IP; SearXNG ไม่ expose ออกนอก network
- Prompt-injection: paper text ไม่เข้า system prompt; schema ไม่มี free-form instruction fields

---

## 8. โครงสร้างไฟล์
```
D:\MedicalReviewerAgent\
├── docker-compose.yml  docker-compose.prod.yml  .env.example  justfile  README.md  CLAUDE.md
├── infra/caddy/Caddyfile   infra/searxng/settings.yml
├── backend/
│   ├── pyproject.toml  alembic.ini  Dockerfile  mcp_servers.json
│   ├── app/
│   │   ├── main.py            # FastAPI + lifespan (AsyncExitStack: DB pool, Redis, mcp.session_manager.run) + mount /mcp
│   │   ├── config.py
│   │   ├── api/ (reviews.py, papers.py, events.py, admin.py, health.py, deps.py, ratelimit.py)
│   │   ├── mcp/server.py      # MCPServer tools/resources/prompts
│   │   ├── graph/ (state.py, schemas.py, graph.py [build_graph(deps)], nodes/*.py, prompts/*.md)
│   │   ├── services/ (http.py, searxng.py, europepmc.py, arxiv.py, unpaywall.py, ncbi.py, jats.py, pdf.py, dedupe.py,
│   │   │              llm.py [StructuredLLM protocol + factories + cost], events.py [EventSink], cache.py, quota.py, webhook.py, mcp_client.py)
│   │   ├── db/ (models.py, session.py, repositories.py) + migrations/
│   │   └── worker/ (settings.py, tasks.py [run_review, resume_review, deliver_webhook])
│   └── tests/ (unit/, integration/ [MemorySaver + FakeStructuredLLM + respx], fixtures/, live/ [@pytest.mark.live])
├── frontend/
│   ├── package.json  next.config.ts  proxy.ts  Dockerfile
│   ├── app/[locale]/ (page.tsx, r/[id]/page.tsx, about/page.tsx, layout.tsx)
│   ├── components/ (search-form, progress-timeline, comparison-matrix, consensus-panel, paper-card, charts, export-menu, ui/*)
│   ├── lib/ (api.ts, sse.ts, types.ts, i18n/)
│   └── e2e/
└── docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md
```

---

## 9. ลำดับการพัฒนา (แต่ละเฟสมี test/verify ก่อนไปต่อ; ใช้ writing-plans → executing-plans หลังอนุมัติ)

1. **Spec + scaffold** — บันทึก spec, `git init`, โครง backend (uv) / frontend (create-next-app@16) / compose / `.env.example` / CLAUDE.md
2. **Infra** — postgres, redis, searxng (override) → verify `curl "localhost:8080/search?q=metformin&format=json&engines=pubmed,arxiv"` ได้ JSON
3. **Backend core** — config, DB + Alembic (รวม `AsyncPostgresSaver.setup()`), `POST/GET /reviews`, arq worker รัน job ปลอม, EventSink → Redis Streams → SSE replay/live ใช้งานได้ end-to-end
4. **Services (TDD, respx + fixtures)** — http token bucket, searxng, europepmc, jats, arxiv, unpaywall, pdf, dedupe, llm (รวม smoke test จริงต่อ model/schema 1 ครั้ง)
5. **Graph (TDD)** — nodes + reducers + join nodes; integration test ด้วย `MemorySaver` + `FakeStructuredLLM`; contract test reducer (2 Send branches); resume-after-crash test; จากนั้น live run 1 topic
6. **MCP** — MCPServer + ทดสอบด้วย `npx @modelcontextprotocol/inspector`; MCPAdapter + `external_enrich` + reload endpoint
7. **Frontend** — `design-consultation` (design system งานการแพทย์) → หน้า `/`, `/r/[id]`, `/about` → `design-review` → Playwright
8. **Hardening** — quota/budget, Turnstile, API keys + webhook, export, README, `/code-review`

---

## 10. Verification (end-to-end)
- `docker compose up -d --build` → ทุก service healthy; searxng JSON ตอบ
- `pytest` ผ่าน (backend); `pnpm test:e2e` ผ่าน (frontend)
- `POST /api/v1/reviews {"topic":"metformin and colorectal cancer risk","language":"th"}` → `review_id` → `curl -N .../events` เห็น event `planning … done` ใน ~2-5 นาที; ตัด connection กลางทางแล้วต่อใหม่ด้วย `Last-Event-ID` ไม่หาย/ไม่ซ้ำ
- เปิด `http://localhost/r/{id}` เห็น timeline live + ตารางเปรียบเทียบ consensus/conflict
- MCP Inspector ต่อ `http://localhost/mcp` → `start_review` → `get_review_result` ตรงกับ web
- ยิง 3 review พร้อมกัน + `--scale worker=2` เสร็จครบ; `docker restart worker` ระหว่าง extract → งาน resume โดย paper ที่ extract แล้วไม่รันซ้ำ
- ยิง topic ซ้ำระหว่างรัน → ได้ `review_id` เดิม (`cached: true`)

## 11. ข้อสมมติ / ตัดออกใน v1
- ไม่มี login; ไม่มี human-in-the-loop แก้รายการ paper (โครงรองรับ `interrupt` ภายหลัง); ไม่ทำ A2A (job contract start/status/result/events ออกแบบให้ wrap ได้ภายหลัง)
- Full text เฉพาะ Open Access; paper ปิดใช้ abstract
- env ที่ต้องมี: `ANTHROPIC_API_KEY`, `CONTACT_EMAIL` (Unpaywall/NCBI); optional `NCBI_API_KEY`, `TURNSTILE_SECRET`, `LANGSMITH_API_KEY`
- Google Scholar/OpenAlex/Crossref ไม่ใช่แหล่งหลักใน v1 (captcha / ต้องการ key / ซ้ำซ้อนกับ Europe PMC)
