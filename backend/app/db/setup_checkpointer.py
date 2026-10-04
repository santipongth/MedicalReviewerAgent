"""One-off: create LangGraph checkpoint tables. Run after `alembic upgrade head`."""
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.compat import run_async
from app.config import get_settings


async def main() -> None:
    async with AsyncPostgresSaver.from_conn_string(get_settings().checkpoint_conninfo) as saver:
        await saver.setup()
    print("checkpoint tables ready")


if __name__ == "__main__":
    run_async(main())
