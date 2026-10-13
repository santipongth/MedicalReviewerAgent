"""Plan 25: the timed stub's result carries `support` in the engine's shape, so a stub review shows the badge."""
from app.graph.nodes.stub_result import stub_result
from app.harness import support as sp


def test_the_stub_result_carries_support_in_the_engine_shape():
    s = stub_result("x", "th", "slr")["support"]
    assert s["judge"] == "ok" and s["markers"] == [] and s["display_aligned"] is True
    first = s["claims"][0]
    assert (first["id"], first["where"], first["finding"]) == ("k0", "key_finding", 0)
    assert {c["label"] for c in first["citations"]} == {"supported", "partial", "unsupported"}
    assert all(c["verified"] == (c["label"] == "supported") for claim in s["claims"] for c in claim["citations"])
    shape = sp.claim_record(sp.finding_claims([{"statement": "s", "refs": ["P1"]}])[0], [], numbers_checked=True,
                            computed=False)
    assert set(first) == set(shape)
    assert set(first["citations"][0]) == {"ref", "label", "evidence", "score", "not_evidence", "verified"}


def test_every_review_type_has_stub_support():
    for review_type in ("slr", "meta_analysis", "scoping", "narrative"):
        claims = stub_result("x", "en", review_type)["support"]["claims"]
        assert [c["id"] for c in claims] == ["k0", "k1"], review_type
