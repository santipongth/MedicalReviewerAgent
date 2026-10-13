"""Plan 25: the timed stub's result carries `support` in the engine's shape, so a stub review shows the badge."""
from app.graph.nodes.stub_result import _stub_abstract, stub_result
from app.harness import support as sp


def test_the_stub_result_carries_support_in_the_engine_shape():
    s = stub_result("x", "th", "slr")["support"]
    assert s["judge"] == "ok" and s["markers"] == [] and s["display_aligned"] is True
    first = s["claims"][0]
    assert (first["id"], first["where"], first["finding"]) == ("k0", "key_finding", 0)
    assert {c["label"] for c in first["citations"]} == {"supported", "partial", "unsupported"}
    shape = sp.claim_record(sp.finding_claims([{"statement": "s", "refs": ["P1"]}])[0], [], numbers_checked=True,
                            computed=False)
    assert set(first) == set(shape)
    assert set(first["citations"][0]) == {"ref", "label", "evidence", "score", "not_evidence", "verified"}


def test_every_review_type_shows_every_state_with_evidence_from_the_stub_abstract():
    for review_type in ("slr", "meta_analysis", "scoping", "narrative"):
        res = stub_result("x", "en", review_type)
        claims = res["support"]["claims"]
        assert [c["id"] for c in claims] == ["k0", "k1"], review_type
        abstracts = {p["ref"]: _stub_abstract(p) for p in res["papers"]}
        states = set()
        for claim in claims:
            for c in claim["citations"]:
                if c["evidence"] is not None:
                    assert c["evidence"] in abstracts[c["ref"]], (review_type, c)
                states.add((c["label"], claim["numbers_checked"]))
                assert c["verified"] == (c["label"] == "supported" and claim["numbers_checked"]), (review_type, c)
        assert states == {("supported", True), ("supported", False), ("partial", True), ("unsupported", True),
                          (None, False)}, review_type
        assert all("abstract" not in p and "abstract" not in p["card"] for p in res["papers"])
