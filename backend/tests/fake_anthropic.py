"""Minimal local stand-in for POST /v1/messages (the Anthropic SDK 1.x does not use httpx,
so respx cannot intercept it)."""
from __future__ import annotations

import socket
import threading
import time
from typing import Any

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


def message_body(text: str, *, stop_reason: str = "end_turn", model: str = "claude-sonnet-5-5",
                 input_tokens: int = 1000, output_tokens: int = 200) -> dict[str, Any]:
    return {
        "id": "msg_test", "type": "message", "role": "assistant", "model": model,
        "content": [{"type": "text", "text": text}], "stop_reason": stop_reason,
        "stop_sequence": None, "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }


class FakeAnthropicServer:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.replies: list[dict[str, Any]] = []

        async def messages(request: Request) -> JSONResponse:
            self.requests.append(await request.json())
            return JSONResponse(self.replies.pop(0))

        app = Starlette(routes=[Route("/v1/messages", messages, methods=["POST"])])
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.url = f"http://127.0.0.1:{self.port}"
        self._server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning")
        )
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    def start(self) -> FakeAnthropicServer:
        self._thread.start()
        deadline = time.time() + 10
        while not self._server.started:
            if time.time() > deadline:
                raise RuntimeError("fake anthropic server did not start")
            time.sleep(0.02)
        return self

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=5)
