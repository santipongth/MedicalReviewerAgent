"""Plan 26: the red-flag pass and the refusal messages (app.services.safety). Pure; no LLM."""
import pytest

from app.services import safety


@pytest.mark.parametrize("topic", [
    "I have chest pain right now what should I do",
    "my father cannot breathe",
    "My son took too many pills, help",
    "someone is unconscious next to me",
    "my wife's face is drooping and she has slurred speech",
    "ผมเจ็บหน้าอกมาก ทำไงดี",
    "แม่ฉันหมดสติ",
    "ตอนนี้หายใจไม่ออก",
    "หนูกินยาเกินขนาดไปเมื่อกี้",
])
def test_a_personal_emergency_is_medical_and_points_to_1669(topic):
    flag = safety.red_flag(topic)
    assert flag == safety.Emergency("medical")
    assert flag.hotlines == ["1669"]
    assert "1669" in flag.message("th") and "1669" in flag.message("en")


@pytest.mark.parametrize("topic", [
    "I want to kill myself", "i wanna die", "I don't want to live anymore", "I keep cutting myself",
    "อยากตาย", "ไม่อยากมีชีวิตอยู่แล้ว", "my friend is suicidal", "ผมคิดจะฆ่าตัวตาย",
])
def test_self_harm_adds_the_mental_health_hotline(topic):
    flag = safety.red_flag(topic)
    assert flag == safety.Emergency("self_harm")
    assert flag.hotlines == ["1323", "1669"]
    assert "1323" in flag.message("th") and "1669" in flag.message("th") and "1323" in flag.message("en")


@pytest.mark.parametrize("topic", [
    "chest pain in the emergency department: troponin accuracy",
    "suicide prevention in adolescents",
    "การป้องกันการฆ่าตัวตายในวัยรุ่น",
    "stroke thrombolysis outcomes",
    "paracetamol overdose treatment with N-acetylcysteine",
    "อาการเจ็บหน้าอกในผู้ป่วยโรคหลอดเลือดหัวใจ",
    "I want research on chest pain triage",          # personal marker, but research framing
    "help me find studies on anaphylaxis in children",
    "ผมอยากได้งานวิจัยเรื่องหายใจลำบาก",
    "type I diabetes and unconscious hypoglycaemia",  # a Roman numeral is no personal marker
    "metformin and colorectal cancer",
    "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่",
    "my question: does aspirin prevent colorectal cancer",  # personal marker, no red flag
])
def test_research_topics_and_plain_questions_are_not_emergencies(topic):
    assert safety.red_flag(topic) is None


@pytest.mark.parametrize("topic", [
    "เจ็บหน้าอกมาก หายใจไม่ออก", "แม่หมดสติ", "แม่หมดสติ ทำยังไงดี", "พ่อหายใจไม่ออก", "ลูกกินยาเกินขนาด",
    "เพื่อนชัก", "ผมกินยาไป 30 เม็ด", "กินยาพาราไป 30 เม็ด", "ลูกกลืนน้ำยาล้างห้องน้ำ", "ลูกกินน้ำยาฟอกขาว",
    "ผมเลือดออกไม่หยุด", "ฉันเจ็บหน้าอก",
    "I cant breathe", "i can t breathe", "I can't breathe", "I took 30 paracetamol tablets", "i took 30 paracetamol",
    "my child swallowed bleach", "my kid drank bleach", "help my son had a seizure", "I'm bleeding a lot",
    "my father is having a stroke what do I do", "my father had a stroke, what should I do",
    "my father is having a stroke", "my baby is not breathing",
    "my mom collapsed", "my husband is unconscious", "our baby is not breathing",
    "I have chestpain", "my wife is having a heart attack", "I am having a heart attack",
    "having chest pain and my left arm is numb", "heart attack symptoms right now",
    "someone collapsed and is not breathing", "I overdosed on paracetamol", "my friend overdosed",
    "my son is having a seizure",
])
def test_further_personal_emergencies_are_medical(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical"), topic


@pytest.mark.parametrize("topic", [
    "คิดจะฆ่าตัวตาย", "อยาก ตาย", "อยากตายมาก", "อยากตายยย", "ฆ่าตัวตาย ช่วยด้วย", "หนูกรีดข้อมือ",
    "I'm going to kill my self", "kill-myself", "kill myself.", "KILL MYSELF", "i want to end it all",
    "I want to die", "i want to die!!!", "i wanna kms", "i'm suicidal", "Im suicidal",
    "i want to k\u200bill myself", "อยาก\u200bตาย", "ｋｉｌｌ ｍｙｓｅｌｆ",])
def test_further_self_harm_reaches_1323(topic):
    assert safety.red_flag(topic) == safety.Emergency("self_harm"), topic


@pytest.mark.parametrize("topic", [
    "การทำร้ายตัวเองในวัยรุ่น", "ทำร้ายตัวเองกับโซเชียลมีเดีย", "ภาวะหมดสติในหนู", "ยาเกินขนาดในหนู",
    "acetylcysteine i.v. for paracetamol overdose", "anaphylaxis, i.e. severe allergic reaction to peanuts",
    "chest pain, i.e. acute coronary syndrome, in women", "ผมร่วงกับหายใจลำบาก",
    "I'm a nurse: chest pain triage tools", "How do I manage chest pain",
    "chest pain in the emergency department", "stroke rehabilitation outcomes", "overdose deaths opioid policy",
    "งานวิจัยเรื่องการฆ่าตัวตายในวัยรุ่น", "self-harm in prisons", "suicide rates among doctors",
    "อัตราการฆ่าตัวตายในประเทศไทย", "การฆ่าตัวตายในผู้สูงอายุ", "naloxone for opioid overdose",
    "my research on suicide", "unconscious bias in medicine", "anaphylaxis in children",
    "anaphylaxis management in schools", "can't breathe protests air pollution", "self harm and social media",
    "me and my colleagues want to know about chest pain management", "เราอยากรู้เรื่องหายใจลำบากในเด็ก",
    "ตัวเองเป็นหมอ อยากรู้เรื่องหมดสติจากน้ำตาลต่ำ", "someone with type I diabetes and unconscious episodes",
    "stage I and II stroke", "grade i anaphylaxis", "i.v. paracetamol overdose",
    "ฉันอยากทราบเรื่องการใช้ยาเกินขนาดในวัยรุ่น", "เรากินยาเกินขนาด แนวทางรักษา", "someone who overdosed: naloxone",
])
def test_further_research_topics_are_not_emergencies(topic):
    assert safety.red_flag(topic) is None, topic


@pytest.mark.parametrize("topic", [
    "i want to die with dignity: euthanasia attitudes", "assisted dying: end my life laws",
    "cutting myself: dialectical behaviour therapy", "อยากตายอย่างสงบ: การดูแลระยะท้าย",
])
def test_known_self_harm_always_trade_off_is_refused(topic):  # documented in safety.py: the safe side
    assert safety.red_flag(topic) == safety.Emergency("self_harm")


def test_odd_input_does_not_raise():
    for t in ["\ud800 kill myself", "\udfff", "", "\x00" * 600]:
        safety.red_flag(t)


def test_curly_apostrophes_and_spacing_are_normalized():
    assert safety.red_flag("I  can’t   breathe") == safety.Emergency("medical")


def test_every_list_entry_is_lowercase_and_unique():
    lists = [safety.SELF_HARM_ALWAYS_EN, safety.SELF_HARM_ALWAYS_TH, safety.SELF_HARM_EN, safety.SELF_HARM_TH,
             safety.MEDICAL_EN, safety.MEDICAL_TH, safety.PERSONAL_EN, safety.PERSONAL_TH, safety.RESEARCH_EN,
             safety.RESEARCH_TH]
    for entries in lists:
        assert len(set(entries)) == len(entries)
        assert all(e == e.lower().strip() and e for e in entries)


def test_messages_are_fixed_and_never_echo_the_topic():
    topic = "my father cannot breathe"
    flag = safety.red_flag(topic)
    for lang in ("th", "en"):
        assert topic not in flag.message(lang) and "father" not in flag.message(lang)
    assert safety.refusal_message("personal_medical", "th").startswith("บริการนี้สรุปงานวิจัยเกี่ยวกับกลุ่มประชากร")
    assert "1669" in safety.refusal_message("personal_medical", "en")
    assert safety.refusal_message("personal_medical", "fr") == safety.MESSAGES["personal_medical"]["en"]


def test_refusal_codes_of_stored_reviews():
    error = safety.rejection_error("personal_medical")
    assert error.startswith("personal_medical: This service summarises research")
    assert safety.refusal_code_of("rejected", error) == "personal_medical"
    assert safety.refusal_code_of("rejected", "The topic is not a biomedical research question.") == "declined"
    assert safety.refusal_code_of("rejected", None) == "declined"
    assert safety.refusal_code_of("done", error) is None and safety.refusal_code_of("error", "x") is None
    assert set(safety.REFUSAL_CODES) == {"emergency", "personal_medical", "declined"}
