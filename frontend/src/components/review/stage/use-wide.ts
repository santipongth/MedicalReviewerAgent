"use client";
import { useSyncExternalStore } from "react";

/** Same as DESIGN.md's rail/drawer breakpoint (Tailwind `lg`); the wide 960px viewBox then renders at >= ~0.96 scale. */
export const WIDE_QUERY = "(min-width: 1024px)";
const QUERY = WIDE_QUERY;

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** True at >= 1024px (horizontal lane). Server and first hydration render are `false` (narrow). */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
