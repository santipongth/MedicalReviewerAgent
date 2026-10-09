import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWebGL, resetWebGLCache } from "./webgl";

afterEach(() => { vi.restoreAllMocks(); resetWebGLCache(); });

function stub(impl: (kind: string) => unknown) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((k: string) => impl(k)) as never);
}

describe("hasWebGL", () => {
  it("is true when webgl2 exists", () => {
    stub((k) => (k === "webgl2" ? {} : null));
    expect(hasWebGL()).toBe(true);
  });
  it("falls back to webgl", () => {
    stub((k) => (k === "webgl" ? {} : null));
    expect(hasWebGL()).toBe(true);
  });
  it("is false with no context or a throwing canvas", () => {
    stub(() => null);
    expect(hasWebGL()).toBe(false);
    resetWebGLCache();
    stub(() => { throw new Error("x"); });
    expect(hasWebGL()).toBe(false);
  });
  it("caches the answer", () => {
    const spy = stub(() => ({}));
    hasWebGL(); hasWebGL();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
