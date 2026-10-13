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
