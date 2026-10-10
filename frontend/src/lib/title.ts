/** Longest page / link-preview title, in characters (a topic can be a 600-character question). */
export const TITLE_MAX = 120;

/** `text` cut to at most `max` characters (code points, so no surrogate pair is split) with "…" when cut. */
export function clampTitle(text: string, max = TITLE_MAX): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}
