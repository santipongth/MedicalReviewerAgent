"use client";
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SYNTH_CAPTION, showSynthCaption, stageCaption, stageStep, type Scene } from "@/lib/agent-scene";
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

// three.js / R3F / drei live only in this lazily loaded chunk. The placeholder is the loaded wrapper's box (borderless,
// the 2D stage's aspect), so nothing changes when the chunk lands.
const Stage3D = dynamic(() => import("./stage3d/stage-3d"), {
  ssr: false,
  loading: () => <div aria-hidden data-placeholder="3d" className="mx-auto aspect-[960/288] w-full rounded-sm bg-surface" />,
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
/** Test seam: forget the session-only preference state. */
export function resetStagePrefForTests(): void {
  memoryPref = false;
  writeFailed = false;
}
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
export function StageView({ scene, connection, heading, lead }: {
  scene: Scene; connection?: Connection;
  heading?: ReactNode; // the section heading, first in the header row
  lead?: ReactNode; // full width under the header row (the thought card)
}) {
  const wide = useWide();
  const reduce = useReduce();
  // Browser-only facts come from external stores whose server snapshot is false, so hydration renders 2D first.
  // WebGL is probed only for viewers who could ever see 3D (wide, no reduced-motion preference).
  const webgl = useSyncExternalStore(noSubscribe, () => wide && !reduce && hasWebGL(), () => false);
  const pref = useSyncExternalStore(subscribePref, readPref, () => false);
  const [failed, setFailed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const hadFocus = useRef(false);
  const note = useRef<HTMLParagraphElement>(null);
  // The toggle unmounts when 3D fails. Only if it had focus (the user just pressed it) does focus move to the note, so
  // it is not dropped to the body; otherwise the note's role="status" announces it without stealing focus or scrolling.
  useEffect(() => {
    if (failed && hadFocus.current) note.current?.focus({ preventScroll: true });
  }, [failed]);
  const can3d = wide && webgl && !reduce && !failed;
  const is3d = can3d && pref;
  const caption = stageCaption(scene, connection);
  function toggle() {
    writePref(!pref);
  }
  function onError() {
    hadFocus.current = typeof document !== "undefined" && toggleRef.current !== null && document.activeElement === toggleRef.current;
    setFailed(true);
  }
  const step = stageStep(scene);
  return (
    <>
      {(heading || step || can3d) && (
        // One header row: section heading · step indicator, the 3D toggle right-aligned. min-h-11 keeps the row the
        // same height whether or not the toggle shows (it can appear only after hydration).
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1" data-stage-header>
          {(heading || step) && (
            <div className="flex min-w-0 items-baseline gap-1.5">
              {heading}
              {step && (
                // quieter than the section label: regular weight, no tracking
                <span className="font-display text-xs font-normal tabular-nums text-muted" data-stage-step>
                  {heading && <span aria-hidden="true">· </span>}ขั้น {step.n} จาก {step.of}
                </span>
              )}
            </div>
          )}
          {can3d && (
            <button
              ref={toggleRef}
              type="button"
              aria-pressed={is3d}
              onClick={toggle}
              className="ml-auto min-h-11 w-fit flex-none cursor-pointer rounded-sm border border-rule bg-transparent px-4 font-display text-sm hover:text-primary"
            >
              {is3d ? "มุมมอง 2D" : "มุมมอง 3D"}
            </button>
          )}
        </div>
      )}
      {lead}
      {failed && <p ref={note} tabIndex={-1} role="status" className="text-sm text-muted outline-none">แสดงแบบ 3D ไม่ได้บนเครื่องนี้ จึงแสดงแบบ 2D แทน</p>}
      {is3d ? (
        // Same captions as the 2D stage (shared helpers), under the canvas.
        <figure className="grid gap-2">
          <Boundary onError={onError}>
            <Stage3D scene={scene} />
          </Boundary>
          {showSynthCaption(scene) && (
            <p className="font-display text-xs text-muted" data-caption="synth">{SYNTH_CAPTION.join(" ")}</p>
          )}
          <div className="grid gap-2 border-t border-rule pt-3">
            <StageLegend />
            {caption && <figcaption className="text-xs text-muted">{caption}</figcaption>}
          </div>
        </figure>
      ) : (
        <AgentStage scene={scene} connection={connection} />
      )}
    </>
  );
}
