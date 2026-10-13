/** Worker reports and the page's follow-up after a write, shared by the models page (Plan 23b) and the settings and
 * glossary pages (Plan 23c). */

/** Workers re-report every 30 s, so `loaded_at` is "last seen": a worker silent for longer than this has probably stopped. */
export const STALE_AFTER_MS = 120_000;

export function isStale(loadedAt: string, now: number): boolean {
  const seen = Date.parse(loadedAt);
  return Number.isFinite(seen) && now - seen > STALE_AFTER_MS; // a time that does not parse is not stale
}

/** After a save, restore or reset the workers pick the version up within 30 s (their poll), so a page re-reads this
 * often while one lags, for at most POLL_WINDOW_MS. For SETTLING_MS after the page's own change, a lagging worker is
 * "changing" and not yet a warning. */
export const POLL_MS = 10_000;
export const POLL_WINDOW_MS = 120_000;
export const SETTLING_MS = 60_000;
