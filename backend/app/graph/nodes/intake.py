from __future__ import annotations

from langgraph.graph import END

from app.graph import prompts
from app.graph.progress import progress_writer
from app.graph.state import ReviewState
from app.services.llm import LLMRefusal

MAX_QUERIES = 6


def route_after_guard(state: ReviewState) -> str:
    return END if state.get("rejected") else "plan_queries"


def make_topic_guard(deps):
    async def topic_guard(state: ReviewState) -> dict:
        progress_writer()({"type": "checking_topic"})
        try:
            res = await deps.llms.guard.ainvoke(prompts.GUARD_SYSTEM, prompts.guard_user(state["topic"]))
        except LLMRefusal:
            return {"rejected": "The topic was declined by the safety filter."}
        if not res.value.allowed:
            return {"rejected": res.value.reason or "The topic is not a biomedical research question.",
                    "cost_usd": res.cost_usd}
        return {"english_topic": res.value.english_topic or state["topic"], "cost_usd": res.cost_usd}

    return topic_guard


def make_plan_queries(deps):
    async def plan_queries(state: ReviewState) -> dict:
        res = await deps.llms.planner.ainvoke(
            prompts.PLAN_SYSTEM,
            prompts.plan_user(topic=state["topic"], english_topic=state.get("english_topic") or state["topic"],
                              options=state.get("options") or {}),
        )
        plan = res.value.model_dump()
        seen: dict[str, str] = {}
        for q in plan["queries"]:
            q = " ".join(q.split())
            if q and q.lower() not in seen:
                seen[q.lower()] = q
        plan["queries"] = list(seen.values())[:MAX_QUERIES]
        progress_writer()({"type": "planning", "queries": plan["queries"]})
        return {"plan": plan, "cost_usd": res.cost_usd}

    return plan_queries
