"use client";

import { useMemo } from "react";
import { citationNetwork } from "@/lib/citation-network";
import type { Lang } from "@/lib/i18n";
import type { Citations, Paper } from "@/lib/types";
import { CitationNetworkFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { Term } from "../ui/term";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

/**
 * Citation network section: which (filtered) papers of this review cite each other, from OpenAlex / Europe PMC
 * metadata. With no reference data for any paper, it says so instead of drawing an empty network. Offline-safe.
 */
export function CitationNetworkSection({ citations, papers, lang, onSelect }: {
  citations: Citations; papers: Paper[]; lang: Lang; onSelect: (ref: string) => void;
}) {
  const theme = useTheme();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const net = useMemo(() => citationNetwork(papers, citations, lang), [papers, citations, lang]);
  return (
    <section aria-labelledby="h-citations" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="h-citations" className={SECTION_H2}>{L(lang, "เครือข่ายการอ้างอิง", "Citation network")}</h2>
      <p className="max-w-[65ch] text-[0.9rem] text-muted">
        {L(lang, "งานใดในรีวิวนี้", "Which studies in this review")}{" "}
        <Term k="citationNetwork" lang={lang}>{L(lang, "อ้างอิงกัน", "cite each other")}</Term>
        {L(lang, " จากข้อมูลบรรณานุกรม (ไม่ใช่เนื้อหาของงาน)", ", from bibliographic metadata (not the papers' content)")}
      </p>
      {net.total === 0 ? (
        <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีงานวิจัยที่ตรงกับตัวกรอง", "No studies match the filters")}</p>
      ) : net.covered === 0 ? (
        <p className="rounded-sm bg-info-bg p-3 text-[0.9rem]">
          <b className="font-display font-semibold">{L(lang, "ไม่มีข้อมูลการอ้างอิงสำหรับงานในรีวิวนี้", "No citation data for the studies in this review")}</b>
          {" · "}{L(lang, "ไม่มีข้อมูล ≠ ไม่อ้างอิง", "No data ≠ cites nothing")}
          {net.partial && <> · {L(lang, "การดึงข้อมูลหมดเวลา", "the lookup timed out")}</>}
        </p>
      ) : tokens && <CitationNetworkFigure net={net} tokens={tokens} lang={lang} onSelect={onSelect} />}
    </section>
  );
}
