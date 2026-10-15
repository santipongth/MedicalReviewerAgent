"""Local stand-in for an OpenAI-compatible POST {base}/chat/completions (OpenRouter, Ollama, ...).

The openai SDK 3.x does not use httpx, so respx cannot intercept it."""
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


def completion_body(content: str | None = None, *, refusal: str | None = None, finish_reason: str = "stop",
                    tool_name: str | None = None, tool_args: str | None = None, cost: float | None = 0.000294,
                    prompt_tokens: int = 1000, completion_tokens: int = 200,
                    model: str = "deepseek/deepseek-v4-pro") -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": content, "refusal": refusal}
    if tool_name:
        message["content"] = None
        message["tool_calls"] = [{"id": "call_1", "type": "function",
                                  "function": {"name": tool_name, "arguments": tool_args or "{}"}}]
    usage: dict[str, Any] = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                             "total_tokens": prompt_tokens + completion_tokens}
    if cost is not None:
        usage["cost"] = cost
    return {"id": "gen-test", "object": "chat.completion", "created": 1, "model": model,
            "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}], "usage": usage}


class FakeOpenAIServer:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []
        self.replies: list[dict[str, Any] | tuple[int, dict[str, Any]] | tuple[int, dict[str, Any], dict[str, str]]] = []
        self.elsewhere: list[dict[str, Any]] = []  # hits on /elsewhere/chat/completions (a redirect target)

        async def completions(request: Request) -> JSONResponse:
            self.headers.append(dict(request.headers))
            self.requests.append(await request.json())
            reply = self.replies.pop(0)
            if isinstance(reply, tuple):
                headers = reply[2] if len(reply) > 2 else None
                return JSONResponse(reply[1], status_code=reply[0], headers=headers)
            return JSONResponse(reply)

        async def elsewhere(request: Request) -> JSONResponse:
            self.elsewhere.append(await request.json())
            return JSONResponse(completion_body("{}"))

        app = Starlette(routes=[Route("/api/v1/chat/completions", completions, methods=["POST"]),
                                Route("/elsewhere/chat/completions", elsewhere, methods=["POST"])])
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.url = f"http://127.0.0.1:{self.port}/api/v1"
        self._server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning"))
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    def start(self) -> FakeOpenAIServer:
        self._thread.start()
        deadline = time.time() + 10
        while not self._server.started:
            if time.time() > deadline:
                raise RuntimeError("fake openai server did not start")
            time.sleep(0.02)
        return self

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=5)
