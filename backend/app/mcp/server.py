"""MCP server (/mcp, streamable HTTP, stateless): thin adapter over the same service layer as REST."""
from __future__ import annotations

import asyncio
import time
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
from app.db.models import TERMINAL_STATUSES
from app.runtime import AppDeps
from app.schemas.review import (
    QUICK_CANDIDATE_LIMIT,
    QUICK_MAX_PAPERS,
    CreateReviewRequest,
    ReviewOptions,
)
from app.services.report import quick_view, render_markdown
from app.services.review_service import Identity, RateLimited, Refused, ServiceError, Unavailable
from app.services.safety import refusal_code_of, shown_topic

_MIN_PAPERS, _MAX_PAPERS = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
_DEFAULT_PAPERS = ReviewOptions.model_fields["max_papers"].default
_POOL = ReviewOptions.model_fields["candidate_limit"].default
_QUICK_PAPERS, _QUICK_POOL = QUICK_MAX_PAPERS, QUICK_CANDIDATE_LIMIT

INSTRUCTIONS = f"""Medical literature review agent (abstracts only). It turns a topic or question into a structured
question (PICO, or PCC for scoping reviews), searches PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv,
DOAJ and OpenAIRE through its own SearXNG, screens about {_POOL} candidates that have abstracts and analyses the
abstracts of the {_MIN_PAPERS}-{_MAX_PAPERS} most relevant (default {_DEFAULT_PAPERS}); every number shown is checked
against the abstract, and numbers that fail are blanked.
Review types: slr (default), meta_analysis (adds labelled, system-computed pooled estimates), scoping, narrative.
Reports include a comparison matrix, a literature matrix, a concept map and, when metadata is available, a citation
network between the reviewed papers (OpenAlex / Europe PMC reference lists).
Typical flow: start_review(topic) → poll get_review_status every ~10 seconds until the status is terminal: done, error,
rejected or cancelled (done usually takes 1-3 minutes) → on done call get_review_result (or read
review://{{id}}/report.md); on error/rejected/cancelled read the error field (a rejected review also has a refusal_code:
personal_medical for a question about one person's own symptoms, diagnosis, dose or treatment, declined otherwise).
A topic that reads as an emergency is not started: start_review returns status "refused" with code "emergency", the
hotlines (1669, and 1323 for self-harm) and a fixed message to pass on. For a short referenced answer instead of a
report, call quick_answer(topic) (Plan 27: about {_QUICK_PAPERS} studies read, a 2-4 sentence answer with numbered
references, usually about a minute; it waits for the answer). search_papers answers quick literature
questions without starting a review. When the service is busy, start_review fails with a reason (queue_full,
daily_reviews, daily_budget) and how many seconds to wait. Results are a rapid, automated review of published
papers, not medical advice."""

START_REVIEW_DOC = f"""Start a literature review of a topic or question (e.g. "metformin and colorectal cancer", up to 600 characters).
The agent refines the question, screens about {_POOL} papers that have abstracts, analyses the abstracts of the
{_MIN_PAPERS}-{_MAX_PAPERS} most relevant (`max_papers`, default {_DEFAULT_PAPERS}; values outside the range
are clamped into it) and compares their findings.
`review_type` picks the kind of review:
- "slr" (default): systematic review, PICO question, PRISMA flow and an evidence-strength grade.
- "narrative": thematic overview across study types including narrative reviews; no evidence grade.
- "scoping": maps what research exists (types, years) with a PCC question; no quality or effect judgement.
- "meta_analysis": a systematic review plus DerSimonian-Laird random-effects pools of the verified effect
  estimates (result.meta_analysis); pooled numbers are computed by the system, not reported by any study.
`mode` "quick" (Plan 27) asks for a quick answer instead: about {_QUICK_POOL} candidates, the {_QUICK_PAPERS} most relevant
read, and a 2-4 sentence answer with numbered references (result.mode "quick"); review_type and max_papers are then
set by the service. "full" (default) is the review described above.
`study_types` (optional) limits the designs: RCT, Cohort, Case-control, Cross-sectional, Non-randomized trial,
Qualitative, Mixed methods (qualitative/mixed are summarised as themes, never with numbers), Systematic
review, Meta-analysis, or one "Other: <text>" (60 characters). `year_from` keeps studies from that year on.
Returns review_id, status, cached
and status_url; or, for a topic that reads as an emergency, status "refused" with code "emergency", kind, hotlines,
message and message_th (no review is created). The same topic, language and options within 24 hours (or still running) return that review
(cached=true). Fails with a reason and a wait time when the service is busy."""

QUICK_WAIT_DEFAULT, QUICK_WAIT_MAX, QUICK_POLL_SECONDS = 60, 90, 2.0
_sleep = asyncio.sleep  # replaced in tests

QUICK_ANSWER_DOC = f"""Ask a quick question (Plan 27, "ถามเร็ว"; e.g. "does metformin lower colorectal cancer risk?",
up to 600 characters) and get a short, referenced answer. The agent screens about {_QUICK_POOL} candidates with
abstracts, reads the {_QUICK_PAPERS} most relevant, and writes 2-4 sentences, each citing the studies it rests on,
then one line on the certainty (computed) and the main limitation. It waits up to `wait_seconds` (0-{QUICK_WAIT_MAX},
default {QUICK_WAIT_DEFAULT}) for the answer. Returns review_id, status, cached and status_url; when done also
`answer` (the [1]..[n] numbers point into `references`), `closing`, `certainty`, `papers_read` and `references`
(n, ref, citation, links to PubMed, DOI, PubMed Central or ThaiJO). When still running, poll get_review_status and
call get_review_result. It counts as one review against the same limits as start_review. `study_types` and `year_from`
work as in start_review. A topic that reads as an emergency returns status "refused" as in start_review. Not
medical advice."""



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
        rate = (await deps.service.effective()).paper_search_rate_limit
        decision = await deps.limits.hit("papers", ident.rate_key, rate)
        if not decision.allowed:
            raise _error(RateLimited(decision.retry_after))

    @mcp.tool()
    async def search_papers(query: str, ctx: Context, limit: int = 10) -> dict[str, Any]:
        """Search published biomedical papers (the SearXNG engines the service has on: by default PubMed, Europe PMC,
        OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE; Europe PMC also supplies curated metadata). Returns title, up to 6 authors, year, journal, DOI/PMID/PMCID, open-access flag and the abstract
        (first 600 characters). `limit` is clamped into 1-25; shares the paper-search rate limit with REST."""
        await papers_limit(await identity(ctx))
        try:
            deps = get_deps()
            found = await deps.papers.search(query, max(1, min(limit, 25)),
                                             engines=(await deps.service.sources()).engines)
            return {"query": query, "papers": [_paper(c) for c in found]}
        except ServiceError as exc:
            raise _error(exc) from exc

    @mcp.tool(description=START_REVIEW_DOC)
    async def start_review(topic: str, ctx: Context, language: Literal["th", "en"] = "th",
                           max_papers: int = _DEFAULT_PAPERS,
                           review_type: Literal["narrative", "slr", "scoping", "meta_analysis"] = "slr",
                           study_types: list[str] | None = None, year_from: int | None = None,
                           mode: Literal["full", "quick"] = "full") -> dict[str, Any]:
        return await create(topic, ctx, language, {"max_papers": max_papers, "review_type": review_type,
                                                   "study_types": study_types or [], "year_from": year_from,
                                                   "mode": mode})

    async def create(topic: str, ctx: Context, language: str, options: dict[str, Any]) -> dict[str, Any]:
        try:
            req = CreateReviewRequest(topic=topic, language=language, options=ReviewOptions.clamped(options))
            created = await get_deps().service.create(req, identity=await identity(ctx), human_check=False)
        except Refused as exc:  # Plan 26: an emergency gets the hotlines, not a review
            return {"review_id": None, "status": "refused", "message": exc.detail, **exc.body()}
        except (ServiceError, ValueError) as exc:
            raise _error(exc) from exc
        rid = str(created.review_id)
        return {"review_id": rid, "status": created.status, "cached": created.cached,
                "status_url": f"{settings.public_base_url.rstrip('/')}/api/v1/reviews/{rid}"}

    @mcp.tool(description=QUICK_ANSWER_DOC)
    async def quick_answer(topic: str, ctx: Context, language: Literal["th", "en"] = "th",
                           study_types: list[str] | None = None, year_from: int | None = None,
                           wait_seconds: int = QUICK_WAIT_DEFAULT) -> dict[str, Any]:
        started = await create(topic, ctx, language, {"mode": "quick", "study_types": study_types or [],
                                                      "year_from": year_from})
        if started["review_id"] is None:  # refused (an emergency): nothing to wait for
            return started
        rid = uuid.UUID(started["review_id"])
        deadline = time.monotonic() + max(0, min(wait_seconds, QUICK_WAIT_MAX))
        review = await get_deps().service.get(rid)
        while review is not None and review.status not in TERMINAL_STATUSES and time.monotonic() < deadline:
            await _sleep(QUICK_POLL_SECONDS)
            review = await get_deps().service.get(rid)
        if review is None:
            raise ToolError(f"review {rid} not found")
        out = {**started, "status": review.status}
        if review.status == "done" and review.result:
            return out | quick_view(review.result)
        if review.status in TERMINAL_STATUSES:
            return out | {"error": review.error, "refusal_code": refusal_code_of(review.status, review.error)}
        return out | {"message": "still running; poll get_review_status, then call get_review_result"}

    @mcp.tool()
    async def get_review_status(review_id: str) -> dict[str, Any]:
        """Status of a review: queued, running, done, error, rejected or cancelled. A rejected review has a
        refusal_code: personal_medical (a question about one person's own case) or declined."""
        r = await review_or_error(review_id)
        return {"review_id": review_id, "status": r.status, "error": r.error,
                "refusal_code": refusal_code_of(r.status, r.error),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None}

    @mcp.tool()
    async def get_review_result(review_id: str) -> dict[str, Any]:
        """Full result of a finished review: refined question, summary, comparison table, consensus, conflicts,
        evidence strength, per-paper extractions and quality metrics (plus meta_analysis for a meta-analysis)."""
        r = await review_or_error(review_id)
        if r.result is None:
            message = ("review is still in progress; poll get_review_status" if r.status in ("queued", "running")
                       else f"review ended with status {r.status}")
            return {"review_id": review_id, "status": r.status, "result": None, "message": message,
                    "error": r.error, "refusal_code": refusal_code_of(r.status, r.error)}
        return {"review_id": review_id, "status": r.status, "result": r.result}

    @mcp.resource("review://{review_id}", mime_type="application/json", description="Review status and result")
    async def review_resource(review_id: str) -> dict[str, Any]:
        r = await review_or_error(review_id)
        return {"review_id": review_id, "topic": shown_topic(r.status, r.error, r.topic), "status": r.status,
                "result": r.result, "error": r.error, "refusal_code": refusal_code_of(r.status, r.error)}

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
