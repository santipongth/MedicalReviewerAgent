"""Review exports: Markdown (also the MCP resource review://{id}/report.md) and CSV."""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from typing import Any
from urllib.parse import quote

from app.harness.design import NON_QUANTITATIVE_CATEGORIES
from app.harness.meta import DESIGN_GROUP_LABEL
from app.services.thaijo import article_link

DIRECTION = {"positive": "supports", "negative": "opposite/harm", "null": "no association",
             "mixed": "mixed", "unclear": "unclear"}


def _cell(text: Any) -> str:
    return " ".join(str(text if text is not None else "").split()).replace("|", "\\|")


TYPE_LABEL = {"narrative": "Narrative review", "slr": "Systematic review", "scoping": "Scoping review",
              "meta_analysis": "Meta-analysis"}
POOLED_HEADING = ("## Pooled analysis (computed by the system from abstract-verified numbers — "
                  "not a result of any single study)")
# Per-pool warnings shown on the pool line; abstract_only, ci_assumed_95 and adjustment_unknown are on every pool
# and go into the method note instead.
WARNING_LABEL = {
    "small_k": "small number of studies (k<5)",
    "high_heterogeneity": "substantial heterogeneity (I² ≥ 50%)",
    "duplicate_cohort_skipped": "a possible duplicate cohort was left out",
    "other_measures_not_pooled": "studies reporting another effect measure were not pooled",
    "md_units_assumed_equal": "mean differences assumed to share units",
}


_END = re.compile(r"[\s.,;:]+$")
MAX_AUTHORS = 6  # ICMJE / Vancouver: the first six, then "et al."


def _clean(value: Any) -> str:
    """One line of metadata text without trailing punctuation (the formatter adds its own)."""
    return _END.sub("", " ".join(str(value if value is not None else "").split()))


def _doi(value: Any) -> str:
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", _clean(value),
                  flags=re.IGNORECASE)


def _pmcid(value: Any) -> str:
    v = _clean(value)
    return f"PMC{v}" if v.isdigit() else v


def doi_href(doi: Any) -> str:
    """doi.org link with each path segment URL-encoded like JavaScript's encodeURIComponent (old SICI DOIs carry
    "#", "?", "<", ";")."""
    return "https://doi.org/" + "/".join(quote(seg, safe="!*'()") for seg in _doi(doi).split("/"))


# Author names in Vancouver form (NLM): "Surname Initials". Mirrors frontend src/lib/citation.ts vancouverName; both
# test suites share one table of cases.
_PARTICLES = frozenset({"van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "la", "le", "dos", "das",
                        "ten", "ter"})


def _has_letter(s: str) -> bool:
    return any(ch.isalpha() for ch in s)


def _non_latin(s: str) -> bool:
    """A name with a letter outside the Latin script (Thai, CJK, ...) is left as written."""
    return any(ch.isalpha() and not unicodedata.name(ch, "").startswith("LATIN") for ch in s)


def _bare_initials(t: str) -> str:
    """Hyphens between initials are dropped: "S-H" -> "SH" ("Lee S-H" -> "Lee SH")."""
    return t.replace(".", "").replace("-", "")


def _is_initials(t: str) -> bool:
    bare = _bare_initials(t)
    return 1 <= len(bare) <= 3 and bare.isalpha() and bare.isupper()


# A word that names a group, not a person; ASCII word boundaries, like JavaScript's \b.
_ORG_WORD = re.compile(r"\b(?:group|organi[sz]ation|collaborat\w*|consortium|investigators?|committee|society|"
                       r"association|network|institute|council|team|working|study|trial|foundation|biobank)\b",
                       re.IGNORECASE | re.ASCII)
_SUFFIX = re.compile(r"^(?:jr|sr|ii|iii|iv)\.?$", re.IGNORECASE)


def _suffix_text(t: str) -> str:
    bare = t.replace(".", "")
    return bare.upper() if bare[0] in "iI" else bare[0].upper() + bare[1:].lower()


def _is_organisation(name: str) -> bool:
    """An organisation author, kept as written: it holds an organisation word, or it has 4 or more words that are
    neither surname particles nor a suffix ("Martin Luther King Jr" and "Anna de la Cruz" are people)."""
    if _ORG_WORD.search(name):
        return True
    words = [w for w in name.replace(",", " ").split() if w.lower() not in _PARTICLES and not _SUFFIX.match(w)]
    return len(words) >= 4


def _initials_of(token: str) -> str:
    """"J.A." -> "JA", "Jean-Pierre" -> "JP", "Andrew" -> "A"; "" when a part has no letter."""
    if _is_initials(token):
        return _bare_initials(token)
    return "".join(next((ch for ch in part if ch.isalpha()), "") for part in token.split("-")).upper()


def vancouver_name(name: Any) -> str:
    """One author as "Surname Initials": "Smith, John A." and "John A. Smith" -> "Smith JA"; "Kim J.H." -> "Kim JH";
    particles stay with the surname ("van Beethoven L"); hyphenated given names give one initial per part. A single
    word, a non-Latin name or anything that does not parse is kept as written."""
    full = _clean(name)
    if not full or _non_latin(full) or _is_organisation(full):
        return full
    tokens = full.replace(",", " , ").split()
    # a generational suffix ("Jr", "Sr", "II"-"IV") goes after the initials: "John Smith Jr" -> "Smith J Jr"
    suffix = ""
    if len(tokens) > 1 and _SUFFIX.match(tokens[-1]):
        suffix = _suffix_text(tokens.pop())
        while tokens and tokens[-1] == ",":
            tokens.pop()
    # a suffix written with the surname, before the comma ("Smith Jr, John") goes there too
    first_comma = tokens.index(",") if "," in tokens else -1
    if not suffix and first_comma > 1 and _SUFFIX.match(tokens[first_comma - 1]):
        suffix = _suffix_text(tokens.pop(first_comma - 1))

    def with_suffix(s: str) -> str:
        return f"{s} {suffix}" if suffix else s

    rest = " ".join(tokens).replace(" ,", ",")
    if "," in rest:
        head, _, tail = rest.partition(",")
        surname, given = head.split(), tail.replace(",", " ").split()
        while given and given[-1] in _PARTICLES:  # "Beethoven, Ludwig van"
            surname.insert(0, given.pop())
    else:
        words = rest.split(" ")
        if len(words) == 1:
            return with_suffix(rest)
        if _is_initials(words[-1]):
            return with_suffix(f"{' '.join(words[:-1])} {_bare_initials(words[-1])}")
        start = len(words) - 1
        while start > 1 and words[start - 1].lower() in _PARTICLES:  # "De La Cruz" too
            start -= 1
        surname, given = words[start:], words[:start]
    initials = [_initials_of(g) for g in given]
    if not surname or not _has_letter("".join(surname)) or not given or not all(initials):
        return full
    return with_suffix(f"{' '.join(surname)} {''.join(initials)}")


def author_names(authors: Any) -> list[str]:
    """The author strings as names: an entry holding a ";"-separated list is split there (never at a comma)."""
    parts = [part for a in authors or [] if isinstance(a, str) for part in a.split(";")]
    return [n for n in (vancouver_name(part) for part in parts) if n]


def _citation_parts(p: dict[str, Any]) -> tuple[list[str], list[tuple[str, str, str]]]:
    """The text parts of a Vancouver reference and its identifiers as (label, value, url). Only fields the result
    carries: volume, issue and pages only for ThaiJO papers (`bib`, from OAI-PMH, Plan 24; the other sources do not
    give them); a missing part is left out. The title and journal stay in their own language. Mirrors frontend
    `src/lib/citation.ts`."""
    text: list[str] = []
    authors = author_names(p.get("authors"))
    if authors:
        shown = authors[:MAX_AUTHORS] + (["et al"] if len(authors) > MAX_AUTHORS else [])
        text.append(", ".join(shown) + ".")
    title = re.sub(r"[\s.]+$", "", " ".join(str(p.get("title") or "").split()))
    if title:
        text.append(title if title[-1] in "?!" else f"{title}.")
    if _clean(p.get("journal")):
        text.append(f"{_clean(p.get('journal'))}.")
    raw = p.get("bib")
    bib = raw if isinstance(raw, dict) else {}
    volume, issue, pages = (_clean(bib.get(k)) for k in ("volume", "issue", "pages"))
    where = volume + (f"({issue})" if issue and volume else "")  # an issue without a volume is left out
    date = _clean(p.get("year"))
    date = f"{date};{where}" if date and where else date or where
    date = f"{date}:{pages}" if date and pages else date or pages
    if date:  # NLM: "2024;17(4):1048-1066.", "2024:e265234."
        text.append(f"{date}.")
    ids: list[tuple[str, str, str]] = []
    if _doi(p.get("doi")):
        ids.append(("doi", _doi(p.get("doi")), doi_href(p.get("doi"))))
    if _clean(p.get("pmid")):
        ids.append(("PMID", _clean(p.get("pmid")), f"https://pubmed.ncbi.nlm.nih.gov/{_clean(p.get('pmid'))}/"))
    if _pmcid(p.get("pmcid")):
        ids.append(("PMCID", _pmcid(p.get("pmcid")), f"https://pmc.ncbi.nlm.nih.gov/articles/{_pmcid(p.get('pmcid'))}/"))
    if article_link(p.get("thaijo_url")):  # Plan 24: the ThaiJO article page (checked again; never the PDF)
        ids.append(("ThaiJO", p["thaijo_url"], p["thaijo_url"]))
    return text, ids


def vancouver(p: dict[str, Any]) -> str:
    """`Authors (up to 6, then et al.). Title. Journal. Year. doi: … PMID: … PMCID: …` as plain text."""
    text, ids = _citation_parts(p)
    return " ".join([*text, *(f"{label}: {value}." for label, value, _ in ids)])


def _md_url(url: str) -> str:
    return url.replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def _vancouver_md(p: dict[str, Any]) -> str:
    """`vancouver` with the identifiers as Markdown links."""
    text, ids = _citation_parts(p)
    return " ".join([*text, *(f"{label}: [{value}]({_md_url(url)})." for label, value, url in ids)])


def _num(value: float, decimals: int = 2) -> str:
    return f"{value:.{decimals}f}"


def _reported(value: float) -> str:
    """A verified paper number as the paper printed it: no rounding to a fixed number of decimals."""
    return f"{value:g}"


def _warnings(codes: list[str]) -> str:
    labels = [WARNING_LABEL[c] for c in codes if c in WARNING_LABEL]
    return f" Warnings: {'; '.join(labels)}." if labels else ""


def _pooled_section(meta: dict[str, Any] | None) -> list[str]:
    """Markdown lines for result.meta_analysis (empty when there is nothing to show)."""
    if not meta:
        return []
    out = [POOLED_HEADING, ""]
    pools = meta.get("pools") or []
    if not pools:
        out += [("No outcome had at least 3 comparable primary studies with verified effect estimates, "
                 "so nothing was pooled."), ""]
    for p in pools:
        est = p["pooled"]
        refs = ", ".join(f"{s['ref']} {_reported(s['effect'])} [{_reported(s['ci_lower'])}, {_reported(s['ci_upper'])}]"
                         f" w {s['weight']:.1f}%" for s in p["studies"])
        out.append(f"- **{_cell(p.get('outcome_display') or p['outcome'])}** — {p['measure']}, "
                   f"{DESIGN_GROUP_LABEL.get(p['design_group'], p['design_group'])}, k={p['k']}: "
                   f"{_num(est['est'])} (95% CI {_num(est['ci_lower'])} to {_num(est['ci_upper'])}) "
                   f"_(computed)_; I² {p['i2']:.0f}%, τ² {p['tau2']:.3f}. Inputs: {refs}."
                   + _warnings(p.get("warnings") or []))
    if pools:
        out += ["", (f"_Method: {pools[0]['method']} ({meta.get('version')}); 95% CIs; ratio measures pooled on the "
                     "log scale. Inputs are abstracts only; adjusted and unadjusted estimates cannot be told apart._")]
    reference = [r for r in meta.get("reference") or [] if r.get("effect") is not None]
    if reference:
        out += ["", "Systematic reviews / meta-analyses (reference only, not pooled): "
                + "; ".join(f"{r['ref']} {r.get('measure') or ''} {_reported(r['effect'])}" for r in reference) + "."]
    return [*out, ""]


def _comparison(rows: list[dict[str, Any]], directions: bool = True) -> list[str]:
    """`directions=False` (scoping review) leaves the direction words out: a scoping review does not judge effects."""
    refs = sorted({c["ref"] for r in rows for c in r["cells"]}, key=lambda r: int(r[1:]) if r[1:].isdigit() else 0)
    if not rows or not refs:
        return []
    lines = ["| Outcome | " + " | ".join(refs) + " |", "|---|" + "---|" * len(refs)]
    def text(c: dict[str, Any]) -> str:
        # qualitative / mixed-methods themes never carry a direction (Task 2 review finding 5, as in the UI)
        if not directions or c.get("design_category") in NON_QUANTITATIVE_CATEGORIES:
            return _cell(c["finding"])
        return f"{_cell(c['finding'])} ({DIRECTION.get(c['direction'], c['direction'])})"

    for row in rows:
        by_ref = {c["ref"]: c for c in row["cells"]}
        cells = [text(by_ref[r]) if r in by_ref else "" for r in refs]
        lines.append(f"| {_cell(row['outcome'])} | " + " | ".join(cells) + " |")
    return lines


def _other_comparisons(card: dict[str, Any] | None) -> str:
    """The paper's outcomes of another comparison (Plan 19), labelled so a reader never takes them as evidence."""
    others = [o for o in (card or {}).get("outcomes") or [] if o.get("matches_question") is False]
    if not others:
        return ""
    items = "; ".join(_cell(f"{o.get('outcome')} ({o['comparison']})" if o.get("comparison") else o.get("outcome"))
                      for o in others)
    return f" Other comparisons, not evidence for the question: {items}."


def _methods_section(result: dict[str, Any]) -> list[str]:
    """A short Methods block (Plan 20): search date, sources with their record counts, queries, models and the prompt
    version. Absent when the result has none of them (results stored before Plan 20 still list queries and models)."""
    methods = result.get("methods") or {}
    lines: list[str] = []
    if methods.get("searched_at"):
        lines.append(f"- **Searched:** {methods['searched_at']}")
    sources = methods.get("sources") or {}
    if sources:
        lines.append("- **Sources (records before deduplication):** "
                     + ", ".join(f"{_cell(k)} {v}" for k, v in sorted(sources.items(), key=lambda kv: -kv[1])))
    queries = result.get("queries") or []
    if queries:
        lines.append("- **Queries:** " + "; ".join(f"`{_cell(q)}`" for q in queries))
    models = result.get("models") or {}
    if models:
        lines.append("- **Models:** " + ", ".join(f"{role} {_cell(m)}" for role, m in models.items() if m))
    if result.get("prompt_version"):
        lines.append(f"- **Prompt version:** {result['prompt_version']}")
    return ["## Methods", "", *lines, ""] if lines else []


def _reference_line(p: dict[str, Any]) -> str:
    """One reference: the Vancouver text, then what the review made of the paper (design, n, notes)."""
    card = p.get("card") or {}
    # final review M9: a sample size the verifier blanked is "n not verified"; one never reported stays "n=?"
    blanked_n = any(u.get("field") == "sample_size" for u in (p.get("verification") or {}).get("unverified") or [])
    n = "n not verified" if blanked_n and card.get("sample_size") is None else f"n={card.get('sample_size') or '?'}"
    design = f" — {card.get('study_design')}, {n}." if card else " — not extracted."
    excluded = (" Not used as evidence: read as a design outside the ticked study types."
                if p.get("design_excluded") else "")
    if (p.get("verification") or {}).get("design_mismatch"):  # the report's note too (Task 6 review finding 7)
        excluded += (" Used as evidence although its design is outside the ticked study types, because fewer than 3 "
                     "studies matched.")
    # Plan 20 Task 10: a further report of a trial counted once, under its primary report
    related = (f" Related report of [{p['related_to']}] ({p.get('related_reason') or 'same trial'}), not "
               f"counted again." if p.get("related_to") else "")
    return f"{_vancouver_md(p)}{design}{_other_comparisons(p.get('card_en') or card)}{excluded}{related}"


_MARKER = re.compile(r"\[(P\d+(?:\s*,\s*P\d+)*)\]")  # app.harness.support.MARKER: the groups the engine writes


def quick_view(result: dict[str, Any]) -> dict[str, Any]:
    """Plan 27: a quick answer as its readers get it outside the web page (MCP quick_answer, the Markdown export): the
    shown answer with its [Pn] groups renumbered [1]..[n] by `quick.refs` (order of first citation), the closing
    certainty-and-limits line, the certainty level (computed, GRADE-lite) and the numbered references with their
    links. The references are the screened papers the answer cites; nothing is computed here."""
    s = result.get("synthesis") or {}
    quick = result.get("quick") or {}
    refs = [r for r in quick.get("refs") or [] if isinstance(r, str)]
    by_ref = {p.get("ref"): p for p in result.get("papers") or []}

    def number(m: re.Match[str]) -> str:
        nums = [str(refs.index(r) + 1) for r in re.findall(r"P\d+", m.group(1)) if r in refs]
        return f"[{', '.join(nums)}]" if nums else ""

    references = []
    for n, ref in enumerate(refs, 1):
        p = by_ref.get(ref) or {"ref": ref}
        _text, ids = _citation_parts(p)
        references.append({"n": n, "ref": ref, "citation": vancouver(p),
                           "links": [{"label": label, "url": url} for label, _value, url in ids]})
    return {"answer": _MARKER.sub(number, result.get("summary") or s.get("executive_summary") or ""),
            "closing": s.get("answer") or "", "certainty": s.get("evidence_strength"),
            "papers_read": quick.get("papers_read"), "references": references}


def _quick_markdown(review, result: dict[str, Any]) -> str:
    view = quick_view(result)
    q = result.get("question") or {}
    out = [f"# Quick answer: {review.topic}", ""]
    if q.get("refined_question"):
        out += [f"**Question:** {q['refined_question']}", ""]
    out += [view["answer"], ""]
    if view["closing"]:
        out += [view["closing"], ""]
    if view["papers_read"] is not None:
        out += [(f"_A quick answer from the abstracts of {view['papers_read']} studies (automated, abstracts only); "
                 "not a full systematic review and not medical advice._"), ""]
    if view["references"]:
        out += ["## References", ""]
        by_ref = {p.get("ref"): p for p in result.get("papers") or []}
        out += [f"{r['n']}. {_vancouver_md(by_ref.get(r['ref']) or {})}" for r in view["references"]]
        out.append("")
    return "\n".join(out) + "\n"


def render_markdown(review) -> str:
    result = review.result
    out = [f"# Literature review: {review.topic}", ""]
    if not result:
        out.append(f"Status: **{review.status}**" + (f" — {review.error}" if review.error else ""))
        return "\n".join(out) + "\n"
    if result.get("mode") == "quick":  # Plan 27: the answer and its numbered references, not the report
        return _quick_markdown(review, result)
    q = result.get("question") or {}
    s = result.get("synthesis") or {}
    if q.get("refined_question"):
        out += [f"**Question:** {q['refined_question']}", ""]
    review_type = result.get("review_type")
    if review_type and review_type != "slr":  # SLR Markdown stays as before
        out += [f"**Review type:** {TYPE_LABEL.get(review_type, review_type)} (automated, abstracts only)", ""]
    # Plan 20: the bottom line and the key findings lead (absent for results stored before Plan 20)
    if s.get("answer"):
        out += ["## Answer", "", s["answer"], ""]
    findings = s.get("key_findings") or []
    if findings:
        out += ["## Key findings", ""]
        # a finding's certainty is the review's one grade (set in code), so it is said once, never per line
        if review_type in (None, "slr", "meta_analysis") and s.get("evidence_strength"):
            level = str(s["evidence_strength"]).replace("_", " ")
            out += [f"Certainty (whole review, not graded per outcome): {level}", ""]
        for f in findings:
            out.append(f"- **{_cell(f.get('outcome'))}** — {f.get('statement')} [{', '.join(f.get('refs') or [])}] "
                       f"(k={f.get('k', len(f.get('refs') or []))})")
        out.append("")
    out += ["## Summary", "", result.get("summary") or s.get("executive_summary", ""), ""]
    if "evidence_strength" in s and s["evidence_strength"] is None:
        out += [f"**Evidence strength:** not assessed ({s.get('evidence_rationale', '')})", ""]
    else:
        out += [f"**Evidence strength:** {s.get('evidence_strength', 'n/a')} — {s.get('evidence_rationale', '')}", ""]
    table = _comparison(s.get("comparison") or [], directions=review_type != "scoping")
    if table:
        out += ["## Comparison", "", *table, ""]
    if review_type == "meta_analysis":
        out += _pooled_section(result.get("meta_analysis"))
    for title, key in (("Consensus", "consensus"), ("Conflicts", "conflicts")):
        items = [] if review_type == "scoping" else s.get(key) or []  # a scoping review makes no claims
        if items:
            out += [f"## {title}", ""]
            for c in items:
                reasons = f" Likely reasons: {', '.join(c['likely_reasons'])}." if c.get("likely_reasons") else ""
                out.append(f"- **{c['statement']}** [{', '.join(c['refs'])}] {c['explanation']}{reasons}")
            out.append("")
    if s.get("research_gaps"):
        out += ["## Research gaps", "", *[f"- {g}" for g in s["research_gaps"]], ""]
    out += _methods_section(result)
    papers = result.get("papers") or []
    if papers:
        # Plan 20 Task 6: Vancouver references in P-number order (the report's rules, lib/citation.ts); a further
        # report of a trial (Task 10) is listed right under its primary report, not as a study of its own
        out += ["## References", ""]
        refs = {p.get("ref") for p in papers}
        under: dict[str, list[dict[str, Any]]] = {}
        for p in papers:
            if p.get("related_to") in refs:
                under.setdefault(p["related_to"], []).append(p)
        for p in papers:
            if p.get("related_to") in refs:
                continue
            out.append(f"- [{p['ref']}] {_reference_line(p)}")
            out += [f"  - Related report [{r['ref']}] {_reference_line(r)}" for r in under.get(p["ref"], [])]
        out.append("")
    quality = result.get("quality") or {}
    if quality:
        rate = quality.get("verification_rate")
        out.append(f"_Numbers verified against paper text: {'n/a' if rate is None else f'{rate:.0%}'}; "
                   f"papers flagged uncertain: {quality.get('papers_uncertain', 0)}._")
    return "\n".join(out) + "\n"


CSV_FIELDS = ["ref", "title", "year", "journal", "doi", "pmid", "design_category", "study_design", "sample_size",
              "outcome", "direction", "effect_measure", "effect_value", "ci_lower", "ci_upper", "p_value",
              "evidence_quote", "error",
              "population", "intervention_or_exposure", "comparator", "risk_of_bias", "overall_direction",
              "key_findings", "limitations",
              # Plan 19, appended so existing column positions hold: the outcome's own comparison, and whether it is
              # the review's intervention vs comparator (false: another comparison, never evidence for the question)
              "comparison", "matches_question"]


FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _cell_value(value: Any) -> Any:
    """Text that a spreadsheet would run as a formula (titles and quotes come from third-party metadata) gets a
    leading apostrophe; numbers are left as numbers."""
    if isinstance(value, str) and value.startswith(FORMULA_START):
        return "'" + value
    return value


def render_csv(result: dict[str, Any] | None) -> str:
    """One row per paper × outcome, from the English cards. Values the verifier blanked are already null and stay
    empty here: nothing is estimated. A paper without a card gets one row carrying its error."""
    # A scoping review judges neither direction nor bias: those columns stay in the header but are left empty.
    scoping = (result or {}).get("review_type") == "scoping"
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for p in (result or {}).get("papers") or []:
        card = p.get("card_en") or p.get("card")
        base = {"ref": p.get("ref"), "title": p.get("title"), "year": p.get("year"), "journal": p.get("journal"),
                "doi": p.get("doi"), "pmid": p.get("pmid"), "error": p.get("error")}
        if not card:
            writer.writerow({k: _cell_value(v) for k, v in base.items()})
            continue
        base |= {"design_category": card.get("design_category"), "study_design": card.get("study_design"),
                 "sample_size": card.get("sample_size"),
                 **{k: card.get(k) for k in ("population", "intervention_or_exposure", "comparator", "risk_of_bias",
                                             "overall_direction")},
                 **{k: " | ".join(str(x) for x in card.get(k) or []) for k in ("key_findings", "limitations")}}
        for o in card.get("outcomes") or [{}]:
            row = base | {k: o.get(k) for k in ("outcome", "direction", "effect_measure", "effect_value",
                                                "ci_lower", "ci_upper", "p_value", "evidence_quote", "comparison")}
            if o:  # outcomes stored before Plan 19 answer the question
                row["matches_question"] = "false" if o.get("matches_question") is False else "true"
            if scoping:
                row |= {"direction": None, "overall_direction": None, "risk_of_bias": None}
            elif card.get("design_category") in NON_QUANTITATIVE_CATEGORIES:  # themes: no direction (Task 2 review)
                row |= {"direction": None, "overall_direction": None}
            writer.writerow({k: _cell_value(v) for k, v in row.items()})
    return "\ufeff" + out.getvalue()  # BOM: spreadsheet apps then read Thai/unicode titles correctly
