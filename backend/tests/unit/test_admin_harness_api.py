from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.db.models import AdminAudit, HarnessRun
from app.evals import models
from app.evals.results import list_reports, list_results, read_report
from tests.admin_helpers import admin_headers
from tests.harness_helpers import make_eval_root, worker_up, write_run

BASE = "/api/v1/admin/harness"


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    make_eval_root(tmp_path)
    return tmp_path


def start_body(**kw):
    return {"max_usd": 1.0, "repeats": 1, "strata": [], "confirm": True, **kw}


async def runs_count(session_factory):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(HarnessRun))


async def test_state_lists_strata_and_says_why_it_cannot_start(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    state = (await client.get(BASE, headers=h)).json()
    assert state["available"] is False and state["reasons"] == ["no_worker"]
    assert state["strata"] == [{"name": "cv", "selected": 3, "with_fixtures": 3},
                               {"name": "renal", "selected": 1, "with_fixtures": 0}]
    assert state["fixtures"] == {"selected": 4, "present": 3} and state["per_review_cap_usd"] == pytest.approx(0.28)
    assert (state["ceiling_usd"], state["default_usd"], state["active"]) == (5.0, 1.0, None)


async def test_without_a_manifest_the_reason_says_so(client, session_factory, tmp_path, monkeypatch, redis):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path / "empty")
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    assert (await client.get(BASE, headers=h)).json()["reasons"] == ["no_manifest"]


async def test_start_enqueues_one_run_and_writes_an_audit_row(client, session_factory, redis, queue, root):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    r = await client.post(f"{BASE}/runs", headers=h, json=start_body(strata=["cv"], max_reviews=2, repeats=2))
    assert r.status_code == 201, r.text
    run = r.json()
    assert (run["status"], run["planned"], run["max_usd"], run["strata"]) == ("queued", 4, 1.0, ["cv"])
    assert run["run_id"].startswith("console-") and queue.harness == [run["id"]]
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body())).status_code == 409
    state = (await client.get(BASE, headers=h)).json()
    assert state["reasons"] == ["active_run"] and state["active"]["id"] == run["id"]
    async with session_factory() as s:
        audits = await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == "harness.start"))
    assert audits == 1


@pytest.mark.parametrize("body", [
    start_body(max_usd=5.01),  # over HARNESS_MAX_USD ($5)
    start_body(max_usd=0.27),  # below one review's own cap ($0.28)
    start_body(confirm=False),
    {"max_usd": 1.0, "repeats": 1},  # no confirm
    start_body(repeats=3),
    start_body(strata=["nope"]),
    start_body(strata=["renal"]),  # no frozen pool in that stratum
    start_body(compare_run="pv/none"),
    start_body(compare_run="../etc"),
    start_body(extra=1),
])
async def test_bad_starts_create_nothing(client, session_factory, redis, queue, root, body):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    r = await client.post(f"{BASE}/runs", headers=h, json=body)
    assert r.status_code == 422, r.text
    assert queue.harness == [] and await runs_count(session_factory) == 0


async def test_start_is_refused_while_unavailable(client, session_factory, queue, root):
    h = await admin_headers(client, session_factory)  # no worker heartbeat
    r = await client.post(f"{BASE}/runs", headers=h, json=start_body())
    assert r.status_code == 503 and r.json()["reasons"] == ["no_worker"]
    assert queue.harness == [] and await runs_count(session_factory) == 0


async def test_cancel_clears_the_active_slot(client, session_factory, redis, root):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    run = (await client.post(f"{BASE}/runs", headers=h, json=start_body())).json()
    cancelled = await client.post(f"{BASE}/runs/{run['id']}/cancel", headers=h)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert (await client.post(f"{BASE}/runs/{run['id']}/cancel", headers=h)).status_code == 409
    assert (await client.post(f"{BASE}/runs/999/cancel", headers=h)).status_code == 404
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body())).status_code == 201
    listed = (await client.get(f"{BASE}/runs", headers=h)).json()["items"]
    assert [r["status"] for r in listed] == ["queued", "cancelled"]
    assert (await client.get(f"{BASE}/runs/{run['id']}", headers=h)).json()["status"] == "cancelled"


async def test_an_enqueue_failure_marks_the_run_error(client, session_factory, redis, queue, root, monkeypatch):
    await worker_up(redis)

    async def broken(run_pk):
        raise ConnectionError("redis down")

    monkeypatch.setattr(queue, "enqueue_harness", broken)
    h = await admin_headers(client, session_factory)
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body())).status_code == 503
    async with session_factory() as s:
        row = (await s.execute(select(HarnessRun))).scalar_one()
    assert (row.status, row.active) == ("error", None)


async def test_reports_are_listed_and_read_and_unsafe_names_refused(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    (root / "reports").mkdir()
    (root / "reports" / "2026-10-11.1-baseline.md").write_text("# Report\n\n<script>x</script>\n", encoding="utf-8")
    (root / "reports" / "big.md").write_bytes(b"x" * 1_000_001)
    (root / "secret.md").write_text("outside", encoding="utf-8")
    items = (await client.get(f"{BASE}/reports", headers=h)).json()["items"]
    assert {i["name"] for i in items} == {"2026-10-11.1-baseline.md", "big.md"}
    baseline = next(i for i in items if i["name"].startswith("2026"))
    assert (baseline["prompt_version"], baseline["run_id"]) == ("2026-10-11.1", "baseline")
    one = (await client.get(f"{BASE}/reports/2026-10-11.1-baseline.md", headers=h)).json()
    assert one["text"].startswith("# Report") and "<script>" in one["text"]  # text; the page never renders HTML
    for name in ("big.md", "..%2Fsecret.md", ".hidden.md", "report.txt", "nope.md"):
        assert (await client.get(f"{BASE}/reports/{name}", headers=h)).status_code == 404, name


def test_a_symlinked_report_is_refused(root):
    (root / "reports").mkdir()
    target = root / "outside.md"
    target.write_text("x", encoding="utf-8")
    try:
        (root / "reports" / "link.md").symlink_to(target)
    except OSError:
        pytest.skip("creating symlinks needs a privilege on this host")
    with pytest.raises(FileNotFoundError):
        read_report("link.md")


async def test_results_and_compare(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    write_run("pv1", "a", [("CD0", 1, 0.05), ("CD0", 2, 0.07)])
    write_run("pv2", "b", [("CD0", 1, 0.10)])
    labels = {i["label"] for i in (await client.get(f"{BASE}/results", headers=h)).json()["items"]}
    assert labels == {"pv1/a", "pv2/b"}
    cmp = (await client.get(f"{BASE}/compare?a=pv1/a&b=pv2/b", headers=h)).json()
    assert cmp["a"] == {"label": "pv1/a", "runs": 2} and cmp["b"] == {"label": "pv2/b", "runs": 1}
    cost = next(r for r in cmp["rows"] if r["metric"] == "Batch cost")
    assert (cost["a"], cost["b"]) == ("$0.12", "$0.10")
    assert (await client.get(f"{BASE}/compare?a=pv1/a&b=pv9/none", headers=h)).status_code == 404
    assert (await client.get(f"{BASE}/compare?a=../x&b=pv2/b", headers=h)).status_code == 422


async def test_harness_routes_need_an_admin_and_stay_out_of_openapi(client, app, root):
    for path in (BASE, f"{BASE}/runs", f"{BASE}/reports", f"{BASE}/results"):
        assert (await client.get(path)).status_code == 401
    assert not any("/admin/harness" in p for p in app.openapi()["paths"])


async def test_unsafe_report_names_are_404_in_every_spelling(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    (root / "reports").mkdir()
    (root / "reports" / "dir.md").mkdir()  # a folder named like a report
    (root / "reports" / "ok.md").write_text("fine", encoding="utf-8")
    (root / "secret.md").write_text("outside", encoding="utf-8")
    names = ("%2e%2e%2fsecret.md", "..%5Csecret.md", "a%2Fb.md", "%00.md", "dir.md", "x" * 200 + ".md", "ok.md%20",
             "ok.MD", "ok.md.txt", "-ok.md")
    for name in names:
        assert (await client.get(f"{BASE}/reports/{name}", headers=h)).status_code == 404, name
    assert (await client.get(f"{BASE}/reports/ok.md", headers=h)).json() == {"name": "ok.md", "text": "fine"}


def test_symlink_checks_hold_on_a_host_without_symlink_privilege(root, monkeypatch):
    """The same refusals as test_a_symlinked_report_is_refused, with is_symlink faked so Windows runs them too."""
    (root / "reports").mkdir()
    (root / "reports" / "link.md").write_text("x", encoding="utf-8")
    (root / "reports" / "ok.md").write_text("y", encoding="utf-8")
    (root / "runs" / "pv1" / "linked").mkdir(parents=True)
    (root / "runs" / "pv1" / "linked" / "CD0.r1.json").write_text("{}", encoding="utf-8")
    real = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: self.name in ("link.md", "linked") or real(self))
    with pytest.raises(FileNotFoundError):
        read_report("link.md")
    assert read_report("ok.md") == "y"
    assert [r["name"] for r in list_reports()] == ["ok.md"]
    assert list_results() == []


async def test_ids_beyond_postgres_integer_are_422_not_500(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    big = 2**31
    assert (await client.get(f"{BASE}/runs/{big}", headers=h)).status_code == 422
    assert (await client.post(f"{BASE}/runs/{big}/cancel", headers=h)).status_code == 422
    assert (await client.get(f"{BASE}/runs?before={big}", headers=h)).status_code == 422
    assert (await client.get(f"{BASE}/runs/0", headers=h)).status_code == 422
    assert (await client.get(f"{BASE}/runs/{big - 1}", headers=h)).status_code == 404
    assert (await client.post(f"{BASE}/runs/{big - 1}/cancel", headers=h)).status_code == 404


async def test_messages_never_echo_submitted_text(client, session_factory, redis, root):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    secret = "ZZ-secret-ZZ"
    write_run("pv2", "b", [("CD0", 1, 0.10)])
    answers = [
        await client.post(f"{BASE}/runs", headers=h, json=start_body(strata=[secret])),
        await client.post(f"{BASE}/runs", headers=h, json=start_body(compare_run=f"{secret}/none")),
        await client.post(f"{BASE}/runs", headers=h, json=start_body(compare_run=secret)),
        await client.post(f"{BASE}/runs", headers=h, json=start_body(max_usd=secret)),
        await client.get(f"{BASE}/reports/{secret}.md", headers=h),
        await client.get(f"{BASE}/compare?a={secret}/x&b=pv2/b", headers=h),
        await client.get(f"{BASE}/compare?a=pv2/b&b={secret}/x", headers=h),
        await client.get(f"{BASE}/compare?a={secret}&b=pv2/b", headers=h),
    ]
    assert [a.status_code for a in answers] == [422, 422, 422, 422, 404, 404, 404, 422]
    assert all(secret not in a.text for a in answers)
    assert (await client.get(f"{BASE}/compare?a={secret}/x&b=pv2/b", headers=h)).json() == {
        "detail": "no run files for run a"}


async def test_start_at_the_ceiling_and_at_one_review_cap_is_accepted(client, session_factory, redis, queue, root):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body(max_usd=0.28))).status_code == 201
    await client.post(f"{BASE}/runs/{queue.harness[0]}/cancel", headers=h)
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body(max_usd=5.0))).status_code == 201
    assert len(queue.harness) == 2
