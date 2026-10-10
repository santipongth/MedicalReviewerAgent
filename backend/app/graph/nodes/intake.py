from __future__ import annotations

import re
import time
from typing import Any

from langgraph.graph import END

from app.graph import prompts
from app.graph.progress import progress_writer
from app.graph.schemas import QueryPlan, QuestionCritique, ReviewQuestion, TopicVerdict
from app.graph.state import ReviewState
from app.harness.localize import localize_strings
from app.harness.question import question_problems
from app.harness.runner import HarnessRunner
from app.harness.study_types import missing_study_types
from app.schemas.review import ReviewOptions
from app.services.llm import LLMError, LLMOutputError, LLMRefusal
from app.services.llm_config import HarnessSpec

MAX_QUERIES = 4
NO_DESIGN_QUERY = {"narrative", "scoping"}  # these want breadth; every other type keeps the design query


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
            # Through the harness: a malformed answer is repaired (then escalated) instead of failing the review.
            res = await harness_runner(deps).call(deps.llms.guard, prompts.GUARD_SYSTEM,
                                                  prompts.guard_user(state["topic"]), schema=TopicVerdict)
        except LLMRefusal:
            return {"rejected": "The topic was declined by the safety filter."}
        if res.value is None:
            raise LLMOutputError(f"topic check failed: {'; '.join(res.problems) or 'no valid answer'}")
        if not res.value.allowed:
            return {"rejected": res.value.reason or "The topic is not a biomedical research question.",
                    "cost_usd": res.cost}
        return {"english_topic": res.value.english_topic or state["topic"], "cost_usd": res.cost}

    return topic_guard


def _draft_dump(question: ReviewQuestion, review_type: str) -> dict[str, Any]:
    """The draft as the critic sees it: PCC fields exist for scoping only, so the other types' prompt stays as before."""
    return question.model_dump(exclude=None if review_type == "scoping" else {"concept", "context"})


async def _localized_display(deps, runner: HarnessRunner, q: ReviewQuestion, language: str) -> tuple[dict, float]:
    strings: dict[str, str] = {"interpretation": q.interpretation, "refined_question": q.refined_question}
    strings |= {f"sub_questions.{i}": s for i, s in enumerate(q.sub_questions)}
    strings |= {f"assumptions.{i}": s for i, s in enumerate(q.assumptions)}
    cost = 0.0
    if harness_spec(deps).localize:
        try:
            res = await localize_strings(getattr(deps.llms, "localizer", None), runner, strings, language)
            strings, cost = res.strings, res.cost
        except LLMError:  # display stays in English; the review itself is unaffected
            cost = 0.0
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
        review_type = ReviewOptions.clamped(options).review_type
        english_topic = state.get("english_topic") or state["topic"]
        errors: list[str] = []
        try:
            res = await runner.call(
                refiner, prompts.refine_system(review_type),
                prompts.refine_user(topic=state["topic"], english_topic=english_topic, options=options,
                                    review_type=review_type),
                schema=ReviewQuestion, validate=lambda q: question_problems(q, options, review_type, enforce_study_types=False),
            )
        except LLMError as exc:  # provider error or refusal: review the English topic as-is
            errors.append(f"question refinement failed: {type(exc).__name__}")
            return {"question": None, "errors": errors,
                    "quality": [{"stage": "refine", "fallback": True, "critique_applied": False,
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        cost = res.cost
        question = res.value if res.ok else None
        entry: dict[str, Any] = {"stage": "refine", "attempts": res.attempts, "repaired": res.repaired,
                                 "escalated": res.escalated, "critique_applied": False, "critique_issues": [],
                                 "fallback": question is None, "problems": res.problems}
        critic = getattr(deps.llms, "refiner_critic", None)
        if question is not None and spec.refine_critique and critic is not None:
            try:
                crit = await runner.call(
                    critic, prompts.critique_system(review_type),
                    prompts.critique_user(topic=state["topic"], question=_draft_dump(question, review_type),
                                          options=options, review_type=review_type),
                    schema=QuestionCritique,
                    validate=lambda c: question_problems(c.revised, options, review_type, enforce_study_types=False),
                    trigger="critique",
                )
            except LLMError as exc:  # keep the validated draft
                errors.append(f"question critique failed: {type(exc).__name__}")
            else:
                cost += crit.cost
                if crit.ok:
                    question = crit.value.revised
                    entry["critique_applied"] = True
                    entry["critique_issues"] = crit.value.issues
        if question is None:
            errors.append("question refinement fell back to the English topic (no PICO): "
                          + ("; ".join(res.problems) or "no valid draft"))
            entry["seconds"] = round(time.perf_counter() - started, 3)
            return {"question": None, "cost_usd": cost, "errors": errors, "quality": [entry]}
        missing = missing_study_types(options, question.study_designs)
        if missing:  # never reject a good PICO over a study type: add the requested names in code and say so
            question = question.model_copy(update={"study_designs": [*question.study_designs, *missing]})
            entry["study_designs_added"] = missing
            errors.append("refined study_designs lacked the requested " + ", ".join(missing) + "; added in code")
        if review_type != "scoping" and (question.concept or question.context):  # PCC fields are scoping-only
            question = question.model_copy(update={"concept": None, "context": None})
        display, localize_cost = await _localized_display(deps, runner, question, state.get("language", "th"))
        cost += localize_cost
        writer({"type": "question_refined", **display})
        entry["seconds"] = round(time.perf_counter() - started, 3)
        return {"question": question.model_dump(), "question_display": display, "cost_usd": cost,
                "errors": errors, "quality": [entry]}

    return refine_question


PRIMARY_DESIGN_TERMS = re.compile(
    r"randomi[sz]ed|\btrials?\b|\brct\b|cohort|case-?control|cross-?sectional|diagnostic accuracy", re.IGNORECASE)
REVIEW_TERMS = re.compile(r"meta-?analys|systematic review|\breview\b", re.IGNORECASE)
DESIGN_FOR_QUESTION = {"harm_etiology": "cohort study", "prognosis": "cohort study", "prevalence": "cross-sectional study",
                       "diagnosis": "diagnostic accuracy study"}


def _is_primary_design_query(query: str) -> bool:
    return bool(PRIMARY_DESIGN_TERMS.search(query)) and not REVIEW_TERMS.search(query)


def ensure_design_query(queries: list[str], question: dict[str, Any] | None) -> list[str]:
    """Search engines rank reviews highly; one query naming the right primary design makes sure original studies
    are found too (a review query does not count). Added in code (replacing the last query when the cap is
    reached) if the planner left it out; kept short like the planner's own keyword queries."""
    if not question or any(_is_primary_design_query(q) for q in queries):
        return queries
    design = DESIGN_FOR_QUESTION.get(question.get("question_type") or "", "randomized controlled trial")
    intervention = " ".join((question.get("intervention_or_exposure") or "").split()[:4])
    population = " ".join((question.get("population") or "").split()[:3])
    query = " ".join(f"{intervention} {population} {design}".split())
    return [*queries[: MAX_QUERIES - 1], query] if len(queries) >= MAX_QUERIES else [*queries, query]


def make_plan_queries(deps):
    async def plan_queries(state: ReviewState) -> dict:
        started = time.perf_counter()
        question = state.get("question")
        review_type = ReviewOptions.clamped(state.get("options")).review_type

        def validate(p: QueryPlan) -> list[str]:
            return [] if any(q.strip() for q in p.queries) else ["queries must contain at least one search query"]

        try:
            res = await harness_runner(deps).call(
                deps.llms.planner, prompts.plan_system(review_type),
                prompts.plan_user(topic=state["topic"], english_topic=state.get("english_topic") or state["topic"],
                                  options=state.get("options") or {}, question=question, review_type=review_type),
                schema=QueryPlan, validate=validate, trigger="plan")
        except LLMError as exc:
            res = None
            error = f"query planning failed: {type(exc).__name__}"
        else:
            error = None if res.ok else "query planning failed: " + "; ".join(res.problems)
        if res is None or not res.ok:  # search falls back to the (refined) English topic
            progress_writer()({"type": "planning", "queries": []})
            return {"plan": None, "cost_usd": res.cost if res else 0.0, "errors": [error],
                    "quality": [{"stage": "plan", "fallback": True,
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        plan = res.value.model_dump()
        seen: dict[str, str] = {}
        for q in plan["queries"]:
            q = " ".join(q.split())
            if q and q.lower() not in seen:
                seen[q.lower()] = q
        plan["queries"] = list(seen.values())[:MAX_QUERIES]
        if review_type not in NO_DESIGN_QUERY:  # narrative/scoping reviews want breadth, not a design query
            plan["queries"] = ensure_design_query(plan["queries"], question)
        if question:  # PICO comes from the refined question so every stage judges against the same criteria
            for key in ("population", "intervention_or_exposure", "comparator", "outcomes"):
                plan[key] = question[key]
        progress_writer()({"type": "planning", "queries": plan["queries"]})
        return {"plan": plan, "cost_usd": res.cost,
                "quality": [{"stage": "plan", "seconds": round(time.perf_counter() - started, 3)}]}

    return plan_queries
