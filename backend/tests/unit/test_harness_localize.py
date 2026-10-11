import json
import re

import pytest

from app.graph.schemas import TranslationBatch, TranslationItem
from app.harness.localize import (
    accept,
    citations_preserved,
    localize_strings,
    localize_system,
    restore_citations,
    untranslated,
)
from app.harness.runner import HarnessRunner
from tests.fakes import FakeStructuredLLM

ENGLISH_WORD = re.compile(r"\b(?!P\d+\b)[A-Za-z]+\b")


def items_in(user):
    items = json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))
    return [(i["id"], i["text"]) for i in items]


def to_thai(text):
    """A fake translation: every English word becomes Thai; numbers and [Pn] stay."""
    return "แปล: " + ENGLISH_WORD.sub("ไทย", text)


def thai(user, corrupt=None, echo=(), transform=None):
    out = []
    for item_id, text in items_in(user):
        t = text if item_id in echo else to_thai(text)
        if item_id == corrupt:
            t = t.replace("0.80", "0.8")
        if transform and item_id in transform:
            t = transform[item_id](t)
        out.append(TranslationItem(id=item_id, text=t))
    return TranslationBatch(items=out)


async def test_translates_and_keeps_ids():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u))
    strings = {"summary": "Lower risk (HR 0.80) [P1].", "gap": "No RCTs."}
    res = await localize_strings(llm, HarnessRunner(max_repairs=1), strings, "th")
    assert res.strings == {"summary": "แปล: ไทย ไทย (ไทย 0.80) [P1].", "gap": "แปล: ไทย ไทย."}
    assert res.kept_english == 0 and res.untranslated == 0 and res.retried == 0 and res.cost > 0
    assert len(llm.calls) == 1


async def test_item_whose_numbers_change_is_repaired_then_kept_in_english():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, corrupt="summary"))
    strings = {"summary": "Lower risk (HR 0.80).", "gap": "No RCTs."}
    res = await localize_strings(llm, HarnessRunner(max_repairs=1), strings, "th")
    assert res.strings["summary"] == "Lower risk (HR 0.80)."  # fell back to English
    assert res.strings["gap"] == "แปล: ไทย ไทย." and res.kept_english == 1
    # first pass + one repair; the English summary is then retried (+ one repair) and still fails
    assert len(llm.calls) == 4 and res.retried == 1 and res.untranslated == 1


async def test_english_or_empty_is_a_no_op():
    llm = FakeStructuredLLM("qwen", lambda s, u: AssertionError("should not be called"))
    assert (await localize_strings(llm, HarnessRunner(), {"a": "x y z"}, "en")).strings == {"a": "x y z"}
    assert (await localize_strings(llm, HarnessRunner(), {}, "th")).strings == {}
    assert (await localize_strings(None, HarnessRunner(), {"a": "x"}, "th")).strings == {"a": "x"}
    assert not llm.calls


async def test_large_batches_are_chunked():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u))
    strings = {f"k{i}": f"text {i}" for i in range(130)}
    res = await localize_strings(llm, HarnessRunner(), strings, "th", chunk_size=60)
    assert len(res.strings) == 130 and len(llm.calls) == 3


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
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th")
    assert len(llm.calls) == 3 and state["peak"] > 1  # 15 + 15 + 10, overlapping
    assert res.kept_english == 0 and all(v.startswith("แปล: ") for v in res.strings.values())


async def test_one_failed_chunk_is_retried_in_small_chunks():
    from app.services.llm import LLMOutputError

    def respond(system, user):
        if '"id": "s20"' in user and "left in English" not in user:
            return LLMOutputError("hit max_tokens before finishing the JSON output")
        return thai(user)

    llm = FakeStructuredLLM("gem", respond)
    strings = {f"s{i}": f"Item {i} text." for i in range(40)}
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th")
    assert res.retried == 15 and res.untranslated == 0 and res.kept_english == 0
    assert len(llm.calls) == 3 + 3  # the 15 failed items go again as 3 chunks of 5
    assert res.strings["s20"] == "แปล: ไทย 20 ไทย." and res.strings["s0"].startswith("แปล: ")


async def test_a_failed_chunk_that_fails_again_keeps_only_its_items_english():
    from app.services.llm import LLMOutputError

    def respond(system, user):
        if '"id": "s20"' in user:
            return LLMOutputError("hit max_tokens before finishing the JSON output")
        return thai(user)

    llm = FakeStructuredLLM("gem", respond)
    strings = {f"s{i}": f"Item {i} text." for i in range(40)}
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th")
    assert res.kept_english == 5 and res.untranslated == 5  # only the retry chunk holding s20 fails again
    assert res.strings["s20"] == "Item 20 text." and res.strings["s15"].startswith("แปล: ")


async def test_outage_is_not_retried_item_by_item():
    """Final review finding 8: when most first-pass chunks raise, their items are not re-sent in 5-item chunks."""
    from app.services.llm import LLMOutputError

    llm = FakeStructuredLLM("gem", lambda s, u: LLMOutputError("timeout"))
    strings = {f"s{i}": f"Item {i} text." for i in range(40)}
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th")
    assert len(llm.calls) == 3 and res.retried == 0  # the three first-pass chunks only
    assert res.kept_english == 40 and res.strings == strings


async def test_retry_pass_is_capped():
    llm = FakeStructuredLLM("gem", lambda s, u: thai(u, echo=[i for i, _ in items_in(u)]) if "left in English" not in u
                            else thai(u))
    strings = {f"s{i}": f"Item {i} text here." for i in range(40)}
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), strings, "th", retry_max_items=10)
    assert res.retried == 10 and res.untranslated == 30
    assert len(llm.calls) == 3 + 2  # 10 items in two 5-item chunks


async def test_retry_pass_fails_soft():
    def respond(system, user):
        if "left in English" in user:
            raise RuntimeError("unexpected")
        return thai(user, echo=["a"])

    llm = FakeStructuredLLM("gem", respond)
    source = "the plain english text here."
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), {"a": source, "b": "More text."}, "th")
    assert res.strings["b"].startswith("แปล: ") and res.strings["a"] == source
    assert res.retried == 1 and res.untranslated == 1


# ---- completeness check and retry (I-4) ---------------------------------------------------------
async def test_echoed_english_is_detected_and_retried_in_one_bounded_pass():
    retry_users = []

    def respond(system, user):
        if "left in English" in user:
            retry_users.append(user)
            return thai(user)
        return thai(user, echo={"a", "b"})

    llm = FakeStructuredLLM("qwen", respond)
    strings = {"a": "Significantly lower risk with metformin [P1].", "b": "Patients with type 2 diabetes",
               "c": "No RCTs were found.", "d": "Metformin"}
    res = await localize_strings(llm, HarnessRunner(max_repairs=1), strings, "th")
    assert res.retried == 2 and res.untranslated == 0 and res.kept_english == 0
    assert len(retry_users) == 1 and '"id": "c"' not in retry_users[0]  # only the English items go again
    assert res.strings["a"] == "แปล: ไทย ไทย ไทย ไทย ไทย [P1]."
    assert res.strings["d"] == "แปล: ไทย"


async def test_items_still_english_after_the_retry_are_reported_not_looped():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, echo={"a"}))
    strings = {"a": "Significantly lower risk with metformin.", "c": "No RCTs were found."}
    res = await localize_strings(llm, HarnessRunner(max_repairs=1), strings, "th")
    assert res.retried == 1 and res.untranslated == 1 and res.kept_english == 0
    assert res.strings["a"] == strings["a"]
    assert len(llm.calls) == 1 + 2  # first pass; retry + one repair; no further rounds


async def test_half_translated_item_keeps_the_better_attempt_when_the_retry_is_worse():
    half = "Significantly higher 2-year OS ในผู้ที่ใช้ Metformin"

    def respond(system, user):
        if "left in English" in user:
            return thai(user, echo={"a"})
        return thai(user, transform={"a": lambda t: half})

    llm = FakeStructuredLLM("qwen", respond)
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), {"a": "Significantly higher 2-year OS with "
                                                                           "metformin"}, "th")
    assert res.strings["a"] == half and res.untranslated == 1 and res.retried == 1


async def test_retry_repairs_a_partial_translation_within_max_repairs():
    # Plan 20 Task 10 (the mammography re-run left "ผู้ป่วย undergoing mammography และ ..." after the retry): a partial
    # translation now also gets the retry pass's repair rounds, bounded by max_repairs
    half = "Significantly higher 2-year OS ในผู้ที่ใช้ Metformin"
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, transform={"a": lambda t: half}))
    res = await localize_strings(llm, HarnessRunner(max_repairs=2), {"a": "Significantly higher 2-year OS with "
                                                                           "metformin"}, "th")
    assert len(llm.calls) == 4  # first pass + retry call + 2 repair rounds, then it stops
    assert "only partly translated" in llm.calls[2][1]
    assert res.untranslated == 1 and res.strings["a"] == half


async def test_retry_repair_fixes_a_half_translated_population():
    source = "Patients undergoing mammography and digital breast tomosynthesis (DBT)"
    half = "ผู้ป่วย undergoing mammography และ digital breast tomosynthesis (DBT)"
    full = "ผู้ป่วยที่เข้ารับการตรวจแมมโมแกรมและการถ่ายภาพเต้านมแบบสามมิติ (DBT)"
    answers = iter([half, half, full])
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, transform={"a": lambda t: next(answers)}))
    res = await localize_strings(llm, HarnessRunner(max_repairs=2), {"a": source}, "th")
    assert res.strings["a"] == full and res.untranslated == 0


@pytest.mark.parametrize(("source", "text", "expected"), [
    # Plan 20 Task 10: names copied verbatim (a product, a company) are not English left untranslated
    ("Transpara version 1.7.0 ScreenPoint Medical", "Transpara รุ่น 1.7.0 ScreenPoint Medical", False),
    ("women undergoing mammography screening", "ผู้หญิง undergoing mammography screening", True),
    ("Patients undergoing mammography", "Patients ที่เข้ารับ mammography screening", True),
])
def test_untranslated_detector_excuses_names_copied_from_the_source(source, text, expected):
    assert untranslated(source, text, "th") is expected


@pytest.mark.parametrize(("source", "text", "expected"), [
    ("Significantly lower risk with metformin", "Significantly lower risk with metformin", True),
    ("Significantly higher 2-year OS with metformin", "Significantly higher 2-year OS ในผู้ที่ใช้ Metformin", True),
    ("Lower risk with metformin", "ความเสี่ยงต่ำกว่าในกลุ่มที่ได้รับ metformin", False),
    # parenthesised English terms, abbreviations and identifiers do not count against the translation
    ("Hazard ratio for overall survival (HR) in NCT01234567",
     "อัตราส่วนฮาซาร์ด (hazard ratio, HR) ของอัตราการรอดชีพโดยรวมใน NCT01234567", False),
    ("Metformin", "Metformin", False),  # a single name may stay in English
    ("DenseNet-169 and EfficientNet-B5", "DenseNet-169 และ EfficientNet-B5", False),
    ("Prospective cohort study", "Prospective cohort study", True),
    # review round 1: runs of capitalised words are proper names and may stay in English
    ("Funded by Novo Nordisk and Eli Lilly", "ได้รับทุนจาก Novo Nordisk และ Eli Lilly", False),
    ("Swedish Cancer Society, Stockholm County Council", "สมาคมมะเร็งสวีเดน, Stockholm County Council", False),
    ("Swedish Cancer Society, Stockholm County Council", "Swedish Cancer Society, Stockholm County Council",
     False),  # an echoed name list is not translatable, so it is never retried
    ("Transformer-based deep learning model for mammography screening",
     "Transformer-based deep learning model สำหรับ mammography screening", True),
    ("Retrospective cohort with propensity score matching",
     "การศึกษาแบบ retrospective cohort พร้อม propensity score matching", True),
])
def test_untranslated_detector(source, text, expected):
    assert untranslated(source, text, "th") is expected
    assert untranslated(source, text, "en") is False  # never checked outside Thai


# ---- citations (I-12) ---------------------------------------------------------------------------
def test_citations_are_compared_as_a_multiset():
    assert citations_preserved("A [P1]; B [P2, P3].", "ก [P1]; ข [P2, P3].")
    assert not citations_preserved("A [P3].", "ก [P5].")  # swapped
    assert not citations_preserved("A [P3] and [P3].", "ก [P3].")  # dropped one
    assert not citations_preserved("A [P1, P2].", "ก [P1].")


def test_citation_repair_is_a_respacing_or_a_single_substitution_only():
    assert restore_citations("A [P1]. B [P2, P4].", "ก [P 1]. ข [P2, P4].") == "ก [P1]. ข [P2, P4]."
    assert restore_citations("A [P1]. B [P2, P4].", "ก [P1]. ข [P2, P5].") == "ก [P1]. ข [P2, P4]."
    assert restore_citations("A [P1]. B [P2].", "ก [พี1]. ข") is None  # dropped: no safe position
    assert restore_citations("A [P1]. B [P2].", "ก [P5]. ข [P6].") is None  # two substitutions
    assert restore_citations("A [P1]. B [P2].", "ก [P2]. ข [P2].") is None  # the wrong id is also a real one
    assert restore_citations("A [P1].", "ก [P1]. ข [P3].") is None  # added
    # a non-citation bracket group copied from the source is left alone
    assert restore_citations("RR [95% CI 0.5-0.8] [P2].", "RR [95% CI 0.5-0.8] [P3].") == "RR [95% CI 0.5-0.8] [P2]."
    # P1 must not touch P10
    assert restore_citations("A [P10, P2].", "ก [P10, P1].") == "ก [P10, P2]."


def test_citation_repair_survives_reordered_clauses():
    """Regression (review round 1): Thai put clause B first. Matching groups by position would have attached [P1] to
    drug B and [P2] to drug A; the single substitution only fixes the one wrong id, where it stands."""
    source = "Drug A lowered risk [P1] while drug B raised it [P2]; see also [P3]."
    translated = "ยา B เพิ่มความเสี่ยง [P2] ขณะที่ยา A ลดความเสี่ยง [P1]; ดูเพิ่มเติม [P4]"
    assert restore_citations(source, translated) == "ยา B เพิ่มความเสี่ยง [P2] ขณะที่ยา A ลดความเสี่ยง [P1]; ดูเพิ่มเติม [P3]"
    # reordered and two ids wrong: no safe repair, the item falls back to English
    assert accept(source, translated.replace("[P1]", "[P5]"))[0] is None


def test_accept_restores_or_rejects():
    assert accept("Lower [P3].", "ต่ำกว่า [P5].") == ("ต่ำกว่า [P3].", True)
    assert accept("Lower [P3].", "ต่ำกว่า [P3].") == ("ต่ำกว่า [P3].", False)
    assert accept("Lower [P3] and [P4].", "ต่ำกว่า [P3].") == (None, False)
    assert accept("HR 0.80 [P3].", "HR 0.8 [P3].") == (None, False)  # numbers still must match exactly


async def test_broken_citation_is_restored_in_a_run_and_counted():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, transform={"a": lambda t: t.replace("[P2]", "[P 2]")}))
    res = await localize_strings(llm, HarnessRunner(max_repairs=0), {"a": "Lower risk [P2].", "b": "No RCTs."}, "th")
    assert res.strings["a"] == "แปล: ไทย ไทย [P2]." and res.citations_restored == 1 and res.kept_english == 0


async def test_dropped_citation_falls_back_to_english_after_repair():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u, transform={"a": lambda t: t.replace(" [P2]", "")}))
    res = await localize_strings(llm, HarnessRunner(max_repairs=1), {"a": "Lower risk [P2]."}, "th")
    assert res.strings["a"] == "Lower risk [P2]." and res.kept_english == 1
    assert "citations changed" in llm.calls[1][1]  # the repair round names the problem


async def test_numbers_survive_unchanged():
    llm = FakeStructuredLLM("qwen", lambda s, u: thai(u))
    source = "RR 0.63 (95% CI 0.47-0.84; P = .002) in 108,161 patients [P1]."
    res = await localize_strings(llm, HarnessRunner(), {"a": source}, "th")
    for number in ("0.63", "95%", "0.47-0.84", ".002", "108,161", "[P1]"):
        assert number in res.strings["a"]


# ---- prompt (I-16) -------------------------------------------------------------------------------
def test_thai_prompt_has_glossary_and_academic_register():
    system = localize_system("th")
    for term in ("อัตราส่วนฮาซาร์ด (HR)", "อัตราส่วนความเสี่ยง (RR)", "ช่วงความเชื่อมั่น 95%",
                 "การศึกษาแบบผู้ป่วย-กลุ่มควบคุม (case-control)", "ระยะรอดชีพโดยปลอดการลุกลามของโรค (PFS)", "การทบทวนวรรณกรรมอย่างเป็นระบบ",
                 "การวิเคราะห์อภิมาน", "อัตราการเสียชีวิต", "อุบัติการณ์", "อัตราส่วนออดส์ (OR)",
                 "การทดลองแบบสุ่มที่มีกลุ่มควบคุม (RCT)", "การศึกษาแบบโคฮอร์ต"):
        assert term in system
    assert "ภาษาเขียนเชิงวิชาการ" in system and "no casual particles" in system and "[P3]" in system
    assert len(system) < 2600  # stays compact
    assert "Glossary" not in localize_system("ja")  # the glossary is Thai only
