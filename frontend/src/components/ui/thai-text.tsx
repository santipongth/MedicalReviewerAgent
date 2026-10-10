import { Fragment, type ReactNode } from "react";
import { hasThai, thaiChunks } from "@/lib/text-wrap";

/** A chunk with its Thai words kept whole (`nw`) and its spaces left as ordinary break points. */
function chunk(text: string): ReactNode {
  return text.split(/(\s+)/).filter(Boolean).map((t, i) => (hasThai(t) ? <span key={i} className="nw">{t}</span> : t));
}

/**
 * Thai text that wraps only between words (Plan 20 Task 7). Each Thai word (lib/text-wrap.ts `thaiChunks`:
 * Intl.Segmenter word boundaries, never inside THAI_KEEP_WHOLE words or before a dictionary fragment) is kept whole and
 * a <wbr> sits between words. Chromium's own Thai line breaker cuts inside words (ยาหล|อก) and ignores
 * `word-break: keep-all` for Thai (checked 2026-10-11), so the words themselves do not wrap; the `th-seg` span still
 * carries `line-break: strict; word-break: keep-all` for engines that honour them. English text, or an engine without
 * Intl.Segmenter, renders as it is. Offline-safe (no next/* imports).
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
