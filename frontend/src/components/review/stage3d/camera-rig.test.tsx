import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ frame: null as null | ((s: unknown, dt: number) => void), invalidate: vi.fn() }));
vi.mock("@react-three/fiber", () => ({
  useFrame: (cb: (s: unknown, dt: number) => void) => { hooks.frame = cb; },
  useThree: (sel: (s: { invalidate: () => void }) => unknown) => sel({ invalidate: hooks.invalidate }),
}));

import { CameraRig } from "./camera-rig";

afterEach(() => { hooks.invalidate.mockReset(); hooks.frame = null; });

function fakeState() {
  const invalidate = vi.fn();
  const position = { set: vi.fn() };
  const lookAt = vi.fn();
  return { state: { camera: { position, lookAt }, invalidate }, invalidate, position, lookAt };
}

describe("CameraRig", () => {
  it("requests frames only while easing, and stops once settled", () => {
    const a = [0, 3, 7, 0, 0, 0];
    const b = [2, 3, 8, 1, 0, 0];
    const { rerender } = render(<CameraRig goal={a} />);
    // the first goal is placed at once: one invalidate from the effect, and the first frame settles without asking for more
    expect(hooks.invalidate).toHaveBeenCalledTimes(1);
    let f = fakeState();
    hooks.frame!(f.state, 0.016);
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(f.position.set).toHaveBeenCalledWith(0, 3, 7);

    // a new goal: the rig eases, asking for another frame each time, until it settles
    rerender(<CameraRig goal={b} />);
    expect(hooks.invalidate).toHaveBeenCalledTimes(2);
    let frames = 0;
    for (; frames < 300; frames++) {
      f = fakeState();
      hooks.frame!(f.state, 0.1);
      if (f.invalidate.mock.calls.length === 0) break;
    }
    expect(frames).toBeGreaterThan(1);
    expect(frames).toBeLessThan(300);
    expect(f.position.set).toHaveBeenLastCalledWith(2, 3, 8); // snapped onto the goal when settled

    // settled: further frames neither move the camera nor request frames
    f = fakeState();
    hooks.frame!(f.state, 0.1);
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(f.position.set).not.toHaveBeenCalled();
    expect(f.lookAt).not.toHaveBeenCalled();
  });
});
