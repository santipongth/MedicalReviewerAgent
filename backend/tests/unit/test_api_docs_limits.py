"""docs/api.md must show the same paper-count limits as /status (single source: ReviewOptions)."""
import json
import re
from pathlib import Path

from app.schemas.review import ReviewOptions

API_MD = Path(__file__).resolve().parents[3] / "docs" / "api.md"


def _status_example() -> dict:
    text = API_MD.read_text(encoding="utf-8")
    section = text[text.index("### `GET /api/v1/status`"):]
    return json.loads(re.search(r"```json\n(.*?)\n```", section, re.DOTALL).group(1))


def _bounds(name: str) -> dict:
    return {"min": ReviewOptions.bound(name, "ge"), "max": ReviewOptions.bound(name, "le"),
            "default": ReviewOptions.model_fields[name].default}


def test_status_example_matches_review_option_bounds():
    limits = _status_example()["limits"]
    for name in ("max_papers", "candidate_limit"):
        assert limits[name] == _bounds(name)


async def test_status_limits_match_the_documented_ones(app):
    live = (await app.state.deps.service.status())["limits"]
    for name in ("max_papers", "candidate_limit"):
        assert live[name] == _status_example()["limits"][name]


def test_openapi_description_uses_the_review_option_bounds(app):
    text = app.openapi()["info"]["description"]
    pool = ReviewOptions.model_fields["candidate_limit"].default
    lo, hi = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
    assert str(pool) in text and f"{lo}-{hi}" in text
    assert "about 60" not in text and "/reviews/{id}/events" in text and "<built-in" not in text


def test_docs_have_no_stale_paper_counts():
    text = API_MD.read_text(encoding="utf-8")
    assert not re.search(r"~60|about 60|5[-–]30\b", text)


def test_status_example_lists_the_quick_limits():
    # Plan 27: the documented quick sizes are the service's own
    from app.schemas.review import (
        QUICK_CANDIDATE_LIMIT,
        QUICK_MAX_PAPERS,
        QUICK_REVIEW_TYPE,
        REVIEW_MODES,
    )
    limits = _status_example()["limits"]
    assert limits["modes"] == list(REVIEW_MODES)
    assert limits["quick"] == {"max_papers": QUICK_MAX_PAPERS, "candidate_limit": QUICK_CANDIDATE_LIMIT,
                               "review_type": QUICK_REVIEW_TYPE}


def test_status_example_lists_the_sources_in_catalog_order():
    # Plan 23d: the documented default (eight engines and ThaiJO) is the service's own catalog
    from app.services.sources import BY_ID, SOURCE_IDS
    sources = _status_example()["sources"]
    assert [s["id"] for s in sources] == list(SOURCE_IDS)
    assert all(s["label"] == BY_ID[s["id"]].label for s in sources)


def test_the_docs_name_the_current_prompt_version():
    from app.config import Settings
    assert f"prompt_version {Settings(_env_file=None).prompt_version}`" in API_MD.read_text(encoding="utf-8")
