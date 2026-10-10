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
    _hedge,
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


@pytest.mark.parametrize(("strength", "statement", "expected"), [
    ("moderate", "Metformin reduces CRC incidence.", "Metformin probably reduces CRC incidence."),
    ("low", "Metformin reduces CRC incidence and improves survival.",
     "Metformin may reduce CRC incidence and may improve survival."),
    ("very_low", "Metformin causes fewer cancers.",
     "Metformin may cause fewer cancers, but the evidence is very uncertain."),
    ("low", "Metformin may reduce CRC incidence.", "Metformin may reduce CRC incidence."),  # already worded
    ("low", "Metformin does not reduce mortality.", "Metformin does not reduce mortality."),  # negated
    ("high", "Metformin reduces CRC incidence.", "Metformin reduces CRC incidence."),
    (None, "Metformin reduces CRC incidence.", "Metformin reduces CRC incidence."),  # not graded
])
def test_causal_statements_are_hedged_for_their_certainty(strength, statement, expected):
    assert _hedge(statement, strength)[0] == expected


def test_key_finding_certainty_is_optional_and_set_in_code():
    assert KeyFinding(outcome="o", statement="s", refs=["P1"], k=1).certainty is None
    assert "certainty" not in NarrativeFinding.model_json_schema()["properties"]


# ---- findings 5 and 6: no [Pn] in the answer, and the certainty sentence names the real level --------------------
def test_answer_loses_its_citations():
    text, _ = _bottom_line("Metformin may lower CRC incidence [P1, P2].", CTX, ALLOWED, no_pool=False,
                           strength="low")
    assert text == "Metformin may lower CRC incidence."


def test_a_wrong_certainty_level_is_replaced():
    text, removed = _bottom_line("Metformin lowers CRC incidence. The certainty of the evidence is high.", CTX,
                                 ALLOWED, no_pool=False, strength="low")
    assert text == f"Metformin lowers CRC incidence. {ANSWER_CERTAINTY['low']}" and removed == 1
    right, _ = _bottom_line("Metformin lowers CRC incidence (low-certainty evidence).", CTX, ALLOWED, no_pool=False,
                            strength="low")
    assert right == "Metformin lowers CRC incidence (low-certainty evidence)."


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
    llm = FakeStructuredLLM("ds", lambda s, u: narrative("Metformin may lower CRC incidence.", [
        NarrativeFinding(outcome="CRC incidence", statement="Metformin may lower it.", refs=["P1"])]))
    out = await make_write_synthesis(deps(synthesizer=llm))(two_papers())
    assert out["synthesis"]["answer"] == "" and out["synthesis"]["key_findings"] == []
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
