// Small line icons on a 16x16 box centred on (0,0): coordinates in -8..8. Stroke only, drawn by AgentNode.
import type { AgentId } from "@/lib/agent-scene";

export const ICON: Record<AgentId, string> = {
  guard: "M0 -7 L6 -4 V1 C6 4 3 6 0 7 C-3 6 -6 4 -6 1 V-4 Z",
  refine: "M-6 -4 H6 M-6 0 H2 M-6 4 H-1",
  plan: "M-6 -5 H6 M-6 0 H6 M-6 5 H6 M-6 -5 V5",
  search: "M-1 -6 A5 5 0 1 0 -1 4 A5 5 0 1 0 -1 -6 M3 3 L7 7",
  enrich: "M-5 -7 H3 L6 -4 V7 H-5 Z M-2 -1 H3 M-2 3 H3",
  screen: "M-7 -6 H7 L1 0 V6 L-1 7 V0 Z",
  read: "M-7 -5 H-1 V6 H-7 Z M1 -5 H7 V6 H1 Z",
  external: "M-6 -6 H6 V6 H-6 Z M-2 2 L2 -2 M-1 -2 H2 V1",
  synth: "M-6 5 L0 -6 L6 5 Z M-3 1 H3",
  localize: "M-7 -5 H1 M-3 -7 V-5 M-5 3 C-1 1 1 -2 1 -5 M-3 -2 C-2 1 0 3 2 4 M2 7 L5 -1 L8 7 M3 4 H7",
  finish: "M-5 -7 H3 L6 -4 V7 H-5 Z M-2 1 L0 3 L4 -2",
};
export const CHECK = "M-3 0 L-1 2 L3 -2.5";
export const CROSS = "M-3 -3 L3 3 M3 -3 L-3 3";
