"use client";
// The reader pool: one InstancedMesh of up to 30 spheres, one per paper slot, coloured by slot state (waiting `rule`,
// reading `primary`, ok `ok`, failed `err`, uncertain `warn`). Each state also has its own silhouette (SLOT_SCALE), so
// state is not colour-only; the ✓/✕/flag counts live in the pool summary label (Labels3D).
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, useState } from "react";
import { Color, Object3D, type InstancedMesh } from "three";
import { MAX_SLOTS, type ReaderSlot } from "@/lib/agent-scene";
import type { Layout3D } from "@/lib/agent-layout-3d";
import { SLOT_COLOR, SLOT_SCALE } from "./model-3d";
import type { Tokens3D } from "./tokens-3d";

const R = 0.12;

export function ReaderPool3D({ slots, layout, tokens }: { slots: ReaderSlot[]; layout: Layout3D; tokens: Tokens3D }) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const [tmp] = useState(() => ({ obj: new Object3D(), color: new Color() }));

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    // instanceColor must exist before the first draw (the shader is compiled with or without instance colours)
    if (!m.instanceColor) for (let i = 0; i < MAX_SLOTS; i++) m.setColorAt(i, tmp.color.set(tokens.rule));
    const n = Math.min(slots.length, layout.slots.length, MAX_SLOTS);
    for (let i = 0; i < n; i++) {
      const p = layout.slots[i];
      tmp.obj.position.set(p[0], p[1], p[2]);
      tmp.obj.scale.set(...SLOT_SCALE[slots[i].state]);
      tmp.obj.updateMatrix();
      m.setMatrixAt(i, tmp.obj.matrix);
      m.setColorAt(i, tmp.color.set(tokens[SLOT_COLOR[slots[i].state]]));
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [slots, layout, tokens, tmp, invalidate]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_SLOTS]} frustumCulled={false}>
      <sphereGeometry args={[R, 16, 12]} />
      <meshStandardMaterial roughness={1} metalness={0} />
    </instancedMesh>
  );
}
