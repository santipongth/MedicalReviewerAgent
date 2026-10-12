import pytest

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


WRONG_SHAPE = '[{"id": "x", "context_length": 1, "price_in": 0, "price_out": 0, "supported_parameters": 5}]'


@pytest.mark.parametrize("garbage", ["not json", "5", '{"id": "vendor/cheap"}', '[{"id": "vendor/cheap"}]',
                                     "[1, 2]", WRONG_SHAPE, "[]", "{}"])
async def test_a_corrupt_or_empty_cached_catalog_is_a_miss_that_is_replaced(redis, garbage):
    await redis.set(CATALOG_KEY, garbage, ex=3600)
    calls = []

    async def load():
        calls.append(1)
        return CATALOG

    assert await cached_catalog(redis, load) == CATALOG and calls == [1]
    assert await cached_catalog(redis, load) == CATALOG and calls == [1]  # the live fetch replaced the bad entry


async def test_a_corrupt_cache_entry_is_deleted_even_when_the_live_fetch_fails(redis):
    await redis.set(CATALOG_KEY, "garbage", ex=3600)

    async def load():
        raise OSError("offline")

    assert await cached_catalog(redis, load) is None
    assert await redis.get(CATALOG_KEY) is None


async def test_an_empty_fetch_is_not_cached_and_counts_as_unavailable(redis):
    async def load():
        return {}

    assert await cached_catalog(redis, load) is None
    assert await redis.get(CATALOG_KEY) is None


async def test_a_redis_that_cannot_delete_does_not_stop_the_live_fetch():
    class BrokenRedis:
        async def get(self, _key):
            return "garbage"

        async def delete(self, _key):
            raise ConnectionError("down")

        async def set(self, *_a, **_k):
            raise ConnectionError("down")

    async def load():
        return CATALOG

    assert await cached_catalog(BrokenRedis(), load) == CATALOG
