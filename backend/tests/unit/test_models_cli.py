import io
import json
from pathlib import Path

from app.cli.models import main
from app.services.model_catalog import parse_models

FIX = Path(__file__).parent.parent / "fixtures"
REPO_CONFIG = str(Path(__file__).parents[2] / "config" / "llm.yaml")


async def _catalog():
    return parse_models(json.loads((FIX / "openrouter_models.json").read_text(encoding="utf-8")))


def run(argv):
    out = io.StringIO()
    code = main(argv, load_catalog=_catalog, out=out)
    return code, out.getvalue()


def test_list_filters_by_search_structured_and_price():
    code, text = run(["list", "--search", "deepseek", "--structured"])
    assert code == 0
    assert "deepseek/deepseek-v4-pro" in text and "deepseek/deepseek-r1" not in text  # r1 lacks strict SO
    assert "0.209" in text  # $/1M input, from the recorded catalog
    _, cheap = run(["list", "--max-price", "0.2"])
    assert "google/gemini-2.5-flash-lite" in cheap and "anthropic/claude-opus-5.5" not in cheap


def test_check_budget_preset_passes_and_estimates_cost():
    code, text = run(["check", "--config", REPO_CONFIG])
    assert code == 0, text
    assert "preset: budget" in text and "synthesizer" in text and "json_schema" in text
    assert "estimated cost per review" in text.lower()


def test_check_reports_problems_with_nonzero_exit(tmp_path):
    bad = Path(REPO_CONFIG).read_text(encoding="utf-8").replace(
        "overrides: {}", "overrides:\n  synthesizer: {model: vendor/does-not-exist}")
    p = tmp_path / "llm.yaml"
    p.write_text(bad, encoding="utf-8")
    code, text = run(["check", "--config", str(p)])
    assert code == 1 and "not found on OpenRouter" in text


def test_typical_calls_assume_60_candidates_and_30_abstracts():
    from app.cli.models import TYPICAL_CALLS
    from app.schemas.review import ReviewOptions
    papers = ReviewOptions.model_fields["max_papers"].default
    pool = ReviewOptions.model_fields["candidate_limit"].default
    assert TYPICAL_CALLS["extractor"] == (papers, 1200, 700) and TYPICAL_CALLS["extractor_secondary"][0] == papers
    assert TYPICAL_CALLS["screener"][0] == pool // 10  # the pool in batches of 10


def test_check_source_db_resolves_through_the_stored_version(monkeypatch):
    from app.cli import models
    from app.services.llm_config import parse_llm_config
    from app.services.llm_store import EffectiveConfig
    from tests.llm_helpers import MINIMAL

    async def fake_db_config(settings):
        return EffectiveConfig("db", 5, MINIMAL, parse_llm_config(MINIMAL), None)

    monkeypatch.setattr(models, "_db_config", fake_db_config)
    _, text = run(["check", "--source", "db"])
    assert "source: db:5" in text and "preset: cheap" in text and "vendor/cheap" in text
