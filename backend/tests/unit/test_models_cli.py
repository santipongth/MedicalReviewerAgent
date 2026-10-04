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
