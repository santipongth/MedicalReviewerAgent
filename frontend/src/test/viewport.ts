// Viewport stubs for component tests (jsdom has no layout): media queries are answered for a given viewport width, so
// `(min-width: 1024px)` (useWide: concept map chart vs outline) and `(min-width: 1280px)` (literature-matrix table vs
// cards) follow it.
import { afterEach, beforeEach, vi } from "vitest";

/** `wide` true = a 1440px desktop, false = a 390px phone; or pass a width. */
export function stubViewport(wide: boolean | number) {
  const width = typeof wide === "number" ? wide : wide ? 1440 : 390;
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : max ? width <= Number(max[1]) : false;
    return {
      matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {},
      removeListener: () => {}, dispatchEvent: () => false,
    };
  });
}

/** Every test in the calling file (or describe block) renders at desktop width (1440px). */
export function desktopViewport() {
  beforeEach(() => stubViewport(true));
  afterEach(() => vi.unstubAllGlobals());
}
