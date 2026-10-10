// Viewport stubs for component tests (jsdom has no layout): `(min-width: 1024px)` decides the desktop layouts
// (useWide: literature-matrix table vs cards, concept map chart vs outline).
import { afterEach, beforeEach, vi } from "vitest";

export function stubViewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 1024px") ? wide : query.includes("max-width") ? !wide : false,
    media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {},
    removeListener: () => {}, dispatchEvent: () => false,
  }));
}

/** Every test in the calling file (or describe block) renders at desktop width. */
export function desktopViewport() {
  beforeEach(() => stubViewport(true));
  afterEach(() => vi.unstubAllGlobals());
}
