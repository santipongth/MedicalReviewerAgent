import { createContext, useContext } from "react";

/**
 * ViewBox sizes of the first stage render (no queries, batches or slots yet), precomputed so this eagerly loaded
 * placeholder does not pull agent-layout into the page chunk. Pinned against layoutFor by stage-placeholder.test.tsx.
 */
export const PLACEHOLDER_SIZE = {
  wide: { width: 960, height: 288 }, // constant: the external node sits inside it
  narrow: { width: 360, height: 752 }, // Thai: localize is in the lane
  narrowNoLocalize: { width: 360, height: 688 },
} as const;

/** Height (CSS px) of the narrow team list at 390px before the reader pool appears (pinned by the team e2e). */
export const TEAM_NARROW_HEIGHT = 572;

/** Whether the lane will show localize (scene.expectLocalize). Unknown -> Thai, the common case. */
export const StageLocalize = createContext(true);

/** The paper count the user asked for (scene.requested, Plan 21); null when unknown. */
export const StageRequested = createContext<number | null>(null);

const POOL_COLS = 10;
const POOL_PITCH = 28;
const POOL_MIN_ROWS = 3;

/**
 * Rows the team view's wide reader pool reserves before any paper arrives: max(3, ceil(requested / 10)). The count
 * arrives already clamped to the stage's cap (agent-scene `STAGE_MAX_PAPERS`, not imported here).
 */
export function teamPoolRows(requested: number | null | undefined): number {
  return Math.max(POOL_MIN_ROWS, requested ? Math.ceil(requested / POOL_COLS) : 0);
}

/** The team view's wide box: the steps view's 960/288 for three pool rows, one pool pitch taller per extra row. */
export function teamWideSize(rows: number): { width: number; height: number } {
  return { width: PLACEHOLDER_SIZE.wide.width, height: PLACEHOLDER_SIZE.wide.height + Math.max(0, rows - POOL_MIN_ROWS) * POOL_PITCH };
}

/**
 * Reserves the stage's box while its chunk loads; breakpoints follow useWide() (lg = 1024px) via CSS, so no flip on
 * desktop. Wide spans the panel like the stage; narrow is capped at 480px wide, like the stage (a tablet would
 * otherwise scale the vertical lane ~2.5x). Both are centred.
 */
export function StagePlaceholder({ view = "steps" }: { view?: "steps" | "team" }) {
  const localize = useContext(StageLocalize);
  const requested = useContext(StageRequested);
  const w = PLACEHOLDER_SIZE.wide;
  const n = localize ? PLACEHOLDER_SIZE.narrow : PLACEHOLDER_SIZE.narrowNoLocalize;
  const box = "mx-auto w-full rounded-sm border border-rule bg-surface";
  if (view === "team") {
    // the team view: the wide box for the requested count's pool rows; narrow, the five-card list's height before any
    // paper arrives
    const t = teamWideSize(teamPoolRows(requested));
    return (
      <>
        <div aria-hidden data-placeholder="team-narrow" className={`${box} max-w-[560px] lg:hidden`} style={{ height: TEAM_NARROW_HEIGHT }} />
        <div aria-hidden data-placeholder="team-wide" className={`${box} hidden lg:block`} style={{ aspectRatio: `${t.width} / ${t.height}` }} />
      </>
    );
  }
  return (
    <>
      <div aria-hidden data-placeholder="narrow" className={`${box} max-w-[480px] lg:hidden`} style={{ aspectRatio: `${n.width} / ${n.height}` }} />
      <div aria-hidden data-placeholder="wide" className={`${box} hidden lg:block`} style={{ aspectRatio: `${w.width} / ${w.height}` }} />
    </>
  );
}
