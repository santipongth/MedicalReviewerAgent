"use client";
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Scene } from "@/lib/agent-scene";
import type { Connection } from "@/lib/use-review";
import { hasWebGL } from "@/lib/webgl";
import { StageLegend } from "./stage/stage-legend";
import { StagePlaceholder } from "./stage/stage-placeholder";
import { useWide } from "./stage/use-wide";

// Client-only chunk (motion lives here); the placeholder reserves the stage's aspect so nothing shifts on load.
// LiveRun renders after the review (and so its language) has loaded, so the placeholder knows whether localize shows.
const AgentStage = dynamic(() => import("./stage/agent-stage").then((m) => m.AgentStage), {
  ssr: false,
  loading: () => <StagePlaceholder />,
});

// three.js / R3F / drei live only in this lazily loaded chunk.
const Stage3D = dynamic(() => import("./stage3d/stage-3d"), {
  ssr: false,
  loading: () => <div aria-hidden data-placeholder="3d" className="aspect-[16/7] w-full max-w-[960px] rounded-sm border border-rule bg-surface" />,
});

const STORAGE_KEY = "mra.stage3d";
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduce(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function reduceSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE_QUERY).matches;
}
/** SSR-safe prefers-reduced-motion (server and first render: false, like useWide). */
function useReduce(): boolean {
  return useSyncExternalStore(subscribeReduce, reduceSnapshot, () => false);
}

const noSubscribe = () => () => {};
const prefListeners = new Set<() => void>();
function subscribePref(cb: () => void): () => void {
  prefListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { prefListeners.delete(cb); window.removeEventListener("storage", cb); };
}
let memoryPref = false; // session-only value, used once a write to storage has failed
let writeFailed = false;
function readPref(): boolean {
  if (writeFailed) return memoryPref;
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return memoryPref; }
}
function writePref(on: boolean): void {
  memoryPref = on;
  try { localStorage.setItem(STORAGE_KEY, on ? "1" : "0"); writeFailed = false; } catch { writeFailed = true; }
  prefListeners.forEach((cb) => cb());
}

/** Falls back (once) when the 3D chunk or the WebGL canvas throws. */
class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The agent stage: 2D by default; an opt-in 3D view on wide screens with WebGL and no reduced-motion preference. */
export function StageView({ scene, connection }: { scene: Scene; connection?: Connection }) {
  const wide = useWide();
  const reduce = useReduce();
  // Browser-only facts come from external stores whose server snapshot is false, so hydration renders 2D first.
  const webgl = useSyncExternalStore(noSubscribe, hasWebGL, () => false);
  const pref = useSyncExternalStore(subscribePref, readPref, () => false);
  const [failed, setFailed] = useState(false);
  const note = useRef<HTMLParagraphElement>(null);
  // The toggle unmounts when 3D fails; move focus to the note so it is not dropped to the body.
  useEffect(() => { if (failed) note.current?.focus(); }, [failed]);
  const can3d = wide && webgl && !reduce && !failed;
  const is3d = can3d && pref;
  function toggle() {
    writePref(!pref);
  }
  return (
    <>
      {can3d && (
        <button
          type="button"
          aria-pressed={is3d}
          onClick={toggle}
          className="w-fit cursor-pointer rounded-sm border border-rule bg-transparent px-3 py-1.5 text-sm hover:text-primary"
        >
          {is3d ? "มุมมอง 2D" : "มุมมอง 3D"}
        </button>
      )}
      {failed && <p ref={note} tabIndex={-1} role="status" className="text-sm text-muted outline-none">แสดงแบบ 3D ไม่ได้บนเครื่องนี้ จึงแสดงแบบ 2D แทน</p>}
      {is3d ? (
        <>
          <Boundary onError={() => setFailed(true)}>
            <Stage3D scene={scene} />
          </Boundary>
          <StageLegend />
        </>
      ) : (
        <AgentStage scene={scene} connection={connection} />
      )}
    </>
  );
}
