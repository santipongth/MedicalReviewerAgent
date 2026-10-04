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
    assert m["consensus"] == [{"outcome": "CRC", "direction": "positive", "refs": ["P1", "P2"]}]
    assert m["conflicts"] == []


def test_fallback_clusters_group_by_normalized_name():
    clusters = fallback_clusters(PAPERS)
    names = sorted(c.canonical for c in clusters.clusters)
    assert names == ["CRC incidence", "colorectal cancer risk", "mortality"]
    assert validate_clusters(clusters, PAPERS) == []


def test_grade_baseline():
    m = build_matrix(PAPERS, CLUSTERS)
    g = grade_baseline(PAPERS, m)
    assert g["level"] in {"high", "moderate", "low", "very_low"}
    # GRADE: mostly observational → start "low"; inconsistency (a conflicting outcome) → "very_low"
    assert g["level"] == "very_low" and any("inconsistency" in f for f in g["factors"])
    agreeing = [p for p in PAPERS if p["ref"] != "P3"]
    assert grade_baseline(agreeing, build_matrix(agreeing, fallback_clusters(agreeing)))["level"] == "low"
    rcts = [paper(f"P{i}", [("CRC", "positive", 0.8)], design="randomized controlled trial", rob="low", n=5000)
            for i in range(1, 4)]
    assert grade_baseline(rcts, build_matrix(rcts, fallback_clusters(rcts)))["level"] == "high"
    assert grade_baseline([], build_matrix([], fallback_clusters([])))["level"] == "very_low"
