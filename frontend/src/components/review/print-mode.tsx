"use client";

import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { forceLightTheme, openAllDetails } from "@/lib/print";

/**
 * True while the browser prints the report (Plan 20 Task 8): between `beforeprint` and `afterprint`. Components that
 * lay out with JS read it: the literature matrix prints every row as one table (not cards, not a page of 15), the
 * summary of findings stays a table at paper width, charts redraw at a fixed print width with no animation.
 * Everything CSS can do is in the `@media print` block of globals.css.
 */
export const PrintMode = createContext(false);

export function usePrinting(): boolean {
  return useContext(PrintMode);
}

/**
 * Wires print mode for the report under `root`. Before printing: the light theme (charts re-read their colours), a
 * synchronous re-render in print mode (the browser lays the page out for print right after the event), then every
 * disclosure opened. After printing: disclosures, theme and layout back as the reader left them.
 */
export function usePrintSetup(root: RefObject<HTMLElement | null>): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    let restore: (() => void) | null = null;
    const before = () => {
      if (restore) return;
      const theme = forceLightTheme(document.documentElement);
      flushSync(() => setPrinting(true));
      const details = openAllDetails(root.current ?? document);
      restore = () => {
        details();
        theme();
      };
    };
    const after = () => {
      if (!restore) return;
      const undo = restore;
      restore = null;
      undo();
      setPrinting(false);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      restore?.();
    };
  }, [root]);
  return printing;
}
