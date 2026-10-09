"use client";
// Optional 3D view of the live agent stage (loaded lazily; three.js never reaches the eager page or the 2D stage).
// Reads only `Scene` and the pure 3D layout: every visual change traces to a scene change, nothing advances on a timer.
// Adapts the node/arc/packet/camera ideas of AI-Agent-observatory by sakshigupta372, used with the author's permission.
// See NOTICE.md at the repo root.
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { PIPELINE, sceneSummary, type Scene } from "@/lib/agent-scene";
import { layout3dFor, type Layout3D } from "@/lib/agent-layout-3d";
import { CameraRig } from "./camera-rig";
import { Edge3D } from "./edge-3d";
import { Labels3D } from "./labels-3d";
import { cameraAgent, CAMERA_BASE, visibleAgents } from "./model-3d";
import { Node3D } from "./node-3d";
import { Packets3D } from "./packets-3d";
import { ReaderPool3D } from "./reader-pool-3d";
import { useTokens3D, type Tokens3D } from "./tokens-3d";

/** Requests one frame whenever the scene or the theme changes (frameloop="demand"). */
function InvalidateOn({ scene, tokens }: { scene: Scene; tokens: Tokens3D }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [scene, tokens, invalidate]);
  return null;
}

function World({ scene, layout, tokens }: { scene: Scene; layout: Layout3D; tokens: Tokens3D }) {
  // drei's Html drops the first label's content when it mounts in the Canvas's very first commit (the first agent's
  // label stayed empty in a real browser), so the labels mount one commit later.
  const [labelsReady, setLabelsReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-commit deferral, see above
  useEffect(() => { setLabelsReady(true); }, []);
  return (
    <>
      <color attach="background" args={[tokens.surface]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 8, 6]} intensity={1.1} />
      <InvalidateOn scene={scene} tokens={tokens} />
      {layout.edges.map((e) => (
        <Edge3D key={e.id} seg={e.seg} state={scene.edges[e.id] ?? "idle"} tokens={tokens} />
      ))}
      {visibleAgents(layout, PIPELINE).map((id) => (
        <Node3D key={id} at={layout.nodes[id]!} status={scene.agents[id]} tokens={tokens} />
      ))}
      <ReaderPool3D slots={scene.slots} layout={layout} tokens={tokens} />
      <Packets3D scene={scene} layout={layout} tokens={tokens} />
      {labelsReady && <Labels3D scene={scene} layout={layout} />}
      <CameraRig layout={layout} agent={cameraAgent(scene)} />
    </>
  );
}

export function Stage3D({ scene }: { scene: Scene }) {
  const tokens = useTokens3D();
  const showLocalize = scene.expectLocalize;
  const showExternal = scene.external;
  const slots = scene.slots.length;
  const layout = useMemo(() => layout3dFor({ showLocalize, showExternal, slots }), [showLocalize, showExternal, slots]);
  return (
    <div role="img" aria-label={sceneSummary(scene)} className="aspect-[16/7] w-full max-w-[960px] rounded-sm border border-rule" data-stage3d>
      <Canvas
        aria-hidden="true" frameloop="demand" dpr={[1, 2]} camera={{ position: CAMERA_BASE, fov: 45 }}
        gl={{ antialias: true, powerPreference: "low-power" }}
      >
        <World scene={scene} layout={layout} tokens={tokens} />
      </Canvas>
    </div>
  );
}

export default Stage3D;
