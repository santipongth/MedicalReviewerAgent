import { layoutFor, type LayoutKind } from "@/lib/agent-layout";

const OPTS = { showLocalize: true, showExternal: false, slots: 0, batches: 0, queries: 0 }; // what the first render lays out

/** Viewbox size the stage will take first, per breakpoint (the placeholder reserves exactly this). */
export function placeholderSize(kind: LayoutKind): { width: number; height: number } {
  const { width, height } = layoutFor(kind, OPTS);
  return { width, height };
}

/** Reserves the stage's box while its chunk loads; breakpoints follow useWide() (md = 768px) via CSS, so no flip on desktop. */
export function StagePlaceholder() {
  const w = placeholderSize("wide");
  const n = placeholderSize("narrow");
  const box = "w-full max-w-[960px] rounded-sm border border-rule bg-surface";
  return (
    <>
      <div aria-hidden data-placeholder="narrow" className={`${box} md:hidden`} style={{ aspectRatio: `${n.width} / ${n.height}` }} />
      <div aria-hidden data-placeholder="wide" className={`${box} hidden md:block`} style={{ aspectRatio: `${w.width} / ${w.height}` }} />
    </>
  );
}
