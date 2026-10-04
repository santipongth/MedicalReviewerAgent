from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.auth import get_identity
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.graph.schemas import Candidate
from app.runtime import AppDeps
from app.services.review_service import Identity, RateLimited, ServiceError

router = APIRouter()


@router.get("/papers/search", response_model=list[Candidate],
            responses={429: {"description": "rate limit exceeded"}, 502: {"description": "search unavailable"}})
async def search_papers(q: str = Query(min_length=2, max_length=300), limit: int = Query(10, ge=1, le=25),
                        deps: AppDeps = Depends(get_deps), identity: Identity = Depends(get_identity)):
    """Literature search (SearXNG academic engines + Europe PMC metadata). No LLM involved."""
    try:
        decision = await deps.limits.hit("papers", identity.rate_key, deps.service.settings.paper_search_rate_limit)
        if not decision.allowed:
            raise RateLimited(decision.retry_after)
        return await deps.papers.search(q, limit)
    except ServiceError as exc:
        return service_error_response(exc)
