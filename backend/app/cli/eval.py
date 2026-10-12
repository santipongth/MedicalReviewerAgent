"""Plan 22a Cochrane harness (run from backend/).

    python -m app.cli.eval select [--continue | --force]  # sampling frame + LLM eligibility -> draft manifest
    python -m app.cli.eval freeze [--ids ..] [--force]
    python -m app.cli.eval run [--run-id ID] [--repeats 2] [--max-usd 10] [--ids ..]
    python -m app.cli.eval report --run-id ID [--compare-run PROMPT_VERSION/RUN_ID]

Models (Plan 23b): select, freeze and run use the service's effective LLM config: the newest version saved in the
admin console (database), else config/llm.yaml (LLM_PRESET applies to the file only). Put `--config-file PATH` (or
`--config-file=PATH`) before or after the command to use that YAML file instead and ignore the database. A database
or config file that cannot be read is an error (exit 2) that names this flag, never a silent fallback. report, --help
and bad arguments never touch the database. Each run record stores the config label (`db:<id>`, `file`,
`file:<path>`).
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from app.evals import models
from app.evals.batch import run_all
from app.evals.freeze import _selected, freeze_all
from app.evals.metrics import aggregate, review_metrics
from app.evals.models import RunRecord, load_manifest, read_model, save_manifest
from app.evals.report import render_report
from app.evals.select import select

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.config import Settings
    from app.services.llm_config import ResolvedLLMConfig

LLM_COMMANDS = ("select", "freeze", "run")  # the commands that call an LLM; report only reads run files


class EvalConfigError(Exception):
    """The model configuration for an eval run could not be read."""


def _why(exc: Exception) -> str:
    """One readable line for an error message (SQLAlchemy errors carry the whole statement)."""
    lines = str(exc).splitlines()
    return lines[0] if lines else type(exc).__name__


async def eval_llm_config(
    settings: Settings, config_file: str | None,
    session_factory_maker: Callable[[], async_sessionmaker[AsyncSession]],
) -> tuple[ResolvedLLMConfig, str]:
    """(resolved config, label) for an eval run: the service's effective config (the newest DB version, else
    llm.yaml), or the given file. A DB or file that cannot be read is an EvalConfigError, never a silent fallback
    (Plan 23b)."""
    from app.services.llm_config import load_llm_config
    from app.services.llm_store import load_effective

    if config_file:
        try:
            return load_llm_config(config_file, settings.llm_preset), f"file:{config_file}"
        except Exception as exc:
            raise EvalConfigError(f"cannot use the model config file {config_file}: {_why(exc)}") from exc
    try:
        session_factory = session_factory_maker()
        async with session_factory() as session:
            effective = await load_effective(session, settings)
    except Exception as exc:
        raise EvalConfigError(f"cannot read the model config ({_why(exc)}); check that Postgres is running and "
                              f"migrated, or pass --config-file PATH") from exc
    try:
        return effective.resolve(), effective.label
    except Exception as exc:  # e.g. LLM_PRESET names a preset the file does not have
        raise EvalConfigError(f"the model config in use ({effective.label}) is not usable: {_why(exc)}") from exc


def split_config_file(argv: list[str]) -> tuple[str | None, list[str]]:
    """(the --config-file value, the other arguments); the flag may stand before or after the command."""
    pre = argparse.ArgumentParser(prog="python -m app.cli.eval", add_help=False, allow_abbrev=False)
    pre.add_argument("--config-file")
    known, rest = pre.parse_known_args(argv)
    return known.config_file, rest


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.cli.eval")
    sub = p.add_subparsers(dest="cmd", required=True)
    sl = sub.add_parser("select", help="build the draft manifest (owner checks it before freeze)")
    mode = sl.add_mutually_exclusive_group()
    mode.add_argument("--force", action="store_true", help="rebuild a non-empty manifest (keeps a .bak copy)")
    mode.add_argument("--continue", dest="cont", action="store_true",
                      help="keep existing entries and top each stratum up to per_stratum eligible reviews")
    f = sub.add_parser("freeze", help="freeze the candidate pool of every checked review")
    f.add_argument("--ids", nargs="*")
    f.add_argument("--force", action="store_true")
    r = sub.add_parser("run", help="replay every frozen pool (resumable)")
    r.add_argument("--run-id", default=datetime.now(UTC).strftime("%Y%m%d-%H%M"))
    r.add_argument("--repeats", type=int, default=2)
    r.add_argument("--max-usd", type=float, default=10.0)
    r.add_argument("--ids", nargs="*")
    rp = sub.add_parser("report", help="write reports/<prompt_version>-<run_id>.md")
    rp.add_argument("--run-id", required=True)
    rp.add_argument("--compare-run", help="PROMPT_VERSION/RUN_ID of an earlier batch")
    return p


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")


def git_sha() -> str:
    try:
        return subprocess.run(["git", "describe", "--always", "--dirty"], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:  # noqa: BLE001 - outside a checkout
        return "unknown"


def _load_rows(prompt_version: str, run_id: str, manifest) -> tuple[list, dict]:
    strata = {e.id: e.stratum for e in manifest.reviews}
    folder = models.EVAL_ROOT / "runs" / prompt_version / run_id
    recs = [read_model(p, RunRecord) for p in sorted(folder.glob("*.json"))]
    meta: dict = {}
    if recs:
        meta = {"git_sha": recs[0].git_sha, "preset": recs[0].preset, "models": recs[0].models,
                "pool_version": recs[0].pool_version}
        # expected = every selected review x every repeat number seen in the folder (at least r1 and r2)
        repeats = {1, 2} | {r.repeat for r in recs}
        have = {(r.id, r.repeat) for r in recs}
        meta["missing"] = [f"{e.id} r{n}" for e in _selected(manifest, None) for n in sorted(repeats)
                           if (e.id, n) not in have]
        meta["expected"] = len(_selected(manifest, None)) * len(repeats)
        fields = {"models": [json.dumps(r.models, sort_keys=True) for r in recs],
                  "git_sha": [r.git_sha for r in recs], "preset": [r.preset for r in recs],
                  "prompt_version": [r.prompt_version for r in recs],
                  "pool_version": [r.pool_version for r in recs],
                  "llm_config": [r.llm_config for r in recs]}
        # records of rejected/errored fixtures carry no models or pool version: they never make a batch "mixed"
        distinct = {k: sorted(set(v) - {"{}", ""}) for k, v in fields.items()}
        meta["mixed"] = {k: v for k, v in distinct.items() if len(v) > 1}
    return [review_metrics(r, strata.get(r.id, "?")) for r in recs], meta


async def run(argv: list[str], deps, http, base_url: str) -> int:
    args = _parser().parse_args(argv)
    manifest = load_manifest(models.EVAL_ROOT / "manifest.yaml")
    if args.cmd == "select":
        path = models.EVAL_ROOT / "manifest.yaml"
        if manifest.reviews:
            if not args.force and not args.cont:
                print(f"manifest already has {len(manifest.reviews)} reviews; re-run with --continue to top up "
                      "the strata, or --force to rebuild (a .bak copy is kept)")
                return 1
            # one backup per run: the manifest is saved after every record, so a later --force must not overwrite
            # the backup of an owner-checked manifest with a crashed run's partial one
            shutil.copyfile(path, path.with_name(f"{path.name}.{_stamp()}.bak"))
        start = manifest if args.cont else manifest.model_copy(update={"reviews": []})

        def progress(m, entry) -> None:  # saved after every judged record: an interrupted run resumes with --continue
            save_manifest(m, path)
            print(f"{entry.stratum} {entry.id}: {entry.status} {entry.exclusion_reason}".rstrip(), flush=True)

        out = await select(deps, http, base_url, start, on_entry=progress)
        save_manifest(out, path)
        eligible = sum(1 for r in out.reviews if r.status == "eligible")
        print(f"{eligible} eligible, {len(out.reviews) - eligible} excluded; set checked_by_owner after review")
        return 0
    if args.cmd in ("freeze", "run"):
        unchecked = [e.id for e in manifest.reviews if e.status == "eligible" and not e.checked_by_owner
                     and (args.ids is None or e.id in args.ids)]
        if unchecked:
            print(f"{len(unchecked)} eligible review(s) lack checked_by_owner: {', '.join(unchecked[:10])}")
            return 1
    if args.cmd == "freeze":
        engines = [e.strip() for e in str(deps.settings.searxng_engines).split(",") if e.strip()]
        fixtures = await freeze_all(deps, manifest, ids=args.ids, force=args.force, git_sha=git_sha(),
                                    engines=engines)
        print(", ".join(f"{f.id}:{f.status}:{len(f.candidates)}" for f in fixtures))
        return 0
    if args.cmd == "run":
        print(f"run id: {args.run_id}")
        s = await run_all(deps, manifest, run_id=args.run_id, repeats=args.repeats, max_usd=args.max_usd,
                          ids=args.ids, git_sha=git_sha())
        print(f"run {args.run_id}: done={s.done} skipped={s.skipped} failed={s.failed} spent=${s.spent:.2f}"
              + (" (stopped: --max-usd reached)" if s.stopped_for_budget else ""))
        if s.missing_fixture:
            print(f"missing fixtures (run freeze): {', '.join(s.missing_fixture)}")
        return 0
    pv = deps.settings.prompt_version
    if args.compare_run and "/" not in args.compare_run:
        print("--compare-run must look like PROMPT_VERSION/RUN_ID")
        return 1
    rows, meta = _load_rows(pv, args.run_id, manifest)
    if not rows:
        print(f"no run files for {pv}/{args.run_id}")
        return 1
    compare = None
    if args.compare_run:
        other_pv, other_run = args.compare_run.split("/", 1)
        other_rows, _ = _load_rows(other_pv, other_run, manifest)
        if not other_rows:
            print(f"no run files for {args.compare_run}")
            return 1
        compare = {"label": args.compare_run, "aggregate": aggregate(other_rows), "rows": other_rows}
    path = models.EVAL_ROOT / "reports" / f"{pv}-{args.run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(pv, args.run_id, manifest, rows, meta, compare), encoding="utf-8", newline="\n")
    print(path)
    return 0


async def eval_main(settings: Settings, config_file: str | None, rest: list[str],
                    session_factory_maker: Callable[[], async_sessionmaker[AsyncSession]],
                    release_db: Callable[[], Awaitable[None]] | None = None) -> int:
    """`rest` has already passed the argument parser (main() does that first). Only select, freeze and run need
    models, and only they read the database, and not when --config-file is given."""
    from app.graph.factory import build_graph_deps
    from app.graph.graph import GraphDeps
    from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

    resolved, label = None, "file"
    if _parser().parse_args(rest).cmd in LLM_COMMANDS:
        try:
            resolved, label = await eval_llm_config(settings, config_file, session_factory_maker)
        except EvalConfigError as exc:
            print(exc)
            return 2
        finally:
            if release_db is not None:
                await release_db()
        print(f"llm config: {label}")
    http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    # report needs the settings (prompt version) and no models
    deps = (build_graph_deps(settings, http, resolved=resolved, config_version=label) if resolved is not None
            else GraphDeps(settings=settings))
    deps.openalex, deps.mcp = None, None  # no citation network or external tools: replays stay deterministic
    try:
        return await run(rest, deps, http, settings.europepmc_url)
    finally:
        await http.aclose()


def main() -> None:
    from app.compat import run_async
    from app.config import get_settings

    settings = get_settings()
    if isinstance(sys.stdout, io.TextIOWrapper):  # piped or redirected stdout is cp1252 here: "≥" must not crash
        sys.stdout.reconfigure(errors="replace")

    config_file, rest = split_config_file(sys.argv[1:])
    _parser().parse_args(rest)  # --help and bad arguments end here, before any database access
    engine = None

    def factory():
        nonlocal engine
        from app.db.session import make_engine, make_session_factory

        engine = make_engine(settings.database_url)
        return make_session_factory(engine)

    async def release_db() -> None:
        if engine is not None:
            await engine.dispose()

    sys.exit(run_async(eval_main(settings, config_file, rest, factory, release_db)))


if __name__ == "__main__":
    main()
