EXPECTED_ERRORS = {
    ("post", "/api/v1/reviews"): {"401", "403", "422", "429", "503"},
    ("get", "/api/v1/reviews"): {"422"},
    ("get", "/api/v1/reviews/{review_id}"): {"404", "422"},
    ("get", "/api/v1/reviews/{review_id}/events"): {"404", "429"},
    ("get", "/api/v1/reviews/{review_id}/export"): {"404", "409", "422"},
    ("delete", "/api/v1/reviews/{review_id}"): {"401", "403", "404", "409"},
    ("get", "/api/v1/papers/search"): {"401", "422", "429", "502"},
    ("get", "/api/v1/healthz"): {"503"},
    ("get", "/api/v1/status"): set(),
}


def test_every_route_is_described_and_declares_its_error_responses(app):
    spec = app.openapi()
    assert "abstract" in spec["info"]["description"] and "Retry-After" in spec["info"]["description"]
    from app import __version__
    assert spec["info"]["version"] == __version__  # the MCP server reports the same version (app.mcp.server)
    seen = set()
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            seen.add((method, path))
            assert op.get("summary") and op.get("description"), f"{method} {path} has no description"
            expected = EXPECTED_ERRORS.get((method, path))
            assert expected is not None, f"{method} {path} is not in the documented route list"
            missing = expected - set(op.get("responses", {}))
            assert not missing, f"{method} {path} does not declare {missing}"
    assert seen == set(EXPECTED_ERRORS)


def test_event_stream_and_export_media_types_are_declared(app):
    paths = app.openapi()["paths"]
    assert "text/event-stream" in paths["/api/v1/reviews/{review_id}/events"]["get"]["responses"]["200"]["content"]
    export = paths["/api/v1/reviews/{review_id}/export"]["get"]["responses"]["200"]["content"]
    assert {"text/markdown", "text/csv", "application/json"} <= set(export)
