import hashlib
import json
import re

import pytest

from app.config import Settings
from app.graph.factory import build_graph_deps
from app.graph.graph import GraphDeps
from app.graph.schemas import TranslationBatch, TranslationItem
from app.harness.glossary import (
    SEED_GLOSSARY,
    ActiveGlossary,
    glossary_of,
    render_glossary,
    seed_document,
)
from app.harness.localize import GLOSSARY, localize_strings, localize_system
from app.harness.runner import HarnessRunner
from app.services.config_store import DocumentError
from app.services.glossary_store import (
    GLOSSARY_KIND,
    RENDERED_MAX,
    TERMS_MAX,
    active_glossary_from,
    summarize_glossary,
    validate_glossary,
)
from tests.fakes import FakeStructuredLLM

# sha256 of localize_system("th") before Plan 23c (prompt_version 2026-10-12.1): with no saved glossary the
# localizer prompt must not change by a byte.
SEED_PROMPT_SHA = "607f7ea53d5d743d0cbf6707c4553ea3ec1e0f923d708e3d8db70de38a822deb"
S = Settings(_env_file=None)


def term(en="placebo", th="ยาหลอก", abbr=None, note=None):
    return {"en": en, "th": th, "abbr": abbr, "note": note}


def test_the_seed_prompt_is_byte_identical():
    assert hashlib.sha256(localize_system("th").encode()).hexdigest() == SEED_PROMPT_SHA
    assert localize_system("th", SEED_GLOSSARY.text) == localize_system("th")
    assert SEED_GLOSSARY.label == "file" and SEED_GLOSSARY.text == GLOSSARY["th"]


def test_the_seed_document_round_trips_except_one_missing_space():
    doc = seed_document()
    assert len(doc["terms"]) == 24
    assert doc["terms"][1] == term("risk ratio/relative risk", "อัตราส่วนความเสี่ยง", "RR")
    assert doc["terms"][3] == term("95% confidence interval", "ช่วงความเชื่อมั่น 95%", "95% CI")
    # GLOSSARY["th"] has "(PFS);adverse events"; a rendered document always puts a space after ";"
    assert render_glossary(doc["terms"]) == GLOSSARY["th"].replace("(PFS);adverse", "(PFS); adverse")
    assert validate_glossary(doc, S) == (doc, [])


def test_a_saved_glossary_replaces_the_terms_for_thai_only():
    system = localize_system("th", "placebo = ยาหลอก")
    # the prompt's own example ("e.g. อัตราส่วนฮาซาร์ด (HR)") stays; only the glossary line changes
    assert system.endswith("Glossary (use these terms): placebo = ยาหลอก") and GLOSSARY["th"] not in system
    assert "Glossary" not in localize_system("ja", "placebo = ยาหลอก")


def _translate(system, user):
    items = json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))
    return TranslationBatch(items=[TranslationItem(id=i["id"], text="แปลแล้ว ยาหลอก") for i in items])


async def test_localize_strings_sends_the_given_glossary():
    llm = FakeStructuredLLM("qwen", _translate)
    await localize_strings(llm, HarnessRunner(max_repairs=1), {"a": "versus placebo"}, "th",
                           glossary="placebo = ยาหลอก")
    assert llm.calls[0][0].endswith("Glossary (use these terms): placebo = ยาหลอก")


@pytest.mark.parametrize("terms, field", [
    ([], "terms"),
    ([term(en="")], "terms.0.en"),
    ([term(th="placebo")], "terms.0.th"),  # no Thai script
    ([term(th="ยาหลอก (P)")], "terms.0.th"),  # the abbreviation has its own field
    ([term(en="a=b")], "terms.0.en"),
    ([term(abbr="H;R")], "terms.0.abbr"),
    ([term(en="x/ /y")], "terms.0.en"),  # an empty alias
    ([term(), term(en="Placebo/sugar pill")], "terms.1.en"),  # an alias listed twice
    ([term(note="a\nb")], "terms.0.note"),
    ([term(th="ยา\x85หลอก")], "terms.0.th"),  # C1 (NEL)
    ([term(en="place\x9fbo")], "terms.0.en"),  # C1
    ([term(abbr="P\u2028")], "terms.0.abbr"),  # line separator
    ([term(note="a\u2029b")], "terms.0.note"),  # paragraph separator
    ([term(th="ยา\x00หลอก")], "terms.0.th"),
    ([term(en="x" * 121)], "terms.0.en"),
    ([{**term(), "extra": 1}], "terms.0"),
    ([term(en=7)], "terms.0.en"),
])
def test_invalid_terms_name_the_cell(terms, field):
    with pytest.raises(DocumentError) as info:
        validate_glossary({"terms": terms}, S)
    assert info.value.errors[0]["field"] == field


def test_errors_never_echo_submitted_text():
    bad = "\ud800zz"
    with pytest.raises(DocumentError) as info:
        validate_glossary({"terms": [term(th=bad)]}, S)
    assert all(bad not in e["message"] for e in info.value.errors)


def test_document_shape_size_and_rendered_length():
    for raw in (None, [], {"terms": "x"}, {"terms": [], "more": 1}):
        with pytest.raises(DocumentError):
            validate_glossary(raw, S)
    with pytest.raises(DocumentError, match=f"at most {TERMS_MAX}"):
        validate_glossary({"terms": [term(en=f"t{i}") for i in range(TERMS_MAX + 1)]}, S)
    long = [term(en=f"term number {i:03d} " + "x" * 90, th="ก" * 110) for i in range(30)]
    with pytest.raises(DocumentError, match=str(RENDERED_MAX)):
        validate_glossary({"terms": long}, S)


def test_values_are_trimmed_blanks_become_null_and_a_shared_thai_term_warns():
    doc, warnings = validate_glossary({"terms": [term(en=" placebo ", abbr=" ", note=""), term(en="dummy pill")]}, S)
    assert doc == {"terms": [term(), term(en="dummy pill")]}
    assert warnings == ["terms.0 and terms.1 share one Thai term"]


def test_change_summary_and_active_glossary():
    old = {"terms": [term(), term(en="mortality", th="อัตราการเสียชีวิต")]}
    new = {"terms": [term(note="note"), term(en="incidence", th="อุบัติการณ์")]}
    assert summarize_glossary(old, new) == {"added": ["incidence"], "removed": ["mortality"], "changed": ["placebo"]}
    assert summarize_glossary(old, old) == {}

    class Row:
        version, document = 4, new

    active = active_glossary_from(Row())
    assert active == ActiveGlossary(4, "placebo = ยาหลอก; incidence = อุบัติการณ์") and active.label == "4"
    assert GLOSSARY_KIND.mirror(new) == {} and GLOSSARY_KIND.seed() == seed_document()


def test_deps_carry_the_glossary():
    g = ActiveGlossary(2, "placebo = ยาหลอก")
    assert glossary_of(GraphDeps(settings=S)) is SEED_GLOSSARY
    assert glossary_of(GraphDeps(settings=S, glossary=g)) is g
    assert build_graph_deps(Settings(_env_file=None, graph_mode="stub"), http=None, glossary=g).glossary is g
