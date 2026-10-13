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
from app.services.llm import BudgetExceeded, LLMError, LLMs
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


async def test_the_judge_never_escalates_and_repairs_at_most_once():
    def half(system, user):
        return SupportBatch(verdicts=[SupportVerdict(id="c1", label="partial", sentence=1)])

    judge = FakeStructuredLLM("judge", half)
    big = FakeStructuredLLM("big-model", supported)
    d = deps(judge)
    d.llms.harness = HarnessSpec(max_repairs=5)  # the pipeline's setting must not reach the judge
    d.llms.escalation = lambda schema: big
    out = await node.make_check_support(d)(state())
    assert big.calls == [] and len(judge.calls) == 2
    assert out["support"]["judge"] == "incomplete"


async def test_the_judge_is_skipped_below_two_cents_left():
    judge = FakeStructuredLLM("judge", supported)
    with use_budget(ReviewBudget(cap_usd=0.10, spent=0.085)):  # $0.015 left
        out = await node.make_check_support(deps(judge))(state())
    assert judge.calls == [] and out["support"]["judge"] == "skipped_budget"
    with use_budget(ReviewBudget(cap_usd=0.10, spent=0.075)):  # $0.025 left
        out = await node.make_check_support(deps(judge))(state())
    assert len(judge.calls) == 1 and out["support"]["judge"] == "ok"


async def test_a_crash_while_building_the_records_leaves_support_null(monkeypatch):
    def boom(*a, **k):
        raise ValueError("bug")

    monkeypatch.setattr(sp, "claim_record", boom)
    out = await node.make_check_support(deps(FakeStructuredLLM("judge", supported)))(state())
    assert out["support"] is None and out["quality"][0]["judge"] == "crashed"


async def test_the_cap_reached_during_a_repair_is_a_skip_that_keeps_the_completed_verdicts():
    def half_then_cap(system, user):
        if "previous_attempt_problems" in user:
            return BudgetExceeded("cost cap of $0.10 per review reached; step skipped")
        return SupportBatch(verdicts=[SupportVerdict(id="c1", label="partial", sentence=1)])

    judge = FakeStructuredLLM("judge", half_then_cap, cost=0.002)
    out = await node.make_check_support(deps(judge))(state())
    assert out["support"]["judge"] == "skipped_budget" and out["errors"] == []
    labels = [c["label"] for claim in out["support"]["claims"] for c in claim["citations"]]
    assert labels == ["partial", None, None, None, None, None] and out["cost_usd"] == 0.002
