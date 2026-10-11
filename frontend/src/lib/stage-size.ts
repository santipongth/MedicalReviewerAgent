// Plan 21: one wide stage box per run, the same in every view (team, steps, 3D) and from the loading placeholder to the
// live box. Its height follows only the requested paper count, so it is known before any paper arrives and never
// changes mid-run. No imports: the eager placeholder and the lazy stage chunks all read it.

/** The most papers the stage shows (reader slots, 3D pile tokens); covers /status `limits.max_papers.max`. */
export const STAGE_MAX_PAPERS = 50;
/** The service's default paper count (/status `limits.max_papers.default`), used when a run's count is unknown. */
export const DEFAULT_REQUESTED = 30;
/** The reader pool's grid: 10 columns, 28 units per row (2D steps and team views). */
export const POOL_COLS = 10;
export const POOL_PITCH = 28;
const MIN_ROWS = 3;
/** The wide box for up to 30 papers (three pool rows). */
const BASE = { width: 960, height: 288 } as const;

/**
 * Pool rows a run reserves: max(3, ceil(N / 10)) for its requested count N (the `screened` event's `requested`, else
 * review.options.max_papers, else the service default), clamped to STAGE_MAX_PAPERS. A run never analyses more than N,
 * so its slots always fit these rows.
 */
export function stageRowsFor(requested: number | null | undefined): number {
  const n = typeof requested === "number" && Number.isFinite(requested) && requested >= 1 ? requested : DEFAULT_REQUESTED;
  return Math.max(MIN_ROWS, Math.ceil(Math.min(n, STAGE_MAX_PAPERS) / POOL_COLS));
}

/** The run's wide box (viewBox units): 960/288 up to 30 papers, one pool row (28) taller per 10 papers above that. */
export function stageSizeFor(requested: number | null | undefined): { width: number; height: number } {
  return { width: BASE.width, height: BASE.height + (stageRowsFor(requested) - MIN_ROWS) * POOL_PITCH };
}
