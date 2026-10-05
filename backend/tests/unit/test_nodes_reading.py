import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.reading import make_read_paper
from app.graph.schemas import Candidate, OutcomeResult, PaperCard
from app.services.llm import LLMOutputError, LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM

ABSTRACT = (
    "Methods: We enrolled 1,234 adults with type 2 diabetes in a population-based cohort. "
    "Results: Metformin use was associated with a lower risk of colorectal cancer "
    "(HR 0.80, 95% CI 0.71-0.90; p = 0.003). Conclusions: Findings support a protective association."
)
QUOTE = "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003)"


def card(effect=0.8, direction="positive", quote=QUOTE, n=1234):
    return PaperCard(
        study_design="cohort", population="adults with type 2 diabetes", sample_size=n,
        sample_size_quote="We enrolled 1,234 adults with type 2 diabetes",
        intervention_or_exposure="metformin", comparator="no metformin",
        outcomes=[OutcomeResult(outcome="CRC incidence", result="lower risk", evidence_quote=quote,
                                effect_size="HR 0.80 (0.71-0.90)", effect_measure="HR", effect_value=effect,
                                ci_lower=0.71, ci_upper=0.9, p_value=0.003, direction=direction)],
        key_findings=["lower CRC risk"], limitations=["observational"], funding_or_conflicts=None,
        risk_of_bias="moderate", overall_direction=direction)


def deps(extractor, secondary=None, escalation=None, harness=None, **settings):
    u = FakeStructuredLLM("u", lambda s, user: AssertionError("unexpected"))
    llms = LLMs(guard=u, planner=u, screener=u, extractor=extractor, synthesizer=u, extractor_secondary=secondary,
                escalation=(lambda schema: escalation) if escalation else None,
                harness=harness or HarnessSpec(max_repairs=1))
    return GraphDeps(settings=Settings(_env_file=None, **settings), llms=llms)


def payload(abstract=ABSTRACT):
    c = Candidate(title="Metformin and colorectal cancer", doi="10.1/a", abstract=abstract)
    return {"paper": {"ref": "P1", "relevance": 90, "reason": "relevant", "uncertain": False,
                      "candidate": c.model_dump()},
            "plan": {"outcomes": ["CRC incidence"]}, "question": "Does metformin reduce CRC incidence?",
            "question_detail": {"outcomes": ["CRC incidence", "CRC mortality"]}, "language": "th"}


async def test_verified_dual_extraction_agrees():
    primary = FakeStructuredLLM("ds", lambda s, u: card())
    secondary = FakeStructuredLLM("qwen", lambda s, u: card())
    out = await make_read_paper(deps(primary, secondary))(payload())
    entry = out["papers"][0]
    assert entry["card"]["outcomes"][0]["effect_value"] == 0.8
    assert entry["verification"] == {"numbers_verified": 2, "numbers_total": 2, "agreement": 1.0,
                                     "escalated": False, "repaired": False, "uncertain": False, "unverified": []}
    assert "fulltext_source" not in entry and "fulltext_url" not in entry
    q = out["quality"][0]
    assert q["stage"] == "read" and q["ref"] == "P1" and q["seconds"] >= 0 and q["source"] == "abstract"
    assert out["cost_usd"] == pytest.approx(0.02)


async def test_extraction_prompt_is_english_sandwich_with_question_and_outcomes():
    primary = FakeStructuredLLM("ds", lambda s, u: card())
    await make_read_paper(deps(primary, harness=HarnessSpec(dual_extraction=False)))(payload())
    system, user = primary.calls[0]
    assert user.index("<paper>") < user.index("Checklist")  # document first, instructions last
    assert "Does metformin reduce CRC incidence?" in user and "CRC mortality" in user
    assert "evidence_quote" in system and "Thai" not in system


async def test_wrong_number_is_repaired_with_specific_feedback():
    answers = iter([card(effect=0.75), card()])
    primary = FakeStructuredLLM("ds", lambda s, u: next(answers))
    out = await make_read_paper(deps(primary, harness=HarnessSpec(dual_extraction=False)))(payload())
    assert "effect_value 0.75 does not appear" in primary.calls[1][1]
    v = out["papers"][0]["verification"]
    assert v["repaired"] is True and v["numbers_verified"] == 2


async def test_unverifiable_numbers_are_nulled_never_reach_the_plot():
    primary = FakeStructuredLLM("ds", lambda s, u: card(effect=0.5, quote="a quote that never appears in the paper"))
    out = await make_read_paper(deps(primary, harness=HarnessSpec(dual_extraction=False, max_repairs=1,
                                                                  escalate_on=[])))(payload())
    o = out["papers"][0]["card"]["outcomes"][0]
    assert o["effect_value"] is None and o["ci_lower"] is None and o["effect_measure"] == "none"
    assert out["papers"][0]["verification"]["numbers_verified"] == 1  # sample size still verified
    # the UI must tell "blanked by the verifier" from "not reported"
    assert out["papers"][0]["verification"]["unverified"] == [{"field": "effect", "outcome": "CRC incidence"}]


async def test_direction_disagreement_escalates():
    primary = FakeStructuredLLM("ds", lambda s, u: card())
    secondary = FakeStructuredLLM("qwen", lambda s, u: card(direction="negative"))
    big = FakeStructuredLLM("max", lambda s, u: card(direction="positive"), cost=0.05)
    out = await make_read_paper(deps(primary, secondary, big))(payload())
    v = out["papers"][0]["verification"]
    assert v["escalated"] is True and v["uncertain"] is False and v["agreement"] < 1
    assert len(big.calls) == 1 and out["cost_usd"] == pytest.approx(0.07)


async def test_disagreement_without_escalation_is_flagged_uncertain():
    primary = FakeStructuredLLM("ds", lambda s, u: card())
    secondary = FakeStructuredLLM("qwen", lambda s, u: card(direction="negative"))
    out = await make_read_paper(deps(primary, secondary))(payload())
    assert out["papers"][0]["verification"]["uncertain"] is True
    assert out["papers"][0]["card"]["overall_direction"] == "positive"


async def test_secondary_rescues_failed_primary_and_total_failure_is_reported():
    bad = FakeStructuredLLM("ds", lambda s, u: LLMOutputError("garbage"))
    good = FakeStructuredLLM("qwen", lambda s, u: card())
    out = await make_read_paper(deps(bad, good))(payload())
    assert out["papers"][0]["card"] is not None
    worse = await make_read_paper(deps(FakeStructuredLLM("ds", lambda s, u: LLMOutputError("garbage")),
                                       harness=HarnessSpec(dual_extraction=False, max_repairs=0)))(payload())
    assert worse["papers"][0]["card"] is None and "extraction failed for P1" in worse["errors"][0]


async def test_reads_title_and_abstract_only():
    primary = FakeStructuredLLM("ds", lambda s, u: card())
    out = await make_read_paper(deps(primary, harness=HarnessSpec(dual_extraction=False)))(payload())
    user = primary.calls[0][1]
    assert "Metformin and colorectal cancer\n\nMethods: We enrolled" in user
    assert '"text_source": "abstract"' in user
    assert out["papers"][0]["card"] is not None


async def test_no_abstract_is_an_error_not_a_crash():
    primary = FakeStructuredLLM("ds", lambda s, u: card())
    out = await make_read_paper(deps(primary))(payload(abstract=None))
    entry = out["papers"][0]
    assert entry["card"] is None and entry["error"] == "no abstract"
    assert out["errors"] == ["no abstract for P1"] and primary.calls == []


async def test_design_category_contradicting_publication_type_is_repaired_then_settled():
    answers = iter([card().model_copy(update={"design_category": "cohort"}),
                    card().model_copy(update={"design_category": "rct"})])
    primary = FakeStructuredLLM("q", lambda s, u: next(answers))
    p = payload()
    p["paper"]["candidate"]["pub_types"] = ["Randomized Controlled Trial"]
    out = await make_read_paper(deps(primary, harness=HarnessSpec(dual_extraction=False)))(p)
    assert "contradicts the publication type Randomized Controlled Trial" in primary.calls[1][1]
    assert out["papers"][0]["card"]["design_category"] == "rct"


async def test_missing_design_category_is_inferred_without_another_call():
    primary = FakeStructuredLLM("q", lambda s, u: card())  # study_design "cohort", no category
    out = await make_read_paper(deps(primary, harness=HarnessSpec(dual_extraction=False)))(payload())
    assert len(primary.calls) == 1 and out["papers"][0]["card"]["design_category"] == "cohort"
    assert "design_category" in prompts_extract_system()


def prompts_extract_system():
    from app.graph import prompts
    return prompts.extract_system()


async def test_a_secondary_extractor_on_the_same_model_is_skipped():
    primary = FakeStructuredLLM("qwen/qwen3.5-flash-02-23", lambda s, u: card())
    same = FakeStructuredLLM("qwen/qwen3.5-flash-02-23", lambda s, u: card())
    out = await make_read_paper(deps(primary, same))(payload())
    assert len(primary.calls) == 1 and same.calls == []  # same model twice is cost, not a cross-check
    assert out["papers"][0]["verification"]["agreement"] is None
    other = FakeStructuredLLM("deepseek/deepseek-v4-flash", lambda s, u: card())
    await make_read_paper(deps(FakeStructuredLLM("qwen/qwen3.5-flash-02-23", lambda s, u: card()), other))(payload())
    assert len(other.calls) == 1  # a different model still cross-checks
