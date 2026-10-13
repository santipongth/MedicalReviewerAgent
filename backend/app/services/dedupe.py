from __future__ import annotations

import re
from collections.abc import Iterable

from rapidfuzz import fuzz

from app.graph.schemas import Candidate
from app.services.text import normalize_title

SCALARS = ("title", "doi", "pmid", "pmcid", "arxiv_id", "year", "journal", "url", "pdf_url", "thaijo_url")


# Curated Europe PMC records win, then full abstracts from an engine/arXiv/ThaiJO, then search snippets.
_SOURCE_RANK = {"europepmc": 2, "arxiv": 1, "engine": 1, "thaijo": 1, "snippet": 0}


def identifiers(c: Candidate) -> list[str]:
    """The ids two records of one paper can share: DOI, PMID, PMCID, arXiv id and a long normalised title."""
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
    best = max((c for c in group if c.abstract), key=lambda c: (_SOURCE_RANK.get(c.abstract_source or "", 0),
                                                                len(c.abstract)), default=None)
    fields["abstract"] = best.abstract if best else None
    fields["abstract_source"] = best.abstract_source if best else None
    fields["authors"] = next((c.authors for c in group if c.authors), [])
    fields["engines"] = sorted({e for c in group for e in c.engines})
    fields["pub_types"] = list(dict.fromkeys(t for c in group for t in c.pub_types))
    fields["is_open_access"] = any(c.is_open_access for c in group)
    fields["cited_by"] = max((c.cited_by for c in group if c.cited_by is not None), default=None)
    return Candidate(**fields)


def merge_candidates(cands: Iterable[Candidate], *, fuzzy_threshold: int = 95, rank_from: int = 0) -> list[Candidate]:
    """Merge duplicates. Fields are combined in input order (earlier items win scalar fields). Groups come out in
    order of their earliest member at index >= `rank_from`: pass the number of leading metadata-only records (e.g.
    Europe PMC lookups) so they win fields without moving their group ahead of better-ranked search hits (audit
    I-8). Groups made only of those leading records come last."""
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
        for ident in identifiers(c):
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
    rank: dict[int, int] = {}
    for i, c in enumerate(items):
        root = find(i)
        groups.setdefault(root, []).append(c)
        if i >= rank_from and root not in rank:
            rank[root] = i
    return [_combine(groups[root]) for root in sorted(groups, key=lambda r: (r not in rank, rank.get(r, r)))]


class PaperIndex:
    """The papers already in hand, to tell whether another record is one of them by the same rules as
    merge_candidates: a shared identifier, or a near-identical title (same numbers, compatible years)."""

    def __init__(self, cands: Iterable[Candidate], *, fuzzy_threshold: int = 95) -> None:
        self.threshold = fuzzy_threshold
        self.ids: set[str] = set()
        self.titles: list[tuple[str, list[str], Candidate]] = []
        for c in cands:
            self.ids.update(identifiers(c))
            title = normalize_title(c.title)
            if title:
                self.titles.append((title, _numbers(title), c))

    def __contains__(self, c: Candidate) -> bool:
        if self.ids & set(identifiers(c)):
            return True
        title = normalize_title(c.title)
        if not title:
            return False
        numbers = _numbers(title)
        return any(n == numbers and _years_compatible(k, c) and fuzz.ratio(t, title) >= self.threshold
                   for t, n, k in self.titles)
