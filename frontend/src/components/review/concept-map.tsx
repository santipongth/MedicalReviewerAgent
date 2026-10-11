"use client";

import { useMemo } from "react";
import type { ConceptTree } from "@/lib/concept-map";
import type { Lang } from "@/lib/i18n";
import { RC } from "@/lib/i18n-report";
import { ConceptMapFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { SectionHeading } from "./report-nav";
import { useWide } from "./stage/use-wide";
import { L } from "./text";

/**
 * Concept map section: a tree of the question, its outcomes and the papers that report them. Below 1024px it opens as
 * the outline (the tree is unreadable on a phone), with a toggle to the chart. Offline-safe.
 */
export function ConceptMapSection({ tree, lang, onSelect }: { tree: ConceptTree; lang: Lang; onSelect: (ref: string) => void }) {
  const theme = useTheme();
  const wide = useWide();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  return (
    <section aria-labelledby="h-map" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <SectionHeading id="h-map">{L(lang, RC.network.conceptMap)}</SectionHeading>
      {tokens && <ConceptMapFigure tree={tree} tokens={tokens} lang={lang} onSelect={onSelect} wide={wide} />}
    </section>
  );
}
