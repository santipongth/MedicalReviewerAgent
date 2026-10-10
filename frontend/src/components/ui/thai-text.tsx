import { Fragment, type ReactNode } from "react";
import { hasThai, thaiChunks } from "@/lib/text-wrap";

/**
 * The longest run (in code points, Thai marks included) kept on one line: about 12 visible Thai letters, which fits the
 * narrowest report cell at its size. A longer run is no single word (an unknown loanword glued by the fragment rules,
 * say), so it stays plain text that may break as a last resort instead of overflowing.
 */
export const THAI_WORD_MAX = 16;

/** A chunk with its Thai words kept whole (`th-w`) and its spaces left as ordinary break points. */
function chunk(text: string): ReactNode {
  return text.split(/(\s+)/).filter(Boolean)
    .map((t, i) => (hasThai(t) && [...t].length <= THAI_WORD_MAX ? <span key={i} className="th-w">{t}</span> : t));
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
