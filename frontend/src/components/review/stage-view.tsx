"use client";
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SYNTH_CAPTION, showSynthCaption, stageCaption, stageStep, type Scene } from "@/lib/agent-scene";
import type { Connection } from "@/lib/use-review";
import { hasWebGL } from "@/lib/webgl";
import {
  DEFAULT_VIEW, LEGACY_3D_KEY, VIEW_KEY, effectiveView, parseStageView, type StageViewKind,
} from "@/lib/stage-view-pref";
import { PHASE_NOTE } from "@/lib/team-copy";
import { StagePlaceholder } from "./stage/stage-placeholder";
import { TeamLegend } from "./team/team-legend";
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

// The 2D team view (Plan 18, the default) is its own lazy chunk; its placeholder reserves the team box.
const TeamStage = dynamic(() => import("./team/team-stage").then((m) => m.TeamStage), {
  ssr: false,
  loading: () => <StagePlaceholder view="team" />,
});

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
let memoryPref: StageViewKind | null = null; // session-only value, used once storage cannot be read or written
let writeFailed = false;
/** Test seam: forget the session-only preference state. */
export function resetStagePrefForTests(): void {
  memoryPref = null;
  writeFailed = false;
}
function readPref(): StageViewKind {
  if (writeFailed && memoryPref) return memoryPref;
  try {
    return parseStageView(localStorage.getItem(VIEW_KEY), localStorage.getItem(LEGACY_3D_KEY));
  } catch {
    return memoryPref ?? DEFAULT_VIEW;
  }
}
function writePref(v: StageViewKind): void {
  memoryPref = v;
  try {
    localStorage.setItem(VIEW_KEY, v);
    localStorage.removeItem(LEGACY_3D_KEY); // migrated: the new key now holds the choice
    writeFailed = false;
  } catch {
    writeFailed = true;
  }
  prefListeners.forEach((cb) => cb());
}

const VIEW_LABEL: Record<StageViewKind, string> = { team: "ทีมเอเจนต์", steps: "ขั้นตอน", "3d": "3D" };

/** Falls back (once) when the 3D chunk or the WebGL canvas throws. */
class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * The agent stage in one of three views: the 2D agent team (default), the 2D pipeline steps, or an opt-in 3D view
 * offered only on wide screens with WebGL and no reduced-motion preference. The choice is a button group in the
 * header row, remembered under `mra.stageView` (a Plan 12 `mra.stage3d = "1"` migrates to "3d").
 */
export function StageView({ scene, connection, heading, lead, question, framework }: {
  scene: Scene; connection?: Connection;
  heading?: ReactNode; // the section heading, first in the header row
  lead?: ReactNode; // full width under the header row (the thought card)
  question?: string | null; // the refined question (question_refined), quoted by the team's planner
  framework?: "PICO" | "PCC";
}) {
  const wide = useWide();
  const reduce = useReduce();
  // Browser-only facts come from external stores whose server snapshot is false, so hydration renders 2D first.
  // WebGL is probed only for viewers who could ever see 3D (wide, no reduced-motion preference).
  const webgl = useSyncExternalStore(noSubscribe, () => wide && !reduce && hasWebGL(), () => false);
  const pref = useSyncExternalStore(subscribePref, readPref, () => DEFAULT_VIEW);
  const [failed, setFailed] = useState(false);
  const toggle3dRef = useRef<HTMLButtonElement>(null);
  const hadFocus = useRef(false);
  const note = useRef<HTMLParagraphElement>(null);
  // The 3D button unmounts when 3D fails. Only if it had focus (the user just pressed it) does focus move to the note,
  // so it is not dropped to the body; otherwise the note's role="status" announces it without stealing focus or scrolling.
  useEffect(() => {
    if (failed && hadFocus.current) note.current?.focus({ preventScroll: true });
  }, [failed]);
  const can3d = wide && webgl && !reduce && !failed;
  const view = effectiveView(pref, can3d);
  const caption = stageCaption(scene, connection);
  function onError() {
    hadFocus.current = typeof document !== "undefined" && toggle3dRef.current !== null && document.activeElement === toggle3dRef.current;
    setFailed(true);
  }
  const step = stageStep(scene);
  const views: StageViewKind[] = can3d ? ["team", "steps", "3d"] : ["team", "steps"];
  return (
    <>
      {/* One header row: section heading · step indicator, the view buttons right-aligned (44px targets, so the row
          keeps its height whatever the view). */}
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
        <div role="group" aria-label="มุมมองเวที" className="ml-auto flex flex-none" data-stage-views>
          {views.map((v, i) => {
            const on = view === v;
            return (
              <button
                key={v}
                ref={v === "3d" ? toggle3dRef : undefined}
                type="button"
                aria-pressed={on}
                onClick={() => writePref(v)}
                data-view={v}
                className={`relative min-h-11 min-w-11 cursor-pointer border px-3.5 font-display text-sm ${i > 0 ? "-ml-px" : ""} ${
                  i === 0 ? "rounded-l-sm" : ""} ${i === views.length - 1 ? "rounded-r-sm" : ""} ${
                  on ? "z-[1] border-primary bg-primary font-semibold text-on-primary" : "border-rule bg-transparent text-ink hover:text-primary"}`}
              >
                {VIEW_LABEL[v]}
              </button>
            );
          })}
        </div>
      </div>
      {lead}
      {failed && <p ref={note} tabIndex={-1} role="status" className="text-sm text-muted outline-none">แสดงแบบ 3D ไม่ได้บนเครื่องนี้ จึงแสดงแบบ 2D แทน</p>}
      {view === "team" && <TeamStage scene={scene} connection={connection} question={question} framework={framework} />}
      {view === "steps" && <AgentStage scene={scene} connection={connection} />}
      {view === "3d" && (
        // The team in 3D: the team view's phase legend (tile variant) and honesty note, and the shared captions.
        <figure className="grid gap-2">
          <Boundary onError={onError}>
            <Stage3D scene={scene} question={question} framework={framework} />
          </Boundary>
          {showSynthCaption(scene) && (
            <p className="font-display text-xs text-muted" data-caption="synth">{SYNTH_CAPTION.join(" ")}</p>
          )}
          <div className="grid gap-2 border-t border-rule pt-3">
            <TeamLegend variant="3d" />
            <p className="text-xs text-muted" data-phase-note>{PHASE_NOTE}</p>
            {caption && <figcaption className="text-xs text-muted">{caption}</figcaption>}
          </div>
        </figure>
      )}
    </>
  );
}
