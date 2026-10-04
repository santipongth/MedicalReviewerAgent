"""Deterministic evidence matrix: the structured part of the synthesis is built by code, not by the LLM."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from app.graph.schemas import OutcomeCluster, OutcomeClusters, OutcomeMember
from app.services.text import normalize_title

DIRECTIONS = ("positive", "negative", "null")
# A row is consensus when at least this share of its studies (and at least 3 of them) report the same direction;
# the rest are listed as dissent. Below it, two or more directions make a conflict.
CONSENSUS_SHARE = 0.7
CONSENSUS_MIN_STUDIES = 3


def _ref_num(ref: str) -> int:
    return int(ref[1:]) if ref[1:].isdigit() else 10**6


def outcome_pairs(papers: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(p["ref"], o["outcome"]) for p in papers if p.get("card") for o in p["card"]["outcomes"]]


def validate_clusters(clusters: OutcomeClusters, papers: list[dict[str, Any]]) -> list[str]:
    expected = Counter(outcome_pairs(papers))
    seen = Counter((m.ref, m.outcome) for c in clusters.clusters for m in c.members)
    problems = [f"missing outcome {ref}: {outcome}" for (ref, outcome) in expected if (ref, outcome) not in seen]
    problems += [f"{ref}: {outcome} is assigned more than once" for (ref, outcome), n in seen.items() if n > 1]
    problems += [f"unknown member {ref}: {outcome} (not an outcome of that paper)"
                 for (ref, outcome) in seen if (ref, outcome) not in expected]
    problems += [f"cluster #{i + 1} has an empty canonical name" for i, c in enumerate(clusters.clusters)
                 if not c.canonical.strip()]
    return problems


def repair_clusters(clusters: OutcomeClusters, papers: list[dict[str, Any]]) -> tuple[OutcomeClusters, int, int]:
    """Deterministically fix a near-miss clustering instead of discarding it: drop unknown members, keep the first
    of duplicate assignments, name unnamed clusters after their first member, and put missing outcomes into the
    cluster whose name (or a member) matches their normalized name, else into their own cluster.
    Returns (clusters, corrections, members kept from the model)."""
    expected = outcome_pairs(papers)
    valid = set(expected)
    seen: set[tuple[str, str]] = set()
    fixed: list[OutcomeCluster] = []
    corrections = kept = 0
    for cluster in clusters.clusters:
        members = []
        for m in cluster.members:
            pair = (m.ref, m.outcome)
            if pair in valid and pair not in seen:
                seen.add(pair)
                members.append(OutcomeMember(ref=m.ref, outcome=m.outcome))
            else:
                corrections += 1
        if not members:
            continue
        canonical = cluster.canonical.strip()
        if not canonical:
            canonical, corrections = members[0].outcome, corrections + 1
        kept += len(members)
        fixed.append(OutcomeCluster(canonical=canonical, members=members))

    def key(text: str) -> str:
        return normalize_title(text) or text.lower()

    for ref, outcome in expected:
        if (ref, outcome) in seen:
            continue
        corrections += 1
        seen.add((ref, outcome))
        k = key(outcome)
        home = next((c for c in fixed if key(c.canonical) == k or any(key(m.outcome) == k for m in c.members)), None)
        if home is None:
            home = OutcomeCluster(canonical=outcome, members=[])
            fixed.append(home)
        home.members.append(OutcomeMember(ref=ref, outcome=outcome))
    return OutcomeClusters(clusters=fixed), corrections, kept


def fallback_clusters(papers: list[dict[str, Any]]) -> OutcomeClusters:
    groups: dict[str, OutcomeCluster] = {}
    for ref, outcome in outcome_pairs(papers):
        key = normalize_title(outcome) or outcome
        cluster = groups.setdefault(key, OutcomeCluster(canonical=outcome, members=[]))
        cluster.members.append(OutcomeMember(ref=ref, outcome=outcome))
    return OutcomeClusters(clusters=list(groups.values()))


def build_matrix(papers: list[dict[str, Any]], clusters: OutcomeClusters) -> dict[str, Any]:
    by_ref = {p["ref"]: p["card"] for p in papers if p.get("card")}
    rows: list[dict[str, Any]] = []
    for cluster in sorted(clusters.clusters, key=lambda c: c.canonical.lower()):
        cells = []
        for member in sorted(cluster.members, key=lambda m: (_ref_num(m.ref), m.outcome)):
            card = by_ref.get(member.ref)
            outcome = next((o for o in (card or {}).get("outcomes", []) if o["outcome"] == member.outcome), None)
            if outcome is None:
                continue
            cells.append({
                "ref": member.ref, "finding": outcome["result"], "direction": outcome["direction"],
                "effect_measure": outcome.get("effect_measure"), "effect_value": outcome.get("effect_value"),
                "ci_lower": outcome.get("ci_lower"), "ci_upper": outcome.get("ci_upper"),
            })
        if cells:
            rows.append({"outcome": cluster.canonical, "cells": cells})

    consensus: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    for row in rows:
        by_direction: dict[str, list[str]] = defaultdict(list)
        for cell in row["cells"]:
            if cell["direction"] in DIRECTIONS and cell["ref"] not in by_direction[cell["direction"]]:
                by_direction[cell["direction"]].append(cell["ref"])
        present = [d for d in DIRECTIONS if by_direction.get(d)]
        studies = len({r for d in present for r in by_direction[d]})
        top = max(present, key=lambda d: len(by_direction[d]), default=None)
        if len(present) == 1 and len(by_direction[top]) >= 2:
            consensus.append({"outcome": row["outcome"], "direction": top, "refs": by_direction[top], "dissent": {}})
        elif (len(present) >= 2 and studies >= CONSENSUS_MIN_STUDIES
              and len(by_direction[top]) / studies >= CONSENSUS_SHARE):
            consensus.append({"outcome": row["outcome"], "direction": top, "refs": by_direction[top],
                              "dissent": {d: by_direction[d] for d in present if d != top}})
        elif len(present) >= 2:
            refs = sorted({r for d in present for r in by_direction[d]}, key=_ref_num)
            conflicts.append({"outcome": row["outcome"], "refs": refs,
                              "directions": {d: by_direction[d] for d in present}})
    return {"rows": rows, "consensus": consensus, "conflicts": conflicts}
