from __future__ import annotations

import time
from typing import Any

from langgraph.graph import END

from app.graph import prompts
from app.graph.progress import progress_writer
from app.graph.schemas import QuestionCritique, ReviewQuestion
from app.graph.state import ReviewState
from app.harness.localize import localize_strings
from app.harness.question import question_problems
from app.harness.runner import HarnessRunner
from app.services.llm import LLMRefusal
from app.services.llm_config import HarnessSpec

MAX_QUERIES = 4


def harness_spec(deps) -> HarnessSpec:
    return getattr(deps.llms, "harness", None) or HarnessSpec()


def harness_runner(deps) -> HarnessRunner:
    spec = harness_spec(deps)
    return HarnessRunner(max_repairs=spec.max_repairs, escalation=getattr(deps.llms, "escalation", None),
                         escalate_on=spec.escalate_on)


def review_question(state: ReviewState) -> str:
    """The question every later stage answers: the refined question, else the guard's English topic."""
    question = state.get("question") or {}
    return question.get("refined_question") or state.get("english_topic") or state["topic"]


def route_after_guard(state: ReviewState) -> str:
    return END if state.get("rejected") else "refine_question"


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


async def _localized_display(deps, runner: HarnessRunner, q: ReviewQuestion, language: str) -> tuple[dict, float]:
    strings: dict[str, str] = {"interpretation": q.interpretation, "refined_question": q.refined_question}
    strings |= {f"sub_questions.{i}": s for i, s in enumerate(q.sub_questions)}
    strings |= {f"assumptions.{i}": s for i, s in enumerate(q.assumptions)}
    cost = 0.0
    if harness_spec(deps).localize:
        strings, _, cost = await localize_strings(getattr(deps.llms, "localizer", None), runner, strings, language)
    display: dict[str, Any] = {
        "interpretation": strings["interpretation"], "refined_question": strings["refined_question"],
        "sub_questions": [strings[f"sub_questions.{i}"] for i in range(len(q.sub_questions))],
        "assumptions": [strings[f"assumptions.{i}"] for i in range(len(q.assumptions))],
    }
    return display, cost


def make_refine_question(deps):
    async def refine_question(state: ReviewState) -> dict:
        started = time.perf_counter()
        writer = progress_writer()
        refiner = getattr(deps.llms, "refiner", None)
        if refiner is None:
            return {"question": None, "quality": [{"stage": "refine", "skipped": True, "seconds": 0.0}]}
        writer({"type": "refining"})
        spec, runner = harness_spec(deps), harness_runner(deps)
        options = state.get("options") or {}
        english_topic = state.get("english_topic") or state["topic"]
        res = await runner.call(
            refiner, prompts.REFINE_SYSTEM,
            prompts.refine_user(topic=state["topic"], english_topic=english_topic, options=options),
            schema=ReviewQuestion, validate=lambda q: question_problems(q, options),
        )
        cost = res.cost
        question = res.value if res.ok else None
        entry: dict[str, Any] = {"stage": "refine", "attempts": res.attempts, "repaired": res.repaired,
                                 "escalated": res.escalated, "critique_applied": False, "critique_issues": [],
                                 "fallback": question is None, "problems": res.problems}
        critic = getattr(deps.llms, "refiner_critic", None)
        if question is not None and spec.refine_critique and critic is not None:
            crit = await runner.call(
                critic, prompts.CRITIQUE_SYSTEM,
                prompts.critique_user(topic=state["topic"], question=question.model_dump(), options=options),
                schema=QuestionCritique, validate=lambda c: question_problems(c.revised, options),
                trigger="critique",
            )
            cost += crit.cost
            if crit.ok:
                question = crit.value.revised
                entry["critique_applied"] = True
                entry["critique_issues"] = crit.value.issues
        if question is None:
            entry["seconds"] = round(time.perf_counter() - started, 3)
            return {"question": None, "cost_usd": cost, "quality": [entry]}
        display, localize_cost = await _localized_display(deps, runner, question, state.get("language", "th"))
        cost += localize_cost
        writer({"type": "question_refined", **display})
        entry["seconds"] = round(time.perf_counter() - started, 3)
        return {"question": question.model_dump(), "question_display": display, "cost_usd": cost,
                "quality": [entry]}

    return refine_question


def make_plan_queries(deps):
    async def plan_queries(state: ReviewState) -> dict:
        started = time.perf_counter()
        question = state.get("question")
        res = await deps.llms.planner.ainvoke(
            prompts.PLAN_SYSTEM,
            prompts.plan_user(topic=state["topic"], english_topic=state.get("english_topic") or state["topic"],
                              options=state.get("options") or {}, question=question),
        )
        plan = res.value.model_dump()
        seen: dict[str, str] = {}
        for q in plan["queries"]:
            q = " ".join(q.split())
            if q and q.lower() not in seen:
                seen[q.lower()] = q
        plan["queries"] = list(seen.values())[:MAX_QUERIES]
        if question:  # PICO comes from the refined question so every stage judges against the same criteria
            for key in ("population", "intervention_or_exposure", "comparator", "outcomes"):
                plan[key] = question[key]
        progress_writer()({"type": "planning", "queries": plan["queries"]})
        return {"plan": plan, "cost_usd": res.cost_usd,
                "quality": [{"stage": "plan", "seconds": round(time.perf_counter() - started, 3)}]}

    return plan_queries
