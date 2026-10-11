// Server-only: read env that must not reach the browser. Import from server code only (routes, generateMetadata).
import { usableLimits } from "./limits";
import type { ServiceStatus } from "./types";

/** Server-side address of the API: INTERNAL_API_URL (e.g. http://api:8000 in compose), else an absolute public URL. */
export function serverApiUrl(): string {
  const configured = process.env.INTERNAL_API_URL ?? process.env.PUBLIC_API_URL ?? "";
  return (/^https?:\/\//.test(configured) ? configured : "http://localhost:8000").replace(/\/$/, "");
}

/**
 * GET /api/v1/status from the server, for limits in server-rendered copy (Plan 21). Cached for 60 s in Next's data
 * cache (`next.revalidate`), given up after 3 s; any failure, or limits that are not usable ranges, is null and the
 * caller falls back to number-free wording.
 */
export async function getServerStatus(): Promise<ServiceStatus | null> {
  try {
    const res = await fetch(`${serverApiUrl()}/api/v1/status`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const s = (await res.json()) as ServiceStatus | null;
    return s && usableLimits(s.limits) ? s : null;
  } catch {
    return null;
  }
}
