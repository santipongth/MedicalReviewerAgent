import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, type Pulse, type Scene } from "@/lib/agent-scene";
import { layoutFor } from "@/lib/agent-layout";

const state = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (orig) => ({
  ...(await orig<typeof import("motion/react")>()),
  useReducedMotion: () => state.reduced,
}));

import { PacketLayer } from "./packet-layer";
import { StageMotion } from "./motion";

const layout = layoutFor("wide", { showLocalize: true, showExternal: false, slots: 0, batches: 0, queries: 0 });
const edge = layout.edges[0].id;

function sceneWith(n: number, from = 1): Scene {
  const pulses: Pulse[] = Array.from({ length: n }, (_, i) => ({ key: from + i, edge, kind: "paper", n: 1 }));
  return { ...initialScene(), pulses, lastSeq: n ? from + n - 1 : 0 };
}
const ui = (s: Scene) => (
  <StageMotion><svg><PacketLayer scene={s} layout={layout} /></svg></StageMotion>
);
const count = (c: HTMLElement) => c.querySelectorAll("[data-packet]").length;

describe("PacketLayer", () => {
  beforeEach(() => { state.reduced = false; });

  it("animates a new pulse after mount", () => {
    const { container, rerender } = render(ui(initialScene()));
    expect(count(container)).toBe(0);
    act(() => { rerender(ui(sceneWith(1))); });
    expect(count(container)).toBeGreaterThan(0);
  });

  it("does not animate pulses that already existed at mount (replay)", () => {
    const { container } = render(ui(sceneWith(5)));
    expect(count(container)).toBe(0);
  });

  it("caps a burst at the 24-dot pool", () => {
    const { container, rerender } = render(ui(initialScene()));
    act(() => { rerender(ui(sceneWith(40))); });
    const c = count(container);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(24);
    expect(container.querySelectorAll("circle").length).toBe(24);
  });

  it("renders nothing under reduced motion", () => {
    state.reduced = true;
    const { container, rerender } = render(ui(initialScene()));
    act(() => { rerender(ui(sceneWith(3))); });
    expect(container.querySelectorAll("circle").length).toBe(0);
    expect(count(container)).toBe(0);
  });
});
