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
# Fix round 4: the review's fresh and held-out sets (not used to tune the round-3 lists).
FRESH_TH_RESEARCH = [
    "หมดสติจากน้ำตาลต่ำ", "ชักจากไข้สูง", "ยาแอสไพรินลดเจ็บหน้าอก", "ยาพ่นขยายหลอดลมแก้หายใจไม่ทัน",
    "เจ็บหน้าอกจากกรดไหลย้อน", "หายใจไม่ออกตอนกลางคืนกับหัวใจล้มเหลว", "ยานาล็อกโซนแก้กินยาเกินขนาด",
    "ไอเป็นเลือดจากมะเร็งปอด", "หมดสติชั่วคราวจากความดันต่ำ", "ยาสเตียรอยด์ลดคอบวม",
    "เลือดออกไม่หยุดจากยาวาร์ฟาริน", "ปากเบี้ยวจากเส้นประสาทใบหน้าอักเสบ", "ยาต้านซึมเศร้าลดฆ่าตัวตาย",
    "ไม่หายใจขณะหลับและโรคอ้วน", "แน่นหน้าอกจากวิตกกังวล",
]
FRESH_EN_RESEARCH = [
    "stroke thrombolysis", "cardiac arrest survival", "heart attack aspirin", "chest pain troponin",
    "unconscious hypoglycaemia glucagon", "seizure benzodiazepines", "vomiting blood endoscopy",
    "heavy bleeding tranexamic acid", "difficulty breathing heliox", "heart attack women",
    "coughing up blood tuberculosis", "bleach ingestion children", "collapsed patient defibrillation",
    "slurred speech thrombectomy", "short of breath opioids",
]
HELDOUT_TH_RESEARCH = [
    "หอบเหนื่อยมากในหญิงตั้งครรภ์", "ชาครึ่งซีกกับไมเกรน", "อาเจียนเป็นเลือดและยาแก้ปวด", "หายใจลำบากหลังติดโควิด",
    "เจ็บหน้าอกแบบไม่ทราบสาเหตุ", "คอบวมจากยาACEinhibitor", "ยาขับปัสสาวะแก้หอบเหนื่อยมาก", "แพ้ยารุนแรงจากยากันชัก",
    "หมดสติจากลมแดด", "กินยาฆ่าแมลงพาราควอตกับไตวาย",
]
HELDOUT_EN_RESEARCH = [
    "chest pain cocaine", "heart attack statins", "overdose naloxone", "anaphylaxis adrenaline",
    "not breathing newborn resuscitation", "unconscious head injury CT", "coughing up blood bronchiectasis",
    "seizing dogs", "stroke heart attack aspirin", "passed out athletes",
]
# Emergencies the pass catches (fresh 14/15, held-out 8/10). Left to the guard (no anchor; a framing word outside the
# red flag): "friend passed out after drinking", "he collapsed at work help", "granny fell and is bleeding heavily".
FRESH_EMERGENCIES = [
    "my mother collapsed and is not waking up", "grandpa cant breathe", "my husband chest pain sweating",
    "baby choking turning blue", "kid swallowed batteries", "she is not breathing what do i do",
    "took a whole bottle of sleeping pills",
    "แม่หมดสติไม่ตอบสนอง", "พ่อแน่นหน้าอกเหงื่อออก", "ลูกชักไม่หยุดตัวร้อน", "ยายพูดไม่ชัดปากเบี้ยวเมื่อเช้า",
    "สามีกินยาฆ่าแมลงไปเมื่อกี้", "ช่วยด้วยคนหมดสติอยู่ข้างทาง", "เพื่อนกินยานอนหลับไปทั้งแผง ทำยังไงดี",
]
HELDOUT_EMERGENCIES = [
    "my dad is unresponsive", "mum cant breathe properly", "kid drank bleach what now", "help someone overdosed",
    "my girlfriend is seizing", "ลูกไม่หายใจ", "แฟนกินยาเกิน 20 เม็ด", "ผมแน่นหน้าอกมาก เหงื่อออก",
]


def _flagged(topics):
    return [t for t in topics if safety.red_flag(t) is not None]


@pytest.mark.parametrize("topics", [FRESH_TH_RESEARCH, FRESH_EN_RESEARCH, HELDOUT_TH_RESEARCH, HELDOUT_EN_RESEARCH],
                         ids=["fresh-th", "fresh-en", "heldout-th", "heldout-en"])
def test_short_noun_phrase_research_titles_are_not_refused(topics):
    assert _flagged(topics) == []


@pytest.mark.parametrize("topic", FRESH_EMERGENCIES + HELDOUT_EMERGENCIES)
def test_fresh_and_held_out_emergencies_are_medical(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical"), topic


@pytest.mark.parametrize("topic", [
    "my son is choking", "baby choking", "my daughter swallowed a button battery", "kid swallowed a battery help",
    "I took a whole bottle of paracetamol", "she took a pack of tablets", "took a strip of panadol help",
    "ผมกินยาไปทั้งขวด", "แม่กินยานอนหลับทั้งแผง", "กินยาไปทั้งแผง ช่วยด้วย",
])
def test_choking_batteries_and_a_whole_pack_of_pills_are_medical(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical"), topic


@pytest.mark.parametrize("topic", [
    "choking in children", "choking prevention in older adults", "button battery ingestion in children",
    "swallowed batteries endoscopic removal", "pill burden and adherence", "การกินยาทั้งแผงโดยไม่ตั้งใจในเด็ก",
])
def test_their_research_counterparts_are_not_refused(topic):
    assert safety.red_flag(topic) is None, topic


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
    "dad is having a stroke what to do", "baby not breathing", "chest pain now help", "mom collapsed please help",
])
def test_a_short_unframed_english_topic_counts_without_an_anchor(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical")


@pytest.mark.parametrize("topic", [
    "help a friend with chest pain now",  # framed ("with")
    "a very long description of a man who was having a stroke at the shop yesterday afternoon",  # over 8 words
    "paracetamol overdose", "anaphylaxis",  # noun-like flags need an anchor
])
def test_known_misses_without_an_anchor_are_left_to_the_guard(topic):
    assert safety.red_flag(topic) is None


def test_nikhahit_plus_sara_aa_is_folded_to_sara_am():
    assert safety.normalize("นํา") == "นำ"
    assert safety.normalize("น้ํายาฟอกขาว") == safety.normalize("น้ำยาฟอกขาว")
    assert safety.red_flag("ลูกกลืนน้ํายา") == safety.red_flag("ลูกกลืนน้ำยา") is not None


def test_a_600_character_topic_takes_milliseconds():
    for text in ["i " * 300, "my " * 200, "กินยา" + "ก" * 595, "กินยา" + " 1" * 297, "took " + "1 " * 297,
                 "swallowed " + "a " * 295, "ฉัน" * 200, "แม่" * 200, "someone " * 75, "ย" * 600,
                 "took a whole bottle of " + "x " * 290, "took a " * 85, "swallowed an " * 46,
                 "กินยา" + "ทั้ง" * 149, "is " * 200, "ยา" * 300]:
        start = time.perf_counter()
        for _ in range(5):
            safety.red_flag(text[:600])
        assert (time.perf_counter() - start) / 5 < 0.05
