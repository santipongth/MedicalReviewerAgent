"""The result cache's pipeline version (Plan 30): one function for the API, which keys a request with the versions it
sees at admission, and the worker, which records the versions it actually ran. A job queued across an admin save runs
on the newer configuration, so the worker re-keys its result when the two differ."""
from __future__ import annotations

from typing import Any

from app.schemas.review import compute_cache_key
from app.services.sources import ActiveSources, cache_part


def pipeline_version(prompt_version: str, *, llm: str | None, glossary: str, sources: ActiveSources, base) -> str:
    """prompt_version, then `+llm<id>` (the LLM config version, "file" while llm.yaml is in use; left out when unknown),
    `+g<version>` once a glossary version exists, and the sources' part (Plan 24's `+thaijo`, Plan 23d's `+src`).
    `base` is the env settings: cache_part compares the sources in force with env's."""
    version = prompt_version
    if llm is not None:
        version = f"{version}+llm{llm}"
    if glossary != "file":
        version = f"{version}+g{glossary}"
    return version + cache_part(sources, base)


def finished_cache_key(cache_key: str, topic: str, language: str, options: dict[str, Any], version: str | None, *,
                       resumed: bool, review_id: str) -> str:
    """The cache key a finished review is stored under. Unchanged when the run's version is unknown or gives the key the
    review was admitted with. Otherwise the key of the version that ran, so the same question asked under that version
    reuses it and one asked under the admission's version does not. A resumed run whose version differs may hold work
    of two configurations, so it gets a key no request computes: it is never reused."""
    if version is None:
        return cache_key
    ran = compute_cache_key(topic, language, options, version)
    if ran == cache_key:
        return cache_key
    if resumed:
        return compute_cache_key(topic, language, options, f"{version}+resumed:{review_id}")
    return ran
