import { createContext, useContext } from "react";
import { stageSizeFor } from "@/lib/stage-size";

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



/**
 * Reserves the stage's box while its chunk loads; breakpoints follow useWide() (lg = 1024px) via CSS, so no flip on
 * desktop. Wide spans the panel like the stage; narrow is capped at 480px wide, like the stage (a tablet would
 * otherwise scale the vertical lane ~2.5x). Both are centred.
 */
export function StagePlaceholder({ view = "steps" }: { view?: "steps" | "team" | "3d" }) {
  const localize = useContext(StageLocalize);
  const requested = useContext(StageRequested);
  const w = stageSizeFor(requested); // the run's wide box, the same in every view (Plan 21)
  const n = localize ? PLACEHOLDER_SIZE.narrow : PLACEHOLDER_SIZE.narrowNoLocalize;
  const box = "mx-auto w-full rounded-sm border border-rule bg-surface";
  if (view === "team") {
    // the team view: the run's wide box; narrow, the five-card list's height before any paper arrives
    return (
      <>
        <div aria-hidden data-placeholder="team-narrow" className={`${box} max-w-[560px] lg:hidden`} style={{ height: TEAM_NARROW_HEIGHT }} />
        <div aria-hidden data-placeholder="team-wide" className={`${box} hidden lg:block`} style={{ aspectRatio: `${w.width} / ${w.height}` }} />
      </>
    );
  }
  if (view === "3d") {
    // the loaded 3D wrapper's box: borderless, the run's wide box
    return <div aria-hidden data-placeholder="3d" className="mx-auto w-full rounded-sm bg-surface" style={{ aspectRatio: `${w.width} / ${w.height}` }} />;
  }
  return (
    <>
      <div aria-hidden data-placeholder="narrow" className={`${box} max-w-[480px] lg:hidden`} style={{ aspectRatio: `${n.width} / ${n.height}` }} />
      <div aria-hidden data-placeholder="wide" className={`${box} hidden lg:block`} style={{ aspectRatio: `${w.width} / ${w.height}` }} />
    </>
  );
}
