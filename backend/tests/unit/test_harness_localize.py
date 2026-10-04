import re

from app.graph.schemas import TranslationBatch, TranslationItem
from app.harness.localize import localize_strings
from app.harness.runner import HarnessRunner
from tests.fakes import FakeStructuredLLM


def items_in(user):
    return re.findall(r'"id": "([^"]+)", "text": "([^"]*)"', user)


def thai(user, corrupt=None):
    out = []
    for item_id, text in items_in(user):
        t = "แปล: " + text
        if item_id == corrupt:
            t = t.replace("0.80", "0.8")
        out.append(TranslationItem(id=item_id, text=t))
    return TranslationBatch(items=out)


async def test_translates_and_keeps_ids():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u))
    strings = {"summary": "Lower risk (HR 0.80) [P1].", "gap": "No RCTs."}
    out, problems, cost = await localize_strings(llm, HarnessRunner(max_repairs=1), strings, "th")
    assert out == {"summary": "แปล: Lower risk (HR 0.80) [P1].", "gap": "แปล: No RCTs."}
    assert problems == 0 and cost > 0


async def test_item_whose_numbers_change_is_repaired_then_kept_in_english():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, corrupt="summary"))
    strings = {"summary": "Lower risk (HR 0.80).", "gap": "No RCTs."}
    out, problems, _ = await localize_strings(llm, HarnessRunner(max_repairs=1), strings, "th")
    assert out["summary"] == "Lower risk (HR 0.80)."  # fell back to English
    assert out["gap"] == "แปล: No RCTs." and problems == 1
    assert len(llm.calls) == 2  # one repair attempt


async def test_english_or_empty_is_a_no_op():
    llm = FakeStructuredLLM("qwen", lambda s, u: AssertionError("should not be called"))
    assert (await localize_strings(llm, HarnessRunner(), {"a": "x"}, "en"))[0] == {"a": "x"}
    assert (await localize_strings(llm, HarnessRunner(), {}, "th"))[0] == {}
    assert (await localize_strings(None, HarnessRunner(), {"a": "x"}, "th"))[0] == {"a": "x"}


async def test_large_batches_are_chunked():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u))
    strings = {f"k{i}": f"text {i}" for i in range(130)}
    out, _, _ = await localize_strings(llm, HarnessRunner(), strings, "th", chunk_size=60)
    assert len(out) == 130 and len(llm.calls) == 3


async def test_chunks_of_15_run_in_parallel():
    import asyncio
    state = {"now": 0, "peak": 0}

    async def slow(system, user):
        state["now"] += 1
        state["peak"] = max(state["peak"], state["now"])
        await asyncio.sleep(0.01)
        state["now"] -= 1
        return thai(user)

    llm = FakeStructuredLLM("gem", slow)
    strings = {f"s{i}": f"Item {i} text." for i in range(40)}
    out, kept, _ = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th")
    assert len(llm.calls) == 3 and state["peak"] > 1  # 15 + 15 + 10, overlapping
    assert kept == 0 and all(v.startswith("แปล: ") for v in out.values())


async def test_one_failed_chunk_keeps_only_that_chunk_english():
    from app.services.llm import LLMOutputError

    def respond(system, user):
        if '"id": "s20"' in user:
            return LLMOutputError("hit max_tokens before finishing the JSON output")
        return thai(user)

    llm = FakeStructuredLLM("gem", respond)
    strings = {f"s{i}": f"Item {i} text." for i in range(40)}
    out, kept, _ = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th")
    assert kept == 15
    assert out["s20"] == "Item 20 text." and out["s15"] == "Item 15 text."
    assert out["s0"].startswith("แปล: ") and out["s39"].startswith("แปล: ")
