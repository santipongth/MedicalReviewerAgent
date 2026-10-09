"use client";
// Colours for the 3D stage, read from the same CSS custom properties as the 2D stage (globals.css), so status colours
// and the theme stay one source of truth. Read once on mount and again whenever the theme changes.
import { useMemo, useSyncExternalStore } from "react";

export type Token3D =
  | "primary" | "ink" | "rule" | "muted" | "ok" | "err" | "warn" | "surface" | "rail"
  | "sup" | "harm" | "none" | "mixed" | "unclear"; // finding colours: always drawn with their glyph silhouette
export type Tokens3D = Record<Token3D, string>;

export const TOKEN_NAMES: readonly Token3D[] = [
  "primary", "ink", "rule", "muted", "ok", "err", "warn", "surface", "rail", "sup", "harm", "none", "mixed", "unclear",
];

/** Day-theatre values from globals.css; used only when a property is missing or unparsable. */
export const TOKEN_FALLBACK: Tokens3D = {
  primary: "#0e5a47", ink: "#10241e", rule: "#bccac1", muted: "#4a5e57",
  ok: "#0e5a47", err: "#a33a12", warn: "#8a5a00", surface: "#f8faf9", rail: "#dce6e0",
  sup: "#0072b2", harm: "#d55e00", none: "#5f6b73", mixed: "#8e3b7e", unclear: "#5f6b73",
};

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** Normalises a computed CSS colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`) to `#rrggbb`; null otherwise. */
export function parseCssColor(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${m[1][0]}${m[1][0]}${m[1][1]}${m[1][1]}${m[1][2]}${m[1][2]}`;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.%]+\s*)?\)$/.exec(v);
  if (m) return `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
  return null;
}

/** Builds the token set from a property reader (`--name` -> raw value); unparsable values fall back. */
export function tokens3dFrom(get: (prop: string) => string | null | undefined): Tokens3D {
  const out = { ...TOKEN_FALLBACK };
  for (const k of TOKEN_NAMES) out[k] = parseCssColor(get(`--${k}`)) ?? TOKEN_FALLBACK[k];
  return out;
}

export function readTokens3D(): Tokens3D {
  if (typeof document === "undefined") return TOKEN_FALLBACK;
  const css = getComputedStyle(document.documentElement);
  return tokens3dFrom((p) => css.getPropertyValue(p));
}

// --- theme subscription: data-theme on <html>, the toggle's `themechange` event and prefers-color-scheme ----------

const DARK_QUERY = "(prefers-color-scheme: dark)";

function themeKey(): string {
  const attr = document.documentElement.getAttribute("data-theme") ?? "";
  const dark = typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  return `${attr}|${dark ? "dark" : "light"}`;
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  const obs = typeof MutationObserver === "function" ? new MutationObserver(cb) : null;
  obs?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("themechange", cb);
  media?.addEventListener("change", cb);
  return () => {
    obs?.disconnect();
    window.removeEventListener("themechange", cb);
    media?.removeEventListener("change", cb);
  };
}

/** Current token colours; re-read only when the theme key changes. */
export function useTokens3D(): Tokens3D {
  const key = useSyncExternalStore(subscribe, themeKey, () => "");
  return useMemo(() => (key ? readTokens3D() : TOKEN_FALLBACK), [key]);
}
