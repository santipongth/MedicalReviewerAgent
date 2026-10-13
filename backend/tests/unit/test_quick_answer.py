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
