"use client";

import { useMemo } from "react";
import { exclusionRows, forestData, prismaStages, studyPoints } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import { reviewTypeOf, showsSection } from "@/lib/review-type";
import type { Paper, ReviewResult } from "@/lib/types";
import { ForestFigure, PrismaFigure, StudyMapFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { SectionHeading } from "./report-nav";
import { L } from "./text";

/**
 * Forest plot and study map (part "forest", in the results), or the PRISMA flow (part "prisma", in the study selection
 * section, whose heading the report supplies), built only from verified values in the (filtered) papers. Which part
 * shows follows the review type; the study map (it draws result directions) goes with the forest plot.
 */
export function Charts({ result, papers, lang, onSelect, part = "forest" }: {
  result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: (ref: string, outcome?: string) => void;
  part?: "forest" | "prisma";
}) {
  const theme = useTheme();
  const type = reviewTypeOf(result);
  const show = showsSection(type, part);
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const forest = useMemo(() => forestData(papers, lang), [papers, lang]);
  const stages = useMemo(() => prismaStages(result.stats, lang), [result.stats, lang]);
  const exclusions = useMemo(() => exclusionRows(result.stats, lang), [result.stats, lang]);
  const map = useMemo(() => studyPoints(papers), [papers]);
  if (!show) return null;
  if (part === "prisma") {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" data-part="prisma">
        {tokens && <PrismaFigure stages={stages} exclusions={exclusions} scoping={type === "scoping"} tokens={tokens} lang={lang} />}
      </div>
    );
  }
  return (
    <section aria-labelledby="h-charts" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      <SectionHeading id="h-charts">{L(lang, "แผนภาพหลักฐาน", "Evidence charts")}</SectionHeading>
      {tokens && (
        <>
          <ForestFigure data={forest} tokens={tokens} lang={lang} onSelect={onSelect} />
          <StudyMapFigure points={map.points} missing={map.missing} tokens={tokens} lang={lang} onSelect={onSelect} />
        </>
      )}
    </section>
  );
}
