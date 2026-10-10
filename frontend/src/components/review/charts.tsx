"use client";

import { useMemo } from "react";
import { forestData, studyPoints } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import { reviewTypeOf, showsSection } from "@/lib/review-type";
import type { Paper, ReviewResult } from "@/lib/types";
import { ForestFigure, StudyMapFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { SectionHeading } from "./report-nav";
import { L } from "./text";

/**
 * Forest plot and study map (in the results), built only from verified values in the (filtered) papers; shown where
 * the review type has a forest plot. The study selection flow is PrismaFlow (Plan 20 Task 4), not a chart.
 */
export function Charts({ result, papers, lang, onSelect }: {
  result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: (ref: string, outcome?: string) => void;
}) {
  const theme = useTheme();
  const type = reviewTypeOf(result);
  const show = showsSection(type, "forest");
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const forest = useMemo(() => forestData(papers, lang), [papers, lang]);
  const map = useMemo(() => studyPoints(papers), [papers]);
  if (!show) return null;
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
