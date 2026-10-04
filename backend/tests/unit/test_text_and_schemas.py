import pytest

from app.config import Settings
from app.graph.schemas import Candidate, PaperCard, candidate_key
from app.services.text import (
    arxiv_id_from_url,
    normalize_doi,
    normalize_title,
    pmid_from_url,
    strip_markup,
    truncate,
)


def test_strip_markup_removes_tags_entities_and_whitespace():
    raw = "<h4>Background</h4>Metformin &amp; radiation\n  <b>work</b>"
    assert strip_markup(raw) == "Background Metformin & radiation work"
    assert strip_markup(None) == ""


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("10.3390/Cancers18162537", "10.3390/cancers18162537"),
        ("https://doi.org/10.1186/S13046-019-1495-2", "10.1186/s13046-019-1495-2"),
        ("doi: 10.1/x", "10.1/x"),
        ("", None),
        ("not-a-doi", None),
        (None, None),
    ],
)
def test_normalize_doi(raw, expected):
    assert normalize_doi(raw) == expected


def test_ids_from_urls():
    assert pmid_from_url("https://www.ncbi.nlm.nih.gov/pubmed/42649852") == "42649852"
    assert pmid_from_url("https://pubmed.ncbi.nlm.nih.gov/39917927/") == "39917927"
    assert pmid_from_url("https://doi.org/10.1/x") is None
    assert arxiv_id_from_url("http://arxiv.org/abs/2402.09476v1") == "2402.09476"
    assert arxiv_id_from_url("https://arxiv.org/pdf/2509.04592v2") == "2509.04592"
    assert arxiv_id_from_url("https://example.org") is None


def test_normalize_title_and_truncate():
    assert normalize_title("Metformin & Colorectal-Cancer: A Review.") == "metformin colorectal cancer a review"
    assert truncate("one two three four", 9) == "one two …"
    assert truncate("short", 10) == "short"


def test_candidate_key_priority_and_auto_key():
    assert candidate_key(doi="10.1/a", pmid="1", arxiv_id=None, title="t") == "doi:10.1/a"
    assert candidate_key(doi=None, pmid="1", arxiv_id="2401.1", title="t") == "pmid:1"
    assert candidate_key(doi=None, pmid=None, arxiv_id="2401.1", title="t") == "arxiv:2401.1"
    k = candidate_key(doi=None, pmid=None, arxiv_id=None, title="Same Title!")
    assert k.startswith("title:") and k == candidate_key(doi=None, pmid=None, arxiv_id=None, title="same title")
    assert Candidate(title="X", doi="10.1/a").key == "doi:10.1/a"


def test_paper_card_schema_has_no_optional_keys_for_structured_output():
    schema = PaperCard.model_json_schema()
    assert set(schema["required"]) == set(schema["properties"])
    outcome = schema["$defs"]["OutcomeResult"]
    assert set(outcome["required"]) == set(outcome["properties"])
    assert {"effect_value", "ci_lower", "ci_upper", "p_value", "effect_measure"} <= set(outcome["properties"])


def test_new_settings_defaults():
    s = Settings(_env_file=None)
    assert s.llm_config_path == "config/llm.yaml" and s.llm_preset is None
    assert s.openrouter_api_key == "" and not hasattr(s, "synthesize_model")  # models live in llm.yaml
    assert s.searxng_engines == "pubmed,arxiv,semantic scholar,openalex,crossref"
    assert s.graph_mode == "real"
    assert s.crawl4ai_url == "http://crawl4ai:11235" and s.crawl_concurrency == 3
    assert s.crawl_domain_interval == 2.0 and s.crawl_cooldown_minutes == 15 and s.fulltext_cache_days == 30


def test_crawl4ai_token_reads_env_alias_and_init_kwarg(monkeypatch):
    monkeypatch.setenv("CRAWL4AI_API_TOKEN", "from-env")
    assert Settings(_env_file=None).crawl4ai_token == "from-env"
    assert Settings(_env_file=None, crawl4ai_token="kw").crawl4ai_token == "kw"
