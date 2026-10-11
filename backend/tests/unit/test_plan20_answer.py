"""Plan 20 Task 1 (report audit issues 1, 2, 3, 5, 11): the direct answer, the numberless key findings and the
Methods payload."""
import re
import time

import pytest

from app.graph import prompts
from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import (
    ANSWER_CERTAINTY,
    NO_POOL_ANSWER,
    _empty_synthesis,
    make_finalize,
    make_localize,
    make_write_synthesis,
)
from app.graph.schemas import NarrativeFinding, NarrativeNoGrade, Synthesis, SynthesisNarrative
from app.harness.prose import fix_statement, prose_context, statement_problems
from app.harness.quality import summarize_quality
from app.services.llm import LLMError
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM, to_thai
from tests.unit.test_comparison_and_prose import SLR_PAPERS
from tests.unit.test_nodes_synthesis import card, deps, matrix_for, paper, state, thai


# ---- schema -------------------------------------------------------------------------------------
@pytest.mark.parametrize("schema", [SynthesisNarrative, NarrativeNoGrade])
def test_narrative_schemas_require_answer_and_key_findings(schema):
    s = schema.model_json_schema()
    assert {"answer", "key_findings"} <= set(s["required"])
    assert "default" not in s["properties"]["answer"] and "default" not in s["properties"]["key_findings"]
    finding = s["$defs"]["NarrativeFinding"]
    assert set(finding["required"]) == {"outcome", "statement", "refs"}  # k is set in code


def test_synthesis_carries_answer_and_key_findings_and_old_results_still_load():
    old = Synthesis(executive_summary="s", comparison=[], consensus=[], conflicts=[], evidence_rationale="r",
                    research_gaps=[])
    assert old.answer == "" and old.key_findings == []
    assert {"answer", "key_findings"} <= set(Synthesis.model_json_schema()["properties"])
    assert _empty_synthesis("No studies.")["answer"] == "No studies."
    assert _empty_synthesis("No studies.")["key_findings"] == []


# ---- prose check: numberless statements ---------------------------------------------------------------
CTX = prose_context(SLR_PAPERS, texts=["Does metformin reduce colorectal cancer in type 2 diabetes?"])


@pytest.mark.parametrize("text", [
    "Metformin is associated with a lower colorectal cancer incidence (OR 0.78).",  # a verified card number
    "Three reviews and 3 trials agree.",  # a count
    "Metformin lowers the risk by 37%.",  # an invented number
])
def test_statements_lose_every_result_number(text):
    fixed, counts = fix_statement(text, CTX, ["P1"])
    assert fixed == "" and counts["numbers_removed"] == 1
    assert statement_problems(text, CTX, "answer", ["P1"])[0].startswith("answer:")


def test_statements_keep_context_numbers_and_numberless_sentences():
    text = "Metformin may lower colorectal cancer incidence in type 2 diabetes. Reviews agree."
    assert fix_statement(text, CTX, ["P1", "P2"]) == (text, fix_statement(text, CTX)[1])
    assert statement_problems(text, CTX, "answer") == []


def test_statement_population_is_checked_against_the_refs():
    ctx = prose_context([paper("P1", {**card(), "population": "children with type 1 diabetes"})])
    fixed, counts = fix_statement("Metformin helps adults.", ctx, ["P1"])
    assert fixed == "" and counts["population_removed"] == 1


# ---- write_synthesis ----------------------------------------------------------------------------
def narrative(answer, findings, summary="Metformin may lower CRC risk [P1, P2].", strength="low"):
    return SynthesisNarrative(executive_summary=summary, evidence_strength=strength,
                              evidence_rationale="observational [P1]", research_gaps=["RCTs"], answer=answer,
                              key_findings=findings)


def two_papers(**extra):
    papers = [paper("P1", card()), paper("P2", card())]
    return state(papers, **{"matrix": matrix_for(papers), "conflict_notes": [], "language": "en", **extra})


async def run(answer, findings, st=None, **kw):
    synth = FakeStructuredLLM("ds", lambda s, u: narrative(answer, findings, **kw))
    out = await make_write_synthesis(deps(synthesizer=synth))(st or two_papers())
    return out, synth


async def test_answer_and_key_findings_are_checked_and_k_is_counted():
    findings = [
        NarrativeFinding(outcome="crc INCIDENCE", statement="Metformin may lower CRC incidence [P2].",
                         refs=["P1", "P9"]),
        NarrativeFinding(outcome="CRC incidence", statement="Metformin lowered the risk (HR 0.80).", refs=["P1"]),
        NarrativeFinding(outcome="Adverse events", statement="Adverse events were rarely reported.", refs=["P9"]),
        NarrativeFinding(outcome="Adherence", statement="Adherence was rarely reported.", refs=["P2"]),
    ]
    out, synth = await run("Metformin may lower CRC incidence (HR 0.80). It is well tolerated.", findings)
    repair = synth.calls[1][1]  # numbers in the answer or a statement, and unknown refs, go back once
    assert "answer:" in repair and "key_findings[1].statement" in repair and "unknown P9" in repair
    s = out["synthesis"]
    assert s["answer"] == "It is well tolerated. " + ANSWER_CERTAINTY["low"]  # no "may" left: certainty appended
    assert s["key_findings"] == [
        {"outcome": "CRC incidence", "statement": "Metformin may lower CRC incidence.", "refs": ["P1", "P2"], "k": 2, "certainty": "low"},
        {"outcome": "Adherence", "statement": "Adherence was rarely reported.", "refs": ["P2"], "k": 1, "certainty": "low"},
    ]
    q = next(e for e in out["quality"] if e["stage"] == "prose_check")
    assert q["answer_removed"] == 1 and q["key_findings_removed"] == 2
    assert summarize_quality(out["quality"], None)["prose_check"]["key_findings_removed"] == 2


async def test_at_most_five_key_findings_and_no_certainty_sentence_when_ungraded():
    findings = [NarrativeFinding(outcome=f"Outcome {c}", statement="Reported.", refs=["P1"]) for c in "ABCDEFG"]
    out, _ = await run("Metformin may lower CRC incidence.", findings)
    assert len(out["synthesis"]["key_findings"]) == 5
    # fix round 4 (N10 ruling): a graded answer always ends with the certainty sentence, worded or not
    assert out["synthesis"]["answer"] == f"Metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}"
    st = two_papers(options={"review_type": "narrative"})
    synth = FakeStructuredLLM("ds", lambda s, u: NarrativeNoGrade(
        executive_summary="Themes [P1, P2].", research_gaps=[], answer="Metformin lowers CRC incidence.",
        key_findings=[]))
    out = await make_write_synthesis(deps(synthesizer=synth))(st)
    assert out["synthesis"]["answer"] == "Metformin lowers CRC incidence."


async def test_failed_narrative_has_no_answer():
    synth = FakeStructuredLLM("ds", lambda s, u: LLMError("down"))
    out = await make_write_synthesis(deps(synthesizer=synth, harness=HarnessSpec(max_repairs=0, escalate_on=[])))(
        two_papers())
    assert out["synthesis"]["answer"] == "" and out["synthesis"]["key_findings"] == []


# ---- meta-analysis without pools ---------------------------------------------------------------------
@pytest.mark.parametrize("meta", [None, {"pools": [], "excluded": [], "reference": []}])
async def test_meta_without_pools_says_pooling_was_not_possible(meta):
    st = two_papers(options={"review_type": "meta_analysis"}, meta_analysis=meta)
    out, _ = await run("The pooled analysis suggests a lower risk. Metformin may lower CRC incidence.", [], st=st)
    answer = out["synthesis"]["answer"]
    # fix round 4 (N10 ruling): the certainty sentence always ends a graded answer
    assert answer == f"{NO_POOL_ANSWER} Metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}"
    assert "pooled analysis suggests" not in answer


async def test_meta_answer_that_already_says_so_is_not_doubled_and_an_empty_one_gets_the_sentence():
    st = two_papers(options={"review_type": "meta_analysis"}, meta_analysis=None)
    out, _ = await run("No outcome could be pooled; metformin may lower CRC incidence.", [], st=st)
    assert out["synthesis"]["answer"] == (  # the certainty sentence always ends a graded answer (fix round 4)
        f"No outcome could be pooled; metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}")
    out, _ = await run("", [], st=two_papers(options={"review_type": "meta_analysis"}, meta_analysis=None))
    assert out["synthesis"]["answer"].startswith(NO_POOL_ANSWER)


async def test_meta_with_pools_gets_no_no_pool_sentence():
    pool = {"outcome": "CRC incidence", "measure": "HR", "design_group": "observational", "k": 3,
            "studies": [{"ref": "P1"}, {"ref": "P2"}], "i2": 0.0, "tau2": 0.0,
            "pooled": {"est": 0.81, "ci_lower": 0.7, "ci_upper": 0.93}}
    st = two_papers(options={"review_type": "meta_analysis"}, meta_analysis={"pools": [pool]})
    out, _ = await run("Metformin may lower CRC incidence.", [], st=st)
    assert out["synthesis"]["answer"] == f"Metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}"


# ---- localization -------------------------------------------------------------------------------
async def test_answer_and_key_findings_are_localized_and_row_outcomes_follow_the_row():
    findings = [NarrativeFinding(outcome="CRC incidence", statement="Metformin may lower CRC incidence.",
                                 refs=["P1", "P2"]),
                NarrativeFinding(outcome="Adherence", statement="Adherence was rarely reported.", refs=["P2"])]
    out, _ = await run("Metformin may lower CRC incidence.", findings)
    english = out["synthesis"]
    loc = await make_localize(deps(localizer=FakeStructuredLLM("qwen", thai)))(
        two_papers(synthesis=english, language="th"))
    d = loc["synthesis_display"]
    answer = f"Metformin may lower CRC incidence. {ANSWER_CERTAINTY['low']}"  # graded: the certainty sentence ends it
    assert d["answer"] == to_thai(answer)
    assert [f["statement"] for f in d["key_findings"]] == [to_thai("Metformin may lower CRC incidence."),
                                                            to_thai("Adherence was rarely reported.")]
    # the row's own localized name (same text as the comparison table), and a translated free outcome
    assert d["key_findings"][0]["outcome"] == d["comparison"][0]["outcome"] == to_thai("CRC incidence")
    assert d["key_findings"][1]["outcome"] == to_thai("Adherence")
    assert [f["refs"] for f in d["key_findings"]] == [["P1", "P2"], ["P2"]] and d["key_findings"][0]["k"] == 2
    assert english["answer"] == answer  # synthesis_en keeps the English


# ---- methods payload ----------------------------------------------------------------------------
async def test_finalize_adds_the_methods_payload():
    d = deps(harness=HarnessSpec(screen_borderline=(40, 70)))
    d.llms.models = {"screener": "openrouter:qwen", "screener_secondary": "openrouter:gemini",
                     "extractor": "openrouter:qwen", "extractor_secondary": "openrouter:gemini",
                     "synthesizer": "openrouter:qwen"}
    d.llms.screener_secondary = FakeStructuredLLM("gemini", lambda s, u: None)
    st = state([paper("P1", card())], synthesis={"executive_summary": "EN"},
               options={"review_type": "meta_analysis", "year_from": 2015, "study_types": ["RCT"]},
               plan={"queries": ["q1"], "inclusion_criteria": ["adults"], "exclusion_criteria": ["editorials"]},
               search_stats={"found": 40, "per_source": {"pubmed": 25, "europe pmc": 20},
                             "searched_at": "2026-10-10T08:00:00+00:00"})
    m = (await make_finalize(d)(st))["result"]["methods"]
    assert m == {
        "searched_at": "2026-10-10T08:00:00+00:00",
        "sources": {"pubmed": 25, "europe pmc": 20},
        "eligibility": {"year_from": 2015, "study_types": ["RCT"], "inclusion_criteria": ["adults"],
                        "exclusion_criteria": ["editorials"]},
        "limits": {"candidate_limit": 120, "max_papers": 30, "min_abstract_chars": 150},
        "screening": {"model": "openrouter:qwen", "second_model": "openrouter:gemini", "second_vote": "two_models",
                      "borderline": [40, 70], "relevance_floor": 40},
        "extraction": {"model": "openrouter:qwen", "second_model": "openrouter:gemini", "verify_quotes": True,
                       "quote_match_threshold": 90, "text": "abstract"},
        "synthesis": {"model": "openrouter:qwen", "pooling": "DerSimonian-Laird random effects",
                      "grading": "GRADE-lite"},
    }


async def test_methods_falls_back_to_the_start_time_and_null_sources():
    started = time.time()
    st = state([], synthesis={"executive_summary": "EN"}, options={"review_type": "scoping"}, started_at=started,
               search_stats={"found": 3})
    m = (await make_finalize(deps())(st))["result"]["methods"]
    assert m["searched_at"].endswith("+00:00") and m["sources"] is None
    assert m["screening"]["second_vote"] == "off" and m["screening"]["second_model"] is None
    assert m["synthesis"]["pooling"] is None and m["synthesis"]["grading"] is None
    m = (await make_finalize(deps())(state([], synthesis={"executive_summary": "EN"})))["result"]["methods"]
    assert m["searched_at"] is None


# ---- stub ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("review_type", ["slr", "meta_analysis", "narrative", "scoping"])
def test_stub_result_has_answer_key_findings_and_methods(review_type):
    r = stub_result("metformin", "en", review_type)
    s = r["synthesis"]
    refs = {p["ref"] for p in r["papers"]}
    assert s["answer"] and 1 <= len(s["key_findings"]) <= 5
    for f in s["key_findings"]:
        assert set(f["refs"]) <= refs and f["k"] == len(f["refs"]) and not re.search(r"\d", f["statement"])
    assert {f["outcome"] for f in s["key_findings"]} <= {row["outcome"] for row in s["comparison"]}
    assert set(r["methods"]) == {"searched_at", "sources", "eligibility", "limits", "screening", "extraction",
                                 "synthesis"}
    assert ("certainty" in s["answer"]) == (review_type in ("slr", "meta_analysis"))


# ---- prompts ------------------------------------------------------------------------------------
@pytest.mark.parametrize("review_type", ["slr", "meta_analysis", "narrative", "scoping"])
def test_every_narrative_prompt_asks_for_answer_and_key_findings(review_type):
    system = prompts.narrative_system(review_type)
    assert "answer:" in system and "key_findings:" in system
    if review_type in ("narrative", "scoping"):
        assert "output only executive_summary, research_gaps, answer" in system
    assert ("pooling was not possible" in system) == (review_type == "meta_analysis")
