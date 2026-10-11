"""Plan 22a Cochrane harness: files and their schemas. Paths are relative to backend/ (the working directory)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

EVAL_ROOT = Path("evals/cochrane")  # read at call time so tests can monkeypatch it


class Stratum(BaseModel):
    name: str
    query: str  # Europe PMC query terms for the stratum (ANDed with the Cochrane journal and year range)


class ManifestEntry(BaseModel):
    id: str  # Cochrane review number, e.g. CD012345
    pmid: str = ""
    doi: str = ""
    stratum: str
    title: str
    question: str = ""  # engine input topic (English)
    review_type: Literal["slr", "meta_analysis"] = "slr"
    primary_outcome: str = ""
    search_date: str = ""  # YYYY-MM-DD, Cochrane's last search
    year_to: int | None = None
    status: Literal["eligible", "excluded"] = "eligible"
    exclusion_reason: str = ""
    checked_by_owner: bool = False
    notes: str = ""


class Manifest(BaseModel):
    seed: int
    pool_version: str = "v1"
    year_from: int = 2020
    year_to: int = 2025
    per_stratum: int = 10
    strata: list[Stratum] = Field(default_factory=list)
    reviews: list[ManifestEntry] = Field(default_factory=list)


class Fixture(BaseModel):
    id: str
    pool_version: str
    frozen_at: str
    git_sha: str
    prompt_version: str
    engines: list[str]
    year_to: int
    topic: str
    english_topic: str | None
    question: dict[str, Any] | None
    plan: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    search_stats: dict[str, Any]
    status: Literal["ok", "rejected", "error"]
    error: str = ""


class PrimaryMatch(BaseModel):
    row_index: int | None  # index into result.synthesis_en.comparison, None = no matching outcome
    outcome: str | None
    verdict: str  # classify_row verdict: consensus | conflict | imprecise | none
    direction: str | None  # consensus direction (positive/negative/null) or None


class RunRecord(BaseModel):
    id: str
    repeat: int
    run_id: str
    prompt_version: str
    git_sha: str
    preset: str
    models: dict[str, str]
    started_at: str
    elapsed_s: float
    cost_usd: float
    status: Literal["done", "error", "rejected"]
    error: str = ""
    citations: dict[str, int] = Field(default_factory=dict)  # {"proposed", "stripped"}
    primary_match: PrimaryMatch | None = None
    result: dict[str, Any] | None = None


class GoldRecord(BaseModel):  # filled in Plan 22b
    id: str
    primary_outcome: str
    direction: Literal["benefit", "no_difference", "harm", "insufficient"]
    certainty: Literal["high", "moderate", "low", "very_low"]
    pooled: dict[str, Any] | None = None
    included_studies: list[dict[str, Any]] = Field(default_factory=list)
    extracted_by: str
    checked_by: str = ""


def load_manifest(path: Path | None = None) -> Manifest:
    p = path if path is not None else EVAL_ROOT / "manifest.yaml"
    return Manifest.model_validate(yaml.safe_load(p.read_text(encoding="utf-8")) or {})


def save_manifest(m: Manifest, path: Path | None = None) -> None:
    p = path if path is not None else EVAL_ROOT / "manifest.yaml"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(
        yaml.safe_dump(m.model_dump(), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )
    os.replace(tmp, p)


def fixture_path(pool_version: str, review_id: str) -> Path:
    return EVAL_ROOT / "fixtures" / f"pool-{pool_version}" / f"{review_id}.json"


def run_path(prompt_version: str, run_id: str, review_id: str, repeat: int) -> Path:
    return EVAL_ROOT / "runs" / prompt_version / run_id / f"{review_id}.r{repeat}.json"


def write_json_atomic(path: Path, data: BaseModel | dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = data.model_dump(mode="json") if isinstance(data, BaseModel) else data
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n"
    )
    os.replace(tmp, path)


def read_model[M: BaseModel](path: Path, cls: type[M]) -> M:
    return cls.model_validate_json(path.read_text(encoding="utf-8"))


def load_gold(review_id: str) -> GoldRecord | None:
    p = EVAL_ROOT / "gold" / f"{review_id}.yaml"
    return (
        GoldRecord.model_validate(yaml.safe_load(p.read_text(encoding="utf-8")))
        if p.exists()
        else None
    )
