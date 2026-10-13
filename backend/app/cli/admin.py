"""Manage admin console accounts (Plan 23a). There is no sign-up page: the first admin is created here.

    python -m app.cli.admin create --username NAME [--password-stdin]
    python -m app.cli.admin passwd NAME [--password-stdin]      # ends every session of NAME
    python -m app.cli.admin disable NAME                        # ends every session of NAME
    python -m app.cli.admin enable NAME
    python -m app.cli.admin list
    python -m app.cli.admin llm-keys-secret                     # print a new LLM_KEYS_SECRET (Plan 23e; no DB)
    python -m app.cli.admin rotate-llm-keys                     # re-encrypt stored provider keys with the first key
"""
from __future__ import annotations

import argparse
import getpass
import sys

from app.services.admin_auth import (
    CLI_ACTOR,
    AdminAuthError,
    create_user,
    find_user,
    list_users,
    set_disabled,
    set_password,
)
from app.services.admin_sessions import AdminSessions
from app.services.audit import record
from app.services.llm_keys import cipher, generate_secret, rotate_keys


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.cli.admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create", help="create an admin (password asked twice, or one line on stdin)")
    c.add_argument("--username", required=True)
    c.add_argument("--password-stdin", action="store_true")
    w = sub.add_parser("passwd", help="set a new password and end the admin's sessions")
    w.add_argument("username")
    w.add_argument("--password-stdin", action="store_true")
    for name, text in (("disable", "disable an admin and end their sessions"), ("enable", "enable an admin")):
        sub.add_parser(name, help=text).add_argument("username")
    sub.add_parser("list", help="list admins")
    sub.add_parser("llm-keys-secret", help="print a new LLM_KEYS_SECRET value (a Fernet key) for .env")
    sub.add_parser("rotate-llm-keys", help="re-encrypt the stored LLM provider keys with the first key of "
                                           "LLM_KEYS_SECRET (after adding a new key in front of the old one)")
    return p


def _read_password(args, read_password, stdin) -> str:
    if args.password_stdin:
        return stdin.readline().rstrip("\r\n")
    first = read_password("Password: ")
    if read_password("Repeat password: ") != first:
        raise AdminAuthError("passwords do not match")
    return first


async def _rotate(session_factory, settings) -> int:
    """Plan 23e: LLM_KEYS_SECRET=new,old → every stored key re-encrypted with `new`, one transaction, audited."""
    fernet = cipher(settings)
    if fernet is None:
        print("error: LLM_KEYS_SECRET is missing or not a list of Fernet keys", file=sys.stderr)
        return 1
    async with session_factory() as session, session.begin():
        rotated, unreadable = await rotate_keys(session, fernet)
        await record(session, CLI_ACTOR, "llm_key.rotate", target_type="llm_key",
                     after={"rotated": rotated, "unreadable": unreadable})
    note = f"; {unreadable} could not be read with any key and were left as they are" if unreadable else ""
    print(f"rotate-llm-keys: {rotated} key(s) re-encrypted{note}")
    return 0


async def run(argv: list[str], session_factory, redis, *, read_password=getpass.getpass, stdin=None,
              settings=None) -> int:
    args = _parser().parse_args(argv)
    if args.cmd == "llm-keys-secret":
        print(generate_secret())
        return 0
    if args.cmd == "rotate-llm-keys":
        from app.config import get_settings

        return await _rotate(session_factory, settings or get_settings())
    if args.cmd == "list":
        async with session_factory() as session:
            for u in await list_users(session):
                last = u.last_login_at.isoformat(timespec="minutes") if u.last_login_at else "never"
                state = "disabled" if u.disabled_at else "active"
                print(f"{u.username}  created={u.created_at:%Y-%m-%d}  last_login={last}  {state}")
        return 0
    try:
        password = _read_password(args, read_password, stdin or sys.stdin) if args.cmd in ("create", "passwd") else None
        async with session_factory() as session, session.begin():
            if args.cmd == "create":
                user = await create_user(session, args.username, password)
                await record(session, CLI_ACTOR, "admin.create", target_type="admin", target_id=user.id,
                             after={"username": user.username})
            elif args.cmd == "passwd":
                user = await set_password(session, args.username, password)
                await record(session, CLI_ACTOR, "admin.passwd", target_type="admin", target_id=user.id)
            else:
                existing = await find_user(session, args.username)
                was_disabled = existing is not None and existing.disabled_at is not None
                disabled = args.cmd == "disable"
                user = await set_disabled(session, args.username, disabled)
                await record(session, CLI_ACTOR, f"admin.{args.cmd}", target_type="admin", target_id=user.id,
                             before={"disabled": was_disabled}, after={"disabled": disabled})
            user_id, username = user.id, user.username
    except AdminAuthError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    note = ""
    if args.cmd in ("passwd", "disable"):
        note = f" (ended {await AdminSessions(redis).end_all(user_id)} session(s))"
    print(f"{args.cmd}: {username}{note}")
    return 0


async def _amain(argv: list[str]) -> int:
    """Everything runs in one event loop: a Redis connection opened in one loop cannot be closed from another."""
    from redis.asyncio import Redis

    from app.config import get_settings
    from app.db.session import make_engine, make_session_factory

    settings = get_settings()
    engine = make_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        return await run(argv, make_session_factory(engine), redis)
    finally:
        await redis.aclose()
        await engine.dispose()


def main() -> None:
    from app.compat import run_async

    sys.exit(run_async(_amain(sys.argv[1:])))


if __name__ == "__main__":
    main()
