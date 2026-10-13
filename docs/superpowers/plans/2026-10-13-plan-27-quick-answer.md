# Plan 27: Quick Answer Mode ("ถามเร็ว") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A question can get a short, referenced answer in about a minute: the same engine screens about 30 candidates, reads the 8 most relevant abstracts, and writes 2–4 sentences whose citations are numbered [1]…[n] and link to PubMed, DOI or ThaiJO, with one closing line on certainty and limits and a "ทำรีวิวฉบับเต็ม" button. It is a request mode, not a review type; it keeps every rail of the full review (abstract only, verified numbers, refs only from the screened set, the Plan 26 safety rails, the Plan 25 support check) and costs about a third of a full review.

**Architecture:**
- **Mode** (`app/schemas/review.py`): `ReviewOptions.mode: "full" | "quick"` (default `full`). A `before` validator gives a quick request `QUICK_MAX_PAPERS = 8`, `QUICK_CANDIDATE_LIMIT = 30` and `review_type = "slr"`; `mode` is in the stored options, so it is in the cache key and the graph state. `/status` adds `limits.modes` and `limits.quick`. The cost cap is the existing formula with the quick sizes ($0.103 by default); rate limits, quotas, admission and daily counters are shared with full reviews.
- **Graph** (`app/graph/graph.py`): a quick answer reads without `external_enrich` and `fetch_citations` (`route_to_reading`), and `route_after_normalize` sends it to the new `write_quick_answer` node (`app/graph/nodes/quick.py`) instead of pools, conflict notes and `write_synthesis`. The writer (synthesizer role bound to `QuickAnswerDraft`, prompt `QUICK_SYSTEM`/`quick_user`, at most one repair, no escalation) is checked in code with the full review's citation and prose checks; the certainty sentence comes from the GRADE-lite baseline. It stores the answer in the `Synthesis` shape (`executive_summary` = answer, `answer` = closing line), so `localize`, `check_support` and `finalize` run unchanged; `finalize` adds `result.mode` and `result.quick = {refs, papers_read}`. `prompt_version` 2026-10-13.3.
- **Outside the page:** `quick_view` and the quick Markdown export (`app/services/report.py`), the MCP `quick_answer` tool (starts or reuses a quick answer and waits up to 90 s) and `start_review(mode=…)`, and the stub's quick shape.
- **Frontend:** `src/lib/quick.ts` (numbering, parts, the upgrade link, the form's start values), `QuickAnswer` (`src/components/review/quick-answer.tsx`) shown by `ReviewScreen` for a quick answer; the request form's mode choice ("ถามเร็ว (≈1 นาที)" by default, "รีวิวฉบับเต็ม"), `?mode=full&lang=&year=&types=` start values, and the quick duration on the live page.

**Tech Stack:** Python 3.12, Pydantic, FastAPI, the MCP server, LangGraph and the project's fake LLMs; Next.js 16, React, Vitest, Testing Library and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-27-quick-answer-design.md`

**Worktree:** `D:\MRA-plan-27` (branch `plan-27-quick-answer`).
- It is based on master `83196cc` (Plans 22a through 26 merged; ThaiJO on by default since 2026-10-13, `thaijo_enabled = True` in `app/config.py`, pinned off in `tests/conftest.py`; the production compose overlay). Its first two commits hold the spec (`0b364e4`), then this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-13-plan-27-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-plan-27/backend` or `cd /d/MRA-plan-27/frontend`.
- The frontend needs `npm ci` once (Task 4).
- **Existing interfaces this plan uses**, checked against master `83196cc` on 2026-10-13:
  - `ReviewOptions` (`bound`, `clamped`, the `enough_candidates` validator), `CreateReviewRequest`, `compute_cache_key` (`app/schemas/review.py`); `ReviewService.create`, `ReviewService.status`, `Refused` (`app/services/review_service.py`); `review_cost_cap`, `worst_case_review_cap` (`app/services/budget.py`); `build_mcp`, `start_review`, `INSTRUCTIONS`, `START_REVIEW_DOC`, `_error` (`app/mcp/server.py`); `TERMINAL_STATUSES` (`app/db/models.py`);
  - `_add_review_nodes`, `build_graph`, `GraphDeps`, `initial_state` (`app/graph/graph.py`); `route_to_reading` (`app/graph/nodes/screening.py`); `route_after_normalize`, `_narrative_papers`, `_direction_papers`, `_prose_context`, `_brief`, `_empty_synthesis`, `_split_sentences`, `_drop_wrong_self_claims`, `_CITED`, `_CITE_GROUP`, `ANSWER_CERTAINTY`, `NO_PAPERS`, `EXTRACTION_FAILED`, `SCREENING_FAILED`, `NO_QUANTITATIVE_RATIONALE`, `make_localize`, `make_finalize` (`app/graph/nodes/synthesis.py`); `make_check_support` (`app/graph/nodes/support.py`); `harness_spec`, `review_question` (`app/graph/nodes/intake.py`); `HarnessRunner.call` (`app/harness/runner.py`); `prose_problems`, `statement_problems`, `fix_prose`, `fix_statement`, `prose_context` (`app/harness/prose.py`); `check_citations`, `strip_unknown_citations` (`app/harness/verify.py`); `markers` (`app/harness/support.py`); `LLMs.with_schema` (`app/services/llm.py`); `Synthesis` (`app/graph/schemas.py`); `DATA_NOTICE` (`app/graph/prompts.py`); `Settings.prompt_version` (`app/config.py`);
  - `stub_result`, `_stub_support` (`app/graph/nodes/stub_result.py`), `finalize`, `make_timed_nodes` (`app/graph/nodes/stubs.py`); `render_markdown`, `_citation_parts`, `vancouver`, `_vancouver_md` (`app/services/report.py`);
  - test helpers `service`, `ANON` (`tests/unit/test_review_service.py`), `make_deps`, `run`, `card`, `eval_match_none`, `support_judge` (`tests/unit/test_review_graph.py`), `run` (`tests/unit/test_stub_timeline.py`), `sha` (`tests/unit/test_prompts_by_type.py`), the `app`, `client`, `queue`, `session_factory` fixtures (`tests/conftest.py`), `FakeStructuredLLM`, `bind_by_role`, `to_thai` (`tests/fakes.py`);
  - frontend `RequestSlip`, `STUDY_TYPES`, `TILE`, `segmented`, `StepNo` (`src/components/landing/request-slip.tsx`), `ReviewScreen`, `LiveRun`, `Report` and its `useDocumentLang`, `CitationText` (`src/components/review/references.tsx`), `citedQuestion` (`report-cite.tsx`), `ReportNotices` (`audience.tsx`), `alignMarkers`, `citationOf`, `isChecked` (`src/lib/support.ts`), `RC`, `pl`, `fieldLang` (`src/lib/i18n-report.ts`), `L`, `Lw` (`text.ts`), `TYPICAL_DURATION_TH` (`src/lib/copy.ts`), `reviewFixture`, `resultFixture`, `q1`, `q3` (`src/test/fixtures.ts`), `STATUS_FIXTURE`, e2e `mockApi`, `json` (`e2e/mock-api.ts`).
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies:** none new, backend or frontend.
- **No spend:** no real LLM call anywhere in this plan, tests included. Tests use `FakeStructuredLLM`; the controller's smoke check runs the stub graph (no model) and spends nothing.
- **Same rails as a full review:** abstract only; refs only from the papers read as evidence (`_narrative_papers`: not-evidence papers never cited); every number that stays in the answer is one the prose checks trace to a verified card number; unverifiable numbers take their sentence with them; the certainty sentence is computed in code; translation happens last (`localize`, numbers unchanged).
- **Prompts:** English. Only `QUICK_SYSTEM`, `quick_user` and `QuickAnswerDraft` are new (Task 2, pinned in `test_quick_prompts_are_pinned`). Every SLR pin, the guard pins and the Plan 25 judge pins hold. `prompt_version` becomes `2026-10-13.3` (Task 2), with the pin comment in `tests/unit/test_prompts_by_type.py` and the `docs/api.md` header (Task 6) in step.
- **Limits from /status:** the quick sizes are constants in `app/schemas/review.py`, published in `/status` `limits.quick`; the web form reads them from there (never hard-coded in copy).
- **Safety:** the Plan 26 red-flag pass and guard apply unchanged before any spend (the MCP `quick_answer` tool returns the same `refused` result as `start_review`).
- **Python files** are written with LF line endings (`newline="\n"`). Do not paste file contents through a Bash heredoc on this host: it collapses `\\` to `\`. Use the editor tools.
- **Commits:** each message is written with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (the folder is git-ignored) and committed with `git commit -F .superpowers/commit-msg.txt`. Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Known flaky tests:** `tests/unit/test_capacity.py::test_queue_position` (about 1 run in 3) and the e2e `admin-runtime.spec.ts` "settings: edit, check and save as version 3…" (a 30 s timeout under load; it failed once in the pre-flight baseline and passed in every later run). Under host load, two heavy vitest cases can pass the 5 s test timeout: `src/lib/agent-layout.test.ts` "keeps everything inside the viewBox and nodes apart" (wide and narrow; about 1.7 s and 2.9 s alone) and `team-stage.test.tsx` "Plan 21 fix round 1: for N = 5, 30 and 50 …". In the pre-flight they timed out the same way on master `83196cc` itself (two of two full runs) and passed alone; this plan touches neither. If one fails, rerun it alone once and report both results.
- **Do not touch** `D:\MedicalReviewerAgent` until the controller's merge step, and there never `CLAUDE.md`'s working-tree edits, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new`.

## Review Focus

1. **Fixed sizes, separate cache entries** (Task 1): `test_a_quick_request_gets_the_fixed_sizes_and_a_graded_type_whatever_it_sends`, `test_the_mode_is_part_of_the_cache_key`, `test_quick_and_full_answers_to_one_topic_are_separate_reviews`, the shared hourly limit, the quick cost cap ($0.103).
2. **The writer's checks** (Task 2): only refs read as evidence; a number only when a cited card verified it; a sentence without a citation, or claiming another certainty level, dropped; at most four; withheld or failed answers are fixed notices; the certainty line is the computed baseline (`test_a_quick_answer_runs_the_engine_and_writes_the_short_answer`).
3. **What a quick answer skips** (Task 2): no external tools, citations, pools, conflict notes, narrative or card translation (`test_a_quick_answer_reads_without_external_tools_or_citations`, `test_a_quick_answer_skips_pools_and_conflict_explanations`), and a full review is unchanged (`test_a_full_review_reports_its_mode_and_no_quick_block`, the existing graph tests).
4. **Pins** (Task 2): `prompt_version` 2026-10-13.3, the quick pins, every other pin unchanged.
5. **Numbered refs** (Tasks 3, 4): renumbering by first citation in `quick_view` and `quickParts`, links from the existing builders (`_citation_parts`, `CitationText`), the ✓ only for a checked citation.
6. **MCP** (Task 3): `quick_answer` waits at most 90 s, returns the refusal unchanged, counts as one review.
7. **Form default and upgrade** (Task 5): quick is the default; a full review sends the same body as before; `?mode=full` restores the question, language, year and study types; the e2e suite stays green (`e2e/quick.spec.ts` and the three updated specs).

---

### Task 1: The quick mode as a request option, its limits in /status and MCP start_review

**Files:**
- Modify: `backend/app/schemas/review.py`
- Modify: `backend/app/services/review_service.py`
- Modify: `backend/app/mcp/server.py`
- Test (create): `backend/tests/unit/test_quick_mode.py`

**Interfaces:**
- Consumes: `ReviewOptions`, `ReviewService.status`, `review_cost_cap`, MCP `start_review`.
- Produces:
  - `app/schemas/review.py`: `ReviewMode = Literal["full", "quick"]`, `REVIEW_MODES = ("full", "quick")`, `QUICK_MAX_PAPERS = 8`, `QUICK_CANDIDATE_LIMIT = 30`, `QUICK_REVIEW_TYPE = "slr"`, `is_quick(options: dict | None) -> bool`; `ReviewOptions.mode: ReviewMode = "full"` with the `quick_sizes` before-validator; `ReviewOptions.clamped` maps a missing or unknown mode to `full`.
  - `/status` `limits.modes` and `limits.quick = {max_papers, candidate_limit, review_type}`.
  - MCP `start_review(..., mode="full")`; `_QUICK_PAPERS`, `_QUICK_POOL` in `app/mcp/server.py`; `START_REVIEW_DOC` describes `mode`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_quick_mode.py` (complete):

```python
"""Plan 27: the quick answer mode as a request option: fixed sizes, the cache key, the cost cap, /status and MCP."""
import json

import pytest
from fastmcp import Client

from app.config import Settings
from app.schemas.review import (
    QUICK_CANDIDATE_LIMIT,
    QUICK_MAX_PAPERS,
    REVIEW_MODES,
    CreateReviewRequest,
    ReviewOptions,
    compute_cache_key,
    is_quick,
)
from app.services.budget import review_cost_cap, worst_case_review_cap
from tests.unit.test_review_service import ANON, service


def data(result):
    return json.loads(result.content[0].text)


def test_the_quick_sizes_are_eight_of_thirty_and_full_is_the_default():
    assert (QUICK_MAX_PAPERS, QUICK_CANDIDATE_LIMIT) == (8, 30)
    assert REVIEW_MODES == ("full", "quick")
    assert ReviewOptions().mode == "full"
    assert ReviewOptions.bound("max_papers", "ge") <= QUICK_MAX_PAPERS <= ReviewOptions.bound("max_papers")
    assert ReviewOptions.bound("candidate_limit", "ge") <= QUICK_CANDIDATE_LIMIT <= ReviewOptions.bound("candidate_limit")


def test_a_quick_request_gets_the_fixed_sizes_and_a_graded_type_whatever_it_sends():
    o = ReviewOptions.model_validate({"mode": "quick", "max_papers": 50, "candidate_limit": 120,
                                      "review_type": "meta_analysis", "year_from": 2015, "study_types": ["rct"]})
    assert (o.mode, o.max_papers, o.candidate_limit, o.review_type) == ("quick", 8, 30, "slr")
    assert (o.year_from, o.study_types) == (2015, ["RCT"])  # the user's eligibility still applies


def test_a_full_request_keeps_what_it_sends():
    o = ReviewOptions.model_validate({"mode": "full", "max_papers": 12, "review_type": "scoping"})
    assert (o.mode, o.max_papers, o.candidate_limit, o.review_type) == ("full", 12, 120, "scoping")


def test_an_unknown_mode_is_rejected_by_rest_and_clamped_from_old_state():
    with pytest.raises(ValueError):
        ReviewOptions.model_validate({"mode": "instant"})
    assert ReviewOptions.clamped({"max_papers": 3}).mode == "full"  # graph state from before Plan 27
    assert ReviewOptions.clamped({"mode": "quick", "max_papers": 3}).max_papers == QUICK_MAX_PAPERS


def test_is_quick_reads_the_stored_options():
    assert is_quick({"mode": "quick"}) and not is_quick({"mode": "full"})
    assert not is_quick({}) and not is_quick(None)


def test_the_mode_is_part_of_the_cache_key():
    full = CreateReviewRequest(topic="statins and dementia").options.model_dump()
    quick = CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}).options.model_dump()
    assert full["mode"] == "full" and quick["mode"] == "quick"
    assert compute_cache_key("statins and dementia", "th", full, "v") != \
        compute_cache_key("statins and dementia", "th", quick, "v")


def test_the_quick_cost_cap_comes_from_the_same_formula_with_the_quick_sizes():
    s = Settings(_env_file=None)
    quick = review_cost_cap(s, ReviewOptions(mode="quick"))
    assert quick == pytest.approx(s.review_cost_base_usd + s.review_cost_per_paper_usd * QUICK_MAX_PAPERS
                                  + s.review_cost_per_candidate_usd * QUICK_CANDIDATE_LIMIT)
    assert quick == pytest.approx(0.103)
    assert quick < review_cost_cap(s, ReviewOptions()) < worst_case_review_cap(s)


async def test_a_quick_request_is_stored_with_its_mode_and_fixed_sizes(session_factory, redis):
    svc = service(session_factory, redis)
    created = await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}),
                               identity=ANON)
    review = await svc.get(created.review_id)
    assert review.options["mode"] == "quick"
    assert (review.options["max_papers"], review.options["candidate_limit"]) == (8, 30)


async def test_quick_and_full_answers_to_one_topic_are_separate_reviews(session_factory, redis):
    svc = service(session_factory, redis, review_rate_limit="10/minute")
    full = await svc.create(CreateReviewRequest(topic="statins and dementia"), identity=ANON)
    quick = await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}),
                             identity=ANON)
    again = await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}),
                             identity=ANON)
    assert quick.review_id != full.review_id and quick.cached is False
    assert again.cached is True and again.review_id == quick.review_id


async def test_a_quick_request_counts_against_the_same_hourly_limit(session_factory, redis):
    from app.services.review_service import RateLimited
    svc = service(session_factory, redis, review_rate_limit="1/minute")
    await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}), identity=ANON)
    with pytest.raises(RateLimited):
        await svc.create(CreateReviewRequest(topic="aspirin and stroke"), identity=ANON)


async def test_status_lists_the_modes_and_the_quick_sizes(client):
    limits = (await client.get("/api/v1/status")).json()["limits"]
    assert limits["modes"] == ["full", "quick"]
    assert limits["quick"] == {"max_papers": 8, "candidate_limit": 30, "review_type": "slr"}


async def test_rest_accepts_a_quick_request(client):
    res = await client.post("/api/v1/reviews", json={"topic": "statins and dementia", "options": {"mode": "quick"}})
    assert res.status_code == 202
    got = (await client.get(f"/api/v1/reviews/{res.json()['review_id']}")).json()
    assert got["options"]["mode"] == "quick" and got["options"]["max_papers"] == 8
    bad = await client.post("/api/v1/reviews", json={"topic": "statins and stroke", "options": {"mode": "fast"}})
    assert bad.status_code == 422


async def test_mcp_start_review_takes_the_mode(app, client):
    async with Client(app.state.mcp) as c:
        tool = next(t for t in await c.list_tools() if t.name == "start_review")
        quick = data(await c.call_tool("start_review", {"topic": "statins and dementia risk", "mode": "quick",
                                                        "max_papers": 40, "review_type": "scoping"}))
        full = data(await c.call_tool("start_review", {"topic": "aspirin and colorectal adenoma"}))
    assert tool.input_schema["properties"]["mode"]["enum"] == ["full", "quick"]
    assert "quick" in tool.description and str(QUICK_MAX_PAPERS) in tool.description
    q = (await client.get(f"/api/v1/reviews/{quick['review_id']}")).json()["options"]
    f = (await client.get(f"/api/v1/reviews/{full['review_id']}")).json()["options"]
    assert (q["mode"], q["max_papers"], q["review_type"]) == ("quick", 8, "slr")
    assert (f["mode"], f["max_papers"]) == ("full", 30)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_quick_mode.py -q`

Expected: collection fails: `ImportError: cannot import name 'QUICK_CANDIDATE_LIMIT' from 'app.schemas.review'` (1 error during collection).

- [ ] **Step 3: Implement**

**Edit** `backend/app/schemas/review.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
# PICO, conflicts, grading, PRISMA) unless a step says otherwise.
SLR_LIKE: frozenset[str] = frozenset({"slr", "meta_analysis"})

# Study designs the user can ask for (the scope form's step 3). Aliases map older or differently spelled values onto
```

   with

```python
# PICO, conflicts, grading, PRISMA) unless a step says otherwise.
SLR_LIKE: frozenset[str] = frozenset({"slr", "meta_analysis"})

# Plan 27: a quick answer ("ถามเร็ว") runs the same engine on a small pool and writes a 2-4 sentence answer instead of
# the report. Its sizes and review type are fixed by the service (what a caller sends for them is replaced); they are
# the single source for /status, the stub, the docs and the web form.
ReviewMode = Literal["full", "quick"]
REVIEW_MODES: tuple[str, ...] = ("full", "quick")
QUICK_MAX_PAPERS = 8
QUICK_CANDIDATE_LIMIT = 30
QUICK_REVIEW_TYPE = "slr"


def is_quick(options: dict[str, Any] | None) -> bool:
    """True for a quick answer (Plan 27); options stored before Plan 27 have no mode and are full reviews."""
    return (options or {}).get("mode") == "quick"

# Study designs the user can ask for (the scope form's step 3). Aliases map older or differently spelled values onto
```

2. Replace

```python
    year_from: int | None = Field(None, ge=1950, le=2100)
    study_types: list[str] = Field(default_factory=list, max_length=10)

    @classmethod
```

   with

```python
    year_from: int | None = Field(None, ge=1950, le=2100)
    study_types: list[str] = Field(default_factory=list, max_length=10)
    # Plan 27: "quick" = a short answer from QUICK_MAX_PAPERS of QUICK_CANDIDATE_LIMIT candidates; part of the cache key
    mode: ReviewMode = "full"

    @model_validator(mode="before")
    @classmethod
    def quick_sizes(cls, data: Any) -> Any:
        """A quick answer always screens QUICK_CANDIDATE_LIMIT candidates and reads QUICK_MAX_PAPERS as a graded
        systematic review: the review type and both sizes a caller sends are replaced, never rejected."""
        if isinstance(data, dict) and data.get("mode") == "quick":
            return {**data, "review_type": QUICK_REVIEW_TYPE, "max_papers": QUICK_MAX_PAPERS,
                    "candidate_limit": QUICK_CANDIDATE_LIMIT}
        return data

    @classmethod
```

3. Replace

```python
        if data.get("review_type") not in REVIEW_TYPES:
            data["review_type"] = "slr"  # missing/unknown (older state) never crashes a resumed review
        bounds = {name: (f.metadata) for name, f in cls.model_fields.items()}
        for name in ("max_papers", "candidate_limit"):
```

   with

```python
        if data.get("review_type") not in REVIEW_TYPES:
            data["review_type"] = "slr"  # missing/unknown (older state) never crashes a resumed review
        if data.get("mode") not in REVIEW_MODES:
            data["mode"] = "full"  # state from before Plan 27
        bounds = {name: (f.metadata) for name, f in cls.model_fields.items()}
        for name in ("max_papers", "candidate_limit"):
```

**Edit** `backend/app/services/review_service.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.logging import get_logger
from app.schemas.review import (
    REVIEW_TYPES,
    CreateReviewRequest,
```

   with

```python
from app.logging import get_logger
from app.schemas.review import (
    QUICK_CANDIDATE_LIMIT,
    QUICK_MAX_PAPERS,
    QUICK_REVIEW_TYPE,
    REVIEW_MODES,
    REVIEW_TYPES,
    CreateReviewRequest,
```

2. Replace

```python
                       "paper_search_rate_limit": s.paper_search_rate_limit,
                       "review_types": list(REVIEW_TYPES), "max_papers": bounds("max_papers"), "candidate_limit": bounds("candidate_limit"),
                       "max_queued_reviews": s.max_queued_reviews, "sse_max_per_ip": s.sse_max_per_ip},
        }

```

   with

```python
                       "paper_search_rate_limit": s.paper_search_rate_limit,
                       "review_types": list(REVIEW_TYPES), "max_papers": bounds("max_papers"), "candidate_limit": bounds("candidate_limit"),
                       "max_queued_reviews": s.max_queued_reviews, "sse_max_per_ip": s.sse_max_per_ip,
                       # Plan 27: the quick answer's fixed sizes; it shares the review rate limit and daily counters
                       "modes": list(REVIEW_MODES),
                       "quick": {"max_papers": QUICK_MAX_PAPERS, "candidate_limit": QUICK_CANDIDATE_LIMIT,
                                 "review_type": QUICK_REVIEW_TYPE}},
        }

```

**Edit** `backend/app/mcp/server.py` (5 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.config import Settings
from app.runtime import AppDeps
from app.schemas.review import CreateReviewRequest, ReviewOptions
from app.services.report import render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
```

   with

```python
from app.config import Settings
from app.runtime import AppDeps
from app.schemas.review import (
    QUICK_CANDIDATE_LIMIT,
    QUICK_MAX_PAPERS,
    CreateReviewRequest,
    ReviewOptions,
)
from app.services.report import render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
```

2. Replace

```python
_DEFAULT_PAPERS = ReviewOptions.model_fields["max_papers"].default
_POOL = ReviewOptions.model_fields["candidate_limit"].default

INSTRUCTIONS = f"""Medical literature review agent (abstracts only). It turns a topic or question into a structured
```

   with

```python
_DEFAULT_PAPERS = ReviewOptions.model_fields["max_papers"].default
_POOL = ReviewOptions.model_fields["candidate_limit"].default
_QUICK_PAPERS, _QUICK_POOL = QUICK_MAX_PAPERS, QUICK_CANDIDATE_LIMIT

INSTRUCTIONS = f"""Medical literature review agent (abstracts only). It turns a topic or question into a structured
```

3. Replace

```python
- "meta_analysis": a systematic review plus DerSimonian-Laird random-effects pools of the verified effect
  estimates (result.meta_analysis); pooled numbers are computed by the system, not reported by any study.
`study_types` (optional) limits the designs: RCT, Cohort, Case-control, Cross-sectional, Non-randomized trial,
Qualitative, Mixed methods (qualitative/mixed are summarised as themes, never with numbers), Systematic
```

   with

```python
- "meta_analysis": a systematic review plus DerSimonian-Laird random-effects pools of the verified effect
  estimates (result.meta_analysis); pooled numbers are computed by the system, not reported by any study.
`mode` "quick" (Plan 27) asks for a quick answer instead: about {_QUICK_POOL} candidates, the {_QUICK_PAPERS} most relevant
read, and a 2-4 sentence answer with numbered references (result.mode "quick"); review_type and max_papers are then
set by the service. "full" (default) is the review described above.
`study_types` (optional) limits the designs: RCT, Cohort, Case-control, Cross-sectional, Non-randomized trial,
Qualitative, Mixed methods (qualitative/mixed are summarised as themes, never with numbers), Systematic
```

4. Replace

```python
                           max_papers: int = _DEFAULT_PAPERS,
                           review_type: Literal["narrative", "slr", "scoping", "meta_analysis"] = "slr",
                           study_types: list[str] | None = None, year_from: int | None = None
                           ) -> dict[str, Any]:
        try:
            req = CreateReviewRequest(topic=topic, language=language,
```

   with

```python
                           max_papers: int = _DEFAULT_PAPERS,
                           review_type: Literal["narrative", "slr", "scoping", "meta_analysis"] = "slr",
                           study_types: list[str] | None = None, year_from: int | None = None,
                           mode: Literal["full", "quick"] = "full") -> dict[str, Any]:
        try:
            req = CreateReviewRequest(topic=topic, language=language,
```

5. Replace

```python
                                                                             "review_type": review_type,
                                                                             "study_types": study_types or [],
                                                                             "year_from": year_from}))
            created = await get_deps().service.create(req, identity=await identity(ctx), human_check=False)
        except Refused as exc:  # Plan 26: an emergency gets the hotlines, not a review
```

   with

```python
                                                                             "review_type": review_type,
                                                                             "study_types": study_types or [],
                                                                             "year_from": year_from, "mode": mode}))
            created = await get_deps().service.create(req, identity=await identity(ctx), human_check=False)
        except Refused as exc:  # Plan 26: an emergency gets the hotlines, not a review
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_quick_mode.py -q`

Expected: 13 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-27/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2506 passed, 17 skipped (pre-flight).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(quick): the quick answer mode as a request option with fixed sizes, its limits in /status and MCP (Plan 27)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-27 && git add backend/tests/unit/test_quick_mode.py backend/app/schemas/review.py backend/app/services/review_service.py backend/app/mcp/server.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 2: The quick writer, its route through the graph and prompt_version

**Files:**
- Modify: `backend/app/graph/schemas.py`
- Modify: `backend/app/graph/prompts.py`
- Modify: `backend/app/graph/nodes/synthesis.py`
- Modify: `backend/app/graph/nodes/screening.py`
- Create: `backend/app/graph/nodes/quick.py`
- Modify: `backend/app/graph/graph.py`
- Modify: `backend/app/config.py`
- Test (create): `backend/tests/unit/test_quick_answer.py`
- Test (modify): `backend/tests/unit/test_prompts_by_type.py`

**Interfaces:**
- Consumes: `is_quick` (Task 1); the synthesis helpers and the prose, citation and support checks listed above.
- Produces:
  - `QuickAnswerDraft(sentences: list[str], limits: str)` (`app/graph/schemas.py`); `QUICK_SYSTEM`, `quick_user(*, question, papers, baseline)` (`app/graph/prompts.py`, pinned).
  - `app/graph/nodes/quick.py`: `MIN_SENTENCES, MAX_SENTENCES = 2, 4`, `MAX_REPAIRS = 1`, `QUICK_WITHHELD`, `QUICK_FAILED`, `NOT_GRADED`, `draft_problems(draft, allowed, prose) -> list[str]`, `checked_answer(draft, allowed, prose, strength) -> (answer, kept, removed)`, `closing_line(limits, prose, strength) -> str`, `make_write_quick_answer(deps)` (node `write_quick_answer`).
  - `app/graph/nodes/synthesis.py`: `empty_messages(state)` (shared with `write_synthesis`), `route_after_normalize` → `"write_quick_answer"` for a quick answer, `quick_refs(summary) -> list[str]`, `result.mode` and `result.quick = {refs, papers_read}` in `finalize`.
  - `route_to_reading` sends no `external_enrich` or `fetch_citations` for a quick answer.
  - `Settings.prompt_version == "2026-10-13.3"`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_quick_answer.py` (complete):

```python
"""Plan 27: the quick answer's writer, its checks and its path through the review graph (fake LLMs only)."""
from app.graph import prompts
from app.graph.nodes.quick import (
    NOT_GRADED,
    QUICK_FAILED,
    QUICK_WITHHELD,
    checked_answer,
    closing_line,
    draft_problems,
)
from app.graph.nodes.screening import route_to_reading
from app.graph.nodes.synthesis import ANSWER_CERTAINTY, NO_PAPERS, quick_refs, route_after_normalize
from app.graph.schemas import QuickAnswerDraft, SupportBatch
from app.harness.prose import prose_context
from app.services.llm import LLMOutputError
from tests.fakes import FakeStructuredLLM, bind_by_role, to_thai
from tests.unit.test_review_graph import card, eval_match_none, make_deps, run, support_judge

QUICK = {"mode": "quick"}
GOOD = QuickAnswerDraft(
    sentences=[("Metformin is associated with a lower risk of colorectal cancer in adults with type 2 diabetes "
                "[P1, P2]."), "Three cohorts reported the opposite direction [P4]."],
    limits="All studies were observational cohorts, so confounding may remain.")


def papers(n=3):
    return [{"ref": f"P{i}", "candidate": {"title": f"Paper {i}", "year": 2020}, "card": card().model_dump()}
            for i in range(1, n + 1)]


def ctx():
    return prose_context(papers())


def quick_deps(writer=None, **kw):
    """make_deps with the synthesizer bound to QuickAnswerDraft answering `writer` (GOOD by default)."""
    deps = make_deps(**kw)
    from app.evals.run import OutcomeMatch
    writer = writer or FakeStructuredLLM("syn:quick", lambda s, u: GOOD)
    deps.llms.for_schema = bind_by_role(deps.llms, {QuickAnswerDraft: lambda role: writer,
                                                    OutcomeMatch: eval_match_none, SupportBatch: support_judge})
    return deps, writer


# ---- the checks -----------------------------------------------------------------------------------------------------
def test_a_good_draft_has_no_problems():
    assert draft_problems(GOOD, {"P1", "P2", "P4"}, ctx()) == []


def test_two_to_four_sentences_each_citing_a_paper_read():
    one = QuickAnswerDraft(sentences=["Metformin is associated with lower risk [P1]."], limits="Few studies.")
    five = QuickAnswerDraft(sentences=[f"Finding {i} [P1]." for i in range(5)], limits="Few studies.")
    uncited = QuickAnswerDraft(sentences=["Metformin is associated with lower risk [P1].", "Results agree."],
                               limits="Few studies.")
    unknown = QuickAnswerDraft(sentences=["Lower risk [P1].", "Same in [P9]."], limits="Few studies.")
    assert any("2-4 sentences" in p for p in draft_problems(one, {"P1"}, ctx()))
    assert any("2-4 sentences" in p for p in draft_problems(five, {"P1"}, ctx()))
    assert any("sentences[1] cites no paper" in p for p in draft_problems(uncited, {"P1"}, ctx()))
    assert "unknown citation P9" in draft_problems(unknown, {"P1"}, ctx())


def test_a_number_must_be_on_a_cited_card_and_limits_carry_no_citation_or_number():
    verified = QuickAnswerDraft(sentences=["Risk was lower (HR 0.80) [P1].", "Cohorts agree [P2]."], limits="Few.")
    invented = QuickAnswerDraft(sentences=["Risk fell by 45% [P1].", "Cohorts agree [P2]."], limits="Few.")
    limits = QuickAnswerDraft(sentences=["Lower risk [P1].", "Cohorts agree [P2]."],
                              limits="Only 3 cohorts were found [P1].")
    assert draft_problems(verified, {"P1", "P2"}, ctx()) == []
    assert any("45" in p and "not a verified number" in p for p in draft_problems(invented, {"P1", "P2"}, ctx()))
    problems = draft_problems(limits, {"P1", "P2"}, ctx())
    assert "limits must not cite papers" in problems


def test_checked_answer_keeps_what_the_cards_support_and_drops_the_rest():
    draft = QuickAnswerDraft(sentences=["Risk was lower (HR 0.80) [P1, P9].", "Risk fell by 45% [P2].",
                                        "Results agree.", "Cohorts agree [P2].", "Similar [P3].", "Again [P1]."],
                             limits="x")
    answer, kept, removed = checked_answer(draft, {"P1", "P2", "P3"}, ctx(), "low")
    assert answer == "Risk was lower (HR 0.80) [P1]. Cohorts agree [P2]. Similar [P3]. Again [P1]."
    assert (kept, removed) == (4, 2)  # the invented 45% and the uncited sentence; at most four kept


def test_checked_answer_drops_a_claim_of_another_certainty_level():
    draft = QuickAnswerDraft(sentences=["The certainty of the evidence is high [P1].", "Cohorts agree [P2]."],
                             limits="x")
    assert checked_answer(draft, {"P1", "P2"}, ctx(), "low")[0] == "Cohorts agree [P2]."


def test_the_closing_line_is_the_computed_certainty_then_the_limits_sentence():
    assert closing_line("All studies were observational. More text.", ctx(), "low") == \
        f"{ANSWER_CERTAINTY['low']} All studies were observational."
    assert closing_line("Only 45 patients [P1].", ctx(), "very_low") == ANSWER_CERTAINTY["very_low"]
    assert closing_line("Themes came from small samples.", ctx(), None) == \
        f"{NOT_GRADED} Themes came from small samples."


def test_quick_refs_number_the_papers_in_order_of_first_citation():
    assert quick_refs("A [P3]. B [P1, P3]. C [P2].") == ["P3", "P1", "P2"]
    assert quick_refs("") == [] and quick_refs(None) == []


def test_the_quick_prompt_names_the_rules():
    for phrase in ("2-4 short", "[P1, P3]", "limits", "never a causal verb", "no doses", "matches_question false"):
        assert phrase in prompts.QUICK_SYSTEM
    user = prompts.quick_user(question="Q?", papers=[{"ref": "P1"}], baseline={"level": "low", "factors": ["f"]})
    assert "low (f)" in user and prompts.DATA_NOTICE in user and '"ref": "P1"' in user
    assert "not graded" in prompts.quick_user(question="Q?", papers=[], baseline=None)


# ---- the routes -----------------------------------------------------------------------------------------------------
def test_a_quick_answer_skips_pools_and_conflict_explanations():
    conflicted = {"options": QUICK, "matrix": {"conflicts": [{"outcome": "o", "refs": ["P1", "P2"]}]}}
    assert route_after_normalize(conflicted) == "write_quick_answer"
    assert route_after_normalize({"options": {"mode": "quick", "review_type": "meta_analysis"}}) == \
        "write_quick_answer"
    assert route_after_normalize({"options": {}, "matrix": {}}) == "write_synthesis"


def test_a_quick_answer_reads_without_external_tools_or_citations():
    selected = [{"ref": "P1", "candidate": {"title": "t"}}]
    on = lambda: True
    quick = route_to_reading({"topic": "t", "options": QUICK, "selected": selected}, external_enabled=on, citations_enabled=on,
                             thaijo_enabled=on)
    full = route_to_reading({"topic": "t", "options": {}, "selected": selected}, external_enabled=on, citations_enabled=on,
                            thaijo_enabled=on)
    assert [s.node for s in quick] == ["read_paper"]
    assert [s.node for s in full] == ["read_paper", "external_enrich", "fetch_citations"]


# ---- the whole graph ------------------------------------------------------------------------------------------------
async def test_a_quick_answer_runs_the_engine_and_writes_the_short_answer():
    deps, writer = quick_deps()
    values, events = await run(deps, options=QUICK)
    r = values["result"]
    en = r["synthesis_en"]
    assert r["mode"] == "quick" and r["review_type"] == "slr"
    assert len(r["papers"]) == 8 and r["stats"]["selected"] == 8  # QUICK_MAX_PAPERS of the pool
    assert en["executive_summary"] == " ".join(GOOD.sentences)
    level = en["evidence_strength"]
    assert level == en["grade_baseline"] == values["matrix"]["grade"]["level"]  # computed, never the model's
    assert en["answer"] == f"{ANSWER_CERTAINTY[level]} {GOOD.limits}"
    assert en["comparison"] == en["consensus"] == en["conflicts"] == en["key_findings"] == []
    assert r["quick"] == {"refs": ["P1", "P2", "P4"], "papers_read": 8}
    assert r["summary"] == to_thai(en["executive_summary"])  # localized last, [Pn] kept
    assert r["synthesis"]["answer"] == to_thai(en["answer"])
    assert len(writer.calls) == 1 and writer.calls[0][0] == prompts.QUICK_SYSTEM
    assert not deps.llms.synthesizer.calls and not deps.llms.conflict_explainer.calls  # no narrative, no conflicts
    assert r["papers"][0]["card"]["population"] == "adults with type 2 diabetes"  # cards are not localized
    assert r["support"]["markers"] == [["P1", "P2"], ["P4"]]  # Plan 25 checks the quick answer too
    stages = {q.get("stage") for q in values["quality"]}
    assert "quick" in stages and "narrative" not in stages and "conflict" not in stages
    assert {e.get("type") for e in events} >= {"screened", "synthesizing", "finalizing"}


async def test_a_full_review_reports_its_mode_and_no_quick_block():
    deps, writer = quick_deps()
    values, _events = await run(deps)
    assert values["result"]["mode"] == "full" and values["result"]["quick"] is None
    assert not writer.calls and deps.llms.synthesizer.calls


async def test_an_english_quick_answer_is_not_translated():
    deps, _writer = quick_deps()
    values, _events = await run(deps, options=QUICK, language="en")
    assert values["result"]["summary"] == " ".join(GOOD.sentences)
    assert not deps.llms.localizer.calls


async def test_a_writer_failure_still_finishes_with_a_fixed_message():
    def broken(system, user):
        raise LLMOutputError("not JSON")
    deps, _writer = quick_deps(writer=FakeStructuredLLM("syn:quick", broken))
    values, _events = await run(deps, options=QUICK, language="en")
    en = values["result"]["synthesis_en"]
    assert en["executive_summary"] == QUICK_FAILED and en["answer"] == ANSWER_CERTAINTY[en["evidence_strength"]]
    assert values["result"]["quick"]["refs"] == []


async def test_a_draft_with_nothing_verifiable_is_withheld():
    bad = QuickAnswerDraft(sentences=["Risk fell by 45% [P1].", "Risk fell by 46% [P2]."], limits="Few.")
    deps, writer = quick_deps(writer=FakeStructuredLLM("syn:quick", lambda s, u: bad))
    values, _events = await run(deps, options=QUICK, language="en")
    assert values["result"]["summary"] == QUICK_WITHHELD
    assert len(writer.calls) == 2  # one repair round at most
    assert any(q.get("stage") == "quick" and q["withheld"] for q in values["quality"])


async def test_no_papers_gives_the_no_papers_message_without_a_writer_call():
    deps, writer = quick_deps(results=[])
    values, _events = await run(deps, options=QUICK, language="en")
    assert values["result"]["summary"] == NO_PAPERS["en"] and not writer.calls
```

**Edit** `backend/tests/unit/test_prompts_by_type.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    # adds the sentence-support judge's own prompt and schema (pinned in test_support_prompts_are_pinned); no prompt
    # above changed. 2026-10-13.2 (Plan 26) changes only the topic guard's prompt and schema (the personal_medical
    # category, pinned in test_guard_prompt_is_pinned); no prompt above changed.
    "narrative_system": (prompts.narrative_system, "16278465ee36d386eede4011a039ce7adf15588592669958c92883bcc06b3b7d"),
}
```

   with

```python
    # adds the sentence-support judge's own prompt and schema (pinned in test_support_prompts_are_pinned); no prompt
    # above changed. 2026-10-13.2 (Plan 26) changes only the topic guard's prompt and schema (the personal_medical
    # category, pinned in test_guard_prompt_is_pinned); no prompt above changed. 2026-10-13.3 (Plan 27) adds the quick
    # answer's own prompt and schema (pinned in test_quick_prompts_are_pinned); no prompt above changed.
    "narrative_system": (prompts.narrative_system, "16278465ee36d386eede4011a039ce7adf15588592669958c92883bcc06b3b7d"),
}
```

2. Replace

```python
    assert sha(prompts.GUARD_SYSTEM) == "e38d8f7ce0a198a65d069a7e017157d7c347fa72d529841c8f5c5b89e0c8462e"
    assert sha(prompts.guard_user("t")) == "92fffe5f4585c3344799ba8b4f42b8ef991f5f3decab4b1e88b0920b1fd6c4a6"


```

   with

```python
    assert sha(prompts.GUARD_SYSTEM) == "e38d8f7ce0a198a65d069a7e017157d7c347fa72d529841c8f5c5b89e0c8462e"
    assert sha(prompts.guard_user("t")) == "92fffe5f4585c3344799ba8b4f42b8ef991f5f3decab4b1e88b0920b1fd6c4a6"


def test_quick_prompts_are_pinned():
    # Plan 27 (prompt_version 2026-10-13.3): the quick answer's writer (QuickAnswerDraft), graded or not
    assert sha(prompts.QUICK_SYSTEM) == "48c261ae9c36a403ec676ada9776e54872b442dd5df9072cfab555c10e4b7223"
    graded = prompts.quick_user(question="Q?", papers=[{"ref": "P1"}], baseline={"level": "low", "factors": ["f"]})
    assert sha(graded) == "29e4c61de9c7bb940418d283312155c4a2f8ae3b243ca56000df8f6a27cd9cd1"
    ungraded = prompts.quick_user(question="Q?", papers=[], baseline=None)
    assert sha(ungraded) == "cdcc90e46b035f3af33aa0f2d2836230f4f0c31c980c2a7747287fc3ca70500d"


```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_quick_answer.py tests/unit/test_prompts_by_type.py -q`

Expected: collection fails: `ModuleNotFoundError: No module named 'app.graph.nodes.quick'` (1 error during collection).

- [ ] **Step 3: Implement**

**Edit** `backend/app/graph/schemas.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


class TranslationItem(BaseModel):
    id: str
```

   with

```python


class QuickAnswerDraft(BaseModel):
    """Plan 27: the quick answer as the model writes it: 2-4 English sentences, each citing the papers that support it
    ([P1] or [P1, P3]), and one sentence on the main limitation of the evidence (no citation, no number). Code checks
    both and adds the certainty sentence (the GRADE-lite baseline, never the model's)."""
    sentences: list[str]
    limits: str


class TranslationItem(BaseModel):
    id: str
```

**Edit** `backend/app/graph/prompts.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


SUPPORT_SYSTEM = """You check whether sentences of a medical literature review are supported by the abstract of the
paper they cite. Each item gives a claim (one sentence of the review), the paper it cites (its [Pn] in the claim)
```

   with

```python


QUICK_SYSTEM = """You write a quick answer to a health question from the cards of a few studies whose abstracts were
read and checked already. Readers include the public and clinicians at the bedside; the answer is shown with numbered
references to the cited studies.
- sentences: 2-4 short, plain English sentences that answer the question directly: what the studies found, in whom,
  and whether they agree. Each sentence ends with the papers that support it, like [P2] or [P1, P3]; cite only refs
  that appear in the evidence, and only for what that paper's card says.
- limits: one plain English sentence on the main limitation of this evidence (for example few or small studies,
  observational designs, short follow-up, a population unlike the question's, or results from abstracts only). No
  [Pn] citations and no numbers.
- Numbers: state only numbers shown on the cited cards, exactly as given, with the card's effect_measure; never
  compute, convert, round or combine numbers. Leave a number out when unsure.
- Populations: describe each cited paper's population exactly as its card states.
- Certainty wording (GRADE): word the conclusions to match the certainty given with the evidence. high: "reduces";
  moderate: "probably reduces"; low: "may reduce"; very_low: "the evidence is very uncertain about ...". For
  observational evidence say "is associated with", never a causal verb. Do not state the certainty level itself: it
  is added after your answer.
- Never give advice to a person: no doses, no instructions to start, stop or change a treatment.
- Card outcomes with matches_question false compare something else; they are never evidence for the question.
Use only the information given; never invent papers, numbers or citations."""


def quick_user(*, question: str, papers: list[dict[str, Any]], baseline: dict[str, Any] | None) -> str:
    """Plan 27: the quick writer's evidence: the cards of the papers read (no matrix, conflicts or pools) and the
    certainty computed in code (null when the papers are not graded, e.g. qualitative studies only)."""
    level = (baseline or {}).get("level")
    certainty = (f"{level} ({'; '.join((baseline or {}).get('factors', []))})" if level
                 else "not graded (no quantitative studies; report themes, not effects)")
    return (f"{DATA_NOTICE}\n<evidence>\n{json.dumps({'papers': papers}, ensure_ascii=False)}\n</evidence>\n\n"
            f"Question: {question}\nCertainty of the evidence (computed): {certainty}\n\n"
            "Checklist before answering:\n- 2-4 sentences, each ending with its [Pn] citations from the evidence\n"
            "- limits is one sentence without citations or numbers\n"
            "- numbers only as written on the cited cards; all text is in English")


SUPPORT_SYSTEM = """You check whether sentences of a medical literature review are supported by the abstract of the
paper they cite. Each item gives a claim (one sentence of the review), the paper it cites (its [Pn] in the claim)
```

**Edit** `backend/app/graph/nodes/synthesis.py` (6 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.harness.trials import related_reports
from app.harness.verify import check_citations, strip_unknown_citations
from app.schemas.review import NON_QUANTITATIVE_TYPES, SLR_LIKE, ReviewOptions
from app.services.llm import LLMError

```

   with

```python
from app.harness.trials import related_reports
from app.harness.verify import check_citations, strip_unknown_citations
from app.schemas.review import NON_QUANTITATIVE_TYPES, SLR_LIKE, ReviewOptions, is_quick
from app.services.llm import LLMError

```

2. Replace

```python


def _not_graded_rationale(review_type: str) -> str:
    return f"Certainty of evidence is not graded in a {'scoping' if review_type == 'scoping' else 'narrative'} review."
```

   with

```python


def empty_messages(state: ReviewState) -> dict[str, str]:
    """Why there are no papers to write from ({"th", "en"}): every card outside the ticked study types, every read
    failed, screening failed, or nothing relevant was found (write_synthesis and Plan 27's write_quick_answer)."""
    if design_excluded(state):  # every card read as a design outside the ticked study types
        return NO_PAPERS
    if state.get("selected"):
        return EXTRACTION_FAILED
    if state.get("candidates") and any(e.startswith("screening batch failed") for e in state.get("errors") or []):
        return SCREENING_FAILED
    return NO_PAPERS


def _not_graded_rationale(review_type: str) -> str:
    return f"Certainty of evidence is not graded in a {'scoping' if review_type == 'scoping' else 'narrative'} review."
```

3. Replace

```python
# ---- S2b: pooled effects (meta-analysis only) ----------------------------------------------------
def route_after_normalize(state: ReviewState) -> list[Send] | str:
    """Meta-analysis goes through pool_effects; every other type keeps its path unchanged."""
    if _review_type(state) == "meta_analysis":
        return "pool_effects"
```

   with

```python
# ---- S2b: pooled effects (meta-analysis only) ----------------------------------------------------
def route_after_normalize(state: ReviewState) -> list[Send] | str:
    """Meta-analysis goes through pool_effects; a quick answer (Plan 27) goes straight to its writer (no pools, no
    conflict explanations); every other type keeps its path unchanged."""
    if is_quick(state.get("options")):
        return "write_quick_answer"
    if _review_type(state) == "meta_analysis":
        return "pool_effects"
```

4. Replace

```python
        papers = _narrative_papers(state)
        if not papers:
            if design_excluded(state):  # every card read as a design outside the ticked study types
                messages = NO_PAPERS
            elif state.get("selected"):
                messages = EXTRACTION_FAILED
            elif state.get("candidates") and any(e.startswith("screening batch failed")
                                                 for e in state.get("errors") or []):
                messages = SCREENING_FAILED
            else:
                messages = NO_PAPERS
            english = _empty_synthesis(messages["en"], review_type)
            display = _empty_synthesis(messages.get(language, messages["en"]), review_type)
```

   with

```python
        papers = _narrative_papers(state)
        if not papers:
            messages = empty_messages(state)
            english = _empty_synthesis(messages["en"], review_type)
            display = _empty_synthesis(messages.get(language, messages["en"]), review_type)
```

5. Replace

```python


def _iso(epoch: Any) -> str | None:
    if not isinstance(epoch, int | float):
```

   with

```python


def quick_refs(summary: str | None) -> list[str]:
    """Plan 27: the refs a quick answer cites, in the order they first appear in its English text: reference [k] of
    the answer is quick_refs[k - 1] (the translation keeps the [Pn] groups)."""
    out: list[str] = []
    for group in support_markers(summary):
        out += [ref for ref in group if ref not in out]
    return out


def _quick_result(state: ReviewState, synthesis_en: dict[str, Any]) -> dict[str, Any] | None:
    """result.quick (Plan 27): null for a full review."""
    if not is_quick(state.get("options")):
        return None
    # papers_read: the evidence the answer was written from (not-evidence papers stay in `papers`, uncounted)
    return {"refs": quick_refs(synthesis_en.get("executive_summary")), "papers_read": len(_narrative_papers(state))}


def _iso(epoch: Any) -> str | None:
    if not isinstance(epoch, int | float):
```

6. Replace

```python
            "topic": state["topic"], "english_topic": state.get("english_topic"), "language": language,
            "review_type": ReviewOptions.clamped(state.get("options")).review_type,
            "question": _question_block(state),
            "summary": synthesis["executive_summary"], "synthesis": synthesis, "synthesis_en": synthesis_en,
```

   with

```python
            "topic": state["topic"], "english_topic": state.get("english_topic"), "language": language,
            "review_type": ReviewOptions.clamped(state.get("options")).review_type,
            # Plan 27: "quick" = a short answer (summary) with numbered references (quick.refs), not a full report
            "mode": ReviewOptions.clamped(state.get("options")).mode,
            "quick": _quick_result(state, synthesis_en),
            "question": _question_block(state),
            "summary": synthesis["executive_summary"], "synthesis": synthesis, "synthesis_en": synthesis_en,
```

**Edit** `backend/app/graph/nodes/screening.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.harness.comparison import intervention_lexicon
from app.harness.study_types import allowed_designs, canonical_types, design_allowed
from app.schemas.review import NON_QUANTITATIVE_TYPES, SLR_LIKE, ReviewOptions, wants_qualitative
from app.services.llm import LLMError

```

   with

```python
from app.harness.comparison import intervention_lexicon
from app.harness.study_types import allowed_designs, canonical_types, design_allowed
from app.schemas.review import (
    NON_QUANTITATIVE_TYPES,
    SLR_LIKE,
    ReviewOptions,
    is_quick,
    wants_qualitative,
)
from app.services.llm import LLMError

```

2. Replace

```python
              "qualitative": wants_qualitative(state.get("options"))}
    sends = [Send("read_paper", {"paper": s, **common}) for s in selected]
    if external_enabled is not None and external_enabled():
        sends.append(Send("external_enrich", {"question": common["question"], "plan": common["plan"]}))
    if citations_enabled is not None and citations_enabled():
        sends.append(Send("fetch_citations", {"papers": [{"ref": s["ref"], "candidate": s.get("candidate") or {}}
                                                          for s in selected]}))
```

   with

```python
              "qualitative": wants_qualitative(state.get("options"))}
    sends = [Send("read_paper", {"paper": s, **common}) for s in selected]
    quick = is_quick(state.get("options"))  # Plan 27: a quick answer consults no external tool and fetches no citations
    if not quick and external_enabled is not None and external_enabled():
        sends.append(Send("external_enrich", {"question": common["question"], "plan": common["plan"]}))
    if not quick and citations_enabled is not None and citations_enabled():
        sends.append(Send("fetch_citations", {"papers": [{"ref": s["ref"], "candidate": s.get("candidate") or {}}
                                                          for s in selected]}))
```

**New file** `backend/app/graph/nodes/quick.py` (complete):

```python
"""Plan 27: the quick answer ("ถามเร็ว"). For mode "quick" it takes the place of explain_conflict and
write_synthesis: one call writes 2-4 English sentences that cite only the papers read, plus one sentence on the main
limitation; code checks the citations, the numbers and the populations (app.harness.prose: a number stays only when a
cited card verified it), and adds the certainty sentence of the GRADE-lite baseline (computed in code, never by the
model). The answer is stored in the Synthesis shape (`executive_summary` = the answer, `answer` = the closing
certainty-and-limits line), so localize, check_support and finalize run unchanged."""
from __future__ import annotations

import logging
import time
from typing import Any

from app.graph import prompts
from app.graph.nodes.intake import harness_spec, review_question
from app.graph.nodes.synthesis import (
    _CITE_GROUP,
    _CITED,
    ANSWER_CERTAINTY,
    NO_QUANTITATIVE_RATIONALE,
    _brief,
    _direction_papers,
    _drop_wrong_self_claims,
    _empty_synthesis,
    _narrative_papers,
    _prose_context,
    _review_type,
    _split_sentences,
    empty_messages,
)
from app.graph.schemas import QuickAnswerDraft, Synthesis
from app.graph.state import ReviewState
from app.harness.prose import (
    ProseContext,
    fix_prose,
    fix_statement,
    prose_problems,
    statement_problems,
)
from app.harness.runner import HarnessRunner
from app.harness.verify import check_citations, strip_unknown_citations
from app.services.llm import LLMError

log = logging.getLogger(__name__)

MIN_SENTENCES, MAX_SENTENCES = 2, 4
MAX_REPAIRS = 1  # latency: one repair round at most, no escalation; code removes what still fails
QUICK_WITHHELD = ("No short answer could be written that the verified abstracts support. The studies read are listed "
                  "below; a full review may help.")
QUICK_FAILED = ("The quick answer could not be written (a temporary model or service problem). The studies read are "
                "listed below; please try again later.")
NOT_GRADED = "The certainty of the evidence is not graded: the studies read report themes, not effects."


def draft_problems(draft: QuickAnswerDraft, allowed: set[str], prose: ProseContext) -> list[str]:
    """Repair messages for a quick answer draft: 2-4 sentences, each citing a paper read; no unknown citation; no
    number, measure or population the cited cards do not support; a limits sentence without citations or numbers."""
    sentences = [s.strip() for s in draft.sentences if s.strip()]
    problems: list[str] = []
    if not MIN_SENTENCES <= len(sentences) <= MAX_SENTENCES:
        problems.append(f"sentences: write {MIN_SENTENCES}-{MAX_SENTENCES} sentences (got {len(sentences)})")
    problems += check_citations(" ".join(sentences), allowed)
    for i, s in enumerate(sentences):
        if not _CITED.search(s):
            problems.append(f"sentences[{i}] cites no paper; end it with the refs that support it, e.g. [P1]")
        problems += prose_problems(s, prose, f"sentences[{i}]", fixable=False)
    if _CITED.search(draft.limits or ""):
        problems.append("limits must not cite papers")
    problems += statement_problems(draft.limits or "", prose, "limits")
    return problems


def checked_answer(draft: QuickAnswerDraft, allowed: set[str], prose: ProseContext,
                   strength: str | None) -> tuple[str, int, int]:
    """The shown answer, item by item: unknown citations stripped, measure names corrected, every sentence with an
    untraceable number or population removed (fix_prose), a self-claim of another certainty level for this review
    removed; an item left without a citation is dropped; at most MAX_SENTENCES items. Returns (answer, items kept,
    items removed)."""
    kept: list[str] = []
    removed = 0
    for raw in draft.sentences:
        text = strip_unknown_citations(raw.strip(), allowed)
        if not text:
            continue
        fixed, _counts = fix_prose(text, prose)
        # a claim of another certainty level (or a wrong-level label) for this review takes its item with it; the
        # patterns read the text without its [Pn] groups
        wrong_level = _drop_wrong_self_claims(_CITE_GROUP.sub("", fixed), strength)[1] > 0
        if fixed.strip() and _CITED.search(fixed) and not wrong_level:
            kept.append(fixed.strip())
        else:
            removed += 1
    removed += max(0, len(kept) - MAX_SENTENCES)
    kept = kept[:MAX_SENTENCES]
    return " ".join(kept), len(kept), removed


def closing_line(limits: str, prose: ProseContext, strength: str | None) -> str:
    """The certainty sentence (the GRADE-lite baseline, or "not graded") and the model's limits sentence when it
    passes the numberless check (its first sentence, without citations)."""
    text, _counts = fix_statement(_CITE_GROUP.sub("", limits or "").strip(), prose)
    text, _n = _drop_wrong_self_claims(text, strength)
    first = next(iter(_split_sentences(text)), "")
    certainty = ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
    return f"{certainty} {first}".strip()


def make_write_quick_answer(deps):
    async def write_quick_answer(state: ReviewState) -> dict:
        started = time.perf_counter()
        language = state.get("language", "th")
        papers = _narrative_papers(state)
        if not papers:
            messages = empty_messages(state)
            return {"synthesis": _empty_synthesis(messages["en"]),
                    "synthesis_display": _empty_synthesis(messages.get(language, messages["en"])),
                    "localized_cards": None, "quality": [{"stage": "quick", "skipped": True, "seconds": 0.0}]}
        matrix = state.get("matrix") or {}
        grade = matrix.get("grade") or {}
        graded = bool(_direction_papers(state))  # qualitative/mixed-methods only: themes, not graded
        baseline = grade.get("level", "very_low")
        strength = baseline if graded else None
        allowed = {p["ref"] for p in papers}
        prose = _prose_context(state, papers, matrix, None)
        user = prompts.quick_user(question=review_question(state), papers=[_brief(p) for p in papers],
                                  baseline=grade if graded else None)
        llm = deps.llms.with_schema("synthesizer", QuickAnswerDraft)
        runner = HarnessRunner(max_repairs=min(MAX_REPAIRS, harness_spec(deps).max_repairs))
        entry: dict[str, Any] = {"stage": "quick", "repaired": False, "fallback": False, "sentences": 0,
                                 "removed": 0, "withheld": False}
        cost, errors = 0.0, []
        try:
            res = await runner.call(llm, prompts.QUICK_SYSTEM, user, schema=QuickAnswerDraft,
                                    validate=lambda d: draft_problems(d, allowed, prose), trigger="quick")
            cost, draft = res.cost, res.value
            entry["repaired"] = res.repaired
        except LLMError as exc:
            errors.append(f"quick answer failed: {type(exc).__name__}: {exc}")
            draft = None
        if draft is None:
            entry["fallback"] = True
            answer, closing = QUICK_FAILED, ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
        else:
            try:
                answer, entry["sentences"], entry["removed"] = checked_answer(draft, allowed, prose, strength)
                closing = closing_line(draft.limits, prose, strength)
            except Exception as exc:  # the check fails closed: no model-written text is shown
                log.exception("quick answer check failed")
                errors.append(f"quick answer check failed: {type(exc).__name__}")
                answer, closing = "", ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
            if not answer:
                answer, entry["withheld"] = QUICK_WITHHELD, True
        synthesis = Synthesis(
            executive_summary=answer, comparison=[], consensus=[], conflicts=[], evidence_strength=strength,
            evidence_rationale=("; ".join(grade.get("factors") or []) if graded else NO_QUANTITATIVE_RATIONALE),
            research_gaps=[], grade_baseline=baseline if graded else None, answer=closing, key_findings=[])
        entry |= {"review_type": _review_type(state), "seconds": round(time.perf_counter() - started, 3)}
        return {"synthesis": synthesis.model_dump(), "localized_cards": None, "cost_usd": cost, "errors": errors,
                "quality": [entry]}

    return write_quick_answer
```

**Edit** `backend/app/graph/graph.py` (5 replacements; each `old` occurs exactly once):

1. Replace

```python
    external,
    intake,
    reading,
    retrieval,
```

   with

```python
    external,
    intake,
    quick,
    reading,
    retrieval,
```

2. Replace

```python
def _add_review_nodes(b: StateGraph, deps: GraphDeps) -> None:
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations, thaijo_metadata) → normalize_outcomes
    → [pool_effects] → explain_conflict* → write_synthesis → localize ∥ check_support → finalize. Shared by
    build_graph and the Plan 22a eval graph."""
    b.add_node("screen_batch", screening.make_screen_batch(deps))
    b.add_node("select_top", screening.make_select_top(deps))
```

   with

```python
def _add_review_nodes(b: StateGraph, deps: GraphDeps) -> None:
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations, thaijo_metadata) → normalize_outcomes
    → [pool_effects] → explain_conflict* → write_synthesis → localize ∥ check_support → finalize. A quick answer
    (Plan 27) reads without external_enrich and fetch_citations and goes normalize_outcomes → write_quick_answer →
    localize ∥ check_support → finalize. Shared by build_graph and the Plan 22a eval graph."""
    b.add_node("screen_batch", screening.make_screen_batch(deps))
    b.add_node("select_top", screening.make_select_top(deps))
```

3. Replace

```python
    b.add_node("explain_conflict", synthesis.make_explain_conflict(deps))
    b.add_node("write_synthesis", synthesis.make_write_synthesis(deps))
    b.add_node("localize", synthesis.make_localize(deps))
    b.add_node("check_support", support.make_check_support(deps))
```

   with

```python
    b.add_node("explain_conflict", synthesis.make_explain_conflict(deps))
    b.add_node("write_synthesis", synthesis.make_write_synthesis(deps))
    b.add_node("write_quick_answer", quick.make_write_quick_answer(deps))
    b.add_node("localize", synthesis.make_localize(deps))
    b.add_node("check_support", support.make_check_support(deps))
```

4. Replace

```python
    b.add_edge("fetch_citations", "normalize_outcomes")
    b.add_edge("thaijo_metadata", "normalize_outcomes")
    # meta_analysis: normalize_outcomes → pool_effects → conflicts; every other type skips pool_effects
    b.add_conditional_edges("normalize_outcomes", synthesis.route_after_normalize,
                            ["pool_effects", "explain_conflict", "write_synthesis"])
    b.add_conditional_edges("pool_effects", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
```

   with

```python
    b.add_edge("fetch_citations", "normalize_outcomes")
    b.add_edge("thaijo_metadata", "normalize_outcomes")
    # meta_analysis: normalize_outcomes → pool_effects → conflicts; every other type skips pool_effects; a quick
    # answer (Plan 27) goes straight to its own writer
    b.add_conditional_edges("normalize_outcomes", synthesis.route_after_normalize,
                            ["pool_effects", "explain_conflict", "write_synthesis", "write_quick_answer"])
    b.add_conditional_edges("pool_effects", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
```

5. Replace

```python
    b.add_edge("write_synthesis", "localize")
    b.add_edge("write_synthesis", "check_support")
    b.add_edge(["localize", "check_support"], "finalize")  # an explicit join: finalize runs once, after both
    b.add_edge("finalize", END)
```

   with

```python
    b.add_edge("write_synthesis", "localize")
    b.add_edge("write_synthesis", "check_support")
    b.add_edge("write_quick_answer", "localize")  # only one of the two writers runs in a review
    b.add_edge("write_quick_answer", "check_support")
    b.add_edge(["localize", "check_support"], "finalize")  # an explicit join: finalize runs once, after both
    b.add_edge("finalize", END)
```

**Edit** `backend/app/config.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    graph_mode: str = "real"  # "stub" = Plan 1 placeholder graph (plumbing tests without Claude)
    stub_delay_seconds: float = 0.0  # stub graph only: simulated review duration for load tests
    prompt_version: str = "2026-10-13.2"

    searxng_engines: str = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire"
```

   with

```python
    graph_mode: str = "real"  # "stub" = Plan 1 placeholder graph (plumbing tests without Claude)
    stub_delay_seconds: float = 0.0  # stub graph only: simulated review duration for load tests
    prompt_version: str = "2026-10-13.3"

    searxng_engines: str = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire"
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_quick_answer.py tests/unit/test_prompts_by_type.py -q`

Expected: 67 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-27/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2523 passed, 17 skipped (pre-flight).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(quick): the quick answer writer, checked like the full review's prose, on its own route; prompt_version 2026-10-13.3 (Plan 27)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-27 && git add backend/tests/unit/test_quick_answer.py backend/tests/unit/test_prompts_by_type.py backend/app/graph/schemas.py backend/app/graph/prompts.py backend/app/graph/nodes/synthesis.py backend/app/graph/nodes/screening.py backend/app/graph/nodes/quick.py backend/app/graph/graph.py backend/app/config.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 3: The quick answer outside the page: quick_view, the Markdown export, MCP quick_answer and the stub

**Files:**
- Modify: `backend/app/services/report.py`
- Modify: `backend/app/mcp/server.py`
- Modify: `backend/app/graph/nodes/stub_result.py`
- Modify: `backend/app/graph/nodes/stubs.py`
- Test (create): `backend/tests/unit/test_quick_outputs.py`
- Test (modify): `backend/tests/unit/test_mcp_server.py`

**Interfaces:**
- Consumes: `result.mode`, `result.quick` (Task 2); `ReviewService.create`/`get`; `TERMINAL_STATUSES`.
- Produces:
  - `quick_view(result) -> {answer, closing, certainty, papers_read, references: [{n, ref, citation, links: [{label, url}]}]}` and the quick branch of `render_markdown` (`app/services/report.py`).
  - MCP tool `quick_answer(topic, language="th", study_types=None, year_from=None, wait_seconds=60)`; `QUICK_WAIT_DEFAULT = 60`, `QUICK_WAIT_MAX = 90`, `QUICK_POLL_SECONDS = 2.0`, `_sleep` (replaced in tests), `QUICK_ANSWER_DOC`; `INSTRUCTIONS` names the tool; `start_review` and `quick_answer` share an inner `create(topic, ctx, language, options)`.
  - `stub_result(..., options)` gives `mode`/`quick` (and, for a quick answer, the quick shape via `_stub_quick`); the plain stub's result has `mode` and `quick`; the timed stub sends no `citations_fetched` for a quick answer.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_quick_outputs.py` (complete):

```python
"""Plan 27: the quick answer outside the web page: quick_view, the Markdown export, the MCP quick_answer tool, and the
stub graph's quick shape."""
import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from fastmcp import Client

from app.db.repositories import ReviewRepository
from app.graph.nodes.stub_result import stub_result
from app.schemas.review import ReviewOptions
from app.services.report import quick_view, render_markdown
from tests.unit.test_stub_timeline import run as run_stub

PAPERS = [
    {"ref": "P1", "title": "Metformin and colorectal cancer in a cohort", "authors": ["Lee A"], "year": 2020,
     "journal": "Gut", "doi": "10.1000/p1", "pmid": "111"},
    {"ref": "P2", "title": "Not cited", "year": 2019},
    {"ref": "P3", "title": "บทความวารสารไทย", "year": 2022,
     "thaijo_url": "https://so01.tci-thaijo.org/index.php/jmed/article/view/12345"},
]
QUICK_RESULT = {
    "mode": "quick", "quick": {"refs": ["P3", "P1"], "papers_read": 3}, "papers": PAPERS,
    "summary": "ผลลดลง [P3] และสอดคล้องกัน [P1, P3]",
    "synthesis": {"executive_summary": "ผลลดลง [P3] และสอดคล้องกัน [P1, P3]", "evidence_strength": "low",
                  "answer": "ความเชื่อมั่นต่ำ"},
    "question": {"refined_question": "Does metformin lower colorectal cancer risk?"},
}


def data(result):
    return json.loads(result.content[0].text)


def test_quick_view_numbers_the_references_by_first_citation_with_their_links():
    view = quick_view(QUICK_RESULT)
    assert view["answer"] == "ผลลดลง [1] และสอดคล้องกัน [2, 1]"
    assert (view["closing"], view["certainty"], view["papers_read"]) == ("ความเชื่อมั่นต่ำ", "low", 3)
    assert [(r["n"], r["ref"]) for r in view["references"]] == [(1, "P3"), (2, "P1")]
    assert view["references"][0]["links"] == [{"label": "ThaiJO", "url": PAPERS[2]["thaijo_url"]}]
    assert view["references"][1]["links"] == [{"label": "doi", "url": "https://doi.org/10.1000/p1"},
                                              {"label": "PMID", "url": "https://pubmed.ncbi.nlm.nih.gov/111/"}]
    assert view["references"][1]["citation"].startswith("Lee A. Metformin and colorectal cancer in a cohort.")


def test_quick_view_drops_a_ref_it_cannot_number():
    result = {**QUICK_RESULT, "summary": "ผล [P2] และ [P1, P9]"}
    assert quick_view(result)["answer"] == "ผล  และ [2]"


def test_the_markdown_export_of_a_quick_answer_is_the_answer_and_its_references():
    review = SimpleNamespace(topic="เมตฟอร์มิน", status="done", error=None, result=QUICK_RESULT)
    md = render_markdown(review)
    assert md.startswith("# Quick answer: เมตฟอร์มิน\n")
    assert "ผลลดลง [1] และสอดคล้องกัน [2, 1]" in md and "ความเชื่อมั่นต่ำ" in md
    assert "abstracts of 3 studies" in md and "not a full systematic review" in md
    assert "1. บทความวารสารไทย. 2022. ThaiJO: [" in md and "2. Lee A." in md
    assert "## Summary" not in md and "## Comparison" not in md


def test_a_full_review_keeps_its_markdown():
    review = SimpleNamespace(topic="t", status="done", error=None,
                             result={"mode": "full", "summary": "S [P1].", "synthesis": {}, "papers": []})
    assert render_markdown(review).startswith("# Literature review: t\n")


# ---- MCP ----------------------------------------------------------------------------------------------------------
async def test_quick_answer_is_a_listed_tool_with_its_bounds(app):
    from app.mcp.server import INSTRUCTIONS, QUICK_WAIT_MAX
    async with Client(app.state.mcp) as c:
        tool = next(t for t in await c.list_tools() if t.name == "quick_answer")
    assert "8" in tool.description and "30" in tool.description and str(QUICK_WAIT_MAX) in tool.description
    assert "quick_answer" in INSTRUCTIONS


async def test_quick_answer_without_waiting_starts_a_quick_review(app, client, queue):
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", {"topic": "metformin and colorectal cancer",
                                                      "language": "en", "wait_seconds": 0}))
    assert out["status"] == "queued" and "still running" in out["message"]
    assert queue.enqueued == [out["review_id"]]
    options = (await client.get(f"/api/v1/reviews/{out['review_id']}")).json()["options"]
    assert (options["mode"], options["max_papers"], options["candidate_limit"]) == ("quick", 8, 30)


async def test_quick_answer_returns_the_numbered_answer_once_done(app, session_factory):
    async with Client(app.state.mcp) as c:
        first = data(await c.call_tool("quick_answer", {"topic": "metformin and colorectal cancer",
                                                        "wait_seconds": 0}))
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(uuid.UUID(first["review_id"]), status="done", result=QUICK_RESULT,
                                             finished_at=datetime.now(UTC))
        again = data(await c.call_tool("quick_answer", {"topic": "metformin and colorectal cancer",
                                                        "wait_seconds": 5}))
    assert again["review_id"] == first["review_id"] and again["cached"] is True and again["status"] == "done"
    assert again["answer"] == "ผลลดลง [1] และสอดคล้องกัน [2, 1]"
    assert [r["ref"] for r in again["references"]] == ["P3", "P1"]


async def test_quick_answer_waits_until_the_review_finishes(app, session_factory, monkeypatch):
    from app.mcp import server
    slept = []

    async def finish(seconds):  # the worker finishes the review while the tool waits
        slept.append(seconds)
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(rid[0], status="done", result=QUICK_RESULT,
                                             finished_at=datetime.now(UTC))

    rid: list[uuid.UUID] = []
    real_create = app.state.deps.service.create

    async def remember(req, **kw):
        created = await real_create(req, **kw)
        rid.append(created.review_id)
        return created

    monkeypatch.setattr(app.state.deps.service, "create", remember)
    monkeypatch.setattr(server, "_sleep", finish)
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", {"topic": "statins and dementia risk", "wait_seconds": 30}))
    assert slept == [server.QUICK_POLL_SECONDS] and out["status"] == "done" and out["references"]


async def test_quick_answer_refuses_an_emergency_like_start_review(app, queue):
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", {"topic": "I want to kill myself", "language": "en"}))
    assert out["status"] == "refused" and out["code"] == "emergency" and out["review_id"] is None
    assert queue.enqueued == []


# ---- the stub --------------------------------------------------------------------------------------------------
def test_the_stub_result_has_the_quick_shape():
    r = stub_result("statins", "en", "slr", ReviewOptions(mode="quick"))
    assert r["mode"] == "quick" and r["quick"] == {"refs": ["P1", "P3", "P4"], "papers_read": 5}
    assert r["summary"].endswith("[P4].") and r["synthesis"]["answer"].startswith("The certainty of the evidence")
    assert r["synthesis"]["key_findings"] == [] and r["citations"] is None and r["support"] is None
    assert (r["stats"]["candidates"], r["stats"]["excluded_selection"]["requested"]) == (30, 8)
    full = stub_result("statins", "en", "slr", ReviewOptions())
    assert full["mode"] == "full" and full["quick"] is None and full["citations"] is not None


async def test_the_timed_stub_runs_a_quick_answer_without_citation_events():
    events, _elapsed, state = await run_stub(options={"mode": "quick"}, delay=0.2)
    types = [e["type"] for _t, e in events]
    assert "citations_fetched" not in types and "finalizing" in types
    assert state.values["result"]["mode"] == "quick"


async def test_the_plain_stub_marks_a_quick_answer():
    _events, _elapsed, state = await run_stub(options={"mode": "quick"}, delay=0)
    assert state.values["result"]["mode"] == "quick" and state.values["result"]["quick"]["refs"] == []
```

**Edit** `backend/tests/unit/test_mcp_server.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
        templates = {t.uri_template for t in await c.list_resource_templates()}
        prompt = await c.get_prompt("literature_review", {"topic": "metformin"})
    assert names == {"search_papers", "start_review", "get_review_status", "get_review_result"}
    assert templates == {"review://{review_id}", "review://{review_id}/report.md"}
    assert "start_review" in prompt.messages[0].content.text
```

   with

```python
        templates = {t.uri_template for t in await c.list_resource_templates()}
        prompt = await c.get_prompt("literature_review", {"topic": "metformin"})
    assert names == {"search_papers", "start_review", "quick_answer", "get_review_status", "get_review_result"}
    assert templates == {"review://{review_id}", "review://{review_id}/report.md"}
    assert "start_review" in prompt.messages[0].content.text
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_quick_outputs.py tests/unit/test_mcp_server.py -q`

Expected: collection fails: `ImportError: cannot import name 'quick_view' from 'app.services.report'` (1 error during collection).

- [ ] **Step 3: Implement**

**Edit** `backend/app/services/report.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python


def render_markdown(review) -> str:
    result = review.result
```

   with

```python


_MARKER = re.compile(r"\[(P\d+(?:\s*,\s*P\d+)*)\]")  # app.harness.support.MARKER: the groups the engine writes


def quick_view(result: dict[str, Any]) -> dict[str, Any]:
    """Plan 27: a quick answer as its readers get it outside the web page (MCP quick_answer, the Markdown export): the
    shown answer with its [Pn] groups renumbered [1]..[n] by `quick.refs` (order of first citation), the closing
    certainty-and-limits line, the certainty level (computed, GRADE-lite) and the numbered references with their
    links. The references are the screened papers the answer cites; nothing is computed here."""
    s = result.get("synthesis") or {}
    quick = result.get("quick") or {}
    refs = [r for r in quick.get("refs") or [] if isinstance(r, str)]
    by_ref = {p.get("ref"): p for p in result.get("papers") or []}

    def number(m: re.Match[str]) -> str:
        nums = [str(refs.index(r) + 1) for r in re.findall(r"P\d+", m.group(1)) if r in refs]
        return f"[{', '.join(nums)}]" if nums else ""

    references = []
    for n, ref in enumerate(refs, 1):
        p = by_ref.get(ref) or {"ref": ref}
        _text, ids = _citation_parts(p)
        references.append({"n": n, "ref": ref, "citation": vancouver(p),
                           "links": [{"label": label, "url": url} for label, _value, url in ids]})
    return {"answer": _MARKER.sub(number, result.get("summary") or s.get("executive_summary") or ""),
            "closing": s.get("answer") or "", "certainty": s.get("evidence_strength"),
            "papers_read": quick.get("papers_read"), "references": references}


def _quick_markdown(review, result: dict[str, Any]) -> str:
    view = quick_view(result)
    q = result.get("question") or {}
    out = [f"# Quick answer: {review.topic}", ""]
    if q.get("refined_question"):
        out += [f"**Question:** {q['refined_question']}", ""]
    out += [view["answer"], ""]
    if view["closing"]:
        out += [view["closing"], ""]
    if view["papers_read"] is not None:
        out += [(f"_A quick answer from the abstracts of {view['papers_read']} studies (automated, abstracts only); "
                 "not a full systematic review and not medical advice._"), ""]
    if view["references"]:
        out += ["## References", ""]
        by_ref = {p.get("ref"): p for p in result.get("papers") or []}
        out += [f"{r['n']}. {_vancouver_md(by_ref.get(r['ref']) or {})}" for r in view["references"]]
        out.append("")
    return "\n".join(out) + "\n"


def render_markdown(review) -> str:
    result = review.result
```

2. Replace

```python
        out.append(f"Status: **{review.status}**" + (f" — {review.error}" if review.error else ""))
        return "\n".join(out) + "\n"
    q = result.get("question") or {}
    s = result.get("synthesis") or {}
```

   with

```python
        out.append(f"Status: **{review.status}**" + (f" — {review.error}" if review.error else ""))
        return "\n".join(out) + "\n"
    if result.get("mode") == "quick":  # Plan 27: the answer and its numbered references, not the report
        return _quick_markdown(review, result)
    q = result.get("question") or {}
    s = result.get("synthesis") or {}
```

**Edit** `backend/app/mcp/server.py` (7 replacements; each `old` occurs exactly once):

1. Replace

```python
from __future__ import annotations

import uuid
from collections.abc import Callable
```

   with

```python
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable
```

2. Replace

```python
from app.api.ratelimit import ip_from
from app.config import Settings
from app.runtime import AppDeps
from app.schemas.review import (
```

   with

```python
from app.api.ratelimit import ip_from
from app.config import Settings
from app.db.models import TERMINAL_STATUSES
from app.runtime import AppDeps
from app.schemas.review import (
```

3. Replace

```python
    ReviewOptions,
)
from app.services.report import render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of
```

   with

```python
    ReviewOptions,
)
from app.services.report import quick_view, render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of
```

4. Replace

```python
personal_medical for a question about one person's own symptoms, diagnosis, dose or treatment, declined otherwise).
A topic that reads as an emergency is not started: start_review returns status "refused" with code "emergency", the
hotlines (1669, and 1323 for self-harm) and a fixed message to pass on. search_papers answers quick literature
questions without starting a review. When the service is busy, start_review fails with a reason (queue_full,
daily_reviews, daily_budget) and how many seconds to wait. Results are a rapid, automated review of published
```

   with

```python
personal_medical for a question about one person's own symptoms, diagnosis, dose or treatment, declined otherwise).
A topic that reads as an emergency is not started: start_review returns status "refused" with code "emergency", the
hotlines (1669, and 1323 for self-harm) and a fixed message to pass on. For a short referenced answer instead of a
report, call quick_answer(topic) (Plan 27: about {_QUICK_PAPERS} studies read, a 2-4 sentence answer with numbered
references, usually about a minute; it waits for the answer). search_papers answers quick literature
questions without starting a review. When the service is busy, start_review fails with a reason (queue_full,
daily_reviews, daily_budget) and how many seconds to wait. Results are a rapid, automated review of published
```

5. Replace

```python
message and message_th (no review is created). The same topic, language and options within 24 hours (or still running) return that review
(cached=true). Fails with a reason and a wait time when the service is busy."""


```

   with

```python
message and message_th (no review is created). The same topic, language and options within 24 hours (or still running) return that review
(cached=true). Fails with a reason and a wait time when the service is busy."""

QUICK_WAIT_DEFAULT, QUICK_WAIT_MAX, QUICK_POLL_SECONDS = 60, 90, 2.0
_sleep = asyncio.sleep  # replaced in tests

QUICK_ANSWER_DOC = f"""Ask a quick question (Plan 27, "ถามเร็ว"; e.g. "does metformin lower colorectal cancer risk?",
up to 600 characters) and get a short, referenced answer. The agent screens about {_QUICK_POOL} candidates with
abstracts, reads the {_QUICK_PAPERS} most relevant, and writes 2-4 sentences, each citing the studies it rests on,
then one line on the certainty (computed) and the main limitation. It waits up to `wait_seconds` (0-{QUICK_WAIT_MAX},
default {QUICK_WAIT_DEFAULT}) for the answer. Returns review_id, status, cached and status_url; when done also
`answer` (the [1]..[n] numbers point into `references`), `closing`, `certainty`, `papers_read` and `references`
(n, ref, citation, links to PubMed, DOI, PubMed Central or ThaiJO). When still running, poll get_review_status and
call get_review_result. It counts as one review against the same limits as start_review. `study_types` and `year_from`
work as in start_review. A topic that reads as an emergency returns status "refused" as in start_review. Not
medical advice."""


```

6. Replace

```python
                           study_types: list[str] | None = None, year_from: int | None = None,
                           mode: Literal["full", "quick"] = "full") -> dict[str, Any]:
        try:
            req = CreateReviewRequest(topic=topic, language=language,
                                      options=ReviewOptions.clamped({"max_papers": max_papers,
                                                                             "review_type": review_type,
                                                                             "study_types": study_types or [],
                                                                             "year_from": year_from, "mode": mode}))
            created = await get_deps().service.create(req, identity=await identity(ctx), human_check=False)
        except Refused as exc:  # Plan 26: an emergency gets the hotlines, not a review
```

   with

```python
                           study_types: list[str] | None = None, year_from: int | None = None,
                           mode: Literal["full", "quick"] = "full") -> dict[str, Any]:
        return await create(topic, ctx, language, {"max_papers": max_papers, "review_type": review_type,
                                                   "study_types": study_types or [], "year_from": year_from,
                                                   "mode": mode})

    async def create(topic: str, ctx: Context, language: str, options: dict[str, Any]) -> dict[str, Any]:
        try:
            req = CreateReviewRequest(topic=topic, language=language, options=ReviewOptions.clamped(options))
            created = await get_deps().service.create(req, identity=await identity(ctx), human_check=False)
        except Refused as exc:  # Plan 26: an emergency gets the hotlines, not a review
```

7. Replace

```python
        return {"review_id": rid, "status": created.status, "cached": created.cached,
                "status_url": f"{settings.public_base_url.rstrip('/')}/api/v1/reviews/{rid}"}

    @mcp.tool()
```

   with

```python
        return {"review_id": rid, "status": created.status, "cached": created.cached,
                "status_url": f"{settings.public_base_url.rstrip('/')}/api/v1/reviews/{rid}"}

    @mcp.tool(description=QUICK_ANSWER_DOC)
    async def quick_answer(topic: str, ctx: Context, language: Literal["th", "en"] = "th",
                           study_types: list[str] | None = None, year_from: int | None = None,
                           wait_seconds: int = QUICK_WAIT_DEFAULT) -> dict[str, Any]:
        started = await create(topic, ctx, language, {"mode": "quick", "study_types": study_types or [],
                                                      "year_from": year_from})
        if started["review_id"] is None:  # refused (an emergency): nothing to wait for
            return started
        rid = uuid.UUID(started["review_id"])
        deadline = time.monotonic() + max(0, min(wait_seconds, QUICK_WAIT_MAX))
        review = await get_deps().service.get(rid)
        while review is not None and review.status not in TERMINAL_STATUSES and time.monotonic() < deadline:
            await _sleep(QUICK_POLL_SECONDS)
            review = await get_deps().service.get(rid)
        if review is None:
            raise ToolError(f"review {rid} not found")
        out = {**started, "status": review.status}
        if review.status == "done" and review.result:
            return out | quick_view(review.result)
        if review.status in TERMINAL_STATUSES:
            return out | {"error": review.error, "refusal_code": refusal_code_of(review.status, review.error)}
        return out | {"message": "still running; poll get_review_status, then call get_review_result"}

    @mcp.tool()
```

**Edit** `backend/app/graph/nodes/stub_result.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
            for refs in [[c["ref"] for c in row["cells"]]]],
    }
    return {
        "topic": topic, "english_topic": topic, "language": language, "review_type": review_type,
        "question": {
            "original_topic": topic, "english_topic": topic, "refined": True,
```

   with

```python
            for refs in [[c["ref"] for c in row["cells"]]]],
    }
    result = {
        "topic": topic, "english_topic": topic, "language": language, "review_type": review_type,
        "mode": opts.mode, "quick": None,  # Plan 27 (parity with finalize)
        "question": {
            "original_topic": topic, "english_topic": topic, "refined": True,
```

2. Replace

```python
        "support": _stub_support(synthesis, papers),
    }


```

   with

```python
        "support": _stub_support(synthesis, papers),
    }
    return _stub_quick(result) if opts.mode == "quick" else result


def _stub_quick(result: dict[str, Any]) -> dict[str, Any]:
    """Plan 27: the stub's quick answer, in the engine's quick shape: the same papers, a two-sentence answer citing
    P1, P3 and P4 with the certainty-and-limits line, no comparison, consensus, conflicts or key findings, no citation
    network (a quick answer fetches none) and no sentence-support block (no judge runs)."""
    topic = result["topic"]
    level = result["synthesis"]["evidence_strength"]
    summary = (f"Simulated studies suggest that {topic} may improve the primary outcome [P1, P3]. "
               "One simulated cohort reports the opposite direction [P4].")
    synthesis = {**result["synthesis"], "executive_summary": summary, "comparison": [], "consensus": [],
                 "conflicts": [], "research_gaps": [], "key_findings": [],
                 "answer": (f"The certainty of the evidence is {level.replace('_', ' ')}. "
                            "The simulated studies are few and illustrative only.")}
    evidence = [p for p in result["papers"] if not p["related_to"]
                and p["card"]["design_category"] != "narrative_review"]
    return {**result, "mode": "quick", "quick": {"refs": ["P1", "P3", "P4"], "papers_read": len(evidence)},
            "summary": summary, "synthesis": synthesis, "synthesis_en": synthesis, "citations": None,
            "support": None}


```

**Edit** `backend/app/graph/nodes/stubs.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    writer = get_stream_writer()
    writer({"type": "synthesizing"})
    return {
        "result": {
            "summary": f"Stub review for: {state['topic']}",
            "language": state["language"],
            "review_type": ReviewOptions.clamped(state.get("options")).review_type,
            "papers": [],
            "comparison": [],
```

   with

```python
    writer = get_stream_writer()
    writer({"type": "synthesizing"})
    opts = ReviewOptions.clamped(state.get("options"))
    return {
        "result": {
            "summary": f"Stub review for: {state['topic']}",
            "language": state["language"],
            "review_type": opts.review_type,
            # Plan 27: a quick stub answer cites nothing (the stub reads no paper)
            "mode": opts.mode, "quick": {"refs": [], "papers_read": 0} if opts.mode == "quick" else None,
            "papers": [],
            "comparison": [],
```

2. Replace

```python
        review_type = opts.review_type
        final = stub_result(state["topic"], state["language"], review_type, opts)  # the result finalize will return
        if state.get("selected"):
            c = final["citations"]
            progress_writer()({"type": "citations_fetched", "edges": len(c["edges"]),
```

   with

```python
        review_type = opts.review_type
        final = stub_result(state["topic"], state["language"], review_type, opts)  # the result finalize will return
        if state.get("selected") and final["citations"] is not None:  # a quick answer fetches no citations (Plan 27)
            c = final["citations"]
            progress_writer()({"type": "citations_fetched", "edges": len(c["edges"]),
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_quick_outputs.py tests/unit/test_mcp_server.py -q`

Expected: 22 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-27/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2535 passed, 17 skipped (pre-flight).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(quick): numbered references in quick_view and the Markdown export, the MCP quick_answer tool, the stub's quick shape (Plan 27)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-27 && git add backend/tests/unit/test_quick_outputs.py backend/tests/unit/test_mcp_server.py backend/app/services/report.py backend/app/mcp/server.py backend/app/graph/nodes/stub_result.py backend/app/graph/nodes/stubs.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 4: Frontend — the quick answer page

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/quick.ts`
- Modify: `frontend/src/lib/i18n-report.ts`
- Modify: `frontend/src/components/review/references.tsx`
- Modify: `frontend/src/components/review/report.tsx`
- Create: `frontend/src/components/review/quick-answer.tsx`
- Modify: `frontend/src/components/review/review-screen.tsx`
- Test (modify): `frontend/src/test/fixtures.ts`
- Test (create): `frontend/src/lib/quick.test.ts`
- Test (create): `frontend/src/components/review/quick-answer.test.tsx`

**Interfaces:**
- Consumes: `result.mode`, `result.quick`, `result.support` (Tasks 2–3); `alignMarkers`, `citationOf`, `isChecked`, `ReportNotices`, `citedQuestion`.
- Produces:
  - `src/lib/types.ts`: `ReviewMode`, `QuickBlock {refs, papers_read}`, `ReviewResult.mode?`, `ReviewResult.quick?`, `ServiceStatus.limits.modes?`/`quick?`, `ReviewOptions.mode?`.
  - `src/lib/quick.ts`: `isQuickReview(review)`, `quickRefs(result)`, `type QuickPart`, `quickParts(text, refs)`, `quickRefId(n)`, `fullReviewHref(review)`, `interface FormStart`, `formStart(params)`.
  - `RC.quick` (`kind`, `scope(n)`, `scopeNone`, `asked`, `answer`, `refsTitle`, `refsNote`, `cite(n)`, `citeChecked(n)`, `noRefs`, `upgrade`, `upgradeHint`).
  - `QuickAnswer({ review })` (`data-quick-answer`, `data-quick-scope`, `data-quick-text`, `data-quick-closing`, `data-quick-ref`, `data-quick-upgrade`); `CitationText` and `useDocumentLang` exported; `ReviewScreen` shows `QuickAnswer` for a finished quick answer.
  - Fixture `quickReviewFixture` (`src/test/fixtures.ts`).

- [ ] **Step 0: Install the frontend dependencies once**

Run: `cd /d/MRA-plan-27/frontend && npm ci`

- [ ] **Step 1: Write the failing tests**

**Edit** `frontend/src/test/fixtures.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
/** A shortfall: N = 50, S = 120, only E = 22 eligible, so A = 22 (never padded). */
export const resultShortfall: Review = paperCountReview("21210000-0000-4000-8000-000000000022", { selected: 22, eligible: 22, over_limit: 0 });
```

   with

```ts
/** A shortfall: N = 50, S = 120, only E = 22 eligible, so A = 22 (never padded). */
export const resultShortfall: Review = paperCountReview("21210000-0000-4000-8000-000000000022", { selected: 22, eligible: 22, over_limit: 0 });

// Plan 27: a quick answer as the engine's finalize writes it for mode "quick": the summary is the 2–4 sentence answer
// (its [Pn] groups kept through translation), synthesis.answer the certainty-and-limits line, quick.refs the cited refs
// in order of first citation. P3's citation in the first sentence passed the sentence-support check (✓); P1's is partial.
const QUICK_TH = "ผู้ใช้เมตฟอร์มินมีความเสี่ยงมะเร็งลำไส้ใหญ่ต่ำกว่า (HR 0.80) [P3, P1] แต่การศึกษาหนึ่งพบการตรวจพบมากขึ้นในสองปีแรก [P4]";
const QUICK_EN = "Metformin users had a lower risk of colorectal cancer (HR 0.80) [P3, P1], but one study found more detection in the first two years [P4].";
const quickSynthesis = (summary: string, answer: string) => ({
  executive_summary: summary, comparison: [], consensus: [], conflicts: [], evidence_strength: "low" as const,
  evidence_rationale: "observational studies", research_gaps: [], grade_baseline: "low" as const, answer, key_findings: [],
});

export const quickReviewFixture: Review = {
  ...reviewFixture,
  id: "27270000-0000-4000-8000-000000000027",
  options: { mode: "quick", max_papers: 8, candidate_limit: 30, review_type: "slr", year_from: 2015, study_types: ["Cohort", "Other: Delphi study"] },
  result: {
    ...resultFixture,
    review_type: "slr", mode: "quick", quick: { refs: ["P3", "P1", "P4"], papers_read: 4 },
    summary: QUICK_TH,
    synthesis: quickSynthesis(QUICK_TH, "ความเชื่อมั่นของหลักฐานต่ำ การศึกษาทั้งหมดเป็นการศึกษาเชิงสังเกต"),
    synthesis_en: quickSynthesis(QUICK_EN, "The certainty of the evidence is low. All studies were observational."),
    citations: null,
    support: {
      judge: "ok", markers: [["P3", "P1"], ["P4"]], display_aligned: true,
      claims: [{
        id: "s0", where: "summary", markers: [0], finding: null, claim: "Metformin users had a lower risk of colorectal cancer (HR 0.80) [P3, P1].",
        refs: ["P3", "P1"], numbers_checked: true, computed: false,
        citations: [
          { ref: "P3", label: "supported", evidence: q3, score: 0.92, not_evidence: false, verified: true },
          { ref: "P1", label: "partial", evidence: q1, score: 0.61, not_evidence: false, verified: false },
        ],
      }],
    },
  },
};
```

**New file** `frontend/src/lib/quick.test.ts` (complete):

```ts
import { describe, expect, it } from "vitest";
import { quickReviewFixture, reviewFixture } from "@/test/fixtures";
import { formStart, fullReviewHref, isQuickReview, quickParts, quickRefs } from "./quick";

describe("Plan 27 quick answer helpers", () => {
  it("tells a quick answer from a full review by its result or its options", () => {
    expect(isQuickReview(quickReviewFixture)).toBe(true);
    expect(isQuickReview({ ...quickReviewFixture, result: null })).toBe(true); // still running
    expect(isQuickReview(reviewFixture)).toBe(false);
    expect(isQuickReview(null)).toBe(false);
  });

  it("numbers the references by first citation, from result.quick or else from the shown answer", () => {
    expect(quickRefs(quickReviewFixture.result!)).toEqual(["P3", "P1", "P4"]);
    expect(quickRefs({ summary: "A [P2]. B [P1, P2]. C [P5]." })).toEqual(["P2", "P1", "P5"]);
    expect(quickRefs({})).toEqual([]);
  });

  it("splits the answer into text and numbered citation groups, keeping each group's marker index", () => {
    const parts = quickParts("Lower risk [P3, P1] but not in [P4]. Extra [P9].", ["P3", "P1", "P4"]);
    expect(parts).toEqual([
      { kind: "text", text: "Lower risk " },
      { kind: "cite", refs: ["P3", "P1"], numbers: [1, 2], marker: 0 },
      { kind: "text", text: " but not in " },
      { kind: "cite", refs: ["P4"], numbers: [3], marker: 1 },
      { kind: "text", text: ". Extra " },
      { kind: "cite", refs: [], numbers: [], marker: 2 },
      { kind: "text", text: "." },
    ]);
  });

  it("links the upgrade to the form with the same question, language and eligibility, as a full review", () => {
    const href = fullReviewHref(quickReviewFixture);
    expect(href.endsWith("#request")).toBe(true);
    const params = new URLSearchParams(href.slice(2, href.indexOf("#")));
    expect(Object.fromEntries(params)).toEqual({ q: quickReviewFixture.topic, mode: "full", lang: "th", year: "2015",
      types: "Cohort|Other: Delphi study" });
    expect(fullReviewHref({ topic: "t", language: "en", options: {} })).toBe("/?q=t&mode=full&lang=en#request");
  });

  it("reads the form's starting values from the address and drops what is not valid", () => {
    expect(formStart({ q: " statins ", mode: "full", lang: "en", year: "2015", types: "RCT|Other: Delphi study" }))
      .toEqual({ topic: "statins", mode: "full", language: "en", yearFrom: "2015", studyTypes: ["RCT", "Other: Delphi study"] });
    expect(formStart({ mode: "fast", lang: "fr", year: "1800", types: "" }))
      .toEqual({ topic: undefined, mode: undefined, language: undefined, yearFrom: undefined, studyTypes: undefined });
    expect(formStart({ q: ["first", "second"] }).topic).toBe("first");
  });
});
```

**New file** `frontend/src/components/review/quick-answer.test.tsx` (complete):

```tsx
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene } from "@/lib/agent-scene";
import { initialRun } from "@/lib/progress";
import type { Review } from "@/lib/types";
import { quickReviewFixture, reviewFixture } from "@/test/fixtures";

const useReview = vi.fn();
vi.mock("@/lib/use-review", () => ({ useReview: (...a: unknown[]) => useReview(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/r/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("./charts", () => ({ Charts: () => <div data-testid="charts" /> }));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { QuickAnswer } from "./quick-answer";
import { ReviewScreen } from "./review-screen";

vi.setConfig({ testTimeout: 20_000 });

const english = (r: Review): Review => ({ ...r, language: "en", result: { ...r.result!, language: "en",
  summary: r.result!.synthesis_en!.executive_summary, synthesis: r.result!.synthesis_en } });

describe("Plan 27 quick answer page", () => {
  beforeEach(() => useReview.mockReset());

  it("shows the question, the scope, the answer with numbered citations and the closing line", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(document.querySelector("[data-quick-scope]")).toHaveTextContent("ถามเร็ว · คำตอบสั้นจากบทคัดย่อของงานวิจัย 4 ฉบับ");
    const text = document.querySelector("[data-quick-text]")!;
    expect(text.textContent).toBe("ผู้ใช้เมตฟอร์มินมีความเสี่ยงมะเร็งลำไส้ใหญ่ต่ำกว่า (HR 0.80) [1✓, 2] แต่การศึกษาหนึ่งพบการตรวจพบมากขึ้นในสองปีแรก [3]");
    expect(document.querySelector("[data-quick-closing]")).toHaveTextContent("ความเชื่อมั่นของหลักฐานต่ำ");
  });

  it("links each number to its reference, and marks only a citation the support check passed", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const one = screen.getByRole("link", { name: "อ้างอิง 1 ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้" });
    expect(one).toHaveAttribute("href", "#qref-1");
    expect(screen.getByRole("link", { name: "อ้างอิง 2" })).toHaveAttribute("href", "#qref-2");
    expect(screen.getByRole("link", { name: "อ้างอิง 3" })).toHaveAttribute("href", "#qref-3");
    expect(document.querySelectorAll("[data-checked]")).toHaveLength(1);
  });

  it("lists the references in citation order with their PubMed, DOI and PMC links", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const list = screen.getByRole("list", { name: "เอกสารอ้างอิง" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-quick-ref"))).toEqual(["P3", "P1", "P4"]);
    expect(items[0].id).toBe("qref-1");
    expect(items[0]).toHaveTextContent("[1]Lindqvist J, Other A. Metformin use and colorectal cancer risk");
    const hrefs = within(items[0]).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://doi.org/10.1000/p3", "https://pubmed.ncbi.nlm.nih.gov/3000003/",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC300003/"]);
    expect(screen.queryByText(/Biguanide exposure/)).toBeNull(); // P2 is not cited
  });

  it("offers a full review of the same question and options", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    const link = screen.getByRole("link", { name: "ทำรีวิวฉบับเต็ม" });
    expect(link.getAttribute("href")).toMatch(/^\/\?q=.+&mode=full&lang=th&year=2015&types=Cohort%7COther%3A\+Delphi\+study#request$/);
  });

  it("keeps the public safety notices: the reader guide and the harms gap", () => {
    render(<QuickAnswer review={quickReviewFixture} />);
    expect(document.querySelector('[data-notice="guide"]')).not.toBeNull();
    expect(document.querySelector('[data-notice="harms"]')).not.toBeNull();
    expect(document.querySelector("[data-audience-switch]")).toBeNull(); // one presentation
  });

  it("speaks English for an English answer", () => {
    render(<QuickAnswer review={english(quickReviewFixture)} />);
    expect(document.querySelector("[data-quick-scope]")).toHaveTextContent("Quick answer · A short answer from the abstracts of 4 studies");
    expect(screen.getByRole("link", { name: "Run a full review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reference 3" })).toHaveAttribute("href", "#qref-3");
    expect(document.documentElement.lang).toBe("en");
  });

  it("says so when the answer cites nothing (no papers found)", () => {
    const empty: Review = { ...quickReviewFixture, result: { ...quickReviewFixture.result!, quick: { refs: [], papers_read: 0 },
      summary: "ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้เพียงพอ", support: null } };
    render(<QuickAnswer review={empty} />);
    expect(screen.getByText("คำตอบนี้ไม่ได้อ้างอิงงานวิจัยใด")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "เอกสารอ้างอิง" })).toBeNull();
  });

  it("is what the review page shows for a finished quick answer; a full review still gets the report", () => {
    const screenState = (review: Review) => ({ review, run: { ...initialRun(), status: "done" as const, terminal: true },
      scene: initialScene(), phase: "report", connection: "closed", retry: vi.fn() });
    useReview.mockReturnValue(screenState(quickReviewFixture));
    const { unmount } = render(<ReviewScreen id="x" />);
    expect(document.querySelector("[data-quick-answer]")).not.toBeNull();
    unmount();
    useReview.mockReturnValue(screenState(reviewFixture));
    render(<ReviewScreen id="x" />);
    expect(document.querySelector("[data-quick-answer]")).toBeNull();
    expect(screen.getAllByRole("navigation", { name: /สารบัญ|ในรายงานนี้/ }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-27/frontend && npx vitest run src/lib/quick.test.ts src/components/review/quick-answer.test.tsx src/lib/i18n-report.test.ts`

Expected: `quick.test.ts` and `quick-answer.test.tsx` fail to load: `Failed to resolve import "./quick"` / `"./quick-answer"`; `i18n-report.test.ts` passes.

- [ ] **Step 3: Implement**

**Edit** `frontend/src/lib/types.ts` (4 replacements; each `old` occurs exactly once):

1. Replace

```ts

export type ReviewType = "narrative" | "slr" | "scoping" | "meta_analysis";

export interface KeyTerm {
```

   with

```ts

export type ReviewType = "narrative" | "slr" | "scoping" | "meta_analysis";

/** Plan 27: "quick" = a 2–4 sentence answer with numbered references ("ถามเร็ว"); "full" = the report. */
export type ReviewMode = "full" | "quick";

/** Plan 27: `result.quick` of a quick answer (null for a full review, absent before Plan 27). */
export interface QuickBlock {
  /** the refs the answer cites, in order of first citation: reference [k] is refs[k - 1] */
  refs: string[];
  /** the studies the answer was written from (evidence only) */
  papers_read: number;
}

export interface KeyTerm {
```

2. Replace

```ts
  methods?: ReviewMethods; // Plan 20
  support?: SentenceSupport | null; // Plan 25
}

```

   with

```ts
  methods?: ReviewMethods; // Plan 20
  support?: SentenceSupport | null; // Plan 25
  mode?: ReviewMode; // Plan 27; absent before it (a full review)
  /** Plan 27: for a quick answer the summary is the answer and synthesis.answer the certainty-and-limits line */
  quick?: QuickBlock | null;
}

```

3. Replace

```ts
    review_types?: string[];
    sse_max_per_ip?: number;
  };
}
```

   with

```ts
    review_types?: string[];
    sse_max_per_ip?: number;
    /** Plan 27: the request modes and the quick answer's fixed sizes (absent before it) */
    modes?: string[];
    quick?: { max_papers: number; candidate_limit: number; review_type: string };
  };
}
```

4. Replace

```ts
  study_types?: string[];
  review_type?: ReviewType;
}

```

   with

```ts
  study_types?: string[];
  review_type?: ReviewType;
  mode?: ReviewMode; // Plan 27; the service fixes the sizes and the type of a quick answer
}

```

**New file** `frontend/src/lib/quick.ts` (complete):

```ts
// Plan 27: the quick answer ("ถามเร็ว"). Pure, no React: whether a review is a quick answer, its references numbered
// [1]…[n] in order of first citation (the engine stores them as `result.quick.refs`), the answer split into text and
// citation groups, and the link that asks for a full review of the same question. The references are the screened
// papers the answer cites; nothing here invents a number or a source.
import type { Review, ReviewResult } from "./types";

/** The citation groups the engine writes ("[P1]", "[P1, P3]"), the same pattern as `support.ts` and the backend. */
const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;

export function isQuickReview(review: Pick<Review, "options" | "result"> | null | undefined): boolean {
  return review?.result?.mode === "quick" || review?.options?.mode === "quick";
}

/** The refs the answer cites, in order of first citation: `result.quick.refs`, else read from the shown answer. */
export function quickRefs(result: ReviewResult): string[] {
  if (result.quick?.refs?.length) return result.quick.refs;
  const out: string[] = [];
  for (const m of (result.summary ?? result.synthesis?.executive_summary ?? "").matchAll(CITE)) {
    for (const ref of m[1].split(/\s*,\s*/)) if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

export type QuickPart =
  | { kind: "text"; text: string }
  /** `marker`: the group's index in the text (Plan 25 ties marker k to its support claim) */
  | { kind: "cite"; refs: string[]; numbers: number[]; marker: number };

/** The answer as text and citation groups; each group's refs numbered by their place in `refs` (1-based). A ref that
 * is not in `refs` is left out of its group; a group left empty keeps its marker index but shows nothing. */
export function quickParts(text: string, refs: string[]): QuickPart[] {
  const parts: QuickPart[] = [];
  let at = 0;
  let marker = 0;
  for (const m of text.matchAll(CITE)) {
    if (m.index > at) parts.push({ kind: "text", text: text.slice(at, m.index) });
    const known = m[1].split(/\s*,\s*/).filter((r) => refs.includes(r));
    parts.push({ kind: "cite", refs: known, numbers: known.map((r) => refs.indexOf(r) + 1), marker });
    marker += 1;
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

/** The anchor of reference [n] in the quick answer's list. */
export const quickRefId = (n: number): string => `qref-${n}`;

/** "ทำรีวิวฉบับเต็ม": the request form with the same question, language, start year and study types, set to a full
 * review. The person submits it there (Turnstile, the rate limit and the report view live in the form). */
export function fullReviewHref(review: Pick<Review, "topic" | "language" | "options">): string {
  const params = new URLSearchParams({ q: review.topic, mode: "full", lang: review.language });
  const { year_from: year, study_types: types } = review.options ?? {};
  if (typeof year === "number") params.set("year", String(year));
  const list = Array.isArray(types) ? types.filter((t): t is string => typeof t === "string") : [];
  if (list.length) params.set("types", list.join("|"));
  return `/?${params.toString()}#request`;
}

/** The request form's starting values from the address (`?q=…&mode=…&lang=…&year=…&types=a|b`), each checked. */
export interface FormStart {
  topic?: string;
  mode?: "quick" | "full";
  language?: "th" | "en";
  yearFrom?: string;
  studyTypes?: string[];
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function formStart(params: Record<string, string | string[] | undefined>): FormStart {
  const topic = one(params.q)?.trim().slice(0, 600) || undefined;
  const mode = one(params.mode);
  const lang = one(params.lang);
  const year = one(params.year);
  const types = (one(params.types) ?? "").split("|").map((t) => t.trim().slice(0, 80)).filter(Boolean).slice(0, 10);
  return {
    topic,
    mode: mode === "quick" || mode === "full" ? mode : undefined,
    language: lang === "th" || lang === "en" ? lang : undefined,
    yearFrom: year && /^(19[5-9]\d|20\d\d)$/.test(year) ? year : undefined,
    studyTypes: types.length ? types : undefined,
  };
}
```

**Edit** `frontend/src/lib/i18n-report.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
      "No included study reports harms or adverse events in its abstract. Abstracts often leave harms out, so missing data is not evidence of safety."],
  },
} as const;
```

   with

```ts
      "No included study reports harms or adverse events in its abstract. Abstracts often leave harms out, so missing data is not evidence of safety."],
  },

  /** Plan 27: the quick answer page (components/review/quick-answer.tsx). */
  quick: {
    kind: ["ถามเร็ว", "Quick answer"],
    scope: (n: number): Pair => [`คำตอบสั้นจากบทคัดย่อของงานวิจัย ${n} ฉบับ อัตโนมัติ ไม่ใช่การทบทวนฉบับเต็ม และไม่ใช่คำแนะนำทางการแพทย์`,
      `A short answer from the abstracts of ${n} ${pl(n, "study", "studies")}; automated, not a full review and not medical advice.`],
    scopeNone: ["คำตอบสั้นจากบทคัดย่อ อัตโนมัติ ไม่ใช่การทบทวนฉบับเต็ม และไม่ใช่คำแนะนำทางการแพทย์",
      "A short answer from abstracts; automated, not a full review and not medical advice."],
    asked: ["คำถามที่คุณพิมพ์", "Your question"],
    answer: ["คำตอบ", "Answer"],
    refsTitle: ["เอกสารอ้างอิง", "References"],
    refsNote: ["เลขในวงเล็บชี้ไปที่งานวิจัยในรายการนี้ ทุกงานผ่านการคัดกรองแล้ว และตัวเลขในคำตอบตรวจกับบทคัดย่อแล้ว",
      "Each number in brackets points to a study in this list; every study passed screening and every number in the answer was checked against its abstract."],
    cite: (n: number): Pair => [`อ้างอิง ${n}`, `Reference ${n}`],
    citeChecked: (n: number): Pair => [`อ้างอิง ${n} ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้`, `Reference ${n} checked: the abstract supports this sentence`],
    noRefs: ["คำตอบนี้ไม่ได้อ้างอิงงานวิจัยใด", "This answer cites no study."],
    upgrade: ["ทำรีวิวฉบับเต็ม", "Run a full review"],
    upgradeHint: ["ค้นกว้างกว่า อ่านงานวิจัยมากกว่า และมีตาราง กราฟ และระดับหลักฐานครบ ส่งได้จากแบบฟอร์มที่กรอกคำถามนี้ไว้ให้แล้ว",
      "Searches wider, reads more studies and adds the tables, charts and certainty assessment; send it from the form, filled in with this question."],
  },
} as const;
```

**Edit** `frontend/src/components/review/references.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
export const referenceId = (ref: string): string => `ref-${ref}`;

/** The reference text with its identifiers as links (doi.org, PubMed, PubMed Central, the ThaiJO page); the text is never translated. */
function CitationText({ paper, lang }: { paper: Paper; lang: Lang }) {
  const { text, ids } = citationParts(paper);
  const opens = L(lang, R.newTab);
```

   with

```tsx
export const referenceId = (ref: string): string => `ref-${ref}`;

/** The reference text with its identifiers as links (doi.org, PubMed, PubMed Central, the ThaiJO page); the text is
 * never translated. Also the quick answer's reference list (Plan 27). */
export function CitationText({ paper, lang }: { paper: Paper; lang: Lang }) {
  const { text, ids } = citationParts(paper);
  const opens = L(lang, R.newTab);
```

**Edit** `frontend/src/components/review/report.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
 * an English report never shows a Thai header for a frame (fix round 1).
 */
function useDocumentLang(lang: Lang) {
  useLayoutEffect(() => {
    const root = document.documentElement;
```

   with

```tsx
 * an English report never shows a Thai header for a frame (fix round 1).
 */
export function useDocumentLang(lang: Lang) {
  useLayoutEffect(() => {
    const root = document.documentElement;
```

**New file** `frontend/src/components/review/quick-answer.tsx` (complete):

```tsx
"use client";

import Link from "next/link";
import { Fragment } from "react";
import type { Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { fullReviewHref, quickParts, quickRefId, quickRefs } from "@/lib/quick";
import { alignMarkers, citationOf, isChecked } from "@/lib/support";
import type { Paper, Review, ReviewResult, SupportClaim } from "@/lib/types";
import { ReportNotices } from "./audience";
import { citedQuestion } from "./report-cite";
import { CitationText } from "./references";
import { useDocumentLang } from "./report";
import { L, Lw } from "./text";

const Q = RC.quick;
const BUTTON = "inline-flex min-h-12 w-fit items-center rounded-sm border border-primary bg-primary px-6 font-display text-[1.05rem] font-semibold text-on-primary no-underline hover:brightness-110";

/** One citation group of the answer: "[1, 3]", each number a link to its reference, ✓ when the sentence-support
 * check found the sentence in that study's abstract with its numbers verified (Plan 25). */
function Cite({ refs, numbers, claim, byRef, lang }: {
  refs: string[]; numbers: number[]; claim: SupportClaim | null; byRef: Map<string, Paper>; lang: Lang;
}) {
  if (!numbers.length) return null;
  return (
    <span data-quick-cite className="nw font-display text-[0.92em]">
      [{numbers.map((n, i) => {
        const checked = isChecked(citationOf(claim, refs[i]), byRef.get(refs[i]), claim ?? undefined);
        return (
          <Fragment key={n}>
            {i > 0 && ", "}
            <a href={`#${quickRefId(n)}`} aria-label={L(lang, checked ? Q.citeChecked(n) : Q.cite(n))}
              className="font-semibold text-primary underline underline-offset-2">{n}</a>
            {checked && <span aria-hidden data-checked className="font-semibold text-ink">✓</span>}
          </Fragment>
        );
      })}]
    </span>
  );
}

/**
 * Plan 27: a quick answer ("ถามเร็ว"): the question, a fixed scope line, the public safety notices (Plan 26), the
 * 2–4 sentence answer with numbered citations, the certainty-and-limits line, the numbered references with their
 * PubMed, DOI, PubMed Central or ThaiJO links, and "ทำรีวิวฉบับเต็ม". One presentation (the public view's notices);
 * the text is shown in the language it was written in.
 */
export function QuickAnswer({ review }: { review: Review }) {
  const result: ReviewResult = review.result ?? {};
  const lang: Lang = (result.language ?? review.language) === "en" ? "en" : "th";
  useDocumentLang(lang);
  const refs = quickRefs(result);
  const byRef = new Map((result.papers ?? []).map((p) => [p.ref, p]));
  const text = result.summary ?? result.synthesis?.executive_summary ?? "";
  const closing = result.synthesis?.answer ?? "";
  const claims = alignMarkers(text, result.support);
  const parts = quickParts(text, refs);
  const anyChecked = parts.some((p) => p.kind === "cite" && p.refs.some((r) => {
    const claim = claims[p.marker] ?? null;
    return isChecked(citationOf(claim, r), byRef.get(r), claim ?? undefined);
  }));
  const question = citedQuestion(review, result, lang);
  const read = result.quick?.papers_read;
  return (
    <article data-quick-answer className="grid max-w-[75ch] gap-8 pt-12">
      <header className="grid gap-3">
        <h1 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-snug">{question}</h1>
        {question !== review.topic && (
          <p className="text-[0.95rem] text-muted"><span className="label mr-2">{L(lang, Q.asked)}</span>
            <span lang={fieldLang(review.topic, lang)}>{review.topic}</span></p>
        )}
        <p data-quick-scope className="rounded-sm bg-info-bg px-4 py-3 text-[0.92rem]">
          <span className="font-display font-semibold">{Lw(lang, Q.kind)}</span>
          {" · "}{L(lang, read != null ? Q.scope(read) : Q.scopeNone)}
        </p>
      </header>
      <ReportNotices result={result} audience="public" lang={lang} hasPapers={refs.length > 0} />
      <section aria-labelledby="quick-answer-h" className="grid gap-3">
        <h2 id="quick-answer-h" className="font-display text-[1.25rem] font-semibold">{Lw(lang, Q.answer)}</h2>
        <p data-quick-text className="text-[1.0625rem] leading-[1.75]" lang={fieldLang(text, lang)}>
          {parts.map((p, i) => (p.kind === "text"
            ? <Fragment key={i}>{p.text}</Fragment>
            : <Cite key={i} refs={p.refs} numbers={p.numbers} claim={claims[p.marker] ?? null} byRef={byRef} lang={lang} />))}
        </p>
        {closing && <p data-quick-closing className="text-[0.95rem]" lang={fieldLang(closing, lang)}>{closing}</p>}
        {anyChecked && <p className="text-[0.85rem] text-muted">✓ {L(lang, RC.support.state.checked)}</p>}
      </section>
      <section aria-labelledby="quick-refs-h" className="grid gap-2">
        <h2 id="quick-refs-h" className="font-display text-[1.25rem] font-semibold">{Lw(lang, Q.refsTitle)}</h2>
        {refs.length ? (
          <>
            <p className="text-[0.88rem] text-muted">{L(lang, Q.refsNote)}</p>
            <ol aria-label={L(lang, Q.refsTitle)} className="grid">
              {refs.map((ref, i) => {
                const paper = byRef.get(ref);
                return (
                  <li key={ref} id={quickRefId(i + 1)} tabIndex={-1} data-quick-ref={ref}
                    className="grid scroll-mt-24 grid-cols-[2.6rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-3 outline-none target:bg-ground">
                    <span className="pt-0.5 font-display font-semibold tabular-nums">[{i + 1}]</span>
                    {paper ? <CitationText paper={paper} lang={lang} /> : <span className="text-muted">{ref}</span>}
                  </li>
                );
              })}
            </ol>
          </>
        ) : <p className="text-muted">{L(lang, Q.noRefs)}</p>}
      </section>
      <div data-quick-upgrade className="grid gap-2 border-t border-rule pt-6">
        <Link href={fullReviewHref(review)} className={BUTTON}>{L(lang, Q.upgrade)}</Link>
        <p className="max-w-[65ch] text-[0.92rem] text-muted">{L(lang, Q.upgradeHint)}</p>
      </div>
    </article>
  );
}
```

**Edit** `frontend/src/components/review/review-screen.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { useEffect, useState } from "react";
import { getReview } from "@/lib/api";
import { FALLBACK_TITLE, isPersonalRefusal } from "@/lib/title";
import { readAudience, saveAudience } from "@/lib/use-audience";
import { useReview } from "@/lib/use-review";
import { LiveRun } from "./live-run";
import { Report } from "./report";
import { TerminalState } from "./terminal-state";
```

   with

```tsx
import { useEffect, useState } from "react";
import { getReview } from "@/lib/api";
import { isQuickReview } from "@/lib/quick";
import { FALLBACK_TITLE, isPersonalRefusal } from "@/lib/title";
import { readAudience, saveAudience } from "@/lib/use-audience";
import { useReview } from "@/lib/use-review";
import { LiveRun } from "./live-run";
import { QuickAnswer } from "./quick-answer";
import { Report } from "./report";
import { TerminalState } from "./terminal-state";
```

2. Replace

```tsx
      code={run.code ?? review?.refusal_code} />;
  }
  if (phase === "report" && review) {
    // Plan 26: the view comes from ?view= or the stored choice; a change is stored and put in the address
```

   with

```tsx
      code={run.code ?? review?.refusal_code} />;
  }
  if (phase === "report" && review && isQuickReview(review)) {
    return <QuickAnswer review={review} />; // Plan 27: the short answer with numbered references
  }
  if (phase === "report" && review) {
    // Plan 26: the view comes from ?view= or the stored choice; a change is stored and put in the address
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-27/frontend && npx vitest run src/lib/quick.test.ts src/components/review/quick-answer.test.tsx src/lib/i18n-report.test.ts`

Expected: 3 files, 58 tests passed.

- [ ] **Step 5: The full frontend suite, typecheck and lint**

Run: `cd /d/MRA-plan-27/frontend && npm test && npm run typecheck && npm run lint`

Expected: frontend 152 files, 1621 tests passed (pre-flight); typecheck and eslint clean.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(quick): the quick answer page with numbered references, the checked mark, the safety notices and the upgrade link (Plan 27)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-27 && git add frontend/src/test/fixtures.ts frontend/src/lib/quick.test.ts frontend/src/components/review/quick-answer.test.tsx frontend/src/lib/types.ts frontend/src/lib/quick.ts frontend/src/lib/i18n-report.ts frontend/src/components/review/references.tsx frontend/src/components/review/report.tsx frontend/src/components/review/quick-answer.tsx frontend/src/components/review/review-screen.tsx
git commit -F .superpowers/commit-msg.txt
```

---

### Task 5: Frontend — the request form's mode choice, the upgrade's start values and the e2e suite

**Files:**
- Modify: `frontend/src/lib/copy.ts`
- Modify: `frontend/src/components/landing/request-slip.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/review/live-run.tsx`
- Modify: `frontend/src/components/review/review-screen.tsx`
- Test (modify): `frontend/src/test/status-fixture.ts`
- Test (modify): `frontend/src/components/landing/request-slip.test.tsx`
- Test (modify): `frontend/src/components/review/live-run.test.tsx`
- Test (create): `frontend/e2e/quick.spec.ts`
- Test (modify): `frontend/e2e/app.spec.ts`
- Test (modify): `frontend/e2e/home-plain.spec.ts`
- Test (modify): `frontend/e2e/paper-count.spec.ts`

**Interfaces:**
- Consumes: `formStart`, `FormStart`, `isQuickReview` (Task 4); `/status` `limits.quick` (Task 1).
- Produces:
  - `QUICK_DURATION_TH = "ปกติใช้ราว 1 นาที"` (`src/lib/copy.ts`).
  - `RequestSlip({ initialTopic?, limits?, start? })`: the `data-mode-choice` fieldset "ต้องการคำตอบแบบไหน" (radios "ถามเร็ว (≈1 นาที)", checked by default, and "รีวิวฉบับเต็ม"); a quick answer hides step 2 and the slider and sends `options: {mode: "quick", year_from?, study_types?}`; a full review sends what it sent before.
  - `Home` passes `formStart(searchParams)`; `LiveRun` prop `quick?` (the quick duration); `ReviewScreen` passes it.

- [ ] **Step 1: Write the failing tests**

**Edit** `frontend/src/test/status-fixture.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
    max_papers: { min: 5, max: 50, default: 30 }, candidate_limit: { min: 20, max: 120, default: 120 },
    max_queued_reviews: 50, sse_max_per_ip: 5,
  },
};
```

   with

```ts
    max_papers: { min: 5, max: 50, default: 30 }, candidate_limit: { min: 20, max: 120, default: 120 },
    max_queued_reviews: 50, sse_max_per_ip: 5,
    modes: ["full", "quick"], quick: { max_papers: 8, candidate_limit: 30, review_type: "slr" }, // Plan 27
  },
};
```

**Edit** `frontend/src/components/landing/request-slip.test.tsx` (27 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { TYPICAL_DURATION_TH } from "@/lib/copy";
import { GLOSS, glossText } from "@/lib/glossary";
import { STATUS_FIXTURE } from "@/test/status-fixture";
```

   with

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { QUICK_DURATION_TH, TYPICAL_DURATION_TH } from "@/lib/copy";
import { GLOSS, glossText } from "@/lib/glossary";
import { STATUS_FIXTURE } from "@/test/status-fixture";
```

2. Replace

```tsx

const OPEN = STATUS_FIXTURE;

import { RequestSlip } from "./request-slip";
```

   with

```tsx

const OPEN = STATUS_FIXTURE;
// Plan 27: the form starts as a quick answer; the tests of the full review's options start it as a full review
const FULL = { mode: "full" } as const;

import { RequestSlip } from "./request-slip";
```

3. Replace

```tsx
  it("submits the topic with options and opens the review", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByLabelText("English"));
```

   with

```tsx
  it("submits the topic with options and opens the review", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    await user.click(screen.getByLabelText("English"));
```

4. Replace

```tsx

  it("takes the slider's range and starting value from /status (5–50, default 30)", async () => {
    render(<RequestSlip />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("min", "5");
```

   with

```tsx

  it("takes the slider's range and starting value from /status (5–50, default 30)", async () => {
    render(<RequestSlip start={FULL} />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("min", "5");
```

5. Replace

```tsx
  it("submits the count the slider is moved to", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    fireEvent.change(slider, { target: { value: "50" } });
```

   with

```tsx
  it("submits the count the slider is moved to", async () => {
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    fireEvent.change(slider, { target: { value: "50" } });
```

6. Replace

```tsx
  it("follows whatever maximum the service reports (never hard-coded)", async () => {
    getStatus.mockResolvedValue({ ...OPEN, limits: { ...OPEN.limits, max_papers: { min: 5, max: 40, default: 20 } } });
    render(<RequestSlip />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("max", "40");
```

   with

```tsx
  it("follows whatever maximum the service reports (never hard-coded)", async () => {
    getStatus.mockResolvedValue({ ...OPEN, limits: { ...OPEN.limits, max_papers: { min: 5, max: 40, default: 20 } } });
    render(<RequestSlip start={FULL} />);
    const slider = await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("max", "40");
```

7. Replace

```tsx
  it("uses the server-rendered limits before the browser's own status read lands", () => {
    getStatus.mockReturnValue(new Promise(() => {})); // never settles
    render(<RequestSlip limits={OPEN.limits} />);
    const slider = screen.getByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("max", "50");
```

   with

```tsx
  it("uses the server-rendered limits before the browser's own status read lands", () => {
    getStatus.mockReturnValue(new Promise(() => {})); // never settles
    render(<RequestSlip limits={OPEN.limits} start={FULL} />);
    const slider = screen.getByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" });
    expect(slider).toHaveAttribute("max", "50");
```

8. Replace

```tsx
    getStatus.mockRejectedValue(new ApiError(0, "network"));
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    expect(screen.queryByRole("slider")).toBeNull();
```

   with

```tsx
    getStatus.mockRejectedValue(new ApiError(0, "network"));
    createReview.mockResolvedValue({ review_id: "r-1", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    expect(screen.queryByRole("slider")).toBeNull();
```

9. Replace

```tsx
  it("tells people when the service is full and does not let them submit", async () => {
    getStatus.mockResolvedValue({ ...OPEN, accepting: false, reason: "daily_budget", retry_after: 3600 });
    render(<RequestSlip />);
    expect(await screen.findByRole("status")).toHaveTextContent("วันนี้");
    expect(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ })).toBeDisabled();
```

   with

```tsx
  it("tells people when the service is full and does not let them submit", async () => {
    getStatus.mockResolvedValue({ ...OPEN, accepting: false, reason: "daily_budget", retry_after: 3600 });
    render(<RequestSlip start={FULL} />);
    expect(await screen.findByRole("status")).toHaveTextContent("วันนี้");
    expect(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ })).toBeDisabled();
```

10. Replace

```tsx
  it("explains a full queue returned at submit time", async () => {
    createReview.mockRejectedValue(new ApiError(503, "the review queue is full", 60, undefined, "queue_full"));
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
```

   with

```tsx
  it("explains a full queue returned at submit time", async () => {
    createReview.mockRejectedValue(new ApiError(503, "the review queue is full", 60, undefined, "queue_full"));
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
```

11. Replace

```tsx
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    createReview.mockResolvedValue({ review_id: "r-2", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    // the status first (the button is also enabled before it arrives, when no Turnstile is known), then the token: the
```

   with

```tsx
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    createReview.mockResolvedValue({ review_id: "r-2", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    // the status first (the button is also enabled before it arrives, when no Turnstile is known), then the token: the
```

12. Replace

```tsx
  it("explains why it cannot submit when the Turnstile script is blocked", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip />);
    // the script is added by a passive effect that can run after the widget's container is on screen (the flake under
    // load, Task 9): wait for the script itself
```

   with

```tsx
  it("explains why it cannot submit when the Turnstile script is blocked", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip start={FULL} />);
    // the script is added by a passive effect that can run after the widget's container is on screen (the flake under
    // load, Task 9): wait for the script itself
```

13. Replace

```tsx
  it("names a momentary admission backlog honestly", async () => {
    createReview.mockRejectedValue(new ApiError(503, "too many submissions", 5, undefined, "busy"));
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
```

   with

```tsx
  it("names a momentary admission backlog honestly", async () => {
    createReview.mockRejectedValue(new ApiError(503, "too many submissions", 5, undefined, "busy"));
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
```

14. Replace

```tsx
  it("explains a rate limit with the wait time", async () => {
    createReview.mockRejectedValue(new ApiError(429, "rate limit exceeded", 1800));
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
```

   with

```tsx
  it("explains a rate limit with the wait time", async () => {
    createReview.mockRejectedValue(new ApiError(429, "rate limit exceeded", 1800));
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
```

15. Replace

```tsx

  it("example topics fill the slip instead of navigating", async () => {
    render(<RequestSlip />);
    await user.click(screen.getByRole("button", { name: "SGLT2 inhibitors and heart failure" }));
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("SGLT2 inhibitors and heart failure");
```

   with

```tsx

  it("example topics fill the slip instead of navigating", async () => {
    render(<RequestSlip start={FULL} />);
    await user.click(screen.getByRole("button", { name: "SGLT2 inhibitors and heart failure" }));
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("SGLT2 inhibitors and heart failure");
```

16. Replace

```tsx

  it("starts with an empty topic and a placeholder example", () => {
    render(<RequestSlip />);
    const topic = screen.getByLabelText(/คำถามหรือวัตถุประสงค์/);
    expect(topic).toHaveValue("");
```

   with

```tsx

  it("starts with an empty topic and a placeholder example", () => {
    render(<RequestSlip start={FULL} />);
    const topic = screen.getByLabelText(/คำถามหรือวัตถุประสงค์/);
    expect(topic).toHaveValue("");
```

17. Replace

```tsx
  it("says why the button is disabled while the Turnstile token is pending", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip />);
    await screen.findByTestId("turnstile");
    const button = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ });
```

   with

```tsx
  it("says why the button is disabled while the Turnstile token is pending", async () => {
    getStatus.mockResolvedValue({ ...OPEN, turnstile_site_key: "site-key" });
    render(<RequestSlip start={FULL} />);
    await screen.findByTestId("turnstile");
    const button = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ });
```

18. Replace

```tsx

  it("summarises the folded options as they change", async () => {
    render(<RequestSlip />);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    await waitFor(() => expect(summary).toHaveTextContent("ภาษาไทย · วิเคราะห์ 30 ฉบับ · ทุกปี"));
```

   with

```tsx

  it("summarises the folded options as they change", async () => {
    render(<RequestSlip start={FULL} />);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    await waitFor(() => expect(summary).toHaveTextContent("ภาษาไทย · วิเคราะห์ 30 ฉบับ · ทุกปี"));
```

19. Replace

```tsx

  it("shows the three numbered steps of the scope form", () => {
    render(<RequestSlip />);
    expect(screen.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" })).toBeInTheDocument();
    expect(screen.getByLabelText(/รูปแบบการทบทวน/)).toHaveValue("slr");
```

   with

```tsx

  it("shows the three numbered steps of the scope form", () => {
    render(<RequestSlip start={FULL} />);
    expect(screen.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" })).toBeInTheDocument();
    expect(screen.getByLabelText(/รูปแบบการทบทวน/)).toHaveValue("slr");
```

20. Replace

```tsx

  it("shows each study design as a tile: Thai name first, then the English term and its plain gloss", () => {
    render(<RequestSlip />);
    const group = screen.getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ });
    // the name is short (Thai name + term); the plain words are the description, so tabbing stays quick
```

   with

```tsx

  it("shows each study design as a tile: Thai name first, then the English term and its plain gloss", () => {
    render(<RequestSlip start={FULL} />);
    const group = screen.getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ });
    // the name is short (Thai name + term); the plain words are the description, so tabbing stays quick
```

21. Replace

```tsx

  it("marks the folded options as something that opens", () => {
    render(<RequestSlip />);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    expect(summary.querySelector("[data-chevron][aria-hidden=true]")).not.toBeNull();
```

   with

```tsx

  it("marks the folded options as something that opens", () => {
    render(<RequestSlip start={FULL} />);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    expect(summary.querySelector("[data-chevron][aria-hidden=true]")).not.toBeNull();
```

22. Replace

```tsx

  it("glosses PICO in the question hint and keeps only the typical duration in the submit row", () => {
    render(<RequestSlip />);
    expect(screen.getByText(/ลองคิดตาม/).textContent).toContain(glossText("pico"));
    const row = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }).closest("[data-testid=submit-row]");
```

   with

```tsx

  it("glosses PICO in the question hint and keeps only the typical duration in the submit row", () => {
    render(<RequestSlip start={FULL} />);
    expect(screen.getByText(/ลองคิดตาม/).textContent).toContain(glossText("pico"));
    const row = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }).closest("[data-testid=submit-row]");
```

23. Replace

```tsx
  it("sends the chosen review type", async () => {
    createReview.mockResolvedValue({ review_id: "r-4", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.selectOptions(screen.getByLabelText(/รูปแบบการทบทวน/), "meta_analysis");
```

   with

```tsx
  it("sends the chosen review type", async () => {
    createReview.mockResolvedValue({ review_id: "r-4", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    await user.selectOptions(screen.getByLabelText(/รูปแบบการทบทวน/), "meta_analysis");
```

24. Replace

```tsx
  it("sends a free-text other study type, capped at 60 characters", async () => {
    createReview.mockResolvedValue({ review_id: "r-5", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    expect(screen.queryByLabelText("ระบุชนิดงานวิจัยอื่น")).toBeNull();
```

   with

```tsx
  it("sends a free-text other study type, capped at 60 characters", async () => {
    createReview.mockResolvedValue({ review_id: "r-5", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    expect(screen.queryByLabelText("ระบุชนิดงานวิจัยอื่น")).toBeNull();
```

25. Replace

```tsx

  it("explains the limited support for qualitative and mixed-methods studies", async () => {
    render(<RequestSlip />);
    expect(screen.queryByText(/สรุปเป็นประเด็นจากบทคัดย่อ/)).toBeNull();
    await user.click(screen.getByLabelText(/Qualitative/));
```

   with

```tsx

  it("explains the limited support for qualitative and mixed-methods studies", async () => {
    render(<RequestSlip start={FULL} />);
    expect(screen.queryByText(/สรุปเป็นประเด็นจากบทคัดย่อ/)).toBeNull();
    await user.click(screen.getByLabelText(/Qualitative/));
```

26. Replace

```tsx
  it("sends English study-type values although the labels are Thai", async () => {
    createReview.mockResolvedValue({ review_id: "r-3", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByLabelText(/Cohort/));
```

   with

```tsx
  it("sends English study-type values although the labels are Thai", async () => {
    createReview.mockResolvedValue({ review_id: "r-3", status: "queued", cached: false });
    render(<RequestSlip start={FULL} />);
    await typeTopic();
    await user.click(screen.getByLabelText(/Cohort/));
```

27. Replace

```tsx
  });
});
```

   with

```tsx
  });
});

describe("RequestSlip: quick answer or full review (Plan 27)", () => {
  const quickRadio = () => screen.getByRole("radio", { name: /ถามเร็ว/ });
  const fullRadio = () => screen.getByRole("radio", { name: /รีวิวฉบับเต็ม/ });

  it("starts as a quick answer, with the paper count from /status in its description", async () => {
    render(<RequestSlip />);
    expect(screen.getByRole("group", { name: "ต้องการคำตอบแบบไหน" })).toBeInTheDocument();
    expect(quickRadio()).toBeChecked();
    expect(fullRadio()).not.toBeChecked();
    await waitFor(() => expect(quickRadio()).toHaveAccessibleDescription(/ที่เกี่ยวข้องที่สุด 8 ฉบับ พร้อมเลขอ้างอิง/));
  });

  it("hides the review type and the paper count for a quick answer, and keeps the study designs as step 2", async () => {
    render(<RequestSlip />);
    expect(screen.queryByLabelText(/รูปแบบการทบทวน/)).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("group", { name: /^2\s*หลักฐานและเกณฑ์คัดเลือก/ })).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }).closest("[data-testid=submit-row]");
    expect(row).toHaveTextContent(QUICK_DURATION_TH);
    const summary = screen.getByText("ตัวเลือกเพิ่มเติม").closest("summary") as HTMLElement;
    await waitFor(() => expect(summary).toHaveTextContent("ภาษาไทย · อ่าน 8 ฉบับ · ทุกปี"));
  });

  it("sends a quick answer with its mode and the eligibility only", async () => {
    createReview.mockResolvedValue({ review_id: "q-1", status: "queued", cached: false });
    render(<RequestSlip />);
    await typeTopic();
    await user.click(screen.getByLabelText(/Cohort/));
    await user.type(screen.getByLabelText(/ตั้งแต่ปี/), "2015");
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({
      topic: "statins and dementia", language: "th", options: { mode: "quick", year_from: 2015, study_types: ["Cohort"] },
    });
    expect(push).toHaveBeenCalledWith("/r/q-1");
  });

  it("switching to a full review shows its steps and sends no mode", async () => {
    createReview.mockResolvedValue({ review_id: "f-1", status: "queued", cached: false });
    render(<RequestSlip />);
    await user.click(fullRadio());
    expect(await screen.findByRole("slider", { name: "จำนวนงานวิจัยที่ต้องการวิเคราะห์" })).toBeInTheDocument();
    expect(screen.getByLabelText(/รูปแบบการทบทวน/)).toHaveValue("slr");
    await typeTopic();
    await user.click(screen.getByRole("button", { name: /ส่งให้เอเจนต์ทบทวน/ }));
    expect(createReview).toHaveBeenCalledWith({
      topic: "statins and dementia", language: "th", options: { max_papers: 30, review_type: "slr" },
    });
  });

  it("starts from the quick answer's upgrade link: full review, same question, language, year and designs", () => {
    render(<RequestSlip start={{ topic: "statins and dementia", mode: "full", language: "en", yearFrom: "2015",
      studyTypes: ["Cohort", "Other: Delphi study", "Unknown"] }} />);
    expect(fullRadio()).toBeChecked();
    expect(screen.getByLabelText(/คำถามหรือวัตถุประสงค์/)).toHaveValue("statins and dementia");
    expect(screen.getByLabelText("English")).toBeChecked();
    expect(screen.getByLabelText(/ตั้งแต่ปี/)).toHaveValue("2015");
    expect(screen.getByLabelText(/Cohort/)).toBeChecked();
    expect(screen.getByLabelText("ระบุชนิดงานวิจัยอื่น")).toHaveValue("Delphi study");
  });
});
```

**Edit** `frontend/src/components/review/live-run.test.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
    expect(container.querySelector(".num-verified")).toBeNull();
  });
});
```

   with

```tsx
    expect(container.querySelector(".num-verified")).toBeNull();
  });
});

describe("LiveRun for a quick answer (Plan 27)", () => {
  it("states the quick answer's expected time instead of the review's", () => {
    const { run, scene } = statesOf([["started", {}], ["screening", { batch: 10 }]]);
    const { unmount } = render(<LiveRun run={run} scene={scene} topic="x" connection="open" quick />);
    expect(document.body.textContent).toContain("ปกติใช้ราว 1 นาที");
    expect(document.body.textContent).not.toContain("ปกติใช้ 1–3 นาที");
    unmount();
    render(<LiveRun run={run} scene={scene} topic="x" connection="open" />);
    expect(document.body.textContent).toContain("ปกติใช้ 1–3 นาที");
  });
});
```

**New file** `frontend/e2e/quick.spec.ts` (complete):

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { quickReviewFixture } from "../src/test/fixtures";
import { json, mockApi } from "./mock-api";

// Plan 27: the quick answer ("ถามเร็ว") in the real app: the home form starts as a quick answer and sends its mode,
// the answer page shows the numbered references with their links, and "ทำรีวิวฉบับเต็ม" opens the form as a full
// review with the same question. Axe clean and no sideways scroll at 1440 and 390, light and dark.
const QID = quickReviewFixture.id;
const form = (page: Page) => page.getByRole("form", { name: "กำหนดขอบเขตการทบทวน" });

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

test("home: a quick question is the default, sends mode quick and opens its answer; the upgrade goes back as a full review", async ({ page }) => {
  let body: { options?: Record<string, unknown> } | null = null;
  await mockApi(page, {
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: QID, status: "queued", cached: false }); },
    [`GET /api/v1/reviews/${QID}`]: (route) => json(route, 200, quickReviewFixture),
  });
  await page.goto("/");
  await expect(form(page).getByRole("radio", { name: /ถามเร็ว/ })).toBeChecked();
  await expect(form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toHaveCount(0);
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
  await page.getByRole("button", { name: "ส่งให้เอเจนต์ทบทวน" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${QID}$`));
  expect(body!.options).toEqual({ mode: "quick" });

  const answer = page.locator("[data-quick-answer]");
  await expect(answer.getByRole("heading", { level: 1 })).toContainText("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
  await expect(answer.locator("[data-quick-text]")).toContainText("[1✓, 2]");
  const refs = answer.getByRole("list", { name: "เอกสารอ้างอิง" }).getByRole("listitem");
  await expect(refs).toHaveCount(3);
  await expect(refs.first().getByRole("link", { name: /PubMed 3000003/ })).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/3000003/");
  await answer.getByRole("link", { name: "อ้างอิง 3" }).click();
  await expect(page).toHaveURL(/#qref-3$/);

  await answer.getByRole("link", { name: "ทำรีวิวฉบับเต็ม" }).click();
  await expect(page).toHaveURL(/\/\?q=.*mode=full.*#request$/);
  await expect(form(page).getByRole("radio", { name: /รีวิวฉบับเต็ม/ })).toBeChecked();
  await expect(page.getByLabel(/คำถามหรือวัตถุประสงค์/)).toHaveValue(quickReviewFixture.topic);
  await expect(form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toBeVisible();
  await expect(form(page).getByLabel(/Cohort/)).toBeChecked();
});

for (const [width, height, scheme] of [[1440, 1000, "light"], [390, 844, "light"], [1440, 1000, "dark"], [390, 844, "dark"]] as const) {
  test(`quick answer page at ${width}px (${scheme}): no sideways scroll, axe-clean`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page, { [`GET /api/v1/reviews/${QID}`]: (route) => json(route, 200, quickReviewFixture) });
    await page.goto(`/r/${QID}`);
    await expect(page.locator("[data-quick-answer]")).toBeVisible();
    await expect(page.locator('[data-notice="guide"]')).toBeVisible();
    await noHorizontalScroll(page);
    await noSeriousA11y(page);
  });

  test(`home form in quick mode at ${width}px (${scheme}): no sideways scroll, axe-clean`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/");
    await expect(form(page).locator("[data-mode-choice]")).toBeVisible();
    await noHorizontalScroll(page);
    await noSeriousA11y(page);
  });
}
```

**Edit** `frontend/e2e/app.spec.ts` (3 replacements; each `old` occurs exactly once):

1. Replace

```ts
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/");
  const select = page.getByRole("combobox", { name: /รูปแบบการทบทวน/ });
  await expect(select).toHaveValue("slr");
```

   with

```ts
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/?mode=full"); // Plan 27: the review type belongs to the full review
  const select = page.getByRole("combobox", { name: /รูปแบบการทบทวน/ });
  await expect(select).toHaveValue("slr");
```

2. Replace

```ts
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: /รูปแบบการทบทวน/ }).selectOption("meta_analysis");
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
```

   with

```ts
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/?mode=full");
  await page.getByRole("combobox", { name: /รูปแบบการทบทวน/ }).selectOption("meta_analysis");
  await page.getByLabel(/คำถามหรือวัตถุประสงค์/).fill("metformin colorectal cancer");
```

3. Replace

```ts
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
```

   with

```ts
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?mode=full");
    await expect(page.getByRole("combobox", { name: /รูปแบบการทบทวน/ })).toBeVisible();
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
```

**Edit** `frontend/e2e/home-plain.spec.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
  for (const width of [1440, 1024, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const box = (await form(page).boundingBox())!;
    const main = (await page.locator("main").boundingBox())!;
```

   with

```ts
  for (const width of [1440, 1024, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?mode=full"); // Plan 27: the three steps of the full review
    const box = (await form(page).boundingBox())!;
    const main = (await page.locator("main").boundingBox())!;
```

2. Replace

```ts
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const left = (await form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ }).locator("xpath=..").boundingBox())!; // step 2 picker
  const right = (await form(page).getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ }).boundingBox())!;
```

   with

```ts
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=full");
  const left = (await form(page).getByRole("combobox", { name: /รูปแบบการทบทวน/ }).locator("xpath=..").boundingBox())!; // step 2 picker
  const right = (await form(page).getByRole("group", { name: /หลักฐานและเกณฑ์คัดเลือก/ }).boundingBox())!;
```

**Edit** `frontend/e2e/paper-count.spec.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/");
  await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
  const s = slider(page);
```

   with

```ts
    "POST /api/v1/reviews": (route) => { body = route.request().postDataJSON(); return json(route, 202, { review_id: RID, status: "queued", cached: false }); },
  });
  await page.goto("/?mode=full"); // Plan 27: the paper count belongs to the full review
  await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
  const s = slider(page);
```

2. Replace

```ts
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/");
    await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
    await expect(slider(page)).toBeVisible();
```

   with

```ts
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/?mode=full");
    await form(page).getByText("ตัวเลือกเพิ่มเติม").click();
    await expect(slider(page)).toBeVisible();
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-27/frontend && npx vitest run src/components/landing/request-slip.test.tsx src/components/review/live-run.test.tsx src/components/landing/refusals.test.tsx`

Expected: 6 failed: the new mode-choice tests in `request-slip.test.tsx` (no mode choice yet) and the quick duration test in `live-run.test.tsx`.

- [ ] **Step 3: Implement**

**Edit** `frontend/src/lib/copy.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
export const TYPICAL_DURATION_TH = "ปกติใช้ 1–3 นาที";
/** A paper handed to the readers but not finished: it may be read now or wait behind the LLM limit (never "in flight"). */
export const READING_OR_QUEUED = "กำลังอ่านหรือรอคิว";
```

   with

```ts
export const TYPICAL_DURATION_TH = "ปกติใช้ 1–3 นาที";
/** Plan 27: a quick answer's expected time (an estimate on the budget preset, not measured live). */
export const QUICK_DURATION_TH = "ปกติใช้ราว 1 นาที";
/** A paper handed to the readers but not finished: it may be read now or wait behind the LLM limit (never "in flight"). */
export const READING_OR_QUEUED = "กำลังอ่านหรือรอคิว";
```

**Edit** `frontend/src/components/landing/request-slip.tsx` (8 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { ApiError, createReview, getStatus } from "@/lib/api";
import { AUDIENCES, type Audience } from "@/lib/audience";
import { TYPICAL_DURATION_TH } from "@/lib/copy";
import { GLOSS } from "@/lib/glossary";
import { RC } from "@/lib/i18n-report";
import { usableLimits } from "@/lib/limits";
import { emergencyKind, type EmergencyKind } from "@/lib/refusal-copy";
import type { ReviewType, ServiceLimits, ServiceStatus } from "@/lib/types";
import { storeAudience, useStoredAudience } from "@/lib/use-audience";
import { DisclosureChevron } from "../ui/disclosure-chevron";
```

   with

```tsx
import { ApiError, createReview, getStatus } from "@/lib/api";
import { AUDIENCES, type Audience } from "@/lib/audience";
import { QUICK_DURATION_TH, TYPICAL_DURATION_TH } from "@/lib/copy";
import { GLOSS } from "@/lib/glossary";
import { RC } from "@/lib/i18n-report";
import { usableLimits } from "@/lib/limits";
import type { FormStart } from "@/lib/quick";
import { emergencyKind, type EmergencyKind } from "@/lib/refusal-copy";
import type { ReviewMode, ReviewType, ServiceLimits, ServiceStatus } from "@/lib/types";
import { storeAudience, useStoredAudience } from "@/lib/use-audience";
import { DisclosureChevron } from "../ui/disclosure-chevron";
```

2. Replace

```tsx
/** Plan 26: who the report is for (lib/audience.ts); remembered in this browser, never sent to the API. */
const audienceName = (a: Audience): string => RC.audience.name[a][0];

function waitText(seconds?: number): string {
```

   with

```tsx
/** Plan 26: who the report is for (lib/audience.ts); remembered in this browser, never sent to the API. */
const audienceName = (a: Audience): string => RC.audience.name[a][0];
const CANONICAL_TYPES: readonly string[] = STUDY_TYPES.map(([value]) => value);

/** Plan 27: the two ways to ask. The quick answer's paper count comes from /status (`limits.quick`), never from copy. */
function modeCopy(mode: ReviewMode, quickPapers?: number): { name: string; plain: string } {
  if (mode === "quick") {
    return { name: "ถามเร็ว (≈1 นาที)", plain: quickPapers
      ? `คำตอบสั้น 2–4 ประโยค จากบทคัดย่อของงานวิจัยที่เกี่ยวข้องที่สุด ${quickPapers} ฉบับ พร้อมเลขอ้างอิง`
      : "คำตอบสั้น 2–4 ประโยค จากบทคัดย่อของงานวิจัยที่เกี่ยวข้องที่สุด พร้อมเลขอ้างอิง" };
  }
  return { name: "รีวิวฉบับเต็ม", plain: "รายงานครบ ตารางเปรียบเทียบ กราฟ และระดับหลักฐาน เลือกรูปแบบและจำนวนงานวิจัยได้ ใช้เวลา 1–3 นาที" };
}

function waitText(seconds?: number): string {
```

3. Replace

```tsx
 * The paper-count slider's range and start come from /status (`limits`: server-rendered, then the browser's own read);
 * with no usable limits it is not shown and the request leaves the count to the API. */
export function RequestSlip({ initialTopic, limits: serverLimits }: { initialTopic?: string; limits?: ServiceLimits | null }) {
  const router = useRouter();
  const id = useId();
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [language, setLanguage] = useState<"th" | "en">("th");
  const [chosenPapers, setChosenPapers] = useState<number | null>(null); // null: the service default
  const [yearFrom, setYearFrom] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [otherOn, setOtherOn] = useState(false);
  const [other, setOther] = useState("");
  const [reviewType, setReviewType] = useState<ReviewType>("slr");
  const [busy, setBusy] = useState(false);
```

   with

```tsx
 * The paper-count slider's range and start come from /status (`limits`: server-rendered, then the browser's own read);
 * with no usable limits it is not shown and the request leaves the count to the API. */
export function RequestSlip({ initialTopic, limits: serverLimits, start }: {
  initialTopic?: string; limits?: ServiceLimits | null;
  /** Plan 27: starting values from the address (`?mode=full&…`, the quick answer's "ทำรีวิวฉบับเต็ม") */
  start?: FormStart;
}) {
  const router = useRouter();
  const id = useId();
  const startOther = start?.studyTypes?.find((t) => t.startsWith("Other: "))?.slice("Other: ".length) ?? "";
  const [topic, setTopic] = useState(initialTopic ?? start?.topic ?? "");
  const [mode, setMode] = useState<ReviewMode>(start?.mode ?? "quick"); // Plan 27: the public default
  const [language, setLanguage] = useState<"th" | "en">(start?.language ?? "th");
  const [chosenPapers, setChosenPapers] = useState<number | null>(null); // null: the service default
  const [yearFrom, setYearFrom] = useState(start?.yearFrom ?? "");
  const [types, setTypes] = useState<string[]>(() => (start?.studyTypes ?? []).filter((t) => CANONICAL_TYPES.includes(t)));
  const [otherOn, setOtherOn] = useState(!!startOther);
  const [other, setOther] = useState(startOther);
  const [reviewType, setReviewType] = useState<ReviewType>("slr");
  const [busy, setBusy] = useState(false);
```

4. Replace

```tsx
  const tokenPending = !!siteKey && !token && !widgetFailed;
  const limits = usableLimits(status?.limits) ?? usableLimits(serverLimits);
  const range = limits?.max_papers;
  const poolSize = limits?.candidate_limit.default;
  const maxPapers = range ? Math.min(range.max, Math.max(range.min, chosenPapers ?? range.default)) : null;
  const summary = [
    language === "th" ? "ภาษาไทย" : "English",
    ...(maxPapers != null ? [`วิเคราะห์ ${maxPapers} ฉบับ`] : []),
    yearFrom ? `ตั้งแต่ปี ${yearFrom}` : "ทุกปี",
  ].join(" · ");
```

   with

```tsx
  const tokenPending = !!siteKey && !token && !widgetFailed;
  const limits = usableLimits(status?.limits) ?? usableLimits(serverLimits);
  const quick = mode === "quick";
  const quickPapers = (status?.limits ?? serverLimits)?.quick?.max_papers;
  const range = quick ? undefined : limits?.max_papers; // a quick answer's count is fixed by the service
  const poolSize = limits?.candidate_limit.default;
  const maxPapers = range ? Math.min(range.max, Math.max(range.min, chosenPapers ?? range.default)) : null;
  const summary = [
    language === "th" ? "ภาษาไทย" : "English",
    ...(maxPapers != null ? [`วิเคราะห์ ${maxPapers} ฉบับ`] : quick && quickPapers ? [`อ่าน ${quickPapers} ฉบับ`] : []),
    yearFrom ? `ตั้งแต่ปี ${yearFrom}` : "ทุกปี",
  ].join(" · ");
```

5. Replace

```tsx
    storeAudience(audience);
    try {
      const options: Record<string, unknown> = { ...(maxPapers != null ? { max_papers: maxPapers } : {}), review_type: reviewType };
      if (yearFrom) options.year_from = Number(yearFrom);
      if (studyTypes.length) options.study_types = studyTypes;
```

   with

```tsx
    storeAudience(audience);
    try {
      // Plan 27: a quick answer sends only its mode and the eligibility; the service fixes its sizes and type
      const options: Record<string, unknown> = quick ? { mode: "quick" }
        : { ...(maxPapers != null ? { max_papers: maxPapers } : {}), review_type: reviewType };
      if (yearFrom) options.year_from = Number(yearFrom);
      if (studyTypes.length) options.study_types = studyTypes;
```

6. Replace

```tsx
          <h2 className="font-display text-[1.35rem] font-semibold">กำหนดขอบเขตการทบทวน</h2>
          <p className="text-[0.95rem] text-muted">
            ตอบ 3 ข้อแล้วกดส่ง <Gloss k="aiAgent" /> จะเริ่มค้นและอ่านให้ ข้อ 2 และ 3 ใช้ค่าเริ่มต้นได้เลยถ้ายังไม่แน่ใจ
          </p>
        </div>
        <div className="grid gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* From 1024px the question box grows to fill the column, so steps 1-2 end level with step 3's tiles. */}
```

   with

```tsx
          <h2 className="font-display text-[1.35rem] font-semibold">กำหนดขอบเขตการทบทวน</h2>
          <p className="text-[0.95rem] text-muted">
            {quick
              ? <>เลือกแบบคำตอบ ตอบ 2 ข้อแล้วกดส่ง <Gloss k="aiAgent" /> จะเริ่มค้นและอ่านให้ ข้อ 2 ใช้ค่าเริ่มต้นได้เลยถ้ายังไม่แน่ใจ</>
              : <>ตอบ 3 ข้อแล้วกดส่ง <Gloss k="aiAgent" /> จะเริ่มค้นและอ่านให้ ข้อ 2 และ 3 ใช้ค่าเริ่มต้นได้เลยถ้ายังไม่แน่ใจ</>}
          </p>
        </div>
        <fieldset data-mode-choice className="grid gap-2 border-b border-rule px-4 py-4 sm:px-6">
          <legend className="label float-left mb-2 p-0">ต้องการคำตอบแบบไหน</legend>
          <div className="clear-left grid gap-2 sm:grid-cols-2">
            {(["quick", "full"] as const).map((m) => {
              const copy = modeCopy(m, quickPapers);
              return (
                <label key={m} className={TILE}>
                  <input type="radio" name={`${id}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)}
                    className="mt-1 size-4 flex-none accent-primary" aria-describedby={`${id}-mode-${m}`} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="font-display font-semibold leading-snug">{copy.name}</span>
                    <span id={`${id}-mode-${m}`} className="text-[0.85rem] leading-snug text-muted">{segmented(copy.plain)}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* From 1024px the question box grows to fill the column, so steps 1-2 end level with step 3's tiles. */}
```

7. Replace

```tsx
              </p>
            </div>
            <div className="grid gap-2">
              <label className={STEP_HEADING} htmlFor={`${id}-type`}><StepNo n={2} />รูปแบบการทบทวน</label>
              <ReviewTypePicker id={`${id}-type`} value={reviewType} onChange={setReviewType} available={status?.limits?.review_types} />
            </div>
          </div>
          <fieldset className="grid min-w-0 content-start gap-3 lg:border-l lg:border-rule lg:pl-8">
            <legend className={`${STEP_HEADING} mb-2`}><StepNo n={3} />หลักฐานและเกณฑ์คัดเลือก</legend>
            <p className="text-[0.95rem] leading-[1.7] text-muted">ชนิดงานวิจัยที่ต้องการ เลือกได้หลายแบบ · <span className="nw">ไม่เลือก = ไม่จำกัดชนิดงานวิจัย</span></p>
            {/* Equal-height rows only where the tiles form a grid (640–1023px); a one-column list keeps natural heights. */}
```

   with

```tsx
              </p>
            </div>
            {!quick && ( // a quick answer is always a short systematic search (Plan 27)
              <div className="grid gap-2">
                <label className={STEP_HEADING} htmlFor={`${id}-type`}><StepNo n={2} />รูปแบบการทบทวน</label>
                <ReviewTypePicker id={`${id}-type`} value={reviewType} onChange={setReviewType} available={status?.limits?.review_types} />
              </div>
            )}
          </div>
          <fieldset className="grid min-w-0 content-start gap-3 lg:border-l lg:border-rule lg:pl-8">
            <legend className={`${STEP_HEADING} mb-2`}><StepNo n={quick ? 2 : 3} />หลักฐานและเกณฑ์คัดเลือก</legend>
            <p className="text-[0.95rem] leading-[1.7] text-muted">ชนิดงานวิจัยที่ต้องการ เลือกได้หลายแบบ · <span className="nw">ไม่เลือก = ไม่จำกัดชนิดงานวิจัย</span></p>
            {/* Equal-height rows only where the tiles form a grid (640–1023px); a one-column list keeps natural heights. */}
```

8. Replace

```tsx
        </details>
        <div data-testid="submit-row" className="flex flex-col gap-3 border-t border-rule px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[0.92rem] text-muted">{TYPICAL_DURATION_TH} และจะเห็นว่าระบบตีความคำถามอย่างไรก่อนเริ่มค้น</p>
          <button type="submit" disabled={busy || closed || (!!siteKey && !token)}
            aria-describedby={tokenPending ? `${id}-wait` : undefined}
```

   with

```tsx
        </details>
        <div data-testid="submit-row" className="flex flex-col gap-3 border-t border-rule px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[0.92rem] text-muted">{quick ? QUICK_DURATION_TH : TYPICAL_DURATION_TH} และจะเห็นว่าระบบตีความคำถามอย่างไรก่อนเริ่มค้น</p>
          <button type="submit" disabled={busy || closed || (!!siteKey && !token)}
            aria-describedby={tokenPending ? `${id}-wait` : undefined}
```

**Edit** `frontend/src/app/page.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { RequestSlip } from "@/components/landing/request-slip";
import { SampleBench } from "@/components/landing/sample-bench";
import { getServerStatus } from "@/lib/server-api";

export default async function Home(props: PageProps<"/">) {
  const { q } = await props.searchParams;
  const initialTopic = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 600) || undefined;
  const limits = (await getServerStatus())?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
```

   with

```tsx
import { RequestSlip } from "@/components/landing/request-slip";
import { SampleBench } from "@/components/landing/sample-bench";
import { formStart } from "@/lib/quick";
import { getServerStatus } from "@/lib/server-api";

export default async function Home(props: PageProps<"/">) {
  // ?q= (a retry or an example) and, since Plan 27, the quick answer's "ทำรีวิวฉบับเต็ม" (?mode=full&lang=&year=&types=)
  const start = formStart(await props.searchParams);
  const limits = (await getServerStatus())?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
```

2. Replace

```tsx
      <div className="grid gap-8 pt-12">
        <WhatItIs />
        <RequestSlip initialTopic={initialTopic} limits={limits} />
      </div>
      <SampleBench />
```

   with

```tsx
      <div className="grid gap-8 pt-12">
        <WhatItIs />
        <RequestSlip start={start} limits={limits} />
      </div>
      <SampleBench />
```

**Edit** `frontend/src/components/review/live-run.tsx` (3 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { formatElapsed, type Scene } from "@/lib/agent-scene";
import { isReviewType, showsDirection } from "@/lib/review-type";
import { AS_READ_TH, READING_OR_QUEUED, TYPICAL_DURATION_TH } from "@/lib/copy";
import { readCounts, STEPS, type RunState, type StepKey } from "@/lib/progress";
import type { Connection } from "@/lib/use-review";
```

   with

```tsx
import { formatElapsed, type Scene } from "@/lib/agent-scene";
import { isReviewType, showsDirection } from "@/lib/review-type";
import { AS_READ_TH, QUICK_DURATION_TH, READING_OR_QUEUED, TYPICAL_DURATION_TH } from "@/lib/copy";
import { readCounts, STEPS, type RunState, type StepKey } from "@/lib/progress";
import type { Connection } from "@/lib/use-review";
```

2. Replace

```tsx

/** What the agent is doing right now: the agent stage, and a text ledger of steps, counts and each paper read. */
export function LiveRun({ run, scene, topic, connection, queuePosition, startedAt, reviewType }: {
  run: RunState; scene: Scene; topic: string; connection: Connection; queuePosition?: number | null; startedAt?: string | null;
  reviewType?: unknown; // review.options.review_type (unvalidated JSON)
}) {
  const [clock, setClock] = useState(() => Date.now());
```

   with

```tsx

/** What the agent is doing right now: the agent stage, and a text ledger of steps, counts and each paper read. */
export function LiveRun({ run, scene, topic, connection, queuePosition, startedAt, reviewType, quick = false }: {
  run: RunState; scene: Scene; topic: string; connection: Connection; queuePosition?: number | null; startedAt?: string | null;
  reviewType?: unknown; // review.options.review_type (unvalidated JSON)
  quick?: boolean; // Plan 27: a quick answer, with its own expected time
}) {
  const [clock, setClock] = useState(() => Date.now());
```

3. Replace

```tsx
                  : null}
            </span>
            {!waiting && <>ผ่านไป <span className="font-display tabular-nums">{formatElapsed(elapsed)}</span> · {TYPICAL_DURATION_TH}</>}
          </p>
          {(connection === "reconnecting" || connection === "polling") && (
```

   with

```tsx
                  : null}
            </span>
            {!waiting && <>ผ่านไป <span className="font-display tabular-nums">{formatElapsed(elapsed)}</span> · {quick ? QUICK_DURATION_TH : TYPICAL_DURATION_TH}</>}
          </p>
          {(connection === "reconnecting" || connection === "polling") && (
```

**Edit** `frontend/src/components/review/review-screen.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
  }
  return <LiveRun run={run} scene={scene} topic={topic} connection={connection} queuePosition={queuePosition} startedAt={review?.started_at}
    reviewType={review?.options?.review_type} />;
}
```

   with

```tsx
  }
  return <LiveRun run={run} scene={scene} topic={topic} connection={connection} queuePosition={queuePosition} startedAt={review?.started_at}
    reviewType={review?.options?.review_type} quick={isQuickReview(review)} />;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-27/frontend && npx vitest run src/components/landing/request-slip.test.tsx src/components/review/live-run.test.tsx src/components/landing/refusals.test.tsx`

Expected: 3 files, 66 tests passed.

- [ ] **Step 5: The full frontend suite, typecheck, lint and the whole e2e suite**

Run: `cd /d/MRA-plan-27/frontend && npm test && npm run typecheck && npm run lint`
Run: `cd /d/MRA-plan-27/frontend && npm run e2e` (it builds the app and serves it on port 3100 with a mocked API; nothing else may hold port 3100; Docker is not used)

Expected: frontend 152 files, 1627 tests passed (pre-flight); typecheck and eslint clean; e2e 453 passed, 1 skipped (pre-flight, about 4 min). The form now starts as a quick answer, so every e2e test of the full review's options opens `/?mode=full` (the three specs above); a new failure elsewhere means a test still assumes the full form: open it with `?mode=full` too and report it.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(quick): the request form asks quick by default, the upgrade opens it as a full review, the live page's quick duration (Plan 27)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-27 && git add frontend/src/test/status-fixture.ts frontend/src/components/landing/request-slip.test.tsx frontend/src/components/review/live-run.test.tsx frontend/e2e/quick.spec.ts frontend/e2e/app.spec.ts frontend/e2e/home-plain.spec.ts frontend/e2e/paper-count.spec.ts frontend/src/lib/copy.ts frontend/src/components/landing/request-slip.tsx frontend/src/app/page.tsx frontend/src/components/review/live-run.tsx frontend/src/components/review/review-screen.tsx
git commit -F .superpowers/commit-msg.txt
```

---

### Task 6: Docs and final checks

**Files:**
- Modify: `docs/api.md`, `DESIGN.md`, `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`
- Test (modify): `backend/tests/unit/test_api_docs_limits.py`

**Interfaces:**
- Consumes: the mode, limits, result fields, tool and pages of Tasks 1–5.
- Produces: the "Quick answer (Plan 27)" section of `docs/api.md` (and the `prompt_version` header, the `mode` field rule, the result keys, the `/status` example, the MCP rows and the event note), the DESIGN.md mode choice, quick answer page and log row, roadmap row 27 marked built; two docs tests (the documented quick limits, the documented `prompt_version`).

This task ends at the docs commit and the final checks. The merge, the root `CLAUDE.md` convention line, the docker
rebuild and the smoke check are done by the controller afterwards (see "After the plan (controller)" below); the
implementer does none of them.

- [ ] **Step 1: Docs**

**Edit** `docs/api.md` (7 replacements; each `old` occurs exactly once):

1. Replace

```markdown
# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-13.2`, API/MCP version 0.8.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
- It turns your topic or question into a structured question (PICO, or PCC for scoping reviews), searches eight scholarly sources, screens about 120 candidate papers that have abstracts, and analyses the abstracts of the 5–50 you choose (default 30). It never fetches full text.
- Four review types: systematic review (`slr`, default), meta-analysis (`meta_analysis`), scoping review (`scoping`) and narrative review (`narrative`).
- Every number it shows is checked against the abstract it came from. A number that cannot be checked is left empty, never estimated. The only numbers the system computes itself are meta-analysis pooled estimates, and they are always labelled as computed.
- Borderline papers get a second screening vote, and every paper a second, independent extraction, from a model of a different family (`result.models`: `screener_secondary`, `extractor_secondary`). When a deployment configures the same model for both, that second pass is skipped rather than repeated, and an escalation never goes back to a model that already answered.
```

   with

```markdown
# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-13.3`, API/MCP version 0.8.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
- It turns your topic or question into a structured question (PICO, or PCC for scoping reviews), searches eight scholarly sources, screens about 120 candidate papers that have abstracts, and analyses the abstracts of the 5–50 you choose (default 30). It never fetches full text.
- Four review types: systematic review (`slr`, default), meta-analysis (`meta_analysis`), scoping review (`scoping`) and narrative review (`narrative`).
- Two modes (Plan 27): the full review (`full`, default) and the quick answer (`quick`, "ถามเร็ว"): a 2–4 sentence answer with numbered references from a small pool (see "Quick answer (Plan 27)").
- Every number it shows is checked against the abstract it came from. A number that cannot be checked is left empty, never estimated. The only numbers the system computes itself are meta-analysis pooled estimates, and they are always labelled as computed.
- Borderline papers get a second screening vote, and every paper a second, independent extraction, from a model of a different family (`result.models`: `screener_secondary`, `extractor_secondary`). When a deployment configures the same model for both, that second pass is skipped rather than repeated, and an escalation never goes back to a model that already answered.
```

2. Replace

```markdown
- `language`: `th` (default) or `en`.
- `review_type`: `slr` (default, systematic review), `narrative`, `scoping` or `meta_analysis` (Plan 14b: a systematic review plus pooled effects). Anything else gets 422. It is part of the cache key. The allowed values are in `GET /api/v1/status → limits.review_types`.
- `max_papers`: 5–50, default 30. How many papers are analysed (see "Paper count and pool"). REST rejects 4 or 51 with 422; the MCP `start_review` tool clamps into 5–50 instead.
- `candidate_limit`: 20–120, default 120. Must be at least `max_papers`.
```

   with

```markdown
- `language`: `th` (default) or `en`.
- `review_type`: `slr` (default, systematic review), `narrative`, `scoping` or `meta_analysis` (Plan 14b: a systematic review plus pooled effects). Anything else gets 422. It is part of the cache key. The allowed values are in `GET /api/v1/status → limits.review_types`.
- `mode` (Plan 27): `full` (default) or `quick`. Anything else gets 422. It is part of the cache key, so a quick answer and a full review of one topic are separate reviews. With `quick` the service sets `review_type`, `max_papers` and `candidate_limit` to `limits.quick` of `GET /api/v1/status` (whatever the request sends for them); `year_from` and `study_types` apply as below.
- `max_papers`: 5–50, default 30. How many papers are analysed (see "Paper count and pool"). REST rejects 4 or 51 with 422; the MCP `start_review` tool clamps into 5–50 instead.
- `candidate_limit`: 20–120, default 120. Must be at least `max_papers`.
```

3. Replace

```markdown
  for every other status.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`, and since Plan 25 `support` (see "Sentence support (Plan 25)").

**Answer and key findings (Plan 20).** `synthesis` (and `synthesis_en`) also has:
```

   with

```markdown
  for every other status.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`, since Plan 25 `support` (see "Sentence support (Plan 25)"), and since Plan 27 `mode` (`full` or `quick`) and `quick` (null for a full review; see "Quick answer (Plan 27)").

**Answer and key findings (Plan 20).** `synthesis` (and `synthesis_en`) also has:
```

4. Replace

````markdown
            "review_types": ["narrative", "slr", "scoping", "meta_analysis"],
            "max_papers": {"min": 5, "max": 50, "default": 30}, "candidate_limit": {"min": 20, "max": 120, "default": 120},
            "max_queued_reviews": 50, "sse_max_per_ip": 5}}
```

````

   with

````markdown
            "review_types": ["narrative", "slr", "scoping", "meta_analysis"],
            "max_papers": {"min": 5, "max": 50, "default": 30}, "candidate_limit": {"min": 20, "max": 120, "default": 120},
            "max_queued_reviews": 50, "sse_max_per_ip": 5,
            "modes": ["full", "quick"], "quick": {"max_papers": 8, "candidate_limit": 30, "review_type": "slr"}}}
```

````

5. Replace

```markdown
harness, the owner's call.

## Event stream (SSE)

```

   with

```markdown
harness, the owner's call.

## Quick answer (Plan 27)

"ถามเร็ว": a short, referenced answer for the public and the bedside, from the same engine on a small pool.
- **Request.** `options.mode: "quick"` on `POST /api/v1/reviews`, `start_review(mode="quick")` or the `quick_answer` MCP tool. The service screens `limits.quick.candidate_limit` candidates (30) and reads the `limits.quick.max_papers` (8) most relevant as a systematic review (`review_type` `slr`, graded); `year_from` and `study_types` apply. While ThaiJO is on (Plan 24), it adds at most 3 of the 30 candidates (1/8 of the pool). The guard, the red-flag pass (Plan 26), screening with its second vote, dual extraction and number verification all run as in a full review.
- **Skipped.** No external MCP tools, no citation network (`citations` null), no pooled analysis, no conflict explanations, no card translation (cards stay in English) and no narrative report.
- **Writer.** One call writes 2–4 English sentences, each ending with its `[Pn]` citations, and one sentence on the main limitation. Code keeps only citations of papers read as evidence, removes a sentence with a number, measure or population its cited cards do not support (the full review's prose checks), drops a sentence without a citation or one that claims another certainty level, and keeps at most 4. When nothing is left the answer is a fixed "withheld" notice; when the call fails, a fixed failure notice. At most one repair round, no escalation.
- **Result.** `mode: "quick"`, `summary` = `synthesis.executive_summary` = the answer (shown language; `synthesis_en` holds the English), `synthesis.answer` = the closing line: the fixed certainty sentence of the GRADE-lite baseline (computed in code, never the model's; `evidence_strength` = `grade_baseline`) then the limits sentence, or "not graded" for qualitative studies only. `comparison`, `consensus`, `conflicts`, `key_findings` and `research_gaps` are empty. `quick: {refs, papers_read}`: the cited refs in order of first citation (reference `[k]` is `refs[k-1]`) and the number of evidence papers the answer was written from. `papers`, `stats`, `question`, `methods` and `support` (Plan 25, which checks the answer's sentences) are as in a full review.
- **Numbers.** Only numbers verified against the abstracts (`app/harness/verify.py`) can stay in the answer; translation keeps them unchanged.
- **Cost and limits.** One review against the same hourly rate limit, key quota, queue and daily counters as a full review. Its cost cap is the usual formula with the quick sizes: 0.04 + 0.006 × 8 + 0.0005 × 30 = $0.103 (defaults); expected spend about $0.02 on `budget`. Admission reserves that cap for a new quick answer; queued reviews are reserved at the worst case, as before.
- **Time.** About 45–75 s on `budget` (an estimate, not measured live: search, screening 3 batches, reading 8 papers in one wave, writing and translating).
- **Exports.** `export?format=md` and `review://{id}/report.md` give "# Quick answer: …", the answer with `[1]…[n]`, the closing line, a scope note and the numbered references. `csv` and `json` are as for any review.
- **Web.** The home form starts as a quick answer; `/r/{id}` shows the answer, the numbered references (links to PubMed, DOI, PubMed Central or ThaiJO), the public safety notices (Plan 26) and "ทำรีวิวฉบับเต็ม", which opens the form as a full review with the same question, language, start year and study types.

## Event stream (SSE)

```

6. Replace

```markdown
With `GRAPH_MODE=stub` and `STUB_DELAY_SECONDS>0` the stub emits the same sequence on a scaled timeline.

## Webhooks

```

   with

```markdown
With `GRAPH_MODE=stub` and `STUB_DELAY_SECONDS>0` the stub emits the same sequence on a scaled timeline.

A quick answer (Plan 27) sends the same events, with fewer `screening` and `reading` events, never `citations_fetched`, `external_lookup` or `pooled`.

## Webhooks

```

7. Replace

```markdown
|---|---|---|
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews (never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None)` | `{review_id, status, cached, status_url}`; for a topic that reads as an emergency `{review_id: null, status: "refused", code: "emergency", kind, hotlines, message, message_th}` (Plan 26) | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. Capacity errors include the reason and the wait time |
| `get_review_status(review_id)` | `{review_id, status, error, refusal_code, created_at, finished_at}` | poll until `done`, `error`, `rejected` or `cancelled`; `refusal_code` as in REST (Plan 26) |
| `get_review_result(review_id)` | `{review_id, status, result}` | The `result` shape is the same as REST: `citations` and, for `meta_analysis`, `meta_analysis`. If the review is not done: `{…, result: null, message, error, refusal_code}` |
```

   with

```markdown
|---|---|---|
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews (never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None, mode="full")` | `{review_id, status, cached, status_url}`; for a topic that reads as an emergency `{review_id: null, status: "refused", code: "emergency", kind, hotlines, message, message_th}` (Plan 26) | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. `mode` (Plan 27): `full` or `quick`; with `quick` the service sets the type and both sizes. Capacity errors include the reason and the wait time |
| `quick_answer(topic, language="th", study_types=None, year_from=None, wait_seconds=60)` | `{review_id, status, cached, status_url}` plus, once done, `{answer, closing, certainty, papers_read, references: [{n, ref, citation, links: [{label, url}]}]}`; still running: `message`; ended otherwise: `error`, `refusal_code`; an emergency: the `refused` result of `start_review` | Plan 27. Starts (or reuses) a quick answer and waits up to `wait_seconds` (0–90) for it, checking every 2 s. `answer` has the `[Pn]` groups renumbered `[1]…[n]` by first citation; `references[n-1]` is reference `[n]`, with links to doi.org, PubMed, PubMed Central or ThaiJO. One review against the same limits as `start_review` |
| `get_review_status(review_id)` | `{review_id, status, error, refusal_code, created_at, finished_at}` | poll until `done`, `error`, `rejected` or `cancelled`; `refusal_code` as in REST (Plan 26) |
| `get_review_result(review_id)` | `{review_id, status, result}` | The `result` shape is the same as REST: `citations` and, for `meta_analysis`, `meta_analysis`. If the review is not done: `{…, result: null, message, error, refusal_code}` |
```

**Edit** `DESIGN.md` (2 replacements; each `old` occurs exactly once):

1. Replace

```markdown
- **Report notices (Plan 26):** `aside` boxes (named by their label, 2px corners, `label` heading, reading size 0.92rem) between the audience switch and the bottom line: "ก่อนอ่านรายงานนี้" on `info-bg` (public view), "ไม่ใช่คำแนะนำเรื่องขนาดยา" and "ข้อมูลด้านอันตรายไม่ครบ" on `warning-bg` (every view, when they apply), "บริบทของประเทศไทย" on `rail` (bedside and committee). A learning note ("อ่านเพื่อเรียนรู้", `rail`) follows the summary table, selection, risk of bias and agree/conflict sections in the learner view. Fixed copy only; never a table-of-contents entry; printed.
- **Emergency answer (Plan 26):** a topic that reads as an emergency gets, in the request form's error slot, an `err-bg` block (`role="alert"`) with a short title ("อาจเป็นภาวะฉุกเฉิน โทร 1669 ทันที", or "คุณไม่ได้อยู่คนเดียว" for self-harm), the fixed message and call buttons (`tel:` links in `primary`, 48px): "โทร 1323 สายด่วนสุขภาพจิต" first for self-harm, then "โทร 1669 บริการการแพทย์ฉุกเฉิน". It never repeats what was typed.
- **Personal-question page (Plan 26):** a review the guard refused as `personal_medical` shows "คำถามนี้เป็นเรื่องเฉพาะของคุณ", the fixed message (which names 1669 and 1323), a hint to ask about a group instead, call buttons for 1669 and 1323 and "ถามคำถามใหม่"; no topic label, no model reason and no "แก้หัวข้อแล้วส่งใหม่" link.
- **Findings by study (comparison matrix):** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border. A qualitative or mixed-methods study's cell is a theme, not a direction: a small bordered word mark "พบ"/"found" (`font-display` semibold 0.75rem, 1px `ink` border, 2px corners, `aria-hidden`; the cell's aria-label says "พบประเด็นนี้ (งานเชิงคุณภาพ ไม่มีทิศทางผล)"), and the row header adds "พบใน k การศึกษา" in `muted`. The legend lists the mark next to the glyphs. Themes are counted, never called "supports". The concept map shows them as one neutral "พบใน k การศึกษา" group (pin marker, no direction colour), and the bottom line and live board count them aside ("…สรุปเป็นประเด็น ไม่นับตามทิศทางผล").
```

   with

```markdown
- **Report notices (Plan 26):** `aside` boxes (named by their label, 2px corners, `label` heading, reading size 0.92rem) between the audience switch and the bottom line: "ก่อนอ่านรายงานนี้" on `info-bg` (public view), "ไม่ใช่คำแนะนำเรื่องขนาดยา" and "ข้อมูลด้านอันตรายไม่ครบ" on `warning-bg` (every view, when they apply), "บริบทของประเทศไทย" on `rail` (bedside and committee). A learning note ("อ่านเพื่อเรียนรู้", `rail`) follows the summary table, selection, risk of bias and agree/conflict sections in the learner view. Fixed copy only; never a table-of-contents entry; printed.
- **Emergency answer (Plan 26):** a topic that reads as an emergency gets, in the request form's error slot, an `err-bg` block (`role="alert"`) with a short title ("อาจเป็นภาวะฉุกเฉิน โทร 1669 ทันที", or "คุณไม่ได้อยู่คนเดียว" for self-harm), the fixed message and call buttons (`tel:` links in `primary`, 48px): "โทร 1323 สายด่วนสุขภาพจิต" first for self-harm, then "โทร 1669 บริการการแพทย์ฉุกเฉิน". It never repeats what was typed.
- **Mode choice (Plan 27):** the first fieldset of the request form, "ต้องการคำตอบแบบไหน": two radio tiles in the study-design tile style (≥44px, `ground` fill, 1px `rule` border, checked = `primary` border on `rail`), "ถามเร็ว (≈1 นาที)" (checked by default) and "รีวิวฉบับเต็ม", each with its plain description (the quick answer's paper count from `/status` `limits.quick`, never hard-coded). A quick answer hides step 2 (review type) and the paper-count slider, so the study designs become step 2; the submit row states its expected time. `?mode=full` (the quick page's upgrade) starts it as a full review.
- **Quick answer page (Plan 27):** `/r/{id}` of a quick answer: the question as the H1, "คำถามที่คุณพิมพ์" when it differs, an `info-bg` scope line ("ถามเร็ว · คำตอบสั้นจากบทคัดย่อของงานวิจัย n ฉบับ … ไม่ใช่การทบทวนฉบับเต็ม"), the public view's notices (Plan 26), "คำตอบ" at the reading size with citation groups as `[1, 2]` (each number a `primary` link to its reference, the "ตรวจแล้ว" ✓ in `ink` after a number whose citation passed the support check, named in the link), the certainty-and-limits line, "เอกสารอ้างอิง" as a numbered ruled list (`[n]` in the display face, then the Vancouver reference with DOI/PubMed/PMC/ThaiJO links), and the "ทำรีวิวฉบับเต็ม" primary button with a muted hint. One presentation (no audience switch), at most 75 characters wide, no rail, no number face (numbers stay in the text as checked).
- **Personal-question page (Plan 26):** a review the guard refused as `personal_medical` shows "คำถามนี้เป็นเรื่องเฉพาะของคุณ", the fixed message (which names 1669 and 1323), a hint to ask about a group instead, call buttons for 1669 and 1323 and "ถามคำถามใหม่"; no topic label, no model reason and no "แก้หัวข้อแล้วส่งใหม่" link.
- **Findings by study (comparison matrix):** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border. A qualitative or mixed-methods study's cell is a theme, not a direction: a small bordered word mark "พบ"/"found" (`font-display` semibold 0.75rem, 1px `ink` border, 2px corners, `aria-hidden`; the cell's aria-label says "พบประเด็นนี้ (งานเชิงคุณภาพ ไม่มีทิศทางผล)"), and the row header adds "พบใน k การศึกษา" in `muted`. The legend lists the mark next to the glyphs. Themes are counted, never called "supports". The concept map shows them as one neutral "พบใน k การศึกษา" group (pin marker, no direction colour), and the bottom line and live board count them aside ("…สรุปเป็นประเด็น ไม่นับตามทิศทางผล").
```

2. Replace

```markdown
| 2026-10-13 | Plan 25: the "ตรวจแล้ว" citation mark and "ทำไมจึงอ้างอิงงานนี้" in the rail | Verifiable trust (roadmap section 4) needs more than verified numbers: a reader can now see the abstract sentence behind a citation. The mark is a compact ✓ so prose stays readable, with the full word in its accessible name, the legend and the rail; the rail shows the English sentence that was checked (the check runs before translation) and says "not found" plainly. No new tokens |
| 2026-10-13 | Plan 26: audience views, report notices, the emergency answer and the personal-question page | One engine, four presentations (roadmap section 4): a view reorders sections and adds fixed notes, so every audience reads the same checked content. Safety copy is fixed text in boxes the reader cannot miss, with call links where a number matters; the public is the default because the service is free and public. No new tokens |
```

   with

```markdown
| 2026-10-13 | Plan 25: the "ตรวจแล้ว" citation mark and "ทำไมจึงอ้างอิงงานนี้" in the rail | Verifiable trust (roadmap section 4) needs more than verified numbers: a reader can now see the abstract sentence behind a citation. The mark is a compact ✓ so prose stays readable, with the full word in its accessible name, the legend and the rail; the rail shows the English sentence that was checked (the check runs before translation) and says "not found" plainly. No new tokens |
| 2026-10-13 | Plan 26: audience views, report notices, the emergency answer and the personal-question page | One engine, four presentations (roadmap section 4): a view reorders sections and adds fixed notes, so every audience reads the same checked content. Safety copy is fixed text in boxes the reader cannot miss, with call links where a number matters; the public is the default because the service is free and public. No new tokens |
| 2026-10-13 | Plan 27: the quick answer ("ถามเร็ว") as the request form's default, on its own short page | The public and the bedside need a short referenced answer first, and it costs about a third of a full review; the full report stays one click away ("ทำรีวิวฉบับเต็ม"). Built from existing tokens and the reference list's own component. No new tokens |
```

**Edit** `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (1 replacement; each `old` occurs exactly once):

1. Replace

```markdown
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify). **Built (2026-10-13):** candidates chosen in code from the cited abstract, one judge call per review on the screener's model (soft-fail, budget-aware), the badge only when supported with verified numbers, the rail's "ทำไมจึงอ้างอิงงานนี้", and two harness rows (support rate, badge share); `prompt_version` 2026-10-13.1. Measuring it on real reviews is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-25-sentence-support-design.md` | Safety for every audience; publishable |
| 26 | Audience modes (public, bedside, learner, committee) and **public safety rails** (personal-symptom questions go to a doctor or 1669; no dosing advice; harms gaps stated). **Built (2026-10-13):** an emergency topic is refused in code before any spend (1669, and 1323 for self-harm; REST 422 and MCP `refused` with `code: "emergency"`); the topic guard's `personal_medical` category ends a personal question with a fixed message (`refusal_code`); four report views in the web UI only (not in the cache key); harms-gap and dosing notices in every view; `prompt_version` 2026-10-13.2. Measuring the guard on real questions is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-26-audience-safety-design.md` | Needed once the public uses it |
| 27 | Quick answer mode ("ถามเร็ว", Evidence Finder style): about 30 candidates → about 8 read, a 2–4 sentence answer with numbered refs [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, and a "ทำรีวิวฉบับเต็ม" button | Bedside use and the public; keeps the free service affordable |
| 28 | Thai clinical terminology **by harness engineering only**: a larger glossary (Royal Institute medical terms, edited in the admin console), the 22a glossary check enforced in `localize` with a retry like the number check, measured on the 22a harness. No Thai-tuned model, no fine-tuning | Thai quality, measured by Plan 22 |
| 29 | Thai practice context (NLEM status from a dated data file, and a curated index of Thai clinical practice guidelines; context only) | The Apply step for Thailand |
```

   with

```markdown
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify). **Built (2026-10-13):** candidates chosen in code from the cited abstract, one judge call per review on the screener's model (soft-fail, budget-aware), the badge only when supported with verified numbers, the rail's "ทำไมจึงอ้างอิงงานนี้", and two harness rows (support rate, badge share); `prompt_version` 2026-10-13.1. Measuring it on real reviews is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-25-sentence-support-design.md` | Safety for every audience; publishable |
| 26 | Audience modes (public, bedside, learner, committee) and **public safety rails** (personal-symptom questions go to a doctor or 1669; no dosing advice; harms gaps stated). **Built (2026-10-13):** an emergency topic is refused in code before any spend (1669, and 1323 for self-harm; REST 422 and MCP `refused` with `code: "emergency"`); the topic guard's `personal_medical` category ends a personal question with a fixed message (`refusal_code`); four report views in the web UI only (not in the cache key); harms-gap and dosing notices in every view; `prompt_version` 2026-10-13.2. Measuring the guard on real questions is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-26-audience-safety-design.md` | Needed once the public uses it |
| 27 | Quick answer mode ("ถามเร็ว", Evidence Finder style): about 30 candidates → about 8 read, a 2–4 sentence answer with numbered refs [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, and a "ทำรีวิวฉบับเต็ม" button. **Built (2026-10-13):** `options.mode: "quick"` (cache key; 30 → 8, SLR, graded), the same engine without external tools, citations, pools, conflict notes or card translation, one writer call checked by the prose rules, the certainty line from the GRADE-lite baseline, the sentence-support check; the home form defaults to it; the MCP `quick_answer` tool; `prompt_version` 2026-10-13.3. Expected about $0.02 and 45–75 s per answer (not measured live: a paid run, the owner's call). Spec: `../specs/2026-10-13-plan-27-quick-answer-design.md` | Bedside use and the public; keeps the free service affordable |
| 28 | Thai clinical terminology **by harness engineering only**: a larger glossary (Royal Institute medical terms, edited in the admin console), the 22a glossary check enforced in `localize` with a retry like the number check, measured on the 22a harness. No Thai-tuned model, no fine-tuning | Thai quality, measured by Plan 22 |
| 29 | Thai practice context (NLEM status from a dated data file, and a curated index of Thai clinical practice guidelines; context only) | The Apply step for Thailand |
```

**Edit** `backend/tests/unit/test_api_docs_limits.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    text = API_MD.read_text(encoding="utf-8")
    assert not re.search(r"~60|about 60|5[-–]30\b", text)
```

   with

```python
    text = API_MD.read_text(encoding="utf-8")
    assert not re.search(r"~60|about 60|5[-–]30\b", text)


def test_status_example_lists_the_quick_limits():
    # Plan 27: the documented quick sizes are the service's own
    from app.schemas.review import (
        QUICK_CANDIDATE_LIMIT,
        QUICK_MAX_PAPERS,
        QUICK_REVIEW_TYPE,
        REVIEW_MODES,
    )
    limits = _status_example()["limits"]
    assert limits["modes"] == list(REVIEW_MODES)
    assert limits["quick"] == {"max_papers": QUICK_MAX_PAPERS, "candidate_limit": QUICK_CANDIDATE_LIMIT,
                               "review_type": QUICK_REVIEW_TYPE}


def test_the_docs_name_the_current_prompt_version():
    from app.config import Settings
    assert f"prompt_version {Settings(_env_file=None).prompt_version}`" in API_MD.read_text(encoding="utf-8")
```

Then run: `cd /d/MRA-plan-27/backend && uv run pytest tests/unit/test_api_docs_limits.py tests/unit/test_openapi_docs.py -q`

Expected: 8 passed (never write a range like "5–30" in new text: `test_docs_have_no_stale_paper_counts` reads it as an old paper count).

- [ ] **Step 2: Final checks on the branch**

Run: `cd /d/MRA-plan-27/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-27/frontend && npm test && npm run typecheck && npm run lint && npm run e2e`

Expected: all pass (pre-flight: backend 2537 passed, 17 skipped, ruff clean; frontend 152 files, 1627 tests, typecheck and eslint clean (see the known flaky timeouts above); e2e 453 passed, 1 skipped). Integration tests are unchanged by this plan; run them only if Postgres is up (`MRA_INTEGRATION=1 uv run pytest -m integration -q`) and report the result or why they were not run.

- [ ] **Step 3: Commit**

Write the message with the Write tool to `D:\MRA-plan-27\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
docs(quick): API reference, DESIGN.md mode choice and quick page, roadmap 27 built (Plan 27)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-27 && git add docs/api.md DESIGN.md docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md backend/tests/unit/test_api_docs_limits.py
git commit -F .superpowers/commit-msg.txt
```

---

## After the plan (controller)

Not part of any task: the controller does these after the whole-branch review, in its own session.
- **Merge** `plan-27-quick-answer` into master with `--no-ff`. The main worktree's uncommitted owner entries (for
  example `infra/searxng/limiter.toml.new`) are never staged or changed.
- **Root `CLAUDE.md`:** add the convention line to the committed file only (the owner may have working-tree edits):

```text
- Quick answer (Plan 27): `options.mode` `full | quick` (cache key); a quick answer is fixed at `QUICK_CANDIDATE_LIMIT` 30 → `QUICK_MAX_PAPERS` 8, `slr` (`app/schemas/review.py`, published in `/status` `limits.quick`), shares every limit and counter with full reviews, and its cost cap is the usual formula with those sizes. It reads without external tools or citations and goes `normalize_outcomes → write_quick_answer` (`app/graph/nodes/quick.py`, prompt pinned): 2–4 cited sentences checked by the full review's citation and prose rules, the certainty line from the GRADE-lite baseline, stored in the Synthesis shape so localize, check_support and finalize are unchanged; `result.quick.refs` numbers the references [1]…[n]. The web form starts as a quick answer; `?mode=full` restores a full review. MCP: `start_review(mode=…)`, `quick_answer`.
```

- **Docker rebuild and the smoke check, spending nothing.** No real review is started and no LLM is called; never POST
  a quick or full request to a live deployment here (it would start a real, paid review). The script validates a
  quick request, compares cache keys and runs the **stub** graph (`GRAPH_MODE=stub` inside the script only,
  `STUB_DELAY_SECONDS=1`) on a quick answer; it needs no database, queue or model. Write it with the Write tool to
  `D:\MedicalReviewerAgent\.superpowers\smoke27.py` (git-ignored; no heredoc), copy it into the api container, run
  it, then delete both copies.

```python
import asyncio

from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state
from app.schemas.review import CreateReviewRequest, compute_cache_key
from app.services.report import quick_view

TOPIC = "statins and dementia"


async def stub_quick(options: dict) -> tuple[list[str], dict]:
    """The timed stub graph (GRAPH_MODE=stub, no model call) runs a quick answer end to end."""
    graph = build_graph(GraphDeps(settings=Settings(graph_mode="stub", stub_delay_seconds=1.0)),
                        checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "smoke27"}}
    types = []
    async for _mode, chunk in graph.astream(initial_state("smoke27", TOPIC, "en", options), config,
                                            stream_mode=["custom"]):
        types.append(chunk.get("type"))
    return types, (await graph.aget_state(config)).values["result"]


def main():
    print("prompt_version", Settings().prompt_version)
    quick = CreateReviewRequest(topic=TOPIC, options={"mode": "quick", "max_papers": 50, "review_type": "scoping"})
    o = quick.options
    print("options", o.mode, o.max_papers, o.candidate_limit, o.review_type)
    full = CreateReviewRequest(topic=TOPIC).options.model_dump()
    print("cache keys differ", compute_cache_key(TOPIC, "th", full, "v") != compute_cache_key(TOPIC, "th", o.model_dump(), "v"))
    types, result = asyncio.run(stub_quick(o.model_dump()))
    view = quick_view(result)
    print("stub", result["mode"], result["quick"], "citations_fetched" in types, types[-1])
    print("answer", view["answer"])
    print("references", [(r["n"], r["ref"]) for r in view["references"]])


main()
```

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d
docker compose ps                                                                       # api healthy, worker up
docker compose exec -T worker python -c "from app.config import Settings; print(Settings().prompt_version)"   # 2026-10-13.3
curl -s http://localhost:8088/api/v1/status | python -c "import json,sys; l=json.load(sys.stdin)['limits']; print(l['modes'], l['quick'])"
docker compose cp .superpowers/smoke27.py api:/tmp/smoke27.py
docker compose exec -T api python /tmp/smoke27.py
docker compose exec -T api rm /tmp/smoke27.py && rm .superpowers/smoke27.py
docker compose exec -T web sh -c 'grep -rl "data-quick-answer" .next 2>/dev/null | head -1'   # the quick page is in the build
docker compose exec -T web sh -c 'grep -rl "data-mode-choice" .next 2>/dev/null | head -1'    # the form's mode choice too
```

Expected:
- `2026-10-13.3` from the worker and `prompt_version 2026-10-13.3` from the script;
- the status line `['full', 'quick'] {'max_papers': 8, 'candidate_limit': 30, 'review_type': 'slr'}`;
- `options quick 8 30 slr` (the request asked for 50 papers and a scoping review: both replaced), `cache keys differ True`;
- `stub quick {'refs': ['P1', 'P3', 'P4'], 'papers_read': 5} False finalizing`;
- `answer Simulated studies suggest that statins and dementia may improve the primary outcome [1, 2]. One simulated cohort reports the opposite direction [3].`;
- `references [(1, 'P1'), (2, 'P3'), (3, 'P4')]`;
- a path under `.next` for each grep.

- **Record:** remove the worktree (keep the branch) and update the memory notes: Plan 27 merged; `prompt_version`
  2026-10-13.3; quick answers are `options.mode: "quick"` (30 → 8, SLR), the form's default; expected about $0.02
  and 45–75 s each on `budget` (not measured live; a paid batch, the owner's call).
