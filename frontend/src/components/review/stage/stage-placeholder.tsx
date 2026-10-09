import { createContext, useContext } from "react";

/**
 * ViewBox sizes of the first stage render (no queries, batches or slots yet), precomputed so this eagerly loaded
 * placeholder does not pull agent-layout into the page chunk. Pinned against layoutFor by stage-placeholder.test.tsx.
 */
export const PLACEHOLDER_SIZE = {
  wide: { width: 960, height: 226 },
  narrow: { width: 360, height: 734 }, // Thai: localize is in the lane
  narrowNoLocalize: { width: 360, height: 670 },
} as const;

/** Whether the lane will show localize (scene.expectLocalize). Unknown -> Thai, the common case. */
export const StageLocalize = createContext(true);

/**
 * Reserves the stage's box while its chunk loads; breakpoints follow useWide() (lg = 1024px) via CSS, so no flip on
 * desktop. Wide spans the panel like the stage; narrow is capped at 480px wide, like the stage (a tablet would
 * otherwise scale the vertical lane ~2.5x). Both are centred.
 */
export function StagePlaceholder() {
  const localize = useContext(StageLocalize);
  const w = PLACEHOLDER_SIZE.wide;
  const n = localize ? PLACEHOLDER_SIZE.narrow : PLACEHOLDER_SIZE.narrowNoLocalize;
  const box = "mx-auto w-full rounded-sm border border-rule bg-surface";
  return (
    <>
      <div aria-hidden data-placeholder="narrow" className={`${box} max-w-[480px] lg:hidden`} style={{ aspectRatio: `${n.width} / ${n.height}` }} />
      <div aria-hidden data-placeholder="wide" className={`${box} hidden lg:block`} style={{ aspectRatio: `${w.width} / ${w.height}` }} />
    </>
  );
}
