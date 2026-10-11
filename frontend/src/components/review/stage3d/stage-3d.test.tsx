import { act, render, screen } from "@testing-library/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene } from "@/lib/agent-scene";
import { teamOf, teamSummary } from "@/lib/agent-team";

const invalidate = vi.hoisted(() => vi.fn());

// jsdom has no WebGL: replace the Canvas with a probe that records its props (the scene graph is not rendered) and
// hands onCreated a real <canvas> as gl.domElement, like R3F does once the renderer exists.
vi.mock("@react-three/fiber", () => ({
  Canvas: (p: {
    children?: ReactNode; frameloop?: string; dpr?: number[]; "aria-hidden"?: boolean | "true" | "false"; camera?: { fov: number };
    onCreated?: (s: { gl: { domElement: HTMLCanvasElement } }) => void;
  }) => {
    const el = useRef<HTMLCanvasElement>(null);
    const { onCreated } = p;
    useEffect(() => { if (el.current) onCreated?.({ gl: { domElement: el.current } }); }, [onCreated]);
    return (
      <div data-testid="canvas" data-frameloop={p.frameloop} data-dpr={p.dpr?.join(",")} aria-hidden={p["aria-hidden"]} data-fov={p.camera?.fov}>
        <canvas ref={el} data-testid="gl" />
      </div>
    );
  },
  useThree: () => invalidate,
  useFrame: () => {},
}));
// Html renders its DOM children in place (drei portals them over the canvas); Line draws nothing in jsdom.
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: ReactNode }) => <div data-testid="html">{children}</div>,
  Line: (p: { points: unknown }) => <div data-testid="leader" data-points={JSON.stringify(p.points)} />,
  Edges: () => null,
}));

import Stage3D, { SPIN_FRAME_MS, SpinTicker, Stage3D as Named } from "./stage-3d";
import { teamLayout3D } from "@/lib/agent-layout-3d";
import type { ReviewEvent } from "@/lib/types";
import { BUBBLE_MAX_PX, PileLabels, PILES_CAPTION, TeamLabels3D } from "./labels-3d";
import { TOKEN_FALLBACK } from "./tokens-3d";
import { STAGE_ASPECT, STAGE_FOV, teamCameraGoal } from "./model-3d";
import { stageSizeFor } from "@/lib/stage-size";
import { PLACEHOLDER_SIZE } from "../stage/stage-placeholder";

class Catch extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() { return this.state.error ? <p data-testid="caught">{this.state.error}</p> : this.props.children; }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); invalidate.mockReset(); });

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (evs: ReviewEvent[]) => evs.reduce((s, e) => reduceScene(s, { kind: "event", ev: e }), initialScene({ language: "th" }));

/** A run in the read phase: 12 papers fanned out, 6 finished (mixed directions, one "null", one uncertain, one failed). */
function midRead() {
  return run([
    ev(1, "started"), ev(2, "checking_topic"), ev(3, "refining"), ev(4, "question_refined"), ev(5, "planning", { queries: ["a"] }),
    ev(6, "searching", { found: 40 }), ev(7, "enriching", { candidates: 20 }), ev(8, "screening"), ev(9, "screened", { kept: 12, total: 20 }),
    ...Array.from({ length: 12 }, (_, i) => ev(10 + i, "reading", { ref: `P${i + 1}`, title: `Paper ${i + 1}` })),
    ev(30, "extracted", { ref: "P1", ok: true, direction: "positive", design: "rct" }),
    ev(31, "extracted", { ref: "P2", ok: true, direction: "positive", design: "sr_ma_rct" }),
    ev(32, "extracted", { ref: "P3", ok: true, direction: "null", design: "cohort" }),
    ev(33, "extracted", { ref: "P4", ok: true, uncertain: true, direction: "negative" }),
    ev(34, "extracted", { ref: "P5", ok: false }),
    ev(35, "extracted", { ref: "P6", ok: true }), // no direction -> not on a pile
  ]);
}

describe("Stage3D wrapper", () => {
  it("default export is Stage3D (StageView lazy-loads it)", () => {
    expect(Stage3D).toBe(Named);
  });

  it("is an img labelled with the team summary, over an aria-hidden, demand-driven canvas", () => {
    const scene = midRead();
    render(<Stage3D scene={scene} framework="PICO" />);
    const fig = screen.getByRole("img");
    expect(fig).toHaveAttribute("aria-label", teamSummary(scene, { framework: "PICO" }));
    expect(fig.getAttribute("aria-label")).toMatch(/^ทีมเอเจนต์ 5 คน ผู้อ่าน/);
    // the same full-width, centred box as the 2D views, so toggling never shifts the page
    const w = PLACEHOLDER_SIZE.wide;
    expect(fig.style.aspectRatio.replace(/\s/g, "")).toBe(`${w.width}/${w.height}`);
    expect(fig).toHaveClass("mx-auto", "w-full");
    expect(fig.className).not.toMatch(/max-w-/);
    expect(STAGE_ASPECT).toBeCloseTo(w.width / w.height, 9);
    const canvas = screen.getByTestId("canvas");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveAttribute("data-frameloop", "demand");
    expect(canvas).toHaveAttribute("data-dpr", "1,2");
    expect(canvas).toHaveAttribute("data-fov", String(STAGE_FOV));
  });

  it("Plan 21 fix round 1: the 3D box is the run's box, stageSizeFor(requested), the same as the 2D views", () => {
    for (const n of [5, 30, 50]) {
      const scene = reduceScene(midRead(), { kind: "requested", value: n });
      const { unmount } = render(<Stage3D scene={scene} framework="PICO" />);
      const w = stageSizeFor(n);
      expect(screen.getByRole("img").style.aspectRatio.replace(/\s/g, ""), String(n)).toBe(`${w.width}/${w.height}`);
      unmount();
    }
  });

  it("the camera fits the box it is drawn in: a taller box keeps every frame point in view", () => {
    const layout = teamLayout3D();
    const w = stageSizeFor(50);
    const cam = teamCameraGoal(layout, "reader", undefined, w.width / w.height);
    const dflt = teamCameraGoal(layout, "reader");
    expect(cam).not.toEqual(dflt); // the narrower aspect needs the camera further back (width-bound fit)
    expect(Math.hypot(cam[0] - cam[3], cam[1] - cam[4], cam[2] - cam[5])).toBeGreaterThan(Math.hypot(dflt[0] - dflt[3], dflt[1] - dflt[4], dflt[2] - dflt[5]) - 1e-9);
  });

  it("throws to the error boundary when the WebGL context is lost (and cancels the default)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Catch><Stage3D scene={initialScene()} /></Catch>);
    const gl = screen.getByTestId("gl");
    const e = new Event("webglcontextlost", { cancelable: true });
    act(() => { gl.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(screen.getByTestId("caught")).toHaveTextContent("WebGL context lost");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("removes the context-loss listener on unmount", () => {
    const remove = vi.spyOn(HTMLCanvasElement.prototype, "removeEventListener");
    const { unmount } = render(<Stage3D scene={initialScene()} />);
    unmount();
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
  });
});

describe("SpinTicker", () => {
  it("requests throttled frames only while a member pings, and stops when none does", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(<SpinTicker spinning={false} />);
    vi.advanceTimersByTime(SPIN_FRAME_MS * 5);
    expect(invalidate).not.toHaveBeenCalled();
    rerender(<SpinTicker spinning />);
    vi.advanceTimersByTime(SPIN_FRAME_MS * 5);
    expect(invalidate).toHaveBeenCalledTimes(5);
    rerender(<SpinTicker spinning={false} />);
    vi.advanceTimersByTime(SPIN_FRAME_MS * 5);
    expect(invalidate).toHaveBeenCalledTimes(5);
    rerender(<SpinTicker spinning />);
    unmount();
    vi.advanceTimersByTime(SPIN_FRAME_MS * 5);
    expect(invalidate).toHaveBeenCalledTimes(5);
  });
});

describe("TeamLabels3D", () => {
  const layout = teamLayout3D();

  it("names all five members; only the speaker has a bubble, with its real line and its phase by its name", () => {
    const scene = midRead();
    const team = teamOf(scene);
    const { container } = render(<TeamLabels3D team={team} layout={layout} tokens={TOKEN_FALLBACK} />);
    const q = (k: string) => container.querySelector(`[data-label3d="${k}"]`);
    expect(q("planner")).toHaveTextContent("ผู้วางแผน");
    expect(q("researcher")).toHaveTextContent("นักค้นคว้า");
    expect(q("screener")).toHaveTextContent("ผู้คัดกรอง");
    expect(q("synthesizer")).toHaveTextContent("ผู้สังเคราะห์");
    expect(q("reader")).toHaveTextContent("ผู้อ่าน · ลงมือ");
    expect(q("reader")).toHaveAttribute("data-speaking", "1");
    expect(q("planner")).toHaveAttribute("data-speaking", "0");
    expect(q("planner")!.querySelector("svg")).not.toBeNull(); // done: the ✓ shape cue
    expect(q("synthesizer")!.querySelector("svg")).toBeNull();
    const bubbles = container.querySelectorAll('[data-label3d="bubble"]');
    expect(bubbles).toHaveLength(1);
    const reader = team.members.find((m) => m.id === "reader")!;
    expect(bubbles[0]).toHaveAttribute("data-member", "reader");
    expect(bubbles[0]).toHaveTextContent(reader.line);
    expect(bubbles[0]).toHaveTextContent("อ่านเสร็จ 6 จาก 12 ฉบับ");
    expect(bubbles[0]).toHaveAttribute("aria-hidden", "true");
    expect((bubbles[0] as HTMLElement).style.maxWidth).toBe(`${BUBBLE_MAX_PX}px`);
    expect(bubbles[0].querySelector("p")!.className).toContain("text-xs"); // 12px Thai, never canvas text
    expect(screen.queryByTestId("leader")).toBeNull(); // a centred bubble needs no leader
    for (const el of container.querySelectorAll("[data-label3d]")) expect(el.textContent!.trim()).not.toBe("");
  });

  it("an end member's bubble grows inward and hangs from a leader", () => {
    const scene = run([ev(1, "started"), ev(2, "checking_topic")]);
    const { container } = render(<TeamLabels3D team={teamOf(scene)} layout={layout} tokens={TOKEN_FALLBACK} />);
    const b = container.querySelector('[data-label3d="bubble"]')!;
    expect(b).toHaveAttribute("data-member", "planner");
    expect(b).toHaveAttribute("data-align", "start");
    expect(screen.getByTestId("leader")).toBeInTheDocument();
  });

  it("shows no bubble once the run is over (nobody speaks), only names", () => {
    const done = reduceScene(midRead(), { kind: "event", ev: ev(99, "done") });
    const { container } = render(<TeamLabels3D team={teamOf(done)} layout={layout} tokens={TOKEN_FALLBACK} />);
    expect(container.querySelector('[data-label3d="bubble"]')).toBeNull();
    expect(container.querySelectorAll("[data-label3d]")).toHaveLength(5);
  });
});

describe("PileLabels", () => {
  const layout = teamLayout3D();

  it("labels each non-empty pile on one line with its glyph and count (flag count when uncertain), plus the caption", () => {
    const { container } = render(<PileLabels scene={midRead()} layout={layout} />);
    const q = (k: string) => container.querySelector(`[data-label3d="${k}"]`);
    expect(q("pile-positive")!.querySelector("[data-count]")).toHaveTextContent(/^2$/);
    expect(q("pile-positive")!.querySelector("[role=img]")).toHaveAttribute("aria-label");
    expect(q("pile-null")!.querySelector("[data-count]")).toHaveTextContent(/^1$/);
    expect(q("pile-negative")).toHaveTextContent(/^11$/); // count 1 + flag count 1
    expect(q("pile-mixed")).toBeNull();
    expect(q("pile-unclear")).toBeNull();
    expect(q("piles")).toHaveTextContent(PILES_CAPTION);
    expect(PILES_CAPTION).toBe("ทิศทางผลตามที่เอเจนต์อ่าน");
    expect(container.textContent).not.toMatch(/%/); // never a share or ranking
  });

  it("renders nothing before any direction is counted", () => {
    const s = run([ev(1, "checking_topic")]);
    const { container } = render(<PileLabels scene={s} layout={layout} />);
    expect(container.querySelector("[data-label3d]")).toBeNull();
  });
});
