let cached: boolean | undefined;

/** True when the browser can create a WebGL2 or WebGL context. Guarded for SSR; the result is cached. */
export function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  if (cached !== undefined) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    cached = !!gl;
    try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* release the probe context, best effort */ }
  } catch {
    cached = false;
  }
  return cached;
}

/** Test seam: forget the cached answer. */
export function resetWebGLCache(): void {
  cached = undefined;
}
