"use client";

import { useSyncExternalStore } from "react";
import type { Lang } from "./i18n";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
}

const current = (): Lang => (document.documentElement.lang === "en" ? "en" : "th");

/**
 * The page language for the site chrome (header, footer): `<html lang>`, which a report sets to the language it shows
 * (Plan 20 Task 7) and the root layout serves as Thai. Thai while rendering on the server.
 */
export function useDocLang(): Lang {
  return useSyncExternalStore(subscribe, current, () => "th");
}
