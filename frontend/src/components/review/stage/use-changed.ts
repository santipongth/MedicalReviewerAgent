"use client";
import { useState } from "react";

/**
 * True once `value` has differed from its value at mount. Entry motion (edge draw-in, slot pop) runs only for changes
 * seen live: a stage mounted on a finished or replayed run shows its final state at once (DESIGN.md: bursts and
 * replays collapse to the final state). Uses React's "adjust state while rendering" pattern, so no ref is read in render.
 */
export function useChangedSinceMount<T>(value: T): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && !Object.is(value, first)) setChanged(true);
  return changed || !Object.is(value, first);
}
