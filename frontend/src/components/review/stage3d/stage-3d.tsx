"use client";
// Optional 3D view of the live agent stage (loaded lazily; three.js never reaches the eager page or the 2D stage).
// Reads only `Scene` and the pure 3D layout: every visual change traces to a scene change, nothing advances on a timer.
// Adapts the node/arc/packet/camera ideas of AI-Agent-observatory by sakshigupta372, used with the author's permission.
// See NOTICE.md at the repo root.
import { Canvas, useThree, type RootState } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PIPELINE, sceneSummary, type Scene } from "@/lib/agent-scene";
import { layout3dFor, type Layout3D } from "@/lib/agent-layout-3d";
import { CameraRig } from "./camera-rig";
import { Edge3D } from "./edge-3d";
import { EvidencePiles3D, Tray3D } from "./evidence-piles-3d";
import { Labels3D } from "./labels-3d";
import { anySpinning, cameraAgent, CAMERA_BASE, STAGE_FOV, visibleAgents } from "./model-3d";
import { Node3D } from "./node-3d";
import { Packets3D } from "./packets-3d";
import { ReaderPool3D } from "./reader-pool-3d";
import { ThoughtLabel3D } from "./thought-label-3d";
import { useTokens3D, type Tokens3D } from "./tokens-3d";

/** Requests one frame whenever the scene or the theme changes (frameloop="demand"). */
function InvalidateOn({ scene, tokens }: { scene: Scene; tokens: Tokens3D }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [scene, tokens, invalidate]);
  return null;
}

/** Frame interval while a working ring spins (~16 fps is enough for an indeterminate "working" look). */
export const SPIN_FRAME_MS = 60;

/**
 * While any visible node is `working`, requests a frame every SPIN_FRAME_MS so its dashed ring keeps turning, instead
 * of rendering every display frame for most of a run. The interval only calls invalidate() (draw another frame); it
 * never changes the scene or any state, so it cannot fake progress. It stops as soon as no ring spins.
 */
export function SpinTicker({ spinning }: { spinning: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!spinning) return;
    const id = window.setInterval(() => invalidate(), SPIN_FRAME_MS);
    return () => window.clearInterval(id);
  }, [spinning, invalidate]);
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
      {/* DESIGN.md: one ambient + one directional light, flat colours; no shadows, emissive, fog or post-processing */}
      <ambientLight intensity={0.65} />
      <directionalLight position={[-3, 9, 7]} intensity={1.0} />
      <InvalidateOn scene={scene} tokens={tokens} />
      <SpinTicker spinning={anySpinning(scene, layout)} />
      {layout.edges.map((e) => (
        <Edge3D key={e.id} seg={e.seg} state={scene.edges[e.id] ?? "idle"} tokens={tokens} />
      ))}
      {visibleAgents(layout, PIPELINE).map((id) => (
        <Node3D key={id} at={layout.nodes[id]!} status={scene.agents[id]} tokens={tokens} />
      ))}
      <Tray3D layout={layout} tokens={tokens} />
      <ReaderPool3D slots={scene.slots} layout={layout} tokens={tokens} />
      <EvidencePiles3D scene={scene} layout={layout} tokens={tokens} />
      <Packets3D scene={scene} layout={layout} tokens={tokens} />
      {labelsReady && <Labels3D scene={scene} layout={layout} />}
      {labelsReady && <ThoughtLabel3D scene={scene} layout={layout} tokens={tokens} />}
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

  // A lost WebGL context (GPU reset, too many contexts, driver hiccup) throws during render, so StageView's error
  // boundary falls back to 2D with its note instead of leaving a frozen or blank canvas.
  const [lost, setLost] = useState(false);
  const detach = useRef<(() => void) | null>(null);
  const onCreated = useCallback(({ gl }: RootState) => {
    const el = gl.domElement;
    const onLost = (e: Event) => { e.preventDefault(); setLost(true); };
    detach.current?.();
    el.addEventListener("webglcontextlost", onLost);
    detach.current = () => el.removeEventListener("webglcontextlost", onLost);
  }, []);
  useEffect(() => () => { detach.current?.(); detach.current = null; }, []);
  if (lost) throw new Error("WebGL context lost");

  return (
    <div role="img" aria-label={sceneSummary(scene)} className="mx-auto aspect-[960/288] w-full rounded-sm" data-stage3d>
      <Canvas
        aria-hidden="true" frameloop="demand" dpr={[1, 2]} camera={{ position: CAMERA_BASE, fov: STAGE_FOV }}
        gl={{ antialias: true, powerPreference: "low-power" }} onCreated={onCreated}
      >
        <World scene={scene} layout={layout} tokens={tokens} />
      </Canvas>
    </div>
  );
}

export default Stage3D;
