import httpx
import respx

from app.services.turnstile import SITEVERIFY

PAYLOAD = {"topic": "colchicine after myocardial infarction", "language": "en"}


def secret_on(app):
    app.state.deps.service.settings.turnstile_secret = "s3cret"
    app.state.deps.service.settings.turnstile_site_key = "site-key"


async def test_without_a_secret_nothing_is_checked(client):
    assert (await client.post("/api/v1/reviews", json=PAYLOAD)).status_code == 202


@respx.mock
async def test_anonymous_web_submission_needs_a_valid_token(client, app):
    secret_on(app)
    route = respx.post(SITEVERIFY).mock(side_effect=lambda req: httpx.Response(
        200, json={"success": b"good-token" in req.content}))
    missing = await client.post("/api/v1/reviews", json=PAYLOAD)
    assert missing.status_code == 403 and "verification" in missing.json()["detail"]
    bad = await client.post("/api/v1/reviews", json=PAYLOAD, headers={"cf-turnstile-response": "bad"})
    assert bad.status_code == 403
    ok = await client.post("/api/v1/reviews", json=PAYLOAD, headers={"cf-turnstile-response": "good-token"})
    assert ok.status_code == 202 and route.call_count == 2  # the missing token never reached Cloudflare
    cached = await client.post("/api/v1/reviews", json=PAYLOAD)  # cache hits stay free: no token needed
    assert cached.status_code == 202 and cached.json()["cached"] is True
    assert (await client.get("/api/v1/status")).json()["turnstile_site_key"] == "site-key"


@respx.mock
async def test_cloudflare_outage_is_a_clear_503(client, app):
    secret_on(app)
    respx.post(SITEVERIFY).mock(side_effect=httpx.ConnectError("down"))
    r = await client.post("/api/v1/reviews", json=PAYLOAD, headers={"cf-turnstile-response": "t"})
    assert r.status_code == 503 and r.json()["reason"] == "verification_unavailable" and "retry-after" in r.headers


async def test_api_keys_and_mcp_never_need_a_token(client, app, session_factory):
    from app.services.api_keys import mint_key
    secret_on(app)
    async with session_factory() as s, s.begin():
        raw, _ = await mint_key(s, "lab")
    r = await client.post("/api/v1/reviews", json=PAYLOAD, headers={"X-API-Key": raw})
    assert r.status_code == 202


async def test_mcp_start_review_is_never_challenged(app):
    from fastmcp import Client
    secret_on(app)
    async with Client(app.state.mcp) as c:
        res = await c.call_tool("start_review", {"topic": "colchicine after myocardial infarction", "language": "en"})
    assert not res.is_error
