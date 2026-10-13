from app.config import Settings
from app.graph.schemas import Candidate
from app.services.dedupe import merge_candidates
from app.services.europepmc import EuropePmcClient

ART = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001"
ABSTRACT = ("Background: a synthetic abstract written for tests. Methods: a cross-sectional survey of 120 adults "
            "in a district hospital. Results: adherence was 71.5%. Conclusion: support programmes are needed.")


def test_thaijo_is_on_by_default_and_faster_than_the_other_sources(monkeypatch):
    monkeypatch.delenv("THAIJO_ENABLED", raising=False)  # conftest pins it off for the suite
    s = Settings(_env_file=None)
    assert s.thaijo_enabled is True and s.thaijo_url == "https://www.tci-thaijo.org/api/v1"
    assert s.thaijo_max_candidates == 15 and s.thaijo_cache_ttl_seconds == 7 * 86400
    assert s.thaijo_timeout_seconds < s.searxng_timeout_seconds
    assert s.thaijo_request_timeout_seconds < min(s.openalex_timeout_seconds, EuropePmcClient.TRIAL_TIMEOUT)
    monkeypatch.setenv("THAIJO_ENABLED", "false")
    assert Settings(_env_file=None).thaijo_enabled is False


def test_a_thaijo_record_keeps_its_page_link_when_merged_with_a_search_hit():
    hit = Candidate(title="Medication adherence among older adults with hypertension in a district hospital",
                    abstract=ABSTRACT[:90], abstract_source="snippet", doi="10.9999/demo.1",
                    url="https://doi.org/10.9999/demo.1", engines=["crossref"])
    thai = Candidate(title="Medication Adherence among Older Adults with Hypertension in a District Hospital.",
                     abstract=ABSTRACT, abstract_source="thaijo", year=2024, url=ART, thaijo_url=ART,
                     engines=["thaijo"])
    (merged,) = merge_candidates([hit, thai])
    assert merged.thaijo_url == ART and merged.url == "https://doi.org/10.9999/demo.1"  # first hit's url stays
    assert merged.abstract == ABSTRACT and merged.abstract_source == "thaijo"  # beats the snippet
    assert merged.engines == ["crossref", "thaijo"] and merged.pdf_url is None


def test_candidates_from_other_sources_carry_no_thaijo_link():
    assert Candidate(title="x").thaijo_url is None


def test_an_old_candidate_without_thaijo_url_still_loads():
    old = Candidate(title="x").model_dump()
    old.pop("thaijo_url")
    assert Candidate.model_validate(old).thaijo_url is None


def test_europe_pmc_abstract_beats_thaijos_in_a_merge():
    epmc = Candidate(title="Medication adherence among older adults with hypertension in a district hospital",
                     abstract=ABSTRACT + " (Europe PMC)", abstract_source="europepmc", doi="10.9999/demo.1",
                     engines=["europe pmc"])
    thai = Candidate(title="Medication Adherence among Older Adults with Hypertension in a District Hospital.",
                     abstract=ABSTRACT, abstract_source="thaijo", year=2024, url=ART, thaijo_url=ART,
                     engines=["thaijo"])
    (merged,) = merge_candidates([thai, epmc])
    assert merged.abstract == ABSTRACT + " (Europe PMC)" and merged.abstract_source == "europepmc"
    assert merged.thaijo_url == ART
