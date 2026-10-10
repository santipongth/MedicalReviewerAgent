"use client";

import { useMemo } from "react";
import type { Lang } from "@/lib/i18n";
import { RC } from "@/lib/i18n-report";
import { showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { ROB_COLUMN, ROB_ORDER, robSummary } from "@/lib/rob-summary";
import type { Paper } from "@/lib/types";
import { Term } from "../ui/term";
import { ThaiText } from "../ui/thai-text";
import { SECTION_H2 } from "./report-nav";
import { L, Lw } from "./text";

const R = RC.rob;

/** A count of studies: display face, tabular figures; a zero is muted so the judgements that occur stand out. */
function C({ n }: { n: number }) {
  return <span className={`font-display tabular-nums ${n ? "" : "text-muted"}`}>{n}</span>;
}

/**
 * Risk of bias summary (Plan 20 Task 4): judgement counts by study design, a caveat that a model judged them from the
 * abstract, and a link to the criteria in Methods. Hidden for scoping reviews (no appraisal) and when no paper has a
 * judgement. Qualitative and mixed-methods studies are listed under their design; the table has no direction at all.
 */
export function RobSummarySection({ papers, type, lang, fullText = false }: {
  papers: Paper[]; type: ReviewTypeOrLegacy; lang: Lang;
  /** a result from before abstract-only reading (stats.with_fulltext): some studies were read in full text */
  fullText?: boolean;
}) {
  const s = useMemo(() => (showsRiskOfBias(type) ? robSummary(papers, lang) : null), [papers, type, lang]);
  if (!s) return null;
  const caption = L(lang, R.caption);
  // Compact on a phone (headers wrap), a sized table rather than a page-wide spread from md up.
  const TH = "px-1.5 py-2 text-right align-bottom label md:px-4";
  const TD = "px-1.5 py-1.5 text-right md:px-4";
  return (
    <section aria-labelledby="h-rob" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="h-rob" className={SECTION_H2}>{Lw(lang, R.h2)}</h2>
      <p className="max-w-[65ch] text-[0.9rem] text-muted" data-rob-caveat>
        {L(lang, fullText ? R.caveatFullText : R.caveat)}
        {" · "}
        <a href="#m-rob" className="font-display font-semibold text-primary underline underline-offset-2">
          {L(lang, R.criteria)}
        </a>
      </p>
      <div className="min-w-0 overflow-x-auto" role="region" tabIndex={0} aria-label={caption}>
        <table className="w-full border-collapse text-[0.86rem] md:w-auto md:min-w-[32rem] md:text-[0.9rem]" data-rob-table>
          <caption className="pb-1 text-left label">{caption}</caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="py-2 pr-1.5 text-left align-bottom label md:min-w-[13rem] md:pr-4">
                <Term k="studyDesign" lang={lang}>{L(lang, R.design)}</Term>
              </th>
              {ROB_ORDER.map((k) => <th key={k} scope="col" className={TH}><ThaiText>{ROB_COLUMN[lang][k]}</ThaiText></th>)}
              <th scope="col" className={TH}>{L(lang, R.total)}</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.design} className="border-b border-rule align-top" data-rob-row={r.design}>
                <th scope="row" className="py-1.5 pr-2 text-left font-normal break-words">
                  <ThaiText>{r.label}</ThaiText>
                  {r.themes && <span className="block text-[0.78rem] text-muted">{L(lang, R.themes)}</span>}
                </th>
                {ROB_ORDER.map((k) => <td key={k} className={TD}><C n={r.counts[k]} /></td>)}
                <td className={`${TD} font-semibold`}><C n={r.total} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="py-1.5 pr-2 text-left font-display font-semibold">{L(lang, R.total)}</th>
              {ROB_ORDER.map((k) => <td key={k} className={`${TD} font-semibold`}><C n={s.totals[k]} /></td>)}
              <td className={`${TD} font-semibold`}><C n={s.total} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {s.related > 0 && (
        <p className="text-[0.82rem] text-muted" data-rob-related>
          {L(lang, R.related(s.related))}
        </p>
      )}
    </section>
  );
}
