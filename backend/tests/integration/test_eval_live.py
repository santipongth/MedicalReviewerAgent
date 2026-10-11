import pytest

from app.config import get_settings
from app.evals import models
from app.evals.batch import run_all
from app.evals.freeze import freeze_all
from app.evals.models import Manifest, ManifestEntry, Stratum
from app.graph.factory import build_graph_deps
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient


@pytest.mark.integration
@pytest.mark.asyncio
async def test_one_review_freezes_and_replays_live(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    settings = get_settings()
    http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    try:
        deps = build_graph_deps(settings, http)
        deps.openalex, deps.mcp = None, None
        m = Manifest(
            seed=1,
            strata=[Stratum(name="cv", query="x")],
            reviews=[
                ManifestEntry(
                    id="CDLIVE",
                    stratum="cv",
                    title="live",
                    question="In adults with hypertension, do SGLT2 inhibitors "
                    "compared with placebo reduce cardiovascular death?",
                    primary_outcome="cardiovascular death",
                    search_date="2023-12-31",
                    year_to=2023,
                    checked_by_owner=True,
                )
            ],
        )
        engines = [e.strip() for e in settings.searxng_engines.split(",") if e.strip()]
        [fx] = await freeze_all(deps, m, ids=None, force=True, git_sha="live", engines=engines)
        assert fx.status == "ok" and fx.candidates
        assert all(c.get("year") is None or c["year"] <= 2023 for c in fx.candidates)
        s = await run_all(deps, m, run_id="live", repeats=1, max_usd=1.0, ids=None, git_sha="live")
        print(f"LIVE candidates={len(fx.candidates)} done={s.done} failed={s.failed} spent={s.spent}")
        assert s.done == 1 and s.spent < 1.0
    finally:
        await http.aclose()
