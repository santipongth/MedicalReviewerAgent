import { Children, cloneElement, Fragment, isValidElement, type ReactNode } from "react";
import { hasThai, thaiChunks } from "@/lib/text-wrap";

/**
 * The longest run (in code points, Thai marks included) kept on one line: about 12 visible Thai letters, which fits the
 * narrowest report cell at its size. A longer run is no single word (an unknown loanword glued by the fragment rules,
 * say), so it stays plain text that may break as a last resort instead of overflowing.
 */
export const THAI_WORD_MAX = 16;

/**
 * The longest run with a digit kept on one line ("0.83", "(0.71–0.97)", "COVID-19", "1,234"): longer (a URL) stays
 * breakable so it never overflows; its number runs are still kept whole.
 */
export const LATIN_RUN_MAX = 24;
/** A number, a range or a percentage ("0.77–0.96", "1,234", "−0.5", "12.5%"). */
const NUMBER_RUN = /[−-]?\d[\d.,]*(?:[–—-][−-]?\d[\d.,]*)?%?/g;

/** A long run that may break: its numbers are still kept whole (`th-n`). */
function numbersWhole(t: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of t.matchAll(NUMBER_RUN)) {
    if (m.index > at) parts.push(t.slice(at, m.index));
    parts.push(<span key={parts.length} className="th-n">{m[0]}</span>);
    at = m.index + m[0].length;
  }
  if (!parts.length) return t;
  if (at < t.length) parts.push(t.slice(at));
  return <Fragment key={key}>{parts}</Fragment>;
}

/**
 * A chunk with its Thai words kept whole (`th-w`), each token with a digit kept whole (`th-n`: under the root's
 * `overflow-wrap: anywhere` an unwrapped "0.77–0.96" could break inside, Task 9) and its spaces left as break points.
 */
function chunk(text: string): ReactNode {
  return text.split(/(\s+)/).filter(Boolean).map((t, i) => {
    if (/^\s+$/.test(t)) return t;
    const n = [...t].length;
    if (hasThai(t)) return n <= THAI_WORD_MAX ? <span key={i} className="th-w">{t}</span> : numbersWhole(t, i);
    // only a run with a digit is kept on one line ("0.77–0.96", "COVID-19"): a plain Latin word stays wrappable, so a
    // narrow clamped cell can still break it rather than clip it (fix round 1)
    if (!/\d/.test(t)) return t;
    return n <= LATIN_RUN_MAX ? <span key={i} className="th-n">{t}</span> : numbersWhole(t, i);
  });
}

/**
 * Thai text that wraps only between words (Plan 20 Task 7). Each Thai word (lib/text-wrap.ts `thaiChunks`:
 * Intl.Segmenter word boundaries and punctuation next to Thai, never inside THAI_KEEP_WHOLE words or before a dictionary
 * fragment) is a nowrap `th-w` span with a <wbr> between words. Chromium's own Thai line breaker cuts inside words
 * (ยาหล|อก) and ignores `word-break: keep-all` for Thai (checked 2026-10-11). A run longer than THAI_WORD_MAX is left
 * wrappable (the root has `overflow-wrap: anywhere`), so nothing overflows. Spans stay inline: an inline-block word
 * would put spaces into a heading's accessible name in Chromium.
 * English text, or an engine without Intl.Segmenter, renders as it is. Offline-safe (no next/* imports).
 */
export function ThaiText({ children }: { children: string | null | undefined }) {
  const text = children ?? "";
  const chunks = thaiChunks(text);
  if (chunks.length < 2) return <>{text}</>;
  return (
    <span className="th-seg">
      {chunks.map((c, i) => <Fragment key={i}>{i > 0 && <wbr />}{chunk(c)}</Fragment>)}
    </span>
  );
}

/**
 * Mixed content (strings, fragments and plain HTML elements, such as a limitation line with a code span or a bold
 * label) with every string segmented by ThaiText; components are left as they are (Task 9: Chromium cut ตีพิมพ์ and ตัวอักษร in list prose).
 */
export function ThaiNodes({ children }: { children: ReactNode }): ReactNode {
  return Children.map(children, (c) => {
    if (typeof c === "string") return <ThaiText>{c}</ThaiText>;
    if (!isValidElement<{ children?: ReactNode }>(c) || c.props.children == null) return c;
    if (c.type === Fragment) return <ThaiNodes>{c.props.children}</ThaiNodes>;
    // a plain HTML element (<b>, <span>): its own text too; components keep their own rendering
    return typeof c.type === "string" ? cloneElement(c, undefined, <ThaiNodes>{c.props.children}</ThaiNodes>) : c;
  });
}
