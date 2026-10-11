"""Browse OpenRouter models and validate config/llm.yaml.

    python -m app.cli.models list [--search TEXT] [--structured] [--reasoning] [--max-price USD_PER_1M] [--limit N]
    python -m app.cli.models check [--config PATH] [--preset NAME]
"""
from __future__ import annotations

import argparse
import sys
from collections.abc import Awaitable, Callable
from typing import TextIO

from app.compat import run_async
from app.config import get_settings
from app.schemas.review import ReviewOptions
from app.services.http import HttpClient
from app.services.llm_config import LLMConfigError, load_llm_config
from app.services.model_catalog import (
    ModelInfo,
    OpenRouterCatalog,
    choose_structured_method,
    validate_role,
)

_PAPERS = ReviewOptions.model_fields["max_papers"].default
_POOL = ReviewOptions.model_fields["candidate_limit"].default

# Rough token budget of one default review (a full pool screened, the default paper count analysed), used for the
# cost estimate in `check`.
TYPICAL_CALLS: dict[str, tuple[int, int, int]] = {  # role: (calls, input tokens, output tokens) per call
    "guard": (1, 400, 100),
    "refiner": (2, 1500, 1200),                 # draft + one self-critique round
    "planner": (1, 900, 700),
    "screener": (_POOL // 10, 6000, 900),       # the pool in parallel batches of 10
    "extractor": (_PAPERS, 1200, 700),           # one abstract per analysed paper
    "synthesizer": (1, 20000, 3000),
    "screener_secondary": (8, 3000, 500),       # only borderline papers get a second vote
    "extractor_secondary": (_PAPERS, 1200, 700),     # dual extraction
    "normalizer": (1, 6000, 2000),
    "conflict_explainer": (4, 6000, 600),
    "localizer": (8, 1500, 2000),               # small chunks, run in parallel
    "escalation": (4, 3000, 1000),              # expected ~10-20% of steps
    "enricher": (1, 3000, 400),                 # only when external MCP servers are configured
}

CatalogLoader = Callable[[], Awaitable[dict[str, ModelInfo]]]


async def _load_live_catalog() -> dict[str, ModelInfo]:
    http = HttpClient(timeout=30)
    try:
        return await OpenRouterCatalog(http).load()
    finally:
        await http.aclose()


def _per_m(price: float) -> str:
    return f"{price * 1_000_000:.3f}".rstrip("0").rstrip(".")


def _list(args, catalog: dict[str, ModelInfo], out: TextIO) -> int:
    rows = sorted(catalog.values(), key=lambda m: (m.price_in, m.id))
    if args.search:
        rows = [m for m in rows if args.search.lower() in m.id.lower()]
    if args.structured:
        rows = [m for m in rows if m.supports("structured_outputs")]
    if args.reasoning:
        rows = [m for m in rows if m.supports("reasoning")]
    if args.max_price is not None:
        rows = [m for m in rows if m.price_in * 1_000_000 <= args.max_price]
    out.write(f"{'model':<48} {'in $/1M':>9} {'out $/1M':>9} {'context':>9}  capabilities\n")
    for m in rows[: args.limit]:
        caps = ",".join(c for c in ("structured_outputs", "tools", "reasoning") if m.supports(c))
        out.write(f"{m.id:<48} {_per_m(m.price_in):>9} {_per_m(m.price_out):>9} {m.context_length or '-':>9}  {caps}\n")
    out.write(f"{min(len(rows), args.limit)} of {len(rows)} matching models\n")
    return 0


def _check(args, catalog: dict[str, ModelInfo], out: TextIO) -> int:
    settings = get_settings()
    try:
        config = load_llm_config(args.config or settings.llm_config_path, args.preset or settings.llm_preset)
    except LLMConfigError as exc:
        out.write(f"ERROR {exc}\n")
        return 1
    out.write(f"preset: {config.preset}\n")
    problems: list[str] = []
    total = 0.0
    for name, role in config.roles.items():
        info = catalog.get(role.spec.model) if role.provider == "openrouter" else None
        method = choose_structured_method(role.spec.structured_output, info)
        calls, tin, tout = TYPICAL_CALLS[name]
        cost = calls * info.cost(tin, tout) if info else 0.0
        total += cost
        effort = role.spec.reasoning_effort or "-"
        out.write(f"  {name:<12} {role.provider}:{role.spec.model:<40} method={method:<16} effort={effort:<7} "
                  f"~${cost:.4f}\n")
        problems += validate_role(role, catalog)
    out.write(f"Estimated cost per review ({_POOL} candidates -> {_PAPERS} abstracts, OpenRouter roles): ~${total:.3f}\n")
    out.writelines(f"PROBLEM {p}\n" for p in problems)
    return 1 if problems else 0


def main(argv: list[str] | None = None, *, load_catalog: CatalogLoader | None = None,
         out: TextIO | None = None) -> int:
    out = out or sys.stdout
    parser = argparse.ArgumentParser(prog="python -m app.cli.models")
    sub = parser.add_subparsers(dest="command", required=True)
    p_list = sub.add_parser("list", help="list OpenRouter models with prices and capabilities")
    p_list.add_argument("--search")
    p_list.add_argument("--structured", action="store_true", help="only models with strict structured outputs")
    p_list.add_argument("--reasoning", action="store_true", help="only reasoning models")
    p_list.add_argument("--max-price", type=float, help="max input price, USD per 1M tokens")
    p_list.add_argument("--limit", type=int, default=60)
    p_check = sub.add_parser("check", help="validate config/llm.yaml against the catalog")
    p_check.add_argument("--config")
    p_check.add_argument("--preset")
    args = parser.parse_args(argv)
    catalog = run_async((load_catalog or _load_live_catalog)())
    return _list(args, catalog, out) if args.command == "list" else _check(args, catalog, out)


if __name__ == "__main__":
    raise SystemExit(main())
