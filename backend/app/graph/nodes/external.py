"""Optional: consult operator-configured external MCP tools (e.g. an institutional database) once per review,
in parallel with paper reading. Plan-then-call: the model proposes ≤ N calls from the tool catalogue (validated
in code), the calls run with a timeout, and results become data for the narrative — never instructions."""
from __future__ import annotations

import asyncio
import json
import time
from contextlib import AsyncExitStack
from typing import Any

from app.graph import prompts
from app.graph.nodes.intake import harness_runner
from app.graph.progress import progress_writer
from app.graph.schemas import ToolPlan
from app.services.llm import LLMError

MAX_RESULT_CHARS = 4000
ERROR_PREFIX = "Error executing tool"


def _schema(tool) -> dict[str, Any]:
    schema = tool.args_schema if isinstance(tool.args_schema, dict) else tool.args_schema.model_json_schema()
    return {k: v for k, v in schema.items() if k in ("type", "properties", "required")}


def _catalogue(tools) -> list[dict[str, Any]]:
    return [{"tool": t.name, "description": (t.description or "")[:500], "arguments_schema": _schema(t)}
            for t in tools]


def _arguments(call) -> dict[str, Any] | None:
    try:
        args = json.loads(call.arguments_json or "{}")
    except json.JSONDecodeError:
        return None
    return args if isinstance(args, dict) else None


def _plan_problems(plan: ToolPlan, tools: dict[str, Any], max_calls: int) -> list[str]:
    problems = [f"at most {max_calls} calls are allowed"] if len(plan.calls) > max_calls else []
    for call in plan.calls:
        tool = tools.get(call.tool)
        if tool is None:
            problems.append(f"unknown tool {call.tool} (available: {', '.join(tools)})")
            continue
        args = _arguments(call)
        if args is None:
            problems.append(f"{call.tool}: arguments_json must be a JSON object")
            continue
        schema = _schema(tool)
        props = schema.get("properties") or {}
        problems += [f"{call.tool}: missing required argument {r}" for r in schema.get("required", []) if r not in args]
        problems += [f"{call.tool}: unknown argument {k}" for k in args if props and k not in props]
    return problems


def _text(content: Any) -> str:
    if isinstance(content, list):
        return "\n".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    return str(content)


async def _invoke(tool, args: dict[str, Any], timeout: float) -> dict[str, Any]:
    entry: dict[str, Any] = {"tool": tool.name, "arguments": args, "ok": False}
    try:
        text = _text(await asyncio.wait_for(tool.ainvoke(args), timeout=timeout))
    except TimeoutError:
        entry["error"] = f"timed out after {timeout:g} s"
        return entry
    except Exception as exc:  # noqa: BLE001 - an external tool can fail in any way; the review continues
        entry["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        return entry
    if text.startswith(ERROR_PREFIX):
        entry["error"] = text[:300]
        return entry
    entry |= {"ok": True, "text": text[:MAX_RESULT_CHARS], "truncated": len(text) > MAX_RESULT_CHARS}
    return entry


def make_external_enrich(deps):
    async def external_enrich(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        settings = deps.settings
        quality: dict[str, Any] = {"stage": "external", "calls": 0, "failed": 0, "repaired": False}
        registry, llm = deps.mcp, getattr(deps.llms, "enricher", None) or deps.llms.planner
        if registry is None or not registry.enabled:
            return {}
        progress_writer()({"type": "external_lookup"})
        context: list[dict[str, Any]] = []
        errors: list[str] = []
        cost = 0.0
        try:
            async with AsyncExitStack() as stack:
                # A server that accepts the connection but never answers must not stall the review.
                tools = await asyncio.wait_for(stack.enter_async_context(registry.tools()),
                                               timeout=settings.mcp_session_timeout_seconds)
                by_name = {t.name: t for t in tools}
                if by_name:
                    res = await harness_runner(deps).call(
                        llm, prompts.EXTERNAL_SYSTEM,
                        prompts.external_user(question=payload["question"], catalogue=_catalogue(tools),
                                              max_calls=settings.mcp_max_calls),
                        schema=ToolPlan, validate=lambda p: _plan_problems(p, by_name, settings.mcp_max_calls),
                        trigger="external")
                    cost += res.cost
                    quality["repaired"] = res.repaired
                    calls = [] if res.value is None else [
                        c for c in res.value.calls[: settings.mcp_max_calls]
                        if not _plan_problems(ToolPlan(rationale="", calls=[c]), by_name, settings.mcp_max_calls)]
                    context = list(await asyncio.gather(*(
                        _invoke(by_name[c.tool], _arguments(c), settings.mcp_call_timeout_seconds) for c in calls)))
        except LLMError as exc:
            errors.append(f"external tool planning failed: {type(exc).__name__}")
        except Exception as exc:  # noqa: BLE001 - unreachable servers, bad config, protocol errors
            errors.append(f"external tools unavailable: {type(exc).__name__}: {str(exc)[:200]}")
        quality |= {"calls": len(context), "failed": sum(1 for e in context if not e["ok"]),
                    "seconds": round(time.perf_counter() - started, 3)}
        return {"external_context": context, "cost_usd": cost, "errors": errors, "quality": [quality]}

    return external_enrich
