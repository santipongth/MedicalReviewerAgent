/** Longest page / link-preview title, in characters (a topic can be a 600-character question). */
export const TITLE_MAX = 120;

/** The tab title when no topic may or can be shown. */
export const FALLBACK_TITLE = "รายงานทบทวนงานวิจัย";

/**
 * Plan 26: a personal-medical refusal (the code, or the stored error's prefix for a client that has only the text).
 * Its page and title never show the topic: the person's own medical question stays out of the tab, history and previews.
 */
export function isPersonalRefusal(code?: string | null, error?: string | null): boolean {
  return code === "personal_medical" || !!error?.startsWith("personal_medical: ");
}

/** `text` cut to at most `max` characters (code points, so no surrogate pair is split) with "…" when cut. */
export function clampTitle(text: string, max = TITLE_MAX): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}
