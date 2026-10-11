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


def test_docs_have_no_stale_paper_counts():
    text = API_MD.read_text(encoding="utf-8")
    assert not re.search(r"~60|about 60|5[-–]30\b", text)
