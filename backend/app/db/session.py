from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(url: str, *, pool_size: int = 10, max_overflow: int = 20) -> AsyncEngine:
    if url.startswith("sqlite"):  # tests: SQLite has no connection pool to size
        return create_async_engine(url, pool_pre_ping=True)
    return create_async_engine(url, pool_pre_ping=True, pool_size=pool_size, max_overflow=max_overflow)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
