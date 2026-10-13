"""Plan 26: public safety rails. Pure code: no LLM, no network, no database.

Two kinds of request get no review:
- **emergency**: the topic reads as an emergency of the person asking, or of someone with them. It is refused before
  any spend (no review row, no rate-limit hit, no LLM call) with a fixed message: call 1669, the Thai emergency
  medical number, and for self-harm also 1323, the Thai mental health hotline.
- **personal_medical**: a question about the asker's own symptoms, diagnosis, dose or treatment choice. The topic
  guard (an LLM) recognises it inside the review job, after one guard call (`app/graph/nodes/intake.py`).

A red-flag phrase alone is not an emergency: "chest pain in the emergency department" is a research topic. It counts
only next to a personal marker (I, my, ฉัน, ผม, ตอนนี้ …) in a topic with no research framing (study, trial, งานวิจัย …).
Thai drops pronouns, so a Thai medical red flag with no research word counts without a marker. A few first-person
phrases ("kill myself", "อยากตาย") count on their own. Messages never echo the user's text.
"""
from __future__ import annotations

import re
import unicodedata
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
# First-person phrases that are an emergency on their own (self-harm). Known trade-off: these IGNORE research framing
# by design, because a missed self-harm message costs more than a refused research topic. Phrasings that are refused
# although they could be research: "i want to die with dignity: euthanasia attitudes", "assisted dying: end my life
# laws", "cutting myself: dialectical behaviour therapy", "อยากตายอย่างสงบ: การดูแลระยะท้าย", "ไม่อยากอยู่แล้ว ภาวะซึมเศร้า".
# Rephrase such a topic in the third person ("euthanasia attitudes among patients") to get a review.
SELF_HARM_ALWAYS_EN = ("kill myself", "killing myself", "kill my self", "end my life", "ending my life",
                       "take my own life", "end it all", "kms", "i want to die", "i wanna die",
                       "i don't want to live", "i do not want to live", "hurt myself", "hurting myself",
                       "harm myself", "cut myself", "cutting myself")
SELF_HARM_ALWAYS_TH = ("อยากตาย", "อยากฆ่าตัวตาย", "อยากฆ่าตัวเอง", "ไม่อยากมีชีวิตอยู่", "ไม่อยากอยู่แล้ว",
                       "อยากจบชีวิต", "คิดจะฆ่าตัวตาย", "คิดฆ่าตัวตาย")
# Red flags that need a personal marker and no research framing.
SELF_HARM_EN = ("suicide", "suicidal", "self-harm", "self harm")
SELF_HARM_TH = ("ฆ่าตัวตาย", "ทำร้ายตัวเอง", "กรีดข้อมือ", "กรีดแขน", "ฆ่าตัวเอง")
MEDICAL_EN = ("chest pain", "chestpain", "chest tightness", "crushing chest", "can't breathe", "cannot breathe",
              "can not breathe", "unable to breathe", "struggling to breathe", "difficulty breathing",
              "trouble breathing", "short of breath", "not breathing", "face drooping", "face is drooping",
              "slurred speech", "one side of my body", "having a stroke", "had a stroke", "having a heart attack",
              "heart attack", "bleeding heavily", "heavy bleeding", "bleeding a lot", "won't stop bleeding",
              "will not stop bleeding", "vomiting blood", "coughing up blood", "overdose", "overdosed",
              "took too many pills", "swallowed poison", "poisoned", "unconscious", "passed out", "collapsed",
              "unresponsive", "having a seizure", "had a seizure", "seizing", "convulsing", "throat is swelling",
              "throat swelling", "anaphylaxis", "anaphylactic", "severe allergic reaction")
# Regular expressions on the normalized text (apostrophes and hyphens are already gone).
MEDICAL_PATTERNS_EN = (
    r"(?:swallowed|drank|drunk) (?:\w+ ){0,2}(?:bleach|chemicals?|cleaner|detergent)",
    r"took \d+ (?:\w+ ){0,2}?(?:pills|tablets|capsules|paracetamol|acetaminophen|aspirin|ibuprofen|panadol|tylenol)",
)
MEDICAL_TH = ("เจ็บหน้าอก", "แน่นหน้าอก", "หายใจไม่ออก", "หายใจไม่ทัน", "หายใจลำบาก", "หอบเหนื่อยมาก", "ปากเบี้ยว",
              "หน้าเบี้ยว", "พูดไม่ชัด", "แขนขาอ่อนแรง", "อ่อนแรงครึ่งซีก", "ชาครึ่งซีก", "เลือดออกไม่หยุด",
              "เลือดออกมาก", "อาเจียนเป็นเลือด", "ไอเป็นเลือด", "กินยาเกินขนาด", "กินยาเกิน", "ได้รับยาเกินขนาด",
              "กินยาฆ่าแมลง", "กินสารพิษ", "หมดสติ", "ไม่รู้สึกตัว", "ไม่หายใจ", "ชักเกร็ง", "กำลังชัก", "คอบวม",
              "แพ้ยารุนแรง", "แพ้อย่างรุนแรง", "กลืนน้ำยา", "กินน้ำยา", "ดื่มน้ำยา", "ชักอยู่", "ชักไม่หยุด",
              "เพื่อนชัก", "แม่ชัก", "พ่อชัก", "ลูกชัก", "สามีชัก", "ภรรยาชัก", "แฟนชัก")
# Applied to the text with all whitespace removed (Thai has no word spaces).
MEDICAL_PATTERNS_TH = (r"กินยา.{0,12}[\d๐-๙]+เม็ด",)
# Personal markers: the asker or someone with them, now. A Roman "I" after type/phase/class/grade/stage is no marker.
#
# PRECISION RULE (Plan 26 fix round 2). This pass aims at high precision; the topic guard (an LLM, `personal_medical`,
# first node of the review job) is the backstop for anything it lets through. A medical red flag needs an explicit
# personal anchor: English I / I'm / me / my / our (so "my|our <kin>" is covered) / someone / right now; Thai
# first-person pronouns, or a kin word at the very start of the topic or right before a pronoun (แม่ฉัน). Standalone
# help / now / urgent / child / kid / son / baby / friend are NOT anchors. Compounds in NONPERSONAL_TH neutralise only the
# marker they contain. A Thai topic with no anchor still counts when it is short (at most 40 characters without spaces)
# and has no framer (FRAMERS_TH) and no research word, because Thai drops pronouns ("เจ็บหน้าอกมาก หายใจไม่ออก").
# Known misses handed to the guard: English without an anchor ("dad is having a stroke what to do", "baby not
# breathing", "someone"-less third person), a long Thai description of an emergency, and any framed Thai sentence.
PERSONAL_EN = ("i", "i'm", "im", "i've", "i am", "me", "my", "our", "myself", "someone", "somebody", "right now",
               "just now")
PERSONAL_TH = ("ฉัน", "ดิฉัน", "ผม", "หนู", "เรา", "กู")  # pronouns; เรา not before ะ (หัวเราะ), กู not กู้ (resuscitation)
KINSHIP_TH = ("แม่", "พ่อ", "ลูก", "สามี", "ภรรยา", "แฟน", "เพื่อน", "ยาย", "ปู่", "ย่า", "น้อง", "พี่")  # no "ตา" (eye)
# Compounds where a pronoun or kin word is part of another word.
NONPERSONAL_TH = ("ลูกน้ำ", "ลูกค้า", "ลูกเห็บ", "แม่น้ำ", "แม่บ้าน", "แม่ครัว", "พ่อแม่", "พี่เลี้ยง", "พี่น้อง",
                  "ขยาย", "แฟนตาซี", "ผมร่วง", "ผมบาง", "ผมหงอก", "เส้นผม", "หนูทดลอง", "หนูตะเภา", "ในหนู",
                  "น้องหมา", "น้องแมว")
# Words that frame a Thai topic as a subject (not a conversation): the no-anchor rule does not apply.
FRAMERS_TH = ("ภาวะ", "การ", "อาการ", "สาเหตุ", "ปัจจัย", "ผล", "ความ", "สำหรับ", "หลัง", "ใน", "ของ", "กับ",
              "ระหว่าง", "ต่อ", "เทียบ", "ป้องกัน", "รักษา")
PRO_DROP_MAX_CHARS = 40
# Research framing: the topic asks about evidence for a population, so a red flag in it is a research subject.
RESEARCH_EN = ("study", "studies", "trial", "research", "evidence", "review", "systematic", "meta-analys",
               "meta analys", "cohort", "efficacy", "effectiveness", "incidence", "prevalence", "patients",
               "outcomes", "randomi", "management", "manage", "triage", "guideline", "treatment", "nurse",
               "clinician", "physician", "doctors")  # word starts: "trials", "researching", "meta-analyses", "nurses"
RESEARCH_TH = ("งานวิจัย", "วิจัย", "การศึกษา", "ศึกษา", "ทบทวน", "ประสิทธิผล", "ประสิทธิภาพ", "หลักฐาน",
               "อุบัติการณ์", "ความชุก", "ผู้ป่วย", "อยากรู้เรื่อง", "อยากทราบ", "แนวทาง")

_ROMAN_I = r"(?<!type )(?<!phase )(?<!class )(?<!grade )(?<!stage )"
_ZERO_WIDTH = dict.fromkeys([*range(0x200B, 0x200E), 0x2060, 0xFEFF])
_APOSTROPHES = dict.fromkeys(map(ord, "'’‘`´"))


def normalize(topic: str) -> str:
    """NFKC, lower case, no zero-width characters or apostrophes, hyphens as spaces, "can t" as "cant", Thai
    nikhahit + sara aa folded to sara am, single spaces."""
    text = unicodedata.normalize("NFKC", topic or "").lower().translate(_ZERO_WIDTH).translate(_APOSTROPHES)
    text = text.replace("ํา", "ำ").replace("-", " ")
    text = re.sub(r"\b(can|don|won|didn|couldn|isn|wasn) t\b", r"\1t", text)
    return " ".join(text.split())


def _nospace(text: str) -> str:
    return "".join(text.split())


def _norm_en(phrases: tuple[str, ...]) -> list[str]:
    return list(dict.fromkeys(normalize(p) for p in phrases))


def _norm_th(phrases: tuple[str, ...]) -> list[str]:
    return list(dict.fromkeys(_nospace(normalize(p)) for p in phrases))


def _english(phrases: tuple[str, ...], *, prefix: bool = False, patterns: tuple[str, ...] = ()) -> re.Pattern[str]:
    """Whole words; with `prefix`, a word may go on ("research" matches "researching", "trial" matches "trials")."""
    parts = []
    for p in sorted(_norm_en(phrases), key=len, reverse=True):
        if p == "i":
            parts.append(_ROMAN_I + r"i(?!\.[a-z])")  # not "i.v." or "i.e."
        elif p in ("someone", "somebody"):
            parts.append(p + r"(?! with| who)")
        else:
            parts.append(re.escape(p))
    parts += list(patterns)
    return re.compile(r"(?<![a-z])(?:" + "|".join(parts) + ")" + ("" if prefix else r"(?![a-z])"))


def _thai(phrases: tuple[str, ...], patterns: tuple[str, ...] = ()) -> re.Pattern[str]:
    return re.compile("|".join([re.escape(p) for p in _norm_th(phrases)] + list(patterns)))


_ALWAYS_EN, _SELF_HARM_EN = _english(SELF_HARM_ALWAYS_EN), _english(SELF_HARM_EN)
_MEDICAL_EN = _english(MEDICAL_EN, patterns=MEDICAL_PATTERNS_EN)
_PERSONAL_EN, _RESEARCH_EN = _english(PERSONAL_EN), _english(RESEARCH_EN, prefix=True)
_ALWAYS_TH, _SELF_HARM_TH = _thai(SELF_HARM_ALWAYS_TH), _thai(SELF_HARM_TH)
_MEDICAL_TH = _thai(MEDICAL_TH, MEDICAL_PATTERNS_TH)
_RESEARCH_TH, _FRAMERS_TH, _NONPERSONAL_TH = _thai(RESEARCH_TH), _thai(FRAMERS_TH), _thai(NONPERSONAL_TH)
_PRONOUN = "|".join(re.escape(p) for p in _norm_th(PERSONAL_TH) if p not in ("เรา", "กู")) + r"|เรา(?!ะ)|(?<![ก-ฮ])กู(?![ะ-ฺ็-๎])"
_KIN = "|".join(re.escape(k) for k in _norm_th(KINSHIP_TH))
# a pronoun, or a kin word at the very start or right before a pronoun; applied after _NONPERSONAL_TH spans are blanked
_ANCHOR_TH = re.compile(rf"(?:{_PRONOUN})|^(?:{_KIN})|(?:{_KIN})(?:ของ)?(?:{_PRONOUN})")


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


def red_flag(topic: str) -> Emergency | None:
    """The emergency a topic reads as, or None. Deterministic; see the module docstring for the rule."""
    text = normalize(topic)
    th = _nospace(text)  # Thai lists are matched without spaces
    if _ALWAYS_EN.search(text) or _ALWAYS_TH.search(th):
        return Emergency("self_harm")
    if _RESEARCH_EN.search(text) or _RESEARCH_TH.search(th):
        return None
    anchored_th = bool(_ANCHOR_TH.search(_NONPERSONAL_TH.sub("\0", th)))
    personal = anchored_th or bool(_PERSONAL_EN.search(text))
    # Thai drops pronouns: a short, unframed Thai topic counts without an anchor
    pro_drop = len(th) <= PRO_DROP_MAX_CHARS and not _FRAMERS_TH.search(th)
    if _SELF_HARM_EN.search(text) and personal or _SELF_HARM_TH.search(th) and (anchored_th or pro_drop):
        return Emergency("self_harm")
    if personal and _MEDICAL_EN.search(text) or _MEDICAL_TH.search(th) and (anchored_th or pro_drop):
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
