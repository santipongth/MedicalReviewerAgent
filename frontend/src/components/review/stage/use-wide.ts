"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 768px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** True at >= 768px (horizontal lane). Server and first hydration render are `false` (narrow). */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
