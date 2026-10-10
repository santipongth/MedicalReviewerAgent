"""Citation graph between the papers of one review (pure; no I/O).

Edges run citing -> cited and only between distinct review papers. `coverage[ref]` says where a paper's
reference list came from; null means we have no data, which is NOT the same as "cites nothing in the review"."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.services.europepmc import EpmcReference
from app.services.openalex import OpenAlexWork
from app.services.text import normalize_doi

NOTE_OPENALEX = "Reference lists and citation counts from OpenAlex"
NOTE_EPMC = "Reference lists from Europe PMC"
NOTE_UNAVAILABLE = "Citation data was unavailable for this review"
NOTE_NONE = "No citation data was found for these papers"


def paper_idents(papers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """ref -> {doi, pmid, pmcid, cited_by} from selected entries ({ref, candidate})."""
    out: dict[str, dict[str, Any]] = {}
    for p in papers:
        c = p.get("candidate") or {}
        out[p["ref"]] = {"doi": normalize_doi(c.get("doi")), "pmid": c.get("pmid") or None,
                         "pmcid": c.get("pmcid") or None, "cited_by": c.get("cited_by")}
    return out


def empty_citations(refs: list[str], note: str = NOTE_UNAVAILABLE) -> dict[str, Any]:
    return {"edges": [], "cited_by": {r: None for r in refs}, "cited_by_source": {r: None for r in refs},
            "coverage": {r: None for r in refs}, "source_note": note}


def build_citations(
    idents: Mapping[str, Mapping[str, Any]],
    openalex: Mapping[str, OpenAlexWork | None],
    epmc: Mapping[str, list[EpmcReference] | None],
) -> dict[str, Any]:
    refs = list(idents)
    oa_to_ref = {w.openalex_id: r for r, w in openalex.items() if w and w.openalex_id}
    by_pmid = {str(i["pmid"]): r for r, i in idents.items() if i.get("pmid")}
    by_doi = {i["doi"]: r for r, i in idents.items() if i.get("doi")}
    edges: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    coverage: dict[str, str | None] = {}
    cited_by: dict[str, int | None] = {}
    cited_by_source: dict[str, str | None] = {}

    def add(src: str, dst: str | None) -> None:
        if dst and dst != src and (src, dst) not in seen:
            seen.add((src, dst))
            edges.append({"from": src, "to": dst})

    for ref in refs:
        work = openalex.get(ref)
        fallback = idents[ref].get("cited_by")
        if work and work.cited_by_count is not None:
            cited_by[ref], cited_by_source[ref] = work.cited_by_count, "openalex"
        elif isinstance(fallback, int):  # Europe PMC's citedByCount via the candidate; the sources count differently
            cited_by[ref], cited_by_source[ref] = fallback, "europepmc"
        else:
            cited_by[ref], cited_by_source[ref] = None, None
        if work and work.referenced_works:
            coverage[ref] = "openalex"
            for oa in work.referenced_works:
                add(ref, oa_to_ref.get(oa))
            continue
        listed = epmc.get(ref)
        if listed:
            coverage[ref] = "europepmc"
            for r in listed:
                add(ref, (by_pmid.get(r.pmid) if r.pmid else None) or (by_doi.get(r.doi) if r.doi else None))
        else:
            coverage[ref] = None
    used = {v for v in coverage.values() if v}
    note = (NOTE_OPENALEX if used == {"openalex"} else NOTE_EPMC if used == {"europepmc"} else
            f"{NOTE_OPENALEX}; Europe PMC reference lists for papers OpenAlex lacked" if used else NOTE_NONE)
    return {"edges": edges, "cited_by": cited_by, "cited_by_source": cited_by_source, "coverage": coverage,
            "source_note": note}
