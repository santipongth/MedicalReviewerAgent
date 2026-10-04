from __future__ import annotations

import re
from collections.abc import Iterable

from rapidfuzz import fuzz

from app.graph.schemas import Candidate
from app.services.text import normalize_title

SCALARS = ("title", "doi", "pmid", "pmcid", "arxiv_id", "year", "journal", "url", "pdf_url")


def _identifiers(c: Candidate) -> list[str]:
    ids = [f"doi:{c.doi}" if c.doi else "", f"pmid:{c.pmid}" if c.pmid else "",
           f"pmcid:{c.pmcid}" if c.pmcid else "", f"arxiv:{c.arxiv_id}" if c.arxiv_id else ""]
    title = normalize_title(c.title)
    if len(title) >= 20:
        ids.append(f"t:{title}")
    return [i for i in ids if i]


def _years_compatible(a: Candidate, b: Candidate) -> bool:
    return a.year is None or b.year is None or abs(a.year - b.year) <= 1


def _numbers(title: str) -> list[str]:
    return re.findall(r"\d+", title)


def _combine(group: list[Candidate]) -> Candidate:
    fields: dict = {}
    for name in SCALARS:
        fields[name] = next((getattr(c, name) for c in group if getattr(c, name)), None)
    fields["title"] = fields["title"] or group[0].title
    # A curated abstract beats a (possibly truncated) search snippet even when the snippet is longer.
    best = max((c for c in group if c.abstract), key=lambda c: (c.abstract_source != "snippet", len(c.abstract)),
               default=None)
    fields["abstract"] = best.abstract if best else None
    fields["abstract_source"] = best.abstract_source if best else None
    fields["authors"] = next((c.authors for c in group if c.authors), [])
    fields["engines"] = sorted({e for c in group for e in c.engines})
    fields["pub_types"] = list(dict.fromkeys(t for c in group for t in c.pub_types))
    fields["is_open_access"] = any(c.is_open_access for c in group)
    fields["cited_by"] = max((c.cited_by for c in group if c.cited_by is not None), default=None)
    return Candidate(**fields)


def merge_candidates(cands: Iterable[Candidate], *, fuzzy_threshold: int = 95) -> list[Candidate]:
    items = list(cands)
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)  # keep the earliest index as root

    seen: dict[str, int] = {}
    for i, c in enumerate(items):
        for ident in _identifiers(c):
            if ident.startswith("t:") and ident in seen and not _years_compatible(items[seen[ident]], c):
                continue
            if ident in seen:
                union(seen[ident], i)
            else:
                seen[ident] = i

    titles = [normalize_title(c.title) for c in items]
    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            if find(a) == find(b) or not titles[a] or not titles[b]:
                continue
            if (_years_compatible(items[a], items[b]) and _numbers(titles[a]) == _numbers(titles[b])
                    and fuzz.ratio(titles[a], titles[b]) >= fuzzy_threshold):
                union(a, b)

    groups: dict[int, list[Candidate]] = {}
    for i, c in enumerate(items):
        groups.setdefault(find(i), []).append(c)
    return [_combine(groups[root]) for root in sorted(groups)]
