from functools import lru_cache

from pydantic import AliasChoices, Field
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
    contact_email: str = ""

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
    max_topic_length: int = 300
    result_cache_ttl_seconds: int = 86400
    event_stream_ttl_seconds: int = 86400
    sse_ping_seconds: int = 15
    max_concurrent_reviews_per_worker: int = 2
    stale_running_minutes: int = 30

    graph_mode: str = "real"  # "stub" = Plan 1 placeholder graph (plumbing tests without Claude)
    prompt_version: str = "2026-10-04.1"

    searxng_engines: str = "pubmed,arxiv,semantic scholar,openalex,crossref"
    searxng_pages: int = 1
    searxng_timeout_seconds: float = 8.0
    europepmc_url: str = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    unpaywall_url: str = "https://api.unpaywall.org/v2"
    http_timeout_seconds: float = 30.0
    max_fulltext_chars: int = 60_000
    fulltext_timeout_seconds: float = 20.0  # per paper; beyond this the abstract is used
    screen_batch_size: int = 10

    crawl_enabled: bool = True
    crawl4ai_url: str = "http://crawl4ai:11235"
    # Reads CRAWL4AI_API_TOKEN (same variable the crawl4ai container uses); empty -> crawling disabled.
    crawl4ai_token: str = Field(
        "", validation_alias=AliasChoices("crawl4ai_token", "CRAWL4AI_TOKEN", "CRAWL4AI_API_TOKEN")
    )
    crawl_stealth: bool = True
    crawl_concurrency: int = 4
    crawl_timeout_seconds: float = 120.0
    crawl_domain_interval: float = 2.0
    crawl_cooldown_minutes: int = 15
    fulltext_cache_days: int = 30
    max_crawl_urls_per_paper: int = 3

    # LLM models, presets and tuning live in config/llm.yaml; these hold only the path and keys.
    llm_config_path: str = "config/llm.yaml"
    llm_preset: str | None = None  # overrides active_preset in llm.yaml
    openrouter_api_key: str = ""
    openai_compatible_api_key: str = ""

    @property
    def checkpoint_conninfo(self) -> str:
        return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
