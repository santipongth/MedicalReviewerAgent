from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_cost import TYPICAL_CALLS, estimate_review_cost
from app.services.model_catalog import CATALOG_KEY, ModelInfo, cached_catalog, catalog_rows
from tests.llm_helpers import MINIMAL

CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs", "tools"}))
SMART = ModelInfo("vendor/smart", 200_000, 3e-6, 1.5e-5, frozenset({"structured_outputs", "reasoning"}))
CATALOG = {m.id: m for m in (CHEAP, SMART)}


def test_estimate_sums_typical_calls_and_lists_unknown_models():
    resolved = resolve_llm_config(parse_llm_config(MINIMAL))  # cheap preset: every role on vendor/cheap
    est = estimate_review_cost(resolved, CATALOG)
    expected = sum(TYPICAL_CALLS[r][0] * CHEAP.cost(*TYPICAL_CALLS[r][1:]) for r in resolved.roles)
    assert est["total_usd"] == round(expected, 4) and est["unknown_models"] == []
    assert set(est["per_role"]) == set(resolved.roles)
    better = estimate_review_cost(resolve_llm_config(parse_llm_config(MINIMAL), "better"), CATALOG)
    assert better["total_usd"] == 0 and better["unknown_models"][0].endswith("vendor/better")


async def test_catalog_is_cached_in_redis_for_an_hour(redis):
    calls = []

    async def load():
        calls.append(1)
        return CATALOG

    first = await cached_catalog(redis, load)
    second = await cached_catalog(redis, load)
    assert first == second == CATALOG and calls == [1]
    assert 3590 <= await redis.ttl(CATALOG_KEY) <= 3600


async def test_a_failed_fetch_returns_none(redis):
    async def load():
        raise OSError("offline")

    assert await cached_catalog(redis, load) is None


def test_catalog_rows_filter_and_shape():
    rows = catalog_rows(CATALOG, structured=True)
    assert [r["id"] for r in rows] == ["vendor/cheap", "vendor/smart"]
    assert rows[0] == {"id": "vendor/cheap", "context_length": 100_000, "price_in_per_m": 0.1,
                       "price_out_per_m": 0.4, "structured": True, "tools": True, "reasoning": False}
    assert [r["id"] for r in catalog_rows(CATALOG, reasoning=True)] == ["vendor/smart"]
    assert [r["id"] for r in catalog_rows(CATALOG, q="SMA")] == ["vendor/smart"]
    assert [r["id"] for r in catalog_rows(CATALOG, max_price=1.0)] == ["vendor/cheap"]
    assert len(catalog_rows(CATALOG, limit=1)) == 1
