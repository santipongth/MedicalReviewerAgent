import pytest

from app.cli.eval import EvalConfigError, eval_llm_config
from app.config import Settings
from app.evals.models import RunRecord
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


async def test_an_unreachable_db_is_an_error_naming_the_flag():
    def broken():
        raise OSError("connection refused")

    with pytest.raises(EvalConfigError, match="--config-file"):
        await eval_llm_config(Settings(_env_file=None), None, broken)


def test_run_records_carry_the_config_label():
    assert RunRecord.model_fields["llm_config"].default == ""


async def test_a_replay_records_the_label_of_the_config_it_ran_with():
    from dataclasses import replace

    from app.evals.run import replay
    from tests.unit.test_eval_graph import fixture_from, freeze_values
    from tests.unit.test_review_graph import make_deps

    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    deps.llms = replace(deps.llms, config_version="db:7")
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s")
    assert rec.status == "done" and rec.llm_config == "db:7"
