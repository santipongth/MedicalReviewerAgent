import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene, sceneSummary } from "@/lib/agent-scene";

// jsdom has no WebGL: replace the Canvas with a probe that records its props (the scene graph is not rendered).
vi.mock("@react-three/fiber", () => ({
  Canvas: (p: { children?: ReactNode; frameloop?: string; dpr?: number[]; "aria-hidden"?: boolean | "true" | "false"; camera?: { fov: number } }) => (
    <div data-testid="canvas" data-frameloop={p.frameloop} data-dpr={p.dpr?.join(",")} aria-hidden={p["aria-hidden"]} data-fov={p.camera?.fov} />
  ),
  useThree: () => () => {},
  useFrame: () => {},
}));
vi.mock("@react-three/drei", () => ({ Html: () => null, QuadraticBezierLine: () => null }));

import Stage3D, { Stage3D as Named } from "./stage-3d";

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
});
