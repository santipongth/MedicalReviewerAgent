// Pure helpers for the 2D team view's hand-off motion. No React, no DOM.
import type { PulseKind } from "./agent-scene";
import type { Handoff, MemberId } from "./agent-team";
import type { Pt } from "./agent-layout";

export interface HandoffDot { from: MemberId; to: MemberId; kind: PulseKind; delayMs: number }
export type Look = "l" | "r" | "u" | "d";

/**
 * One dot per item of each hand-off (n of them), `i*120ms` apart inside a hand-off and hand-offs 60ms apart: the same
 * rhythm as the steps view (planDots). At most `maxDots`, the oldest dropped.
 */
export function handoffDots(hs: Handoff[], maxDots: number): HandoffDot[] {
  const flat: { h: Handoff; k: number; i: number }[] = [];
  hs.forEach((h, k) => {
    for (let i = 0; i < Math.max(1, h.n); i++) flat.push({ h, k, i });
  });
  const kept = flat.length > maxDots ? flat.slice(flat.length - Math.max(maxDots, 0)) : flat;
  if (kept.length === 0) return [];
  const k0 = kept[0].k;
  const i0 = kept[0].i;
  return kept
    .map(({ h, k, i }) => ({ from: h.from, to: h.to, kind: h.kind, delayMs: (k - k0) * 60 + (k === k0 ? i - i0 : i) * 120 }))
    .sort((a, b) => a.delayMs - b.delayMs);
}

/** Which way a sender glances at its receiver: the dominant axis from `a` to `b`. */
export function lookToward(a: Pt, b: Pt): Look {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "r" : "l";
  return dy >= 0 ? "d" : "u";
}
