"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { exportUrl } from "@/lib/api";
import { emptyFilters, filterPapers, type Filters } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import type { ComparisonRow, Paper, Review } from "@/lib/types";
import { Charts } from "./charts";
import { FilterBar } from "./filter-bar";
import { CitedText, ClaimsPanel, ComparisonMatrix, MatrixLegend, PaperList, QualityNote, QuestionHeader, StrengthLine } from "./report-parts";
import { SourceRail } from "./source-rail";
import { L } from "./text";

type Selection = { ref: string; outcome?: string };

/** Map a matrix cell to the paper outcome it came from (by finding text, then by direction, then the first). */
function outcomeFor(paper: Paper | undefined, row: ComparisonRow, ref: string): string | undefined {
  const cell = row.cells.find((c) => c.ref === ref);
  const en = paper?.card_en ?? paper?.card;
  const shown = paper?.card ?? en;
  if (!cell || !en || !shown) return undefined;
  const idx = [shown, en].map((c) => c.outcomes.findIndex((o) => o.result === cell.finding)).find((i) => i >= 0)
    ?? -1;
  const byDir = en.outcomes.findIndex((o) => o.direction === cell.direction);
  const i = idx >= 0 ? idx : byDir >= 0 ? byDir : 0;
  return en.outcomes[i]?.outcome;
}

/** The report bench: reading column (question, summary, matrix, claims, charts, papers) + source rail. */
export function Report({ review }: { review: Review }) {
  const result = review.result ?? {};
  const original = (result.language ?? review.language ?? "th") as Lang;
  const [lang, setLang] = useState<Lang>(original);
  const showEn = lang === "en" && original === "th";
  const synthesis = (showEn ? result.synthesis_en : result.synthesis) ?? result.synthesis ?? { executive_summary: result.summary ?? "" };
  const papers = useMemo(() => result.papers ?? [], [result.papers]);
  const byRef = useMemo(() => new Map(papers.map((p) => [p.ref, p])), [papers]);
  const refs = useMemo(() => new Set(papers.map((p) => p.ref)), [papers]);
  const rows = useMemo(() => (synthesis.comparison?.length ? synthesis.comparison : showEn ? result.synthesis?.comparison ?? [] : []), [synthesis.comparison, showEn, result.synthesis?.comparison]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const visible = useMemo(() => filterPapers(papers, filters), [papers, filters]);
  const matrixRefs = useMemo(() => visible.filter((p) => rows.some((r) => r.cells.some((c) => c.ref === p.ref))).map((p) => p.ref), [visible, rows]);
  const visibleRows = useMemo(() => rows.filter((r) => r.cells.some((c) => matrixRefs.includes(c.ref))), [rows, matrixRefs]);
  const firstWithCard = papers.find((p) => p.card)?.ref;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const active = selection ?? (firstWithCard ? { ref: firstWithCard } : null);

  function select(ref: string, outcome?: string) {
    setSelection({ ref, outcome });
    setDrawerOpen(true);
  }

  const hasPapers = papers.length > 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label break-words">{review.topic}</span>
        {original === "th" && result.synthesis_en && (
          <div role="group" aria-label="ภาษา" className="inline-flex rounded-sm border border-rule font-display text-sm">
            {(["th", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
                className={`px-3 py-1 ${lang === l ? "bg-ink text-ground" : "text-ink"}`}>
                {l === "th" ? "ภาษาไทย" : "English"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`grid grid-cols-[minmax(0,1fr)] rounded-sm border border-rule bg-surface ${hasPapers ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : ""}`}>
        <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-8 p-5 sm:p-8 ${hasPapers ? "lg:border-r lg:border-rule" : ""}`}>
          <QuestionHeader question={result.question} topic={review.topic} lang={lang} />
          {hasPapers && <StrengthLine synthesis={synthesis} lang={lang} quality={result.quality} />}
          <section aria-labelledby="h-summary" className="grid gap-2">
            <h2 id="h-summary" className="text-lg font-semibold">{L(lang, "สรุป", "Summary")}</h2>
            <p className="max-w-[65ch] text-[1.02rem] leading-[1.75]">
              <CitedText text={synthesis.executive_summary || result.summary || ""} onSelect={select} refs={refs} />
            </p>
            {hasPapers && <p className="text-[0.8rem] text-muted">
              {L(lang, "สรุปเขียนโดยโมเดลจากข้อมูลที่ตรวจแล้ว ตัวเลขที่ตรวจกับต้นฉบับได้แสดงด้วยเส้นใต้ลายเทปในตารางและแถบต้นฉบับ",
                "The summary is written by a model from verified data; numbers checked against the papers carry a striped underline in the table and source rail.")}
            </p>}
          </section>

          {!hasPapers && (
            <section aria-labelledby="h-next" className="grid gap-3">
              <h2 id="h-next" className="text-lg font-semibold">{L(lang, "ลองแบบนี้", "Try this")}</h2>
              <ul className="grid list-disc gap-1.5 pl-5 text-[0.95rem]">
                <li>{L(lang, "ใช้ชื่อยาหรือโรคเป็นภาษาอังกฤษ เช่น metformin, colorectal cancer", "Use the English drug or disease name, e.g. metformin, colorectal cancer")}</li>
                <li>{L(lang, "ถามให้กว้างขึ้น หรือเอาเงื่อนไขปีและชนิดงานวิจัยออก", "Ask a broader question, or remove the year and study-type filters")}</li>
              </ul>
              <Link href="/" className="w-fit rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary no-underline hover:brightness-110">
                {L(lang, "ถามคำถามใหม่", "Ask a new question")}
              </Link>
            </section>
          )}

          {papers.length > 1 && (
            <FilterBar papers={papers} filters={filters} onChange={setFilters} shown={visible.length} lang={lang} />
          )}

          {rows.length > 0 && (
            <section aria-labelledby="h-matrix">
              <h2 id="h-matrix" className="mb-3 text-lg font-semibold">{L(lang, "ผลแต่ละการศึกษา", "Findings by study")}</h2>
              {visibleRows.length ? <ComparisonMatrix rows={visibleRows} refs={matrixRefs} lang={lang} onSelect={select} selected={active ?? undefined}
                outcomeOf={(row, ref) => outcomeFor(byRef.get(ref), row, ref)} /> : <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีงานวิจัยที่ตรงกับตัวกรอง", "No studies match the filters")}</p>}
              <MatrixLegend lang={lang} />
            </section>
          )}

          <ClaimsPanel consensus={synthesis.consensus ?? []} conflicts={synthesis.conflicts ?? []} lang={lang} onSelect={select} refs={refs} />

          {hasPapers && <Charts result={result} papers={visible} lang={lang} onSelect={select} />}

          {!!synthesis.research_gaps?.length && (
            <section aria-labelledby="h-gaps" className="grid gap-2">
              <h2 id="h-gaps" className="text-lg font-semibold">{L(lang, "สิ่งที่ยังไม่รู้", "Research gaps")}</h2>
              <ul className="list-disc pl-5 text-[0.95rem]">{synthesis.research_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </section>
          )}

          {hasPapers && (
            <section aria-labelledby="h-papers">
              <h2 id="h-papers" className="mb-2 text-lg font-semibold">{L(lang, "งานวิจัยที่อ่าน", "Papers read")}</h2>
              <PaperList papers={visible} lang={lang} onSelect={select} selectedRef={active?.ref} />
            </section>
          )}

          {!!result.external_context?.length && (
            <section aria-labelledby="h-external" className="grid gap-2 text-[0.9rem]">
              <h2 id="h-external" className="text-lg font-semibold">{L(lang, "ข้อมูลประกอบจากเครื่องมือภายนอก", "Background from external tools")}</h2>
              <ul className="grid gap-2">
                {result.external_context.map((e, i) => (
                  <li key={i} className="rounded-sm bg-ground p-3"><b className="font-display">{e.tool}</b> <span className="text-muted">{e.ok ? "" : L(lang, "(ล้มเหลว)", "(failed)")}</span><p className="break-words">{e.preview}</p></li>
                ))}
              </ul>
            </section>
          )}

          <QualityNote quality={result.quality} stats={result.stats} lang={lang} preset={result.llm_preset} />
          <nav aria-label={L(lang, "ดาวน์โหลดรีวิว", "Download this review")} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[0.9rem]">
            <span className="label">{L(lang, "ดาวน์โหลด", "Download")}</span>
            {([["md", "Markdown"], ["csv", "CSV"], ["json", "JSON"]] as const).map(([fmt, name]) => (
              <a key={fmt} href={exportUrl(review.id, fmt)} download
                className="inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0">
                {name}
              </a>
            ))}
          </nav>
          <p className="text-[0.8rem] text-muted">{L(lang, "การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์", "Automated rapid literature review; not medical advice.")}</p>
        </div>

        {hasPapers && (
          <div className={`min-w-0 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-4.5rem)] lg:self-start lg:overflow-auto ${drawerOpen ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:max-h-[70dvh] max-lg:overflow-auto max-lg:border-t max-lg:border-ink" : "max-lg:hidden"}`}>
            <SourceRail paper={active ? byRef.get(active.ref) ?? null : null} outcome={active?.outcome} lang={lang}
              onClose={() => setDrawerOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
