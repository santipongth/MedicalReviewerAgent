"""Plan 19 Task 6: search rank order and meta recall (I-8, I-9), two real models (I-10), scope discipline (I-15),
code Thai templates (I-16), outcome pre-clustering (I-17) and the minor items I-18 to I-26."""
import re

import httpx
import pytest
import respx

from app.config import Settings
from app.graph import prompts
from app.graph.graph import GraphDeps
from app.graph.nodes.intake import MAX_QUERIES, MAX_QUERIES_META, make_plan_queries
from app.graph.nodes.retrieval import (
    make_enrich,
    make_search,
    trial_search_queries,
    wants_trial_search,
)
from app.graph.nodes.screening import MIN_INCLUDE_RELEVANCE, make_screen_batch, make_select_top
from app.graph.nodes.synthesis import (
    _clusters,
    _render_th,
    _templated,
    make_localize,
    make_normalize_outcomes,
)
from app.graph.schemas import (
    Candidate,
    OutcomeCluster,
    OutcomeClusters,
    OutcomeMember,
    QueryPlan,
    ScreenBatch,
    ScreenDecision,
    TopicVerdict,
    TranslationBatch,
    TranslationItem,
)
from app.harness.matrix import expand_clusters, outcome_key, precluster
from app.harness.runner import HarnessRunner
from app.harness.verify import numbers_preserved
from app.schemas.review import ReviewOptions
from app.services.dedupe import merge_candidates
from app.services.europepmc import EuropePmcClient
from app.services.http import HttpClient
from app.services.llm import LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM

ABSTRACT = "Background. " + "Metformin users had a lower incidence of colorectal cancer in this cohort. " * 4


def unexpected(name):
    return FakeStructuredLLM(name, lambda s, u: AssertionError(f"{name} must not be called"))


def llms(**roles):
    u = unexpected("u")
    base = {"guard": u, "planner": u, "screener": u, "extractor": u, "synthesizer": u,
            "harness": HarnessSpec(max_repairs=1)}
    return LLMs(**{**base, **roles})


# ---- I-8: search rank order survives enrichment and dedupe ---------------------------------------
def test_merge_keeps_search_rank_when_lookup_records_lead():
    hits = [Candidate(title=f"Hit number {i} on metformin and cancer", doi=f"10.1/{i}", engines=["pubmed"])
            for i in range(5)]
    records = [Candidate(title="Curated title four", doi="10.1/4", pmcid="PMC4", engines=["europepmc"]),
               Candidate(title="Curated title three", doi="10.1/3", pmcid="PMC3", engines=["europepmc"])]
    merged = merge_candidates([*records, *hits], rank_from=len(records))
    assert [c.doi for c in merged] == ["10.1/0", "10.1/1", "10.1/2", "10.1/3", "10.1/4"]  # was [4, 3, 0, 1, 2]
    assert merged[4].title == "Curated title four" and merged[4].pmcid == "PMC4"  # Europe PMC still wins fields
    # without rank_from the old behaviour (earliest index first) is unchanged
    assert [c.doi for c in merge_candidates([*records, *hits])][:2] == ["10.1/4", "10.1/3"]


def test_merge_puts_record_only_groups_last():
    hits = [Candidate(title="A search hit about statins", doi="10.1/a", engines=["pubmed"])]
    records = [Candidate(title="Unmatched record", doi="10.1/z", engines=["europepmc"])]
    assert [c.doi for c in merge_candidates([*records, *hits], rank_from=1)] == ["10.1/a", "10.1/z"]


class Epmc:
    def __init__(self, records=(), trials=None, fail_trials=False):
        self.records, self.trials, self.fail_trials, self.trial_calls = list(records), trials or {}, fail_trials, []

    async def lookup(self, *, dois, pmids):
        return self.records

    async def search_trials(self, query, *, page_size=25):
        self.trial_calls.append((query, page_size))
        if self.fail_trials:
            raise RuntimeError("epmc down")
        return self.trials.get(query, [])


class Searx:
    def __init__(self, by_query):
        self.by_query, self.calls = by_query, []

    async def search(self, query, pageno=1):
        self.calls.append((query, pageno))
        return self.by_query.get((query, pageno), [])


def gdeps(**kw):
    return GraphDeps(settings=Settings(_env_file=None), **kw)


async def test_enrich_keeps_rank_order_through_the_europe_pmc_lookup():
    raw = [Candidate(title=f"Ranked paper {i} on metformin", doi=f"10.1/{i}", abstract=ABSTRACT,
                     abstract_source="engine", engines=["pubmed"]).model_dump() for i in range(5)]
    records = [Candidate(title=f"Ranked paper {i} on metformin", doi=f"10.1/{i}", abstract=ABSTRACT,
                         engines=["europepmc"]) for i in (4, 3)]
    out = await make_enrich(gdeps(europepmc=Epmc(records)))({"candidates": raw, "options": {
        "candidate_limit": 20, "max_papers": 5}})
    assert [c["doi"] for c in out["candidates"]] == [f"10.1/{i}" for i in range(5)]


async def test_enrich_counts_year_and_abstract_exclusions():  # I-20
    raw = [Candidate(title="Old metformin cohort paper", doi="10.1/old", year=2001, abstract=ABSTRACT).model_dump(),
           Candidate(title="New paper without an abstract", doi="10.1/none", year=2020).model_dump(),
           Candidate(title="New paper with an abstract", doi="10.1/ok", year=2020, abstract=ABSTRACT).model_dump()]
    out = await make_enrich(gdeps(europepmc=Epmc()))({"candidates": raw, "options": {"year_from": 2010}})
    stats = out["search_stats"]
    assert stats["year_excluded"] == 1 and stats["no_abstract"] == 1 and stats["with_abstract"] == 1
    assert stats["unique"] == stats["year_excluded"] + stats["non_research"] + stats["no_abstract"] + 1


# ---- I-9: meta-analysis recall --------------------------------------------------------------------
def test_trial_search_queries_drop_design_words_and_duplicates():
    qs = ["SGLT2 inhibitors heart failure randomized controlled trial", "SGLT2 inhibitors heart failure",
          "DAPA-HF EMPEROR-Reduced trial", "empagliflozin hospitalization"]
    assert trial_search_queries(qs, 3) == ["SGLT2 inhibitors heart failure", "DAPA-HF EMPEROR-Reduced",
                                           "empagliflozin hospitalization"]
    assert trial_search_queries(qs, 0) == []


@pytest.mark.parametrize(("options", "expected"), [
    ({"review_type": "meta_analysis"}, True), ({"review_type": "meta_analysis", "study_types": ["RCT"]}, True),
    ({"review_type": "meta_analysis", "study_types": ["Cohort"]}, False), ({"review_type": "slr"}, False)])
def test_trial_search_only_for_meta_analysis_that_admits_rcts(options, expected):
    assert wants_trial_search(ReviewOptions.clamped(options)) is expected


async def test_meta_search_goes_two_pages_deep_and_adds_rct_hits():
    hit = Candidate(title="SearXNG hit on SGLT2 inhibitors", doi="10.1/s")
    trial = Candidate(title="Dapagliflozin in patients with heart failure", doi="10.1/dapa", engines=["europe pmc"],
                      abstract=ABSTRACT, abstract_source="europepmc")
    sx = Searx({("SGLT2 heart failure randomized controlled trial", 2): [hit]})
    epmc = Epmc(trials={"SGLT2 heart failure": [trial]})
    out = await make_search(gdeps(searxng=sx, europepmc=epmc))({
        "plan": {"queries": ["SGLT2 heart failure randomized controlled trial"]},
        "options": {"review_type": "meta_analysis"}})
    assert sorted(sx.calls) == [("SGLT2 heart failure randomized controlled trial", 1),
                                ("SGLT2 heart failure randomized controlled trial", 2)]
    assert epmc.trial_calls == [("SGLT2 heart failure", 25)]
    assert [c["doi"] for c in out["candidates"]] == ["10.1/s", "10.1/dapa"]
    q = out["quality"][0]
    assert q["pages"] == 2 and q["trial_queries"] == 1 and q["trial_hits"] == 1


async def test_slr_search_is_unchanged_and_trial_failures_are_soft():
    sx = Searx({})
    epmc = Epmc(fail_trials=True)
    await make_search(gdeps(searxng=sx, europepmc=epmc))({"plan": {"queries": ["q"]}, "options": {}})
    assert sx.calls == [("q", 1)] and epmc.trial_calls == []
    out = await make_search(gdeps(searxng=Searx({}), europepmc=epmc))(
        {"plan": {"queries": ["metformin cancer"]}, "options": {"review_type": "meta_analysis"}})
    assert any("trial search failed" in e for e in out["errors"])


def test_direct_trial_hits_skip_the_lookup():
    from app.graph.nodes.retrieval import already_enriched
    assert already_enriched(Candidate(title="t", engines=["europe pmc"], abstract="a", abstract_source="europepmc"))


@respx.mock
async def test_search_trials_query_and_engine_name():
    route = respx.get("https://epmc.test/search").mock(return_value=httpx.Response(200, json={"resultList": {
        "result": [{"id": "1", "source": "MED", "pmid": "1", "title": "A trial.", "abstractText": ABSTRACT,
                    "pubYear": "2019", "pubTypeList": {"pubType": ["Randomized Controlled Trial"]}}]}}))
    http = HttpClient(timeout=5)
    try:
        hits = await EuropePmcClient(http, "https://epmc.test").search_trials('SGLT2 "heart" (failure)')
    finally:
        await http.aclose()
    params = route.calls[0].request.url.params
    assert params["query"] == '(SGLT2 heart failure) AND PUB_TYPE:"Randomized Controlled Trial" AND HAS_ABSTRACT:y'
    assert params["sort"] == "CITED desc"
    assert hits[0].engines == ["europe pmc"] and hits[0].abstract_source == "europepmc"


async def test_meta_planner_may_use_five_queries():
    plan = QueryPlan(queries=[f"query {i}" for i in range(7)], population="p", intervention_or_exposure="i",
                     comparator="c", outcomes=["o"], inclusion_criteria=["x"], exclusion_criteria=["y"])
    planner = FakeStructuredLLM("qwen", lambda s, u: plan)
    for rt, cap in (("meta_analysis", MAX_QUERIES_META), ("slr", MAX_QUERIES)):
        out = await make_plan_queries(gdeps(llms=llms(planner=planner)))(
            {"topic": "t", "english_topic": "t", "options": {"review_type": rt}})
        assert len(out["plan"]["queries"]) == cap
    assert MAX_QUERIES_META == 5 and "acronyms" in planner.calls[0][0]


# ---- I-10: two models, and escalation never re-asks a model that already answered -------------------
async def test_direct_escalation_skips_a_model_already_asked():
    same = FakeStructuredLLM("qwen", lambda s, u: TopicVerdict(allowed=True, reason="r", english_topic="t"))
    runner = HarnessRunner(escalation=lambda schema: same)
    first = FakeStructuredLLM("qwen", lambda s, u: None)
    assert await runner.escalate("s", "u", schema=TopicVerdict, reason="disagreement",
                                 already_asked=(first, None)) is None
    assert same.calls == []
    other = FakeStructuredLLM("gemini", lambda s, u: None)
    res = await runner.escalate("s", "u", schema=TopicVerdict, reason="disagreement", already_asked=(other,))
    assert res.ok and len(same.calls) == 1


def _screen(include):
    def respond(system, user):
        refs = re.findall(r"^\[(C\d+)\]", user, flags=re.MULTILINE)
        return ScreenBatch(decisions=[ScreenDecision(ref=r, relevance=50, include=include, reason="r") for r in refs])
    return respond


def _payload():
    cands = [Candidate(title=f"Paper {i}", doi=f"10.1/{i}", abstract="a").model_dump() for i in range(2)]
    return {"batch": cands, "plan": {}, "question": "Q?", "language": "en"}


async def test_same_model_second_vote_is_skipped():
    screener = FakeStructuredLLM("qwen", _screen(True))
    secondary = FakeStructuredLLM("qwen", _screen(False))
    out = await make_screen_batch(gdeps(llms=llms(screener=screener, screener_secondary=secondary)))(_payload())
    assert secondary.calls == [] and out["quality"][0]["second_vote"] == "same_model"


async def test_disagreement_escalation_never_goes_back_to_a_voter():
    screener = FakeStructuredLLM("qwen", _screen(True))
    secondary = FakeStructuredLLM("gemini", _screen(False))
    esc = FakeStructuredLLM("gemini", _screen(True))  # misconfigured: the escalation is the second voter
    out = await make_screen_batch(gdeps(llms=llms(screener=screener, screener_secondary=secondary,
                                                  escalation=lambda schema: esc)))(_payload())
    q = out["quality"][0]
    assert q["disagreements"] == 2 and q["escalated"] == 0 and esc.calls == []
    assert all(d["uncertain"] and d["include"] for d in out["screened"])  # kept for recall, flagged


# ---- I-15: scope discipline ------------------------------------------------------------------------
def test_refine_and_critique_do_not_ask_for_unrequested_safety():
    refine, critique = prompts.refine_system("slr"), prompts.critique_system("slr")
    assert "together cover\nbenefit, harm/safety" not in refine and "Does it cover safety/harm?" not in critique
    assert "only when the topic is a" in refine and "never add outcomes" in refine
    assert "never add new ones" in critique and "stay within the scope" in critique
    assert "already has that condition" in prompts.screen_system("slr")


# ---- I-17: deterministic pre-clustering --------------------------------------------------------------
@pytest.mark.parametrize(("a", "b"), [
    ("Incidence of colorectal cancer", "colorectal cancer incidence"),
    ("Hospitalisation for heart failure", "heart failure hospitalization"),
    ("Hypoglycaemia", "hypoglycemia"), ("Cardiovascular deaths", "cardiovascular death"),
    ("All-cause mortality", "all cause mortality"), ("Oedema", "edema")])
def test_outcome_key_joins_spelling_and_order_variants(a, b):
    assert outcome_key(a) == outcome_key(b)


@pytest.mark.parametrize(("a", "b"), [
    ("LDL cholesterol", "HDL cholesterol"), ("Systolic blood pressure", "Diastolic blood pressure"),
    ("Hyperglycemia", "Hypoglycemia"), ("Major bleeding", "Minor bleeding"), ("Sensitivity", "Specificity"),
    ("Mortality", "Cardiovascular mortality"), ("Cancer after diabetes", "Diabetes after cancer"),
    ("Type 1 diabetes", "Type 2 diabetes")])
def test_outcome_key_keeps_different_outcomes_apart(a, b):
    assert outcome_key(a) != outcome_key(b)


def test_precluster_and_expand():
    pairs = [("P1", "CRC incidence"), ("P2", "Incidence of CRC"), ("P3", "mortality"), ("P4", "crc incidence")]
    groups = precluster(pairs)
    assert groups == [[("P1", "CRC incidence"), ("P2", "Incidence of CRC"), ("P4", "crc incidence")],
                      [("P3", "mortality")]]
    llm = OutcomeClusters(clusters=[OutcomeCluster(canonical="Colorectal cancer incidence", members=[
        OutcomeMember(ref="P1", outcome="CRC incidence")]), OutcomeCluster(canonical="Mortality", members=[
            OutcomeMember(ref="P3", outcome="mortality")])])
    full = expand_clusters(llm, groups)
    assert [[(m.ref, m.outcome) for m in c.members] for c in full.clusters] == [groups[0], groups[1]]


def _card(outcome):
    return {"study_design": "cohort", "population": "adults", "sample_size": 100, "sample_size_quote": None,
            "intervention_or_exposure": "metformin", "comparator": "none",
            "outcomes": [{"outcome": outcome, "result": "lower", "evidence_quote": "q", "effect_size": None,
                          "effect_measure": "HR", "effect_value": 0.8, "ci_lower": 0.7, "ci_upper": 0.9,
                          "p_value": None, "direction": "positive"}],
            "key_findings": [], "limitations": [], "funding_or_conflicts": None, "risk_of_bias": "low",
            "overall_direction": "positive"}


def _papers(names):
    return [{"ref": f"P{i + 1}", "candidate": Candidate(title=f"Paper {i}", doi=f"10.1/{i}").model_dump(),
             "relevance": 90, "card": _card(n), "error": None, "verification": {}} for i, n in enumerate(names)]


async def test_normalizer_sees_one_pair_per_precluster():
    names = ["CRC incidence"] * 6 + ["Incidence of CRC"] * 4 + ["All-cause mortality", "all cause mortality"]
    seen = []

    def respond(system, user):
        seen.append(user)
        reps = re.findall(r'"ref": "(P\d+)", "outcome": "([^"]+)"', user)
        return OutcomeClusters(clusters=[OutcomeCluster(canonical=o.title(), members=[OutcomeMember(ref=r, outcome=o)])
                                         for r, o in reps])
    out = await make_normalize_outcomes(gdeps(llms=llms(normalizer=FakeStructuredLLM("qwen", respond))))(
        {"topic": "t", "papers": _papers(names), "language": "en"})
    q = out["quality"][0]
    assert q["pairs"] == 12 and q["sent"] == 2 and q["fallback"] is False
    assert sorted(len(r["cells"]) for r in out["matrix"]["rows"]) == [2, 10]


# ---- I-16: Thai consensus/conflict templates rendered in code -----------------------------------------
MATRIX = {
    "rows": [{"outcome": "CRC incidence", "cells": []}, {"outcome": "Mortality", "cells": []}],
    "consensus": [{"outcome": "CRC incidence", "verdict": "consensus", "direction": "positive",
                   "refs": ["P1", "P2", "P3"], "dissent": {"null": ["P4"]}, "nonsignificant": ["P3"],
                   "corroborating": ["P5"]}],
    "conflicts": [{"outcome": "Mortality", "refs": ["P1", "P2"],
                   "directions": {"positive": ["P1"], "negative": ["P2"]}}],
}


def _synthesis():
    consensus, conflicts = _clusters(MATRIX, [])
    return {"executive_summary": "Summary [P1].", "evidence_rationale": "", "research_gaps": [],
            "comparison": MATRIX["rows"], "consensus": [c.model_dump() for c in consensus],
            "conflicts": [c.model_dump() for c in conflicts], "evidence_strength": "low"}


def test_consensus_and_conflict_templates_have_fixed_thai():
    synthesis = _synthesis()
    templated = _templated(synthesis, MATRIX)
    assert set(templated) == {"consensus.0.statement", "consensus.0.explanation", "conflicts.0.statement",
                              "conflicts.0.explanation"}
    th = _render_th(templated, {"CRC incidence": "อุบัติการณ์มะเร็งลำไส้ใหญ่", "Mortality": "อัตราการเสียชีวิต"})
    assert th["consensus.0.statement"] == "อุบัติการณ์มะเร็งลำไส้ใหญ่: ผลการศึกษาสนับสนุนผลตามที่ตั้งสมมติฐานไว้"
    assert th["consensus.0.explanation"].startswith("การศึกษา 3 จาก 4 เรื่องรายงานผลไปในทิศทางเดียวกันสำหรับอุบัติการณ์")
    assert "[P4] ไม่พบความสัมพันธ์อย่างมีนัยสำคัญทางสถิติ" in th["consensus.0.explanation"]
    assert "[P3] ชี้ไปในทิศทางเดียวกันแต่ไม่มีนัยสำคัญทางสถิติ" in th["consensus.0.explanation"]
    assert "การทบทวนวรรณกรรมอย่างเป็นระบบ [P5] ให้ผลสอดคล้องกัน" in th["consensus.0.explanation"]
    assert th["conflicts.0.statement"] == "อัตราการเสียชีวิต: ผลการศึกษาไม่สอดคล้องกัน"
    assert th["conflicts.0.explanation"] == ("การศึกษารายงานทิศทางของผลแตกต่างกันสำหรับอัตราการเสียชีวิต "
                                             "(สนับสนุนผลที่คาดไว้: [P1]; ทางตรงข้ามหรือผลเสีย: [P2])")
    # an English outcome name keeps a space after "สำหรับ"
    assert "สำหรับ CRC incidence" in _render_th(templated, {})["consensus.0.explanation"]


def test_llm_written_conflict_explanations_are_still_translated():
    synthesis = _synthesis()
    synthesis["conflicts"][0]["explanation"] = "Populations differ [P1, P2]."
    assert "conflicts.0.explanation" not in _templated(synthesis, MATRIX)


async def test_localize_sends_only_non_template_text_to_the_model():
    sent = []

    def thai(system, user):
        items = [{"id": i, "text": t} for i, t in re.findall(r'"id": "([^"]+)", "text": "([^"]*)"', user)]
        sent.extend(i["id"] for i in items)
        return TranslationBatch(items=[TranslationItem(id=i["id"], text="ไทย " + i["text"]) for i in items])
    out = await make_localize(gdeps(llms=llms(localizer=FakeStructuredLLM("qwen", thai))))(
        {"topic": "t", "language": "th", "papers": [], "synthesis": _synthesis(), "matrix": MATRIX})
    assert not any(k.startswith(("consensus.", "conflicts.")) for k in sent)
    d = out["synthesis_display"]
    assert d["consensus"][0]["statement"].startswith("ไทย CRC incidence: ผลการศึกษาสนับสนุน")
    assert out["quality"][0]["templated"] == 4


# ---- I-21: relevance floor ---------------------------------------------------------------------------
def _screened(rels, uncertain=()):
    cands = [Candidate(title=f"Paper {i}", doi=f"10.1/{i}", abstract="a").model_dump() for i in range(len(rels))]
    screened = [{"key": c["key"], "relevance": r, "include": True, "reason": "r", "design": "cohort",
                 "exclusion_reason": None, "uncertain": i in uncertain} for i, (c, r) in enumerate(zip(cands, rels,
                                                                                                       strict=True))]
    return {"candidates": cands, "screened": screened, "options": {"review_type": "slr"}}


async def test_low_relevance_includes_are_dropped_unless_disputed():
    out = await make_select_top(gdeps())(_screened([90, 80, 70, 10, 40], uncertain={4}))
    assert sorted(p["relevance"] for p in out["selected"]) == [40, 70, 80, 90]
    assert out["selection_stats"]["low_relevance"] == 1 and MIN_INCLUDE_RELEVANCE == 50


async def test_relevance_floor_never_empties_the_review():
    out = await make_select_top(gdeps())(_screened([90, 20, 10]))
    assert len(out["selected"]) == 3 and "low_relevance" not in out["selection_stats"]


# ---- I-19: masking keeps the user's dashes (fixed in Task 1; pinned here) --------------------------------
def test_mask_unverified_keeps_dashes():
    from decimal import Decimal

    from app.harness.verify import _mask_unverified
    allowed = {Decimal("0.80"), Decimal("0.71"), Decimal("0.90")}
    assert _mask_unverified("HR 0.80 (0.71–0.90), 5–10 y", allowed) == \
        "HR 0.80 (0.71–0.90), [unverified]–[unverified] y"


# ---- I-23: "T2DM" spelled out in Thai -----------------------------------------------------------------
def test_thai_spelled_out_diabetes_type_is_accepted():
    assert numbers_preserved("adults with T2DM (n = 1,234)", "ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 (n = 1,234)")
    assert numbers_preserved("T1D and T2D", "เบาหวานชนิดที่ 1 และชนิดที่ 2")


@pytest.mark.parametrize("translated", [
    "ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 1",  # changed type
    "ผู้ใหญ่ที่เป็นเบาหวาน 2",  # a "2" not spelled as the type
    "ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 และชนิดที่ 2",  # added twice for one abbreviation
])
def test_other_added_numbers_still_fail(translated):
    assert not numbers_preserved("adults with T2DM", translated)


def test_a_dropped_number_still_fails_next_to_a_spelled_type():
    assert not numbers_preserved("T2DM, HR 0.80", "เบาหวานชนิดที่ 2 HR")
