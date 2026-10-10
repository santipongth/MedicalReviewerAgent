import type { ReactNode } from "react";
import { glossParts, type GlossKey, type GlossOptions } from "@/lib/glossary";
import type { Lang } from "@/lib/i18n";

/**
 * A jargon word with its plain meaning in brackets, always visible: "RCT (การทดลองแบบสุ่มและมีกลุ่มควบคุม)". Plain text,
 * nothing to hover or open, so it reads the same on touch, keyboard and screen readers. The short term never breaks
 * across lines (`nw`), so a Thai or English word is never split; the bracket text wraps at Thai word boundaries.
 * `children` re-words the term for this page ("REST API", "GRADE-lite"); `suffix` qualifies the meaning ("แบบย่อ").
 * The report's tap-to-open terms are `Term`.
 */
export function Gloss({ k, lang = "th", full, named, suffix, children }: {
  k: GlossKey; lang?: Lang; children?: ReactNode;
} & Omit<GlossOptions, "term">) {
  const { term, meaning } = glossParts(k, lang, { full, named, suffix });
  return (
    <span data-gloss={k}>
      <span className="nw">{children ?? term}</span> ({meaning})
    </span>
  );
}
