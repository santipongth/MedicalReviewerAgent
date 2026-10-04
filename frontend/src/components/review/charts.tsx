"use client";

import { useMemo } from "react";
import { forestData, prismaStages, studyPoints } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import type { Paper, ReviewResult } from "@/lib/types";
import { ForestFigure, PrismaFigure, StudyMapFigure } from "../charts/figures";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { MatrixLegend } from "./report-parts";
import { L } from "./text";

/** Forest plot, PRISMA flow and study map, built only from verified values in the (filtered) papers. */
export function Charts({ result, papers, lang, onSelect }: {
  result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: (ref: string, outcome?: string) => void;
}) {
  const theme = useTheme();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const forest = useMemo(() => forestData(papers, lang), [papers, lang]);
  const stages = useMemo(() => prismaStages(result.stats, lang), [result.stats, lang]);
  const map = useMemo(() => studyPoints(papers), [papers]);
  if (!tokens) return null;
  return (
    <section aria-labelledby="h-charts" className="grid gap-8">
      <div>
        <h2 id="h-charts" className="text-lg font-semibold">{L(lang, "แผนภาพหลักฐาน", "Evidence charts")}</h2>
        <MatrixLegend lang={lang} />
      </div>
      <ForestFigure data={forest} tokens={tokens} lang={lang} onSelect={onSelect} />
      <div className="grid gap-8 xl:grid-cols-2">
        <StudyMapFigure points={map.points} missing={map.missing} tokens={tokens} lang={lang} onSelect={onSelect} />
        <PrismaFigure stages={stages} tokens={tokens} lang={lang} />
      </div>
    </section>
  );
}
