"use client";

import { exportUrl } from "@/lib/api";
import { directionTally, hasPooledPapers } from "@/lib/charts-data";
import { POOLED_OVERLAP_TH } from "@/lib/copy";
import { DIRECTION_LABEL, DIRECTION_ORDER, type Lang } from "@/lib/i18n";
import { reviewTypeOf, showsDirection } from "@/lib/review-type";
import type { Paper, QuestionBlock, ReviewResult, Synthesis } from "@/lib/types";
import { CopyLinkButton } from "../ui/copy-link";
import { Glyph } from "../ui/evidence";
import { Term } from "../ui/term";
import { CitedText, QuestionTitle, StrengthLine, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

const LINK = "inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0";

/** The answer first: question, evidence strength, summary, how the papers split, and what to do with the report. */
export function BottomLine({ id, question, topic, synthesis, result, papers, lang, offline, onSelect, refs }: {
  id: string; question?: QuestionBlock; topic: string; synthesis: Synthesis; result: ReviewResult; papers: Paper[];
  lang: Lang; offline: boolean; onSelect: Select; refs: Set<string>;
}) {
  const hasPapers = papers.length > 0;
  const type = reviewTypeOf(result);
  const tally = directionTally(papers);
  // Scoping maps what exists; it never tallies a direction of effect.
  const shown = showsDirection(type) ? DIRECTION_ORDER.filter((d) => tally[d] > 0) : [];
  return (
    <section aria-labelledby="h-summary" className="grid gap-4">
      <QuestionTitle question={question} topic={topic} lang={lang} />
      {hasPapers && <StrengthLine synthesis={synthesis} lang={lang} quality={result.quality} type={type} />}
      <div className="grid gap-2">
        <h2 id="h-summary" className={SECTION_H2}>{L(lang, "สรุป", "Summary")}</h2>
        <p className="max-w-[65ch] text-[1.02rem] leading-[1.75]">
          <CitedText text={synthesis.executive_summary || result.summary || ""} onSelect={onSelect} refs={refs} />
        </p>
        {hasPapers && <p className="text-[0.8rem] text-muted">
          {type === "scoping"
            ? L(lang, "สรุปเขียนโดยโมเดลจากข้อมูลที่ตรวจแล้ว ตัวเลขที่ตรวจกับต้นฉบับแล้วมีเส้นใต้ลายเทป ดูได้ในแถบต้นฉบับ (แตะรหัสงานวิจัยในรายการ)",
              "The summary is written by a model from verified data. Numbers checked against the papers carry a striped underline; see them in the source rail (select a paper in the list).")
            : L(lang, "สรุปเขียนโดยโมเดลจากข้อมูลที่ตรวจแล้ว ตัวเลขที่ตรวจกับต้นฉบับแล้วมีเส้นใต้ลายเทป ดูได้ในแถบต้นฉบับ (แตะช่องในตารางผลแต่ละการศึกษา) และในมุมมองตารางของแผนภาพ",
              "The summary is written by a model from verified data. Numbers checked against the papers carry a striped underline; see them in the source rail (select a cell in the findings table) and in the table view of the charts.")}
        </p>}
      </div>
      {shown.length > 0 && (
        <div className="grid gap-1.5 text-[0.92rem]">
          <p className="text-muted">
            <Term k="directionTally" lang={lang}>{L(lang, "จำนวนงานวิจัยตามทิศทางผลที่เอเจนต์อ่าน", "Papers by the direction of result the agent read")}</Term>
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {shown.map((d) => (
              <li key={d} className="inline-flex items-center gap-1.5 font-display">
                <Glyph direction={d} lang={lang} />
                {DIRECTION_LABEL[lang][d]} <span className="tabular-nums font-semibold">{tally[d]}</span>
              </li>
            ))}
          </ul>
          {hasPooledPapers(papers) && (
            <p className="text-[0.82rem] text-muted">
              {L(lang, POOLED_OVERLAP_TH, "Reviews and meta-analyses may overlap with the primary studies counted here")}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9rem]">
        {!offline && (
          <details>
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-rule px-3 font-display md:min-h-0 md:py-1.5">
              {L(lang, "ดาวน์โหลด", "Download")}
            </summary>
            <nav aria-label={L(lang, "ดาวน์โหลดรีวิว", "Download this review")} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <a href={`/r/${encodeURIComponent(id)}/report.html`} download className={LINK}>
                {L(lang, "HTML (เปิดได้ออฟไลน์)", "HTML (works offline)")}
              </a>
              {([["md", "Markdown"], ["csv", "CSV"], ["json", "JSON"]] as const).map(([fmt, name]) => (
                <a key={fmt} href={exportUrl(id, fmt)} download className={LINK}>{name}</a>
              ))}
            </nav>
          </details>
        )}
        {!offline && <CopyLinkButton />}
        <button type="button" onClick={() => window.print()}
          className="cursor-pointer rounded-sm border border-rule bg-transparent px-3 py-1.5 font-display text-sm hover:text-primary">
          {L(lang, "พิมพ์", "Print")}
        </button>
      </div>
    </section>
  );
}
