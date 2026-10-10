"use client";
import { useSyncExternalStore } from "react";

/** True when the viewport is at least `px` wide (a `(min-width)` media query). Server and hydration render: false. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
