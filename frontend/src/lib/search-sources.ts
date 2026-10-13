import type { ServiceStatus } from "./types";

/** The sources searched before Plan 23d, shown when GET /api/v1/status is unreachable or carries no `sources`. */
export const DEFAULT_SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"] as const;

/** The labels of the search sources the service has on (`/status` → `sources`, Plan 23d: the admin console can turn
 * each one off or on), else the default eight. Never hard-code the count in copy: take it from this list. */
export function sourceLabels(sources: ServiceStatus["sources"] | null | undefined): string[] {
  const labels = (Array.isArray(sources) ? sources : [])
    .map((s) => (typeof s?.label === "string" ? s.label.trim() : ""))
    .filter((label) => label !== "");
  return labels.length > 0 ? labels : [...DEFAULT_SOURCES];
}

/** Whether the list from /status has ThaiJO on (it is searched directly, not through SearXNG). */
export function hasThaiJo(sources: ServiceStatus["sources"] | null | undefined): boolean {
  return Array.isArray(sources) && sources.some((s) => s?.id === "thaijo");
}

/** "A, B และ C" */
export function joinThai(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} และ ${items[items.length - 1]}`;
}
