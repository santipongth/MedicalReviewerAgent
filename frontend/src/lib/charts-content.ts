// What the results' charts hold (Plan 20 Task 5). Pure: report.tsx decides from it whether the charts block shows.
import { dtaData, studyPoints, themesReview, type DtaData, type StudyPoint } from "./charts-data";
import type { Lang } from "./i18n";
import { forestPanels, type ForestView } from "./report-view";
import { reviewTypeOf, showsSection } from "./review-type";
import type { ComparisonRow, Paper, ReviewResult } from "./types";

/** Below this many plotted studies the study map says nothing a table would not. */
export const STUDY_MAP_MIN_POINTS = 5;

export interface ChartsContent {
  forest: ForestView;
  /** narrative reviews draw a forest only for outcomes with at least 3 ratio or difference effects */
  narrative: boolean;
  dta: DtaData | null;
  map: { points: StudyPoint[]; missing: number } | null;
  /** nothing to draw: the block is left out */
  empty: boolean;
}

/**
 * From the (filtered) papers: per-outcome forest panels (the summary-of-findings grouping), diagnostic-accuracy panels,
 * and the study map (not for a themes review, nor below 5 points).
 */
export function chartsContent(result: ReviewResult, papers: Paper[], rows: ComparisonRow[], enRows: ComparisonRow[], lang: Lang): ChartsContent {
  const type = reviewTypeOf(result);
  const has = showsSection(type, "forest");
  const narrative = type === "narrative";
  const forest = has
    ? forestPanels({ rows, enRows, papers, meta: result.meta_analysis, lang }, narrative ? { minEffects: 3 } : {})
    : { panels: [], unplaced: [] };
  const dta = has ? dtaData(papers, lang) : null;
  const points = studyPoints(papers);
  const map = has && !themesReview(papers) && points.points.length >= STUDY_MAP_MIN_POINTS ? points : null;
  // A narrative review shows no "nothing to plot" line: its forest is optional (audit #23).
  const empty = !has || (!forest.panels.length && !dta && !map && narrative);
  return { forest, narrative, dta, map, empty };
}
