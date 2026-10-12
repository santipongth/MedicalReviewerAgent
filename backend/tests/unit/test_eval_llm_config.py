import sys
from dataclasses import replace

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.cli.eval import EvalConfigError, eval_llm_config, main, split_config_file
from app.config import Settings
from app.db.session import make_session_factory
from app.evals import models
from app.evals.models import Manifest, RunRecord, save_manifest
from app.services.admin_auth import AdminPrincipal
from app.services.llm_store import save_version
from tests.llm_helpers import MINIMAL, write_yaml


async def test_the_db_version_is_used_and_labelled(tmp_path, session_factory):
    settings = Settings(_env_file=None, llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    async with session_factory() as s, s.begin():
        row = await save_version(s, AdminPrincipal("cli", None, "cli"), {**MINIMAL, "active_preset": "better"},
                                 settings=settings, base_version=None)
    resolved, label = await eval_llm_config(settings, None, lambda: session_factory)
    assert resolved.preset == "better" and label == f"db:{row.id}"


async def test_a_config_file_forces_the_file(tmp_path, session_factory):
    path = write_yaml(tmp_path / "other.yaml", MINIMAL)
    resolved, label = await eval_llm_config(Settings(_env_file=None), str(path), lambda: session_factory)
    assert resolved.preset == "cheap" and label == f"file:{path}"


async def test_a_config_file_wins_over_an_existing_db_version(tmp_path, session_factory):
    path = write_yaml(tmp_path / "other.yaml", MINIMAL)
    settings = Settings(_env_file=None, llm_config_path=str(path))
    async with session_factory() as s, s.begin():
        await save_version(s, AdminPrincipal("cli", None, "cli"), {**MINIMAL, "active_preset": "better"},
                           settings=settings, base_version=None)
    opened = []

    def maker():
        opened.append(1)
        return session_factory

    resolved, label = await eval_llm_config(settings, str(path), maker)
    assert resolved.preset == "cheap" and label == f"file:{path}" and opened == []  # the DB is not even opened


async def test_an_unreachable_db_is_an_error_naming_the_flag():
    def broken():
        raise OSError("connection refused")

    with pytest.raises(EvalConfigError, match="--config-file") as err:
        await eval_llm_config(Settings(_env_file=None), None, broken)
    assert "connection refused" in str(err.value)


async def test_a_lazy_engine_that_fails_on_the_query_is_an_error_naming_the_flag(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}")  # no tables: the query fails
    try:
        with pytest.raises(EvalConfigError, match="--config-file") as err:
            await eval_llm_config(Settings(_env_file=None), None, lambda: make_session_factory(engine))
    finally:
        await engine.dispose()
    assert "no such table" in str(err.value) and "\n" not in str(err.value)  # one readable line


@pytest.mark.parametrize("content", [None, "- a\n- b\n", "presets: [unclosed"])
async def test_an_unusable_config_file_is_an_error_not_a_traceback(tmp_path, session_factory, content):
    path = tmp_path / "bad.yaml"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    with pytest.raises(EvalConfigError, match="bad.yaml"):
        await eval_llm_config(Settings(_env_file=None), str(path), lambda: session_factory)


async def test_a_preset_the_file_lacks_is_an_error_not_a_traceback(tmp_path, session_factory):
    path = write_yaml(tmp_path / "llm.yaml", MINIMAL)
    settings = Settings(_env_file=None, llm_config_path=str(path), llm_preset="nope")
    with pytest.raises(EvalConfigError, match="nope"):  # file source through the (empty) DB
        await eval_llm_config(settings, None, lambda: session_factory)
    with pytest.raises(EvalConfigError, match="nope"):  # forced file
        await eval_llm_config(settings, str(path), lambda: session_factory)


def test_run_records_carry_the_config_label():
    assert RunRecord.model_fields["llm_config"].default == ""


async def test_a_replay_records_the_label_of_the_config_it_ran_with():
    from app.evals.run import replay
    from tests.unit.test_eval_graph import fixture_from, freeze_values
    from tests.unit.test_review_graph import make_deps

    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    deps.llms = replace(deps.llms, config_version="db:7")
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s")
    assert rec.status == "done" and rec.llm_config == "db:7"


async def test_a_rejected_fixture_record_carries_the_label_too(tmp_path, monkeypatch):
    from app.evals.batch import run_all
    from app.evals.freeze import freeze_all
    from tests.unit.test_eval_batch import manifest
    from tests.unit.test_review_graph import make_deps

    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    deps, m = make_deps(allowed=False), manifest(1)
    deps.llms = replace(deps.llms, config_version="db:3")
    await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    await run_all(deps, m, run_id="rj", repeats=1, max_usd=100, ids=None, git_sha="s")
    rec = models.read_model(models.run_path(deps.settings.prompt_version, "rj", "CD0", 1), RunRecord)
    assert rec.status == "rejected" and rec.llm_config == "db:3"


async def test_the_report_flags_a_batch_run_with_two_configs(tmp_path, monkeypatch):
    from app.cli.eval import run
    from tests.unit.test_eval_cli import _entry, _write_rec
    from tests.unit.test_review_graph import make_deps

    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, reviews=[_entry("CD1")]), tmp_path / "manifest.yaml")
    deps = make_deps()
    pv = deps.settings.prompt_version
    _write_rec(tmp_path, pv, "t1", "CD1", 1, llm_config="db:1")
    _write_rec(tmp_path, pv, "t1", "CD1", 2, llm_config="db:2")
    assert await run(["report", "--run-id", "t1"], deps, None, "") == 0
    report = (tmp_path / "reports" / f"{pv}-t1.md").read_text(encoding="utf-8")
    assert "**MIXED BATCH:** llm_config: db:1, db:2" in report


async def test_records_from_before_the_label_do_not_make_a_batch_mixed(tmp_path, monkeypatch):
    from app.cli.eval import run
    from tests.unit.test_eval_cli import _entry, _write_rec
    from tests.unit.test_review_graph import make_deps

    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, reviews=[_entry("CD1")]), tmp_path / "manifest.yaml")
    deps = make_deps()
    pv = deps.settings.prompt_version
    _write_rec(tmp_path, pv, "t1", "CD1", 1)
    _write_rec(tmp_path, pv, "t1", "CD1", 2, llm_config="db:2")
    assert await run(["report", "--run-id", "t1"], deps, None, "") == 0
    assert "MIXED BATCH" not in (tmp_path / "reports" / f"{pv}-t1.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("argv, expected", [
    (["run", "--config-file", "a.yaml"], ("a.yaml", ["run"])),
    (["--config-file", "a.yaml", "run", "--repeats", "1"], ("a.yaml", ["run", "--repeats", "1"])),
    (["run", "--config-file=a.yaml", "--ids", "CD1"], ("a.yaml", ["run", "--ids", "CD1"])),
    (["report", "--run-id", "x"], (None, ["report", "--run-id", "x"])),
    (["select", "--continue"], (None, ["select", "--continue"])),  # no abbreviation capture
    (["select", "--con"], (None, ["select", "--con"])),
])
def test_the_config_flag_is_split_off_wherever_it_stands(argv, expected):
    assert split_config_file(argv) == expected


class _NoDb:
    """Stands in for app.db.session.make_engine: any use is a test failure."""

    def __init__(self):
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        raise AssertionError("the database must not be opened")


@pytest.fixture
def cli(tmp_path, monkeypatch, capsys):
    """Runs main() with argv and returns (exit code, stdout); EVAL_ROOT is tmp_path with an empty manifest."""
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1), tmp_path / "manifest.yaml")
    no_db = _NoDb()
    monkeypatch.setattr("app.db.session.make_engine", no_db)

    def go(argv, **settings):
        monkeypatch.setattr(sys, "argv", ["eval", *argv])
        monkeypatch.setattr("app.config.get_settings", lambda: Settings(_env_file=None, **settings))
        with pytest.raises(SystemExit) as stop:
            main()
        return stop.value.code, capsys.readouterr().out

    go.no_db = no_db
    return go


def test_main_help_and_bad_arguments_never_touch_the_db(cli):
    exits = {tuple(argv): cli(argv)[0] for argv in (["--help"], ["run", "--help"], ["bogus"],
                                                     ["run", "--repeats", "many"], [])}
    assert exits == {("--help",): 0, ("run", "--help"): 0, ("bogus",): 2, ("run", "--repeats", "many"): 2, (): 2}
    assert cli.no_db.calls == 0


def test_main_report_needs_no_db_and_no_models(cli, tmp_path):
    from tests.unit.test_eval_cli import _write_rec

    pv = Settings(_env_file=None).prompt_version
    _write_rec(tmp_path, pv, "t1", "CD1", 1)
    code, out = cli(["report", "--run-id", "t1"])
    assert code == 0 and (tmp_path / "reports" / f"{pv}-t1.md").is_file()
    assert cli.no_db.calls == 0 and "llm config:" not in out


def test_main_with_a_config_file_never_opens_the_db_and_prints_the_label(cli, tmp_path):
    path = write_yaml(tmp_path / "llm.yaml", MINIMAL)
    for argv in (["--config-file", str(path), "run", "--run-id", "a"],
                 ["run", "--run-id", "b", f"--config-file={path}"]):
        code, out = cli(argv)
        assert code == 0 and f"llm config: file:{path}" in out
    assert cli.no_db.calls == 0


def test_main_without_a_flag_and_an_unreadable_db_exits_2_naming_the_flag(cli, monkeypatch, tmp_path):
    monkeypatch.setattr("app.db.session.make_engine", lambda url: create_async_engine(url))
    code, out = cli(["run", "--run-id", "a"], database_url=f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}")
    assert code == 2 and "--config-file" in out and "no such table" in out
    assert "llm config:" not in out


def test_main_with_a_bad_config_file_exits_2_not_a_traceback(cli, tmp_path):
    code, out = cli(["run", "--run-id", "a", "--config-file", str(tmp_path / "missing.yaml")])
    assert code == 2 and "missing.yaml" in out
