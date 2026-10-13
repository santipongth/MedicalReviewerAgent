import type { LoadedWorker, Page, RuntimeVersion, SourceRow, SourcesState } from "@/lib/admin-types";

/** Plan 23d: the admin sources page's fixtures. Version 1 turned OpenAIRE off; ThaiJO follows env (on). */
export const SOURCES_WORKER: LoadedWorker = { worker: "worker-1:7", version: "3", preset: "cheap",
  loaded_at: "2026-10-13T10:00:00Z", error: null, settings: "env", glossary: "file", sources: "1", runtime_error: null };

const row = (id: string, label: string, enabled = true, kind: SourceRow["kind"] = "searxng"): SourceRow =>
  ({ id, label, kind, env: true, enabled, overridden: !enabled });

export const SOURCES: SourcesState = {
  source: "db", version: 1, extras: [], error: null, loaded: [SOURCES_WORKER],
  sources: [
    row("pubmed", "PubMed"), row("europepmc", "Europe PMC"), row("openalex", "OpenAlex"),
    row("semantic_scholar", "Semantic Scholar"), row("crossref", "Crossref"), row("arxiv", "arXiv"), row("doaj", "DOAJ"),
    row("openaire", "OpenAIRE", false), row("thaijo", "ThaiJO", true, "direct"),
  ],
};

export const SOURCES_VERSIONS: Page<RuntimeVersion> = {
  items: [{ version: 1, kind: "sources", created_at: "2026-10-13T10:00:00Z", created_by: "owner", note: "openaire is slow",
    source: "edit", restored_from: null, changes: { openaire: "env → off" } }],
  next: null,
};

export const NO_SEARXNG = "at least one source searched through SearXNG must stay on: ThaiJO alone gives at most 1/8 of the "
  + "pool, and paper search uses SearXNG only";
export const WARN_BIOMEDICAL = "PubMed and Europe PMC are both off: the two biomedical indexes are off; reviews will find far "
  + "fewer clinical studies";
