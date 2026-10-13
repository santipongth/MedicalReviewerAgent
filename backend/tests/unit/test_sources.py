"""Plan 23d: the search-source catalog, the sources in force and the `sources` document kind."""
import json

import pytest
from sqlalchemy import select

from app.config import Settings
from app.db.models import AdminAudit
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import (
    DocumentError,
    publish,
    reset_to_seed,
    restore_version,
    save_version,
)
from app.services.sources import (
    SOURCE_IDS,
    cache_part,
    effective_sources,
    engine_fingerprint,
    env_defaults,
    env_extras,
    public_list,
)
from app.services.sources_store import (
    NO_SEARXNG,
    SOURCES_KEY,
    SOURCES_KIND,
    WARN_BIOMEDICAL,
    WARN_EUROPEPMC,
    WARN_THAIJO,
    summarize_sources,
    validate_sources,
)

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
ENV = Settings(_env_file=None)  # tests/conftest.py pins THAIJO_ENABLED=false
ENV_ON = Settings(_env_file=None, thaijo_enabled=True)
WITH_PLOS = Settings(_env_file=None, searxng_engines="pubmed,plos,europe pmc,openalex")


def test_the_catalog_holds_the_nine_sources_in_landing_order():
    assert SOURCE_IDS == ("pubmed", "europepmc", "openalex", "semantic_scholar", "crossref", "arxiv", "doaj",
                          "openaire", "thaijo")


def test_env_gives_each_source_its_default_and_keeps_the_extras():
    assert env_defaults(ENV) == {**dict.fromkeys(SOURCE_IDS, True), "thaijo": False}
    assert env_defaults(ENV_ON)["thaijo"] is True
    plos = env_defaults(WITH_PLOS)
    assert [i for i, on in plos.items() if on] == ["pubmed", "europepmc", "openalex"]
    assert env_extras(WITH_PLOS) == ["plos"] and env_extras(ENV) == []


def test_no_overrides_give_the_env_engines_string_exactly():
    for base in (ENV, ENV_ON, WITH_PLOS, Settings(_env_file=None, searxng_engines=" pubmed , arxiv")):
        active = effective_sources(base, {})
        assert active.engines == base.searxng_engines and active.version is None and active.label == "env"
        assert active.thaijo is base.thaijo_enabled and not active.fallback
    assert effective_sources(ENV, {"openaire": True}, 2).engines == ENV.searxng_engines  # equal to env: no change


def test_overrides_turn_sources_off_and_on_in_both_directions():
    off = effective_sources(ENV_ON, {"openaire": False, "thaijo": False}, 3)
    assert off.engines == "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj"
    assert "openaire" not in off.enabled and off.thaijo is False and off.label == "3"
    on = effective_sources(ENV, {"thaijo": True}, 1)  # console wins over THAIJO_ENABLED=false
    assert on.thaijo is True and on.enabled[-1] == "thaijo" and on.engines == ENV.searxng_engines
    mixed = effective_sources(WITH_PLOS, {"europepmc": False, "doaj": True, "crossref": True}, 4)
    assert mixed.engines == "pubmed,plos,openalex,crossref,doaj"  # env order (extras kept), then catalog order
    assert mixed.extras == ("plos",) and not mixed.has_europepmc and effective_sources(ENV, {}).has_europepmc


def test_entries_that_no_longer_validate_are_skipped():
    active = effective_sources(ENV, {"pubmed": False, "scopus": False, "arxiv": "no", "doaj": 0}, 5)
    assert active.enabled == tuple(i for i in SOURCE_IDS if i not in ("pubmed", "thaijo"))
    assert effective_sources(ENV, ["pubmed"], 5).engines == ENV.searxng_engines  # not a mapping: env


def test_a_set_with_no_searxng_source_falls_back_to_env_engines():
    only_pubmed = Settings(_env_file=None, searxng_engines="pubmed")
    active = effective_sources(only_pubmed, {"pubmed": False, "thaijo": True}, 2)
    assert active.fallback and active.engines == "pubmed" and active.enabled == ("pubmed", "thaijo")


def test_the_cache_part_keeps_today_s_key_until_a_version_exists():
    assert cache_part(effective_sources(ENV, {}), ENV) == ""
    assert cache_part(effective_sources(ENV_ON, {}), ENV_ON) == "+thaijo"
    # a version that changes nothing (a reset, or overrides env already agrees with) keeps the generation
    assert cache_part(effective_sources(ENV_ON, {}, 7), ENV_ON) == "+thaijo"
    # turning ThaiJO off in the console gives the key of turning it off in env
    assert cache_part(effective_sources(ENV_ON, {"thaijo": False}, 2), ENV_ON) == cache_part(effective_sources(ENV, {}), ENV)
    off = cache_part(effective_sources(ENV_ON, {"openaire": False}, 3), ENV_ON)
    assert off == "+thaijo+src" + engine_fingerprint("pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj")
    assert cache_part(effective_sources(ENV_ON, {"openaire": False}, 9), ENV_ON) == off  # restoring: same generation


def test_the_fingerprint_ignores_order_and_spacing():
    assert engine_fingerprint("arxiv, pubmed") == engine_fingerprint("pubmed,arxiv") != engine_fingerprint("pubmed")
    assert len(engine_fingerprint("pubmed")) == 8


def test_the_public_list_is_the_enabled_sources_then_the_extras():
    assert public_list(effective_sources(ENV_ON, {"crossref": False}, 1)) == [
        {"id": "pubmed", "label": "PubMed"}, {"id": "europepmc", "label": "Europe PMC"},
        {"id": "openalex", "label": "OpenAlex"}, {"id": "semantic_scholar", "label": "Semantic Scholar"},
        {"id": "arxiv", "label": "arXiv"}, {"id": "doaj", "label": "DOAJ"}, {"id": "openaire", "label": "OpenAIRE"},
        {"id": "thaijo", "label": "ThaiJO"}]
    extras = public_list(effective_sources(Settings(_env_file=None, searxng_engines="pubmed,plos,other"), {}))
    assert extras[-2:] == [{"id": "plos", "label": "PLOS"}, {"id": "other", "label": "other"}]


def test_validation_drops_entries_equal_to_env_and_warns():
    document, warnings = validate_sources({"sources": {"openaire": False, "pubmed": True, "thaijo": False}}, ENV)
    assert document == {"sources": {"openaire": False}} and warnings == []
    document, warnings = validate_sources({"sources": {"europepmc": False, "pubmed": False, "thaijo": True}}, ENV)
    assert document == {"sources": {"pubmed": False, "europepmc": False, "thaijo": True}}
    assert warnings == [WARN_BIOMEDICAL, WARN_EUROPEPMC, WARN_THAIJO]
    assert validate_sources({"sources": {"thaijo": True}}, ENV_ON) == ({"sources": {}}, [])
    assert validate_sources({}, ENV) == ({"sources": {}}, [])


def test_at_least_one_searxng_source_must_stay_on():
    all_off = dict.fromkeys(SOURCE_IDS[:-1], False)
    with pytest.raises(DocumentError) as exc:
        validate_sources({"sources": {**all_off, "thaijo": True}}, ENV)
    assert exc.value.errors == [{"field": "sources", "message": NO_SEARXNG}]
    assert validate_sources({"sources": {**all_off, "arxiv": True}}, ENV)[0]["sources"]["pubmed"] is False


def test_bad_documents_name_the_field_and_never_echo_what_was_sent():
    with pytest.raises(DocumentError) as exc:
        validate_sources({"sources": {"pubmed": "yes", "scopus\ud800": False, "other": True, "doaj": 1}}, ENV)
    assert exc.value.errors == [
        {"field": "sources.pubmed", "message": "sources.pubmed: must be true or false"},
        {"field": "sources", "message": "sources: unknown source"},
        {"field": "sources.doaj", "message": "sources.doaj: must be true or false"}]
    for raw in ({"sources": []}, {"values": {}}, {"sources": {}, "note": "x"}, ["pubmed"], None):
        with pytest.raises(DocumentError) as exc:
            validate_sources(raw, ENV)
        assert exc.value.errors[0]["field"] is None and "yes" not in exc.value.errors[0]["message"]


def test_the_summary_names_each_source_that_moved():
    assert summarize_sources({"sources": {"openaire": False}}, {"sources": {"thaijo": True}}) == {
        "openaire": "off → env", "thaijo": "env → on"}
    assert summarize_sources(None, {"sources": {}}) == {}


async def test_save_restore_and_reset_go_through_the_config_store_with_audit_rows(session_factory, redis):
    async with session_factory() as s, s.begin():
        v1 = await save_version(s, OWNER, SOURCES_KIND, {"sources": {"openaire": False, "pubmed": True}},
                                settings=ENV, base_version=None, note="openaire is slow")
    assert (v1.version, v1.document, v1.changes) == (1, {"sources": {"openaire": False}}, {"openaire": "env → off"})
    assert await publish(redis, SOURCES_KIND, v1)
    assert json.loads(await redis.get(SOURCES_KEY)) == {"version": 1, "sources": {"openaire": False}}
    async with session_factory() as s, s.begin():
        v2 = await reset_to_seed(s, OWNER, SOURCES_KIND, settings=ENV, base_version=1)
    async with session_factory() as s, s.begin():
        v3 = await restore_version(s, OWNER, SOURCES_KIND, 1, settings=ENV, base_version=2)
    assert (v2.document, v2.source, v3.document, v3.restored_from) == ({"sources": {}}, "reset",
                                                                     {"sources": {"openaire": False}}, 1)
    async with session_factory() as s:
        rows = (await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars().all()
    assert [(r.action, r.target_type, r.target_id) for r in rows] == [
        ("sources.save", "sources", "1"), ("sources.reset", "sources", "2"), ("sources.restore", "sources", "3")]
