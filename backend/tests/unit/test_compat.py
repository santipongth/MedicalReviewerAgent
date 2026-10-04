import asyncio

from app.compat import run_async, selector_loop_factory


def test_selector_loop_factory_returns_selector_loop():
    loop = selector_loop_factory()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()


def test_run_async_returns_coroutine_result():
    async def coro():
        return 42

    assert run_async(coro()) == 42
