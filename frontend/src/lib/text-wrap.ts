// Word-boundary wrapping for chart labels (Plan 20 Task 5) and Thai line-break opportunities for DOM text (Task 7, used
// by components/ui/thai-text.tsx). Thai has no spaces between words, so text is split with Intl.Segmenter('th', word)
// when the engine has it; without it only whitespace breaks a line, and a Thai run stays whole. A line never breaks
// inside a word or a grapheme cluster (a vowel or tone mark stays with its consonant).

const chars = (s: string) => [...s].length;

const THAI = /[฀-๿]/;
/** A Thai letter or mark: not ฯ, ๆ, ๏, the digits or the baht sign (nothing may break before ๆ or ฯ). */
const THAI_LETTER = /[ก-ฮะ-ฺเ-ๅ็-๎]/;

export function hasThai(text: string | null | undefined): boolean {
  return !!text && THAI.test(text);
}

let cached: Intl.Segmenter | null = null;
/** One Thai word segmenter for the page (built on first use); null where the engine has no Intl.Segmenter. */
function segmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
  cached ??= new Intl.Segmenter("th", { granularity: "word" });
  return cached;
}

/** `text` cut at word boundaries: words and the spaces/punctuation between them, in order (joined, they are `text`). */
export function wordSegments(text: string): string[] {
  const seg = segmenter();
  if (seg) return [...seg.segment(text)].map((s) => s.segment);
  return text.split(/(\s+)/).filter((s) => s.length > 0);
}

/**
 * Report words the Thai dictionary splits but a reader sees as one word (ICU: อภิ|มาน, ยา|หลอก, เมต|ฟอร์มิ|น): never
 * broken inside. Loanwords outside the dictionary are mostly caught by the fragment rules in thaiChunks.
 */
export const THAI_KEEP_WHOLE = [
  "ยาหลอก", "อภิมาน", "อุบัติการณ์", "ปฐมภูมิ", "ทุติยภูมิ", "สหสัมพันธ์", "ออดส์", "เอเจนต์", "พรอมต์", "เมตฟอร์มิน",
  "ซัลโฟนิลยูเรีย", "เบาหวาน", "ผสมผสาน", "ภาคตัดขวาง", "คัดกรอง", "ฟันเนล",
  // Task 9 (screenshot review): split at a line end in the selection flow, the SoF notes and the certainty labels
  "หลักฐาน", "ตัวอักษร", "การศึกษา", "ความเชื่อมั่น",
  // fix round 1: ICU ends a word after a bound prefix (ผู้|เชี่ยวชาญ, ตี|พิมพ์, ตัว|วัด), which strands a non-word at a
  // line end; found by scanning the report copy and fixtures (breaks after การ/ความ are ordinary Thai and stay)
  "ตีพิมพ์", "ตีตรา", "ผู้ใช้", "ผู้ป่วย", "ผู้เชี่ยวชาญ", "ผู้เข้าร่วม", "ผู้ทบทวน", "ตัววัด",
];

/** A dictionary fragment that cannot start a word: a lone consonant (มิ|น) or a silenced final (ออด|ส์, เอเจน|ต์). */
function isFragment(seg: string): boolean {
  return /^[ก-ฮ]$/.test(seg) || /^[ก-ฮ][ั-ฺ็-๋]?์$/.test(seg);
}

/**
 * `text` in word segments with every kept word as one segment, and the text between kept words segmented on its own:
 * ICU's own segment can straddle a kept word's end (เมตฟอร์มิ|นร่ว|มกับ), which cut the next word (Task 9).
 */
function keptSegments(text: string, kept: [number, number][]): string[] {
  const spans = [...kept].sort((a, b) => a[0] - b[0] || b[1] - a[1])
    .filter((s, i, all) => !all.slice(0, i).some((o) => s[0] < o[1] && s[1] > o[0])); // first and longest wins
  const out: string[] = [];
  let at = 0;
  for (const [a, b] of spans) {
    if (a > at) out.push(...wordSegments(text.slice(at, a)));
    out.push(text.slice(a, b));
    at = b;
  }
  if (at < text.length) out.push(...wordSegments(text.slice(at)));
  return out;
}

/** Punctuation a line may break after (a slash or dash joining two Thai words, a comma, a closing bracket). */
const BREAK_AFTER = /[/–—,)-]/;

/**
 * Thai text in pieces that may each start a new line (Plan 20 Task 7): a break opportunity where two Thai words meet
 * (Thai has no spaces between words), and after / – — - , ) or before ( when a Thai letter is next to it (fix round 1:
 * "ยา/ยาหลอก" must not become one unbreakable run); never inside a THAI_KEEP_WHOLE word or before a dictionary fragment.
 * Spaces already break, and Latin words and numbers stay whole ("COVID-19", "0.77–0.96"). Without Intl.Segmenter, or
 * for text with no Thai, one piece (the text unchanged).
 */
export function thaiChunks(text: string): string[] {
  if (!hasThai(text) || !segmenter()) return [text];
  const kept: [number, number][] = [];
  for (const w of THAI_KEEP_WHOLE) {
    for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) kept.push([i, i + w.length]);
  }
  const thai = (i: number) => i >= 0 && i < text.length && THAI_LETTER.test(text[i]);
  const chunks: string[] = [];
  let cur = "";
  let at = 0;
  for (const seg of keptSegments(text, kept)) {
    const inside = kept.some(([a, b]) => at > a && at < b);
    const a = text[at - 1] ?? "";
    const b = text[at] ?? "";
    const words = thai(at - 1) && thai(at) && !isFragment(seg);
    const after = BREAK_AFTER.test(a) && !/\s/.test(b) && (thai(at - 2) || thai(at));
    const before = b === "(" && !/\s/.test(a) && (thai(at - 1) || thai(at + 1));
    if (cur && !inside && (words || after || before)) {
      chunks.push(cur);
      cur = seg;
    } else {
      cur += seg;
    }
    at += seg.length;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Lines of at most `max` characters, broken only between words. A word longer than `max` keeps its own line whole
 * (never cut mid-word); spaces at a break are dropped.
 */
export function wrapLabel(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  // the same break opportunities as ThaiText (Task 7): Thai word boundaries (thaiChunks) and spaces
  const units = thaiChunks(text.trim()).flatMap((c) => c.split(/(\s+)/)).filter((s) => s.length > 0);
  for (const seg of units) {
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
