"use client";

import { useMemo } from "react";
import type { ConceptTree } from "@/lib/concept-map";
import type { Lang } from "@/lib/i18n";
import { ConceptMapFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

/** Concept map section: a tree of the question, its outcomes and the papers that report them. Offline-safe. */
export function ConceptMapSection({ tree, lang, onSelect }: { tree: ConceptTree; lang: Lang; onSelect: (ref: string) => void }) {
  const theme = useTheme();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  return (
    <section aria-labelledby="h-map" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="h-map" className={SECTION_H2}>{L(lang, "แผนที่ความรู้", "Concept map")}</h2>
      {tokens && <ConceptMapFigure tree={tree} tokens={tokens} lang={lang} onSelect={onSelect} />}
    </section>
  );
}
