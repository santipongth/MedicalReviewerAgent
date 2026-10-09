"use client";
// The floating thought label: the same `thoughtFor(scene).short` text as the thought card (derived only from received
// events), as DOM text (drei Html) above the current agent's node, with a thin `rule` leader line down to the node.
// Not rendered at all when there is no thought or no current agent, so a `[data-label3d]` is never empty.
// aria-hidden and pointer-events:none like every 3D label; the thought card stays the accessible source.
import { Html, Line } from "@react-three/drei";
import { useMemo } from "react";
import type { Scene } from "@/lib/agent-scene";
import type { Layout3D } from "@/lib/agent-layout-3d";
import { thoughtFor } from "@/lib/agent-thought";
import { thoughtAnchor, thoughtLeader } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const Z_RANGE: [number, number] = [10, 0]; // same stacking range as Labels3D (below page chrome)

export function ThoughtLabel3D({ scene, layout, tokens }: { scene: Scene; layout: Layout3D; tokens: Tokens3D }) {
  const thought = useMemo(() => thoughtFor(scene), [scene]);
  const agent = thought?.agent ?? null;
  const at = useMemo(() => thoughtAnchor(layout, agent), [layout, agent]);
  const leader = useMemo(() => thoughtLeader(layout, agent), [layout, agent]);
  const text = thought?.short.trim() ?? "";
  if (!thought || !agent || !at || text === "") return null;
  return (
    <>
      {leader && <Line points={leader} color={tokens.rule} lineWidth={1} />}
      <Html position={at} center pointerEvents="none" zIndexRange={Z_RANGE}>
        <div
          aria-hidden="true" data-label3d="thought"
          className="pointer-events-none w-max max-w-[240px] whitespace-normal rounded-sm border border-rule bg-surface px-2 py-1 text-center font-display text-xs leading-tight tabular-nums text-ink"
        >
          {text}
        </div>
      </Html>
    </>
  );
}
