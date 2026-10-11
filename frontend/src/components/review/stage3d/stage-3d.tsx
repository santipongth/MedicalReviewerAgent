"use client";
// Optional 3D view of the live agent team (Plan 18; loaded lazily: three.js never reaches the eager page or the 2D
// views). The five members stand around a low round table with their phase tiles; the speaking member has the speech
// bubble and the camera eases toward it; hand-off packets arc between heads; the evidence piles sit on the table.
// Reads only `Scene` (through the pure team model) and the pure 3D layout: every visual change traces to a scene
// change, nothing advances on a timer.
// Adapts the node/arc/packet/camera ideas of AI-Agent-observatory by sakshigupta372, used with the author's permission.
// See NOTICE.md at the repo root.
import { Canvas, useThree, type RootState } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Scene } from "@/lib/agent-scene";
import { teamLayout3D, type TeamLayout3D } from "@/lib/agent-layout-3d";
import { stageSizeFor } from "@/lib/stage-size";
import { teamOf, teamSummary, type Team, type TeamOpts } from "@/lib/agent-team";
import { CameraRig } from "./camera-rig";
import { EvidencePiles3D } from "./evidence-piles-3d";
import { PileLabels, TeamLabels3D } from "./labels-3d";
import { anyPinging, CAMERA_BASE, STAGE_FOV, teamCameraGoal } from "./model-3d";
import { Packets3D } from "./packets-3d";
import { Robot3D, Table3D } from "./robot-3d";
import { useTokens3D, type Tokens3D } from "./tokens-3d";

/** Requests one frame whenever the scene or the theme changes (frameloop="demand"). */
function InvalidateOn({ scene, tokens }: { scene: Scene; tokens: Tokens3D }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [scene, tokens, invalidate]);
  return null;
}

/** Frame interval while a working ping ring grows (~16 fps is enough for an indeterminate "working" look). */
export const SPIN_FRAME_MS = 60;

/**
 * While any member is working, requests a frame every SPIN_FRAME_MS so its antenna ping keeps growing, instead of
 * rendering every display frame for most of a run. The interval only calls invalidate() (draw another frame); it never
 * changes the scene or any state, so it cannot fake progress. It stops as soon as no member pings.
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

let shared: TeamLayout3D | null = null;
/** The team layout is constant; built once, on first use, inside this lazy chunk. */
function layoutOnce(): TeamLayout3D {
  shared ??= teamLayout3D();
  return shared;
}

function World({ scene, team, tokens, aspect }: { scene: Scene; team: Team; tokens: Tokens3D; aspect: number }) {
  const layout = layoutOnce();
  // drei's Html drops the first label's content when it mounts in the Canvas's very first commit (the first agent's
  // label stayed empty in a real browser), so the labels mount one commit later.
  const [labelsReady, setLabelsReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-commit deferral, see above
  useEffect(() => { setLabelsReady(true); }, []);
  // fitted to the box it is drawn in (the run's wide box, Plan 21)
  const goal = useMemo(() => teamCameraGoal(layout, team.speaking, undefined, aspect), [layout, team.speaking, aspect]);
  return (
    <>
      <color attach="background" args={[tokens.surface]} />
      {/* DESIGN.md: one ambient + one directional light, flat colours; no shadows, emissive, fog or post-processing */}
      <ambientLight intensity={0.65} />
      <directionalLight position={[-3, 9, 7]} intensity={1.0} />
      <InvalidateOn scene={scene} tokens={tokens} />
      <SpinTicker spinning={anyPinging(team.members)} />
      <Table3D table={layout.table} tokens={tokens} />
      {team.members.map((m) => (
        <Robot3D
          key={m.id} m={layout.members[m.id]} status={m.status} speaking={team.speaking === m.id} phase={m.phase}
          passed={m.passed} tokens={tokens}
        />
      ))}
      <EvidencePiles3D scene={scene} layout={layout} from={layout.members.reader.ball} tokens={tokens} />
      <Packets3D scene={scene} layout={layout} tokens={tokens} />
      {labelsReady && <TeamLabels3D team={team} layout={layout} tokens={tokens} />}
      {labelsReady && <PileLabels scene={scene} layout={layout} />}
      <CameraRig goal={goal} />
    </>
  );
}

export function Stage3D({ scene, question, framework }: { scene: Scene } & TeamOpts) {
  const tokens = useTokens3D();
  const team = useMemo(() => teamOf(scene, { framework, question }), [scene, framework, question]);
  const label = useMemo(() => teamSummary(scene, { framework, question }), [scene, framework, question]);
  const size = stageSizeFor(scene.requested); // the run's wide box, the same as the 2D views

  // A lost WebGL context (GPU reset, too many contexts, driver hiccup) throws during render, so StageView's error
  // boundary falls back to the team view with its note instead of leaving a frozen or blank canvas.
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
    <div role="img" aria-label={label} className="mx-auto w-full rounded-sm" style={{ aspectRatio: `${size.width} / ${size.height}` }} data-stage3d>
      <Canvas
        aria-hidden="true" frameloop="demand" dpr={[1, 2]} camera={{ position: CAMERA_BASE, fov: STAGE_FOV }}
        gl={{ antialias: true, powerPreference: "low-power" }} onCreated={onCreated}
      >
        <World scene={scene} team={team} tokens={tokens} aspect={size.width / size.height} />
      </Canvas>
    </div>
  );
}

export default Stage3D;
