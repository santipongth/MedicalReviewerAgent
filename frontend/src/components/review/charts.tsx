"use client";

import { useMemo } from "react";
import { exclusionRows, forestData, prismaStages, studyPoints } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import { reviewTypeOf, showsSection } from "@/lib/review-type";
import type { Paper, ReviewResult } from "@/lib/types";
import { ForestFigure, PrismaFigure, StudyMapFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

/**
 * Forest plot, PRISMA flow and study map, built only from verified values in the (filtered) papers.
 * Which of them show follows the review type; the study map (it draws result directions) goes with the forest plot.
 */
export function Charts({ result, papers, lang, onSelect }: {
  result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: (ref: string, outcome?: string) => void;
}) {
  const theme = useTheme();
  const type = reviewTypeOf(result);
  const showForest = showsSection(type, "forest");
  const showPrisma = showsSection(type, "prisma");
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const forest = useMemo(() => forestData(papers, lang), [papers, lang]);
  const stages = useMemo(() => prismaStages(result.stats, lang), [result.stats, lang]);
  const exclusions = useMemo(() => exclusionRows(result.stats, lang), [result.stats, lang]);
  const map = useMemo(() => studyPoints(papers), [papers]);
  if (!showForest && !showPrisma) return null;
  return (
    <section aria-labelledby="h-charts" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      <h2 id="h-charts" className={SECTION_H2}>{L(lang, "แผนภาพหลักฐาน", "Evidence charts")}</h2>
      {tokens && (
        <>
          {showForest && <ForestFigure data={forest} tokens={tokens} lang={lang} onSelect={onSelect} />}
          <div className={`grid gap-8 ${showForest && showPrisma ? "xl:grid-cols-2" : ""}`}>
            {showForest && <StudyMapFigure points={map.points} missing={map.missing} tokens={tokens} lang={lang} onSelect={onSelect} />}
            {showPrisma && <PrismaFigure stages={stages} exclusions={exclusions} scoping={type === "scoping"} tokens={tokens} lang={lang} />}
          </div>
        </>
      )}
    </section>
  );
}
