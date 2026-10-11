"use client";

import { useMemo } from "react";
import { citationNetwork } from "@/lib/citation-network";
import type { Lang } from "@/lib/i18n";
import { RC } from "@/lib/i18n-report";
import type { Citations, Paper } from "@/lib/types";
import { CitationNetworkFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { Term } from "../ui/term";
import { SectionHeading } from "./report-nav";
import { L } from "./text";

const C = RC.network;

/**
 * Citation network section: which (filtered) papers of this review cite each other, from OpenAlex / Europe PMC
 * metadata. With no reference data and no counts at all, it says so instead of drawing an empty network; with counts
 * but no reference lists, it still draws every paper (all hollow) and the table twin. Offline-safe.
 */
export function CitationNetworkSection({ citations, papers, lang, onSelect }: {
  citations: Citations; papers: Paper[]; lang: Lang; onSelect: (ref: string) => void;
}) {
  const theme = useTheme();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const net = useMemo(() => citationNetwork(papers, citations, lang), [papers, citations, lang]);
  return (
    <section aria-labelledby="h-citations" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <SectionHeading id="h-citations">{L(lang, C.h)}</SectionHeading>
      <p className="max-w-[65ch] text-[0.9rem] text-muted">
        {L(lang, C.which)}{" "}
        <Term k="citationNetwork" lang={lang}>{L(lang, C.citeEachOther)}</Term>
        {L(lang, C.fromMetadata)}
      </p>
      {net.total === 0 ? (
        <p className="text-[0.9rem] text-muted">{L(lang, C.noMatch)}</p>
      ) : net.covered === 0 && net.nodes.every((n) => n.citedBy == null) ? (
        <p className="rounded-sm bg-info-bg p-3 text-[0.9rem]">
          <b className="font-display font-semibold">{L(lang, C.noData)}</b>
          {" · "}{L(lang, C.noDataNotNone)}
          {net.partial && <> · {L(lang, C.timedOut)}</>}
        </p>
      ) : tokens && <CitationNetworkFigure net={net} tokens={tokens} lang={lang} onSelect={onSelect} />}
    </section>
  );
}
