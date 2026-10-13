"""Browse OpenRouter models and validate config/llm.yaml.

    python -m app.cli.models list [--search TEXT] [--structured] [--reasoning] [--max-price USD_PER_1M] [--limit N]
    python -m app.cli.models check [--config PATH] [--preset NAME] [--source file|db]
"""
from __future__ import annotations

import argparse
import sys
from collections.abc import Awaitable, Callable
from typing import TextIO

from app.compat import run_async
from app.config import get_settings
from app.services.llm_config import LLMConfigError, load_llm_config
from app.services.llm_cost import _PAPERS, _POOL, TYPICAL_CALLS
from app.services.model_catalog import (
    ModelInfo,
    choose_structured_method,
    load_live_catalog,
    validate_role,
)

CatalogLoader = Callable[[], Awaitable[dict[str, ModelInfo]]]


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


async def _db_config(settings):
    from app.db.session import make_engine, make_session_factory
    from app.services.llm_store import load_effective

    engine = make_engine(settings.database_url)
    try:
        async with make_session_factory(engine)() as session:
            return await load_effective(session, settings)
    finally:
        await engine.dispose()


def _check(args, catalog: dict[str, ModelInfo], out: TextIO) -> int:
    settings = get_settings()
    try:
        if args.source == "db":
            effective = run_async(_db_config(settings))
            out.write(f"source: {effective.label}\n")
            config = effective.resolve()
        else:
            config = load_llm_config(args.config or settings.llm_config_path, args.preset or settings.llm_preset)
    except LLMConfigError as exc:
        out.write(f"ERROR {exc}\n")
        return 1
    out.write(f"preset: {config.preset}\n")
    problems: list[str] = []
    total = 0.0
    for name, role in config.roles.items():
        info = catalog.get(role.spec.model) if role.kind == "openrouter" else None
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
    p_check = sub.add_parser("check", help="validate config/llm.yaml (or the stored version) against the catalog")
    p_check.add_argument("--config")
    p_check.add_argument("--preset")
    p_check.add_argument("--source", choices=["file", "db"], default="file",
                         help="file: config/llm.yaml; db: the newest version saved in the admin console")
    args = parser.parse_args(argv)
    catalog = run_async((load_catalog or load_live_catalog)())
    return _list(args, catalog, out) if args.command == "list" else _check(args, catalog, out)


if __name__ == "__main__":
    raise SystemExit(main())
