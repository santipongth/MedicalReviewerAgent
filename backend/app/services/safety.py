"""Plan 26: public safety rails. Pure code: no LLM, no network, no database.

Two kinds of request get no review:
- **emergency**: the topic reads as an emergency of the person asking, or of someone with them. It is refused before
  any spend (no review row, no rate-limit hit, no LLM call) with a fixed message: call 1669, the Thai emergency
  medical number, and for self-harm also 1323, the Thai mental health hotline.
- **personal_medical**: a question about the asker's own symptoms, diagnosis, dose or treatment choice. The topic
  guard (an LLM) recognises it inside the review job, after one guard call (`app/graph/nodes/intake.py`).

A red-flag phrase alone is not an emergency: "chest pain in the emergency department" is a research topic. It counts
only next to a personal marker (I, my, ฉัน, ผม, ตอนนี้ …) in a topic with no research framing (study, trial, งานวิจัย …).
A short conversational topic counts without a marker (see PRECISION RULE below). A few first-person
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
               "in Thailand, call 1669. If the issue is suicidal thoughts or self-harm, call 1323 (Thai mental "
               "health hotline)."),
        "th": ("บริการนี้สรุปงานวิจัยเกี่ยวกับกลุ่มประชากร จึงให้คำแนะนำเฉพาะกรณีของคุณไม่ได้ เช่น อาการ การวินิจฉัย "
               "ขนาดยา หรือการเลือกการรักษา โปรดปรึกษาแพทย์หรือเภสัชกร หากเป็นภาวะฉุกเฉิน โทร 1669 "
               "หากเป็นเรื่องความคิดอยากทำร้ายตัวเอง โทร 1323 (สายด่วนสุขภาพจิต 1323)"),
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
              "throat swelling", "anaphylaxis", "anaphylactic", "severe allergic reaction", "choking")
# Regular expressions on the normalized text (apostrophes and hyphens are already gone).
_PILLS_EN = r"(?:pills|tablets|capsules|meds|paracetamol|acetaminophen|aspirin|ibuprofen|panadol|tylenol)"
MEDICAL_PATTERNS_EN = (
    r"(?:swallowed|drank|drunk) (?:\w+ ){0,2}(?:bleach|chemicals?|cleaner|detergent)",
    r"swallowed (?:a |an |two |some |\d+ )?(?:button |coin |lithium )?batter(?:y|ies)",
    r"took \d+ (?:\w+ ){0,2}?" + _PILLS_EN,
    r"took (?:a |an )?(?:whole |full |entire )?(?:bottle|pack|packet|strip|box) of (?:\w+ ){0,2}?" + _PILLS_EN,
    # Plan 30: two misses of the Plan 26 held-out check; a verb is required, so "coin ingestion" or "rat poison
    # exposure" stay titles, and the anchor or cue rule applies as to every red flag
    r"swallowed (?:a |an |two |some |\d+ )?coins?",
    r"(?:ate|eaten|swallowed|drank|drunk) (?:some )?(?:rat|mouse|rodent) (?:poison|bait)",
)
MEDICAL_TH = ("เจ็บหน้าอก", "แน่นหน้าอก", "หายใจไม่ออก", "หายใจไม่ทัน", "หายใจลำบาก", "หอบเหนื่อยมาก", "ปากเบี้ยว",
              "หน้าเบี้ยว", "พูดไม่ชัด", "แขนขาอ่อนแรง", "อ่อนแรงครึ่งซีก", "ชาครึ่งซีก", "เลือดออกไม่หยุด",
              "เลือดออกมาก", "อาเจียนเป็นเลือด", "ไอเป็นเลือด", "กินยาเกินขนาด", "กินยาเกิน", "ได้รับยาเกินขนาด",
              "กินยาฆ่าแมลง", "กินสารพิษ", "หมดสติ", "ไม่รู้สึกตัว", "ไม่หายใจ", "ชักเกร็ง", "กำลังชัก", "คอบวม",
              "แพ้ยารุนแรง", "แพ้อย่างรุนแรง", "กลืนน้ำยา", "กินน้ำยา", "ดื่มน้ำยา", "ชักอยู่", "ชักไม่หยุด",
              "เพื่อนชัก", "แม่ชัก", "พ่อชัก", "ลูกชัก", "สามีชัก", "ภรรยาชัก", "แฟนชัก")
# Applied to the text with all whitespace removed (Thai has no word spaces).
MEDICAL_PATTERNS_TH = (r"กินยา.{0,12}[\d๐-๙]+เม็ด", r"กินยา.{0,12}ทั้ง(?:แผง|ขวด|กระปุก)")
# Personal markers: the asker or someone with them, now. A Roman "I" after type/phase/class/grade/stage is no marker.
#
# PRECISION RULE (Plan 26 fix round 4). This pass aims at high precision: a realistic research title must not be
# refused. The topic guard (an LLM, `personal_medical`, first node of the review job; its refusal also lists 1669) is
# the backstop for every emergency this pass lets through. A topic with a research word (RESEARCH_EN/TH) is never
# flagged, except by the self-harm "always" phrases. Otherwise a medical red flag counts when:
# - it has an explicit personal anchor: English I / I'm / me / my / our (so "my|our <kin>" is covered) / right now /
#   "someone" or "somebody" only as the opening subject or right after a plea ("help someone …"), and then not beside
#   a strong framer (STRONG_FRAMERS_EN), not before a colon subtitle unless the message is urgent; Thai
#   first-person pronouns, or a kin word at the very start of the topic (not followed by ที่ / ของ / และ,
#   which make a population title: "แม่ที่มีภาวะ…", "พ่อและแม่…") or right before a pronoun (แม่ฉัน). Standalone help / now / urgent / kin words are NOT anchors. Compounds in NONPERSONAL_TH neutralise only
#   the marker they contain; or
# - Thai, no anchor (Thai drops pronouns): the topic is short (at most 40 characters without spaces) and has no framer
#   (FRAMERS_TH, including connectors such as จาก / และ / ลด / แก้ / ต้าน / ขณะ, or a leading ยา "drug"):
#   "เจ็บหน้าอกมาก หายใจไม่ออก" counts, "เจ็บหน้าอกจากกรดไหลย้อน" does not; or
# - English, no anchor: the topic has at most 8 words, no framing word (FRAMERS_EN) outside the red-flag phrase, AND a
#   conversational cue (CUES_EN: a kin word, a pronoun, a verb such as has / took, a negation such as cant, or an
#   urgency word such as help / now / what to do; question and first-aid words such as why / how / first aid are
#   framers): "baby not breathing" and "mom collapsed please help" count; a
#   noun-phrase title such as "heart attack aspirin" or "slurred speech thrombectomy" has no cue and does not.
#   Noun-like flags (NOANCHOR_EXCLUDED_EN: overdose, anaphylaxis ...) always need an anchor.
# Plan 31 (D1-D3): the text is folded first (`fold_typos`: runs of three or more identical letters, and a fixed table of
# red-flag misspellings); on the English no-anchor path an "and" next to a red flag joins two flags and is no framer;
# "someone" is an anchor only as the opening subject or after a plea, and not beside a strong framer
# (STRONG_FRAMERS_EN); "if/when/whenever/should/can/could + someone/somebody/a person" is a generic frame unless
# the message is urgent; "to help" is
# neither cue nor urgency word (nor "help seeking"); a Thai kin word followed by และ is a population. The and-joiner
# joins only when the other side is another flag or a person's state (STATE_WORDS_EN: "chest pain and sweating", not
# "choking and baby led weaning"); a colon subtitle blocks the "someone" anchor unless the message is urgent.
# Blind sets (research refused of 70, traps refused of 15, emergencies caught of 30):
# set A master 9 / 4 / 11, first Plan 31 pass 0 / 0 / 27, final 0 / 0 / 25;
# set B master not measured, first Plan 31 pass 8 / 1 / 28, final 0 / 0 / 27.
# Known misses handed to the guard: an English message with no anchor and no cue ("took a whole bottle of sleeping
# pills" passes only because "took" is a cue; "swallowed a battery" alone does not), a longer or framed English
# description, a long Thai description, any framed Thai sentence with no anchor.
PERSONAL_EN = ("i", "i'm", "im", "i've", "i am", "me", "my", "our", "myself", "right now", "just now")
PERSONAL_TH = ("ฉัน", "ดิฉัน", "ผม", "หนู", "เรา", "กู")  # pronouns; เรา not before ะ (หัวเราะ), กู not กู้ (resuscitation)
KINSHIP_TH = ("แม่", "พ่อ", "ลูก", "สามี", "ภรรยา", "แฟน", "เพื่อน", "ยาย", "ปู่", "ย่า", "น้อง", "พี่")  # no "ตา" (eye)
# Compounds where a pronoun or kin word is part of another word.
NONPERSONAL_TH = ("ลูกน้ำ", "ลูกค้า", "ลูกเห็บ", "แม่น้ำ", "แม่บ้าน", "แม่ครัว", "พ่อแม่", "พี่เลี้ยง", "พี่น้อง",
                  "ขยาย", "แฟนตาซี", "ผมร่วง", "ผมบาง", "ผมหงอก", "เส้นผม", "หนูทดลอง", "หนูตะเภา", "ในหนู",
                  "น้องหมา", "น้องแมว", "ยาย่อย", "ยายับยั้ง")  # ยาย่อย / ยายับยั้ง are drugs, not ยาย
# Words that frame a Thai topic as a subject (not a conversation): the no-anchor rule does not apply.
FRAMERS_TH = ("ภาวะ", "การ", "อาการ", "สาเหตุ", "ปัจจัย", "ผล", "ความ", "สำหรับ", "หลัง", "ใน", "ของ", "กับ",
              "ระหว่าง", "ต่อ", "เทียบ", "ป้องกัน", "รักษา", "จาก", "และ", "ลด", "แก้", "ต้าน", "ขณะ",
              "ยาย่อย", "ยายับยั้ง")
FRAMER_PATTERNS_TH = (r"^ยา(?!ย)",)  # a topic that starts with ยา ("drug ...") names a treatment; ยาย is grandma
PRO_DROP_MAX_CHARS = 40
# English mirror of the short-topic rule: a medical red flag with no anchor counts when the topic has at most
# SHORT_EN_MAX_WORDS words, none of these framing words outside the red-flag phrase (any RESEARCH_EN word already
# returned None), and a conversational cue (CUES_EN). Noun-like flags that are usually a subject are not eligible
# without an anchor (NOANCHOR_EXCLUDED_EN).
SHORT_EN_MAX_WORDS = 8
# "not" is no cue ("not breathing newborn resuscitation" is a title); "baby not breathing" is caught through "baby".
# Neither are is / are / was: titles use them ("is coughing up blood always cancer").
CUES_EN = ("help", "now", "please", "urgent", "asap", "quick", "quickly", "hurry", "what to do", "what do i do",
           "what should i do", "he", "she", "they", "him", "her", "his", "has", "just", "keeps",
           "took", "mom", "mum", "mother", "dad", "father", "baby", "son", "daughter", "husband", "wife", "child",
           "kid", "brother", "sister", "friend", "grandma", "grandpa", "granny", "grandmother", "grandfather",
           "boyfriend", "girlfriend", "partner", "cant", "wont", "pls", "plz")
FRAMERS_EN = ("in", "of", "for", "among", "with", "without", "vs", "versus", "compared", "effect", "effects", "risk",
              "risks", "therapy", "prevention", "policy", "deaths", "death", "mortality", "causes", "cause",
              "factors", "factor", "guidelines", "and", "or", "by", "on", "from", "after", "during", "between",
              "about", "symptoms", "signs", "syndrome", "recovery", "care", "know", "lung", "than",
              "as", "at", "rate", "rates", "epidemiology", "overview", "history", "definition",
              "lines", "leading", "protests", "pollution", "why", "how", "what is", "first aid", "when to", "always",
              "sign")
# Plan 31 (D3): "someone" is no general anchor. These research-noun and question framers of FRAMERS_EN also stop the
# opening "someone ..." / "help someone ..." anchor; prepositions (in, after, at) do not.
STRONG_FRAMERS_EN = ("effect", "effects", "risk", "risks", "therapy", "prevention", "policy", "deaths", "death",
                     "mortality", "causes", "cause", "factors", "factor", "guidelines", "symptoms", "signs", "sign",
                     "syndrome", "recovery", "care", "epidemiology", "overview", "history", "definition", "rate",
                     "rates", "versus", "vs", "compared", "why", "how", "what is", "first aid", "when to")
# Plan 31: an "and" next to a red flag joins two flags only when the other side is a person's state, not a topic.
STATE_WORDS_EN = ("is", "was", "are", "has", "had", "cant", "cannot", "wont", "not", "no", "turning", "getting",
                  "going", "sweating", "shaking", "vomiting", "fell", "fainted", "lost", "losing", "unable", "still",
                  "keeps", "started", "stopped")
URGENT_EN = ("help", "now", "please", "pls", "plz", "urgent", "asap", "quick", "quickly", "hurry")
NOANCHOR_EXCLUDED_EN = ("anaphylaxis", "anaphylactic", "severe allergic reaction", "overdose", "overdosed")
# Research framing: the topic asks about evidence for a population, so a red flag in it is a research subject.
RESEARCH_EN = ("study", "studies", "trial", "research", "evidence", "review", "systematic", "meta-analys",
               "meta analys", "cohort", "efficacy", "effectiveness", "incidence", "prevalence", "patient",
               "outcomes", "randomi", "management", "manage", "triage", "guideline", "treatment", "nurse",
               "clinician", "physician", "doctors")  # word starts: "trials", "researching", "meta-analyses", "nurses", "patients"
RESEARCH_TH = ("งานวิจัย", "วิจัย", "การศึกษา", "ศึกษา", "ทบทวน", "ประสิทธิผล", "ประสิทธิภาพ", "หลักฐาน",
               "อุบัติการณ์", "ความชุก", "ผู้ป่วย", "อยากรู้เรื่อง", "อยากทราบ", "แนวทาง")

_ROMAN_I = r"(?<!type )(?<!phase )(?<!class )(?<!grade )(?<!stage )"
# Plan 31 (D1): misspellings of red-flag words only (each has no research reading), applied whole-word to the
# normalized text before any list is matched.
TYPOS_EN: tuple[tuple[str, str], ...] = (
    (r"(?<![a-z])(?:cn+t|cannt)(?= (?:breath|breth|brethe|breate|breathe|talk|speak|move|wake|stand|walk|see|feel"
     + r"|swallow|stop)(?![a-z]))", "cant"),  # not the abbreviation CNT
    (r"(?<![a-z])(cant|cannot|can not|unable to|struggling to) (?:breath|breth|brethe|breate)(?![a-z])",
     r"\1 breathe"),
    (r"(?<![a-z])(?:breating|brething)(?![a-z])", "breathing"),
    (r"(?<![a-z])(?:chest pian|chest pane|chest pai|chset pain|chets pain|chset pian)(?![a-z])", "chest pain"),
    (r"(?<![a-z])(?:unconcious|unconsious|unconscous)(?![a-z])", "unconscious"),
    (r"(?<![a-z])(?:siezures?|seizur|sezure|seisure)(?![a-z])", "seizure"),
    (r"(?<![a-z])(?:chocking|chokeing)(?![a-z])", "choking"),
    (r"(?<![a-z])(?:bleding|bledding|bleedin)(?![a-z])", "bleeding"),
    (r"(?<![a-z])overdoze(?![a-z])", "overdose"),
    (r"(?<![a-z])overdozed(?![a-z])", "overdosed"),
    (r"(?<![a-z])(?:poisend|posioned)(?![a-z])", "poisoned"),
    (r"(?<![a-z])(?:colapsed|collasped)(?![a-z])", "collapsed"),
    (r"(?<![a-z])(?:heart|hart) (?:atack|attak|attac)(?![a-z])", "heart attack"),
    (r"(?<![a-z])hart attack(?![a-z])", "heart attack"),
    (r"(?<![a-z])alot(?![a-z])", "a lot"),
)
TYPOS_TH: tuple[tuple[str, str], ...] = (("เจบ", "เจ็บ"),)  # only before หน้าอก / อก
_TYPOS_EN = tuple((re.compile(p), r) for p, r in TYPOS_EN)
_LETTER_RUN = re.compile(r"([^\W\d_])\1{2,}")
_LETTERS = re.compile(r"[^\W\d_]+")
_ROMAN_WORD = re.compile(r"[ivxlcdm]+")  # "iii" in "NYHA III" is a numeral, never folded into the pronoun "i"


def fold_typos(text: str) -> str:
    """Fold an already normalized text: runs of three or more identical letters become one ("helppp", "อยากตายยย"),
    then the fixed table of red-flag misspellings (TYPOS_EN, TYPOS_TH)."""
    text = _LETTERS.sub(lambda m: m[0] if _ROMAN_WORD.fullmatch(m[0]) else _LETTER_RUN.sub(r"\1", m[0]), text)
    for pattern, repl in _TYPOS_EN:
        text = pattern.sub(repl, text)
    for wrong, right in TYPOS_TH:
        text = re.sub(re.escape(wrong) + r"(?=\s*(?:หน้าอก|อก))", right, text)
    return text


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
        elif p == "kms":
            parts.append(r"(?<!\d)(?<!\d )kms")  # not kilometres: "10 kms", "20kms"
        else:
            parts.append(re.escape(p))
    parts += list(patterns)
    return re.compile(r"(?<![a-z])(?:" + "|".join(parts) + ")" + ("" if prefix else r"(?![a-z])"))


def _thai(phrases: tuple[str, ...], patterns: tuple[str, ...] = ()) -> re.Pattern[str]:
    return re.compile("|".join([re.escape(p) for p in _norm_th(phrases)] + list(patterns)))


_ALWAYS_EN, _SELF_HARM_EN = _english(SELF_HARM_ALWAYS_EN), _english(SELF_HARM_EN)
_MEDICAL_EN = _english(MEDICAL_EN, patterns=MEDICAL_PATTERNS_EN)
_PERSONAL_EN, _RESEARCH_EN = _english(PERSONAL_EN), _english(RESEARCH_EN, prefix=True)
_FRAMERS_EN, _CUES_EN = _english(FRAMERS_EN), _english(CUES_EN)
_MEDICAL_EN_NOANCHOR = _english(tuple(p for p in MEDICAL_EN if p not in NOANCHOR_EXCLUDED_EN),
                                patterns=MEDICAL_PATTERNS_EN)
_STRONG_FRAMERS_EN, _URGENT_EN = _english(STRONG_FRAMERS_EN), _english(URGENT_EN)
_SOMEONE_ANCHOR = re.compile(r"^(?:(?:please|pls|plz) )?(?:help )?(?:someone|somebody)(?! with| who)(?![a-z])")
# a generic question about "someone" (not this person now): a framer unless the message is urgent
_GENERIC_FRAME = re.compile(r"(?<![a-z])(?:if|when|whenever|should|can|could) (?:someone|somebody|a person)(?![a-z])")
_TO_HELP = re.compile(r"(?<![a-z])(?:to help|help seeking)(?![a-z])")
_COLON_SUBTITLE = re.compile(r"(?<!\d):(?!\d)\s*\w")  # not a clock time
_FLAG_MARK = "\x00F"
_AND = re.compile(r"\band\b")
_MARK_OR_WORD = re.compile(_FLAG_MARK + r"|\w+")
_ALWAYS_TH, _SELF_HARM_TH = _thai(SELF_HARM_ALWAYS_TH), _thai(SELF_HARM_TH)
_MEDICAL_TH = _thai(MEDICAL_TH, MEDICAL_PATTERNS_TH)
_RESEARCH_TH, _NONPERSONAL_TH = _thai(RESEARCH_TH), _thai(NONPERSONAL_TH)
_FRAMERS_TH = _thai(FRAMERS_TH, FRAMER_PATTERNS_TH)
_PRONOUN = "|".join(re.escape(p) for p in _norm_th(PERSONAL_TH) if p not in ("เรา", "กู")) + r"|เรา(?!ะ)|(?<![ก-ฮ])กู(?![ะ-ฺ็-๎])"
_KIN = "|".join(re.escape(k) for k in _norm_th(KINSHIP_TH))
# a pronoun, or a kin word at the very start (not a population title: แม่ที่… / ลูกของ…) or right before a pronoun;
# applied after _NONPERSONAL_TH spans are blanked
_ANCHOR_TH = re.compile(rf"(?:{_PRONOUN})|^(?:{_KIN})(?!ที่|ของ|และ)|(?:{_KIN})(?:ของ)?(?:{_PRONOUN})")


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


def _join_flags(marked: str) -> str:
    """Drop each "and" that joins a red flag (marked) to a person's state or to another flag."""
    out, last = [], 0
    for m in _AND.finditer(marked):
        left = _MARK_OR_WORD.findall(marked[:m.start()])[-2:]
        right = _MARK_OR_WORD.findall(marked[m.end():])[:2]
        flag_left, flag_right = _FLAG_MARK in left, _FLAG_MARK in right
        if (flag_left and flag_right or flag_left and right[:1] and right[0] in STATE_WORDS_EN
                or flag_right and left[-1:] and left[-1] in STATE_WORDS_EN):
            out += [marked[last:m.start()], " "]
            last = m.end()
    return "".join(out) + marked[last:]


def red_flag(topic: str) -> Emergency | None:
    """The emergency a topic reads as, or None. Deterministic; see the module docstring for the rule."""
    text = fold_typos(normalize(topic))
    th = _nospace(text)  # Thai lists are matched without spaces
    th_len = len(_nospace(normalize(topic)))  # the message length counts before repeated letters are folded
    if _ALWAYS_EN.search(text) or _ALWAYS_TH.search(th):
        return Emergency("self_harm")
    if _RESEARCH_EN.search(text) or _RESEARCH_TH.search(th):
        return None
    anchored_th = bool(_ANCHOR_TH.search(_NONPERSONAL_TH.sub("\0", th)))
    # "someone" anchors only as the opening subject or after a plea, and not in a research-noun or question frame
    spoken = _TO_HELP.sub(" ", text)
    # a colon subtitle ("someone collapsed: bystander survey") makes it a title unless the message is urgent
    someone = (bool(_SOMEONE_ANCHOR.search(text)) and not _STRONG_FRAMERS_EN.search(_MEDICAL_EN.sub(" ", text))
               and not (_COLON_SUBTITLE.search(text) and not _URGENT_EN.search(spoken)))
    personal = anchored_th or someone or bool(_PERSONAL_EN.search(text))
    # Thai drops pronouns: a short, unframed Thai topic counts without an anchor
    pro_drop = th_len <= PRO_DROP_MAX_CHARS and not _FRAMERS_TH.search(th)
    if _SELF_HARM_EN.search(text) and personal or _SELF_HARM_TH.search(th) and (anchored_th or pro_drop):
        return Emergency("self_harm")
    # English with no anchor: short, a red flag, no framing word outside it, and a conversational cue
    # (an "and" next to a red flag joins two flags, so it is no framer; "to help" is neither cue nor urgency word)
    rest = _join_flags(_MEDICAL_EN_NOANCHOR.sub(_FLAG_MARK, text)).replace(_FLAG_MARK, " ")
    generic = bool(_GENERIC_FRAME.search(text)) and not _URGENT_EN.search(spoken)
    short_en = (len(text.split()) <= SHORT_EN_MAX_WORDS and bool(_MEDICAL_EN_NOANCHOR.search(text))
                and not _FRAMERS_EN.search(rest) and not generic and bool(_CUES_EN.search(spoken)))
    if (personal and _MEDICAL_EN.search(text) or short_en
            or _MEDICAL_TH.search(th) and (anchored_th or pro_drop)):
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


def shown_topic(status: str | None, error: str | None, topic: str | None) -> str | None:
    """The topic as answers about a stored review may show it (Plan 30): None for a personal medical refusal, whose
    question is the person's own case and is never echoed (REST, MCP, the Markdown report, the event replay)."""
    return None if refusal_code_of(status, error) == "personal_medical" else topic
