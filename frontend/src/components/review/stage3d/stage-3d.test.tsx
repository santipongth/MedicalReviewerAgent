import { act, render, screen } from "@testing-library/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene, sceneSummary } from "@/lib/agent-scene";

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
}));

import Stage3D, { SPIN_FRAME_MS, SpinTicker, Stage3D as Named } from "./stage-3d";
import { layout3dFor } from "@/lib/agent-layout-3d";
import type { ReviewEvent } from "@/lib/types";
import { Labels3D, PILES_CAPTION } from "./labels-3d";
import { ThoughtLabel3D } from "./thought-label-3d";
import { TOKEN_FALLBACK } from "./tokens-3d";
import { STAGE_ASPECT } from "./model-3d";
import { PLACEHOLDER_SIZE } from "../stage/stage-placeholder";

class Catch extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() { return this.state.error ? <p data-testid="caught">{this.state.error}</p> : this.props.children; }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); invalidate.mockReset(); });

describe("Stage3D wrapper", () => {
  it("default export is Stage3D (Task 3 lazy-loads it)", () => {
    expect(Stage3D).toBe(Named);
  });

  it("is an img with the 2D stage's aria-label and an aria-hidden, demand-driven canvas", () => {
    const scene = reduceScene(initialScene(), { kind: "event", ev: { seq: 1, type: "checking_topic", payload: {} } as never });
    render(<Stage3D scene={scene} />);
    const fig = screen.getByRole("img");
    expect(fig).toHaveAttribute("aria-label", sceneSummary(scene));
    // the same full-width, centred box as the 2D stage, so toggling 2D/3D never shifts the page
    const w = PLACEHOLDER_SIZE.wide;
    expect(fig.className).toContain(`aspect-[${w.width}/${w.height}]`);
    expect(fig).toHaveClass("mx-auto", "w-full");
    expect(fig.className).not.toMatch(/max-w-/);
    expect(STAGE_ASPECT).toBeCloseTo(w.width / w.height, 9);
    const canvas = screen.getByTestId("canvas");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveAttribute("data-frameloop", "demand");
    expect(canvas).toHaveAttribute("data-dpr", "1,2");
    expect(canvas).toHaveAttribute("data-fov", "45");
  });

  it("throws to the error boundary when the WebGL context is lost (and cancels the default)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Catch><Stage3D scene={initialScene()} /></Catch>);
    const gl = screen.getByTestId("gl");
    const ev = new Event("webglcontextlost", { cancelable: true });
    act(() => { gl.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
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
  it("requests throttled frames only while a ring spins, and stops when it no longer does", () => {
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

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });

/** A run in the read phase: 12 papers fanned out, 6 finished (mixed directions, one "null", one uncertain, one failed). */
function midRead() {
  const evs: ReviewEvent[] = [
    ev(1, "started"), ev(2, "checking_topic"), ev(3, "refining"), ev(4, "question_refined"), ev(5, "planning", { queries: ["a"] }),
    ev(6, "searching", { found: 40 }), ev(7, "enriching", { candidates: 20 }), ev(8, "screening"), ev(9, "screened", { kept: 12, total: 20 }),
    ...Array.from({ length: 12 }, (_, i) => ev(10 + i, "reading", { ref: `P${i + 1}`, title: `Paper ${i + 1}` })),
    ev(30, "extracted", { ref: "P1", ok: true, direction: "positive", design: "rct" }),
    ev(31, "extracted", { ref: "P2", ok: true, direction: "positive", design: "sr_ma_rct" }),
    ev(32, "extracted", { ref: "P3", ok: true, direction: "null", design: "cohort" }),
    ev(33, "extracted", { ref: "P4", ok: true, uncertain: true, direction: "negative" }),
    ev(34, "extracted", { ref: "P5", ok: false }),
    ev(35, "extracted", { ref: "P6", ok: true }), // no direction -> not on a pile
  ];
  return evs.reduce((s, e) => reduceScene(s, { kind: "event", ev: e }), initialScene({ language: "th" }));
}

describe("Labels3D (piles, pool)", () => {
  const scene = midRead();
  const layout = layout3dFor({ showLocalize: true, showExternal: false, slots: scene.slots.length });

  it("labels each non-empty pile with its glyph and count (flag count when uncertain), plus the as-read caption", () => {
    const { container } = render(<Labels3D scene={scene} layout={layout} />);
    const q = (k: string) => container.querySelector(`[data-label3d="${k}"]`);
    expect(q("pile-positive")).toHaveTextContent("2");
    expect(q("pile-positive")!.querySelector("[role=img]")).toHaveAttribute("aria-label");
    expect(q("pile-null")).toHaveTextContent("1");
    expect(q("pile-negative")).toHaveTextContent(/^11$/); // count 1 + flag count 1
    expect(q("pile-mixed")).toBeNull();
    expect(q("pile-unclear")).toBeNull();
    expect(q("piles")).toHaveTextContent(PILES_CAPTION);
    expect(PILES_CAPTION).toBe("ทิศทางผลตามที่เอเจนต์อ่าน");
    for (const el of container.querySelectorAll("[data-label3d]")) expect(el.textContent!.trim()).not.toBe("");
    expect(container.textContent).not.toMatch(/%/); // never a share or ranking
  });

  it("the pool label shows only counts: unfinished papers are 'reading or queued', no refs", () => {
    const { container } = render(<Labels3D scene={scene} layout={layout} />);
    const pool = container.querySelector('[data-label3d="pool"]')!;
    expect(pool).toHaveTextContent("6 ฉบับกำลังอ่านหรือรอคิว");
    expect(pool.textContent).not.toMatch(/P\d/);
  });

  it("renders no pile labels or caption before any direction is counted", () => {
    const s = reduceScene(initialScene(), { kind: "event", ev: ev(1, "checking_topic") });
    const { container } = render(<Labels3D scene={s} layout={layout3dFor({ showLocalize: true, showExternal: false, slots: 0 })} />);
    expect(container.querySelector('[data-label3d^="pile"]')).toBeNull();
  });
});

describe("ThoughtLabel3D", () => {
  it("shows thought.short above the current agent, aria-hidden, with a leader line", () => {
    const scene = midRead();
    const layout = layout3dFor({ showLocalize: true, showExternal: false, slots: scene.slots.length });
    const { container } = render(<ThoughtLabel3D scene={scene} layout={layout} tokens={TOKEN_FALLBACK} />);
    const el = container.querySelector('[data-label3d="thought"]')!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveTextContent("อ่านงานวิจัย · อ่านเสร็จ 6/12");
    expect(el.className).toContain("max-w-[240px]");
    expect(el.className).toContain("pointer-events-none");
    expect(screen.getByTestId("leader")).toBeInTheDocument();
  });

  it("is not rendered at all with no current agent or once the run is over (never an empty label)", () => {
    const layout = layout3dFor({ showLocalize: true, showExternal: false, slots: 0 });
    const idle = render(<ThoughtLabel3D scene={initialScene()} layout={layout} tokens={TOKEN_FALLBACK} />);
    expect(idle.container.querySelector("[data-label3d]")).toBeNull();
    idle.unmount();
    const done = reduceScene(midRead(), { kind: "event", ev: ev(99, "done") });
    const end = render(<ThoughtLabel3D scene={done} layout={layout} tokens={TOKEN_FALLBACK} />);
    expect(end.container.querySelector("[data-label3d]")).toBeNull();
  });
});
