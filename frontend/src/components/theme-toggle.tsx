"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("themechange", onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("themechange", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** The active theme for client components (charts read colors from it). Null during server rendering. */
export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, currentTheme, () => null);
}

/** Switches between Day theatre (light) and Night shift (dark); the choice persists per browser. */
export function ThemeToggle() {
  const theme = useTheme();

  useLayoutEffect(() => {
    // Re-apply after Strict Mode remounts in development (Next docs: preventing flash before hydration).
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
    } catch {}
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    window.dispatchEvent(new Event("themechange"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-sm border border-rule px-3 py-1 font-display text-sm font-semibold text-ink hover:border-ink"
      aria-label={theme === "dark" ? "ใช้ธีมสว่าง" : "ใช้ธีมมืด"}
    >
      {theme === "dark" ? "ธีมสว่าง" : "ธีมมืด"}
    </button>
  );
}
