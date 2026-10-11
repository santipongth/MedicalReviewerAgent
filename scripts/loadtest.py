"""Concurrent-user load test for the review pipeline (REST + SSE), meant for GRAPH_MODE=stub so it costs nothing.

Each virtual user submits a review with a unique topic, follows its event stream to the end and fetches the
result, like the web app does. Reports latency percentiles and every non-2xx answer by status/reason.

    uv run --with httpx python scripts/loadtest.py --base http://localhost:8088 --users 50 --api-key $MRA_LOAD_KEY --max-papers 50

Without an API key the anonymous rate limit (per IP) stops the test after a few reviews.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field

import httpx


@dataclass
class Result:
    create_status: int = 0
    create_reason: str | None = None
    create_s: float = 0.0
    first_event_s: float | None = None
    done_s: float | None = None
    final_status: str | None = None
    events: int = 0
    errors: list[str] = field(default_factory=list)


async def follow(client: httpx.AsyncClient, base: str, rid: str, started: float, r: Result, timeout: float) -> None:
    async with client.stream("GET", f"{base}/api/v1/reviews/{rid}/events", timeout=timeout) as resp:
        if resp.status_code != 200:
            r.errors.append(f"sse {resp.status_code}")
            return
        event = None
        async for line in resp.aiter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
                r.events += 1
                if r.first_event_s is None:
                    r.first_event_s = time.perf_counter() - started
            if event in ("done", "error", "rejected", "cancelled") and line.startswith("data:"):
                r.done_s = time.perf_counter() - started
                return


async def user(client: httpx.AsyncClient, base: str, run: str, i: int, headers: dict, timeout: float,
               max_papers: int | None) -> Result:
    r = Result()
    started = time.perf_counter()
    body: dict = {"topic": f"load test {run} user {i} statins and dementia", "language": "en"}
    if max_papers is not None:
        body["options"] = {"max_papers": max_papers}
    try:
        resp = await client.post(f"{base}/api/v1/reviews", json=body, headers=headers, timeout=30)
    except httpx.HTTPError as exc:
        r.errors.append(f"create {type(exc).__name__}")
        return r
    r.create_s = time.perf_counter() - started
    r.create_status = resp.status_code
    if resp.status_code != 202:
        try:
            r.create_reason = resp.json().get("reason") or resp.json().get("detail")
        except json.JSONDecodeError:
            r.create_reason = resp.text[:80]
        return r
    rid = resp.json()["review_id"]
    try:
        await follow(client, base, rid, started, r, timeout)
        final = await client.get(f"{base}/api/v1/reviews/{rid}", timeout=30)
        r.final_status = final.json().get("status")
    except httpx.HTTPError as exc:
        r.errors.append(f"follow {type(exc).__name__}")
    return r


def pct(values: list[float], p: float) -> str:
    if not values:
        return "-"
    values = sorted(values)
    return f"{values[min(len(values) - 1, round(p / 100 * (len(values) - 1)))]:.2f}s"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8088")
    ap.add_argument("--users", type=int, default=20)
    ap.add_argument("--api-key", default="")
    ap.add_argument("--timeout", type=float, default=300)
    ap.add_argument("--max-papers", type=int, default=None, help="options.max_papers (default: the API's)")
    args = ap.parse_args()
    headers = {"X-API-Key": args.api_key} if args.api_key else {}
    run = uuid.uuid4().hex[:6]
    limits = httpx.Limits(max_connections=args.users * 3, max_keepalive_connections=args.users)
    async with httpx.AsyncClient(limits=limits) as client:
        t0 = time.perf_counter()
        results = await asyncio.gather(*(user(client, args.base, run, i, headers, args.timeout, args.max_papers)
                                         for i in range(args.users)))
        wall = time.perf_counter() - t0
    accepted = [r for r in results if r.create_status == 202]
    codes = Counter(f"{r.create_status} {r.create_reason or ''}".strip() for r in results)
    finals = Counter(r.final_status for r in accepted)
    print(f"users={args.users} wall={wall:.1f}s accepted={len(accepted)} create_codes={dict(codes)}")
    print(f"create p50={pct([r.create_s for r in results], 50)} p95={pct([r.create_s for r in results], 95)}")
    print(f"first event p50={pct([r.first_event_s for r in accepted if r.first_event_s], 50)} "
          f"p95={pct([r.first_event_s for r in accepted if r.first_event_s], 95)}")
    done = [r.done_s for r in accepted if r.done_s]
    print(f"done p50={pct(done, 50)} p95={pct(done, 95)} max={pct(done, 100)} "
          f"followed_to_end={len(done)}/{len(accepted)} finals={dict(finals)}")
    events = [r.events for r in accepted if r.done_s]
    if events:
        print(f"sse events per review min={min(events)} median={statistics.median(events):.0f} max={max(events)}")
    errs = Counter(e for r in results for e in r.errors)
    print(f"errors={dict(errs)}" + (f" mean_done={statistics.mean(done):.2f}s" if done else ""))


if __name__ == "__main__":
    asyncio.run(main())
