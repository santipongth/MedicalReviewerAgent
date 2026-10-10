from app.graph.schemas import OutcomeCluster, OutcomeClusters, OutcomeMember
from app.harness.grade import grade_baseline
from app.harness.matrix import build_matrix, fallback_clusters, validate_clusters


def paper(ref, outcomes, design="cohort", n=1000, rob="moderate"):
    return {"ref": ref, "card": {
        "study_design": design, "sample_size": n, "risk_of_bias": rob, "overall_direction": outcomes[0][1],
        "outcomes": [{"outcome": name, "result": f"{name} result in {ref}", "direction": d, "effect_measure": "HR",
                      "effect_value": v, "ci_lower": None, "ci_upper": None, "evidence_quote": "q",
                      "effect_size": None, "p_value": None} for name, d, v in outcomes]}}


PAPERS = [
    paper("P1", [("CRC incidence", "positive", 0.8), ("mortality", "null", 0.97)]),
    paper("P2", [("colorectal cancer risk", "positive", 0.7)], design="RCT", rob="low"),
    paper("P3", [("CRC incidence", "negative", 1.3)], n=200, rob="high"),
]
CLUSTERS = OutcomeClusters(clusters=[
    OutcomeCluster(canonical="Colorectal cancer incidence", members=[
        OutcomeMember(ref="P1", outcome="CRC incidence"), OutcomeMember(ref="P2", outcome="colorectal cancer risk"),
        OutcomeMember(ref="P3", outcome="CRC incidence")]),
    OutcomeCluster(canonical="All-cause mortality", members=[OutcomeMember(ref="P1", outcome="mortality")]),
])


def test_validate_clusters_requires_each_outcome_exactly_once():
    assert validate_clusters(CLUSTERS, PAPERS) == []
    missing = OutcomeClusters(clusters=CLUSTERS.clusters[:1])
    assert any("P1: mortality" in p for p in validate_clusters(missing, PAPERS))
    dup = OutcomeClusters(clusters=[*CLUSTERS.clusters, OutcomeCluster(canonical="x", members=[
        OutcomeMember(ref="P2", outcome="colorectal cancer risk")])])
    assert any("more than once" in p for p in validate_clusters(dup, PAPERS))
    ghost = OutcomeClusters(clusters=[*CLUSTERS.clusters, OutcomeCluster(canonical="y", members=[
        OutcomeMember(ref="P7", outcome="ghost")])])
    assert any("P7" in p for p in validate_clusters(ghost, PAPERS))


def test_build_matrix_is_deterministic_with_consensus_and_conflicts():
    m1 = build_matrix(PAPERS, CLUSTERS)
    m2 = build_matrix(list(reversed(PAPERS)), CLUSTERS)
    assert m1 == m2
    rows = {r["outcome"]: r for r in m1["rows"]}
    crc = rows["Colorectal cancer incidence"]
    assert [c["ref"] for c in crc["cells"]] == ["P1", "P2", "P3"]
    assert crc["cells"][1]["effect_value"] == 0.7 and crc["cells"][1]["finding"].endswith("in P2")
    assert [c["outcome"] for c in m1["conflicts"]] == ["Colorectal cancer incidence"]
    assert m1["conflicts"][0]["refs"] == ["P1", "P2", "P3"]
    assert m1["conflicts"][0]["directions"] == {"positive": ["P1", "P2"], "negative": ["P3"]}
    assert m1["consensus"] == []  # single-paper rows are not consensus


def test_consensus_needs_two_papers_same_direction():
    agreeing = [paper("P1", [("CRC", "positive", 0.8)]), paper("P2", [("CRC", "positive", 0.7)])]
    clusters = fallback_clusters(agreeing)
    m = build_matrix(agreeing, clusters)
    assert m["consensus"] == [{"outcome": "CRC", "direction": "positive", "refs": ["P1", "P2"], "dissent": {},
                               "nonsignificant": [], "corroborating": [], "discordant_reviews": []}]
    assert m["conflicts"] == []


def test_fallback_clusters_group_by_normalized_name():
    clusters = fallback_clusters(PAPERS)
    names = sorted(c.canonical for c in clusters.clusters)
    assert names == ["CRC incidence", "colorectal cancer risk", "mortality"]
    assert validate_clusters(clusters, PAPERS) == []


def test_grade_baseline():
    m = build_matrix(PAPERS, CLUSTERS)
    g = grade_baseline(PAPERS, m)
    # GRADE rates from the best design with evidence on the primary outcome (methodology review #4): the one RCT
    # (P2) starts high and is the graded body; the conflicting cohorts are reported, not graded
    assert g["level"] == "high"
    assert g["factors"][0].startswith("start high: randomized evidence for the primary outcome Colorectal cancer "
                                      "incidence: 1 randomized trial(s)")
    assert any(f.startswith("inconsistency not assessable: one study") for f in g["factors"])
    # observational only: start "low"; a significant study on each side (a conflict) → "very_low"
    cohorts = [p for p in PAPERS if p["ref"] != "P2"]
    g = grade_baseline(cohorts, build_matrix(cohorts, fallback_clusters(cohorts)))
    assert g["level"] == "very_low" and any(f.startswith("inconsistency:") for f in g["factors"])
    agreeing = [p for p in cohorts if p["ref"] != "P3"]
    assert grade_baseline(agreeing, build_matrix(agreeing, fallback_clusters(agreeing)))["level"] == "low"
    rcts = [paper(f"P{i}", [("CRC", "positive", 0.8)], design="randomized controlled trial", rob="low", n=5000)
            for i in range(1, 4)]
    assert grade_baseline(rcts, build_matrix(rcts, fallback_clusters(rcts)))["level"] == "high"
    assert grade_baseline([], build_matrix([], fallback_clusters([])))["level"] == "very_low"


def _row(directions, values=None):
    """One outcome row; a direction's HR is 0.8 for positive, 1.25 for negative, and `values` overrides it (None:
    no estimate)."""
    default = {"positive": 0.8, "negative": 1.25, "null": None}
    values = values or [default[d] for d in directions]
    papers = [paper(f"P{i + 1}", [("CRC", d, v)]) for i, (d, v) in enumerate(zip(directions, values, strict=True))]
    return papers, build_matrix(papers, fallback_clusters(papers))


def test_a_small_dissenting_minority_does_not_break_consensus():
    papers, m = _row(["positive"] * 9 + ["negative"])
    assert m["conflicts"] == []
    [c] = m["consensus"]
    assert c["direction"] == "positive" and c["refs"] == [f"P{i}" for i in range(1, 10)]
    assert c["dissent"] == {"negative": ["P10"]}
    g = grade_baseline(papers, m)
    assert not any(f.startswith("inconsistency") for f in g["factors"])  # not downgraded...
    assert any(f.startswith("minor inconsistency") for f in g["factors"])  # ...but reported
    _, nulls = _row(["positive"] * 9 + ["null"])  # a null without an estimate is dissent "no significant association"
    assert nulls["consensus"][0]["dissent"] == {"null": ["P10"]}


def test_real_splits_are_still_conflicts():
    assert _row(["positive"] * 3 + ["negative"] * 2)[1]["conflicts"][0]["outcome"] == "CRC"
    assert _row(["positive", "negative"])[1]["conflicts"] and not _row(["positive", "negative"])[1]["consensus"]
    two_agree = _row(["positive", "positive"])[1]
    assert two_agree["consensus"][0]["refs"] == ["P1", "P2"] and two_agree["conflicts"] == []


def test_significant_vs_non_significant_on_the_same_side_is_not_a_conflict():
    # audit I-11: one underpowered null study used to make a conflict and a GRADE downgrade
    _, m = _row(["positive", "null"], [0.8, 0.9])  # HR 0.9, not significant, same side as the HR 0.8 benefit
    assert m["conflicts"] == []
    assert m["consensus"][0]["refs"] == ["P1", "P2"] and m["consensus"][0]["nonsignificant"] == ["P2"]
    _, unknown = _row(["positive", "positive", "null"])  # no estimate: no side, 67 % < 70 %: imprecision only
    assert unknown["conflicts"] == [] and unknown["consensus"] == []
    assert unknown["imprecise"][0]["directions"] == {"positive": ["P1", "P2"], "null": ["P3"]}


def test_a_non_significant_estimate_on_the_other_side_is_not_a_conflict():
    # methodology review #1/#6: a conflict needs a significant study on each side, or CIs that do not overlap
    _, m = _row(["positive", "null"], [0.8, 1.2])  # opposite sides, P2 not significant
    assert m["conflicts"] == []
    assert m["imprecise"][0]["opposite_sides"] is True
    assert m["imprecise"][0]["directions"] == {"positive": ["P1"], "negative": ["P2"], "null": []}
    _, both_null = _row(["null", "null"], [0.9, 1.1])  # two non-significant estimates: consistent with no effect
    assert both_null["conflicts"] == [] and both_null["consensus"][0]["direction"] == "null"
    _, both = _row(["positive", "negative"], [0.8, 1.25])  # a significant study on each side
    assert both["conflicts"][0]["refs"] == ["P1", "P2"]


def test_non_overlapping_cis_make_a_conflict_even_without_significance_on_one_side():
    papers = [paper("P1", [("CRC", "positive", 0.6)]), paper("P2", [("CRC", "null", 1.3)])]
    papers[0]["card"]["outcomes"][0] |= {"ci_lower": 0.5, "ci_upper": 0.7}
    papers[1]["card"]["outcomes"][0] |= {"ci_lower": 0.95, "ci_upper": 1.8}
    m = build_matrix(papers, fallback_clusters(papers))
    assert m["conflicts"][0]["nonsignificant"] == ["P2"]
    papers[1]["card"]["outcomes"][0] |= {"ci_lower": 0.65, "ci_upper": 2.6}  # overlapping CIs: imprecision
    assert build_matrix(papers, fallback_clusters(papers))["conflicts"] == []


def test_pooled_cells_corroborate_and_are_not_counted_twice():
    sr = _pooled("P1", "negative")  # an SR on the other side never makes a conflict with its own primary studies
    agree = _pooled("P4")
    papers = [sr, agree, paper("P2", [("CRC", "positive", 0.8)]), paper("P3", [("CRC", "positive", 0.7)])]
    m = build_matrix(papers, fallback_clusters(papers))
    assert m["conflicts"] == []
    [c] = m["consensus"]
    assert c["refs"] == ["P2", "P3"] and c["corroborating"] == ["P4"]
    only_reviews = [_pooled("P1"), _pooled("P2", "negative")]
    only_reviews[1]["card"]["outcomes"][0]["effect_value"] = 1.3
    assert build_matrix(only_reviews, fallback_clusters(only_reviews))["conflicts"]  # no primary study: they count


def test_directionless_matrix_has_no_claims_and_no_placeholder_rows():
    papers = [paper("P1", [("Research gaps", "null", None), ("Settings", "null", None)]),
              paper("P2", [("Research gaps", "null", None)])]
    papers[0]["card"]["outcomes"][1]["result"] = "null"  # a literal placeholder finding
    m = build_matrix(papers, fallback_clusters(papers), directional=False)
    assert m["consensus"] == [] and m["conflicts"] == [] and m["imprecise"] == []
    assert [r["outcome"] for r in m["rows"]] == ["Research gaps"]  # the placeholder-only row is gone
    assert {c["direction"] for r in m["rows"] for c in r["cells"]} == {"unclear"}
    directional = build_matrix(papers, fallback_clusters(papers))
    assert directional["consensus"][0]["outcome"] == "Research gaps"  # what scoping used to emit


def _pooled(ref, direction="positive"):
    p = paper(ref, [("CRC", direction, 0.8)], n=None)
    p["card"]["design_category"] = "sr_ma_rct"
    return p


def test_cells_say_which_studies_are_pooled():
    papers = [_pooled("P1"), paper("P2", [("CRC", "positive", 0.7)])]
    m = build_matrix(papers, fallback_clusters(papers))
    cells = {c["ref"]: c for c in m["rows"][0]["cells"]}
    assert cells["P1"]["pooled"] is True and cells["P2"]["pooled"] is False
    assert cells["P1"]["design_category"] == "sr_ma_rct"


def test_grade_starts_from_pooled_evidence_and_flags_overlap():
    papers = [_pooled("P1"), _pooled("P2")] + [paper(f"P{i}", [("CRC", "positive", 0.8)]) for i in range(3, 6)]
    m = build_matrix(papers, fallback_clusters(papers))
    g = grade_baseline(papers, m)
    # the 2 SR/MAs of RCTs set the tier and are the body; their n is not reported, and the cohorts' 3,000
    # participants never make randomized evidence precise (methodology review #3)
    assert g["level"] == "moderate"
    assert g["factors"][0] == ("start high: randomized evidence for the primary outcome CRC: 0 randomized trial(s), "
                               "2 systematic review(s)/meta-analysis(es) of randomized trials; 3 non-randomized "
                               "stud(ies) reported, not graded")
    assert "imprecision: sample sizes for the primary outcome CRC not reported in the abstracts" in g["factors"]
    primary_only = [paper(f"P{i}", [("CRC", "positive", 0.8)]) for i in range(1, 4)]
    g2 = grade_baseline(primary_only, build_matrix(primary_only, fallback_clusters(primary_only)))
    assert g2["level"] == "low" and not any("pooled" in f for f in g2["factors"])  # unchanged without SR/MA


def test_a_missing_pooled_sample_size_never_raises_the_grade():
    def review(sr_n):
        sr = _pooled("P1")
        sr["card"]["sample_size"] = sr_n
        rcts = [paper(f"P{i}", [("CRC", "positive", 0.8)], design="RCT", n=60) for i in range(2, 7)]
        for p in rcts:
            p["card"]["design_category"] = "rct"
        papers = [sr] + rcts
        return grade_baseline(papers, build_matrix(papers, fallback_clusters(papers)))

    reported_small, unreported = review(350), review(None)
    assert reported_small["level"] == "moderate"
    order = ("very_low", "low", "moderate", "high")
    assert order.index(unreported["level"]) <= order.index(reported_small["level"])
    assert any("primary" in f and "300" in f for f in unreported["factors"])  # judged from the primary studies' n


def test_pooled_only_evidence_without_any_sample_size_is_imprecise_and_says_so():
    papers = [_pooled("P1"), _pooled("P2")]
    g = grade_baseline(papers, build_matrix(papers, fallback_clusters(papers)))
    assert g["level"] == "moderate"
    assert any("not reported" in f for f in g["factors"])
    assert not any("0 primary" in f for f in g["factors"])
