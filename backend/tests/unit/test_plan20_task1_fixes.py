"""Plan 20 Task 1 review findings (task-1-review.md) and Task 2 review finding 5 (exports of themes)."""
from __future__ import annotations

import csv
import io
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes import synthesis as synth_mod
from app.graph.nodes.retrieval import make_search
from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import (
    _SAYS_NO_POOL,
    ANSWER_CERTAINTY,
    NO_POOL_ANSWER,
    _bottom_line,
    _certainty_lead,
    _key_findings,
    _methods,
    make_write_synthesis,
)
from app.graph.schemas import Candidate, KeyFinding, NarrativeFinding
from app.harness.prose import prose_context
from app.services.report import render_csv, render_markdown
from tests.fakes import FakeStructuredLLM
from tests.unit.test_comparison_and_prose import SLR_PAPERS
from tests.unit.test_nodes_synthesis import deps
from tests.unit.test_plan20_answer import narrative, two_papers

CTX = prose_context(SLR_PAPERS, texts=["Does metformin reduce colorectal cancer in type 2 diabetes?"])
ALLOWED = {p["ref"] for p in SLR_PAPERS}


# ---- finding 1: the no-pool statement must attach to pooling -----------------------------------------------------
@pytest.mark.parametrize(("text", "says"), [
    ("Metformin does not reduce mortality in the pooled analysis.", False),  # the review's false positive
    ("No difference was seen in the pooled estimate of two reviews.", False),
    ("Pooling was not possible for any outcome.", True),
    ("The outcomes could not be pooled.", True),
    ("No outcome could be pooled.", True),
    ("There were too few comparable trials to pool.", True),
    ("We were unable to pool the estimates.", True),
    (NO_POOL_ANSWER, True),
])
def test_no_pool_statement_needs_the_negation_on_pooling(text, says):
    assert bool(_SAYS_NO_POOL.search(text)) is says


def test_a_negated_effect_in_a_pooled_claim_is_removed_and_the_no_pool_sentence_leads():
    text, removed = _bottom_line("Metformin does not reduce mortality in the pooled analysis.", CTX, ALLOWED,
                                 no_pool=True, strength=None)
    assert text == NO_POOL_ANSWER and removed == 1


# ---- findings 2-4: key findings without pools, GRADE wording, code-set certainty ---------------------------------
def test_no_pool_key_findings_lose_pooled_claims_and_carry_the_certainty():
    drafts = [NarrativeFinding(outcome="CRC incidence", statement="The pooled analysis shows a lower risk. Metformin "
                               "may lower CRC incidence.", refs=["P1"]),
              NarrativeFinding(outcome="Mortality", statement="The overall effect favours metformin.", refs=["P1"])]
    out, dropped, _ = _key_findings(drafts, CTX, ALLOWED, [], no_pool=True, strength="low")
    assert [f["statement"] for f in out] == ["Metformin may lower CRC incidence."] and dropped == 1
    assert out[0]["certainty"] == "low"
    out, _, _ = _key_findings(drafts[:1], CTX, ALLOWED, [], no_pool=False, strength=None)
    assert out[0]["certainty"] is None and "pooled" in out[0]["statement"]


LOW = "Low-certainty evidence suggests: "
VERY_LOW = "Very low-certainty evidence: "


@pytest.mark.parametrize(("strength", "statement", "expected"), [
    # fix round 2 (N2): the statement is never rewritten; a strong causal claim at low or very low gets a lead clause
    ("low", "Metformin reduces CRC incidence and improves survival.",
     LOW + "Metformin reduces CRC incidence and improves survival."),
    ("very_low", "Metformin causes fewer cancers.", VERY_LOW + "Metformin causes fewer cancers."),
    ("moderate", "Metformin reduces CRC incidence.", "Metformin reduces CRC incidence."),
    ("high", "Metformin reduces CRC incidence.", "Metformin reduces CRC incidence."),
    (None, "Metformin reduces CRC incidence.", "Metformin reduces CRC incidence."),  # not graded
    ("low", "Metformin may reduce CRC incidence.", "Metformin may reduce CRC incidence."),  # already worded
    ("low", "Metformin does not reduce mortality.", "Metformin does not reduce mortality."),
    # the reviewer's probes: nouns, sentence starts, negated and comparative clauses
    ("low", "Increases in HbA1c were smaller with metformin.", "Increases in HbA1c were smaller with metformin."),
    ("low", "Results were consistent across trials.", "Results were consistent across trials."),
    ("low", "There is no evidence that metformin reduces mortality.",
     "There is no evidence that metformin reduces mortality."),
    ("low", "Metformin neither increases nor reduces mortality.",
     "Metformin neither increases nor reduces mortality."),
    ("low", "It is unclear whether metformin prevents cancer.", "It is unclear whether metformin prevents cancer."),
    ("low", "The increases in weight were small.", "The increases in weight were small."),
    # fix round 3 (N13): plural and base forms, a subject before a comma, and no lead when it already hedges
    ("low", "SGLT2 inhibitors reduce heart failure hospitalisation.",
     LOW + "SGLT2 inhibitors reduce heart failure hospitalisation."),
    ("low", "Metformin lowers CRC incidence.", LOW + "Metformin lowers CRC incidence."),
    ("low", "Metformin, compared with sulfonylureas, reduces CRC incidence.",
     LOW + "Metformin, compared with sulfonylureas, reduces CRC incidence."),
    ("very_low", "The evidence is very uncertain, but metformin reduces CRC incidence.",
     "The evidence is very uncertain, but metformin reduces CRC incidence."),
    ("low", "Metformin was associated with a lower CRC incidence.",
     "Metformin was associated with a lower CRC incidence."),
])
def test_strong_causal_claims_get_a_certainty_lead_and_stay_unchanged(strength, statement, expected):
    assert _certainty_lead(statement, strength)[0] == expected


async def test_the_certainty_lead_reaches_the_key_findings_and_is_counted():
    drafts = [NarrativeFinding(outcome="CRC incidence", statement="Metformin reduces CRC incidence.", refs=["P1"])]
    out, _, led = _key_findings(drafts, CTX, ALLOWED, [], strength="low")
    assert out[0]["statement"] == LOW + "Metformin reduces CRC incidence." and led == 1
    assert "hedged" not in out[0]  # no new KeyFinding field (controller correction)


def test_key_finding_certainty_is_optional_and_set_in_code():
    assert KeyFinding(outcome="o", statement="s", refs=["P1"], k=1).certainty is None
    assert "certainty" not in NarrativeFinding.model_json_schema()["properties"]


# ---- findings 5 and 6: no [Pn] in the answer, and the certainty sentence names the real level --------------------
def test_answer_loses_its_citations():
    text, _ = _bottom_line("Metformin may lower CRC incidence [P1, P2].", CTX, ALLOWED, no_pool=False,
                           strength="low")
    assert text == f"Metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}"  # always appended (round 4)


def test_a_wrong_certainty_self_claim_is_removed_never_rewritten():
    # fix round 4 (N10 ruling): no level is rewritten; a sentence that claims another level for this review goes,
    # and the fixed certainty sentence ends the answer
    text, removed = _bottom_line("Metformin lowers CRC incidence. The certainty of the evidence is high.", CTX,
                                 ALLOWED, no_pool=False, strength="low")
    assert text == f"Metformin lowers CRC incidence. {ANSWER_CERTAINTY['low']}" and removed == 1
    right, _ = _bottom_line("Metformin lowers CRC incidence (low-certainty evidence).", CTX, ALLOWED, no_pool=False,
                            strength="low")
    assert right == f"Metformin lowers CRC incidence (low-certainty evidence). {ANSWER_CERTAINTY['low']}"


@pytest.mark.parametrize(("answer", "strength", "expected"), [
    # the re-review's N1 probes: the answer is never emptied; since fix round 4 nothing is rewritten
    ("Metformin probably lowers colorectal cancer risk, with high-certainty evidence [P1].", "moderate",
     "Metformin probably lowers colorectal cancer risk, with high-certainty evidence. "
     + ANSWER_CERTAINTY["moderate"]),
    ("Metformin may lower colorectal cancer risk; the certainty of the evidence is moderate.", "low",
     ANSWER_CERTAINTY["low"]),  # an explicit self-claim of another level: removed, the certainty sentence stays
    ("Very-low certainty evidence suggests metformin may lower colorectal cancer risk.", "very_low",
     "Very-low certainty evidence suggests metformin may lower colorectal cancer risk."),
    ("Very low certainty evidence suggests metformin may lower risk.", "very_low",
     "Very low certainty evidence suggests metformin may lower risk."),
])
def test_level_claims_are_never_rewritten_and_the_answer_never_emptied(answer, strength, expected):
    text, _ = _bottom_line(answer, CTX, ALLOWED, no_pool=False, strength=strength)
    assert text.startswith(expected)


def test_a_level_word_away_from_certainty_is_no_claim():
    text, _ = _bottom_line("Metformin may lower risk in patients at high risk.", CTX, ALLOWED, no_pool=False,
                           strength="low")
    assert text == f"Metformin may lower risk in patients at high risk. {ANSWER_CERTAINTY['low']}"


@pytest.mark.parametrize(("answer", "strength"), [  # fix round 3, N10: never rewritten
    ("Metformin may lower CRC risk; high-quality trials are needed.", "low"),
    ("Metformin probably lowers CRC risk, but high-quality randomised evidence is lacking.", "moderate"),
    ("Metformin may lower CRC risk, although study quality was high.", "low"),
    ("Metformin probably lowers CRC risk; most studies were low-quality.", "moderate"),
    ("No high-certainty evidence shows that metformin may lower CRC risk.", "low"),
])
def test_quality_phrases_and_negated_claims_are_not_rewritten(answer, strength):
    text, _ = _bottom_line(answer, CTX, ALLOWED, no_pool=False, strength=strength)
    assert text.startswith(answer)


def test_grade_label_and_a_certainty_of_evidence_self_claim_are_removed():
    # fix round 5: a wrong-level "GRADE: high" label is removed as a token with its brackets, never rewritten; the
    # certainty sentence carries the final level
    text, _ = _bottom_line("Metformin may lower CRC risk (GRADE: high).", CTX, ALLOWED, no_pool=False, strength="low")
    assert text == f"Metformin may lower CRC risk. {ANSWER_CERTAINTY['low']}"
    text, _ = _bottom_line("Metformin may lower CRC risk. The certainty of evidence was high.", CTX, ALLOWED,
                           no_pool=False, strength="low")
    assert text == f"Metformin may lower CRC risk. {ANSWER_CERTAINTY['low']}"


def test_a_high_certainty_answer_is_never_left_empty(monkeypatch):
    from collections import Counter

    from app.graph.nodes import synthesis as s

    monkeypatch.setattr(s, "fix_statement", lambda text, prose, refs=None: ("", Counter(numbers_removed=1)))
    assert s._bottom_line("Metformin lowered risk by 20%.", CTX, ALLOWED, no_pool=False, strength="high") == (
        ANSWER_CERTAINTY["high"], 1)


def test_a_restored_sentence_is_not_counted_as_removed(monkeypatch):  # N12
    from collections import Counter

    from app.graph.nodes import synthesis as s

    monkeypatch.setattr(s, "fix_statement", lambda text, prose, refs=None: ("", Counter(population_removed=1)))
    text, removed = s._bottom_line("Metformin lowers CRC risk in children.", CTX, ALLOWED, no_pool=False,
                                   strength="low")
    assert text.startswith("Metformin lowers CRC risk in children.") and removed == 0


def test_an_answer_the_checks_would_empty_keeps_its_sentence(monkeypatch):
    from collections import Counter

    from app.graph.nodes import synthesis as s

    monkeypatch.setattr(s, "fix_statement",  # every sentence removed
                        lambda text, prose, refs=None: ("", Counter(population_removed=1)))
    text, _ = s._bottom_line("Metformin may lower colorectal cancer risk.", CTX, ALLOWED, no_pool=False,
                             strength="moderate")
    assert text == f"Metformin may lower colorectal cancer risk. {ANSWER_CERTAINTY['moderate']}"
    # a sentence with a number is never put back (it may be unverified): the certainty sentence alone
    text, _ = s._bottom_line("Metformin lowered risk by 20%.", CTX, ALLOWED, no_pool=False, strength="moderate")
    assert text == ANSWER_CERTAINTY["moderate"]


def test_numbers_and_populations_are_checked_against_the_cited_papers_first():  # N4
    text, _ = _bottom_line("Metformin lowered the risk (HR 0.80) [P1].", CTX, ALLOWED, no_pool=False,
                           strength="low")
    assert "0.80" not in text and "[P1]" not in text


# ---- finding 7: methods.second_vote is what the screening logged -------------------------------------------------
def test_methods_second_vote_comes_from_the_screening_quality():
    d = deps()  # its llms have no screener_secondary: derived, this would be "off"
    st = {"options": {}, "quality": [{"stage": "screen", "second_vote": "same_model"}]}
    assert _methods(st, d, {})["screening"]["second_vote"] == "same_model"
    assert _methods({"options": {}, "quality": []}, d, {})["screening"]["second_vote"] == "off"


# ---- finding 8: per-source counts and the fail-closed answer check ------------------------------------------------
class Searx:
    async def search(self, query, pageno=1):
        return [Candidate(title="A metformin cohort", engines=["pubmed", "europe pmc"])]


class Epmc:
    async def search_trials(self, query, *, page_size=25):
        return [Candidate(title="A metformin trial", engines=["europe pmc"])]


async def test_per_source_counts_each_engine_and_the_rct_search():
    deps_ = GraphDeps(settings=Settings(_env_file=None), searxng=Searx(), europepmc=Epmc())
    out = await make_search(deps_)({"plan": {"queries": ["metformin cancer"]},
                                    "options": {"review_type": "meta_analysis"}})
    pages = Settings(_env_file=None).searxng_pages_meta
    assert out["search_stats"]["per_source"] == {"pubmed": pages, "europe pmc": pages,
                                                 "europe pmc (rct search)": 1}


async def test_a_crash_of_the_answer_check_fails_closed(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("bug")

    monkeypatch.setattr(synth_mod, "_bottom_line", boom)
    llm = FakeStructuredLLM("ds", lambda s, u: narrative("Metformin may lower CRC incidence [P1]. The risk fell by "
                                                         "20%.", [
        NarrativeFinding(outcome="CRC incidence", statement="Metformin may lower it.", refs=["P1"])]))
    out = await make_write_synthesis(deps(synthesizer=llm))(two_papers())
    # fix round 3 (N11): the model's answer without citations and without the numbered sentence, never ""; fix
    # round 4 (N16): the certainty sentence ends it
    assert out["synthesis"]["answer"] == f"Metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}"
    assert out["synthesis"]["key_findings"] == []
    assert "answer check failed: RuntimeError" in out["errors"]
    assert next(q for q in out["quality"] if q["stage"] == "prose_check")["check_failed"] is True


# ---- exports: answer and key findings; themes carry no direction (Task 2 review finding 5) ----------------------
def _review(result):
    return SimpleNamespace(topic="t", status="done", error=None, result=result)


def test_markdown_leads_with_the_answer_and_key_findings():
    r = stub_result("t", "en", "slr")
    md = render_markdown(_review(r))
    assert md.index("## Answer") < md.index("## Key findings") < md.index("## Summary")
    f = r["synthesis"]["key_findings"][0]
    assert f"- **{f['outcome']}** — {f['statement']} [{', '.join(f['refs'])}] (k={f['k']}" in md


def test_markdown_has_a_methods_block():  # Task 1 review finding 9, exported now (fix round 2)
    r = stub_result("t", "en", "slr")
    r |= {"queries": ["metformin colorectal cancer"], "models": {"screener": "openrouter:qwen"},
          "prompt_version": "2026-10-10.8"}
    r["methods"] = {**(r.get("methods") or {}), "searched_at": "2026-10-10T11:00:00+00:00",
                    "sources": {"pubmed": 80, "europe pmc": 200}}
    md = render_markdown(_review(r))
    block = md[md.index("## Methods"):md.index("## References")]
    assert "- **Searched:** 2026-10-10T11:00:00+00:00" in block
    assert "- **Sources (records before deduplication):** europe pmc 200, pubmed 80" in block
    assert "`metformin colorectal cancer`" in block and "screener openrouter:qwen" in block
    assert "- **Prompt version:** 2026-10-10.8" in block


def test_exports_give_themes_no_direction():
    r = stub_result("t", "en", "slr")
    theme = r["papers"][0]
    theme["card_en"] = {**theme["card_en"], "design_category": "qualitative", "overall_direction": "positive"}
    theme["card"] = theme["card_en"]
    row = r["synthesis"]["comparison"][0]
    row["cells"] = [{**c, "design_category": "qualitative"} if c["ref"] == theme["ref"] else c for c in row["cells"]]
    md = render_markdown(_review(r))
    table_row = next(x for x in md.splitlines() if x.startswith(f"| {row['outcome']} |"))
    theme_cell = next(c for c in row["cells"] if c["ref"] == theme["ref"])
    assert f"{theme_cell['finding']} (" not in table_row and " (" in table_row  # others keep their direction
    rows = list(csv.DictReader(io.StringIO(render_csv(r).lstrip("﻿"))))
    themed = [x for x in rows if x["ref"] == theme["ref"]]
    assert themed and all(x["direction"] == "" and x["overall_direction"] == "" for x in themed)
    assert any(x["direction"] for x in rows if x["ref"] != theme["ref"])
