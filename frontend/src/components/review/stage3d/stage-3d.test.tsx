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
vi.mock("@react-three/drei", () => ({ Html: () => null, QuadraticBezierLine: () => null }));

import Stage3D, { SPIN_FRAME_MS, SpinTicker, Stage3D as Named } from "./stage-3d";

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
    expect(fig.className).toContain("aspect-[960/330]");
    expect(fig.className).toContain("max-w-[960px]");
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
