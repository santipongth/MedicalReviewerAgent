# Plan 25: Sentence-Support Grounding, "Why This Source Was Cited" and the "ตรวจแล้ว" Badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every citation of the summary and of the key findings against the cited paper's abstract, show a "ตรวจแล้ว" mark on the citations that pass, and let the reader open "ทำไมจึงอ้างอิงงานนี้" in the source rail: the sentence as checked, the label (unsupported included) and the abstract sentence verbatim. Soft, cheap, inside the review's cost cap.

**Architecture:**
- **Core** (`app/harness/support.py`, pure): claims from the English synthesis (summary sentences with a citation group, key findings), abstract sentences, a content-word and number scorer that picks 2 candidate sentences per (claim, paper), judge-answer validation, and the badge rule. `prose.unverified_numbers` exposes the summary's number rule.
- **Judge** (`app/graph/nodes/support.py`): one call per review on the screener's model bound to `SupportBatch` (`deps.llms.with_schema`), through the harness runner (validate → repair → escalate); at most 30 pairs; skipped under $0.01 of budget left; any failure leaves labels null. The node runs beside `localize` (`write_synthesis → check_support → finalize`); `finalize` writes `result.support` with `display_aligned`; `quality.support` counts.
- **Prompt and cache:** a new pinned judge prompt; no existing prompt changes; `prompt_version` 2026-10-13.1.
- **Stub and eval:** the stub result carries a fixed `support` block; the 22a metrics add a support rate and a badge share.
- **Frontend:** `src/lib/support.ts` ties the shown citation groups to the English claims (by position, else by a ref list unique in both texts, else nothing), the ✓ mark and legend (`report-parts.tsx`, `key-findings.tsx`, `bottom-line.tsx`), and the rail's "ทำไมจึงอ้างอิงงานนี้" (`source-rail.tsx`); a selection carries the claim id (`report.tsx`).

**Tech Stack:** Python 3.12, Pydantic, LangGraph, the project's harness runner and fake LLMs; Next.js 16, React, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-25-sentence-support-design.md`

**Worktree:** `D:\MRA-plan-25` (branch `plan-25-sentence-support`).
- It was created from master `ad53132` (Plans 22a, 23a–c and 24 merged). Its first commit holds the spec, this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-13-plan-25-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-plan-25/backend` or `cd /d/MRA-plan-25/frontend`.
- The frontend needs `npm ci` once (Task 4).
- **Existing interfaces this plan uses**, checked against master `ad53132` on 2026-10-13:
  - `LLMs.with_schema(role, schema)` and `for_schema`, `LimitedLLM`, `LLMError`, `LLMResult` (`app/services/llm.py`); `current_budget()`, `ReviewBudget(cap_usd, spent)`, `use_budget` (`app/services/budget.py`);
  - `HarnessRunner.call(llm, system, user, *, schema, validate, trigger)` → `HarnessResult(value, cost, attempts, repaired, escalated, problems, ok)` (`app/harness/runner.py`), `harness_runner(deps)` (`app/graph/nodes/intake.py`);
  - `prose_context(papers, *, texts, values, search, max_count, counts)`, `ProseContext.facts[ref].numbers`, `_admitted`, `_SEARCH`, `_tokens` (`app/harness/prose.py`); `tokens`/`Tok.key` (`app/harness/verify.py`); `pooled_number_strings(meta)` (`app/harness/meta.py`);
  - `unique_papers`, `design_excluded`, `related`, `_narrative_papers`, `_prose_context`, `_review_type`, `make_finalize` and its `result` dict (`app/graph/nodes/synthesis.py`); `ReviewState` (`app/graph/state.py`); `_add_review_nodes` (`app/graph/graph.py`); `summarize_quality` (`app/harness/quality.py`); `DATA_NOTICE` (`app/graph/prompts.py`); `Settings.prompt_version` (`app/config.py`);
  - `stub_result` and `_stub_meta` (`app/graph/nodes/stub_result.py`); `ReviewMetrics`, `review_metrics`, `aggregate`, `_rate` (`app/evals/metrics.py`), `summary_rows` (`app/evals/report.py`);
  - test helpers `FakeStructuredLLM`, `bind_by_role`, `to_thai` (`tests/fakes.py`), `make_deps`/`run` (`tests/unit/test_review_graph.py`), `rec` (`tests/unit/test_eval_metrics.py`), `SYSTEM_HASHES`/`sha` (`tests/unit/test_prompts_by_type.py`);
  - frontend `CitedText`, `RefButtons`, `Select`, `READING` (`src/components/review/report-parts.tsx`), `KeyFindings`, `SourceRail`, `BottomLine`, `Report`, `isNotEvidence` (`src/lib/trial-reports.ts`), `RC`/`Pair` (`src/lib/i18n-report.ts`), `L` (`src/components/review/text.ts`), `slrP20ReviewFixture` (`src/test/fixtures.ts`), `desktopViewport` (`src/test/viewport.ts`).
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies:** none new, backend or frontend.
- **No spend:** no real LLM call anywhere in this plan, tests included. Tests use `FakeStructuredLLM` and `bind_by_role`; the controller's smoke check uses an inline fake.
- **Abstract only:** the judge sees the claim and at most 2 sentences copied verbatim from `papers[].candidate.abstract`, never a whole abstract; the evidence shown is chosen by index, never written by the model; the result stores the chosen sentences only (no abstracts).
- **Prompts:** English. Only `SUPPORT_SYSTEM` and `support_user` are added, and the `SupportVerdict`/`SupportBatch` schema. No existing prompt, schema or pin changes. `prompt_version` becomes `2026-10-13.1` (Task 2), with the comment in `tests/unit/test_prompts_by_type.py` and `docs/api.md` in step.
- **Judge limits:** `deps.llms.with_schema("screener", SupportBatch)` through `harness_runner(deps).call(..., trigger="repair_failed")`; `CANDIDATES = 2`, `MAX_PAIRS = 30` (summary first), claim clipped at 600 and a candidate at 500 characters; skipped when `current_budget()` has less than `MIN_BUDGET_USD = 0.01` left.
- **Soft:** the node never raises. A judge error is `judge: "failed"` with one `errors` line; a crash is `support: null`. The check never edits the synthesis and never removes a citation.
- **Badge rule** (engine `citation(...)["verified"]`, UI `isChecked`): `label == "supported"` and `numbers_checked` and not `computed` and the paper is evidence (`not_evidence` false; the UI also applies `isNotEvidence`). Not-evidence papers and computed claims are never judged.
- **Mapping:** group k of the shown summary is claim marker k when the ref lists match in order; otherwise only a ref list unique in both texts is tied; anything else has no badge. Key finding i is claim `k<i>`.
- **UI:** no new number face; `VerifiedNumber`/`ComputedNumber`/`Hole` untouched. Report components hold no copy literals: every string comes from `RC.support` (`src/lib/i18n-report.test.ts` scans them). DESIGN.md is updated in Task 6.
- **Python files** are written with LF line endings (`newline="\n"`). Do not paste file contents through a Bash heredoc on this host: it collapses `\\` to `\` (regexes here contain `\s`, `\d`, `\]`). Use the editor tools.
- **Commits:** each message is written with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (the folder is git-ignored) and committed with `git commit -F .superpowers/commit-msg.txt`. Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Known flaky test:** `tests/unit/test_capacity.py::test_queue_position` failed 1 of 3 runs on this host before any Plan 25 change (timing). If it fails in a full run, rerun that file once and report both results.
- **Do not touch** `D:\MedicalReviewerAgent` until the controller's merge step, and there never `CLAUDE.md`'s working-tree edits, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new`.

## Review Focus

1. **Never fails a review** (Task 2): a judge error, a missing schema factory, garbage after repairs and a crash all leave the review going (`test_a_failing_judge_leaves_support_unknown_and_never_fails_the_review`, `test_an_answer_still_invalid_after_repairs_keeps_its_usable_verdicts`, `test_a_crash_in_the_check_leaves_support_null`).
2. **Budget and size** (Task 2): skipped under $0.01 left (`test_a_nearly_spent_budget_skips_the_judge_and_keeps_the_closest_sentences`); 30 pairs at most (`test_pairs_over_the_cap_stay_unjudged`); one call per review, candidate sentences only (`test_one_judge_call_labels_every_pair_on_the_screener_model` asserts the abstract never reaches the prompt whole).
3. **Abstract only, nothing invented** (Task 1): sentences are verbatim (`test_abstract_sentences_are_verbatim_and_split_at_labels_and_lines`), evidence chosen by index and verdicts without a valid candidate dropped (`test_usable_verdicts_drop_repeats_unknown_ids_and_missing_sentences`).
4. **The badge rule** (Tasks 1, 2, 5): every branch (`test_the_badge_needs_supported_checked_numbers_no_pool_and_evidence`), not-evidence and pooled claims never judged (`test_papers_that_are_not_evidence_and_pooled_claims_are_never_judged`), and the UI refuses the badge on a not-evidence paper even when the engine set it ("a paper that is not evidence never gets the badge, even when the engine marked it").
5. **Localization mapping** (Tasks 2, 4, 5): `display_aligned` (`test_finalize_reports_whether_the_shown_summary_keeps_the_markers`), alignment by position, by unique ref list, never on a repeated group ("ties a moved group only when its ref list is unique in both texts, else no claim"; "when translation repeated a group, no badge is placed and nothing breaks").
6. **Prompts and cache** (Task 2): the judge pins (`test_support_prompts_are_pinned`), every existing pin unchanged, `prompt_version` 2026-10-13.1.
7. **Graph** (Task 2): `finalize` runs once after `localize` and `check_support` (`test_full_review_checks_sentence_support_beside_localize`); the 50-paper budget test still counts 12 screener calls; the eval replay still asks the planner for `OutcomeMatch` once.
8. **Honest UI** (Task 5): unsupported shown in the rail with the closest sentence ("an unsupported citation is shown honestly, with the closest sentence"); a result without `support` renders as before.

---

### Task 1: The deterministic core — claims, abstract sentences, the scorer, judge answers and the badge rule

**Files:**
- Modify: `backend/app/graph/schemas.py`
- Modify: `backend/app/harness/prose.py`
- Create: `backend/app/harness/support.py`
- Test (create): `backend/tests/unit/test_support.py`

**Interfaces:**
- Consumes: `prose_context`, `ProseContext`, `_admitted`, `_SEARCH`, `_tokens` (`app/harness/prose.py`); `tokens`/`Tok.key` (`app/harness/verify.py`).
- Produces:
  - `SupportVerdict(id: str, label: Literal["supported", "partial", "unsupported"], sentence: int | None)` and `SupportBatch(verdicts: list[SupportVerdict])` in `app/graph/schemas.py` (every property required, no defaults).
  - `unverified_numbers(sentence: str, refs: list[str], ctx: ProseContext) -> list[str]` in `app/harness/prose.py`.
  - `app/harness/support.py`: `LABELS`, `CANDIDATES = 2`, `MAX_PAIRS = 30`, `MAX_CLAIM_CHARS = 600`, `MAX_SENTENCE_CHARS = 500`, `MIN_SENTENCE_CHARS = 20`, `MARKER`, `STOPWORDS`; `markers(text) -> list[list[str]]`; `abstract_sentences(abstract) -> list[str]`; `content_words(text) -> set[str]`; `score(claim, sentence) -> float`; `best_sentences(claim, sentences, k=CANDIDATES) -> list[tuple[str, float]]`; `@dataclass Claim(id, where, text, refs, markers=None, finding=None)`; `summary_claims(summary) -> list[Claim]`; `finding_claims(findings) -> list[Claim]`; `pooled_keys(strings) -> set`; `claim_checks(claim, prose, pooled) -> tuple[bool, bool]` (numbers_checked, computed); `@dataclass Pair(id, claim, ref, candidates)`; `build_pairs(claims, abstracts, skip) -> list[Pair]`; `judge_items(pairs) -> list[dict]`; `verdict_problems(value, pairs) -> list[str]`; `verdicts(value, pairs) -> dict[str, tuple[str, int | None]]`; `citation(pair, ref, verdict, *, numbers_checked, computed, not_evidence) -> dict`; `claim_record(claim, citations, *, numbers_checked, computed) -> dict`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_support.py` (complete):

```python
"""Plan 25: the deterministic half of sentence support (app.harness.support): claims, abstract sentences, the
scorer, judge answers and the badge rule. No LLM."""
import json

from app.graph.schemas import SupportBatch, SupportVerdict
from app.harness import support as sp
from app.harness.prose import prose_context, unverified_numbers

ABSTRACT = (
    "Background: Colorectal cancer is common in adults with type 2 diabetes. "
    "Methods: We followed 1,234 adults with type 2 diabetes for 8 years in a population-based cohort.\n"
    "Results: Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90). "
    "Sulfonylureas showed no association with colorectal cancer, e.g. in older adults. "
    "Conclusions: Metformin may lower colorectal cancer risk."
)


def card(value=0.8):
    return {"study_design": "cohort", "population": "adults with type 2 diabetes", "sample_size": 1234,
            "intervention_or_exposure": "metformin", "comparator": "no metformin",
            "outcomes": [{"outcome": "CRC incidence", "result": "lower risk", "effect_size": f"HR {value}",
                          "effect_measure": "HR", "effect_value": value, "ci_lower": 0.71, "ci_upper": 0.9,
                          "p_value": None, "direction": "positive", "matches_question": True,
                          "comparison": "metformin vs no metformin"}],
            "key_findings": [], "risk_of_bias": "moderate", "overall_direction": "positive"}


def ctx(values=(), **cards):
    return prose_context([{"ref": ref, "title": f"Paper {ref}", "year": 2020, "card": c} for ref, c in cards.items()],
                         values=values)


def test_markers_are_the_groups_the_report_links():
    text = "A [P1]. B [P2, P10] and [P3-P5]; C [P2,P4]."
    assert sp.markers(text) == [["P1"], ["P2", "P10"], ["P2", "P4"]]  # a range is no link in the report
    assert sp.markers("") == [] and sp.markers(None) == []


def test_summary_claims_tie_each_marker_to_its_sentence():
    text = ("Metformin is associated with lower CRC risk [P1, P2]. One cohort found the opposite [P3], unlike "
            "trials [P4]. Dose effects were not studied. Results vs. placebo were similar. [P5] Follow-up was short.")
    claims = sp.summary_claims(text)
    assert [(c.id, c.markers, c.refs) for c in claims] == [
        ("s0", [0], ["P1", "P2"]), ("s1", [1, 2], ["P3", "P4"]), ("s2", [3], ["P5"])]
    assert claims[1].text == "One cohort found the opposite [P3], unlike trials [P4]."
    # "vs." never ends a sentence; a group after the full stop belongs to the sentence before it
    assert claims[2].text == "Results vs. placebo were similar. [P5]"
    assert all(c.where == "summary" and c.finding is None for c in claims)


def test_finding_claims_keep_the_index_and_skip_empty_findings():
    claims = sp.finding_claims([{"statement": "Lower risk.", "refs": ["P1", "P1", "P2"]},
                                {"statement": "", "refs": ["P3"]}, {"statement": "No refs.", "refs": []},
                                {"statement": "Harms unclear.", "refs": ["P4"]}])
    assert [(c.id, c.finding, c.refs) for c in claims] == [("k0", 0, ["P1", "P2"]), ("k3", 3, ["P4"])]
    assert all(c.where == "key_finding" and c.markers is None for c in claims)


def test_abstract_sentences_are_verbatim_and_split_at_labels_and_lines():
    sentences = sp.abstract_sentences(ABSTRACT)
    assert sentences[1] == ("Methods: We followed 1,234 adults with type 2 diabetes for 8 years in a population-based "
                            "cohort.")
    assert sentences[2].startswith("Results: Metformin use") and sentences[2].endswith("(HR 0.80, 95% CI 0.71-0.90).")
    assert sentences[3] == "Sulfonylureas showed no association with colorectal cancer, e.g. in older adults."
    assert all(s in ABSTRACT for s in sentences)
    assert sp.abstract_sentences("Short. Too short.") == [] and sp.abstract_sentences(None) == []


def test_the_scorer_ranks_by_content_words_and_numbers():
    sentences = sp.abstract_sentences(ABSTRACT)
    best = sp.best_sentences("Metformin was associated with a lower colorectal cancer risk (HR 0.80) [P1].", sentences)
    assert best[0][0].startswith("Results: Metformin use") and best[0][1] > best[1][1]
    assert len(best) == sp.CANDIDATES
    # numbers count: the same words with the right hazard ratio beat the conclusion sentence
    assert sp.score("lower colorectal cancer HR 0.80", sentences[2]) > sp.score("lower colorectal cancer HR 0.80",
                                                                                   sentences[4])
    assert sp.score("", sentences[0]) == 0.0
    assert sp.content_words("Studies [P1] reported lower risks in patients") == {"lower", "risk"}


def test_unverified_numbers_follow_the_prose_rule():
    c = ctx(P1=card(), P2=card(0.9))
    assert unverified_numbers("Metformin lowered risk (HR 0.80).", ["P1"], c) == []
    assert unverified_numbers("Metformin lowered risk (HR 0.80).", ["P2"], c) == ["0.80"]
    assert unverified_numbers("Risk fell (HR 0.77) in adults with type 2 diabetes.", ["P1"], c) == ["0.77"]


def test_claim_checks_flag_unverified_and_pooled_numbers():
    c = ctx(values=["0.84"], P1=card(), P2=card(0.9))  # the pooled value, as write_synthesis admits it
    pooled = sp.pooled_keys({"0.84", ".84"})
    ok, = sp.summary_claims("Metformin lowered risk (HR 0.80) [P1].")
    bad, = sp.summary_claims("Metformin lowered risk (HR 0.80) [P2].")
    pool, = sp.summary_claims("Pooled, risk was lower (0.84) [P1, P2].")
    words, = sp.summary_claims("Metformin lowered risk [P1].")
    assert sp.claim_checks(ok, c, pooled) == (True, False)
    assert sp.claim_checks(bad, c, pooled) == (False, False)
    assert sp.claim_checks(pool, c, pooled) == (True, True)  # admitted as a pooled value, but computed
    assert sp.claim_checks(words, c, pooled) == (True, False)


def test_pairs_skip_papers_without_abstract_not_evidence_and_computed_claims():
    claims = sp.summary_claims("Lower risk [P1, P2, P3]. Pooled 0.84 [P1].") + sp.finding_claims(
        [{"statement": "Metformin lowers risk.", "refs": ["P1"]}])
    pairs = sp.build_pairs(claims, {"P1": ABSTRACT, "P2": None, "P3": ABSTRACT}, skip={"P3", "s1"})
    assert [(p.id, p.claim.id, p.ref) for p in pairs] == [("c1", "s0", "P1"), ("c2", "k0", "P1")]
    items = sp.judge_items(pairs)
    assert items[0] == {"id": "c1", "paper": "P1", "claim": "Lower risk [P1, P2, P3].",
                        "candidates": [s for s, _ in pairs[0].candidates]}
    assert all(s in ABSTRACT for s in items[0]["candidates"])


def test_the_judge_schema_is_strict_compatible():
    schema = SupportBatch.model_json_schema()
    verdict = schema["$defs"]["SupportVerdict"]
    assert set(verdict["required"]) == {"id", "label", "sentence"} and "default" not in json.dumps(schema)
    assert verdict["properties"]["label"]["enum"] == list(sp.LABELS)


def _pairs():
    claims = sp.summary_claims("Metformin lowers colorectal cancer risk [P1, P2].")
    return sp.build_pairs(claims, {"P1": ABSTRACT, "P2": ABSTRACT}, skip=set())


def test_verdict_problems_ask_for_one_valid_verdict_per_id():
    pairs = _pairs()
    good = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=1),
                                  SupportVerdict(id="c2", label="unsupported", sentence=None)])
    assert sp.verdict_problems(good, pairs) == []
    bad = SupportBatch(verdicts=[SupportVerdict(id="c1", label="partial", sentence=3),
                                 SupportVerdict(id="c1", label="supported", sentence=1),
                                 SupportVerdict(id="c9", label="supported", sentence=1)])
    problems = sp.verdict_problems(bad, pairs)
    assert any("c1: sentence must name" in p for p in problems)
    assert any("c1 answered twice" in p for p in problems)
    assert any("unknown id c9" in p for p in problems)
    assert any("missing verdicts for c2" in p for p in problems)
    assert sp.verdict_problems("not a batch", pairs) == [
        "answer with a JSON object that has a `verdicts` list (id, label, sentence)"]


def test_usable_verdicts_drop_repeats_unknown_ids_and_missing_sentences():
    pairs = _pairs()
    value = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=2),
                                   SupportVerdict(id="c1", label="partial", sentence=1),
                                   SupportVerdict(id="c2", label="partial", sentence=None),
                                   SupportVerdict(id="c7", label="supported", sentence=1)])
    assert sp.verdicts(value, pairs) == {}
    value = SupportBatch(verdicts=[SupportVerdict(id="c1", label="supported", sentence=2),
                                   SupportVerdict(id="c2", label="unsupported", sentence=2)])
    assert sp.verdicts(value, pairs) == {"c1": ("supported", 1), "c2": ("unsupported", None)}
    assert sp.verdicts(None, pairs) == {}


def test_the_badge_needs_supported_checked_numbers_no_pool_and_evidence():
    pair = _pairs()[0]
    first, second = pair.candidates[0][0], pair.candidates[1][0]
    kw = {"numbers_checked": True, "computed": False, "not_evidence": False}
    c = sp.citation(pair, "P1", ("supported", 1), **kw)
    assert c == {"ref": "P1", "label": "supported", "evidence": second, "score": pair.candidates[1][1],
                 "not_evidence": False, "verified": True}
    assert sp.citation(pair, "P1", ("partial", 0), **kw)["verified"] is False
    unsupported = sp.citation(pair, "P1", ("unsupported", None), **kw)
    assert unsupported["evidence"] == first and unsupported["verified"] is False  # the closest sentence, shown as such
    assert sp.citation(pair, "P1", None, **kw) | {"evidence": None} == {
        "ref": "P1", "label": None, "evidence": None, "score": pair.candidates[0][1], "not_evidence": False,
        "verified": False}
    assert sp.citation(pair, "P1", ("supported", 0), **(kw | {"numbers_checked": False}))["verified"] is False
    assert sp.citation(pair, "P1", ("supported", 0), **(kw | {"computed": True}))["verified"] is False
    assert sp.citation(pair, "P1", ("supported", 0), **(kw | {"not_evidence": True}))["verified"] is False
    assert sp.citation(None, "P3", None, **kw) == {"ref": "P3", "label": None, "evidence": None, "score": None,
                                                   "not_evidence": False, "verified": False}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_support.py -q`

Expected: collection error, `ImportError: cannot import name 'SupportBatch' from 'app.graph.schemas'`.

- [ ] **Step 3: Implement**

**Edit** `backend/app/graph/schemas.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


class ExternalCall(BaseModel):
    tool: str
```

   with

```python


class SupportVerdict(BaseModel):
    """Plan 25: the judge's label for one (claim, cited paper) pair. `sentence`: the 1-based candidate that supports
    the claim (supported, partial); null when unsupported."""
    id: str
    label: Literal["supported", "partial", "unsupported"]
    sentence: int | None


class SupportBatch(BaseModel):
    verdicts: list[SupportVerdict]


class ExternalCall(BaseModel):
    tool: str
```

**Edit** `backend/app/harness/prose.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


def _sentences(text: str) -> list[str]:
    return _SENTENCE.split(text.strip()) if text and text.strip() else []
```

   with

```python


def unverified_numbers(sentence: str, refs: list[str], ctx: ProseContext) -> list[str]:
    """Plan 25: the numbers of `sentence` that trace to none of `refs`' verified card numbers, the review's own text,
    a pooled value or a count (the rule `prose_problems` applies to the summary). An empty scope is every paper."""
    scope = [r for r in refs if r in ctx.facts] or list(ctx.facts)
    about_search = bool(_SEARCH.search(sentence))
    return [t.text for t in _tokens(sentence) if not _admitted(t, sentence, scope, ctx, about_search)]


def _sentences(text: str) -> list[str]:
    return _SENTENCE.split(text.strip()) if text and text.strip() else []
```

**New file** `backend/app/harness/support.py` (complete):

```python
"""Sentence support (Plan 25): does the cited abstract support the sentence that cites it?

Claims are the English text before localization:
- each sentence of the executive summary that carries a citation group (`MARKER`, the groups the report links:
  "[P1]" or "[P1, P3]"); the k-th group of the summary is marker k, and every group of a sentence shares its claim;
- each key finding's statement with its refs (key finding i).

For every (claim, cited paper) pair the scorer picks, without an LLM, the abstract sentences closest to the claim
(content-word overlap with the claim, plus agreement on the claim's numbers) and keeps the best `CANDIDATES`. A judge
(app.graph.nodes.support) then labels the pair supported | partial | unsupported from those sentences only, never
from the whole abstract. The evidence shown is always a sentence copied from the abstract, chosen by index: the
judge never writes it.

The "ตรวจแล้ว" badge (`verified`) needs all of: the judge said supported, every number of the claim traces to a
verified number of the cited papers or to the review's own text (the prose check's rule, `prose.unverified_numbers`),
the claim restates no pooled value (a computed number is never supported by an abstract), and the paper is evidence
(not a further report of a trial, not a design outside the ticked study types).
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from app.graph.schemas import SupportBatch
from app.harness.prose import ProseContext, unverified_numbers
from app.harness.verify import tokens

LABELS = ("supported", "partial", "unsupported")
CANDIDATES = 2  # abstract sentences per pair sent to the judge
MAX_PAIRS = 30  # pairs judged per review; the rest keep their closest sentence, unjudged
MAX_CLAIM_CHARS = 600
MAX_SENTENCE_CHARS = 500
MIN_SENTENCE_CHARS = 20

# The citation groups the report turns into links (frontend report-parts.tsx `CITE`): "[P1]" or "[P1, P3]". A range
# ("[P1-P3]") is not a link there, so it is no marker here either.
MARKER = re.compile(r"\[(P\d+(?:\s*,\s*P\d+)*)\]")
_REF = re.compile(r"P\d+")
# A sentence ends at . ! ? or a citation group before a capital letter (never before "[": a group after the full
# stop belongs to the sentence before it), not after a common abbreviation or an initial.
_CLAIM_END = re.compile(r"(?<=[.!?\]])\s+(?=[A-Z])")
_ABSTRACT_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[])|\s*\n+\s*")
_ABBREVIATION = re.compile(r"(?:\b(?:vs|Vs|et al|approx|Approx|Figs?|No|Nos|cf|e\.g|i\.e)|(?<![\w.])[A-Z])\.$")
_WORD = re.compile(r"[a-z][a-z0-9-]*")
_STOP = """
a about above after again against all also among an and any are as at be been before being between both but by can
could did do does during each either few for from further had has have having here how however if in into is it its
itself may might more most much must no nor not of on once only or other our out over own per same should so some
such than that the their them then there these they this those through to too under until up upon very was we were
what when where whether which while who whom why will with within without would yet
study studies trial trials paper papers patient patients participant participants result results reported report
reports showed show shows found find finding findings evidence associated association compared group groups
"""
STOPWORDS = frozenset(_STOP.split())


def markers(text: str | None) -> list[list[str]]:
    """The refs of each citation group of `text`, in order (the report's marker index is the list index)."""
    return [_REF.findall(m.group(1)) for m in MARKER.finditer(text or "")]


def _split(text: str, boundary: re.Pattern[str]) -> list[tuple[int, int]]:
    """(start, end) spans of the sentences of `text`, never split after an abbreviation or an initial."""
    spans: list[tuple[int, int]] = []
    start = 0
    for m in boundary.finditer(text):
        piece = text[start:m.start()]
        if piece.strip() and not _ABBREVIATION.search(piece.rstrip()):
            spans.append((start, m.start()))
            start = m.end()
        elif not piece.strip():
            start = m.end()
    if text[start:].strip():
        spans.append((start, len(text)))
    return spans


def abstract_sentences(abstract: str | None) -> list[str]:
    """The abstract's sentences, verbatim (whitespace at the edges trimmed), at least MIN_SENTENCE_CHARS long."""
    text = abstract or ""
    out = [text[a:b].strip() for a, b in _split(text, _ABSTRACT_END)]
    return [s for s in out if len(s) >= MIN_SENTENCE_CHARS]


def _stem(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def content_words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD.findall(MARKER.sub(" ", text).lower()) if len(w) >= 3 and w not in STOPWORDS}


def _numbers(text: str) -> set[Decimal | str]:
    return {t.key for t in tokens(text) if not t.opaque} if text else set()


def score(claim: str, sentence: str) -> float:
    """How close an abstract sentence is to a claim: the share of the claim's content words it has, and, when the
    claim states numbers, the share of those numbers it has (weighted 0.6 / 0.4)."""
    words = content_words(claim)
    overlap = len(words & content_words(sentence)) / len(words) if words else 0.0
    nums = _numbers(MARKER.sub(" ", claim))
    if not nums:
        return round(overlap, 4)
    return round(0.6 * overlap + 0.4 * len(nums & _numbers(sentence)) / len(nums), 4)


def best_sentences(claim: str, sentences: list[str], k: int = CANDIDATES) -> list[tuple[str, float]]:
    """The k sentences closest to the claim, best first (ties: the earlier sentence)."""
    ranked = sorted(enumerate(sentences), key=lambda p: (-score(claim, p[1]), p[0]))
    return [(s, score(claim, s)) for _, s in ranked[:k]]


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


@dataclass
class Claim:
    id: str
    where: str  # "summary" | "key_finding"
    text: str  # the English sentence (summary: with its citation groups)
    refs: list[str]
    markers: list[int] | None = None  # summary: the marker indexes in this sentence
    finding: int | None = None  # key finding index


def summary_claims(summary: str | None) -> list[Claim]:
    """One claim per summary sentence that has a citation group; marker k is the k-th group of the whole text."""
    text = summary or ""
    groups = list(MARKER.finditer(text))
    out: list[Claim] = []
    k = 0
    for a, b in _split(text, _CLAIM_END):
        inside = [i for i, m in enumerate(groups) if a <= m.start() < b]
        if not inside:
            continue
        refs = list(dict.fromkeys(r for i in inside for r in _REF.findall(groups[i].group(1))))
        out.append(Claim(id=f"s{k}", where="summary", text=text[a:b].strip(), refs=refs, markers=inside))
        k += 1
    return out


def finding_claims(findings: Iterable[dict[str, Any]] | None) -> list[Claim]:
    return [Claim(id=f"k{i}", where="key_finding", text=(f.get("statement") or "").strip(),
                  refs=list(dict.fromkeys(f.get("refs") or [])), finding=i)
            for i, f in enumerate(findings or []) if (f.get("statement") or "").strip() and f.get("refs")]


def pooled_keys(strings: Iterable[str]) -> set[Decimal | str]:
    """Comparison keys of the pooled values' display strings (meta.pooled_number_strings)."""
    return {key for s in strings for key in _numbers(str(s))}


def claim_checks(claim: Claim, prose: ProseContext, pooled: set[Decimal | str]) -> tuple[bool, bool]:
    """(numbers_checked, computed). numbers_checked: every number of the claim traces to a verified number of the
    cited papers or to the review's own text (prose check rule). computed: the claim restates a pooled value that is
    no verified number of the cited papers."""
    text = MARKER.sub(" ", claim.text)
    refs = [r for r in claim.refs if r in prose.facts]
    own = set().union(*(prose.facts[r].numbers for r in refs)) if refs else set()
    computed = any(t.key in pooled and t.key not in own for t in tokens(text))
    return not unverified_numbers(text, refs, prose), computed


@dataclass
class Pair:
    id: str
    claim: Claim
    ref: str
    candidates: list[tuple[str, float]]


def build_pairs(claims: list[Claim], abstracts: dict[str, str | None], skip: set[str]) -> list[Pair]:
    """Every (claim, evidence paper) pair, summary first, in text order; a pair is made only for a paper with an
    abstract sentence. `skip`: refs never judged (not evidence) and claims never judged (computed)."""
    pairs: list[Pair] = []
    for claim in claims:
        if claim.id in skip:
            continue
        for ref in claim.refs:
            sentences = abstract_sentences(abstracts.get(ref))
            if ref in skip or not sentences:
                continue
            pairs.append(Pair(id=f"c{len(pairs) + 1}", claim=claim, ref=ref,
                              candidates=best_sentences(MARKER.sub(" ", claim.text), sentences)))
    return pairs


def judge_items(pairs: list[Pair]) -> list[dict[str, Any]]:
    return [{"id": p.id, "paper": p.ref, "claim": _clip(p.claim.text, MAX_CLAIM_CHARS),
             "candidates": [_clip(s, MAX_SENTENCE_CHARS) for s, _ in p.candidates]} for p in pairs]


def verdict_problems(value: BaseModel | Any, pairs: list[Pair]) -> list[str]:
    """Repair messages for a judge answer: one verdict per id, ids copied, a candidate number for supported and
    partial."""
    if not isinstance(value, SupportBatch):
        return ["answer with a JSON object that has a `verdicts` list (id, label, sentence)"]
    known = {p.id: len(p.candidates) for p in pairs}
    problems: list[str] = []
    seen: set[str] = set()
    for v in value.verdicts:
        if v.id not in known:
            problems.append(f"unknown id {v.id}; answer only for the ids given")
        elif v.id in seen:
            problems.append(f"id {v.id} answered twice; give one verdict per id")
        elif v.label != "unsupported" and not (v.sentence is not None and 1 <= v.sentence <= known[v.id]):
            problems.append(f"id {v.id}: sentence must name the supporting candidate (1 to {known[v.id]}) when the "
                            f"label is {v.label}")
        seen.add(v.id)
    missing = [i for i in known if i not in seen]
    if missing:
        problems.append(f"missing verdicts for {', '.join(missing)}; answer once for every id")
    return problems


def verdicts(value: Any, pairs: list[Pair]) -> dict[str, tuple[str, int | None]]:
    """The usable verdicts of a judge answer (also of one still invalid after repairs): id -> (label, candidate
    index or None). A verdict for an unknown id, a repeated id or a supported/partial verdict without a valid
    candidate is dropped (that pair stays unjudged)."""
    if not isinstance(value, SupportBatch):
        return {}
    known = {p.id: len(p.candidates) for p in pairs}
    out: dict[str, tuple[str, int | None]] = {}
    dropped: set[str] = set()
    for v in value.verdicts:
        if v.id not in known or v.id in out or v.id in dropped:
            dropped.add(v.id)
            out.pop(v.id, None)
            continue
        if v.label == "unsupported":
            out[v.id] = (v.label, None)
        elif v.sentence is not None and 1 <= v.sentence <= known[v.id]:
            out[v.id] = (v.label, v.sentence - 1)
    return out


def citation(pair: Pair | None, ref: str, verdict: tuple[str, int | None] | None, *, numbers_checked: bool,
             computed: bool, not_evidence: bool) -> dict[str, Any]:
    """One cited paper of a claim, as stored in result.support. `evidence` is the supporting sentence (supported,
    partial) or else the closest sentence; `verified` is the badge rule."""
    label, index = verdict if verdict else (None, None)
    evidence = score_ = None
    if pair is not None and pair.candidates:
        evidence, score_ = pair.candidates[index if index is not None else 0]
    return {"ref": ref, "label": label, "evidence": evidence, "score": score_, "not_evidence": not_evidence,
            "verified": bool(label == "supported" and numbers_checked and not computed and not not_evidence)}


def claim_record(claim: Claim, citations: list[dict[str, Any]], *, numbers_checked: bool,
                 computed: bool) -> dict[str, Any]:
    return {"id": claim.id, "where": claim.where, "markers": claim.markers, "finding": claim.finding,
            "claim": claim.text, "refs": claim.refs, "numbers_checked": numbers_checked, "computed": computed,
            "citations": citations}
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_support.py -q`

Expected: 12 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-25/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2237 passed, 17 skipped (pre-flight; `test_capacity.py::test_queue_position` failed once here, the known flake, and passed on rerun).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(support): claims, abstract sentences, the candidate scorer and the badge rule (Plan 25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-25 && git add backend/tests/unit/test_support.py backend/app/graph/schemas.py backend/app/harness/prose.py backend/app/harness/support.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 2: The check_support node, the graph, result.support, quality and prompt_version

**Files:**
- Modify: `backend/app/graph/prompts.py`
- Create: `backend/app/graph/nodes/support.py`
- Modify: `backend/app/graph/state.py`
- Modify: `backend/app/graph/graph.py`
- Modify: `backend/app/graph/nodes/synthesis.py`
- Modify: `backend/app/harness/quality.py`
- Modify: `backend/app/config.py`
- Test (create): `backend/tests/unit/test_support_node.py`
- Test (modify): `backend/tests/unit/test_prompts_by_type.py`
- Test (modify): `backend/tests/unit/test_review_graph.py`
- Test (modify): `backend/tests/unit/test_eval_graph.py`

**Interfaces:**
- Consumes: everything Task 1 produces; `harness_runner(deps)`; `LLMs.with_schema`; `current_budget()`; `_narrative_papers`, `_prose_context`, `_review_type`, `design_excluded`, `related`, `unique_papers`; `pooled_number_strings`.
- Produces:
  - `SUPPORT_SYSTEM: str` and `support_user(*, items: list[dict]) -> str` in `app/graph/prompts.py` (pinned in `test_support_prompts_are_pinned`).
  - `app/graph/nodes/support.py`: `JUDGE_ROLE = "screener"`, `MIN_BUDGET_USD = 0.01`, `budget_left() -> float | None`, `make_check_support(deps)` → node returning `{"support": {"judge", "markers", "claims"} | None, "cost_usd", "errors", "quality": [{"stage": "support", ...}]}`; judge statuses `ok | incomplete | failed | skipped_budget | none` (and `crashed` in quality).
  - `ReviewState.support`; graph node `check_support` in `_add_review_nodes` with edges `write_synthesis → check_support → finalize`.
  - `result.support` (`_support_result` adds `display_aligned`); `quality.support = {judge, seconds, claims, pairs, judged, over_cap, computed, supported, partial, unsupported, verified}`.
  - `Settings.prompt_version == "2026-10-13.1"`.
  - Test doubles: `support_judge(role)` in `tests/unit/test_review_graph.py` (free fake judge bound through `bind_by_role`).

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_support_node.py` (complete):

```python
"""Plan 25: the check_support node (one judge call per review, soft-fail, budget) and result.support in finalize."""
import json
import re

from app.config import Settings
from app.graph import prompts
from app.graph.graph import GraphDeps
from app.graph.nodes import support as node
from app.graph.nodes.synthesis import make_finalize
from app.graph.schemas import Candidate, SupportBatch, SupportVerdict
from app.harness import support as sp
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import LLMError, LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM

ABSTRACT = (
    "Methods: We followed 1,234 adults with type 2 diabetes for 8 years in a population-based cohort. "
    "Results: Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90). "
    "Conclusions: Metformin may lower colorectal cancer risk in adults with diabetes."
)
SUMMARY = ("Metformin was associated with a lower colorectal cancer risk (HR 0.80) [P1]. Two cohorts agree [P1, P2]. "
           "Risk fell by 0.55 in one cohort [P2].")
FINDINGS = [{"outcome": "CRC incidence", "statement": "Metformin may lower colorectal cancer risk.",
             "refs": ["P1", "P2"], "k": 2, "certainty": "low"}]


def card(value=0.8, design="cohort"):
    return {"study_design": design, "design_category": design, "population": "adults with type 2 diabetes",
            "sample_size": 1234, "intervention_or_exposure": "metformin", "comparator": "no metformin",
            "outcomes": [{"outcome": "CRC incidence", "result": "lower risk", "evidence_quote": "q",
                          "effect_size": f"HR {value}", "effect_measure": "HR", "effect_value": value,
                          "ci_lower": 0.71, "ci_upper": 0.9, "p_value": None, "direction": "positive",
                          "matches_question": True, "comparison": "metformin vs no metformin"}],
            "key_findings": [], "limitations": [], "funding_or_conflicts": None, "risk_of_bias": "moderate",
            "overall_direction": "positive"}


def paper(ref, c=None, abstract=ABSTRACT):
    cand = Candidate(title=f"Paper {ref}", doi=f"10.1/{ref}", year=2020, abstract=abstract).model_dump()
    return {"ref": ref, "candidate": cand, "relevance": 90, "screen_reason": "ok", "card": c or card(), "error": None}


def state(summary=SUMMARY, findings=FINDINGS, papers=None, **extra):
    papers = papers if papers is not None else [paper("P1"), paper("P2")]
    return {"topic": "เมตฟอร์มิน", "english_topic": "metformin and CRC", "language": "th", "papers": papers,
            "question": {"refined_question": "Does metformin reduce CRC incidence in adults with T2D?"},
            "matrix": {"rows": [], "consensus": [], "conflicts": [], "grade": {"level": "low", "factors": []}},
            "synthesis": {"executive_summary": summary, "key_findings": findings}, **extra}


def items_in(user):
    return json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))


def supported(system, user):
    return SupportBatch(verdicts=[SupportVerdict(id=i["id"], label="supported", sentence=1) for i in items_in(user)])


def deps(judge, **kw):
    u = FakeStructuredLLM("u", lambda s, x: AssertionError("unexpected call"))
    llms = LLMs(guard=u, planner=u, screener=u, extractor=u, synthesizer=u, harness=HarnessSpec(max_repairs=1))
    asked = []

    def for_schema(role, schema):
        asked.append((role, schema))
        return judge

    llms.for_schema = for_schema
    d = GraphDeps(settings=Settings(_env_file=None), llms=llms)
    d.asked = asked
    return d


async def test_one_judge_call_labels_every_pair_on_the_screener_model():
    judge = FakeStructuredLLM("judge", supported, cost=0.002)
    d = deps(judge)
    out = await node.make_check_support(d)(state())
    assert d.asked == [("screener", SupportBatch)] and len(judge.calls) == 1
    system, user = judge.calls[0]
    assert system == prompts.SUPPORT_SYSTEM
    items = items_in(user)
    assert [(i["id"], i["paper"]) for i in items] == [("c1", "P1"), ("c2", "P1"), ("c3", "P2"), ("c4", "P2"),
                                                     ("c5", "P1"), ("c6", "P2")]
    assert all(s in ABSTRACT for i in items for s in i["candidates"]) and ABSTRACT not in user  # sentences only
    s = out["support"]
    assert s["judge"] == "ok" and s["markers"] == [["P1"], ["P1", "P2"], ["P2"]]
    first, second, third, finding = s["claims"]
    assert (first["id"], first["markers"], first["numbers_checked"], first["computed"]) == ("s0", [0], True, False)
    assert first["citations"][0]["label"] == "supported" and first["citations"][0]["verified"] is True
    assert first["citations"][0]["evidence"].startswith("Results: Metformin use")
    assert second["markers"] == [1] and [c["verified"] for c in second["citations"]] == [True, True]
    # "0.55" is no verified number of P2: supported, but no badge
    assert third["numbers_checked"] is False and third["citations"][0] | {"evidence": None, "score": None} == {
        "ref": "P2", "label": "supported", "evidence": None, "score": None, "not_evidence": False, "verified": False}
    assert (finding["id"], finding["where"], finding["finding"], finding["markers"]) == ("k0", "key_finding", 0, None)
    assert [c["verified"] for c in finding["citations"]] == [True, True]
    assert out["cost_usd"] == 0.002 and out["errors"] == []
    q = out["quality"][0]
    assert {k: q[k] for k in ("stage", "judge", "claims", "pairs", "judged", "over_cap", "computed", "supported",
                              "partial", "unsupported", "verified")} == {
        "stage": "support", "judge": "ok", "claims": 4, "pairs": 6, "judged": 6, "over_cap": 0, "computed": 0,
        "supported": 6, "partial": 0, "unsupported": 0, "verified": 5}


async def test_papers_that_are_not_evidence_and_pooled_claims_are_never_judged():
    judge = FakeStructuredLLM("judge", supported)
    meta = {"pools": [{"outcome": "CRC incidence", "pooled": {"est": 0.84, "ci_lower": 0.75, "ci_upper": 0.94}}]}
    st = state(summary="The pooled estimate was 0.84 [P1, P2]. Cohorts agree [P1, P3].", findings=[],
               papers=[paper("P1"), paper("P2"), paper("P3", card(design="rct"))],
               options={"study_types": ["Cohort"], "review_type": "meta_analysis"}, meta_analysis=meta)
    out = await node.make_check_support(deps(judge))(st)
    assert [(i["id"], i["paper"]) for i in items_in(judge.calls[0][1])] == [("c1", "P1")]
    pooled, cohorts = out["support"]["claims"]
    assert pooled["computed"] is True and all(c["label"] is None and not c["verified"] for c in pooled["citations"])
    p3 = cohorts["citations"][1]
    assert p3 == {"ref": "P3", "label": None, "evidence": None, "score": None, "not_evidence": True, "verified": False}
    assert out["quality"][0]["computed"] == 1


async def test_a_nearly_spent_budget_skips_the_judge_and_keeps_the_closest_sentences():
    judge = FakeStructuredLLM("judge", supported)
    with use_budget(ReviewBudget(cap_usd=0.10, spent=0.095)):
        out = await node.make_check_support(deps(judge))(state())
    assert judge.calls == [] and out["support"]["judge"] == "skipped_budget" and out["cost_usd"] == 0.0
    cite = out["support"]["claims"][0]["citations"][0]
    assert cite["label"] is None and cite["verified"] is False and cite["evidence"].startswith("Results: Metformin")
    assert out["errors"] == []  # a skip is telemetry, not an error


async def test_a_failing_judge_leaves_support_unknown_and_never_fails_the_review():
    out = await node.make_check_support(deps(FakeStructuredLLM("judge", lambda s, u: LLMError("down"))))(state())
    assert out["support"]["judge"] == "failed" and len(out["support"]["claims"]) == 4
    assert all(c["label"] is None for claim in out["support"]["claims"] for c in claim["citations"])
    assert out["errors"] == ["sentence-support check failed: no usable verdict, support is unknown"]
    # no schema factory at all (a bare LLMs): the same soft path
    d = deps(None)
    d.llms.for_schema = None
    out = await node.make_check_support(d)(state())
    assert out["support"]["judge"] == "failed"


async def test_an_answer_still_invalid_after_repairs_keeps_its_usable_verdicts():
    def half(system, user):
        return SupportBatch(verdicts=[SupportVerdict(id="c1", label="partial", sentence=1),
                                      SupportVerdict(id="c2", label="supported", sentence=9)])

    judge = FakeStructuredLLM("judge", half)
    out = await node.make_check_support(deps(judge))(state())
    assert len(judge.calls) == 2  # one repair round (max_repairs=1), no escalation configured
    assert "missing verdicts" in judge.calls[1][1]
    assert out["support"]["judge"] == "incomplete"
    labels = [c["label"] for claim in out["support"]["claims"] for c in claim["citations"]]
    assert labels == ["partial", None, None, None, None, None]


async def test_pairs_over_the_cap_stay_unjudged():
    findings = [{"outcome": f"o{i}", "statement": "Metformin may lower colorectal cancer risk.", "refs": ["P1", "P2"],
                 "k": 2, "certainty": None} for i in range(20)]
    judge = FakeStructuredLLM("judge", supported)
    out = await node.make_check_support(deps(judge))(state(summary="", findings=findings))
    assert len(items_in(judge.calls[0][1])) == sp.MAX_PAIRS
    q = out["quality"][0]
    assert q["pairs"] == 40 and q["judged"] == sp.MAX_PAIRS and q["over_cap"] == 10
    assert out["support"]["claims"][-1]["citations"][0]["label"] is None


async def test_no_claims_means_no_call():
    judge = FakeStructuredLLM("judge", supported)
    out = await node.make_check_support(deps(judge))(state(summary="No citations here.", findings=[]))
    assert judge.calls == [] and out["support"] == {"judge": "none", "markers": [], "claims": []}


async def test_a_crash_in_the_check_leaves_support_null(monkeypatch):
    def boom(*a, **k):
        raise ValueError("bug")

    monkeypatch.setattr(sp, "summary_claims", boom)
    out = await node.make_check_support(deps(FakeStructuredLLM("judge", supported)))(state())
    assert out["support"] is None and out["errors"] == ["sentence-support check failed: ValueError"]
    assert out["quality"][0]["judge"] == "crashed"


async def test_finalize_reports_whether_the_shown_summary_keeps_the_markers():
    d = deps(FakeStructuredLLM("judge", supported))
    st = state()
    st["support"] = (await node.make_check_support(d)(st))["support"]
    st["synthesis"] = {**st["synthesis"], "comparison": [], "consensus": [], "conflicts": [],
                       "evidence_rationale": "", "research_gaps": []}
    thai = "TH ไทย [P1] ไทย [P1, P2] ไทย [P2]"
    r = (await make_finalize(d)({**st, "synthesis_display": {**st["synthesis"], "executive_summary": thai}}))["result"]
    assert r["support"]["display_aligned"] is True and r["support"]["claims"][0]["id"] == "s0"
    moved = "TH ไทย [P1, P2] ไทย [P1] ไทย [P2]"
    r = (await make_finalize(d)({**st, "synthesis_display": {**st["synthesis"], "executive_summary": moved}}))["result"]
    assert r["support"]["display_aligned"] is False
    r = (await make_finalize(d)({**st, "support": None}))["result"]
    assert r["support"] is None
```

**Edit** `backend/tests/unit/test_prompts_by_type.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    # 120 with a SearXNG top-up, 5-50 papers) changed no prompt. Current version 2026-10-12.1: narrative and scoping
    # reviews get the synthesizer bound to NarrativeNoGrade (it was SynthesisNarrative, which asked for a grade the
    # code then discarded); the SLR schema and prompts are unchanged, so these SLR pins hold.
    "narrative_system": (prompts.narrative_system, "16278465ee36d386eede4011a039ce7adf15588592669958c92883bcc06b3b7d"),
}
```

   with

```python
    # 120 with a SearXNG top-up, 5-50 papers) changed no prompt. Current version 2026-10-12.1: narrative and scoping
    # reviews get the synthesizer bound to NarrativeNoGrade (it was SynthesisNarrative, which asked for a grade the
    # code then discarded); the SLR schema and prompts are unchanged, so these SLR pins hold. 2026-10-13.1 (Plan 25)
    # adds the sentence-support judge's own prompt and schema (pinned in test_support_prompts_are_pinned); no prompt
    # above changed.
    "narrative_system": (prompts.narrative_system, "16278465ee36d386eede4011a039ce7adf15588592669958c92883bcc06b3b7d"),
}
```

2. Replace

```python
    assert sha(prompts.plan_user(topic="t", english_topic="e", options=OPTIONS)) == \
        "62e2aa279649c998d48524f49a328bded2a683f672f70caaba24927e20b3e082"


```

   with

```python
    assert sha(prompts.plan_user(topic="t", english_topic="e", options=OPTIONS)) == \
        "62e2aa279649c998d48524f49a328bded2a683f672f70caaba24927e20b3e082"


def test_support_prompts_are_pinned():
    # Plan 25 (prompt_version 2026-10-13.1): the sentence-support judge, the same for every review type
    assert sha(prompts.SUPPORT_SYSTEM) == "e37eb91d393c02f009270d3e85bf330e796494c201a9105e5a65b0af0750c71a"
    assert sha(prompts.support_user(items=[{"id": "c1", "paper": "P1", "claim": "C [P1].",
                                            "candidates": ["S1", "S2"]}])) == \
        "5ada1084edb3e1926158e15643cbae9d47df59a116dfe9ae1d640814c8a301a1"


```

**Edit** `backend/tests/unit/test_review_graph.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python
    ScreenBatch,
    ScreenDecision,
    SynthesisNarrative,
    TopicVerdict,
```

   with

```python
    ScreenBatch,
    ScreenDecision,
    SupportBatch,
    SupportVerdict,
    SynthesisNarrative,
    TopicVerdict,
```

2. Replace

```python


def make_deps(*, allowed=True, results=None, extractor=None):
    if results is None:
```

   with

```python


def support_judge(role):
    """Plan 25: the sentence-support judge (the screener bound to SupportBatch) finds every pair supported by its
    first candidate. Free, so the cost and call-count checks stay about the review's own roles."""
    def judge(system, user):
        items = json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))
        return SupportBatch(verdicts=[SupportVerdict(id=i["id"], label="supported", sentence=1) for i in items])
    return FakeStructuredLLM(f"{role}:support", judge, cost=0.0)


def make_deps(*, allowed=True, results=None, extractor=None):
    if results is None:
```

3. Replace

```python
    )
    from app.evals.run import OutcomeMatch
    llms.for_schema = bind_by_role(llms, {OutcomeMatch: eval_match_none})
    return GraphDeps(settings=Settings(_env_file=None, searxng_pages=1), llms=llms,
                     searxng=FakeSearxng(results), europepmc=FakeEpmc())
```

   with

```python
    )
    from app.evals.run import OutcomeMatch
    llms.for_schema = bind_by_role(llms, {OutcomeMatch: eval_match_none, SupportBatch: support_judge})
    return GraphDeps(settings=Settings(_env_file=None, searxng_pages=1), llms=llms,
                     searxng=FakeSearxng(results), europepmc=FakeEpmc())
```

4. Replace

```python
    assert all(by_ref[e["ref"]]["card_en"]["overall_direction"] == e["direction"] for e in extracted)
    assert all(by_ref[e["ref"]]["card_en"]["design_category"] == e["design"] for e in extracted)


```

   with

```python
    assert all(by_ref[e["ref"]]["card_en"]["overall_direction"] == e["direction"] for e in extracted)
    assert all(by_ref[e["ref"]]["card_en"]["design_category"] == e["design"] for e in extracted)


async def test_full_review_checks_sentence_support_beside_localize():
    deps = make_deps()
    values, events = await run(deps)
    s = values["result"]["support"]
    assert s["judge"] == "ok" and s["markers"] == [["P1", "P2"]] and s["display_aligned"] is True
    claim, = s["claims"]
    assert claim["claim"] == "Metformin is associated with lower CRC risk [P1, P2]." and claim["markers"] == [0]
    assert [(c["ref"], c["label"], c["verified"]) for c in claim["citations"]] == [
        ("P1", "supported", True), ("P2", "supported", True)]
    assert claim["citations"][0]["evidence"].startswith("Results: Metformin use was associated")
    assert values["result"]["quality"]["support"] | {"seconds": 0} == {
        "judge": "ok", "seconds": 0, "claims": 1, "pairs": 2, "judged": 2, "over_cap": 0, "computed": 0,
        "supported": 2, "partial": 0, "unsupported": 0, "verified": 2}
    assert ("screener", SupportBatch) in deps.llms.for_schema.requests
    assert [e["type"] for e in events].count("finalizing") == 1  # finalize waits for localize and the check


```

**Edit** `backend/tests/unit/test_eval_graph.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
                       primary_outcome="CRC incidence")
    assert rec.status == "done" and rec.primary_match.row_index == 0 and rec.primary_match.outcome
    assert asked == [("planner", OutcomeMatch)]


```

   with

```python
                       primary_outcome="CRC incidence")
    assert rec.status == "done" and rec.primary_match.row_index == 0 and rec.primary_match.outcome
    # Plan 25: the replay also runs the sentence-support check (the screener bound to SupportBatch)
    assert [a for a in asked if a[1] is OutcomeMatch] == [("planner", OutcomeMatch)]


```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_support_node.py tests/unit/test_prompts_by_type.py tests/unit/test_review_graph.py tests/unit/test_eval_graph.py -q`

Expected: collection error, `ImportError: cannot import name 'support' from 'app.graph.nodes'` (the pin test would fail with `AttributeError: ... SUPPORT_SYSTEM`).

- [ ] **Step 3: Implement**

**Edit** `backend/app/graph/prompts.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


EXTERNAL_SYSTEM = """You decide which external tools to call once to add useful background to a medical literature
review (for example an institutional drug formulary or a local trial registry). The tool catalogue is third-party
```

   with

```python


SUPPORT_SYSTEM = """You check whether sentences of a medical literature review are supported by the abstract of the
paper they cite. Each item gives a claim (one sentence of the review), the paper it cites (its [Pn] in the claim)
and up to two candidate sentences copied from that paper's abstract.
- supported: a candidate states what the claim says about this paper: the same population or setting, exposure or
  intervention, outcome and direction of effect, and every number the claim gives for this paper.
- partial: a candidate supports part of what the claim says about this paper, or a narrower or weaker statement;
  the rest is not in the candidates.
- unsupported: no candidate supports what the claim says about this paper, or a candidate contradicts it.
- A claim may cite several papers or compare them: judge only the part that cites this paper.
- sentence: the number (1 or 2) of the candidate that supports the claim best; null when unsupported.
- Judge only from the candidates, never from outside knowledge. Answer once for every id."""


def support_user(*, items: list[dict[str, Any]]) -> str:
    return (f"{DATA_NOTICE}\n<items>\n{json.dumps(items, ensure_ascii=False)}\n</items>\n\n"
            "Checklist before answering:\n- one verdict for every id above, the id copied exactly\n"
            "- sentence is 1 or 2 for supported and partial, null for unsupported")


EXTERNAL_SYSTEM = """You decide which external tools to call once to add useful background to a medical literature
review (for example an institutional drug formulary or a local trial registry). The tool catalogue is third-party
```

**New file** `backend/app/graph/nodes/support.py` (complete):

```python
"""Plan 25: the sentence-support check. It runs after write_synthesis, beside localize, on the English synthesis:
claims and candidate sentences in code (app.harness.support), then one judge call for the whole review on the
screener's model bound to SupportBatch, through the harness runner (validate → repair → escalate).

Soft: a judge that fails, answers garbage or is skipped for the budget leaves the labels null (unknown); a crash of
the check leaves `support` null. Neither ever fails the review or removes a citation."""
from __future__ import annotations

import logging
import time
from collections import Counter

from app.graph import prompts
from app.graph.nodes.intake import harness_runner
from app.graph.nodes.synthesis import (
    _narrative_papers,
    _prose_context,
    _review_type,
    design_excluded,
    related,
    unique_papers,
)
from app.graph.schemas import SupportBatch
from app.graph.state import ReviewState
from app.harness import support as sp
from app.harness.meta import pooled_number_strings
from app.services.budget import current_budget
from app.services.llm import LLMError

log = logging.getLogger(__name__)

JUDGE_ROLE = "screener"
MIN_BUDGET_USD = 0.01  # the judge is skipped when less than this is left of the review's cost cap


def budget_left() -> float | None:
    budget = current_budget()
    return None if budget is None else budget.cap_usd - budget.spent


async def _judge(deps, pairs: list[sp.Pair]) -> tuple[dict[str, tuple[str, int | None]], str, float]:
    """(verdicts, judge status, cost). Status: ok | incomplete | failed | skipped_budget | none."""
    if not pairs:
        return {}, "none", 0.0
    left = budget_left()
    if left is not None and left < MIN_BUDGET_USD:
        return {}, "skipped_budget", 0.0
    try:
        llm = deps.llms.with_schema(JUDGE_ROLE, SupportBatch)
        res = await harness_runner(deps).call(
            llm, prompts.SUPPORT_SYSTEM, prompts.support_user(items=sp.judge_items(pairs)), schema=SupportBatch,
            validate=lambda v: sp.verdict_problems(v, pairs), trigger="repair_failed")
    except LLMError as exc:
        log.warning("sentence-support judge failed: %s", exc)
        return {}, "failed", 0.0
    found = sp.verdicts(res.value, pairs)
    status = "ok" if res.ok and len(found) == len(pairs) else "incomplete" if found else "failed"
    return found, status, res.cost


def make_check_support(deps):
    async def check_support(state: ReviewState) -> dict:
        started = time.perf_counter()
        try:
            synthesis = state.get("synthesis") or {}
            summary = synthesis.get("executive_summary") or ""
            claims = sp.summary_claims(summary) + sp.finding_claims(synthesis.get("key_findings"))
            meta = state.get("meta_analysis") if _review_type(state) == "meta_analysis" else None
            prose = _prose_context(state, _narrative_papers(state), state.get("matrix") or {}, meta)
            pooled = sp.pooled_keys(pooled_number_strings(meta))
            checks = {c.id: sp.claim_checks(c, prose, pooled) for c in claims}
            not_evidence = set(design_excluded(state)) | set(related(state))
            abstracts = {p["ref"]: (p.get("candidate") or {}).get("abstract") for p in unique_papers(state)}
            computed = {c.id for c in claims if checks[c.id][1]}
            pairs = sp.build_pairs(claims, abstracts, not_evidence | computed)
            judged, over = pairs[: sp.MAX_PAIRS], pairs[sp.MAX_PAIRS:]
            found, status, cost = await _judge(deps, judged)
        except Exception as exc:  # the check is optional: the review goes on without it
            log.exception("sentence-support check failed")
            return {"support": None, "errors": [f"sentence-support check failed: {type(exc).__name__}"],
                    "quality": [{"stage": "support", "judge": "crashed",
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        by_pair = {(p.claim.id, p.ref): p for p in pairs}
        records = []
        for c in claims:
            numbers_checked, is_computed = checks[c.id]
            cites = []
            for ref in c.refs:
                pair = by_pair.get((c.id, ref))
                cites.append(sp.citation(pair, ref, found.get(pair.id) if pair else None,
                                         numbers_checked=numbers_checked, computed=is_computed,
                                         not_evidence=ref in not_evidence))
            records.append(sp.claim_record(c, cites, numbers_checked=numbers_checked, computed=is_computed))
        labels = Counter(label for label, _ in found.values())
        entry = {"stage": "support", "judge": status, "claims": len(claims), "pairs": len(pairs),
                 "judged": len(found), "over_cap": len(over), "computed": len(computed),
                 **{label: labels[label] for label in sp.LABELS},
                 "verified": sum(c["verified"] for r in records for c in r["citations"]),
                 "seconds": round(time.perf_counter() - started, 3)}
        errors = ["sentence-support check failed: no usable verdict, support is unknown"] if status == "failed" else []
        return {"support": {"judge": status, "markers": sp.markers(summary), "claims": records},
                "cost_usd": cost, "errors": errors, "quality": [entry]}

    return check_support
```

**Edit** `backend/app/graph/state.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    synthesis: dict[str, Any] | None  # Synthesis (English)
    synthesis_display: dict[str, Any] | None  # Synthesis in the user's language
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
```

   with

```python
    synthesis: dict[str, Any] | None  # Synthesis (English)
    synthesis_display: dict[str, Any] | None  # Synthesis in the user's language
    support: dict[str, Any] | None  # Plan 25: sentence support of the English synthesis (app.harness.support)
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
```

**Edit** `backend/app/graph/graph.py` (5 replacements; each `old` occurs exactly once):

1. Replace

```python
    screening,
    stubs,
    synthesis,
    thaijo,
```

   with

```python
    screening,
    stubs,
    support,
    synthesis,
    thaijo,
```

2. Replace

```python
def _add_review_nodes(b: StateGraph, deps: GraphDeps) -> None:
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations, thaijo_metadata) → normalize_outcomes
    → [pool_effects] → explain_conflict* → write_synthesis → localize → finalize. Shared by build_graph and the
    Plan 22a eval graph."""
    b.add_node("screen_batch", screening.make_screen_batch(deps))
    b.add_node("select_top", screening.make_select_top(deps))
```

   with

```python
def _add_review_nodes(b: StateGraph, deps: GraphDeps) -> None:
    """screen_batch* → select_top → read_paper* (+ external_enrich, fetch_citations, thaijo_metadata) → normalize_outcomes
    → [pool_effects] → explain_conflict* → write_synthesis → localize ∥ check_support → finalize. Shared by
    build_graph and the Plan 22a eval graph."""
    b.add_node("screen_batch", screening.make_screen_batch(deps))
    b.add_node("select_top", screening.make_select_top(deps))
```

3. Replace

```python
    b.add_node("write_synthesis", synthesis.make_write_synthesis(deps))
    b.add_node("localize", synthesis.make_localize(deps))
    b.add_node("finalize", synthesis.make_finalize(deps))
    b.add_edge("screen_batch", "select_top")
```

   with

```python
    b.add_node("write_synthesis", synthesis.make_write_synthesis(deps))
    b.add_node("localize", synthesis.make_localize(deps))
    b.add_node("check_support", support.make_check_support(deps))
    b.add_node("finalize", synthesis.make_finalize(deps))
    b.add_edge("screen_batch", "select_top")
```

4. Replace

```python
    b.add_conditional_edges("pool_effects", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
    b.add_edge("write_synthesis", "localize")
    b.add_edge("localize", "finalize")
    b.add_edge("finalize", END)

```

   with

```python
    b.add_conditional_edges("pool_effects", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
    # Plan 25: the support check reads the English synthesis, so it runs beside localize; finalize waits for both
    b.add_edge("write_synthesis", "localize")
    b.add_edge("write_synthesis", "check_support")
    b.add_edge("localize", "finalize")
    b.add_edge("check_support", "finalize")
    b.add_edge("finalize", END)

```

5. Replace

```python
    """topic_guard → refine_question → plan_queries → search → enrich → screen_batch* → select_top
    → read_paper* → normalize_outcomes → [pool_effects, meta_analysis only] → explain_conflict* → write_synthesis
    → localize → finalize (* = Send fan-out, run in parallel)."""
    if deps.llms is None:
        return build_stub_graph(checkpointer, deps.settings.stub_delay_seconds, deps.settings)
```

   with

```python
    """topic_guard → refine_question → plan_queries → search → enrich → screen_batch* → select_top
    → read_paper* → normalize_outcomes → [pool_effects, meta_analysis only] → explain_conflict* → write_synthesis
    → localize ∥ check_support → finalize (* = Send fan-out, run in parallel; ∥ = side by side)."""
    if deps.llms is None:
        return build_stub_graph(checkpointer, deps.settings.stub_delay_seconds, deps.settings)
```

**Edit** `backend/app/graph/nodes/synthesis.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.harness.quality import summarize_quality
from app.harness.study_types import allowed_designs, design_allowed
from app.harness.trials import related_reports
from app.harness.verify import check_citations, strip_unknown_citations
```

   with

```python
from app.harness.quality import summarize_quality
from app.harness.study_types import allowed_designs, design_allowed
from app.harness.support import markers as support_markers
from app.harness.trials import related_reports
from app.harness.verify import check_citations, strip_unknown_citations
```

2. Replace

```python


def _iso(epoch: Any) -> str | None:
    if not isinstance(epoch, int | float):
```

   with

```python


def _support_result(support: dict[str, Any] | None, display: dict[str, Any]) -> dict[str, Any] | None:
    """result.support (Plan 25): the check's output plus `display_aligned`, whether the shown summary carries the same
    citation groups in the same order as the English one (the report then ties marker k to claim k directly)."""
    if not support:
        return None
    return {**support, "display_aligned": support_markers(display.get("executive_summary")) == support.get("markers")}


def _iso(epoch: Any) -> str | None:
    if not isinstance(epoch, int | float):
```

3. Replace

```python
            "meta_analysis": _meta_result(state, synthesis_en, synthesis),
            "methods": _methods(state, deps, models),
        }
        progress_writer()({"type": "finalizing"})
```

   with

```python
            "meta_analysis": _meta_result(state, synthesis_en, synthesis),
            "methods": _methods(state, deps, models),
            "support": _support_result(state.get("support"), synthesis),
        }
        progress_writer()({"type": "finalizing"})
```

**Edit** `backend/app/harness/quality.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    if enrich and "off_focus" in enrich[-1]:  # candidates naming no key term, moved behind the on-topic ones
        extra["off_focus_demoted"] = enrich[-1]["off_focus"]
    templated = [e["templated"] for e in by_stage.get("localize", []) if "templated" in e]
    if templated:  # consensus/conflict strings rendered from fixed Thai templates in code
```

   with

```python
    if enrich and "off_focus" in enrich[-1]:  # candidates naming no key term, moved behind the on-topic ones
        extra["off_focus_demoted"] = enrich[-1]["off_focus"]
    support = by_stage.get("support") or []
    if support:  # Plan 25: the sentence-support check (absent in results stored before it)
        last = support[-1]
        extra["support"] = {"judge": last.get("judge"), "seconds": last.get("seconds")} | {
            k: int(last.get(k, 0)) for k in ("claims", "pairs", "judged", "over_cap", "computed", "supported",
                                             "partial", "unsupported", "verified")}
    templated = [e["templated"] for e in by_stage.get("localize", []) if "templated" in e]
    if templated:  # consensus/conflict strings rendered from fixed Thai templates in code
```

**Edit** `backend/app/config.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    graph_mode: str = "real"  # "stub" = Plan 1 placeholder graph (plumbing tests without Claude)
    stub_delay_seconds: float = 0.0  # stub graph only: simulated review duration for load tests
    prompt_version: str = "2026-10-12.1"

    searxng_engines: str = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire"
```

   with

```python
    graph_mode: str = "real"  # "stub" = Plan 1 placeholder graph (plumbing tests without Claude)
    stub_delay_seconds: float = 0.0  # stub graph only: simulated review duration for load tests
    prompt_version: str = "2026-10-13.1"

    searxng_engines: str = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire"
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_support_node.py tests/unit/test_prompts_by_type.py tests/unit/test_review_graph.py tests/unit/test_eval_graph.py -q`

Expected: 79 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-25/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2249 passed, 17 skipped.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(support): one judge call per review beside localize, result.support and quality.support; prompt_version 2026-10-13.1 (Plan 25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-25 && git add backend/tests/unit/test_support_node.py backend/tests/unit/test_prompts_by_type.py backend/tests/unit/test_review_graph.py backend/tests/unit/test_eval_graph.py backend/app/graph/prompts.py backend/app/graph/nodes/support.py backend/app/graph/state.py backend/app/graph/graph.py backend/app/graph/nodes/synthesis.py backend/app/harness/quality.py backend/app/config.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 3: Support in the stub result, and the harness support rate

**Files:**
- Modify: `backend/app/graph/nodes/stub_result.py`
- Modify: `backend/app/evals/metrics.py`
- Modify: `backend/app/evals/report.py`
- Test (create): `backend/tests/unit/test_support_stub.py`
- Test (modify): `backend/tests/unit/test_eval_metrics.py`

**Interfaces:**
- Consumes: `finding_claims`, `claim_record` (Task 1); the `result.support` shape (Task 2).
- Produces:
  - `stub_result(...)["support"]` (`_stub_support`, `_STUB_LABEL`): key-finding claims, P2 partial, P4 unsupported, every other ref supported and verified; `display_aligned: True`.
  - `ReviewMetrics.support_citations/support_judged/support_supported/support_verified`; `aggregate(...)["support_rate"]` and `["support_verified_rate"]` (`_rate` tuples or None); report rows "Sentence support: supported / judged citations" and "Citations with the ตรวจแล้ว badge".

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_support_stub.py` (complete):

```python
"""Plan 25: the timed stub's result carries `support` in the engine's shape, so a stub review shows the badge."""
from app.graph.nodes.stub_result import stub_result
from app.harness import support as sp


def test_the_stub_result_carries_support_in_the_engine_shape():
    s = stub_result("x", "th", "slr")["support"]
    assert s["judge"] == "ok" and s["markers"] == [] and s["display_aligned"] is True
    first = s["claims"][0]
    assert (first["id"], first["where"], first["finding"]) == ("k0", "key_finding", 0)
    assert {c["label"] for c in first["citations"]} == {"supported", "partial", "unsupported"}
    assert all(c["verified"] == (c["label"] == "supported") for claim in s["claims"] for c in claim["citations"])
    shape = sp.claim_record(sp.finding_claims([{"statement": "s", "refs": ["P1"]}])[0], [], numbers_checked=True,
                            computed=False)
    assert set(first) == set(shape)
    assert set(first["citations"][0]) == {"ref", "label", "evidence", "score", "not_evidence", "verified"}


def test_every_review_type_has_stub_support():
    for review_type in ("slr", "meta_analysis", "scoping", "narrative"):
        claims = stub_result("x", "en", review_type)["support"]["claims"]
        assert [c["id"] for c in claims] == ["k0", "k1"], review_type
```

**Edit** `backend/tests/unit/test_eval_metrics.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


def test_header_has_date_range_and_batch_cost():
    rows = [review_metrics(rec(1, 1, started="2026-10-09T08:00"), "cv"),
```

   with

```python


def test_support_rates_count_evidence_citations_of_done_runs():
    r = rec(1, 1)
    cite = lambda label, verified=False, not_evidence=False: {"ref": "P1", "label": label, "verified": verified,
                                                               "not_evidence": not_evidence}
    r.result["support"] = {"judge": "ok", "markers": [["P1"]], "claims": [
        {"id": "s0", "citations": [cite("supported", True), cite("partial"), cite(None)]},
        {"id": "k0", "citations": [cite("unsupported"), cite(None, not_evidence=True)]}]}
    m = review_metrics(r, "cv")
    assert (m.support_citations, m.support_judged, m.support_supported, m.support_verified) == (4, 3, 1, 1)
    a = aggregate([m, review_metrics(rec(1, 2), "cv"), review_metrics(rec(2, 1, status="error"), "cv")])
    assert a["support_rate"][0] == pytest.approx(1 / 3) and a["support_verified_rate"][0] == pytest.approx(1 / 4)
    md = render_report("p", "r", Manifest(seed=1), [m], {})
    assert "| Sentence support: supported / judged citations | 33.3% (" in md
    assert "| Citations with the ตรวจแล้ว badge | 25.0% (" in md
    assert aggregate([review_metrics(rec(1, 2), "cv")])["support_rate"] is None  # results before Plan 25


def test_header_has_date_range_and_batch_cost():
    rows = [review_metrics(rec(1, 1, started="2026-10-09T08:00"), "cv"),
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_support_stub.py tests/unit/test_eval_metrics.py -q`

Expected: 3 failed, 12 passed: the two stub tests (`KeyError: 'support'`) and `test_support_rates_count_evidence_citations_of_done_runs` (`AttributeError: 'ReviewMetrics' object has no attribute 'support_citations'`).

- [ ] **Step 3: Implement**

**Edit** `backend/app/graph/nodes/stub_result.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.harness.grade import analyse_meta
from app.harness.meta import with_display
from app.schemas.review import SLR_LIKE, ReviewOptions

```

   with

```python
from app.harness.grade import analyse_meta
from app.harness.meta import with_display
from app.harness.support import claim_record, finding_claims
from app.schemas.review import SLR_LIKE, ReviewOptions

```

2. Replace

```python
                          "grading": "GRADE-lite" if graded else None},
        },
    }


```

   with

```python
                          "grading": "GRADE-lite" if graded else None},
        },
        "support": _stub_support(synthesis, papers),
    }


_STUB_LABEL = {"P2": "partial", "P4": "unsupported"}  # every other cited stub paper is "supported"


def _stub_support(synthesis: dict[str, Any], papers: list[dict[str, Any]]) -> dict[str, Any]:
    """result.support (Plan 25) in the engine's shape, for the key findings (the stub summary cites nothing). Labels
    are fixed by ref so every state renders (supported with the badge, partial, unsupported); the evidence is the
    simulated card's finding. No judge runs."""
    finding = {p["ref"]: p["card"]["key_findings"][0] for p in papers}
    claims = []
    for c in finding_claims(synthesis["key_findings"]):
        cites = [{"ref": r, "label": _STUB_LABEL.get(r, "supported"), "evidence": finding.get(r), "score": None,
                  "not_evidence": False, "verified": r not in _STUB_LABEL} for r in c.refs]
        claims.append(claim_record(c, cites, numbers_checked=True, computed=False))
    return {"judge": "ok", "markers": [], "claims": claims, "display_aligned": True}


```

**Edit** `backend/app/evals/metrics.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
    pool_with_abstract: int = 0
    primary_direction: str = "none"


```

   with

```python
    pool_with_abstract: int = 0
    primary_direction: str = "none"
    # Plan 25 sentence support, over the evidence citations of the summary and key findings (0 before Plan 25)
    support_citations: int = 0
    support_judged: int = 0
    support_supported: int = 0
    support_verified: int = 0


```

2. Replace

```python
    m.answer_present = bool(((result.get("synthesis_en") or {}).get("answer") or "").strip())
    m.papers_analysed = len(result.get("papers") or [])
    return m

```

   with

```python
    m.answer_present = bool(((result.get("synthesis_en") or {}).get("answer") or "").strip())
    m.papers_analysed = len(result.get("papers") or [])
    cites = [c for claim in (result.get("support") or {}).get("claims") or [] for c in claim.get("citations") or []
             if not c.get("not_evidence")]
    m.support_citations = len(cites)
    m.support_judged = sum(1 for c in cites if c.get("label") is not None)
    m.support_supported = sum(1 for c in cites if c.get("label") == "supported")
    m.support_verified = sum(1 for c in cites if c.get("verified"))
    return m

```

3. Replace

```python
        "glossary_top_misses": misses.most_common(10),
        "answer_rate": _rate(sum(1 for r in done if r.answer_present), len(rows)),
        "cost_mean": statistics.fmean(costs) if costs else 0.0,
        "cost_median": statistics.median(costs) if costs else 0.0,
```

   with

```python
        "glossary_top_misses": misses.most_common(10),
        "answer_rate": _rate(sum(1 for r in done if r.answer_present), len(rows)),
        # Plan 25: supported among the judged citations, and the share of evidence citations with the badge
        "support_rate": _rate(sum(r.support_supported for r in done), sum(r.support_judged for r in done)),
        "support_verified_rate": _rate(sum(r.support_verified for r in done), sum(r.support_citations for r in done)),
        "cost_mean": statistics.fmean(costs) if costs else 0.0,
        "cost_median": statistics.median(costs) if costs else 0.0,
```

**Edit** `backend/app/evals/report.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
        ("Glossary consistency", _pct(a["glossary_consistency"])),
        ("Answer present", _pct(a["answer_rate"])),
        ("Stability of primary-outcome verdict",
         f"{_pct(a['stability'])} over {a['stability_pairs']} pairs; {a['stability_missing']} ids missing a repeat"),
```

   with

```python
        ("Glossary consistency", _pct(a["glossary_consistency"])),
        ("Answer present", _pct(a["answer_rate"])),
        ("Sentence support: supported / judged citations", _pct(a["support_rate"])),
        ("Citations with the ตรวจแล้ว badge", _pct(a["support_verified_rate"])),
        ("Stability of primary-outcome verdict",
         f"{_pct(a['stability'])} over {a['stability_pairs']} pairs; {a['stability_missing']} ids missing a repeat"),
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_support_stub.py tests/unit/test_eval_metrics.py -q`

Expected: 15 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-25/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2252 passed, 17 skipped.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(support): the stub result carries support; harness rows for the support rate and the badge share (Plan 25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-25 && git add backend/tests/unit/test_support_stub.py backend/tests/unit/test_eval_metrics.py backend/app/graph/nodes/stub_result.py backend/app/evals/metrics.py backend/app/evals/report.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 4: Frontend — the support types, alignment and badge rule, and the copy

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/support.ts`
- Modify: `frontend/src/lib/i18n-report.ts`
- Test (create): `frontend/src/lib/support.test.ts`

**Interfaces:**
- Consumes: `isNotEvidence` (`src/lib/trial-reports.ts`); the `result.support` shape (Task 2).
- Produces:
  - Types `SupportCitation`, `SupportClaim`, `SentenceSupport`; `ReviewResult.support?: SentenceSupport | null` (`src/lib/types.ts`).
  - `src/lib/support.ts`: `markerRefs(text): string[][]`, `alignMarkers(text, support): (SupportClaim | null)[]`, `findingClaim(support, i)`, `citationOf(claim, ref)`, `isChecked(citation, paper): boolean`, `type SupportState`, `supportState(claim, citation, paper)`, `claimsForPaper(support, ref, selected?)`.
  - `RC.support` in `src/lib/i18n-report.ts`: `checked`, `checkedName(ref)`, `openChecked(ref)`, `legend`, `why`, `claim`, `finding`, `supporting`, `closest`, `state: Record<SupportState, Pair>`, `note`.

- [ ] **Step 1: Write the failing tests**

**New file** `frontend/src/lib/support.test.ts` (complete):

```ts
import { describe, expect, it } from "vitest";
import { alignMarkers, claimsForPaper, findingClaim, isChecked, markerRefs, supportState } from "./support";
import type { Paper, SentenceSupport, SupportCitation, SupportClaim } from "./types";

const cite = (ref: string, label: SupportCitation["label"], verified = false, over: Partial<SupportCitation> = {}): SupportCitation => ({
  ref, label, evidence: label ? `Sentence for ${ref}.` : null, score: 0.5, not_evidence: false, verified, ...over,
});

const claim = (id: string, over: Partial<SupportClaim>): SupportClaim => ({
  id, where: "summary", markers: null, finding: null, claim: "C.", refs: [], numbers_checked: true, computed: false,
  citations: [], ...over,
});

const SUPPORT: SentenceSupport = {
  judge: "ok", markers: [["P1", "P3"], ["P4"], ["P2"]], display_aligned: true,
  claims: [
    claim("s0", { markers: [0, 1], refs: ["P1", "P3", "P4"], citations: [cite("P1", "supported", true), cite("P3", "partial"), cite("P4", "unsupported")] }),
    claim("s1", { markers: [2], refs: ["P2"], citations: [cite("P2", "supported", true)] }),
    claim("k0", { where: "key_finding", finding: 0, refs: ["P1", "P2"], citations: [cite("P1", "supported", true), cite("P2", null)] }),
  ],
};

const paper = (ref: string, over: Partial<Paper> = {}): Paper => ({ ref, title: ref, ...over });

describe("sentence support (Plan 25)", () => {
  it("reads the citation groups the report links", () => {
    expect(markerRefs("ก [P1, P3] ข [P4]; ค [P2-P5] ง [P2,P6]")).toEqual([["P1", "P3"], ["P4"], ["P2", "P6"]]);
    expect(markerRefs("ไม่มี")).toEqual([]);
  });

  it("ties groups to claims by position when the translation kept their order", () => {
    const out = alignMarkers("ไทย [P1, P3] ไทย [P4] ไทย [P2]", SUPPORT);
    expect(out.map((c) => c?.id ?? null)).toEqual(["s0", "s0", "s1"]);
  });

  it("ties a moved group only when its ref list is unique in both texts, else no claim", () => {
    expect(alignMarkers("ไทย [P2] ไทย [P4] ไทย [P1, P3]", SUPPORT).map((c) => c?.id ?? null)).toEqual(["s1", "s0", "s0"]);
    // a group the translation repeated or invented has no claim (no badge on the wrong sentence)
    expect(alignMarkers("ไทย [P1, P3] ไทย [P1, P3] ไทย [P9]", SUPPORT)).toEqual([null, null, null]);
    expect(alignMarkers("ไทย [P1] ไทย [P2]", null)).toEqual([null, null]);
  });

  it("finds a key finding's claim by its index", () => {
    expect(findingClaim(SUPPORT, 0)?.id).toBe("k0");
    expect(findingClaim(SUPPORT, 1)).toBeNull();
    expect(findingClaim(undefined, 0)).toBeNull();
  });

  it("the badge follows the engine and never sits on a paper that is not evidence", () => {
    const c = cite("P1", "supported", true);
    expect(isChecked(c, paper("P1"))).toBe(true);
    expect(isChecked(c, paper("P1", { related_to: "P2" }))).toBe(false);
    expect(isChecked(c, paper("P1", { design_excluded: true }))).toBe(false);
    expect(isChecked(cite("P1", "supported", false), paper("P1"))).toBe(false);
    expect(isChecked(undefined, paper("P1"))).toBe(false);
  });

  it("names each state, unsupported and unchecked included", () => {
    const c = claim("s9", {});
    expect(supportState(c, cite("P1", "supported", true), paper("P1"))).toBe("checked");
    expect(supportState(c, cite("P1", "supported", false), paper("P1"))).toBe("numbers");
    expect(supportState(c, cite("P1", "partial"), paper("P1"))).toBe("partial");
    expect(supportState(c, cite("P1", "unsupported"), paper("P1"))).toBe("unsupported");
    expect(supportState(c, cite("P1", null), paper("P1"))).toBe("unchecked");
    expect(supportState(claim("s8", { computed: true }), cite("P1", null), paper("P1"))).toBe("computed");
    expect(supportState(c, cite("P1", null, false, { not_evidence: true }), paper("P1"))).toBe("not_evidence");
    expect(supportState(c, cite("P1", "supported", true), paper("P1", { related_to: "P2" }))).toBe("not_evidence");
  });

  it("lists the claims that cite a paper, the selected one first", () => {
    expect(claimsForPaper(SUPPORT, "P1").map((x) => x.claim.id)).toEqual(["s0", "k0"]);
    expect(claimsForPaper(SUPPORT, "P1", "k0").map((x) => x.claim.id)).toEqual(["k0", "s0"]);
    expect(claimsForPaper(SUPPORT, "P9")).toEqual([]);
    expect(claimsForPaper(null, "P1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-25/frontend && npx vitest run src/lib/support.test.ts src/lib/i18n-report.test.ts`

Expected: the support test file fails to load: `Failed to resolve import "./support"`.

- [ ] **Step 3: Implement**

**Edit** `frontend/src/lib/types.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
}

export interface ReviewResult {
  topic?: string;
```

   with

```ts
}

/** Plan 25: one cited paper of a claim, as the engine judged it against the paper's abstract. */
export interface SupportCitation {
  ref: string;
  /** the judge's label; null when not judged (budget, failure, over the cap, not evidence, a computed claim) */
  label: "supported" | "partial" | "unsupported" | null;
  /** a sentence copied from the abstract: the supporting one (supported, partial), else the closest one; null when none */
  evidence: string | null;
  score: number | null;
  not_evidence: boolean;
  /** the "ตรวจแล้ว" badge: supported, every number of the claim verified, no pooled value, evidence */
  verified: boolean;
}

/** Plan 25: an English sentence of the summary (with its citation groups) or a key finding's statement. */
export interface SupportClaim {
  id: string;
  where: "summary" | "key_finding";
  /** summary: the indexes of its citation groups in the English summary */
  markers: number[] | null;
  /** key finding: its index in `key_findings` */
  finding: number | null;
  claim: string;
  refs: string[];
  numbers_checked: boolean;
  computed: boolean;
  citations: SupportCitation[];
}

/** Plan 25: `result.support`; null when the check crashed, absent before Plan 25. */
export interface SentenceSupport {
  judge: "ok" | "incomplete" | "failed" | "skipped_budget" | "none";
  /** the refs of each citation group of the English summary, in order */
  markers: string[][];
  claims: SupportClaim[];
  /** the shown summary has the same groups in the same order */
  display_aligned?: boolean;
}

export interface ReviewResult {
  topic?: string;
```

2. Replace

```ts
  citations?: Citations | null; // Plan 14b
  methods?: ReviewMethods; // Plan 20
}

```

   with

```ts
  citations?: Citations | null; // Plan 14b
  methods?: ReviewMethods; // Plan 20
  support?: SentenceSupport | null; // Plan 25
}

```

**New file** `frontend/src/lib/support.ts` (complete):

```ts
// Sentence support (Plan 25): which citations of the report carry the "ตรวจแล้ว" badge, and what the rail's "why this
// source was cited" view shows. The engine judged the English text before translation (`result.support`); this module
// only ties what is shown to those English claims and never decides a label itself.
import { isNotEvidence } from "./trial-reports";
import type { Paper, SentenceSupport, SupportCitation, SupportClaim } from "./types";

/** The citation groups the report links (the same pattern as `CitedText` and the engine's `support.MARKER`). */
const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;

/** The refs of each citation group of a text, in order. */
export function markerRefs(text: string): string[][] {
  return [...text.matchAll(CITE)].map((m) => m[1].split(/\s*,\s*/));
}

const key = (refs: string[]) => refs.join(",");

/**
 * For each citation group of the shown summary, the English claim it stands for, or null (no badge). When the groups
 * come in the same order as in the English summary, group k is marker k. When translation moved them, a group is tied
 * only when its ref list occurs exactly once in both texts; a repeated or missing group gets no claim, so a badge can
 * never sit on the wrong sentence.
 */
export function alignMarkers(text: string, support: SentenceSupport | null | undefined): (SupportClaim | null)[] {
  const shown = markerRefs(text);
  if (!support) return shown.map(() => null);
  const english = support.markers ?? [];
  const claimOf = (k: number) => support.claims.find((c) => c.where === "summary" && c.markers?.includes(k)) ?? null;
  if (shown.length === english.length && shown.every((refs, k) => key(refs) === key(english[k]))) {
    return shown.map((_, k) => claimOf(k));
  }
  const count = (list: string[][], refs: string[]) => list.filter((r) => key(r) === key(refs)).length;
  return shown.map((refs) => {
    if (count(shown, refs) !== 1 || count(english, refs) !== 1) return null;
    return claimOf(english.findIndex((r) => key(r) === key(refs)));
  });
}

/** The claim of key finding i (the engine keys findings by their index, which the translation keeps). */
export function findingClaim(support: SentenceSupport | null | undefined, i: number): SupportClaim | null {
  return support?.claims.find((c) => c.where === "key_finding" && c.finding === i) ?? null;
}

export function citationOf(claim: SupportClaim | null | undefined, ref: string): SupportCitation | undefined {
  return claim?.citations.find((c) => c.ref === ref);
}

/** The badge: the engine's rule (`verified`), and never on a paper that is not evidence. */
export function isChecked(c: SupportCitation | undefined, paper: Paper | undefined): boolean {
  return !!c?.verified && !isNotEvidence(paper);
}

export type SupportState = "checked" | "numbers" | "partial" | "unsupported" | "computed" | "not_evidence" | "unchecked";

/** What the rail says about one cited paper of one claim. */
export function supportState(claim: SupportClaim, c: SupportCitation, paper: Paper | undefined): SupportState {
  if (c.not_evidence || isNotEvidence(paper)) return "not_evidence";
  if (claim.computed) return "computed";
  if (isChecked(c, paper)) return "checked";
  if (c.label === "supported") return "numbers"; // supported, but a number of the claim is not verified
  if (c.label === "partial") return "partial";
  if (c.label === "unsupported") return "unsupported";
  return "unchecked";
}

/** Every claim that cites `ref`, with its citation; the selected claim first. */
export function claimsForPaper(support: SentenceSupport | null | undefined, ref: string,
  selected?: string | null): { claim: SupportClaim; citation: SupportCitation }[] {
  const out = (support?.claims ?? []).flatMap((claim) => {
    const citation = citationOf(claim, ref);
    return citation ? [{ claim, citation }] : [];
  });
  return selected ? [...out.filter((x) => x.claim.id === selected), ...out.filter((x) => x.claim.id !== selected)] : out;
}
```

**Edit** `frontend/src/lib/i18n-report.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
import type { Lang } from "./i18n";
import { plural } from "./plural";
import { hasThai } from "./text-wrap";

```

   with

```ts
import type { Lang } from "./i18n";
import { plural } from "./plural";
import type { SupportState } from "./support";
import { hasThai } from "./text-wrap";

```

2. Replace

```ts
  },

  /** Filters (filter-bar.tsx). */
  filter: {
```

   with

```ts
  },

  /** Sentence support (Plan 25): the citation badge, its legend, and the rail's "why this source was cited". */
  support: {
    checked: ["ตรวจแล้ว", "Checked"],
    checkedName: (ref: string): Pair => [`${ref} ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้`, `${ref} checked: the abstract supports this sentence`],
    openChecked: (ref: string): Pair => [`เปิด ${ref} (ตรวจแล้ว)`, `Open ${ref} (checked)`],
    legend: ["✓ ตรวจแล้ว: ประโยคที่ตรงกันพบในบทคัดย่อของงานนั้น และตัวเลขผ่านการตรวจ แตะรหัสงานวิจัยเพื่อดูประโยค",
      "✓ Checked: a matching sentence was found in that study's abstract and the numbers passed verification. Tap a study code to see it."],
    why: ["ทำไมจึงอ้างอิงงานนี้", "Why this source was cited"],
    claim: ["ประโยคในรายงานที่ตรวจ (ภาษาอังกฤษ ก่อนแปล)", "The report's sentence that was checked (English, before translation)"],
    finding: ["ผลสำคัญที่ตรวจ (ภาษาอังกฤษ ก่อนแปล)", "The key finding that was checked (English, before translation)"],
    supporting: ["ประโยคในบทคัดย่อที่รองรับ", "Supporting sentence in the abstract"],
    closest: ["ประโยคในบทคัดย่อที่ใกล้เคียงที่สุด", "Closest sentence in the abstract"],
    state: {
      checked: ["ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้", "Checked: the abstract supports this sentence"],
      numbers: ["บทคัดย่อรองรับ แต่ตัวเลขในประโยคยังไม่ผ่านการตรวจ", "Supported, but a number in the sentence is not verified"],
      partial: ["รองรับบางส่วน", "Partly supported"],
      unsupported: ["ไม่พบประโยคที่รองรับ", "No supporting sentence found"],
      computed: ["ประโยคนี้มีค่าที่ระบบคำนวณ จึงไม่ได้ตรวจกับบทคัดย่อ", "States a computed value, so it was not checked against an abstract"],
      not_evidence: ["งานนี้ไม่นับเป็นหลักฐาน จึงไม่ได้ตรวจ", "Not counted as evidence, so not checked"],
      unchecked: ["ยังไม่ได้ตรวจ", "Not checked"],
    } as Record<SupportState, Pair>,
    note: ["ตรวจโดยโมเดลเทียบกับบทคัดย่อเท่านั้น ใช้ประกอบการอ่าน ไม่ใช่การรับรองผล", "Checked by a model against the abstract only: a reading aid, not an endorsement."],
  },

  /** Filters (filter-bar.tsx). */
  filter: {
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-25/frontend && npx vitest run src/lib/support.test.ts src/lib/i18n-report.test.ts`

Expected: 2 files, 50 tests passed.

- [ ] **Step 5: The full frontend suite, typecheck and lint**

Run: `cd /d/MRA-plan-25/frontend && npm test && npm run typecheck && npm run lint`

Expected: `npm test` 144 files, 1522 tests passed; typecheck and eslint clean.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(support): frontend types, marker alignment, the badge rule and the Thai/English copy (Plan 25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-25 && git add frontend/src/lib/support.test.ts frontend/src/lib/types.ts frontend/src/lib/support.ts frontend/src/lib/i18n-report.ts
git commit -F .superpowers/commit-msg.txt
```

---

### Task 5: Frontend — the ✓ mark, the legend and "ทำไมจึงอ้างอิงงานนี้" in the rail

**Files:**
- Modify: `frontend/src/components/review/report-parts.tsx`
- Modify: `frontend/src/components/review/key-findings.tsx`
- Modify: `frontend/src/components/review/source-rail.tsx`
- Modify: `frontend/src/components/review/bottom-line.tsx`
- Modify: `frontend/src/components/review/report.tsx`
- Test (create): `frontend/src/components/review/support.test.tsx`

**Interfaces:**
- Consumes: Task 4's helpers, types and `RC.support`.
- Produces:
  - `Select = (ref: string, outcome?: string, claim?: string) => void` (existing callers unchanged); `interface MarkerSupport { claims; papers; lang }`; `CheckedMark({ refId, lang })`; `hasCheckedMark(support)`; `SupportLegend({ lang })`; `CitedText` prop `support?: MarkerSupport | null`; `RefButtons` props `checked?: ReadonlySet<string>`, `claim?: string` (`report-parts.tsx`).
  - `KeyFindings` props `support?`, `papers?`; `SourceRail` props `support?`, `claim?` (renders `WhyCited`); `BottomLine` prop `marks?`; `Report` selection `{ref, outcome?, claim?}`.

- [ ] **Step 1: Write the failing tests**

**New file** `frontend/src/components/review/support.test.tsx` (complete):

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { slrP20ReviewFixture } from "@/test/fixtures";
import type { Review, SentenceSupport, SupportCitation } from "@/lib/types";

vi.mock("./charts", () => ({
  Charts: () => <section aria-labelledby="h-charts"><h3 id="h-charts">แผนภาพหลักฐาน</h3><div data-testid="charts" /></section>,
}));

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { desktopViewport } from "@/test/viewport";
import { Report } from "./report";

vi.setConfig({ testTimeout: 20_000 }); // full <Report> renders, as in report.test.tsx

desktopViewport();

const EN = slrP20ReviewFixture.result!.synthesis_en!.executive_summary;
const cite = (ref: string, label: SupportCitation["label"], verified: boolean, evidence: string | null): SupportCitation => ({
  ref, label, evidence, score: 0.6, not_evidence: false, verified,
});

/** The engine's check of the fixture: the summary's one English sentence cites P1, P3 (group 0) and P4 (group 1). */
const SUPPORT: SentenceSupport = {
  judge: "ok", markers: [["P1", "P3"], ["P4"]], display_aligned: true,
  claims: [
    { id: "s0", where: "summary", markers: [0, 1], finding: null, claim: EN, refs: ["P1", "P3", "P4"], numbers_checked: true,
      computed: false, citations: [
        cite("P1", "supported", true, "Metformin users had a lower incidence of colorectal cancer than sulfonylurea users."),
        cite("P3", "partial", false, "Colorectal cancer risk was lower among metformin users."),
        cite("P4", "unsupported", false, "Gastrointestinal cancer detection rose in the first two years after initiation."),
      ] },
    { id: "k0", where: "key_finding", markers: null, finding: 0, claim: "Most observational studies found lower incidence.",
      refs: ["P1", "P2", "P3", "P4"], numbers_checked: true, computed: false, citations: [
        cite("P1", "supported", true, "Metformin users had a lower incidence of colorectal cancer than sulfonylurea users."),
        cite("P2", null, false, null), cite("P3", "supported", true, "Colorectal cancer risk was lower among metformin users."),
        cite("P4", "unsupported", false, null),
      ] },
  ],
};

function withSupport(support: SentenceSupport | null | undefined, over: Partial<NonNullable<Review["result"]>> = {}): Review {
  return { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, support, ...over } };
}

const discussion = () => within(screen.getByRole("region", { name: "อภิปราย" }));
const keyFindings = () => within(screen.getByRole("region", { name: "ผลการศึกษาที่สำคัญ" }));
const rail = () => within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));

describe("sentence support in the report (Plan 25)", () => {
  it("a checked citation in the discussion carries the badge; partial and unsupported ones do not", () => {
    render(<Report review={withSupport(SUPPORT)} />);
    const d = discussion();
    expect(d.getByRole("img", { name: "P1 ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้" })).toHaveTextContent("✓");
    expect(d.queryByRole("img", { name: /^P3 ตรวจแล้ว/ })).toBeNull();
    expect(d.queryByRole("img", { name: /^P4 ตรวจแล้ว/ })).toBeNull();
    expect(d.getByText(/^✓ ตรวจแล้ว: ประโยคที่ตรงกันพบในบทคัดย่อ/)).toBeInTheDocument();
  });

  it("opening a checked citation shows why the source was cited: the English claim and the abstract sentence", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    await userEvent.click(discussion().getByRole("button", { name: "P1" }));
    const why = within(rail().getByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" }));
    const [first, second] = why.getAllByRole("listitem");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(first).toHaveAttribute("data-support", "checked");
    expect(first).toHaveTextContent("ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้");
    expect(within(first).getByText(EN)).toHaveAttribute("lang", "en");
    expect(first).toHaveTextContent("ประโยคในบทคัดย่อที่รองรับ");
    expect(first).toHaveTextContent("“Metformin users had a lower incidence of colorectal cancer than sulfonylurea users.”");
    expect(second).toHaveTextContent("ผลสำคัญที่ตรวจ (ภาษาอังกฤษ ก่อนแปล)");
    expect(why.getByText("ตรวจโดยโมเดลเทียบกับบทคัดย่อเท่านั้น ใช้ประกอบการอ่าน ไม่ใช่การรับรองผล")).toBeInTheDocument();
  });

  it("an unsupported citation is shown honestly, with the closest sentence", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    await userEvent.click(discussion().getByRole("button", { name: "P4" }));
    const [first] = within(rail().getByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" })).getAllByRole("listitem");
    expect(first).toHaveAttribute("data-support", "unsupported");
    expect(first).toHaveTextContent("ไม่พบประโยคที่รองรับ");
    expect(first).toHaveTextContent("ประโยคในบทคัดย่อที่ใกล้เคียงที่สุด");
  });

  it("key findings: checked refs carry the mark and the legend; the rail lists that finding first", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    const k = keyFindings();
    const p3 = k.getByRole("button", { name: "เปิด P3 (ตรวจแล้ว)" });
    expect(p3).toHaveTextContent("P3✓");
    expect(k.getByRole("button", { name: "เปิด P2" })).not.toHaveTextContent("✓");
    expect(k.getByText(/^✓ ตรวจแล้ว:/)).toBeInTheDocument();
    await userEvent.click(p3);
    const [first] = within(rail().getByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" })).getAllByRole("listitem");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(first).toHaveTextContent("Most observational studies found lower incidence.");
  });

  it("a paper that is not evidence never gets the badge, even when the engine marked it", () => {
    const result = slrP20ReviewFixture.result!;
    const papers = result.papers!.map((p) => (p.ref === "P1" ? { ...p, design_excluded: true } : p));
    render(<Report review={withSupport(SUPPORT, { papers })} />);
    expect(discussion().queryByRole("img", { name: /ตรวจแล้ว/ })).toBeNull();
    expect(keyFindings().getByRole("button", { name: "เปิด P1" })).not.toHaveTextContent("✓");
  });

  it("when translation repeated a group, no badge is placed and nothing breaks", () => {
    const result = slrP20ReviewFixture.result!;
    const synthesis = { ...result.synthesis!, executive_summary: "ไทย [P1, P3] ไทย [P1, P3]" };
    render(<Report review={withSupport(SUPPORT, { synthesis })} />);
    expect(discussion().queryByRole("img", { name: /ตรวจแล้ว/ })).toBeNull();
    expect(discussion().queryByText(/^✓ ตรวจแล้ว/)).toBeNull();
    expect(discussion().getAllByRole("button", { name: "P1" })).toHaveLength(2);
  });

  it("the English view ties the English summary directly", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    const d = within(screen.getByRole("region", { name: "Discussion" }));
    expect(d.getByRole("img", { name: "P1 checked: the abstract supports this sentence" })).toBeInTheDocument();
  });

  it("a result without support (before Plan 25, or a crashed check) shows no badge and no why-cited view", async () => {
    render(<Report review={withSupport(undefined)} />);
    expect(screen.queryByRole("img", { name: /ตรวจแล้ว/ })).toBeNull();
    expect(screen.queryByText(/^✓ ตรวจแล้ว/)).toBeNull();
    await userEvent.click(discussion().getByRole("button", { name: "P1" }));
    expect(rail().queryByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-25/frontend && npx vitest run src/components/review/support.test.tsx src/components/review/key-findings.test.tsx src/components/review/report.test.tsx`

Expected: `support.test.tsx`: 5 failed, 3 passed (no mark, no legend, no rail view yet; the not-evidence, repeated-group and no-support tests already pass, since nothing is drawn).

- [ ] **Step 3: Implement**

**Edit** `frontend/src/components/review/report-parts.tsx` (4 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { isRelatedReport, relatedLabel, relatedReasonText, relatedReportsLabel } from "@/lib/trial-reports";
import { isGraded, REVIEW_TYPE_LABEL, showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ComparisonCell, ComparisonRow, EvidenceCluster, Paper, PaperCard, QuestionBlock, Quality, Synthesis } from "@/lib/types";
import { DesignMismatchFlag, Glyph, UncertainFlag } from "../ui/evidence";
import { Term } from "../ui/term";
```

   with

```tsx
import { isRelatedReport, relatedLabel, relatedReasonText, relatedReportsLabel } from "@/lib/trial-reports";
import { isGraded, REVIEW_TYPE_LABEL, showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { citationOf, isChecked } from "@/lib/support";
import type { ComparisonCell, ComparisonRow, EvidenceCluster, Paper, PaperCard, QuestionBlock, Quality, SupportClaim, Synthesis } from "@/lib/types";
import { DesignMismatchFlag, Glyph, UncertainFlag } from "../ui/evidence";
import { Term } from "../ui/term";
```

2. Replace

```tsx
export const READING = "reading";

export type Select = (ref: string, outcome?: string) => void;

const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;

/** Text with [P1, P3] citations turned into buttons that open the cited paper. Narrative numbers stay plain text. */
export function CitedText({ text, onSelect, refs }: { text: string; onSelect: Select; refs: Set<string> }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    parts.push(text.slice(last, m.index));
    const ids = m[1].split(/\s*,\s*/);
    parts.push(
      <span key={m.index} className="whitespace-nowrap">
```

   with

```tsx
export const READING = "reading";

/** Opens a paper in the rail; `claim` (Plan 25) is the checked sentence the reader came from, shown first there. */
export type Select = (ref: string, outcome?: string, claim?: string) => void;

const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;
const S = RC.support;

/** Plan 25: the claims of a shown text's citation groups (`alignMarkers`), with the papers for the badge rule. */
export interface MarkerSupport {
  claims: (SupportClaim | null)[];
  papers: Map<string, Paper>;
  lang: Lang;
}

/** The "ตรวจแล้ว" badge of one citation in running prose: a check mark with its accessible name, never colour alone. */
export function CheckedMark({ refId, lang }: { refId: string; lang: Lang }) {
  return (
    <span role="img" aria-label={L(lang, S.checkedName(refId))} title={L(lang, S.checked)} data-checked={refId}
      className="ml-0.5 font-display text-[0.8em] font-semibold text-ink">✓</span>
  );
}

/** Whether any citation of these groups carries the badge (then the legend explains the mark). */
export function hasCheckedMark(support: MarkerSupport | null | undefined): boolean {
  return !!support?.claims.some((c) => c?.citations.some((x) => isChecked(x, support.papers.get(x.ref))));
}

/** The legend under a text or a list that shows the badge. */
export function SupportLegend({ lang }: { lang: Lang }) {
  return <p className="text-[0.8rem] text-muted" data-support-legend>{L(lang, S.legend)}</p>;
}

/**
 * Text with [P1, P3] citations turned into buttons that open the cited paper. Narrative numbers stay plain text. With
 * `support` (Plan 25), a citation the engine checked carries the badge, and opening it names its claim.
 */
export function CitedText({ text, onSelect, refs, support }: {
  text: string; onSelect: Select; refs: Set<string>; support?: MarkerSupport | null;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(CITE)) {
    parts.push(text.slice(last, m.index));
    const ids = m[1].split(/\s*,\s*/);
    const claim = support?.claims[k] ?? null;
    k += 1;
    parts.push(
      <span key={m.index} className="whitespace-nowrap">
```

3. Replace

```tsx
            {i > 0 && ", "}
            {refs.has(id) ? (
              <button type="button" onClick={() => onSelect(id)}
                className="font-display text-[0.85em] font-semibold text-primary hover:underline">{id}</button>
            ) : id}
          </Fragment>
        ))}]
```

   with

```tsx
            {i > 0 && ", "}
            {refs.has(id) ? (
              <button type="button" onClick={() => (claim ? onSelect(id, undefined, claim.id) : onSelect(id))}
                className="font-display text-[0.85em] font-semibold text-primary hover:underline">{id}</button>
            ) : id}
            {support && claim && isChecked(citationOf(claim, id), support.papers.get(id)) && <CheckedMark refId={id} lang={support.lang} />}
          </Fragment>
        ))}]
```

4. Replace

```tsx

/** Study codes that open the paper in the source rail (44px tall on touch). */
export function RefButtons({ refs, onSelect, lang }: { refs: string[]; onSelect: Select; lang: Lang }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button key={r} type="button" onClick={() => onSelect(r)} aria-label={L(lang, P.open(r))}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-rule px-1.5 font-display text-[0.8rem] leading-normal hover:border-ink md:min-h-6 md:min-w-0">{r}</button>
      ))}
    </span>
```

   with

```tsx

/** Study codes that open the paper in the source rail (44px tall on touch). */
export function RefButtons({ refs, onSelect, lang, checked, claim }: {
  refs: string[]; onSelect: Select; lang: Lang;
  /** Plan 25: refs whose citation carries the "ตรวจแล้ว" badge, and the claim they were checked for */
  checked?: ReadonlySet<string>; claim?: string;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button key={r} type="button" onClick={() => (claim ? onSelect(r, undefined, claim) : onSelect(r))}
          aria-label={L(lang, checked?.has(r) ? S.openChecked(r) : P.open(r))} data-checked={checked?.has(r) || undefined}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-rule px-1.5 font-display text-[0.8rem] leading-normal hover:border-ink md:min-h-6 md:min-w-0">
          {r}{checked?.has(r) && <span aria-hidden="true" className="ml-1 font-semibold">✓</span>}
        </button>
      ))}
    </span>
```

**Edit** `frontend/src/components/review/key-findings.tsx` (3 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { fieldLang, RC } from "@/lib/i18n-report";
import type { EffectState, FindingView, PooledText } from "@/lib/report-view";
import { ComputedNumber, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { ThaiText } from "../ui/thai-text";
import { CertaintyMark } from "./certainty";
import { READING, RefButtons, themeFoundText, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L, Lw } from "./text";
```

   with

```tsx
import { fieldLang, RC } from "@/lib/i18n-report";
import type { EffectState, FindingView, PooledText } from "@/lib/report-view";
import { findingClaim, isChecked } from "@/lib/support";
import type { Paper, SentenceSupport } from "@/lib/types";
import { ComputedNumber, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { ThaiText } from "../ui/thai-text";
import { CertaintyMark } from "./certainty";
import { READING, RefButtons, SupportLegend, themeFoundText, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L, Lw } from "./text";
```

2. Replace

```tsx
 * (computed) or, when it rests on a single study, that study's verified effect. Never a number the UI computed.
 */
export function KeyFindings({ findings, lang, onSelect }: { findings: FindingView[]; lang: Lang; onSelect: Select }) {
  if (!findings.length) return null;
  return (
    <section aria-labelledby="h-key-findings" className="grid gap-3">
```

   with

```tsx
 * (computed) or, when it rests on a single study, that study's verified effect. Never a number the UI computed.
 */
export function KeyFindings({ findings, lang, onSelect, support, papers }: {
  findings: FindingView[]; lang: Lang; onSelect: Select;
  /** Plan 25: the engine's sentence support; finding i is checked as claim "k<i>" */
  support?: SentenceSupport | null; papers?: Map<string, Paper>;
}) {
  if (!findings.length) return null;
  const checks = findings.map((_, i) => {
    const claim = findingClaim(support, i);
    const refs = new Set(claim?.citations.filter((c) => isChecked(c, papers?.get(c.ref))).map((c) => c.ref) ?? []);
    return { claim: claim?.id, refs };
  });
  return (
    <section aria-labelledby="h-key-findings" className="grid gap-3">
```

3. Replace

```tsx
              {!f.pools.length && f.effect && <StudyEffectValue state={f.effect} lang={lang} onSelect={onSelect} />}
              {!f.pools.length && !f.effect && f.k === 1 && !f.themes && <NoEffectText lang={lang} />}
              {f.refs.length > 0 && <RefButtons refs={f.refs} onSelect={onSelect} lang={lang} />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
```

   with

```tsx
              {!f.pools.length && f.effect && <StudyEffectValue state={f.effect} lang={lang} onSelect={onSelect} />}
              {!f.pools.length && !f.effect && f.k === 1 && !f.themes && <NoEffectText lang={lang} />}
              {f.refs.length > 0 && <RefButtons refs={f.refs} onSelect={onSelect} lang={lang} checked={checks[i].refs} claim={checks[i].claim} />}
            </div>
          </li>
        ))}
      </ol>
      {checks.some((c) => c.refs.size > 0) && <SupportLegend lang={lang} />}
    </section>
  );
```

**Edit** `frontend/src/components/review/source-rail.tsx` (4 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { fieldLang, RC } from "@/lib/i18n-report";
import { showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { OutcomeResult, Paper, PaperCard } from "@/lib/types";
import { DesignMismatchFlag, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
```

   with

```tsx
import { fieldLang, RC } from "@/lib/i18n-report";
import { showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { claimsForPaper, supportState } from "@/lib/support";
import type { OutcomeResult, Paper, PaperCard, SentenceSupport } from "@/lib/types";
import { DesignMismatchFlag, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
```

2. Replace

```tsx

const R = RC.rail;

/** Card text in the reader's language when the engine translated it; otherwise as stored, marked with its own `lang`. */
```

   with

```tsx

const R = RC.rail;
const S = RC.support;

/** Card text in the reader's language when the engine translated it; otherwise as stored, marked with its own `lang`. */
```

3. Replace

```tsx
}

/** The paper behind whatever the reader selected: facts, each outcome's number and the exact sentence it came from. */
export function SourceRail({ paper, outcome, lang, onClose, headingId, visible = true, type = "legacy", onSelect, onReference }: {
  paper: Paper | null; outcome?: string; lang: Lang; onClose?: () => void;
  /** the reader follows the link to the paper's reference (the drawer closes and focus lands there) */
  onReference?: (ref: string) => void;
```

   with

```tsx
}

/** The chip of a support state: a checked citation gets the outlined "✓ ตรวจแล้ว" mark, "not found" a dashed warning. */
const STATE_CHIP = {
  checked: "border-ink", unsupported: "border-dashed border-harm text-warn",
  numbers: "border-rule text-muted", partial: "border-rule text-muted", computed: "border-rule text-muted",
  not_evidence: "border-rule text-muted", unchecked: "border-rule text-muted",
} as const;

/**
 * Plan 25, "why this source was cited": every sentence of the report that cites this paper (the one the reader came
 * from first), as the engine checked it in English, the label, and the abstract sentence verbatim (the supporting one,
 * else the closest one). "Not found" is shown, never hidden.
 */
function WhyCited({ paper, support, claim, lang }: {
  paper: Paper; support?: SentenceSupport | null; claim?: string | null; lang: Lang;
}) {
  const items = claimsForPaper(support, paper.ref, claim);
  if (!items.length) return null;
  return (
    <section aria-label={L(lang, S.why)} className="grid gap-2 border-t border-rule pt-3" data-why-cited>
      <h3 className="label">{L(lang, S.why)}</h3>
      <ul className="grid gap-3">
        {items.map(({ claim: c, citation }) => {
          const state = supportState(c, citation, paper);
          const supporting = state === "checked" || state === "numbers" || state === "partial";
          return (
            <li key={c.id} data-support={state} aria-current={c.id === claim || undefined}
              className={`grid gap-1.5 ${c.id === claim ? "-mx-2 rounded-sm bg-surface px-2 py-2" : ""}`}>
              <span className={`w-fit rounded-sm border px-1.5 py-0.5 font-display text-[0.8rem] font-semibold ${STATE_CHIP[state]}`}>
                {state === "checked" && <span aria-hidden="true">✓ </span>}{L(lang, S.state[state])}
              </span>
              <span className="text-[0.8rem] text-muted">{L(lang, c.where === "key_finding" ? S.finding : S.claim)}</span>
              <p className="text-[0.92rem] break-words" lang="en">{c.claim}</p>
              {citation.evidence && (
                <>
                  <span className="label">{L(lang, supporting ? S.supporting : S.closest)}</span>
                  <p className="font-quote text-[1rem] leading-relaxed break-words" lang="en">&ldquo;{citation.evidence}&rdquo;</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[0.8rem] text-muted">{L(lang, S.note)}</p>
    </section>
  );
}

/** The paper behind whatever the reader selected: facts, each outcome's number and the exact sentence it came from. */
export function SourceRail({ paper, outcome, lang, onClose, headingId, visible = true, type = "legacy", onSelect, onReference,
  support, claim }: {
  paper: Paper | null; outcome?: string; lang: Lang; onClose?: () => void;
  /** Plan 25: the engine's sentence support, and the checked sentence the reader came from (listed first) */
  support?: SentenceSupport | null; claim?: string | null;
  /** the reader follows the link to the paper's reference (the drawer closes and focus lands there) */
  onReference?: (ref: string) => void;
```

4. Replace

```tsx
          {paper.journal && <p className="-mt-3 text-sm text-muted">{paper.journal}</p>}
          <RelatedNote paper={paper} lang={lang} onSelect={onSelect} />
          {card ? (
            <>
```

   with

```tsx
          {paper.journal && <p className="-mt-3 text-sm text-muted">{paper.journal}</p>}
          <RelatedNote paper={paper} lang={lang} onSelect={onSelect} />
          <WhyCited paper={paper} support={support} claim={claim} lang={lang} />
          {card ? (
            <>
```

**Edit** `frontend/src/components/review/bottom-line.tsx` (4 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { ComputedNumber, Glyph } from "../ui/evidence";
import { Term } from "../ui/term";
import { CitedText, READING, StrengthLine, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L, Lw } from "./text";
```

   with

```tsx
import { ComputedNumber, Glyph } from "../ui/evidence";
import { Term } from "../ui/term";
import { CitedText, hasCheckedMark, READING, StrengthLine, SupportLegend, type MarkerSupport, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L, Lw } from "./text";
```

2. Replace

```tsx
 * Plan 20 has no `answer`: its executive summary leads here instead (and no Discussion section repeats it).
 */
export function BottomLine({ synthesis, result, papers, lang, onSelect, refs, english }: {
  synthesis: Synthesis; result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: Select; refs: Set<string>;
  /** the reader switched a Thai review to English: English pool names */
  english: boolean;
}) {
  const hasPapers = papers.length > 0;
```

   with

```tsx
 * Plan 20 has no `answer`: its executive summary leads here instead (and no Discussion section repeats it).
 */
export function BottomLine({ synthesis, result, papers, lang, onSelect, refs, english, marks }: {
  synthesis: Synthesis; result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: Select; refs: Set<string>;
  /** the reader switched a Thai review to English: English pool names */
  english: boolean;
  /** Plan 25: the badge on the lead's citations when the summary leads (a result without an answer) */
  marks?: MarkerSupport | null;
}) {
  const hasPapers = papers.length > 0;
```

3. Replace

```tsx
      {lead.trim() ? (
        <p className={`max-w-[65ch] ${READING}`} data-prose data-answer={synthesis.answer?.trim() ? "" : undefined} lang={fieldLang(lead, lang)}>
          <CitedText text={lead} onSelect={onSelect} refs={refs} />
        </p>
      ) : hasPapers && (
```

   with

```tsx
      {lead.trim() ? (
        <p className={`max-w-[65ch] ${READING}`} data-prose data-answer={synthesis.answer?.trim() ? "" : undefined} lang={fieldLang(lead, lang)}>
          <CitedText text={lead} onSelect={onSelect} refs={refs} support={marks} />
        </p>
      ) : hasPapers && (
```

4. Replace

```tsx
        </p>
      )}
      {hasPapers && <StrengthLine synthesis={synthesis} lang={lang} quality={result.quality} type={type} bar={!poolGap} />}
      {pools.length > 0 && (
```

   with

```tsx
        </p>
      )}
      {hasCheckedMark(marks) && <SupportLegend lang={lang} />}
      {hasPapers && <StrengthLine synthesis={synthesis} lang={lang} quality={result.quality} type={type} bar={!poolGap} />}
      {pools.length > 0 && (
```

**Edit** `frontend/src/components/review/report.tsx` (8 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { fieldLang, RC, type Pair } from "@/lib/i18n-report";
import { robSummary } from "@/lib/rob-summary";
import { cellOutcome, keyFindingViews, sameModelReadings, sofRows, type OutcomeContext } from "@/lib/report-view";
import {
```

   with

```tsx
import { fieldLang, RC, type Pair } from "@/lib/i18n-report";
import { robSummary } from "@/lib/rob-summary";
import { alignMarkers } from "@/lib/support";
import { cellOutcome, keyFindingViews, sameModelReadings, sofRows, type OutcomeContext } from "@/lib/report-view";
import {
```

2. Replace

```tsx
import { MetaAnalysisSection } from "./meta-analysis";
import { FilterBar, FilterStatus } from "./filter-bar";
import { CitedText, ClaimsPanel, ComparisonMatrix, MatrixLegend, READING, SameModelReadings } from "./report-parts";
import { ReferencesSection } from "./references";
import { citedQuestion, DownloadsAndCite } from "./report-cite";
```

   with

```tsx
import { MetaAnalysisSection } from "./meta-analysis";
import { FilterBar, FilterStatus } from "./filter-bar";
import {
  CitedText, ClaimsPanel, ComparisonMatrix, hasCheckedMark, MatrixLegend, READING, SameModelReadings, SupportLegend, type MarkerSupport,
} from "./report-parts";
import { ReferencesSection } from "./references";
import { citedQuestion, DownloadsAndCite } from "./report-cite";
```

3. Replace

```tsx
import { L, Lw } from "./text";

type Selection = { ref: string; outcome?: string };

/** Map a matrix cell to the paper outcome it came from (by finding text, then by direction, then the first). */
```

   with

```tsx
import { L, Lw } from "./text";

type Selection = { ref: string; outcome?: string; claim?: string };

/** Map a matrix cell to the paper outcome it came from (by finding text, then by direction, then the first). */
```

4. Replace

```tsx
  }

  function select(ref: string, outcome?: string) {
    const focused = document.activeElement;
    returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : pressed.current;
    setSelection({ ref, outcome });
    setDrawerOpen(true);
  }
```

   with

```tsx
  }

  function select(ref: string, outcome?: string, claim?: string) {
    const focused = document.activeElement;
    returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : pressed.current;
    setSelection({ ref, outcome, claim });
    setDrawerOpen(true);
  }
```

5. Replace

```tsx
  const answer = synthesis.answer?.trim() ?? "";
  const discussion = synthesis.executive_summary || result.summary || "";
  const hasClaims = showsSection(type, "claims") && !!(synthesis.consensus?.length || synthesis.conflicts?.length);
  const hasMatrix = showsSection(type, "findings") && rows.length > 0;
```

   with

```tsx
  const answer = synthesis.answer?.trim() ?? "";
  const discussion = synthesis.executive_summary || result.summary || "";
  // Plan 25: the summary's citation groups tied to the English claims the engine checked (no badge when they moved)
  const support = result.support ?? null;
  const discussionMarks = useMemo<MarkerSupport | null>(() => (support
    ? { claims: alignMarkers(discussion, support), papers: byRef, lang } : null), [support, discussion, byRef, lang]);
  const hasClaims = showsSection(type, "claims") && !!(synthesis.consensus?.length || synthesis.conflicts?.length);
  const hasMatrix = showsSection(type, "findings") && rows.length > 0;
```

6. Replace

```tsx
    switch (id) {
      case "bottom_line":
        return <BottomLine synthesis={synthesis} result={result} papers={papers} lang={lang} onSelect={select} refs={refs} english={lang === "en"} />;
      case "key_findings":
        return hasPapers && findings.length ? <KeyFindings findings={findings} lang={lang} onSelect={select} /> : null;
      case "sof":
        return hasPapers && sof.length ? <SofTable rows={sof} lang={lang} onSelect={select} graded={graded} /> : null;
```

   with

```tsx
    switch (id) {
      case "bottom_line":
        return <BottomLine synthesis={synthesis} result={result} papers={papers} lang={lang} onSelect={select} refs={refs} english={lang === "en"}
          marks={answer ? null : discussionMarks} />;
      case "key_findings":
        return hasPapers && findings.length ? <KeyFindings findings={findings} lang={lang} onSelect={select} support={support} papers={byRef} /> : null;
      case "sof":
        return hasPapers && sof.length ? <SofTable rows={sof} lang={lang} onSelect={select} graded={graded} /> : null;
```

7. Replace

```tsx
          <section aria-labelledby="h-discussion" className="grid gap-2">
            <h2 id="h-discussion" className={H2}>{Lw(lang, RC.report.discussionH2)}</h2>
            <p className={`max-w-[65ch] ${READING}`} data-prose lang={fieldLang(discussion, lang)}><CitedText text={discussion} onSelect={select} refs={refs} /></p>
            <p className="text-[0.8rem] text-muted">{L(lang, RC.report.discussionNote)}</p>
          </section>
        ) : null;
```

   with

```tsx
          <section aria-labelledby="h-discussion" className="grid gap-2">
            <h2 id="h-discussion" className={H2}>{Lw(lang, RC.report.discussionH2)}</h2>
            <p className={`max-w-[65ch] ${READING}`} data-prose lang={fieldLang(discussion, lang)}><CitedText text={discussion} onSelect={select} refs={refs} support={discussionMarks} /></p>
            <p className="text-[0.8rem] text-muted">{L(lang, RC.report.discussionNote)}</p>
            {hasCheckedMark(discussionMarks) && <SupportLegend lang={lang} />}
          </section>
        ) : null;
```

8. Replace

```tsx
            <SourceRail paper={active ? byRef.get(active.ref) ?? null : null} outcome={active?.outcome} lang={lang}
              onClose={() => setDrawerOpen(false)} headingId={railHeading} visible={drawerOpen} type={type} onSelect={select}
              onReference={toReference} />
          </RailDrawer>
        )}
```

   with

```tsx
            <SourceRail paper={active ? byRef.get(active.ref) ?? null : null} outcome={active?.outcome} lang={lang}
              onClose={() => setDrawerOpen(false)} headingId={railHeading} visible={drawerOpen} type={type} onSelect={select}
              onReference={toReference} support={support} claim={active?.claim} />
          </RailDrawer>
        )}
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-25/frontend && npx vitest run src/components/review/support.test.tsx src/components/review/key-findings.test.tsx src/components/review/report.test.tsx`

Expected: 3 files, 70 tests passed.

- [ ] **Step 5: The full frontend suite, typecheck and lint**

Run: `cd /d/MRA-plan-25/frontend && npm test && npm run typecheck && npm run lint`

Expected: `npm test` 145 files, 1530 tests passed; typecheck and eslint clean.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(support): the ตรวจแล้ว mark, its legend and "why this source was cited" in the rail (Plan 25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-25 && git add frontend/src/components/review/support.test.tsx frontend/src/components/review/report-parts.tsx frontend/src/components/review/key-findings.tsx frontend/src/components/review/source-rail.tsx frontend/src/components/review/bottom-line.tsx frontend/src/components/review/report.tsx
git commit -F .superpowers/commit-msg.txt
```

---

### Task 6: Docs, final checks, then merge, the CLAUDE.md line, docker and the smoke check

**Files:**
- Modify: `docs/api.md`, `DESIGN.md`, `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`
- After the merge, on master: root `CLAUDE.md`, by the crafted-blob method

**Interfaces:**
- Consumes: the result fields, the badge rule and the UI of Tasks 1–5.
- Produces: the "Sentence support (Plan 25)" section of `docs/api.md` (and the `prompt_version`, `result` keys and `quality.support` lines), the DESIGN.md rail and component descriptions and log row, roadmap row 25 marked built.

**Steps 1–3 are for the implementer. Steps 4–6 are done by the controller after the final review.**

- [ ] **Step 1: Docs**

**Edit** `docs/api.md` (4 replacements; each `old` occurs exactly once):

1. Replace

```markdown
# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-12.1`, API/MCP version 0.8.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
```

   with

```markdown
# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-13.1`, API/MCP version 0.8.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
```

2. Replace

```markdown
- `status` is one of `queued`, `running`, `done`, `error`, `rejected` or `cancelled`.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`.

**Answer and key findings (Plan 20).** `synthesis` (and `synthesis_en`) also has:
```

   with

```markdown
- `status` is one of `queued`, `running`, `done`, `error`, `rejected` or `cancelled`.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`, and since Plan 25 `support` (see "Sentence support (Plan 25)").

**Answer and key findings (Plan 20).** `synthesis` (and `synthesis_en`) also has:
```

3. Replace

```markdown
  plus `failed` (an error name) or `timed_out: true` when it failed or was cut, and `metadata: {asked, found, failed,
  timed_out}` for the OAI-PMH step when a ThaiJO paper was read.

### Exports
```

   with

```markdown
  plus `failed` (an error name) or `timed_out: true` when it failed or was cut, and `metadata: {asked, found, failed,
  timed_out}` for the OAI-PMH step when a ThaiJO paper was read.

Plan 25 adds (absent in results stored before it):
- `support`: `{judge, seconds, claims, pairs, judged, over_cap, computed, supported, partial, unsupported, verified}`
  for the sentence-support check: `pairs` (claim, cited paper) were found, `judged` got a label, `over_cap` stayed
  unjudged past the cap of 30, `computed` claims restate a pooled value, `verified` citations carry the badge. `judge`
  is `ok`, `incomplete`, `failed`, `skipped_budget`, `none` (nothing to judge) or `crashed`.

### Exports
```

4. Replace

```markdown
  `eval run` and the harness never call ThaiJO (replays start at screening, with ThaiJO unset).

## Event stream (SSE)

```

   with

```markdown
  `eval run` and the harness never call ThaiJO (replays start at screening, with ThaiJO unset).

## Sentence support (Plan 25)

Every citation of the summary and of the key findings is checked against the abstract of the paper it cites. Numbers
were already verified (above); this checks that the sentence citing a paper says what that paper's abstract says.
- **Claims.** The check reads the English synthesis, before translation. A claim is a sentence of
  `synthesis_en.executive_summary` that carries a citation group (`[P1]` or `[P1, P3]`; a range such as `[P1-P3]` is
  not a group), or a key finding's `statement` with its `refs`. The k-th group of the English summary is marker k.
- **Candidates in code.** For each (claim, cited paper) the abstract is split into sentences and scored without an
  LLM: the share of the claim's content words the sentence has, plus, when the claim states numbers, the share of
  those numbers (weighted 0.6 / 0.4). The best 2 sentences are the candidates. Only they reach the judge, never the
  whole abstract.
- **Judge.** One call per review on the screener's model, bound to its own schema (`SupportBatch`), through the
  validate → repair → escalate runner: `supported`, `partial` or `unsupported` per pair, and which candidate supports
  it. At most 30 pairs are judged (summary first, then key findings); the rest keep their closest sentence and a null
  label. The judge never writes the evidence: the sentence shown is copied from the abstract by index.
- **Badge ("ตรวจแล้ว").** A citation is `verified` only when the judge said `supported`, every number of the claim
  traces to a verified number of the cited papers or to the review's own text (the grounded-prose rule), the claim
  restates no pooled value (`computed`: a computed number is never supported by an abstract), and the paper is
  evidence (not a further report of a trial, not `design_excluded`). The report adds the same not-evidence rule.
- **Soft.** A failing or unusable judge leaves the labels null (`judge: "failed"`, one line in `errors`); with less than
  $0.01 left of the review's cost cap the judge is skipped (`skipped_budget`); a crash of the check leaves
  `support` null. None of them fails a review or removes a citation.
- **Cost.** A typical review sends about 24 pairs: about 5,000 input and under 1,000 output tokens, about $0.0005 on
  the `budget` preset. At most (30 long pairs, two repair rounds and an escalation) about 13,000 input tokens per
  attempt and about $0.008, inside the review's cost cap (at least $0.08).

`result.support` (null when the check crashed; absent before Plan 25):
- `judge`: as in `quality.support`.
- `markers`: the refs of each citation group of the English summary, in order.
- `claims[]`: `{id, where, markers, finding, claim, refs, numbers_checked, computed, citations[]}`. `id` is `s<n>`
  (summary) or `k<i>` (key finding i); `where` is `summary` or `key_finding`; `markers` (summary) are the claim's
  group indexes and `finding` (key finding) its index; `claim` is the English text; `numbers_checked` says every
  number traces as above.
- `citations[]`: `{ref, label, evidence, score, not_evidence, verified}`. `label` is null when not judged. `evidence`
  is an abstract sentence, verbatim: the supporting one for `supported` and `partial`, else the closest one (null when
  the paper has no abstract sentence, is not evidence, or the claim is `computed`). `score` is the scorer's value for
  it.
- `display_aligned`: whether the shown `synthesis.executive_summary` has the same groups in the same order as the
  English one.

**Tying the shown text to the claims.** A translated summary keeps every citation group but may move it. When the
groups come in the same order, group k is marker k. Otherwise a group is tied only when its ref list occurs exactly
once in both texts; any other group gets no badge, so a badge never sits on the wrong sentence. Key findings keep their
index. The report shows the badge as a check mark on the citation, and opening the paper lists "ทำไมจึงอ้างอิงงานนี้":
each sentence that cites it (in English, as checked), its label (unsupported is shown as "ไม่พบประโยคที่รองรับ") and
the abstract sentence. The Markdown and CSV exports do not change; the JSON export and the MCP `get_review_result`
carry `support` as part of `result`.

**Measuring it.** The Cochrane harness reports two Plan 25 rows from the run files: supported among judged
citations, and the share of evidence citations with the badge. Runs made before Plan 25 show "–". Measuring them on
real reviews is a paid batch, the owner's call.

## Event stream (SSE)

```

**Edit** `DESIGN.md` (2 replacements; each `old` occurs exactly once):

1. Replace

```markdown
  - The matched number in the quote has a `highlight` background, and a "found verbatim in the paper" flag follows the quote.
  - Ends with a link out to PMC, PubMed or the DOI.
- **Findings by study (comparison matrix):** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border. A qualitative or mixed-methods study's cell is a theme, not a direction: a small bordered word mark "พบ"/"found" (`font-display` semibold 0.75rem, 1px `ink` border, 2px corners, `aria-hidden`; the cell's aria-label says "พบประเด็นนี้ (งานเชิงคุณภาพ ไม่มีทิศทางผล)"), and the row header adds "พบใน k การศึกษา" in `muted`. The legend lists the mark next to the glyphs. Themes are counted, never called "supports". The concept map shows them as one neutral "พบใน k การศึกษา" group (pin marker, no direction colour), and the bottom line and live board count them aside ("…สรุปเป็นประเด็น ไม่นับตามทิศทางผล").
- **Meta-analysis without a pooled estimate:** two honest states, with one copy source (`META_POOL_COPY` in `src/lib/copy.ts`). "รวมผลไม่ได้" (the step ran; no outcome had ≥ 3 primary studies with the same measure and verified numbers) and "รวมผลไม่สำเร็จ" (the step did not complete; the cause is never claimed). Each shows as a suffix on the type in the title block, a `warn-bg` label chip with one reason line in the bottom line, and the section heading; the section body is a `warn-bg` note (no computed-number banner, no "estimates above" line), then results not pooled and SR/MA reference rows. The evidence strength stays as words but loses its graded bar ("จากงานแต่ละฉบับ ไม่มีค่ารวม").
```

   with

```markdown
  - The matched number in the quote has a `highlight` background, and a "found verbatim in the paper" flag follows the quote.
  - Ends with a link out to PMC, PubMed or the DOI.
  - "ทำไมจึงอ้างอิงงานนี้" (Plan 25), after the title: each report sentence that cites the paper, the one the reader came from first (`surface` fill, `aria-current`). A state chip (`font-display` semibold 0.8rem, 1px border, 2px corners): "✓ ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้" in `ink`, "ไม่พบประโยคที่รองรับ" with a dashed `harm` border in `warn`, the other states in `rule`/`muted`. Then the sentence as checked, in English and marked `lang="en"` ("ภาษาอังกฤษ ก่อนแปล"), and the abstract sentence verbatim in Source Serif 4 ("ประโยคในบทคัดย่อที่รองรับ", or "…ที่ใกล้เคียงที่สุด" when nothing supports it). Unsupported is shown, never hidden. A muted note says a model checked it against the abstract only.
- **Checked citation (Plan 25, "ตรวจแล้ว"):** a `[Pn]` in prose whose citation passed the sentence-support check is followed by a small `ink` check mark ✓ (`font-display` semibold 0.8em, `role="img"`, accessible name "Pn ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้"); a study chip in the key findings shows "Pn ✓" with the name "เปิด Pn (ตรวจแล้ว)". A muted legend line under the text or list explains the mark whenever one is shown. Never on a paper that is not evidence, never on a computed number's sentence, and never colour alone.
- **Findings by study (comparison matrix):** outcome × paper. Each cell is a glyph button with an aria-label naming the direction. The selected cell gets a `rail` fill and an `ink` border. A qualitative or mixed-methods study's cell is a theme, not a direction: a small bordered word mark "พบ"/"found" (`font-display` semibold 0.75rem, 1px `ink` border, 2px corners, `aria-hidden`; the cell's aria-label says "พบประเด็นนี้ (งานเชิงคุณภาพ ไม่มีทิศทางผล)"), and the row header adds "พบใน k การศึกษา" in `muted`. The legend lists the mark next to the glyphs. Themes are counted, never called "supports". The concept map shows them as one neutral "พบใน k การศึกษา" group (pin marker, no direction colour), and the bottom line and live board count them aside ("…สรุปเป็นประเด็น ไม่นับตามทิศทางผล").
- **Meta-analysis without a pooled estimate:** two honest states, with one copy source (`META_POOL_COPY` in `src/lib/copy.ts`). "รวมผลไม่ได้" (the step ran; no outcome had ≥ 3 primary studies with the same measure and verified numbers) and "รวมผลไม่สำเร็จ" (the step did not complete; the cause is never claimed). Each shows as a suffix on the type in the title block, a `warn-bg` label chip with one reason line in the bottom line, and the section heading; the section body is a `warn-bg` note (no computed-number banner, no "estimates above" line), then results not pooled and SR/MA reference rows. The evidence strength stays as words but loses its graded bar ("จากงานแต่ละฉบับ ไม่มีค่ารวม").
```

2. Replace

```markdown
| 2026-10-11 | API and MCP page moves to `/developers` (`/about` redirects, 308) and goes full width | The user found "/about" did not match a page named "API และ MCP" and asked for a more professional page using the whole screen. Approved departure from the 1240px cap for this route only: three panes (contents, prose, code) at 1680px max; the quick-start tiles hold each connection snippet once; live limits are flat ruled tiles (service counts, plain figures) |
| 2026-10-11 | Landing headline "อย่าเพิ่งเชื่อเรา แตะที่ตัวเลขดูก่อน" removed | At the user's request (it replaces direction C's headline). The page keeps one h1: "ระบบนี้คืออะไร", promoted from the hero's side heading, so the hero is a single plain-language column above the form |
```

   with

```markdown
| 2026-10-11 | API and MCP page moves to `/developers` (`/about` redirects, 308) and goes full width | The user found "/about" did not match a page named "API และ MCP" and asked for a more professional page using the whole screen. Approved departure from the 1240px cap for this route only: three panes (contents, prose, code) at 1680px max; the quick-start tiles hold each connection snippet once; live limits are flat ruled tiles (service counts, plain figures) |
| 2026-10-11 | Landing headline "อย่าเพิ่งเชื่อเรา แตะที่ตัวเลขดูก่อน" removed | At the user's request (it replaces direction C's headline). The page keeps one h1: "ระบบนี้คืออะไร", promoted from the hero's side heading, so the hero is a single plain-language column above the form |
| 2026-10-13 | Plan 25: the "ตรวจแล้ว" citation mark and "ทำไมจึงอ้างอิงงานนี้" in the rail | Verifiable trust (roadmap section 4) needs more than verified numbers: a reader can now see the abstract sentence behind a citation. The mark is a compact ✓ so prose stays readable, with the full word in its accessible name, the legend and the rail; the rail shows the English sentence that was checked (the check runs before translation) and says "not found" plainly. No new tokens |
```

**Edit** `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (1 replacement; each `old` occurs exactly once):

1. Replace

```markdown
| 23 | **Admin console** (section 6b): username + password login, a dashboard, LLM model management with live reload, reviews and cost, API keys and runtime settings, the glossary editor, and harness results. **23a done (2026-10-12):** sign-in (argon2id, Redis sessions, lockout), dashboard, reviews, API keys and the audit log; spec ../specs/2026-10-12-plan-23a-admin-console-design.md. **23b done (2026-10-12):** model management in the admin console (versions in the DB, live reload, catalog, test call). **23c done (2026-10-13):** runtime settings and the Thai glossary as versioned documents read live by every process, and the harness page (reports, compare, capped runs on an opt-in worker, ceiling $5). | From here on every plan can be configured and measured from one place |
| 24 | **ThaiJO source** (section 7). **Built (2026-10-13), off by default:** search, detail and OAI-PMH client, at most 15 candidates (1/8 of the pool), soft-fail, "ThaiJO" in the report and PRISMA; `THAIJO_ENABLED` stays false until TCI answers the letter. Measuring it on the 22a harness needs a new pool version (a paid batch, the owner's call). Spec: `../specs/2026-10-13-plan-24-thaijo-source-design.md` | Cheap, adds Thai evidence, measured by Plan 22 |
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify) | Safety for every audience; publishable |
| 26 | Audience modes (public, bedside, learner, committee) and **public safety rails** (personal-symptom questions go to a doctor or 1669; no dosing advice; harms gaps stated) | Needed once the public uses it |
| 27 | Quick answer mode ("ถามเร็ว", Evidence Finder style): about 30 candidates → about 8 read, a 2–4 sentence answer with numbered refs [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, and a "ทำรีวิวฉบับเต็ม" button | Bedside use and the public; keeps the free service affordable |
```

   with

```markdown
| 23 | **Admin console** (section 6b): username + password login, a dashboard, LLM model management with live reload, reviews and cost, API keys and runtime settings, the glossary editor, and harness results. **23a done (2026-10-12):** sign-in (argon2id, Redis sessions, lockout), dashboard, reviews, API keys and the audit log; spec ../specs/2026-10-12-plan-23a-admin-console-design.md. **23b done (2026-10-12):** model management in the admin console (versions in the DB, live reload, catalog, test call). **23c done (2026-10-13):** runtime settings and the Thai glossary as versioned documents read live by every process, and the harness page (reports, compare, capped runs on an opt-in worker, ceiling $5). | From here on every plan can be configured and measured from one place |
| 24 | **ThaiJO source** (section 7). **Built (2026-10-13), off by default:** search, detail and OAI-PMH client, at most 15 candidates (1/8 of the pool), soft-fail, "ThaiJO" in the report and PRISMA; `THAIJO_ENABLED` stays false until TCI answers the letter. Measuring it on the 22a harness needs a new pool version (a paid batch, the owner's call). Spec: `../specs/2026-10-13-plan-24-thaijo-source-design.md` | Cheap, adds Thai evidence, measured by Plan 22 |
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify). **Built (2026-10-13):** candidates chosen in code from the cited abstract, one judge call per review on the screener's model (soft-fail, budget-aware), the badge only when supported with verified numbers, the rail's "ทำไมจึงอ้างอิงงานนี้", and two harness rows (support rate, badge share); `prompt_version` 2026-10-13.1. Measuring it on real reviews is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-25-sentence-support-design.md` | Safety for every audience; publishable |
| 26 | Audience modes (public, bedside, learner, committee) and **public safety rails** (personal-symptom questions go to a doctor or 1669; no dosing advice; harms gaps stated) | Needed once the public uses it |
| 27 | Quick answer mode ("ถามเร็ว", Evidence Finder style): about 30 candidates → about 8 read, a 2–4 sentence answer with numbered refs [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, and a "ทำรีวิวฉบับเต็ม" button | Bedside use and the public; keeps the free service affordable |
```

Then run: `cd /d/MRA-plan-25/backend && uv run pytest tests/unit/test_api_docs_limits.py tests/unit/test_harness_worker.py -q`

Expected: 35 passed (the documented limits and the compose/docs checks still hold; never write a range like "5–30" in the new text: `test_docs_have_no_stale_paper_counts` reads it as an old paper count).

- [ ] **Step 2: Final checks on the branch**

Run: `cd /d/MRA-plan-25/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-25/frontend && npm test && npm run typecheck && npm run lint`

Expected: all pass (pre-flight: backend 2252 passed, 17 skipped; ruff clean; frontend 145 files, 1530 tests; typecheck and eslint clean). Integration tests are unchanged by this plan; run them only if Postgres is up (`MRA_INTEGRATION=1 uv run pytest -m integration -q`) and report the result or why they were not run.

- [ ] **Step 3: Commit**

Write the message with the Write tool to `D:\MRA-plan-25\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
docs(support): API reference, DESIGN.md rail and checked-citation component, roadmap 25 built (Plan 25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-25 && git add docs/api.md DESIGN.md docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md
git commit -F .superpowers/commit-msg.txt
```

- [ ] **Step 4 (controller): Merge, then the CLAUDE.md line**

The whole-branch review comes first. The main worktree has the owner's uncommitted edits to `CLAUDE.md`,
`frontend/CLAUDE.md` and `infra/searxng/limiter.toml.new`; none may be staged or changed.

```bash
cd /d/MedicalReviewerAgent && git status --short   # expect only the owner's entries
```

Write the merge message with the Write tool to the session's scratchpad (below `$SCRATCH`) as `merge-msg.txt`:

```text
Merge plan-25-sentence-support: sentence-support grounding and the ตรวจแล้ว badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MedicalReviewerAgent && git merge --no-ff plan-25-sentence-support -F "$SCRATCH/merge-msg.txt"
```

Then add the convention line to the committed `CLAUDE.md` only, by building a blob from `HEAD:CLAUDE.md`. Write the
line with the Write tool to `$SCRATCH/claude-line.txt` (one line, ending in a newline):

```text
- Sentence support (Plan 25): `app/harness/support.py` (claims, abstract sentences, the candidate scorer, the badge rule) and the `check_support` node (beside `localize`) check each summary citation group and key-finding ref against the cited abstract, in English before translation: 2 candidate sentences chosen in code, one judge call per review on the screener bound to `SupportBatch` (runner validate → repair → escalate), at most 30 pairs, skipped under $0.01 of budget left, soft-fail to null labels (never fails a review, never edits text or drops a citation). The badge (`verified`) needs supported + every claim number traced (`prose.unverified_numbers`) + no pooled value + evidence; the UI ties shown groups to English claims by position, else by a ref list unique in both texts, else no badge (`src/lib/support.ts`).
```

```bash
cd /d/MedicalReviewerAgent
git show HEAD:CLAUDE.md > "$SCRATCH/claude-md-head.txt"
cat "$SCRATCH/claude-line.txt" >> "$SCRATCH/claude-md-head.txt"
BLOB=$(git hash-object -w "$SCRATCH/claude-md-head.txt")
git update-index --cacheinfo 100644,$BLOB,CLAUDE.md
git commit -F "$SCRATCH/claude-msg.txt"   # written with the Write tool: "docs(claude): sentence-support convention line (Plan 25)" + blank line + the trailer
git status --short   # still exactly the owner's entries; CLAUDE.md stays modified in the working tree
```

Check that `git show HEAD:CLAUDE.md | tail -1` is the new line and that `git diff CLAUDE.md` still shows the owner's
own edits.

- [ ] **Step 5 (controller): Docker rebuild and the smoke check, spending nothing**

No review is started and no LLM is called: the judge in the script below is an inline fake, and the stub result is
code. Write the script with the Write tool to `D:\MedicalReviewerAgent\.superpowers\smoke25.py` (git-ignored; no
heredoc), copy it into the api container, run it, then delete both copies.

```python
import asyncio
import json

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.support import make_check_support
from app.graph.schemas import Candidate, SupportBatch, SupportVerdict
from app.harness import support as sp
from app.services.llm import LLMResult, LLMs

ABSTRACT = ("Methods: We followed 1,234 adults with type 2 diabetes for 8 years in a population-based cohort. "
            "Results: Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90). "
            "Conclusions: Metformin may lower colorectal cancer risk in adults with diabetes.")


class Judge:
    model = "smoke-fake"
    calls = 0

    async def ainvoke(self, system, user):
        Judge.calls += 1
        items = json.loads(user.split("<items>")[1].split("</items>")[0])
        value = SupportBatch(verdicts=[SupportVerdict(id=i["id"], label="supported", sentence=1) for i in items])
        return LLMResult(value=value, cost_usd=0.0, model=self.model, input_tokens=0, output_tokens=0)


def card():
    return {"study_design": "cohort", "design_category": "cohort", "population": "adults with type 2 diabetes",
            "sample_size": 1234, "intervention_or_exposure": "metformin", "comparator": "no metformin",
            "outcomes": [{"outcome": "CRC incidence", "result": "lower risk", "evidence_quote": "q",
                          "effect_size": "HR 0.8", "effect_measure": "HR", "effect_value": 0.8, "ci_lower": 0.71,
                          "ci_upper": 0.9, "p_value": None, "direction": "positive", "matches_question": True,
                          "comparison": "metformin vs no metformin"}],
            "key_findings": [], "limitations": [], "funding_or_conflicts": None, "risk_of_bias": "moderate",
            "overall_direction": "positive"}


async def main():
    print("prompt_version", Settings().prompt_version)
    print("candidates", sp.best_sentences("Metformin lowered colorectal cancer risk (HR 0.80) [P1].",
                                          sp.abstract_sentences(ABSTRACT))[0])
    judge = Judge()
    llms = LLMs(guard=judge, planner=judge, screener=judge, extractor=judge, synthesizer=judge)
    llms.for_schema = lambda role, schema: judge
    deps = GraphDeps(settings=Settings(), llms=llms)
    papers = [{"ref": "P1", "card": card(), "error": None, "relevance": 90, "screen_reason": "ok",
               "candidate": Candidate(title="Paper P1", doi="10.1/P1", year=2020, abstract=ABSTRACT).model_dump()}]
    state = {"topic": "t", "english_topic": "t", "language": "th", "papers": papers,
             "question": {"refined_question": "Does metformin reduce CRC?"},
             "matrix": {"rows": [], "consensus": [], "conflicts": [], "grade": {"level": "low", "factors": []}},
             "synthesis": {"executive_summary": "Metformin lowered colorectal cancer risk (HR 0.80) [P1].",
                           "key_findings": [{"statement": "Metformin may lower colorectal cancer risk.",
                                             "refs": ["P1"]}]}}
    out = await make_check_support(deps)(state)
    s = out["support"]
    print("judge", s["judge"], "calls", Judge.calls, "markers", s["markers"])
    for c in s["claims"]:
        print("claim", c["id"], [(x["ref"], x["label"], x["verified"]) for x in c["citations"]])
    print("quality", out["quality"][0]["judge"], out["quality"][0]["verified"], "errors", out["errors"])
    stub = stub_result("t", "th", "slr")["support"]
    print("stub", [(c["id"], [(x["ref"], x["label"]) for x in c["citations"]]) for c in stub["claims"]])


asyncio.run(main())
```

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d
docker compose ps                                                                       # api healthy, worker up
docker compose exec -T worker python -c "from app.config import Settings; print(Settings().prompt_version)"   # 2026-10-13.1
curl -s http://localhost:8088/api/v1/status | head -c 120; echo                            # accepting, as before
docker compose cp .superpowers/smoke25.py api:/tmp/smoke25.py
docker compose exec -T api python /tmp/smoke25.py
docker compose exec -T api rm /tmp/smoke25.py && rm .superpowers/smoke25.py
docker compose exec -T web sh -c 'grep -rl "data-why-cited" .next 2>/dev/null | head -1'  # the new rail view is in the build
```

Expected:
- `prompt_version 2026-10-13.1` (and the same from the worker);
- `candidates ('Results: Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90).', <score>)`;
- `judge ok calls 1 markers [['P1']]`; `claim s0 [('P1', 'supported', True)]`; `claim k0 [('P1', 'supported', True)]`;
- `quality ok 2 errors []`;
- `stub [('k0', [('P1', 'supported'), ('P2', 'partial'), ('P3', 'supported'), ('P4', 'unsupported')]), ('k1', [...])]`;
- a path under `.next` for the `data-why-cited` grep.

When a result differs, stop and investigate before telling the owner Plan 25 is ready. Report each result exactly.

- [ ] **Step 6 (controller): Clean up and record**

- Remove the worktree with `git worktree remove ../MRA-plan-25`, and keep the branch.
- Update the memory notes (a `plan-25-state.md`) and the `MEMORY.md` index. Record: Plan 25 merged; `prompt_version`
  2026-10-13.1; the judge runs on the screener's model, one call per review, about $0.0005 typical; measuring the
  support rate on the 22a harness is a paid batch (the owner's call); next on the roadmap is Plan 26.
