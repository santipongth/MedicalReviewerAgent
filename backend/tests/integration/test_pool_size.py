"""Plan 21 Task 2: how full the candidate pool gets from the compose SearXNG (search + enrich with its top-up).

Run: MRA_INTEGRATION=1 uv run pytest -m integration tests/integration/test_pool_size.py -s
Only SearXNG is called: the Europe PMC lookup is a no-op, so the pool is a lower bound (in a real review the lookup
also adds abstracts to hits that came without one). The numbers are logged; the test asserts only 0 < pool <= 120.
"""
import dataclasses
import os

import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import make_enrich, make_search
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.searxng import SearxngClient

pytestmark = pytest.mark.integration

# Planner-style queries and key terms for three fixed topics: a drug, a screening test and a qualitative topic.
TOPICS = {
    "drug": (["SGLT2 inhibitors heart failure hospitalization randomized controlled trial",
              "empagliflozin dapagliflozin heart failure outcomes",
              "sodium-glucose cotransporter 2 inhibitors cardiovascular death heart failure",
              "SGLT2 inhibitor heart failure preserved ejection fraction"],
             [{"term": "SGLT2 inhibitors", "mesh": "Sodium-Glucose Transporter 2 Inhibitors",
               "synonyms": ["empagliflozin", "dapagliflozin", "gliflozins"]},
              {"term": "heart failure", "mesh": "Heart Failure", "synonyms": ["HFrEF", "HFpEF"]}]),
    "screening": (["low-dose computed tomography lung cancer screening mortality",
                   "LDCT screening lung cancer randomized trial",
                   "lung cancer screening false positive overdiagnosis",
                   "low-dose CT screening smokers diagnostic accuracy"],
                  [{"term": "low-dose computed tomography", "mesh": "Tomography, X-Ray Computed",
                    "synonyms": ["LDCT", "low-dose CT"]},
                   {"term": "lung cancer screening", "mesh": "Early Detection of Cancer",
                    "synonyms": ["lung neoplasms screening"]}]),
    "qualitative": (["patient experiences insulin initiation type 2 diabetes qualitative",
                     "psychological insulin resistance type 2 diabetes interview study",
                     "barriers to insulin therapy type 2 diabetes patients perspectives",
                     "insulin initiation primary care qualitative study"],
                    [{"term": "insulin initiation", "mesh": "Insulin", "synonyms": ["insulin therapy"]},
                     {"term": "patient experience", "mesh": "Qualitative Research",
                      "synonyms": ["perspectives", "qualitative study"]}]),
}


class NoLookup:
    async def lookup(self, *, dois, pmids, failures=None):
        return []


@pytest.fixture
async def deps():
    http = HttpClient(min_interval=DEFAULT_MIN_INTERVAL)
    settings = Settings(_env_file=None, searxng_url=os.environ.get("SEARXNG_URL", "http://localhost:8080"),
                        searxng_timeout_seconds=30.0)
    yield GraphDeps(settings=settings, europepmc=NoLookup(),
                    searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
                                          timeout=settings.searxng_timeout_seconds))
    await http.aclose()


async def test_pool_size_per_topic(deps):
    rows = []
    for name, (queries, key_terms) in TOPICS.items():
        state = {"topic": name, "plan": {"queries": queries}, "question": {"key_terms": key_terms},
                 "options": {"max_papers": 30, "candidate_limit": 120}}
        searched = await make_search(deps)(state)
        state |= {"candidates": searched["candidates"], "search_stats": searched["search_stats"]}
        # the pool page 1 alone gives (enrich without a search client never tops up; the lookup is a no-op)
        page_one = len((await make_enrich(dataclasses.replace(deps, searxng=None))(state))["candidates"])
        out = await make_enrich(deps)(state)
        q = out["quality"][0]
        pool = len(out["candidates"])
        rows.append((name, searched["search_stats"]["found"], out["search_stats"]["found"], page_one, pool,
                     q["topup_pages"], q["topup_found"], q.get("topup_new", 0), len(out["errors"])))
        assert 0 < pool <= 120, (name, pool)
    print("\ntopic | found p1 | found total | pool p1 | pool | topup_pages | topup_found | topup_new | errors")
    for r in rows:
        print(" | ".join(str(x) for x in r))
    print(f"share reaching 120: {sum(r[4] == 120 for r in rows)}/{len(rows)}")
