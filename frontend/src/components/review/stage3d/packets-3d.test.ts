import { describe, expect, it, vi } from "vitest";
import type { InstancedMesh } from "three";
import { FLIGHT_MS } from "./model-3d";
import { arcKey, teamLayout3D } from "@/lib/agent-layout-3d";

// packets-3d.tsx imports R3F hooks at module level; only the pure step() is exercised here.
vi.mock("@react-three/fiber", () => ({ useFrame: () => {}, useThree: () => () => {} }));

import { TRAIL, makePool, step } from "./packets-3d";

const seg = teamLayout3D().arcs[arcKey("planner", "researcher")]!;

/** A fake InstancedMesh that records the scale (matrix element 0, no rotation) last written per instance. */
function fakeMesh(): { mesh: InstancedMesh; scale: Map<number, number>; set: ReturnType<typeof vi.fn> } {
  const scale = new Map<number, number>();
  const set = vi.fn((i: number, m: { elements: number[] }) => { scale.set(i, m.elements[0]); });
  const mesh = { setMatrixAt: set, instanceMatrix: { needsUpdate: false } } as unknown as InstancedMesh;
  return { mesh, scale, set };
}

describe("packets step()", () => {
  it("flies the head and its wake, then hides the head and both ghosts and goes idle after the wake lands", () => {
    const pool = makePool();
    pool.flights[0] = { seg, kind: "paper", start: 0 };
    const head = fakeMesh();
    const trail = fakeMesh();

    // mid-flight: the head and both ghosts are visible and the loop must keep running
    expect(step(head.mesh, pool, FLIGHT_MS * 0.5, trail.mesh)).toBe(true);
    expect(head.scale.get(0)).toBeGreaterThan(0);
    for (let j = 0; j < TRAIL.length; j++) expect(trail.scale.get(j), `ghost ${j}`).toBeGreaterThan(0);

    // the head has landed but the wake is still catching up: head hidden, still busy
    expect(step(head.mesh, pool, FLIGHT_MS * 1.05, trail.mesh)).toBe(true);
    expect(head.scale.get(0)).toBe(0);
    expect(pool.flights[0].seg).not.toBeNull();

    // past the wake (1 + the last trail offset): the slot is freed, everything hidden, the loop may stop
    expect(step(head.mesh, pool, FLIGHT_MS * (1 + TRAIL[TRAIL.length - 1] + 0.01), trail.mesh)).toBe(false);
    expect(pool.flights[0].seg).toBeNull();
    expect(head.scale.get(0)).toBe(0);
    for (let j = 0; j < TRAIL.length; j++) expect(trail.scale.get(j), `ghost ${j} hidden`).toBe(0);
    expect(trail.mesh.instanceMatrix.needsUpdate).toBe(true);

    // idle afterwards: nothing is written and nothing is busy
    head.set.mockClear();
    expect(step(head.mesh, pool, FLIGHT_MS * 5, trail.mesh)).toBe(false);
    expect(head.set).not.toHaveBeenCalled();
  });

  it("a flight still waiting for its delay is hidden but keeps the loop running", () => {
    const pool = makePool();
    pool.flights[2] = { seg, kind: "kept", start: 1000 };
    const head = fakeMesh();
    expect(step(head.mesh, pool, 0, null)).toBe(true);
    expect(head.scale.get(2)).toBe(0);
  });
});
