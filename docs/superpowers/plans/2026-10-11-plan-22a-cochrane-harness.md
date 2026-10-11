# Plan 22a: Cochrane harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reproducible, offline-replayable benchmark of the review engine on 60 Cochrane reviews. It reports Thai share, glossary consistency, numbers preserved, number verification, citation precision, stability, failures and cost per `prompt_version`. Slots for the gold standard are ready for 22b.

**Architecture:** Every Cochrane topic gets a frozen candidate pool, made once by running the intake and retrieval nodes with a year cutoff. Eval runs replay each pool through a graph that starts at screening and uses the production nodes from screening onward, then write one JSON file per review per repeat. A pure metrics and report layer reads those files. The production pipeline gets counting-only hooks: a citation tally contextvar, localization rejection counters, a pool-cutoff filter reachable only from eval state, and a pure glossary check.

**Tech Stack:** Python 3.12, LangGraph (`StateGraph`, `InMemorySaver`), pydantic v2, httpx via `app.services.http.HttpClient`, Europe PMC REST, pytest with the fakes in `tests/fakes.py` and `tests/unit/test_review_graph.py`.

**Spec:** `docs/superpowers/specs/2026-10-11-plan-22-cochrane-benchmark-design.md` (22a only). Roadmap: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`.

## Global Constraints

- Run tests from `backend/`: `uv run pytest` (unit); integration tests need `MRA_INTEGRATION=1 uv run pytest -m integration` with docker compose up.
- Repositories never commit; callers use `async with session.begin()`. The eval needs no DB.
- Structured LLM calls go through the harness runner (`app/harness/runner.py`, `HarnessRunner.call(llm, system, user, schema=..., validate=...)`), never raw provider clients.
- No prompt or schema change to the review graph in 22a. `prompt_version` (`app/config.py`) stays `2026-10-11.1`, and `tests/unit/test_prompts_by_type.py` pins must stay green.
- Abstract-only: the eval never fetches full text. Cochrane data comes from Cochrane abstracts (Europe PMC `resultType=core`).
- Fixtures and run files contain third-party abstracts. They live under `backend/evals/cochrane/fixtures/` and `backend/evals/cochrane/runs/`, which are git-ignored. Commit manifest, protocol, gold, reports and code only.
- The `year_to` cutoff is set only through eval state (`eval_year_to`). It is never a `ReviewOptions` field and never in the public API.
- Failed reviews stay in every denominator (intention-to-treat).
- Files are LF. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `plan-22-cochrane-benchmark` (it already holds the spec commits).
- Deviation from the spec, recorded in Task 10: the sampling frame uses the Europe PMC REST search (same Cochrane records, abstracts in one call, no NCBI key or rate limit) instead of PubMed E-utilities.

## Review Focus

1. **A run that crashes mid-batch** (budget cap, LLM outage, Ctrl-C): rerunning `run` must skip finished files and redo only missing ones, and a half-written file must never be read as finished (atomic write). Tested in Task 7.
2. **A candidate with `year=None` under a cutoff:** it must be kept (unknown year is not "after"), exactly as `year_from` treats it. Tested in Task 1.
3. **A Thai item that was kept in English** (localization fallback): the glossary check must skip it, not count it as a miss, and Thai share must still count it. Tested in Task 4.
4. **A review whose engine output has no comparison row for the primary outcome:** `primary_match` must be `none`, and stability must still pair r1 and r2 (two `none`s agree). Tested in Tasks 6 and 9.
5. **A Cochrane abstract without a stated search date:** `select` must mark it ineligible with the reason "no search date", never guess a year. Tested in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/graph/state.py` (modify) | Add `eval_year_to: int \| None` |
| `backend/app/graph/nodes/retrieval.py` (modify) | `_filter_pool(..., year_to=None)`; `enrich` passes `state.get("eval_year_to")`; stats `after_cutoff` |
| `backend/app/harness/citation_tally.py` (create) | Contextvar tally of proposed and stripped `[Pn]` refs |
| `backend/app/harness/verify.py` (modify) | `strip_unknown_citations` records into the tally |
| `backend/app/harness/localize.py` (modify) | `Localized.numbers_rejected`, `citations_rejected` counters |
| `backend/app/harness/quality.py` (modify) | Sum the new localize counters |
| `backend/app/harness/glossary_check.py` (create) | Parse the glossary; pure consistency check |
| `backend/app/graph/graph.py` (modify) | Share the screening→finalize wiring; add `build_eval_graph` and `build_freeze_graph` |
| `backend/app/evals/__init__.py` (create) | Package marker |
| `backend/app/evals/models.py` (create) | Pydantic models: `Stratum`, `ManifestEntry`, `Manifest`, `Fixture`, `PrimaryMatch`, `RunRecord`, `GoldRecord`; paths; atomic JSON/YAML IO |
| `backend/app/evals/freeze.py` (create) | Freeze one review into a `Fixture` |
| `backend/app/evals/run.py` (create) | Replay one fixture; budget, tally, primary-outcome match |
| `backend/app/evals/select.py` (create) | Sampling frame from Europe PMC, seeded draw, LLM eligibility |
| `backend/app/evals/metrics.py` (create) | Per-review metrics, aggregates, Wilson CI, stability |
| `backend/app/evals/report.py` (create) | Markdown report, `--compare` deltas, 22b placeholders |
| `backend/app/cli/eval.py` (create) | `python -m app.cli.eval select\|freeze\|run\|report` |
| `backend/evals/cochrane/manifest.yaml` (create) | Seed, strata, (later) the 60 entries |
| `backend/evals/cochrane/PROTOCOL.md` (create) | Pre-registration text |
| `.gitignore` (modify) | Ignore fixtures/ and runs/ |
| `CLAUDE.md`, spec, roadmap (modify) | Commands, rules, deviation note |
| Tests: `backend/tests/unit/test_eval_*.py`, `backend/tests/integration/test_eval_live.py` | |

---

### Task 1: `year_to` cutoff in the candidate pool

**Files:**
- Modify: `backend/app/graph/state.py`
- Modify: `backend/app/graph/nodes/retrieval.py` (`_filter_pool` at ~262, `make_enrich` at ~342)
- Test: `backend/tests/unit/test_eval_year_cutoff.py`

**Interfaces:**
- Produces: `ReviewState["eval_year_to"]: int | None`.
- Produces: `_filter_pool(cands, options, terms, year_to: int | None = None) -> tuple[list[Candidate], dict]`. The returned counts dict gains `"after_cutoff": int`.
- Produces: `enrich` output `search_stats["after_cutoff"]`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_year_cutoff.py
from app.graph.nodes.retrieval import _filter_pool
from app.graph.schemas import Candidate
from app.schemas.review import ReviewOptions

ABSTRACT = "Results: " + "x " * 120


def cand(i, year):
    return Candidate(title=f"Paper {i}", abstract=ABSTRACT, abstract_source="europepmc", year=year, doi=f"10.1/{i}")


def test_year_to_drops_later_papers_and_keeps_unknown_years():
    pool, counts = _filter_pool([cand(1, 2019), cand(2, 2023), cand(3, 2024), cand(4, None)],
                                ReviewOptions(), [], year_to=2023)
    assert [c.title for c in pool] == ["Paper 1", "Paper 2", "Paper 4"]
    assert counts["after_cutoff"] == 1


def test_no_year_to_keeps_everything():
    pool, counts = _filter_pool([cand(1, 2030)], ReviewOptions(), [])
    assert len(pool) == 1 and counts["after_cutoff"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_year_cutoff.py -v`
Expected: FAIL with `TypeError: _filter_pool() got an unexpected keyword argument 'year_to'`.

- [ ] **Step 3: Implement**

In `state.py`, add inside `ReviewState`:

```python
    eval_year_to: int | None  # Plan 22a eval only: drop candidates published after this year (Cochrane search date)
```

In `retrieval.py`, change `_filter_pool`:

```python
def _filter_pool(cands: list[Candidate], options: ReviewOptions, terms: list[str],
                 year_to: int | None = None) -> tuple[list[Candidate], dict]:
    """Year, non-research, abstract and focus filters, in that order; the search rank order is kept. `year_to` is set
    only by the Plan 22a eval (a Cochrane review's search year); unknown years are kept, as for `year_from`."""
    year_excluded = 0
    if options.year_from:
        before = len(cands)
        cands = [c for c in cands if c.year is None or c.year >= options.year_from]
        year_excluded = before - len(cands)
    after_cutoff = 0
    if year_to is not None:
        before = len(cands)
        cands = [c for c in cands if c.year is None or c.year <= year_to]
        after_cutoff = before - len(cands)
```

Add `"after_cutoff": after_cutoff` to the returned counts dict. In `make_enrich`, read the cutoff once and pass it to both `_filter_pool` calls:

```python
        year_to = state.get("eval_year_to")
        pool, counts = _filter_pool(enriched, options, terms, year_to)
        ...
            pool, counts = _filter_pool(enriched, options, terms, year_to)
```

Add `"after_cutoff": counts["after_cutoff"]` to the `search_stats` dict that `enrich` returns.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_year_cutoff.py tests/unit/test_review_graph.py -v`
Expected: PASS (the review graph tests confirm no production change).

- [ ] **Step 5: Commit**

```bash
git add backend/app/graph/state.py backend/app/graph/nodes/retrieval.py backend/tests/unit/test_eval_year_cutoff.py
git commit -m "feat(eval): year_to pool cutoff reachable only from eval state (Plan 22a Task 1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Localization rejection counters (numbers preserved)

**Files:**
- Modify: `backend/app/harness/localize.py` (`Localized`, `localize_strings.run`)
- Modify: `backend/app/harness/quality.py` (the `extra["localize"]` block)
- Test: `backend/tests/unit/test_eval_localize_counters.py`

**Interfaces:**
- Produces: the `Localized.telemetry()` keys `numbers_rejected` and `citations_rejected` (ints). They count the items whose returned translation `accept()` refused, split by cause.
- Produces: `result.quality.localize` keys `numbers_rejected` and `citations_rejected`, alongside `untranslated`, `retried` and `citations_restored`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_localize_counters.py
import pytest

from app.graph.schemas import TranslationBatch, TranslationItem
from app.harness.localize import localize_strings
from app.harness.quality import summarize_quality
from app.harness.runner import HarnessRunner
from tests.fakes import FakeStructuredLLM


def translator(system, user):
    # item a keeps its number; item b changes 0.80 to 0.8; item c drops its citation
    return TranslationBatch(items=[
        TranslationItem(id="a", text="อัตราการเสียชีวิตลดลง 12% [P1]"),
        TranslationItem(id="b", text="อัตราส่วนฮาซาร์ด 0.8 [P2]"),
        TranslationItem(id="c", text="อุบัติการณ์ลดลงในกลุ่มที่ได้รับยา"),
    ])


@pytest.mark.asyncio
async def test_rejections_are_counted_by_cause():
    llm = FakeStructuredLLM("loc", translator)
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), {
        "a": "Mortality fell by 12% [P1]", "b": "Hazard ratio 0.80 [P2]", "c": "Incidence fell in the drug group [P3]",
    }, "th", retry_max_items=0)
    t = res.telemetry()
    assert t["numbers_rejected"] == 1 and t["citations_rejected"] == 1
    assert res.strings["a"].startswith("อัตรา") and res.strings["b"] == "Hazard ratio 0.80 [P2]"


def test_summarize_quality_sums_new_counters():
    q = summarize_quality([{"stage": "localize", "numbers_rejected": 2, "citations_rejected": 1},
                           {"stage": "localize_cards", "numbers_rejected": 1}], None)
    assert q["localize"]["numbers_rejected"] == 3 and q["localize"]["citations_rejected"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_localize_counters.py -v`
Expected: FAIL with `KeyError: 'numbers_rejected'`.

- [ ] **Step 3: Implement**

In `localize.py`, add to `Localized`:

```python
    numbers_rejected: int = 0  # returned translations refused because a number changed (numbers_preserved)
    citations_rejected: int = 0  # refused because the [Pn] citations changed and could not be restored

    def telemetry(self) -> dict[str, int]:
        return {"kept_english": self.kept_english, "untranslated": self.untranslated, "retried": self.retried,
                "citations_restored": self.citations_restored, "numbers_rejected": self.numbers_rejected,
                "citations_rejected": self.citations_rejected}
```

In `run()` inside `localize_strings`, replace the warning branch:

```python
                elif got.get(key):
                    if numbers_preserved(source, got[key]):
                        out.citations_rejected += 1
                    else:
                        out.numbers_rejected += 1
                    log.warning("localize item %s: numbers or citations changed, kept English", key)
```

In `quality.py`, widen the key tuple:

```python
        extra["localize"] = {k: sum(int(e.get(k, 0)) for e in localized)
                             for k in ("untranslated", "retried", "citations_restored",
                                       "numbers_rejected", "citations_rejected")}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_localize_counters.py tests/unit/test_harness_localize.py tests/unit/test_review_graph.py -v`
Expected: PASS. If an existing test asserts the exact `telemetry()` dict or the exact `quality["localize"]` dict, update that expectation to include the two new zero-valued keys. That is a shape change only.

- [ ] **Step 5: Commit**

```bash
git add backend/app/harness/localize.py backend/app/harness/quality.py backend/tests/unit/test_eval_localize_counters.py backend/tests/unit/test_harness_localize.py
git commit -m "feat(eval): count translations refused for changed numbers or citations (Plan 22a Task 2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Citation tally (citation precision)

**Files:**
- Create: `backend/app/harness/citation_tally.py`
- Modify: `backend/app/harness/verify.py:618` (`strip_unknown_citations`)
- Test: `backend/tests/unit/test_eval_citation_tally.py`

**Interfaces:**
- Produces: `CitationTally` (dataclass with `proposed: int = 0` and `stripped: int = 0`).
- Produces: `use_tally(tally) -> ContextManager`, and `current_tally() -> CitationTally | None`.
- Behaviour: every `strip_unknown_citations(text, allowed)` call made inside `use_tally` adds the refs it saw to `proposed` and the refs it removed to `stripped`. Outside, it does nothing extra, like `services/budget.py`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_citation_tally.py
import asyncio

from app.harness.citation_tally import CitationTally, use_tally
from app.harness.verify import strip_unknown_citations


def test_tally_counts_seen_and_stripped_refs():
    tally = CitationTally()
    with use_tally(tally):
        out = strip_unknown_citations("A [P1, P9]. B [P8].", {"P1"})
    assert out == "A [P1]. B." and (tally.proposed, tally.stripped) == (3, 2)


def test_no_tally_outside_context():
    assert strip_unknown_citations("A [P1]", {"P1"}) == "A [P1]"


def test_tally_reaches_child_tasks():
    tally = CitationTally()

    async def branch():  # a parallel graph branch inherits the context of the task that created it
        strip_unknown_citations("x [P2]", set())

    async def main():
        with use_tally(tally):
            await asyncio.gather(branch(), branch())

    asyncio.run(main())
    assert tally.stripped == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_citation_tally.py -v`
Expected: FAIL with `ModuleNotFoundError: app.harness.citation_tally`.

- [ ] **Step 3: Implement**

```python
# backend/app/harness/citation_tally.py
"""Plan 22a eval: counts the [Pn] references the narrative steps proposed and the ones strip_unknown_citations
removed (not in the review's papers). Like the per-review budget, a contextvar that asyncio tasks inherit; it is
only set by the eval runner, so production runs are unaffected."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

_current: ContextVar[CitationTally | None] = ContextVar("citation_tally", default=None)


@dataclass
class CitationTally:
    proposed: int = 0
    stripped: int = 0


def current_tally() -> CitationTally | None:
    return _current.get()


@contextmanager
def use_tally(tally: CitationTally | None) -> Iterator[CitationTally | None]:
    token = _current.set(tally)
    try:
        yield tally
    finally:
        _current.reset(token)
```

In `verify.py`, add the import at the top (`from app.harness.citation_tally import current_tally`) and replace `strip_unknown_citations`:

```python
def strip_unknown_citations(text: str, allowed: set[str]) -> str:
    tally = current_tally()

    def keep(match: re.Match) -> str:
        cited = _REF.findall(match.group(1))
        refs = [r for r in cited if r in allowed]
        if tally is not None:
            tally.proposed += len(cited)
            tally.stripped += len(cited) - len(refs)
        if not refs:
            return ""
        lead = " " if match.group(0).startswith(" ") else ""
        return f"{lead}[{', '.join(refs)}]"

    return _CITE_GROUP.sub(keep, text)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_citation_tally.py tests/unit/test_harness_verify.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/harness/citation_tally.py backend/app/harness/verify.py backend/tests/unit/test_eval_citation_tally.py
git commit -m "feat(eval): citation tally contextvar for citation precision (Plan 22a Task 3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Glossary consistency check

**Files:**
- Create: `backend/app/harness/glossary_check.py`
- Test: `backend/tests/unit/test_eval_glossary_check.py`

**Interfaces:**
- Produces: `GlossaryTerm` (frozen dataclass: `english: tuple[str, ...]`, `thai: str`, `abbr: str | None`).
- Produces: `parse_glossary(text: str) -> list[GlossaryTerm]`.
- Produces: `check_pair(source_en: str, text_th: str, terms: list[GlossaryTerm]) -> list[tuple[str, bool]]`. It returns `(term_key, consistent)` for each term found in the source, where `term_key` is `english[0]`. It returns `[]` when the Thai text has no Thai script (the item was kept in English).
- Produces: `default_terms() -> list[GlossaryTerm]` (parses `localize.GLOSSARY["th"]`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_glossary_check.py
from app.harness.glossary_check import GlossaryTerm, check_pair, default_terms, parse_glossary


def test_parse_glossary_splits_aliases_and_abbreviation():
    terms = parse_glossary("risk ratio/relative risk = อัตราส่วนความเสี่ยง (RR); placebo = ยาหลอก")
    assert terms[0] == GlossaryTerm(("risk ratio", "relative risk"), "อัตราส่วนความเสี่ยง", "RR")
    assert terms[1] == GlossaryTerm(("placebo",), "ยาหลอก", None)


def test_check_pair_flags_consistent_and_missed_terms():
    terms = parse_glossary("hazard ratio = อัตราส่วนฮาซาร์ด (HR); placebo = ยาหลอก")
    got = check_pair("The hazard ratio versus placebo was 0.80.", "อัตราส่วนอันตราย เทียบกับยาหลอก 0.80", terms)
    assert sorted(got) == [("hazard ratio", False), ("placebo", True)]


def test_kept_english_item_is_skipped():
    terms = parse_glossary("placebo = ยาหลอก")
    assert check_pair("versus placebo", "versus placebo", terms) == []


def test_default_terms_parse_the_shipped_glossary():
    keys = {t.english[0] for t in default_terms()}
    assert {"hazard ratio", "placebo", "heterogeneity"} <= keys and len(keys) >= 20
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_glossary_check.py -v`
Expected: FAIL with `ModuleNotFoundError: app.harness.glossary_check`.

- [ ] **Step 3: Implement**

```python
# backend/app/harness/glossary_check.py
"""Plan 22a: does a Thai translation use the glossary's Thai term for each glossary term in its English source?
Pure and measurement-only here; Plan 28 enforces it in localize. Items with no Thai script (kept in English by the
localization fallback) are skipped, not counted as misses."""
from __future__ import annotations

import re
from dataclasses import dataclass

_THAI = re.compile(r"[฀-๿]")
_ABBR = re.compile(r"\(([^)]+)\)\s*$")


@dataclass(frozen=True)
class GlossaryTerm:
    english: tuple[str, ...]
    thai: str
    abbr: str | None


def parse_glossary(text: str) -> list[GlossaryTerm]:
    terms: list[GlossaryTerm] = []
    for part in text.split(";"):
        if "=" not in part:
            continue
        en, th = (s.strip() for s in part.split("=", 1))
        m = _ABBR.search(th)
        abbr = m.group(1).strip() if m else None
        thai = _ABBR.sub("", th).strip()
        aliases = tuple(a.strip().lower() for a in en.split("/") if a.strip())
        if aliases and thai:
            terms.append(GlossaryTerm(aliases, thai, abbr))
    return terms


def default_terms() -> list[GlossaryTerm]:
    from app.harness.localize import GLOSSARY
    return parse_glossary(GLOSSARY["th"])


def _mentions(source: str, alias: str) -> bool:
    return re.search(rf"(?<![A-Za-z]){re.escape(alias)}(?![A-Za-z])", source, re.IGNORECASE) is not None


def check_pair(source_en: str, text_th: str, terms: list[GlossaryTerm]) -> list[tuple[str, bool]]:
    if not text_th or not _THAI.search(text_th):
        return []
    return [(t.english[0], t.thai in text_th) for t in terms if any(_mentions(source_en, a) for a in t.english)]
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_glossary_check.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/harness/glossary_check.py backend/tests/unit/test_eval_glossary_check.py
git commit -m "feat(eval): pure glossary consistency check (Plan 22a Task 4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Eval data model and storage

**Files:**
- Create: `backend/app/evals/__init__.py` (empty)
- Create: `backend/app/evals/models.py`
- Create: `backend/evals/cochrane/manifest.yaml`
- Modify: `.gitignore`
- Test: `backend/tests/unit/test_eval_models.py`

**Interfaces:**
- Produces: `EVAL_ROOT = Path("evals/cochrane")`. It is relative to `backend/`, the working directory for all commands.
- Produces: `Stratum(name: str, query: str)` and `ManifestEntry(...)`, with fields as in the spec section 3 plus `status: Literal["eligible","excluded"] = "eligible"` and `exclusion_reason: str = ""`.
- Produces: `Manifest(seed: int, pool_version: str, year_from: int = 2020, year_to: int = 2025, per_stratum: int = 10, strata: list[Stratum], reviews: list[ManifestEntry])`.
- Produces: `Fixture(id, pool_version, frozen_at, git_sha, prompt_version, engines: list[str], year_to: int, topic: str, english_topic: str | None, question: dict | None, plan: dict | None, candidates: list[dict], search_stats: dict, status: Literal["ok","rejected","error"], error: str = "")`.
- Produces: `PrimaryMatch(row_index: int | None, outcome: str | None, verdict: str, direction: str | None)`.
- Produces: `RunRecord(id, repeat: int, run_id, prompt_version, git_sha, preset, models: dict, started_at, elapsed_s: float, cost_usd: float, status: Literal["done","error","rejected"], error: str = "", citations: dict = {}, primary_match: PrimaryMatch | None = None, result: dict | None = None)`.
- Produces: `GoldRecord(id, primary_outcome, direction: Literal["benefit","no_difference","harm","insufficient"], certainty: Literal["high","moderate","low","very_low"], pooled: dict | None = None, included_studies: list[dict] = [], extracted_by: str, checked_by: str = "")`.
- Produces the IO helpers:
  - `load_manifest(path=EVAL_ROOT/"manifest.yaml") -> Manifest`
  - `save_manifest(m, path=...)`
  - `fixture_path(pool_version, id) -> Path`
  - `run_path(prompt_version, run_id, id, repeat) -> Path`
  - `write_json_atomic(path, model_or_dict)`, which writes `*.tmp` then `os.replace`
  - `read_model(path, cls)`
  - `load_gold(id) -> GoldRecord | None`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_models.py
import json

from app.evals.models import Fixture, Manifest, ManifestEntry, RunRecord, Stratum, read_model, write_json_atomic


def entry(i="CD000001"):
    return ManifestEntry(id=i, pmid="1", doi="10.1002/x", stratum="cardiovascular", title="t",
                         question="In adults, does A versus B reduce death?", review_type="slr",
                         primary_outcome="death", search_date="2023-04-30", year_to=2023)


def test_manifest_round_trip(tmp_path):
    from app.evals.models import load_manifest, save_manifest
    m = Manifest(seed=7, pool_version="v1", strata=[Stratum(name="cardiovascular", query="heart")], reviews=[entry()])
    save_manifest(m, tmp_path / "manifest.yaml")
    assert load_manifest(tmp_path / "manifest.yaml") == m


def test_atomic_write_leaves_no_tmp_and_reads_back(tmp_path):
    rec = RunRecord(id="CD1", repeat=1, run_id="r", prompt_version="p", git_sha="s", preset="budget", models={},
                    started_at="2026-10-11T00:00:00Z", elapsed_s=1.0, cost_usd=0.02, status="done")
    p = tmp_path / "a" / "CD1.r1.json"
    write_json_atomic(p, rec)
    assert read_model(p, RunRecord) == rec and not list(p.parent.glob("*.tmp"))
    assert json.loads(p.read_text(encoding="utf-8"))["status"] == "done"


def test_fixture_requires_status():
    f = Fixture(id="CD1", pool_version="v1", frozen_at="x", git_sha="s", prompt_version="p", engines=[],
                year_to=2023, topic="t", english_topic=None, question=None, plan=None, candidates=[],
                search_stats={}, status="rejected", error="not medical")
    assert f.status == "rejected"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_models.py -v`
Expected: FAIL with `ModuleNotFoundError: app.evals`.

- [ ] **Step 3: Implement**

```python
# backend/app/evals/models.py
"""Plan 22a Cochrane harness: files and their schemas. Paths are relative to backend/ (the working directory)."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

EVAL_ROOT = Path("evals/cochrane")


class Stratum(BaseModel):
    name: str
    query: str  # Europe PMC query terms for the stratum (ANDed with the Cochrane journal and year range)


class ManifestEntry(BaseModel):
    id: str  # Cochrane review number, e.g. CD012345
    pmid: str = ""
    doi: str = ""
    stratum: str
    title: str
    question: str = ""  # engine input topic (English)
    review_type: Literal["slr", "meta_analysis"] = "slr"
    primary_outcome: str = ""
    search_date: str = ""  # YYYY-MM-DD, Cochrane's last search
    year_to: int | None = None
    status: Literal["eligible", "excluded"] = "eligible"
    exclusion_reason: str = ""
    checked_by_owner: bool = False
    notes: str = ""


class Manifest(BaseModel):
    seed: int
    pool_version: str = "v1"
    year_from: int = 2020
    year_to: int = 2025
    per_stratum: int = 10
    strata: list[Stratum] = Field(default_factory=list)
    reviews: list[ManifestEntry] = Field(default_factory=list)


class Fixture(BaseModel):
    id: str
    pool_version: str
    frozen_at: str
    git_sha: str
    prompt_version: str
    engines: list[str]
    year_to: int
    topic: str
    english_topic: str | None
    question: dict[str, Any] | None
    plan: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    search_stats: dict[str, Any]
    status: Literal["ok", "rejected", "error"]
    error: str = ""


class PrimaryMatch(BaseModel):
    row_index: int | None  # index into result.synthesis_en.comparison, None = no matching outcome
    outcome: str | None
    verdict: str  # classify_row verdict: consensus | conflict | imprecise | none
    direction: str | None  # consensus direction (positive/negative/null) or None


class RunRecord(BaseModel):
    id: str
    repeat: int
    run_id: str
    prompt_version: str
    git_sha: str
    preset: str
    models: dict[str, str]
    started_at: str
    elapsed_s: float
    cost_usd: float
    status: Literal["done", "error", "rejected"]
    error: str = ""
    citations: dict[str, int] = Field(default_factory=dict)  # {"proposed", "stripped"}
    primary_match: PrimaryMatch | None = None
    result: dict[str, Any] | None = None


class GoldRecord(BaseModel):  # filled in Plan 22b
    id: str
    primary_outcome: str
    direction: Literal["benefit", "no_difference", "harm", "insufficient"]
    certainty: Literal["high", "moderate", "low", "very_low"]
    pooled: dict[str, Any] | None = None
    included_studies: list[dict[str, Any]] = Field(default_factory=list)
    extracted_by: str
    checked_by: str = ""


def load_manifest(path: Path = EVAL_ROOT / "manifest.yaml") -> Manifest:
    return Manifest.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})


def save_manifest(m: Manifest, path: Path = EVAL_ROOT / "manifest.yaml") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(yaml.safe_dump(m.model_dump(), allow_unicode=True, sort_keys=False), encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def fixture_path(pool_version: str, review_id: str) -> Path:
    return EVAL_ROOT / "fixtures" / f"pool-{pool_version}" / f"{review_id}.json"


def run_path(prompt_version: str, run_id: str, review_id: str, repeat: int) -> Path:
    return EVAL_ROOT / "runs" / prompt_version / run_id / f"{review_id}.r{repeat}.json"


def write_json_atomic(path: Path, data: BaseModel | dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = data.model_dump(mode="json") if isinstance(data, BaseModel) else data
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def read_model[M: BaseModel](path: Path, cls: type[M]) -> M:
    return cls.model_validate_json(path.read_text(encoding="utf-8"))


def load_gold(review_id: str) -> GoldRecord | None:
    p = EVAL_ROOT / "gold" / f"{review_id}.yaml"
    return GoldRecord.model_validate(yaml.safe_load(p.read_text(encoding="utf-8"))) if p.exists() else None
```

Create `backend/evals/cochrane/manifest.yaml` (the strata, with the `select` command adding the reviews later):

```yaml
seed: 20261011
pool_version: v1
year_from: 2020
year_to: 2025
per_stratum: 10
strata:
  - name: cardiovascular
    query: '(hypertension OR "heart failure" OR "coronary heart disease" OR stroke OR "atrial fibrillation")'
  - name: diabetes_metabolic
    query: '(diabetes OR obesity OR dyslipidaemia OR dyslipidemia OR "metabolic syndrome")'
  - name: infection
    query: '(dengue OR tuberculosis OR malaria OR HIV OR sepsis OR pneumonia OR "urinary tract infection")'
  - name: maternal_child
    query: '(pregnancy OR preterm OR neonatal OR newborn OR "postpartum haemorrhage" OR "pre-eclampsia" OR breastfeeding)'
  - name: renal_respiratory
    query: '("chronic kidney disease" OR dialysis OR asthma OR COPD OR "chronic obstructive pulmonary disease")'
  - name: mental_health
    query: '(depression OR anxiety OR schizophrenia OR "bipolar disorder" OR dementia OR "alcohol use disorder")'
reviews: []
```

Append to the repo-root `.gitignore`:

```
# Plan 22a: frozen pools and run files hold third-party abstracts
backend/evals/cochrane/fixtures/
backend/evals/cochrane/runs/
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/evals backend/evals/cochrane/manifest.yaml .gitignore backend/tests/unit/test_eval_models.py
git commit -m "feat(eval): manifest, fixture, run and gold schemas with atomic storage (Plan 22a Task 5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Eval and freeze graphs, and the replay runner

**Files:**
- Modify: `backend/app/graph/graph.py` (factor out the screening→finalize wiring; add `build_freeze_graph` and `build_eval_graph`)
- Create: `backend/app/evals/run.py`
- Test: `backend/tests/unit/test_eval_graph.py`

**Interfaces:**
- Consumes: `Fixture` and `RunRecord`/`PrimaryMatch` (Task 5); `use_tally` (Task 3); `classify_row` (`app/harness/matrix.py:176`); `use_budget`, `ReviewBudget` and `review_cost_cap` (`app/services/budget.py`).
- Produces: `build_freeze_graph(deps)`: `topic_guard → refine_question → plan_queries → search → enrich → END`.
- Produces: `build_eval_graph(deps)`: `START → (screen_batch* | normalize_outcomes) → … → finalize → END`, with the same nodes and edges as `build_graph`. It has no checkpointer argument and always compiles with `InMemorySaver`.
- Produces: `eval_state(fixture: Fixture, options: dict, language: str = "th") -> dict`.
- Produces: `async replay(deps, fixture, *, options, repeat, run_id, git_sha, language="th") -> RunRecord`.
- Produces: `async match_primary(deps, result: dict, primary_outcome: str) -> PrimaryMatch` (one runner call with the planner LLM, schema `OutcomeMatch(index: int | None)`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_graph.py
import pytest

from app.evals.models import Fixture
from app.evals.run import eval_state, replay
from app.graph.graph import build_freeze_graph
from tests.unit.test_review_graph import make_deps


def fixture_from(values, status="ok"):
    return Fixture(id="CD1", pool_version="v1", frozen_at="t", git_sha="s", prompt_version="p", engines=["pubmed"],
                   year_to=2025, topic="metformin and CRC", english_topic=values.get("english_topic"),
                   question=values.get("question"), plan=values.get("plan"), candidates=values.get("candidates") or [],
                   search_stats=values.get("search_stats") or {}, status=status)


async def freeze_values(deps):
    from langgraph.checkpoint.memory import InMemorySaver

    from app.graph.graph import initial_state
    g = build_freeze_graph(deps)
    state = {**initial_state("CD1", "metformin and CRC", "th", {"max_papers": 8, "candidate_limit": 20}),
             "eval_year_to": 2025}
    return await g.ainvoke(state, {"configurable": {"thread_id": "f"}})


@pytest.mark.asyncio
async def test_freeze_stops_after_enrich_with_candidates():
    deps = make_deps()
    values = await freeze_values(deps)
    assert values["candidates"] and values.get("result") is None
    assert deps.llms.screener.calls == []


@pytest.mark.asyncio
async def test_replay_starts_at_screening_and_finishes():
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    searches_before = deps.searxng.calls
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s")
    assert rec.status == "done" and rec.result["synthesis_en"]
    assert deps.searxng.calls == searches_before  # no search during replay
    assert rec.citations.keys() == {"proposed", "stripped"}
    assert rec.cost_usd > 0


@pytest.mark.asyncio
async def test_replay_without_match_reports_none():
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s",
                       primary_outcome="")
    assert rec.primary_match is not None and rec.primary_match.row_index is None


def test_eval_state_carries_pool_and_question():
    fx = fixture_from({"candidates": [{"title": "x"}], "question": {"p": 1}, "plan": {"queries": ["q"]}})
    s = eval_state(fx, {"max_papers": 8})
    assert s["candidates"] == [{"title": "x"}] and s["plan"] == {"queries": ["q"]} and s["question"] == {"p": 1}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_graph.py -v`
Expected: FAIL with `ImportError: cannot import name 'build_freeze_graph'`.

- [ ] **Step 3: Implement**

In `graph.py`, move the node registration and edges from `screen_batch` onward into a helper. `build_graph` calls it after adding the intake and retrieval nodes:

```python
def _add_review_nodes(b: StateGraph, deps: GraphDeps) -> None:
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations) → normalize_outcomes
    → [pool_effects] → explain_conflict* → write_synthesis → localize → finalize. Shared by build_graph and the
    Plan 22a eval graph."""
    b.add_node("screen_batch", screening.make_screen_batch(deps))
    b.add_node("select_top", screening.make_select_top(deps))
    b.add_node("read_paper", reading.make_read_paper(deps))
    b.add_node("external_enrich", external.make_external_enrich(deps))
    b.add_node("fetch_citations", citations.make_fetch_citations(deps))
    b.add_node("normalize_outcomes", synthesis.make_normalize_outcomes(deps))
    b.add_node("pool_effects", synthesis.make_pool_effects(deps))
    b.add_node("explain_conflict", synthesis.make_explain_conflict(deps))
    b.add_node("write_synthesis", synthesis.make_write_synthesis(deps))
    b.add_node("localize", synthesis.make_localize(deps))
    b.add_node("finalize", synthesis.make_finalize(deps))
    b.add_edge("screen_batch", "select_top")
    b.add_conditional_edges(
        "select_top",
        partial(screening.route_to_reading, external_enabled=lambda: deps.mcp is not None and deps.mcp.enabled,
                citations_enabled=lambda: deps.openalex is not None),
        ["read_paper", "external_enrich", "fetch_citations", "normalize_outcomes"],
    )
    b.add_edge("read_paper", "normalize_outcomes")
    b.add_edge("external_enrich", "normalize_outcomes")
    b.add_edge("fetch_citations", "normalize_outcomes")
    b.add_conditional_edges("normalize_outcomes", synthesis.route_after_normalize,
                            ["pool_effects", "explain_conflict", "write_synthesis"])
    b.add_conditional_edges("pool_effects", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
    b.add_edge("write_synthesis", "localize")
    b.add_edge("localize", "finalize")
    b.add_edge("finalize", END)


def _add_intake_nodes(b: StateGraph, deps: GraphDeps) -> None:
    b.add_node("topic_guard", intake.make_topic_guard(deps))
    b.add_node("refine_question", intake.make_refine_question(deps))
    b.add_node("plan_queries", intake.make_plan_queries(deps))
    b.add_node("search", retrieval.make_search(deps))
    b.add_node("enrich", retrieval.make_enrich(deps))
    b.add_edge(START, "topic_guard")
    b.add_conditional_edges("topic_guard", intake.route_after_guard, ["refine_question", END])
    b.add_edge("refine_question", "plan_queries")
    b.add_edge("plan_queries", "search")
    b.add_edge("search", "enrich")
```

`build_graph` keeps its docstring and stub branch. Its body becomes:

```python
    b = StateGraph(ReviewState)
    _add_intake_nodes(b, deps)
    _add_review_nodes(b, deps)
    b.add_conditional_edges(
        "enrich", partial(screening.route_to_screening, batch_size=deps.settings.screen_batch_size),
        ["screen_batch", "normalize_outcomes"],
    )
    return b.compile(checkpointer=checkpointer)
```

Add the two eval builders:

```python
def build_freeze_graph(deps: GraphDeps):
    """Plan 22a: topic_guard → … → enrich, then stop; the candidate pool is frozen from its final state."""
    from langgraph.checkpoint.memory import InMemorySaver
    b = StateGraph(ReviewState)
    _add_intake_nodes(b, deps)
    b.add_edge("enrich", END)
    return b.compile(checkpointer=InMemorySaver())


def build_eval_graph(deps: GraphDeps):
    """Plan 22a: replay a frozen pool from screening onward with the production nodes."""
    from langgraph.checkpoint.memory import InMemorySaver
    b = StateGraph(ReviewState)
    _add_review_nodes(b, deps)
    b.add_conditional_edges(
        START, partial(screening.route_to_screening, batch_size=deps.settings.screen_batch_size),
        ["screen_batch", "normalize_outcomes"],
    )
    return b.compile(checkpointer=InMemorySaver())
```

Create the replay runner:

```python
# backend/app/evals/run.py
"""Plan 22a: replay one frozen pool through the eval graph and record the result, cost, citation tally and the
engine's verdict on the Cochrane primary outcome."""
from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from app.evals.models import Fixture, PrimaryMatch, RunRecord
from app.graph.graph import build_eval_graph, initial_state
from app.graph.nodes.intake import harness_runner
from app.harness.citation_tally import CitationTally, use_tally
from app.harness.matrix import classify_row
from app.schemas.review import ReviewOptions
from app.services.budget import ReviewBudget, review_cost_cap, use_budget


class OutcomeMatch(BaseModel):
    index: int | None  # 0-based index of the matching outcome row, or null when none matches


MATCH_SYSTEM = ("You match outcome names. Given a target outcome from a Cochrane review and a numbered list of "
                "outcome rows from another review, return the index of the row that measures the same outcome "
                "(same construct; wording and abbreviations may differ), or null when none does.")


def eval_state(fixture: Fixture, options: dict[str, Any], language: str = "th") -> dict[str, Any]:
    state = dict(initial_state(f"eval-{fixture.id}", fixture.topic, language, options))
    state.update(english_topic=fixture.english_topic, question=fixture.question, plan=fixture.plan,
                 candidates=fixture.candidates, search_stats=fixture.search_stats, eval_year_to=fixture.year_to)
    return state


async def match_primary(deps, result: dict[str, Any], primary_outcome: str) -> tuple[PrimaryMatch, float]:
    rows = ((result.get("synthesis_en") or {}).get("comparison") or [])
    if not primary_outcome or not rows:
        return PrimaryMatch(row_index=None, outcome=None, verdict="none", direction=None), 0.0
    listing = "\n".join(f"{i}: {r['outcome']}" for i, r in enumerate(rows))
    user = f"Target outcome: {primary_outcome}\nRows:\n{listing}"

    def validate(m: OutcomeMatch) -> list[str]:
        return [] if m.index is None or 0 <= m.index < len(rows) else [f"index must be null or 0..{len(rows) - 1}"]

    res = await harness_runner(deps).call(deps.llms.planner, MATCH_SYSTEM, user, schema=OutcomeMatch,
                                          validate=validate)
    index = res.value.index if isinstance(res.value, OutcomeMatch) else None  # no valid answer: no match
    if index is None:
        return PrimaryMatch(row_index=None, outcome=None, verdict="none", direction=None), res.cost
    verdict = classify_row(rows[index].get("cells") or [])
    return PrimaryMatch(row_index=index, outcome=rows[index]["outcome"], verdict=verdict["verdict"],
                        direction=verdict.get("direction")), res.cost


async def replay(deps, fixture: Fixture, *, options: dict[str, Any], repeat: int, run_id: str, git_sha: str,
                 language: str = "th", primary_outcome: str = "") -> RunRecord:
    started_at = datetime.now(UTC).isoformat(timespec="seconds")
    t0 = time.monotonic()
    tally = CitationTally()
    budget = ReviewBudget(cap_usd=review_cost_cap(deps.settings, ReviewOptions.clamped(options)))
    common = dict(id=fixture.id, repeat=repeat, run_id=run_id, prompt_version=deps.settings.prompt_version,
                  git_sha=git_sha, preset=getattr(deps.llms, "preset", ""),
                  models=dict(getattr(deps.llms, "models", {}) or {}), started_at=started_at)
    try:
        with use_budget(budget), use_tally(tally):
            graph = build_eval_graph(deps)
            values = await graph.ainvoke(eval_state(fixture, options, language),
                                         {"configurable": {"thread_id": f"{fixture.id}-{repeat}"}})
            result = values.get("result") or {}
            match, match_cost = await match_primary(deps, result, primary_outcome)
    except Exception as exc:  # noqa: BLE001 - a failed review is recorded and stays in every denominator
        return RunRecord(**common, elapsed_s=round(time.monotonic() - t0, 2), cost_usd=round(budget.spent, 6),
                         status="error", error=f"{type(exc).__name__}: {exc}",
                         citations={"proposed": tally.proposed, "stripped": tally.stripped})
    return RunRecord(**common, elapsed_s=round(time.monotonic() - t0, 2),
                     cost_usd=round(float(values.get("cost_usd", 0.0)) + match_cost, 6), status="done",
                     citations={"proposed": tally.proposed, "stripped": tally.stripped}, primary_match=match,
                     result=result)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_graph.py tests/unit/test_review_graph.py tests/unit/test_graph_skeleton.py -v`
Expected: PASS. `test_review_graph.py` proves `build_graph` is unchanged in behaviour.

- [ ] **Step 5: Commit**

```bash
git add backend/app/graph/graph.py backend/app/evals/run.py backend/tests/unit/test_eval_graph.py
git commit -m "feat(eval): freeze and eval graphs sharing production nodes; replay runner (Plan 22a Task 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Freeze and run commands (resume, budget stop)

**Files:**
- Create: `backend/app/evals/freeze.py`
- Create: `backend/app/evals/batch.py`
- Test: `backend/tests/unit/test_eval_batch.py`

**Interfaces:**
- Consumes: `build_freeze_graph` and `replay` (Task 6); `Manifest`, `Fixture`, the paths and `write_json_atomic` (Task 5).
- Produces: `async freeze_one(deps, entry: ManifestEntry, *, pool_version: str, git_sha: str, engines: list[str]) -> Fixture`.
- Produces: `async freeze_all(deps, manifest, *, ids: list[str] | None, force: bool, git_sha: str, engines: list[str]) -> list[Fixture]`.
- Produces: `async run_all(deps, manifest, *, run_id: str, repeats: int, max_usd: float, ids: list[str] | None, git_sha: str) -> BatchSummary`.
- Produces: `BatchSummary(done: int, skipped: int, failed: int, spent: float, stopped_for_budget: bool)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_batch.py
import pytest

from app.evals import models
from app.evals.batch import run_all
from app.evals.freeze import freeze_all
from app.evals.models import Manifest, ManifestEntry, RunRecord, Stratum, read_model, run_path
from tests.unit.test_review_graph import make_deps


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    return tmp_path


def manifest(n=2):
    return Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[
        ManifestEntry(id=f"CD{i}", stratum="cv", title="t", question="metformin and colorectal cancer",
                      primary_outcome="CRC incidence", search_date="2023-01-01", year_to=2023, checked_by_owner=True)
        for i in range(n)])


@pytest.mark.asyncio
async def test_freeze_then_run_then_resume(root):
    deps, m = make_deps(), manifest()
    fixtures = await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    assert [f.status for f in fixtures] == ["ok", "ok"]
    s1 = await run_all(deps, m, run_id="r1", repeats=2, max_usd=100, ids=None, git_sha="s")
    assert (s1.done, s1.skipped) == (4, 0)
    s2 = await run_all(deps, m, run_id="r1", repeats=2, max_usd=100, ids=None, git_sha="s")
    assert (s2.done, s2.skipped) == (0, 4)
    rec = read_model(run_path(deps.settings.prompt_version, "r1", "CD0", 2), RunRecord)
    assert rec.repeat == 2 and rec.status == "done"


@pytest.mark.asyncio
async def test_budget_stop_leaves_partial_batch(root):
    deps, m = make_deps(), manifest(3)
    await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    s = await run_all(deps, m, run_id="r2", repeats=1, max_usd=0.000001, ids=None, git_sha="s")
    assert s.stopped_for_budget and s.done == 1


@pytest.mark.asyncio
async def test_rejected_topic_is_recorded_not_dropped(root):
    deps, m = make_deps(allowed=False), manifest(1)
    [fx] = await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    assert fx.status == "rejected"
    s = await run_all(deps, m, run_id="r3", repeats=1, max_usd=100, ids=None, git_sha="s")
    rec = read_model(run_path(deps.settings.prompt_version, "r3", "CD0", 1), RunRecord)
    assert s.failed == 1 and rec.status == "rejected"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_batch.py -v`
Expected: FAIL with `ModuleNotFoundError: app.evals.batch`.

- [ ] **Step 3: Implement**

Look up `models.EVAL_ROOT` through the module at call time, not with `from … import`, so the test's monkeypatch reaches it. The path helpers in `models.py` already read the module global.

```python
# backend/app/evals/freeze.py
"""Plan 22a: freeze each manifest review's candidate pool once (intake + retrieval, with the Cochrane year cutoff)."""
from __future__ import annotations

from datetime import UTC, datetime

from app.evals import models
from app.evals.models import Fixture, Manifest, ManifestEntry
from app.graph.graph import build_freeze_graph, initial_state


def entry_options(entry: ManifestEntry) -> dict:
    return {"review_type": entry.review_type, "max_papers": 30, "candidate_limit": 120}


async def freeze_one(deps, entry: ManifestEntry, *, pool_version: str, git_sha: str, engines: list[str]) -> Fixture:
    base = dict(id=entry.id, pool_version=pool_version, frozen_at=datetime.now(UTC).isoformat(timespec="seconds"),
                git_sha=git_sha, prompt_version=deps.settings.prompt_version, engines=engines,
                year_to=entry.year_to or 9999, topic=entry.question)
    state = {**initial_state(f"freeze-{entry.id}", entry.question, "en", entry_options(entry)),
             "eval_year_to": entry.year_to}
    try:
        values = await build_freeze_graph(deps).ainvoke(state, {"configurable": {"thread_id": f"freeze-{entry.id}"}})
    except Exception as exc:  # noqa: BLE001 - recorded, stays in the denominators
        return Fixture(**base, english_topic=None, question=None, plan=None, candidates=[], search_stats={},
                       status="error", error=f"{type(exc).__name__}: {exc}")
    status = "rejected" if values.get("rejected") else "ok"
    return Fixture(**base, english_topic=values.get("english_topic"), question=values.get("question"),
                   plan=values.get("plan"), candidates=values.get("candidates") or [],
                   search_stats=values.get("search_stats") or {}, status=status,
                   error=str(values.get("rejected") or ""))


def _selected(manifest: Manifest, ids: list[str] | None) -> list[ManifestEntry]:
    return [e for e in manifest.reviews
            if e.status == "eligible" and e.checked_by_owner and (ids is None or e.id in ids)]


async def freeze_all(deps, manifest: Manifest, *, ids: list[str] | None, force: bool, git_sha: str,
                     engines: list[str]) -> list[Fixture]:
    out: list[Fixture] = []
    for entry in _selected(manifest, ids):
        path = models.fixture_path(manifest.pool_version, entry.id)
        if path.exists() and not force:
            out.append(models.read_model(path, Fixture))
            continue
        fx = await freeze_one(deps, entry, pool_version=manifest.pool_version, git_sha=git_sha, engines=engines)
        models.write_json_atomic(path, fx)
        out.append(fx)
    return out
```

```python
# backend/app/evals/batch.py
"""Plan 22a: run every frozen review `repeats` times. Resumable: an existing run file is skipped. Stops starting new
runs once the batch has spent `max_usd`."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.evals import models
from app.evals.freeze import _selected, entry_options
from app.evals.models import Fixture, Manifest, RunRecord
from app.evals.run import replay


@dataclass
class BatchSummary:
    done: int = 0
    skipped: int = 0
    failed: int = 0
    spent: float = 0.0
    stopped_for_budget: bool = False


async def run_all(deps, manifest: Manifest, *, run_id: str, repeats: int, max_usd: float, ids: list[str] | None,
                  git_sha: str) -> BatchSummary:
    s = BatchSummary()
    pv = deps.settings.prompt_version
    for entry in _selected(manifest, ids):
        fx_path = models.fixture_path(manifest.pool_version, entry.id)
        fixture = models.read_model(fx_path, Fixture) if fx_path.exists() else None
        for repeat in range(1, repeats + 1):
            path = models.run_path(pv, run_id, entry.id, repeat)
            if path.exists():
                s.skipped += 1
                continue
            if s.spent >= max_usd:
                s.stopped_for_budget = True
                return s
            if fixture is None or fixture.status != "ok":
                status = "rejected" if fixture is not None and fixture.status == "rejected" else "error"
                rec = RunRecord(id=entry.id, repeat=repeat, run_id=run_id, prompt_version=pv, git_sha=git_sha,
                                preset=getattr(deps.llms, "preset", ""), models={},
                                started_at=datetime.now(UTC).isoformat(timespec="seconds"), elapsed_s=0.0,
                                cost_usd=0.0, status=status,
                                error=fixture.error if fixture is not None else "no fixture (run freeze first)")
            else:
                rec = await replay(deps, fixture, options=entry_options(entry), repeat=repeat, run_id=run_id,
                                   git_sha=git_sha, primary_outcome=entry.primary_outcome)
            models.write_json_atomic(path, rec)
            s.spent += rec.cost_usd
            if rec.status == "done":
                s.done += 1
            else:
                s.failed += 1
    return s
```

In `models.py`, have the path helpers read `EVAL_ROOT` at call time (they already reference the module global, so monkeypatching `models.EVAL_ROOT` works).

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_batch.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/evals/freeze.py backend/app/evals/batch.py backend/tests/unit/test_eval_batch.py
git commit -m "feat(eval): freeze and resumable run batches with a budget stop (Plan 22a Task 7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `select`: sampling frame, seeded draw, LLM eligibility

**Files:**
- Create: `backend/app/evals/select.py`
- Test: `backend/tests/unit/test_eval_select.py`

**Interfaces:**
- Consumes: `HttpClient.get(url, params=..., retries=...)` (`app/services/http.py`); `harness_runner(deps)`; `Manifest`, `ManifestEntry` and `Stratum` (Task 5).
- Produces: `CochraneEligibility` (pydantic) with fields:
  - `eligible: bool`, `reason: str`
  - `question: str`, `primary_outcome: str`
  - `search_date: str | None` (YYYY-MM-DD)
  - `review_type: Literal["slr","meta_analysis"]`
  - `rct_count: int | None`
  - `grade_reported: bool`
- Produces: `async frame(http, base_url: str, manifest: Manifest, stratum: Stratum) -> list[dict]`. It returns Europe PMC records (`pmid`, `doi`, `title`, `abstractText`) for `JOURNAL:"Cochrane Database Syst Rev" AND PUB_YEAR:[{year_from} TO {year_to}] AND {stratum.query}`, with all pages followed by `cursorMark`.
- Produces: `cochrane_id(doi: str) -> str`, for example `10.1002/14651858.CD012345.pub3` → `CD012345`.
- Produces: `async select(deps, http, base_url, manifest) -> Manifest`. Per stratum it shuffles with `random.Random(f"{seed}:{stratum.name}")`, checks records in order until `per_stratum` are eligible, and appends every checked record (eligible or excluded with a reason) to `manifest.reviews` with `checked_by_owner=False`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_select.py
import httpx
import pytest

from app.evals.models import Manifest, Stratum
from app.evals.select import CochraneEligibility, cochrane_id, select
from tests.fakes import FakeStructuredLLM
from tests.unit.test_review_graph import make_deps


class FakeHttp:
    def __init__(self, records):
        self.records, self.calls = records, []

    async def get(self, url, params=None, **_):
        self.calls.append(params)
        body = {"resultList": {"result": self.records}, "nextCursorMark": params.get("cursorMark")}
        return httpx.Response(200, json=body, request=httpx.Request("GET", url))


def rec(i, abstract):
    return {"pmid": str(i), "doi": f"10.1002/14651858.CD00000{i}.pub2", "title": f"Review {i}", "abstractText": abstract}


def judge(system, user):
    if "no search date" in user:
        return CochraneEligibility(eligible=True, reason="", question="q", primary_outcome="death", search_date=None,
                                   review_type="slr", rct_count=5, grade_reported=True)
    return CochraneEligibility(eligible=True, reason="", question="In adults, does A reduce death?",
                               primary_outcome="death", search_date="2023-04-30", review_type="meta_analysis",
                               rct_count=12, grade_reported=True)


def test_cochrane_id():
    assert cochrane_id("10.1002/14651858.CD012345.pub3") == "CD012345"


@pytest.mark.asyncio
async def test_select_draws_per_stratum_and_never_guesses_dates():
    deps = make_deps()
    deps.llms.planner = FakeStructuredLLM("plan", judge)
    http = FakeHttp([rec(1, "Search up to April 2023 ..."), rec(2, "no search date stated"), rec(3, "Searched 2023")])
    m = Manifest(seed=3, per_stratum=2, strata=[Stratum(name="cv", query="heart")])
    out = await select(deps, http, "https://epmc", m)
    eligible = [r for r in out.reviews if r.status == "eligible"]
    excluded = [r for r in out.reviews if r.status == "excluded"]
    assert len(eligible) == 2 and all(r.year_to == 2023 for r in eligible)
    assert [r.exclusion_reason for r in excluded] == ["no search date"]
    assert all(not r.checked_by_owner for r in out.reviews)
    assert 'JOURNAL:"Cochrane Database Syst Rev"' in http.calls[0]["query"]


@pytest.mark.asyncio
async def test_same_seed_same_order():
    deps = make_deps()
    deps.llms.planner = FakeStructuredLLM("plan", judge)
    records = [rec(i, "Search up to 2023") for i in range(1, 6)]
    a = await select(deps, FakeHttp(records), "u", Manifest(seed=9, per_stratum=3, strata=[Stratum(name="cv", query="x")]))
    b = await select(deps, FakeHttp(records), "u", Manifest(seed=9, per_stratum=3, strata=[Stratum(name="cv", query="x")]))
    assert [r.id for r in a.reviews] == [r.id for r in b.reviews]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_select.py -v`
Expected: FAIL with `ModuleNotFoundError: app.evals.select`.

- [ ] **Step 3: Implement**

```python
# backend/app/evals/select.py
"""Plan 22a: the Cochrane sampling frame (Europe PMC), a seeded draw per stratum, and an LLM eligibility check of
each abstract (intervention review, GRADE reported, >= 3 RCTs for the primary outcome, a stated search date). Every
checked record is kept with its reason; the owner checks the list before freezing."""
from __future__ import annotations

import random
import re
from typing import Any, Literal

from pydantic import BaseModel

from app.evals.models import Manifest, ManifestEntry, Stratum
from app.graph.nodes.intake import harness_runner

_CD = re.compile(r"(CD\d{6})", re.IGNORECASE)


class CochraneEligibility(BaseModel):
    eligible: bool
    reason: str  # why not eligible ("" when eligible)
    question: str  # the review question as a one-sentence English question (population, intervention, comparator)
    primary_outcome: str
    search_date: str | None  # YYYY-MM-DD of the latest search as stated in the abstract, or null if not stated
    review_type: Literal["slr", "meta_analysis"]  # meta_analysis when the primary outcome was pooled
    rct_count: int | None
    grade_reported: bool


SYSTEM = """You screen Cochrane review abstracts for a benchmark. Decide eligibility:
- an intervention review (not diagnostic accuracy, prognosis, methodology or an overview of reviews);
- certainty of evidence reported with GRADE for the primary outcome;
- at least 3 randomised controlled trials contribute to the primary outcome.
Extract: the review question as one English sentence (population, intervention, comparator); the primary outcome;
the date of the latest search as YYYY-MM-DD exactly as stated (use the last day of the month when only month and year
are given; null when the abstract states no search date - never guess); review_type "meta_analysis" when the primary
outcome was pooled in a meta-analysis, else "slr"; the number of RCTs for the primary outcome (null if not stated)."""


def cochrane_id(doi: str) -> str:
    m = _CD.search(doi or "")
    return m.group(1).upper() if m else ""


async def frame(http, base_url: str, manifest: Manifest, stratum: Stratum) -> list[dict[str, Any]]:
    query = (f'JOURNAL:"Cochrane Database Syst Rev" AND PUB_YEAR:[{manifest.year_from} TO {manifest.year_to}] '
             f"AND {stratum.query}")
    out: list[dict[str, Any]] = []
    cursor = "*"
    while True:
        resp = await http.get(f"{base_url.rstrip('/')}/search", params={
            "query": query, "format": "json", "resultType": "core", "pageSize": 1000, "cursorMark": cursor})
        resp.raise_for_status()
        body = resp.json()
        page = (body.get("resultList") or {}).get("result") or []
        out.extend(page)
        nxt = body.get("nextCursorMark")
        if not page or not nxt or nxt == cursor:
            return out
        cursor = nxt


async def select(deps, http, base_url: str, manifest: Manifest) -> Manifest:
    runner = harness_runner(deps)
    reviews = list(manifest.reviews)
    for stratum in manifest.strata:
        records = [r for r in await frame(http, base_url, manifest, stratum) if cochrane_id(r.get("doi", ""))]
        random.Random(f"{manifest.seed}:{stratum.name}").shuffle(records)
        eligible = 0
        for r in records:
            if eligible >= manifest.per_stratum:
                break
            user = f"Title: {r.get('title', '')}\nAbstract: {r.get('abstractText', '')}"
            res = await runner.call(deps.llms.planner, SYSTEM, user, schema=CochraneEligibility)
            v = res.value
            base = dict(id=cochrane_id(r["doi"]), pmid=str(r.get("pmid") or ""), doi=r.get("doi", ""),
                        stratum=stratum.name, title=r.get("title", ""))
            reason = ("model gave no answer" if v is None else v.reason or "not eligible" if not v.eligible
                      else "no search date" if not v.search_date else "")
            if reason:
                reviews.append(ManifestEntry(**base, status="excluded", exclusion_reason=reason))
                continue
            eligible += 1
            reviews.append(ManifestEntry(**base, question=v.question, review_type=v.review_type,
                                         primary_outcome=v.primary_outcome, search_date=v.search_date,
                                         year_to=int(v.search_date[:4])))
    return manifest.model_copy(update={"reviews": reviews})
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_select.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/evals/select.py backend/tests/unit/test_eval_select.py
git commit -m "feat(eval): Cochrane sampling frame, seeded draw and LLM eligibility (Plan 22a Task 8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Metrics and report

**Files:**
- Create: `backend/app/evals/metrics.py`
- Create: `backend/app/evals/report.py`
- Test: `backend/tests/unit/test_eval_metrics.py`

**Interfaces:**
- Consumes: `RunRecord`, `Fixture` and `Manifest` (Task 5); `check_pair` and `default_terms` (Task 4); `thai_share` (`app/harness/localize.py`); `_synthesis_strings` (`app/graph/nodes/synthesis.py:1217`).
- Produces: `wilson(k: int, n: int) -> tuple[float, float]`, with `(0.0, 0.0)` when `n == 0`.
- Produces: `ReviewMetrics` (dataclass, per run file) with fields:
  - `id`, `stratum`, `repeat`, `status`, `cost_usd`, `elapsed_s`
  - `numbers_verified`, `numbers_total`
  - `citations_proposed`, `citations_stripped`
  - `thai_share_mean: float | None`, `thai_share_min: float | None`
  - `untranslated`, `numbers_rejected`, `citations_rejected`
  - `glossary: list[tuple[str, bool]]`
  - `answer_present: bool`, `papers_analysed: int`
  - `primary_direction: str` (verdict and direction joined, e.g. `"consensus:positive"`, or `"none"`)
- Produces: `review_metrics(rec: RunRecord, stratum: str) -> ReviewMetrics`.
- Produces: `aggregate(rows: list[ReviewMetrics]) -> dict` with keys:
  - `n_runs`, `n_failed`, `failures: list[(id, repeat, status, error)]`
  - `verification_rate`
  - `citation_strip_rate`
  - `thai_share_mean`, `thai_share_min`, `below_min_share` (with its 95% CI), `numbers_rejected`, `citations_rejected`
  - `glossary_consistency` (with its 95% CI) and `glossary_top_misses: list[(term, count)]`
  - `answer_rate` (with its 95% CI)
  - `cost_mean`, `cost_median`, `cost_max`, `cost_total`
  - `elapsed_mean`
  - `stability` (with its 95% CI)
  - `stability_pairs`
- Produces: `render_report(prompt_version: str, run_id: str, manifest: Manifest, rows: list[ReviewMetrics], meta: dict, compare: dict | None = None) -> str` (markdown).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_metrics.py
import pytest

from app.evals.metrics import ReviewMetrics, aggregate, review_metrics, wilson
from app.evals.models import Manifest, PrimaryMatch, RunRecord
from app.evals.report import render_report


def rec(i, repeat, status="done", direction="positive", th=None, en=None, verified=(3, 4)):
    result = None
    if status == "done":
        en = en or {"executive_summary": "Versus placebo the hazard ratio was 0.80 [P1].", "comparison": [],
                    "consensus": [], "conflicts": [], "evidence_rationale": "", "research_gaps": [], "answer": "Yes."}
        th = th or {**en, "executive_summary": "เทียบกับยาหลอก อัตราส่วนอันตราย 0.80 [P1]", "answer": "ใช่"}
        result = {"synthesis_en": en, "synthesis": th, "papers": [{}, {}],
                  "quality": {"numbers_verified": verified[0], "numbers_total": verified[1],
                              "localize": {"untranslated": 0, "numbers_rejected": 1, "citations_rejected": 0}}}
    return RunRecord(id=f"CD{i}", repeat=repeat, run_id="r", prompt_version="p", git_sha="s", preset="budget",
                     models={}, started_at="t", elapsed_s=10.0, cost_usd=0.02, status=status,
                     error="" if status == "done" else "boom", citations={"proposed": 10, "stripped": 1},
                     primary_match=PrimaryMatch(row_index=0, outcome="death", verdict="consensus",
                                                direction=direction) if status == "done" else None,
                     result=result)


def test_wilson_bounds():
    lo, hi = wilson(45, 60)
    assert 0.62 < lo < 0.65 and 0.84 < hi < 0.86 and wilson(0, 0) == (0.0, 0.0)


def test_review_metrics_reads_quality_glossary_and_direction():
    m = review_metrics(rec(1, 1), "cv")
    assert (m.numbers_verified, m.numbers_total, m.numbers_rejected) == (3, 4, 1)
    assert ("hazard ratio", False) in m.glossary and ("placebo", True) in m.glossary
    assert m.primary_direction == "consensus:positive" and m.answer_present and m.thai_share_min > 0


def test_aggregate_keeps_failures_in_denominators_and_pairs_stability():
    rows = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv"),
            review_metrics(rec(2, 1), "cv"), review_metrics(rec(2, 2, direction="negative"), "cv"),
            review_metrics(rec(3, 1, status="error"), "cv"), review_metrics(rec(3, 2, status="error"), "cv")]
    a = aggregate(rows)
    assert a["n_runs"] == 6 and a["n_failed"] == 2
    assert a["answer_rate"][0] == pytest.approx(4 / 6)
    assert a["stability_pairs"] == 3 and a["stability"][0] == pytest.approx(2 / 3)  # failed pair agrees (none = none)
    assert a["glossary_top_misses"][0][0] == "hazard ratio"


def test_report_has_placeholders_and_compare_column():
    rows = [review_metrics(rec(1, 1), "cv"), review_metrics(rec(1, 2), "cv")]
    md = render_report("p2", "r", Manifest(seed=1), rows, {"preset": "budget", "models": {}, "git_sha": "s"},
                       compare={"label": "p1", "aggregate": aggregate(rows)})
    assert "รอคำตอบมาตรฐาน (Plan 22b)" in md and "| p1 |" in md and "Glossary consistency" in md
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_metrics.py -v`
Expected: FAIL with `ModuleNotFoundError: app.evals.metrics`.

- [ ] **Step 3: Implement**

```python
# backend/app/evals/metrics.py
"""Plan 22a metrics from run files. Pure: no network, no LLM. Failed runs stay in every denominator."""
from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from app.evals.models import RunRecord
from app.graph.nodes.synthesis import _synthesis_strings
from app.harness.glossary_check import check_pair, default_terms
from app.harness.localize import MIN_THAI_SHARE, thai_share


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


@dataclass
class ReviewMetrics:
    id: str
    stratum: str
    repeat: int
    status: str
    error: str = ""
    cost_usd: float = 0.0
    elapsed_s: float = 0.0
    numbers_verified: int = 0
    numbers_total: int = 0
    citations_proposed: int = 0
    citations_stripped: int = 0
    thai_share_mean: float | None = None
    thai_share_min: float | None = None
    untranslated: int = 0
    numbers_rejected: int = 0
    citations_rejected: int = 0
    glossary: list[tuple[str, bool]] = field(default_factory=list)
    answer_present: bool = False
    papers_analysed: int = 0
    primary_direction: str = "none"


def review_metrics(rec: RunRecord, stratum: str) -> ReviewMetrics:
    m = ReviewMetrics(id=rec.id, stratum=stratum, repeat=rec.repeat, status=rec.status, error=rec.error,
                      cost_usd=rec.cost_usd, elapsed_s=rec.elapsed_s,
                      citations_proposed=rec.citations.get("proposed", 0),
                      citations_stripped=rec.citations.get("stripped", 0))
    if rec.primary_match is not None and rec.primary_match.row_index is not None:
        m.primary_direction = f"{rec.primary_match.verdict}:{rec.primary_match.direction or '-'}"
    result = rec.result or {}
    if rec.status != "done" or not result:
        return m
    q = result.get("quality") or {}
    loc = q.get("localize") or {}
    m.numbers_verified, m.numbers_total = int(q.get("numbers_verified", 0)), int(q.get("numbers_total", 0))
    m.untranslated = int(loc.get("untranslated", 0))
    m.numbers_rejected = int(loc.get("numbers_rejected", 0))
    m.citations_rejected = int(loc.get("citations_rejected", 0))
    en = _synthesis_strings(result.get("synthesis_en") or {})
    th = _synthesis_strings(result.get("synthesis") or {})
    shares = [thai_share(th[k], en[k]) for k in en if k in th and en[k].strip()]
    if shares:
        m.thai_share_mean, m.thai_share_min = statistics.fmean(shares), min(shares)
    terms = default_terms()
    m.glossary = [hit for k in en if k in th for hit in check_pair(en[k], th[k], terms)]
    m.answer_present = bool(((result.get("synthesis_en") or {}).get("answer") or "").strip())
    m.papers_analysed = len(result.get("papers") or [])
    return m


def _rate(k: int, n: int) -> tuple[float, float, float]:
    lo, hi = wilson(k, n)
    return (k / n if n else 0.0, lo, hi)


def aggregate(rows: list[ReviewMetrics]) -> dict:
    done = [r for r in rows if r.status == "done"]
    costs = [r.cost_usd for r in rows]
    glossary = [ok for r in done for _, ok in r.glossary]
    misses = Counter(term for r in done for term, ok in r.glossary if not ok)
    shares = [r.thai_share_min for r in done if r.thai_share_min is not None]
    by_id: dict[str, dict[int, str]] = defaultdict(dict)
    for r in rows:
        by_id[r.id][r.repeat] = r.primary_direction
    pairs = [(d[1], d[2]) for d in by_id.values() if 1 in d and 2 in d]
    verified, total = sum(r.numbers_verified for r in done), sum(r.numbers_total for r in done)
    proposed, stripped = sum(r.citations_proposed for r in rows), sum(r.citations_stripped for r in rows)
    return {
        "n_runs": len(rows), "n_failed": len(rows) - len(done),
        "failures": [(r.id, r.repeat, r.status, r.error) for r in rows if r.status != "done"],
        "verification_rate": verified / total if total else None,
        "citation_strip_rate": stripped / proposed if proposed else None,
        "thai_share_mean": statistics.fmean([r.thai_share_mean for r in done if r.thai_share_mean is not None])
        if any(r.thai_share_mean is not None for r in done) else None,
        "thai_share_min": min(shares) if shares else None,
        "below_min_share": _rate(sum(1 for s in shares if s < MIN_THAI_SHARE), len(rows)),
        "numbers_rejected": sum(r.numbers_rejected for r in done),
        "citations_rejected": sum(r.citations_rejected for r in done),
        "glossary_consistency": _rate(sum(glossary), len(glossary)),
        "glossary_top_misses": misses.most_common(10),
        "answer_rate": _rate(sum(1 for r in done if r.answer_present), len(rows)),
        "cost_mean": statistics.fmean(costs) if costs else 0.0,
        "cost_median": statistics.median(costs) if costs else 0.0,
        "cost_max": max(costs) if costs else 0.0, "cost_total": sum(costs),
        "elapsed_mean": statistics.fmean([r.elapsed_s for r in done]) if done else 0.0,
        "stability": _rate(sum(1 for a, b in pairs if a == b), len(pairs)), "stability_pairs": len(pairs),
    }
```

```python
# backend/app/evals/report.py
"""Plan 22a markdown report. Primary-outcome sections print a placeholder until the 22b gold standard exists."""
from __future__ import annotations

from collections import defaultdict

from app.evals.metrics import ReviewMetrics, aggregate
from app.evals.models import Manifest

PENDING = "รอคำตอบมาตรฐาน (Plan 22b)"


def _pct(v) -> str:
    if v is None:
        return "–"
    if isinstance(v, tuple):
        return f"{v[0]:.1%} ({v[1]:.1%}–{v[2]:.1%})"
    return f"{v:.1%}"


def _rows(a: dict) -> list[tuple[str, str]]:
    return [
        ("Runs (failed)", f"{a['n_runs']} ({a['n_failed']})"),
        ("Number verification rate", _pct(a["verification_rate"])),
        ("Citations stripped as unknown", _pct(a["citation_strip_rate"])),
        ("Thai share, mean / min", f"{_pct(a['thai_share_mean'])} / {_pct(a['thai_share_min'])}"),
        ("Runs below the Thai share floor", _pct(a["below_min_share"])),
        ("Translations refused: numbers / citations", f"{a['numbers_rejected']} / {a['citations_rejected']}"),
        ("Glossary consistency", _pct(a["glossary_consistency"])),
        ("Answer present", _pct(a["answer_rate"])),
        ("Stability of primary-outcome verdict", f"{_pct(a['stability'])} over {a['stability_pairs']} pairs"),
        ("Cost per review: mean / median / max", f"${a['cost_mean']:.3f} / ${a['cost_median']:.3f} / ${a['cost_max']:.3f}"),
        ("Batch cost", f"${a['cost_total']:.2f}"),
        ("Time per review (mean)", f"{a['elapsed_mean']:.0f} s"),
    ]


def render_report(prompt_version: str, run_id: str, manifest: Manifest, rows: list[ReviewMetrics], meta: dict,
                  compare: dict | None = None) -> str:
    a = aggregate(rows)
    out = [f"# Cochrane harness report: {prompt_version} (run {run_id})", "",
           f"- git `{meta.get('git_sha', '')}` · preset `{meta.get('preset', '')}` · pool `{manifest.pool_version}` · "
           f"seed {manifest.seed}",
           f"- models: {', '.join(f'{k}={v}' for k, v in sorted((meta.get('models') or {}).items())) or '–'}",
           "", "## Summary", ""]
    head = "| Metric | This run |" + (f" {compare['label']} |" if compare else "")
    out += [head, "|---|---|" + ("---|" if compare else "")]
    other = dict(_rows(compare["aggregate"])) if compare else {}
    for name, value in _rows(a):
        out.append(f"| {name} | {value} |" + (f" {other.get(name, '–')} |" if compare else ""))
    out += ["", "## By stratum", "", "| Stratum | Runs | Failed | Glossary | Answer | Cost mean |",
            "|---|---|---|---|---|---|"]
    by: dict[str, list[ReviewMetrics]] = defaultdict(list)
    for r in rows:
        by[r.stratum].append(r)
    for name, group in sorted(by.items()):
        g = aggregate(group)
        out.append(f"| {name} | {g['n_runs']} | {g['n_failed']} | {_pct(g['glossary_consistency'])} | "
                   f"{_pct(g['answer_rate'])} | ${g['cost_mean']:.3f} |")
    out += ["", "## Glossary: most frequent misses", ""]
    out += [f"- {term}: {n}" for term, n in a["glossary_top_misses"]] or ["- none"]
    out += ["", "## Failures (kept in every denominator)", ""]
    out += [f"- {i} r{rep}: {status} — {err}" for i, rep, status, err in a["failures"]] or ["- none"]
    out += ["", "## Agreement with Cochrane (primary outcome)", "", PENDING, "",
            "## Certainty agreement", "", PENDING, "", "## Study recall", "", PENDING, ""]
    return "\n".join(out)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_metrics.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/evals/metrics.py backend/app/evals/report.py backend/tests/unit/test_eval_metrics.py
git commit -m "feat(eval): metrics (Thai share, glossary, numbers, citations, stability, cost) and markdown report (Plan 22a Task 9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: CLI, protocol and docs

**Files:**
- Create: `backend/app/cli/eval.py`
- Create: `backend/evals/cochrane/PROTOCOL.md`
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-10-11-plan-22-cochrane-benchmark-design.md`, `docs/superpowers/specs/2026-10-04-medical-reviewer-agent-design.md` (revision line), `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`
- Test: `backend/tests/unit/test_eval_cli.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `async run(argv: list[str], deps, http, base_url: str) -> int` (testable); `main()` builds the real deps.
- Produces these commands:
  - `select`
  - `freeze [--ids CD1 CD2] [--force]`
  - `run [--run-id ID] [--repeats 2] [--max-usd 10] [--ids …]`
  - `report --run-id ID [--compare-run PROMPT_VERSION/RUN_ID]`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_eval_cli.py
import pytest

from app.cli.eval import run
from app.evals import models
from app.evals.models import Manifest, ManifestEntry, Stratum, save_manifest
from tests.unit.test_review_graph import make_deps


@pytest.mark.asyncio
async def test_freeze_run_report_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[
        ManifestEntry(id="CD1", stratum="cv", title="t", question="metformin and colorectal cancer",
                      primary_outcome="CRC incidence", search_date="2023-01-01", year_to=2023,
                      checked_by_owner=True)]), tmp_path / "manifest.yaml")
    deps = make_deps()
    assert await run(["freeze"], deps, None, "") == 0
    assert await run(["run", "--run-id", "t1", "--repeats", "2"], deps, None, "") == 0
    assert await run(["report", "--run-id", "t1"], deps, None, "") == 0
    report = (tmp_path / "reports" / f"{deps.settings.prompt_version}-t1.md").read_text(encoding="utf-8")
    assert "Glossary consistency" in report and "Runs (failed) | 2 (0)" in report


@pytest.mark.asyncio
async def test_freeze_refuses_unchecked_manifest(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, reviews=[ManifestEntry(id="CD1", stratum="cv", title="t")]),
                  tmp_path / "manifest.yaml")
    assert await run(["freeze"], make_deps(), None, "") == 1
    assert "checked_by_owner" in capsys.readouterr().out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_eval_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: app.cli.eval`.

- [ ] **Step 3: Implement**

```python
# backend/app/cli/eval.py
"""Plan 22a Cochrane harness (run from backend/).

    python -m app.cli.eval select                  # sampling frame + LLM eligibility -> draft manifest
    python -m app.cli.eval freeze [--ids ..] [--force]
    python -m app.cli.eval run [--run-id ID] [--repeats 2] [--max-usd 10] [--ids ..]
    python -m app.cli.eval report --run-id ID [--compare-run PROMPT_VERSION/RUN_ID]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import UTC, datetime

from app.evals import models
from app.evals.batch import run_all
from app.evals.freeze import freeze_all
from app.evals.metrics import aggregate, review_metrics
from app.evals.models import RunRecord, load_manifest, read_model, save_manifest
from app.evals.report import render_report
from app.evals.select import select


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.cli.eval")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("select", help="build the draft manifest (owner checks it before freeze)")
    f = sub.add_parser("freeze", help="freeze the candidate pool of every checked review")
    f.add_argument("--ids", nargs="*")
    f.add_argument("--force", action="store_true")
    r = sub.add_parser("run", help="replay every frozen pool (resumable)")
    r.add_argument("--run-id", default=datetime.now(UTC).strftime("%Y%m%d-%H%M"))
    r.add_argument("--repeats", type=int, default=2)
    r.add_argument("--max-usd", type=float, default=10.0)
    r.add_argument("--ids", nargs="*")
    rp = sub.add_parser("report", help="write reports/<prompt_version>-<run_id>.md")
    rp.add_argument("--run-id", required=True)
    rp.add_argument("--compare-run", help="PROMPT_VERSION/RUN_ID of an earlier batch")
    return p


def git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:  # noqa: BLE001 - outside a checkout
        return "unknown"


def _load_rows(prompt_version: str, run_id: str, manifest) -> tuple[list, dict]:
    strata = {e.id: e.stratum for e in manifest.reviews}
    folder = models.EVAL_ROOT / "runs" / prompt_version / run_id
    recs = [read_model(p, RunRecord) for p in sorted(folder.glob("*.json"))]
    meta = {"git_sha": recs[0].git_sha, "preset": recs[0].preset, "models": recs[0].models} if recs else {}
    return [review_metrics(r, strata.get(r.id, "?")) for r in recs], meta


async def run(argv: list[str], deps, http, base_url: str) -> int:
    args = _parser().parse_args(argv)
    manifest = load_manifest(models.EVAL_ROOT / "manifest.yaml")
    if args.cmd == "select":
        out = await select(deps, http, base_url, manifest)
        save_manifest(out, models.EVAL_ROOT / "manifest.yaml")
        eligible = sum(1 for r in out.reviews if r.status == "eligible")
        print(f"{eligible} eligible, {len(out.reviews) - eligible} excluded; set checked_by_owner after review")
        return 0
    if args.cmd in ("freeze", "run"):
        unchecked = [e.id for e in manifest.reviews if e.status == "eligible" and not e.checked_by_owner
                     and (args.ids is None or e.id in args.ids)]
        if unchecked:
            print(f"{len(unchecked)} eligible review(s) lack checked_by_owner: {', '.join(unchecked[:10])}")
            return 1
    if args.cmd == "freeze":
        engines = [e.strip() for e in str(deps.settings.searxng_engines).split(",") if e.strip()]
        fixtures = await freeze_all(deps, manifest, ids=args.ids, force=args.force, git_sha=git_sha(),
                                    engines=engines)
        print(", ".join(f"{f.id}:{f.status}:{len(f.candidates)}" for f in fixtures))
        return 0
    if args.cmd == "run":
        s = await run_all(deps, manifest, run_id=args.run_id, repeats=args.repeats, max_usd=args.max_usd,
                          ids=args.ids, git_sha=git_sha())
        print(f"run {args.run_id}: done={s.done} skipped={s.skipped} failed={s.failed} spent=${s.spent:.2f}"
              + (" (stopped: --max-usd reached)" if s.stopped_for_budget else ""))
        return 0
    pv = deps.settings.prompt_version
    rows, meta = _load_rows(pv, args.run_id, manifest)
    compare = None
    if args.compare_run:
        other_pv, other_run = args.compare_run.split("/", 1)
        other_rows, _ = _load_rows(other_pv, other_run, manifest)
        compare = {"label": args.compare_run, "aggregate": aggregate(other_rows)}
    path = models.EVAL_ROOT / "reports" / f"{pv}-{args.run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(pv, args.run_id, manifest, rows, meta, compare), encoding="utf-8", newline="\n")
    print(path)
    return 0


def main() -> None:
    from app.compat import run_async
    from app.config import get_settings
    from app.graph.factory import build_graph_deps
    from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

    settings = get_settings()

    async def go() -> int:
        http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
        deps = build_graph_deps(settings, http)
        deps.openalex, deps.mcp = None, None  # no citation network or external tools: replays stay deterministic
        try:
            return await run(sys.argv[1:], deps, http, settings.europepmc_url)
        finally:
            await http.aclose()

    sys.exit(run_async(go()))


if __name__ == "__main__":
    main()
```

`HttpClient.aclose()` and `DEFAULT_MIN_INTERVAL` exist in `app/services/http.py` (lines 11 and 74). `settings.searxng_engines` is a comma-separated string, so it is split into a list before it is stored in a fixture.

Create `backend/evals/cochrane/PROTOCOL.md`:

```markdown
# Cochrane benchmark protocol (Plan 22, pre-registration draft, 2026-10-11)

**Status:** draft for registration on OSF before the Plan 22b gold-standard comparison. Deviations are dated below.

## Objective
Measure whether an automated, abstract-only rapid review engine reaches the same conclusion as Cochrane intervention
reviews on their primary outcome.

## Hypotheses
- H1 (primary): the engine's direction for the primary outcome agrees with Cochrane's (benefit / no difference /
  harm / insufficient) in at least 70% of reviews (Wilson 95% CI reported).
- H2: GRADE certainty agrees within one level in at least 70% of reviews.

## Sample
60 Cochrane intervention reviews published or updated 2020–2025, 10 per stratum (cardiovascular, diabetes and
metabolic, infection, maternal and child, renal or respiratory, mental health), drawn in random order with seed
20261011 from Europe PMC (`JOURNAL:"Cochrane Database Syst Rev"` + year range + the stratum terms in
`manifest.yaml`). Eligibility: intervention review; GRADE certainty reported for the primary outcome; >= 3 RCTs for
the primary outcome; a search date stated in the abstract. An LLM screens each abstract; the owner checks every
decision.

## Index test
The engine at a recorded `prompt_version`, git SHA, preset and per-role models. Input: the review question as one
English sentence. Candidate pools are frozen once per pool version with a cutoff at the year of Cochrane's last
search (studies from that year are kept; their number is reported). Each review is run twice.

## Outcomes
Primary: direction agreement. Secondary: certainty agreement (exact, within one level, weighted kappa); pool recall
and included-set recall/precision of Cochrane's included studies; number-verification rate; citations stripped as
unknown; Thai share; glossary consistency; translations refused for changed numbers; run-to-run stability; cost; time.

## Reference standard (Plan 22b)
Extracted from each Cochrane review by an LLM, every item checked by a human who does not see the engine's output.

## Analysis
Proportions with Wilson 95% CIs, overall and per stratum. Failed runs count as disagreement (intention-to-treat);
per-protocol figures are reported alongside. Version comparisons use McNemar's test on paired agreement. Reporting
follows TRIPOD-LLM.

## Deviations
- 2026-10-11: the sampling frame uses Europe PMC's REST search instead of PubMed E-utilities (same Cochrane records,
  abstracts in one call).
```

In `CLAUDE.md`, add after the "Load test" bullet:

```markdown
- Cochrane harness (Plan 22a): run from `backend/`: `python -m app.cli.eval select|freeze|run|report` (manifest and
  protocol in `backend/evals/cochrane/`; fixtures/ and runs/ hold third-party abstracts and are git-ignored). The
  eval replays frozen pools from screening onward (`build_eval_graph`), so search changes need a new pool version;
  `eval_year_to` is eval-only state, never a `ReviewOptions` field. It measures Thai quality by harness engineering
  (Thai share, glossary consistency, numbers preserved) — no Thai-tuned or fine-tuned model.
```

In the Plan 22 spec, section 4.1 `select`, replace "one PubMed E-utilities search" with "one Europe PMC REST search (deviation 2026-10-11: same Cochrane records, abstracts in one call, no NCBI key)". In the main spec (`2026-10-04-medical-reviewer-agent-design.md`), append:

```markdown
## Revision 2026-10-11: Cochrane harness (Plan 22a)

Spec: `2026-10-11-plan-22-cochrane-benchmark-design.md`. Adds `app/evals/` and `python -m app.cli.eval`; the review
graph gains counting-only hooks (citation tally, localization rejection counters) and an eval-only pool cutoff.
```

In the roadmap note, change the Plan 22 row's start to `**22a done (YYYY-MM-DD)**`, with the date filled at merge time, in Task 11.

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/unit/test_eval_cli.py -v && uv run pytest`
Expected: PASS (the full unit suite stays green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/cli/eval.py backend/evals/cochrane/PROTOCOL.md backend/tests/unit/test_eval_cli.py CLAUDE.md docs/superpowers/specs docs/superpowers/notes
git commit -m "feat(eval): eval CLI, pre-registration protocol and docs (Plan 22a Task 10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Live smoke test and first real batch

**Files:**
- Create: `backend/tests/integration/test_eval_live.py`
- Modify: `backend/evals/cochrane/manifest.yaml` (after `select`, owner-checked)
- Create: `backend/evals/cochrane/reports/<prompt_version>-<run_id>.md`

**Interfaces:**
- Consumes: the CLI (Task 10).

- [ ] **Step 1: Write the integration test**

```python
# backend/tests/integration/test_eval_live.py
import pytest

from app.config import get_settings
from app.evals import models
from app.evals.models import Manifest, ManifestEntry, Stratum
from app.evals.batch import run_all
from app.evals.freeze import freeze_all
from app.graph.factory import build_graph_deps
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient


@pytest.mark.integration
@pytest.mark.asyncio
async def test_one_review_freezes_and_replays_live(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    settings = get_settings()
    http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    deps = build_graph_deps(settings, http)
    deps.openalex, deps.mcp = None, None
    m = Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[ManifestEntry(
        id="CDLIVE", stratum="cv", title="live", question="In adults with hypertension, do SGLT2 inhibitors "
        "compared with placebo reduce cardiovascular death?", primary_outcome="cardiovascular death",
        search_date="2023-12-31", year_to=2023, checked_by_owner=True)])
    engines = [e.strip() for e in settings.searxng_engines.split(",") if e.strip()]
    [fx] = await freeze_all(deps, m, ids=None, force=True, git_sha="live", engines=engines)
    assert fx.status == "ok" and fx.candidates
    assert all(c.get("year") is None or c["year"] <= 2023 for c in fx.candidates)
    s = await run_all(deps, m, run_id="live", repeats=1, max_usd=1.0, ids=None, git_sha="live")
    assert s.done == 1 and s.spent < 1.0
```

- [ ] **Step 2: Run it against the live stack**

Run: `cd backend && docker compose up -d postgres redis searxng && MRA_INTEGRATION=1 uv run pytest -m integration tests/integration/test_eval_live.py -v`
Expected: PASS, with a spend under $1.

- [ ] **Step 3: Build and check the manifest**

Run: `cd backend && uv run python -m app.cli.eval select`
Expected: the output prints "60 eligible, N excluded…". The owner then reads `backend/evals/cochrane/manifest.yaml`, fixes questions or outcomes if needed, and sets `checked_by_owner: true` on each accepted entry. **Stop here and wait for the owner.**

- [ ] **Step 4: Freeze, run, report**

Run:
```bash
cd backend
uv run python -m app.cli.eval freeze
uv run python -m app.cli.eval run --run-id baseline --repeats 2 --max-usd 10
uv run python -m app.cli.eval report --run-id baseline
```
Expected: the report `evals/cochrane/reports/<prompt_version>-baseline.md` has every Plan 22a metric filled in, the 22b placeholders, and a batch cost of about $3–5.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/integration/test_eval_live.py backend/evals/cochrane/manifest.yaml backend/evals/cochrane/reports docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md
git commit -m "test(eval): live smoke test; owner-checked manifest and the baseline report (Plan 22a Task 11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final review and merge

- [ ] Run `cd backend && uv run pytest` (all unit tests) and `uv run ruff check app tests` if ruff is configured (check `pyproject.toml`).
- [ ] Request a whole-branch code review (superpowers:requesting-code-review). Fix the findings.
- [ ] Merge `plan-22-cochrane-benchmark` into master with `--no-ff`, following repo practice, with a merge message that summarises Plan 22a.
