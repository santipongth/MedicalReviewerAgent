// Word-boundary wrapping for chart labels (Plan 20 Task 5). Thai has no spaces between words, so a label is split with
// Intl.Segmenter (word granularity) when the engine has it; without it only whitespace breaks a line, and a Thai run
// stays whole. A line never breaks inside a word or a grapheme cluster (a vowel or tone mark stays with its consonant).

const chars = (s: string) => [...s].length;

/** `text` cut at word boundaries: words and the spaces/punctuation between them, in order (joined, they are `text`). */
export function wordSegments(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)].map((s) => s.segment);
  }
  return text.split(/(\s+)/).filter((s) => s.length > 0);
}

/**
 * Lines of at most `max` characters, broken only between words. A word longer than `max` keeps its own line whole
 * (never cut mid-word); spaces at a break are dropped.
 */
export function wrapLabel(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const seg of wordSegments(text.trim())) {
    if (!seg.trim()) {
      if (line) line += seg;
      continue;
    }
    if (line.trim() && chars(line + seg) > max) {
      lines.push(line.trimEnd());
      line = seg;
    } else {
      line += seg;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** At most `maxLines` wrapped lines of `max` characters; when cut, the last kept word is followed by "…". */
export function clampLabel(text: string, max: number, maxLines: number): { text: string; truncated: boolean } {
  const lines = wrapLabel(text, max);
  if (lines.length <= maxLines) return { text: text.trim(), truncated: false };
  return { text: `${joinLines(lines.slice(0, maxLines), text).trimEnd()}…`, truncated: true };
}

/** Lines joined back the way they were split: with a space where the source had one, directly where it had none (Thai). */
function joinLines(lines: string[], source: string): string {
  let out = "";
  let at = 0;
  const src = source.trim();
  for (const l of lines) {
    const i = src.indexOf(l, at);
    if (out && i > at) out += " ";
    out += l;
    at = i >= 0 ? i + l.length : at;
  }
  return out;
}
