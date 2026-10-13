"""Plan 26: public safety rails. Pure code: no LLM, no network, no database.

Two kinds of request get no review:
- **emergency**: the topic reads as an emergency of the person asking, or of someone with them. It is refused before
  any spend (no review row, no rate-limit hit, no LLM call) with a fixed message: call 1669, the Thai emergency
  medical number, and for self-harm also 1323, the Thai mental health hotline.
- **personal_medical**: a question about the asker's own symptoms, diagnosis, dose or treatment choice. The topic
  guard (an LLM) recognises it inside the review job, after one guard call (`app/graph/nodes/intake.py`).

A red-flag phrase alone is not an emergency: "chest pain in the emergency department" is a research topic. It counts
only next to a personal marker (I, my, ฉัน, ผม, ตอนนี้ …) in a topic with no research framing (study, trial, งานวิจัย …).
A few first-person phrases ("kill myself", "อยากตาย") count on their own. Messages never echo the user's text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

EMS_NUMBER = "1669"  # Thai emergency medical services (สพฉ.)
MENTAL_HEALTH_NUMBER = "1323"  # Thai mental health hotline (กรมสุขภาพจิต), 24 hours

# Refusal codes shared by REST and MCP: "emergency" is answered at once by ReviewService.create; the other two are
# the topic guard's rejections ("personal_medical" Plan 26, "declined" every other rejection, as before Plan 26).
REFUSAL_CODES: tuple[str, ...] = ("emergency", "personal_medical", "declined")

MESSAGES: dict[str, dict[str, str]] = {
    "emergency": {
        "en": ("This may be an emergency. Call 1669 (Thai emergency medical services) now, or go to the nearest "
               "emergency department. This service summarises research and cannot help in an emergency."),
        "th": ("ข้อความนี้อาจเป็นภาวะฉุกเฉิน โปรดโทร 1669 (บริการการแพทย์ฉุกเฉิน) ทันที หรือไปห้องฉุกเฉินที่ใกล้ที่สุด "
               "บริการนี้สรุปงานวิจัย จึงช่วยในภาวะฉุกเฉินไม่ได้"),
    },
    "self_harm": {
        "en": ("If you are thinking about harming yourself or feel unsafe, you are not alone. Call the Thai mental "
               "health hotline 1323 (24 hours), or 1669 if you are in danger now."),
        "th": ("ถ้าคุณกำลังคิดทำร้ายตัวเองหรือรู้สึกไม่ปลอดภัย คุณไม่ได้อยู่คนเดียว โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง "
               "หรือโทร 1669 ถ้าตอนนี้อยู่ในอันตราย"),
    },
    "personal_medical": {
        "en": ("This service summarises research about groups of people and cannot advise on your own case "
               "(symptoms, diagnosis, dose or treatment choice). Please see a doctor or pharmacist. In an emergency "
               "in Thailand, call 1669."),
        "th": ("บริการนี้สรุปงานวิจัยเกี่ยวกับกลุ่มประชากร จึงให้คำแนะนำเฉพาะกรณีของคุณไม่ได้ เช่น อาการ การวินิจฉัย "
               "ขนาดยา หรือการเลือกการรักษา โปรดปรึกษาแพทย์หรือเภสัชกร หากเป็นภาวะฉุกเฉิน โทร 1669"),
    },
}

# ---- the red-flag list ------------------------------------------------------------------------------------------
# First-person phrases that are an emergency on their own (self-harm).
SELF_HARM_ALWAYS_EN = ("kill myself", "killing myself", "end my life", "ending my life", "take my own life",
                       "i want to die", "i wanna die", "i don't want to live", "i do not want to live",
                       "hurt myself", "hurting myself", "harm myself", "cut myself", "cutting myself")
SELF_HARM_ALWAYS_TH = ("อยากตาย", "อยากฆ่าตัวตาย", "อยากฆ่าตัวเอง", "ไม่อยากมีชีวิตอยู่", "ไม่อยากอยู่แล้ว",
                       "อยากจบชีวิต")
# Red flags that need a personal marker and no research framing.
SELF_HARM_EN = ("suicide", "suicidal", "self-harm", "self harm")
SELF_HARM_TH = ("ฆ่าตัวตาย", "ทำร้ายตัวเอง", "กรีดข้อมือ", "กรีดแขน", "ฆ่าตัวเอง")
MEDICAL_EN = ("chest pain", "chest tightness", "crushing chest", "can't breathe", "cannot breathe", "can not breathe",
              "unable to breathe", "struggling to breathe", "difficulty breathing", "trouble breathing",
              "short of breath", "not breathing", "face drooping", "face is drooping", "slurred speech",
              "one side of my body", "having a stroke", "having a heart attack", "bleeding heavily", "heavy bleeding",
              "won't stop bleeding", "will not stop bleeding", "vomiting blood", "coughing up blood", "overdose",
              "overdosed", "took too many pills", "swallowed poison", "poisoned", "unconscious", "passed out",
              "unresponsive", "having a seizure", "seizing", "convulsing", "throat is swelling", "throat swelling",
              "anaphylaxis", "anaphylactic", "severe allergic reaction")
MEDICAL_TH = ("เจ็บหน้าอก", "แน่นหน้าอก", "หายใจไม่ออก", "หายใจไม่ทัน", "หายใจลำบาก", "หอบเหนื่อยมาก", "ปากเบี้ยว",
              "หน้าเบี้ยว", "พูดไม่ชัด", "แขนขาอ่อนแรง", "อ่อนแรงครึ่งซีก", "ชาครึ่งซีก", "เลือดออกไม่หยุด",
              "เลือดออกมาก", "อาเจียนเป็นเลือด", "ไอเป็นเลือด", "กินยาเกินขนาด", "กินยาเกิน", "ได้รับยาเกินขนาด",
              "กินยาฆ่าแมลง", "กินสารพิษ", "หมดสติ", "ไม่รู้สึกตัว", "ไม่หายใจ", "ชักเกร็ง", "กำลังชัก", "คอบวม",
              "แพ้ยารุนแรง", "แพ้อย่างรุนแรง")
# Personal markers: the asker or someone with them, now. A Roman "I" after type/phase/class/grade/stage is no marker.
PERSONAL_EN = ("i", "i'm", "im", "i've", "i am", "me", "my", "myself", "someone", "somebody", "right now", "just now")
PERSONAL_TH = ("ฉัน", "ผม", "ดิฉัน", "หนู", "เรา", "กู", "ตัวเอง", "ตอนนี้", "เมื่อกี้", "เมื่อกี๊", "ช่วยด้วย")
# Research framing: the topic asks about evidence for a population, so a red flag in it is a research subject.
RESEARCH_EN = ("study", "studies", "trial", "research", "evidence", "review", "systematic", "meta-analys",
               "meta analys", "cohort", "efficacy", "effectiveness", "incidence", "prevalence", "patients",
               "outcomes", "randomi")  # word starts: "trials", "researching", "meta-analyses", "randomized"
RESEARCH_TH = ("งานวิจัย", "วิจัย", "การศึกษา", "ศึกษา", "ทบทวน", "ประสิทธิผล", "ประสิทธิภาพ", "หลักฐาน",
               "อุบัติการณ์", "ความชุก", "ผู้ป่วย")

_ROMAN_I = r"(?<!type )(?<!phase )(?<!class )(?<!grade )(?<!stage )"


def _english(phrases: tuple[str, ...], *, prefix: bool = False) -> re.Pattern[str]:
    """Whole words; with `prefix`, a word may go on ("research" matches "researching", "trial" matches "trials")."""
    parts = [(_ROMAN_I if p == "i" else "") + re.escape(p) for p in sorted(phrases, key=len, reverse=True)]
    return re.compile(r"(?<![a-z'])(?:" + "|".join(parts) + ")" + ("" if prefix else r"(?![a-z'])"))


_ALWAYS_EN, _SELF_HARM_EN = _english(SELF_HARM_ALWAYS_EN), _english(SELF_HARM_EN)
_MEDICAL_EN, _PERSONAL_EN = _english(MEDICAL_EN), _english(PERSONAL_EN)
_RESEARCH_EN = _english(RESEARCH_EN, prefix=True)


@dataclass(frozen=True)
class Emergency:
    kind: Literal["medical", "self_harm"]

    @property
    def hotlines(self) -> list[str]:
        return [MENTAL_HEALTH_NUMBER, EMS_NUMBER] if self.kind == "self_harm" else [EMS_NUMBER]

    def message(self, language: str) -> str:
        return MESSAGES["self_harm" if self.kind == "self_harm" else "emergency"][_lang(language)]


def _lang(language: str) -> str:
    return "th" if language == "th" else "en"


def normalize(topic: str) -> str:
    return " ".join((topic or "").lower().replace("’", "'").split())


def _has(text: str, english: re.Pattern[str], thai: tuple[str, ...]) -> bool:
    return bool(english.search(text)) or any(t in text for t in thai)


def red_flag(topic: str) -> Emergency | None:
    """The emergency a topic reads as, or None. Deterministic; see the module docstring for the rule."""
    text = normalize(topic)
    if _has(text, _ALWAYS_EN, SELF_HARM_ALWAYS_TH):
        return Emergency("self_harm")
    if not _has(text, _PERSONAL_EN, PERSONAL_TH) or _has(text, _RESEARCH_EN, RESEARCH_TH):
        return None
    if _has(text, _SELF_HARM_EN, SELF_HARM_TH):
        return Emergency("self_harm")
    if _has(text, _MEDICAL_EN, MEDICAL_TH):
        return Emergency("medical")
    return None


def refusal_message(code: str, language: str) -> str:
    return MESSAGES[code][_lang(language)]


def rejection_error(code: str) -> str:
    """The review's stored `error` for a guard rejection with a code: "<code>: <English message>"."""
    return f"{code}: {MESSAGES[code]['en']}"


def refusal_code_of(status: str | None, error: str | None) -> str | None:
    """The refusal code of a stored review: "personal_medical" when the guard refused a personal question, "declined"
    for every other rejection (the topic filter's own reason), None when the review was not rejected."""
    if status != "rejected":
        return None
    return "personal_medical" if (error or "").startswith("personal_medical: ") else "declined"
