import pytest

from app.graph.schemas import TranslationBatch, TranslationItem
from app.harness.localize import localize_strings
from app.harness.quality import summarize_quality
from app.harness.runner import HarnessRunner
from tests.fakes import FakeStructuredLLM


def translator(system, user):
    # item a keeps its number; item b changes 0.80 to 0.8; item c drops its citation
    return TranslationBatch(items=[
        TranslationItem(id="a", text="อัตราการเสียชีวิตลดลง 12% [P1]"),
        TranslationItem(id="b", text="อัตราส่วนฮาซาร์ด 0.8 [P2]"),
        TranslationItem(id="c", text="อุบัติการณ์ลดลงในกลุ่มที่ได้รับยา"),
    ])


@pytest.mark.asyncio
async def test_rejections_are_counted_by_cause():
    llm = FakeStructuredLLM("loc", translator)
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), {
        "a": "Mortality fell by 12% [P1]", "b": "Hazard ratio 0.80 [P2]", "c": "Incidence fell in the drug group [P3]",
    }, "th", retry_max_items=0)
    t = res.telemetry()
    assert t["numbers_rejected"] == 1 and t["citations_rejected"] == 1
    assert res.strings["a"].startswith("อัตรา") and res.strings["b"] == "Hazard ratio 0.80 [P2]"


def test_summarize_quality_sums_new_counters():
    q = summarize_quality([{"stage": "localize", "numbers_rejected": 2, "citations_rejected": 1},
                           {"stage": "localize_cards", "numbers_rejected": 1}], None)
    assert q["localize"]["numbers_rejected"] == 3 and q["localize"]["citations_rejected"] == 1
