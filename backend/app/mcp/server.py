"""MCP server (/mcp, streamable HTTP, stateless): thin adapter over the same service layer as REST."""
from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any, Literal

from fastapi import HTTPException
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings

from app import __version__
from app.api.auth import identity_from
from app.api.ratelimit import ip_from
from app.config import Settings
from app.runtime import AppDeps
from app.schemas.review import CreateReviewRequest, ReviewOptions
from app.services.report import render_markdown
from app.services.review_service import Identity, RateLimited, ServiceError, Unavailable

INSTRUCTIONS = """Medical literature review agent. It refines the question, screens about 60 candidate papers that have
abstracts and analyses the abstracts of the best 5-30 (default 30); every number shown is checked against the abstract.
Typical flow: start_review(topic) → poll get_review_status every ~10 seconds until the status is terminal: done, error,
rejected or cancelled (done usually takes 1-3 minutes) → on done call get_review_result (or read
review://{id}/report.md); on error/rejected/cancelled read the error field. search_papers answers quick literature
questions without starting a review. When the service is busy, start_review fails with a reason (queue_full,
daily_reviews, daily_budget) and how many seconds to wait. Results are a rapid, automated review of published
papers, not medical advice."""


def _error(exc: Exception) -> ToolError:
    if isinstance(exc, RateLimited):
        return ToolError(f"{exc.detail}; retry after {exc.retry_after} seconds")
    if isinstance(exc, Unavailable):
        return ToolError(f"{exc.detail} ({exc.reason}); retry after {exc.retry_after} seconds")
    if isinstance(exc, ServiceError):
        return ToolError(exc.detail)
    if isinstance(exc, HTTPException):
        return ToolError(str(exc.detail))
    return ToolError(str(exc))


def _uuid(review_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(review_id)
    except ValueError as exc:
        raise ToolError("review_id must be a UUID returned by start_review") from exc


def _paper(c) -> dict[str, Any]:
    abstract = (c.abstract or "")[:600]
    return {"title": c.title, "authors": c.authors[:6], "year": c.year, "journal": c.journal, "doi": c.doi,
            "pmid": c.pmid, "pmcid": c.pmcid, "url": c.url, "is_open_access": c.is_open_access,
            "abstract": abstract + ("…" if c.abstract and len(c.abstract) > 600 else "")}


def transport_security(settings: Settings) -> TransportSecuritySettings:
    if settings.mcp_allowed_hosts == ["*"]:
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)
    origins = [o for h in settings.mcp_allowed_hosts for o in (f"http://{h}", f"https://{h}")]
    return TransportSecuritySettings(allowed_hosts=settings.mcp_allowed_hosts, allowed_origins=origins)


def build_mcp(get_deps: Callable[[], AppDeps], settings: Settings) -> MCPServer:
    mcp = MCPServer("medical-reviewer-agent", title="Medical Reviewer Agent", instructions=INSTRUCTIONS,
                    version=__version__, website_url=settings.public_base_url)

    async def identity(ctx: Context) -> Identity:
        request = getattr(ctx.request_context, "request", None)
        peer = request.client.host if request is not None and request.client else "mcp-local"
        headers = request.headers if request is not None else {}
        ip = ip_from(headers.get("x-forwarded-for"), peer, settings.trust_proxy)
        try:
            return await identity_from(headers, ip, get_deps())
        except HTTPException as exc:
            raise _error(exc) from exc

    async def review_or_error(review_id: str):
        review = await get_deps().service.get(_uuid(review_id))
        if review is None:
            raise ToolError(f"review {review_id} not found")
        return review

    async def papers_limit(ident: Identity) -> None:
        deps = get_deps()
        decision = await deps.limits.hit("papers", ident.rate_key, settings.paper_search_rate_limit)
        if not decision.allowed:
            raise _error(RateLimited(decision.retry_after))

    @mcp.tool()
    async def search_papers(query: str, ctx: Context, limit: int = 10) -> dict[str, Any]:
        """Search published biomedical papers (PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ,
        OpenAIRE; Europe PMC also supplies curated metadata). Returns title, up to 6 authors, year, journal, DOI/PMID/PMCID, open-access flag and the abstract
        (first 600 characters). `limit` is clamped into 1-25; shares the paper-search rate limit with REST."""
        await papers_limit(await identity(ctx))
        try:
            found = await get_deps().papers.search(query, max(1, min(limit, 25)))
            return {"query": query, "papers": [_paper(c) for c in found]}
        except ServiceError as exc:
            raise _error(exc) from exc

    @mcp.tool()
    async def start_review(topic: str, ctx: Context, language: Literal["th", "en"] = "th",
                           max_papers: int = 30,
                           review_type: Literal["narrative", "slr", "scoping"] = "slr") -> dict[str, Any]:
        """Start a literature review of a disease, drug or chemical (e.g. "metformin and colorectal cancer").
        The agent refines the question, screens ~60 papers that have abstracts, analyses the abstracts of the best
        `max_papers` (clamped into 5-30, default 30) and compares their findings.
        `review_type` picks the kind of review:
        - "slr" (default): systematic review, PICO question, PRISMA flow and an evidence-strength grade.
        - "narrative": thematic overview across study types including narrative reviews; no evidence grade.
        - "scoping": maps what research exists (types, years) with a PCC question; no quality or effect judgement.
        Returns review_id, status, cached
        and status_url. The same topic, language and options within 24 hours (or still running) return that review
        (cached=true). Fails with a reason and a wait time when the service is busy."""
        try:
            req = CreateReviewRequest(topic=topic, language=language,
                                      options=ReviewOptions.clamped({"max_papers": max_papers,
                                                                             "review_type": review_type}))
            created = await get_deps().service.create(req, identity=await identity(ctx), human_check=False)
        except (ServiceError, ValueError) as exc:
            raise _error(exc) from exc
        rid = str(created.review_id)
        return {"review_id": rid, "status": created.status, "cached": created.cached,
                "status_url": f"{settings.public_base_url.rstrip('/')}/api/v1/reviews/{rid}"}

    @mcp.tool()
    async def get_review_status(review_id: str) -> dict[str, Any]:
        """Status of a review: queued, running, done, error, rejected or cancelled."""
        r = await review_or_error(review_id)
        return {"review_id": review_id, "status": r.status, "error": r.error,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None}

    @mcp.tool()
    async def get_review_result(review_id: str) -> dict[str, Any]:
        """Full result of a finished review: refined question, summary, comparison table, consensus, conflicts,
        evidence strength, per-paper extractions and quality metrics."""
        r = await review_or_error(review_id)
        if r.result is None:
            message = ("review is still in progress; poll get_review_status" if r.status in ("queued", "running")
                       else f"review ended with status {r.status}")
            return {"review_id": review_id, "status": r.status, "result": None, "message": message,
                    "error": r.error}
        return {"review_id": review_id, "status": r.status, "result": r.result}

    @mcp.resource("review://{review_id}", mime_type="application/json", description="Review status and result")
    async def review_resource(review_id: str) -> dict[str, Any]:
        r = await review_or_error(review_id)
        return {"review_id": review_id, "topic": r.topic, "status": r.status, "result": r.result, "error": r.error}

    @mcp.resource("review://{review_id}/report.md", mime_type="text/markdown",
                  description="Review as a Markdown report")
    async def review_report(review_id: str) -> str:
        return render_markdown(await review_or_error(review_id))

    @mcp.prompt()
    def literature_review(topic: str) -> str:
        """Run an evidence review of a medical topic with this server's tools."""
        return (f"Review the published evidence on: {topic}\n"
                "1. Call start_review with this topic (language 'en' unless the user wants Thai).\n"
                "2. Poll get_review_status every ~10 seconds until the status is done, error, rejected or "
                "cancelled (done usually takes 1-3 minutes); on anything but done, report the error field.\n"
                "3. Call get_review_result and present the refined question, the summary, the comparison of "
                "findings (agreements and conflicts with their likely reasons), the evidence strength and the "
                "papers with links. Mention papers flagged uncertain. This is not medical advice.")

    return mcp
