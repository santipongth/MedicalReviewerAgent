"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Publishes the site header's height as `--header-h` on <html>, so sticky report parts (section nav, source rail)
 * sit right under it and anchor jumps clear it. Below `md` the header wraps to two rows; a ResizeObserver keeps the
 * value right as it wraps. globals.css holds a fallback for the first paint.
 */
export function HeaderHeight() {
  const probe = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const header = probe.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--header-h", `${header.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    ro?.observe(header);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);
  return <span ref={probe} hidden />;
}
