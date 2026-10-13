from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://mra:mra@localhost:5432/mra"
    redis_url: str = "redis://localhost:6379/0"
    ratelimit_storage_uri: str = "memory://"
    searxng_url: str = "http://localhost:8080"

    anthropic_api_key: str = ""

    trust_proxy: bool = False
    ip_hash_salt: str = "change-me"
    review_rate_limit: str = "5/hour"  # anonymous callers, per IP
    api_key_rate_limit: str = "60/hour"  # callers with an API key, per key
    paper_search_rate_limit: str = "30/minute"  # /papers/* and the MCP search/full-text tools
    mcp_servers_path: str = "config/mcp_servers.json"  # external MCP servers the agent may consult
    mcp_call_timeout_seconds: float = 20.0
    mcp_session_timeout_seconds: float = 30.0  # connect + initialize + tools/list for external MCP servers
    mcp_max_calls: int = 3
    # Host headers the MCP endpoint accepts (DNS-rebinding protection); ["*"] disables the check.
    mcp_allowed_hosts: list[str] = ["localhost", "localhost:*", "127.0.0.1:*", "api:*"]
    public_base_url: str = "http://localhost:8000"  # used in webhook result_url and MCP links
    webhook_allow_http: bool = False  # local testing only; production webhooks must be https
    webhook_timeout_seconds: float = 10.0
    webhook_max_tries: int = 3
    result_cache_ttl_seconds: int = 86400
    event_stream_ttl_seconds: int = 86400
    sse_ping_seconds: int = 15
    sse_max_per_ip: int = 5  # concurrent event streams per client (all API processes share the count)
    db_pool_size: int = 10  # per process; Postgres max_connections must cover processes × (size + overflow)
    db_max_overflow: int = 20
    max_concurrent_reviews_per_worker: int = 4
    # Admission control (shared through Redis by every API process): a bounded queue and a daily cap on reviews and spend.
    max_queued_reviews: int = 50
    max_reviews_per_day: int = 500
    max_usd_per_day: float = 10.0
    # Admin console (Plan 23a): sessions live in Redis; the cookie is Secure when the site is https.
    admin_session_ttl_seconds: int = 28800
    admin_login_max_failures: int = 5  # per username and per IP, within admin_lockout_seconds
    admin_lockout_seconds: int = 900
    # None: Secure when public_base_url is https, or behind the trusted proxy (trust_proxy) on https
    # (X-Forwarded-Proto); the rule is app.api.auth.admin_cookie_secure
    admin_cookie_secure: bool | None = None
    # Per-review LLM spend cap scales with the request (Plan 21): base + per analysed paper + per screened candidate.
    # Steps beyond the cap are skipped; the review finishes with what it has. max_cost_per_review_usd is only the
    # hard ceiling no computed cap may exceed.
    review_cost_base_usd: float = 0.04
    review_cost_per_paper_usd: float = 0.006
    review_cost_per_candidate_usd: float = 0.0005
    max_cost_per_review_usd: float = 0.60
    # Plan 23c: the most a console harness run may be capped at. Env only: the admin console cannot raise it. $5 is the
    # owner's eval budget cap of 2026-10-12.
    harness_max_usd: float = 5.0
    # Cloudflare Turnstile for anonymous web submissions (empty secret = off; API keys and MCP never need it).
    turnstile_secret: str = ""
    turnstile_site_key: str = ""
    stale_running_minutes: int = 30

    graph_mode: str = "real"  # "stub" = Plan 1 placeholder graph (plumbing tests without Claude)
    stub_delay_seconds: float = 0.0  # stub graph only: simulated review duration for load tests
    prompt_version: str = "2026-10-14.1"

    searxng_engines: str = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire"
    searxng_pages: int = 1
    # Meta-analysis needs k >= 3 trials per outcome, so it searches deeper (audit I-9): more SearXNG pages per query
    # plus a most-cited-first Europe PMC search restricted to randomized controlled trials.
    searxng_pages_meta: int = 2
    # Plan 21 top-up: when fewer than candidate_limit candidates keep a usable abstract, enrich reads the next pages
    # of each planner query once, up to this page (meta-analysis, which already reads 2 pages, reads one more).
    searxng_pages_max: int = 2
    trial_search_queries: int = 3  # Europe PMC RCT searches per meta-analysis review (0 = off)
    trial_search_page_size: int = 25
    # Must exceed every requested engine's SearXNG timeout (infra/searxng/settings.yml: pubmed 12 s, crossref 10 s,
    # the rest 8 s): SearXNG waits for the slowest engine. SearXNG took up to 7.4 s under load.
    searxng_timeout_seconds: float = 15.0
    europepmc_url: str = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    openalex_url: str = "https://api.openalex.org"
    openalex_api_key: str = ""  # optional; never logged
    openalex_mailto: str = ""  # optional; never logged
    openalex_timeout_seconds: float = 6.0  # per request, no retries: the citation step has a small budget
    citations_timeout_seconds: float = 20.0  # whole citation step; a failure never fails the review
    # ThaiJO (Plan 24): Thai journals through TCI's undocumented search API, on by default since 2026-10-13 (owner's decision; a letter to TCI is
    # recommended). THAIJO_ENABLED=false turns it off. Env only (not a console setting). The share cap keeps Thai studies an addition to the
    # international evidence: at most thaijo_max_candidates, and at most 1/8 of candidate_limit.
    thaijo_enabled: bool = True
    thaijo_url: str = "https://www.tci-thaijo.org/api/v1"
    thaijo_max_candidates: int = 15
    thaijo_timeout_seconds: float = 12.0  # the whole ThaiJO search (below searxng_timeout_seconds); the OAI step too
    thaijo_request_timeout_seconds: float = 5.0  # per request, no retries (below every other source's timeout)
    thaijo_cache_ttl_seconds: int = 604800  # abstracts and OAI records cached in Redis by article id (7 days)
    http_timeout_seconds: float = 30.0
    screen_batch_size: int = 10

    # LLM models, presets and tuning live in config/llm.yaml; these hold only the path and keys. Plan 23e: provider keys
    # may also be entered in the admin console, stored encrypted with LLM_KEYS_SECRET (one or more comma-separated
    # Fernet keys, newest first; env only, read once per process). Without it the console cannot store keys.
    llm_keys_secret: SecretStr = SecretStr("")
    llm_config_path: str = "config/llm.yaml"
    llm_preset: str | None = None  # overrides active_preset in llm.yaml
    llm_concurrency: int = 16  # max LLM requests in flight per worker process (all roles share it)
    openrouter_api_key: str = ""
    openai_compatible_api_key: str = ""

    @property
    def checkpoint_conninfo(self) -> str:
        return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
