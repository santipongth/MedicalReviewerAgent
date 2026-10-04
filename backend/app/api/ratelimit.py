from fastapi import Request
from slowapi import Limiter

from app.config import get_settings


def ip_from(forwarded: str | None, peer: str, trust_proxy: bool) -> str:
    if forwarded and trust_proxy:
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return peer


def client_ip(request: Request) -> str:
    """Rate-limit / ip_hash key.

    Without a trusted proxy the TCP peer is the only trustworthy address. Behind our proxy
    (TRUST_PROXY=true) the proxy *appends* the peer it saw, so the rightmost X-Forwarded-For
    hop is ours; anything to its left was supplied by the client and can be forged.
    """
    settings = getattr(request.app.state, "settings", None)
    peer = request.client.host if request.client else "unknown"
    return ip_from(request.headers.get("x-forwarded-for"), peer, bool(settings and settings.trust_proxy))


limiter = Limiter(
    key_func=client_ip, storage_uri=get_settings().ratelimit_storage_uri, headers_enabled=True
)
