from app.harness.glossary_check import GlossaryTerm, check_pair, default_terms, parse_glossary


def test_parse_glossary_splits_aliases_and_abbreviation():
    terms = parse_glossary("risk ratio/relative risk = อัตราส่วนความเสี่ยง (RR); placebo = ยาหลอก")
    assert terms[0] == GlossaryTerm(("risk ratio", "relative risk"), "อัตราส่วนความเสี่ยง", "RR")
    assert terms[1] == GlossaryTerm(("placebo",), "ยาหลอก", None)


def test_check_pair_flags_consistent_and_missed_terms():
    terms = parse_glossary("hazard ratio = อัตราส่วนฮาซาร์ด (HR); placebo = ยาหลอก")
    got = check_pair("The hazard ratio versus placebo was 0.80.", "อัตราส่วนอันตราย เทียบกับยาหลอก 0.80", terms)
    assert sorted(got) == [("hazard ratio", False), ("placebo", True)]


def test_kept_english_item_is_skipped():
    terms = parse_glossary("placebo = ยาหลอก")
    assert check_pair("versus placebo", "versus placebo", terms) == []


def test_default_terms_parse_the_shipped_glossary():
    keys = {t.english[0] for t in default_terms()}
    assert {"hazard ratio", "placebo", "heterogeneity"} <= keys and len(keys) >= 20


def test_entry_without_space_after_semicolon_still_splits():
    # localize.GLOSSARY["th"] has "(PFS);adverse events" with no space after the ";"
    keys = {t.english[0]: t for t in default_terms()}
    assert keys["progression-free survival"].abbr == "PFS"
    assert keys["adverse events"].thai == "เหตุการณ์ไม่พึงประสงค์"
