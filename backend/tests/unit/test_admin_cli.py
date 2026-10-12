import io

from sqlalchemy import select

from app.cli.admin import run as admin_cli
from app.db.models import AdminAudit
from app.services.admin_auth import find_user, verify_password
from app.services.admin_sessions import AdminSessions

PW = "correct horse battery staple"


def prompts(*answers):
    it = iter(answers)
    return lambda prompt: next(it)


def stdin(text: str):
    return io.StringIO(text + "\n")


async def actions(session_factory):
    async with session_factory() as s:
        rows = (await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars()
        return [(r.actor_kind, r.action) for r in rows]


async def test_create_from_prompt_and_from_stdin(session_factory, redis, capsys):
    assert await admin_cli(["create", "--username", "Owner"], session_factory, redis,
                           read_password=prompts(PW, PW)) == 0
    assert await admin_cli(["create", "--username", "second", "--password-stdin"], session_factory, redis,
                           stdin=stdin(PW)) == 0
    async with session_factory() as s:
        assert (await verify_password((await find_user(s, "owner")).password_hash, PW))[0]
        assert (await verify_password((await find_user(s, "second")).password_hash, PW))[0]
    assert await actions(session_factory) == [("cli", "admin.create"), ("cli", "admin.create")]
    out = capsys.readouterr().out
    assert "owner" in out and PW not in out


async def test_create_refuses_mismatch_short_and_duplicate(session_factory, redis, capsys):
    assert await admin_cli(["create", "--username", "owner"], session_factory, redis,
                           read_password=prompts(PW, PW + "x")) == 1
    assert await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin("short")) == 1
    assert await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin(PW)) == 0
    assert await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin(PW)) == 1
    err = capsys.readouterr().err
    assert "do not match" in err and "12-256" in err and "already exists" in err
    assert await actions(session_factory) == [("cli", "admin.create")]  # refused changes leave no audit row


async def test_passwd_and_disable_end_sessions(session_factory, redis, capsys):
    await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis, stdin=stdin(PW))
    async with session_factory() as s:
        uid = (await find_user(s, "owner")).id
    sessions = AdminSessions(redis)
    token = await sessions.create(uid, "owner")
    assert await admin_cli(["passwd", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin("a brand new password")) == 0
    assert await sessions.load(token) is None
    token = await sessions.create(uid, "owner")
    assert await admin_cli(["disable", "owner"], session_factory, redis) == 0
    assert await sessions.load(token) is None
    assert await admin_cli(["enable", "owner"], session_factory, redis) == 0
    assert await admin_cli(["passwd", "nobody", "--password-stdin"], session_factory, redis,
                           stdin=stdin("a brand new password")) == 1
    assert await admin_cli(["list"], session_factory, redis) == 0
    out = capsys.readouterr().out
    assert "owner" in out and "active" in out and "ended 1 session" in out
    assert [a for _, a in await actions(session_factory)] == [
        "admin.create", "admin.passwd", "admin.disable", "admin.enable"]
