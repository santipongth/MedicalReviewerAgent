# SearXNG engine modules (AGPL-3.0-or-later)

These Python modules are search engines for the project's SearXNG container (the fork image
`mra/searxng-ldr-academic`). They are **licensed under AGPL-3.0-or-later** (full text in [LICENSE](LICENSE)),
because they are derived from or modelled on SearXNG's own engines (https://github.com/searxng/searxng,
AGPL-3.0-or-later). Each file says which:

| file | engine `name` | origin |
|---|---|---|
| `mra_pubmed.py` | `pubmed` | derived from SearXNG `pubmed.py` |
| `mra_openalex.py` | `openalex` | derived from SearXNG `openalex.py` |
| `europepmc.py` | `europe pmc` | ported from SearXNG `europepmc.py` |
| `mra_semantic_scholar.py` | `semantic scholar` | wraps the fork's `semantic_scholar.py` |
| `doaj.py`, `plos.py`, `mra_openaire.py` | `doaj`, `plos`, `openaire` | written for this project in SearXNG's engine structure |
| `mra_markup.py` | (helper, not an engine) | shared tag stripping, mirrors `backend/app/services/text.py` |

They run only inside the SearXNG container; nothing else in this repository imports them (the backend's unit
tests load them by path to test parsing). The AGPL covers these files only; the rest of the repository is
under its own licence. Anyone running this modified SearXNG for others must offer them this source.

## How they are mounted
`docker-compose.yml` bind-mounts each file read-only into `/usr/local/searxng/searx/engines/` (one volume line
per file: mounting the directory would hide the fork's own engines). `infra/searxng/settings.yml` declares
them; an entry whose `name` exists in the fork's settings is merged into it, so `pubmed` keeps its name and
only swaps `engine:` and `timeout:`. Optional API keys reach the modules through the searxng service's
`environment:` (`NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY`), read with `os.environ.get`.

## Adding an engine
1. Create `<module>.py` here with the `# SPDX-License-Identifier: AGPL-3.0-or-later` header, an attribution
   docstring, `request(query, params)` / `response(resp)` and pure parsing helpers (results are
   `res.types.Paper` with title, content = abstract, url, doi, publishedDate, authors, journal). Use
   `from searx.engines.mra_markup import clean_markup` for markup.
2. Add its read-only volume line in `docker-compose.yml` and its entry (`name`, `engine`, `timeout` below
   the backend's `searxng_timeout_seconds`) in `infra/searxng/settings.yml`.
3. Record a trimmed live response under `backend/tests/fixtures/searxng_engines/` and add parsing tests to
   `backend/tests/unit/test_searxng_engines.py`.
4. `docker compose up -d searxng`, then probe `http://searxng:8080/search?q=...&format=json&engines=<name>`.
