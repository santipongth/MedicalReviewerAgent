from fastapi import Request
from slowapi import Limiter

from app.config import get_settings


def client_ip(request: Request) -> str:
    settings = getattr(request.app.state, "settings", None)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and settings is not None and settings.trust_proxy:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(
    key_func=client_ip, storage_uri=get_settings().ratelimit_storage_uri, headers_enabled=True
)
