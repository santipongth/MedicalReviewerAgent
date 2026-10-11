"""Plan 22a Cochrane harness (run from backend/).

    python -m app.cli.eval select                  # sampling frame + LLM eligibility -> draft manifest
    python -m app.cli.eval freeze [--ids ..] [--force]
    python -m app.cli.eval run [--run-id ID] [--repeats 2] [--max-usd 10] [--ids ..]
    python -m app.cli.eval report --run-id ID [--compare-run PROMPT_VERSION/RUN_ID]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import UTC, datetime

from app.evals import models
from app.evals.batch import run_all
from app.evals.freeze import freeze_all
from app.evals.metrics import aggregate, review_metrics
from app.evals.models import RunRecord, load_manifest, read_model, save_manifest
from app.evals.report import render_report
from app.evals.select import select


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.cli.eval")
    sub = p.add_subparsers(dest="cmd", required=True)
    sl = sub.add_parser("select", help="build the draft manifest (owner checks it before freeze)")
    sl.add_argument("--force", action="store_true", help="rebuild a non-empty manifest (keeps a .bak copy)")
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


def git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:  # noqa: BLE001 - outside a checkout
        return "unknown"


def _load_rows(prompt_version: str, run_id: str, manifest) -> tuple[list, dict]:
    strata = {e.id: e.stratum for e in manifest.reviews}
    folder = models.EVAL_ROOT / "runs" / prompt_version / run_id
    recs = [read_model(p, RunRecord) for p in sorted(folder.glob("*.json"))]
    meta = {"git_sha": recs[0].git_sha, "preset": recs[0].preset, "models": recs[0].models} if recs else {}
    return [review_metrics(r, strata.get(r.id, "?")) for r in recs], meta


async def run(argv: list[str], deps, http, base_url: str) -> int:
    args = _parser().parse_args(argv)
    manifest = load_manifest(models.EVAL_ROOT / "manifest.yaml")
    if args.cmd == "select":
        path = models.EVAL_ROOT / "manifest.yaml"
        if manifest.reviews:
            if not args.force:
                print(f"manifest already has {len(manifest.reviews)} reviews; re-run with --force to rebuild "
                      "(a .bak copy is kept)")
                return 1
            shutil.copyfile(path, path.with_name(path.name + ".bak"))
        out = await select(deps, http, base_url, manifest.model_copy(update={"reviews": []}))
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


def main() -> None:
    from app.compat import run_async
    from app.config import get_settings
    from app.graph.factory import build_graph_deps
    from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

    settings = get_settings()

    async def go() -> int:
        http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
        deps = build_graph_deps(settings, http)
        deps.openalex, deps.mcp = None, None  # no citation network or external tools: replays stay deterministic
        try:
            return await run(sys.argv[1:], deps, http, settings.europepmc_url)
        finally:
            await http.aclose()

    sys.exit(run_async(go()))


if __name__ == "__main__":
    main()
