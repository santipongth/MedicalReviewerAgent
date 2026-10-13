"""Plan 26 fix round 2: the red-flag pass favours precision; the topic guard is the backstop for what it lets through."""
import time

import pytest

from app.services import safety

TH_RESEARCH = [
    "การรักษาภาวะหัวใจวายเฉียบพลัน",
    "ปัจจัยเสี่ยงของโรคหลอดเลือดสมองในผู้สูงอายุ",
    "ยาต้านเกล็ดเลือดหลังหลอดเลือดสมองตีบ",
    "การให้ยาละลายลิ่มเลือดในผู้ป่วยหลอดเลือดสมอง",
    "ภาวะชักในเด็กที่มีไข้",
    "การจัดการภาวะหายใจล้มเหลวในห้องฉุกเฉิน",
    "ผลของยาเกินขนาดพาราเซตามอลต่อตับ",
    "การฆ่าตัวตายในผู้ป่วยซึมเศร้า",
    "การใช้ออกซิเจนในภาวะหายใจลำบากของทารกแรกเกิด",
    "ยาแก้ปวดสำหรับอาการเจ็บหน้าอกจากกล้ามเนื้อหัวใจขาดเลือด",
    "อาการเจ็บหน้าอกในห้องฉุกเฉิน",
    "การตรวจคลื่นไฟฟ้าหัวใจในผู้ที่เจ็บหน้าอก",
    "สาเหตุของการหมดสติในผู้สูงอายุ",
    "การกู้ชีพผู้ที่หมดสตินอกโรงพยาบาล",
    "ภาวะแพ้อย่างรุนแรงจากอาหารในเด็กไทย",
    "การใช้อะดรีนาลีนในภาวะแพ้อย่างรุนแรง",
    "ภาวะเลือดออกมากหลังคลอด",
    "การป้องกันภาวะเลือดออกมากหลังคลอดด้วยออกซิโทซิน",
    "กรดทรานเนซามิกสำหรับเลือดออกมากจากอุบัติเหตุ",
    "ยากันชักสำหรับภาวะชักเกร็งต่อเนื่อง",
    "พิษจากการกินยาฆ่าแมลงพาราควอต",
    "การรักษาผู้ที่กินยาฆ่าแมลงออร์กาโนฟอสเฟต",
    "ไอเป็นเลือดในวัณโรค",
    "อาเจียนเป็นเลือดจากหลอดเลือดขอดในหลอดอาหาร",
    "กล้ามเนื้ออ่อนแรงครึ่งซีกหลังโรคหลอดเลือดสมอง",
    "การฟื้นฟูแขนขาอ่อนแรงหลังหลอดเลือดสมอง",
    "ภาวะพูดไม่ชัดหลังหลอดเลือดสมอง",
    "หายใจลำบากในผู้ป่วยมะเร็งระยะท้าย",
    "มอร์ฟีนสำหรับอาการหายใจลำบากในระยะท้าย",
    "ภาวะหายใจลำบากในโรคปอดอุดกั้นเรื้อรัง",
    "ไม่รู้สึกตัวหลังผ่าตัด",
    "การนอนกรนและหยุดหายใจขณะหลับ",
    "ภาวะไม่หายใจในทารกคลอดก่อนกำหนด",
    "การฆ่าตัวตายกับการขยายตัวของเมือง",
    "ปัจจัยที่สัมพันธ์กับการฆ่าตัวตายในวัยรุ่นไทย",
    "การทำร้ายตัวเองในนักศึกษามหาวิทยาลัย",
    "แบบคัดกรองความเสี่ยงฆ่าตัวตาย",
    "การป้องกันการฆ่าตัวตายในชุมชน",
    "การฆ่าตัวตายของพี่น้องฝาแฝด",
    "ยาลิเทียมกับการฆ่าตัวตาย",
    "อย่าลืมกินยา: การกินยาเกินขนาดโดยไม่ตั้งใจ",
]
OTHER_RESEARCH = [
    "ลูกน้ำยุงลายกับไข้เลือดออก", "ลูกน้ำยุงลายกับการฆ่าตัวตาย", "พี่เลี้ยงเด็กกับการปฐมพยาบาลเด็กหมดสติ",
    "น้องหมากัดกับโรคพิษสุนัขบ้า", "น้องหมากินยาเกินขนาด", "ลูกค้าร้านขายยากับการฆ่าตัวตาย",
    "แม่น้ำเจ้าพระยากับการฆ่าตัวตาย", "พ่อแม่ของวัยรุ่นที่ทำร้ายตัวเอง", "การเลี้ยงลูกด้วยนมแม่กับภาวะหายใจลำบาก",
    "การขยายหลอดลมในภาวะหายใจลำบาก", "แฟนตาซีกับการทำร้ายตัวเอง", "ด่วนที่สุด",
    "heart attack: what we know now", "help-seeking delay in heart attack", "paracetamol overdose in a child",
    "seizures in a child with fever", "baby not breathing: sudden infant death syndrome",
    "sudden infant death: baby not breathing at night", "helping a friend with suicidal thoughts",
    "child poisoned by lead paint", "son of a smoker heart attack", "chest pain in kids", "kid chest pain causes",
    "help lines for suicide prevention", "overdose now leading cause of death", "women and heart attack symptoms",
    "heart attack in young adults", "collapsed lung recovery", "anaphylaxis in a child at school",
    "urgent care and chest pain", "child anaphylaxis epinephrine autoinjector",
    "brother sister incest and self harm", "mother suicide and offspring outcomes",
]


def _flagged(topics):
    return [t for t in topics if safety.red_flag(t) is not None]


def test_thai_research_topics_are_almost_never_refused():
    # Remaining false positives: none.
    assert len(_flagged(TH_RESEARCH)) <= 2, _flagged(TH_RESEARCH)


def test_other_research_topics_are_almost_never_refused():
    # Remaining false positive: "น้องหมากินยาเกินขนาด" (a pet overdose is short and unframed, so it reads as a message).
    assert len(_flagged(OTHER_RESEARCH)) <= 2, _flagged(OTHER_RESEARCH)


@pytest.mark.parametrize("topic", [
    "ตอนนี้หายใจไม่ออก", "เจ็บหน้าอกมาก หายใจไม่ออก", "หายใจไม่ออก", "ฆ่าตัวตาย ช่วยด้วย",
])
def test_a_short_unframed_thai_topic_counts_without_an_anchor(topic):
    assert safety.red_flag(topic) is not None


@pytest.mark.parametrize("topic", [
    "อาการเจ็บหน้าอกในห้องฉุกเฉิน", "ภาวะหมดสติ", "ผมร่วงกับหายใจลำบาก", "ภาวะหมดสติในหนู",
    "เจ็บหน้าอกมาก หายใจไม่ออก" + "ก" * 40,  # too long to be a message
])
def test_a_framed_or_long_thai_topic_needs_an_anchor(topic):
    assert safety.red_flag(topic) is None


@pytest.mark.parametrize("topic", [
    "ผมหายใจไม่ออก ผมร่วงด้วย", "แม่ฉันหมดสติ ตอนอยู่โรงพยาบาลหลังผ่าตัดใหญ่", "พ่อของผมหมดสติหลังกินยาเกินขนาดมาก",
    "ลูกผมหายใจไม่ออก ลูกน้ำในบ้านก็เยอะ",
])
def test_an_excluded_compound_silences_only_its_own_marker(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical")


@pytest.mark.parametrize("topic", [
    "dad is having a stroke what to do", "baby not breathing", "chest pain now help", "help a friend with chest pain now",
])
def test_known_misses_without_an_anchor_are_left_to_the_guard(topic):
    assert safety.red_flag(topic) is None


def test_nikhahit_plus_sara_aa_is_folded_to_sara_am():
    assert safety.normalize("นํา") == "นำ"
    assert safety.red_flag("น้ํายาฟอกขาว ผมกิน") is None
    assert safety.red_flag("ลูกกลืนน้ํายา") is not None


def test_a_600_character_topic_takes_milliseconds():
    for text in ["i " * 300, "my " * 200, "กินยา" + "ก" * 595, "กินยา" + " 1" * 297, "took " + "1 " * 297,
                 "swallowed " + "a " * 295, "ฉัน" * 200, "แม่" * 200, "someone " * 75, "ย" * 600]:
        start = time.perf_counter()
        for _ in range(5):
            safety.red_flag(text[:600])
        assert (time.perf_counter() - start) / 5 < 0.05
