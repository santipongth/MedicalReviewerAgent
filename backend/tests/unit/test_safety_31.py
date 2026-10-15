"""Plan 31: red-flag recall for typos, and-joined flags and generic "someone" questions (D1-D4)."""
import pytest

from app.services import safety
from tests.unit import safety_sets_31 as sets
from tests.unit import safety_sets_31b as set_b


def _kind(topic):
    hit = safety.red_flag(topic)
    return hit.kind if hit else None


@pytest.mark.parametrize("topic", [
    "my mom cnt breathe", "dad cant breath help", "my husband has chest pian", "my wife is unconcious",
    "my son is having a siezure", "baby chocking help", "my dad is bleding heavily help",
    "my friend overdozed", "grandma colapsed please help", "i think im having a heart atack",
    "she is bleeding alot help", "helppp my dad collapsed", "สามีเจบหน้าอกมาก", "แม่หายใจไม่ออกกก",
])
def test_typos_of_red_flags_are_caught(topic):
    assert _kind(topic) == "medical"


def test_repeated_letters_fold_for_self_harm_too():
    assert _kind("อยากตายยย") == "self_harm"
    assert _kind("i want to dieee") == "self_harm"


@pytest.mark.parametrize("topic", [
    "mom collapsed and not breathing", "grandma face drooping and cant talk", "dad chest pain and sweating",
    "granny fell and is bleeding heavily", "baby choking and turning blue help",
])
def test_and_joined_flags_are_caught(topic):
    assert _kind(topic) == "medical"


@pytest.mark.parametrize("topic", [
    "chest pain and anxiety", "heart attack and depression", "choking and dysphagia",
    "seizures and pregnancy outcomes", "collapsed and recovered athletes", "overdose and naloxone access",
    "chest pain and troponin testing", "heart attack and stroke risk scores",
])
def test_and_titles_without_a_cue_stay_research(topic):
    assert _kind(topic) is None


@pytest.mark.parametrize("topic", [
    "what to do when someone is choking: public knowledge", "first aid for someone having a seizure",
    "what should someone do if they have chest pain", "what to do if someone has a heart attack",
    "how should somebody respond when someone collapsed", "can someone with chest pain drive",
    "how to help someone who is choking", "someone choking: causes and prevention",
])
def test_generic_someone_questions_are_not_refused(topic):
    assert _kind(topic) is None


@pytest.mark.parametrize("topic", [
    "someone collapsed in the street", "help someone overdosed", "someone collapsed and is not breathing",
    "someone is unconscious next to me", "if someone is choking help", "when someone collapsed what do i do now",
    "please help someone is not breathing", "somebody passed out at the bus stop",
])
def test_someone_in_an_urgent_or_declarative_message_stays_an_emergency(topic):
    assert _kind(topic) == "medical"


@pytest.mark.parametrize("topic", ["แม่และเด็กที่มีภาวะชัก", "พ่อและแม่สูงอายุที่หกล้มและหมดสติ"])
def test_a_thai_kin_pair_is_a_population(topic):
    assert _kind(topic) is None


@pytest.mark.parametrize("s", [sets, set_b], ids=["set-a", "set-b"])
def test_blind_research_items_are_never_refused_and_traps_at_most_once(s):
    assert [t for t in s.HELDOUT31_RESEARCH if safety.red_flag(t)] == []
    assert len([t for t in s.HELDOUT31_TRAPS if safety.red_flag(t)]) <= 1


def test_the_typo_fold_leaves_other_words_alone():
    assert safety.fold_typos("breath test accuracy") == "breath test accuracy"
    assert safety.fold_typos("chocolate intake") == "chocolate intake"
    assert safety.fold_typos("a cnt b") == "a cnt b"  # CNT is an abbreviation unless a can't-verb follows
    assert safety.fold_typos("mom cnt breathe") == "mom cant breathe"
    assert safety.fold_typos("sooo tired") == "so tired"


@pytest.mark.parametrize("topic", [
    "NYHA III heart failure with chest pain", "Killip III heart attack", "GOLD III COPD difficulty breathing",
    "Mallampati III choking", "level iii trauma centres and unconscious head injury", "nyha iii chest pain",
    "cnt exposure difficulty breathing", "now and then chest pain", "chest pain and now what",
    "help-seeking after chest pain in women", "baby choking and baby led weaning",
])
def test_numerals_abbreviations_idioms_and_titles_stay_research(topic):
    assert _kind(topic) is None


def test_a_roman_numeral_is_not_folded_into_the_pronoun():
    assert safety.fold_typos("nyha iii chest pain") == "nyha iii chest pain"


@pytest.mark.parametrize("topic", [
    "someone collapsed at 10:30 not breathing",  # a clock time is no colon subtitle
    "someone collapsed: help", "my mom cnt breathe",
])
def test_colon_urgency_clock_and_cnt_cases_stay_emergencies(topic):
    assert _kind(topic) == "medical"


# Recall (D4, no bar): set A 25/30 caught (master 11/30), set B 27/30.
@pytest.mark.parametrize("s", [sets, set_b], ids=["set-a", "set-b"])
def test_the_blind_emergencies_keep_their_kind_when_caught(s):
    # recall is recorded, not a bar (D4); a caught emergency must be the right kind
    caught = [(t, k) for t, k in s.HELDOUT31_EMERGENCIES if safety.red_flag(t)]
    assert all(_kind(t) == k for t, k in caught)
