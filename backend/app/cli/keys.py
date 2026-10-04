"""Manage API keys.

    python -m app.cli.keys mint --name "partner lab" [--quota 100] [--admin]
    python -m app.cli.keys list
    python -m app.cli.keys revoke <prefix>
"""
from __future__ import annotations

import argparse
import sys

from app.services.api_keys import list_keys, mint_key, revoke_key


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.cli.keys")
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mint", help="create a key (printed once)")
    m.add_argument("--name", required=True)
    m.add_argument("--quota", type=int, default=100, help="reviews per 24 hours")
    m.add_argument("--admin", action="store_true", help="may call admin endpoints")
    sub.add_parser("list", help="list keys (prefix only)")
    r = sub.add_parser("revoke", help="revoke by prefix")
    r.add_argument("prefix")
    return p


async def run(argv: list[str], session_factory) -> int:
    args = _parser().parse_args(argv)
    async with session_factory() as session, session.begin():
        if args.cmd == "mint":
            raw, row = await mint_key(session, args.name, daily_quota=args.quota, is_admin=args.admin)
            print(f"API key for {row.name} (store it now, it is not shown again):\n{raw}")
        elif args.cmd == "list":
            for k in await list_keys(session):
                state = "revoked" if k.revoked_at else "active"
                print(f"{k.key_prefix}  {k.name}  quota={k.daily_quota}/day  admin={bool(k.is_admin)}  {state}")
        else:
            n = await revoke_key(session, args.prefix)
            print(f"revoked {n} key(s)")
            return 0 if n else 1
    return 0


def main() -> None:
    from app.compat import run_async
    from app.config import get_settings
    from app.db.session import make_engine, make_session_factory

    engine = make_engine(get_settings().database_url)
    try:
        code = run_async(run(sys.argv[1:], make_session_factory(engine)))
    finally:
        run_async(engine.dispose())
    sys.exit(code)


if __name__ == "__main__":
    main()
