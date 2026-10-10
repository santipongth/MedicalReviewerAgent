import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, effectiveView, isStageView, parseStageView } from "./stage-view-pref";

describe("stage view preference", () => {
  it("defaults to the team view", () => {
    expect(DEFAULT_VIEW).toBe("team");
    expect(parseStageView(null, null)).toBe("team");
  });

  it("reads a stored view", () => {
    expect(parseStageView("steps", null)).toBe("steps");
    expect(parseStageView("3d", null)).toBe("3d");
    expect(parseStageView("team", "1")).toBe("team"); // the new key wins over the legacy flag
  });

  it("migrates the legacy 3D flag", () => {
    expect(parseStageView(null, "1")).toBe("3d");
    expect(parseStageView(null, "0")).toBe("team");
    expect(parseStageView("garbage", "1")).toBe("3d");
  });

  it("ignores unknown values", () => {
    expect(isStageView("2d")).toBe(false);
    expect(isStageView(3)).toBe(false);
    expect(parseStageView("2d", null)).toBe("team");
  });

  it("shows 3D only where it is offered", () => {
    expect(effectiveView("3d", true)).toBe("3d");
    expect(effectiveView("3d", false)).toBe("team");
    expect(effectiveView("steps", false)).toBe("steps");
    expect(effectiveView("team", true)).toBe("team");
  });
});
