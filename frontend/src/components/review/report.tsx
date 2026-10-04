"use client";

import { useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { ComparisonRow, Paper, Review } from "@/lib/types";
import { Charts } from "./charts";
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
  const matrixRefs = useMemo(() => papers.filter((p) => rows.some((r) => r.cells.some((c) => c.ref === p.ref))).map((p) => p.ref), [papers, rows]);
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
    <div className="grid gap-6 pt-8">
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

      <div className={`grid rounded-sm border border-rule bg-surface ${hasPapers ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : ""}`}>
        <div className={`grid min-w-0 content-start gap-8 p-5 sm:p-8 ${hasPapers ? "lg:border-r lg:border-rule" : ""}`}>
          <QuestionHeader question={result.question} topic={review.topic} lang={lang} />
          <StrengthLine synthesis={synthesis} lang={lang} quality={result.quality} />
          <section aria-labelledby="h-summary" className="grid gap-2">
            <h2 id="h-summary" className="text-lg font-semibold">{L(lang, "สรุป", "Summary")}</h2>
            <p className="max-w-[65ch] text-[1.02rem] leading-[1.75]">
              <CitedText text={synthesis.executive_summary || result.summary || ""} onSelect={select} refs={refs} />
            </p>
            <p className="text-[0.8rem] text-muted">
              {L(lang, "สรุปเขียนโดยโมเดลจากข้อมูลที่ตรวจแล้ว ตัวเลขที่ตรวจกับต้นฉบับได้แสดงด้วยเส้นใต้ลายเทปในตารางและแถบต้นฉบับ",
                "The summary is written by a model from verified data; numbers checked against the papers carry a striped underline in the table and source rail.")}
            </p>
          </section>

          {rows.length > 0 && (
            <section aria-labelledby="h-matrix">
              <h2 id="h-matrix" className="mb-3 text-lg font-semibold">{L(lang, "ผลแต่ละการศึกษา", "Findings by study")}</h2>
              <ComparisonMatrix rows={rows} refs={matrixRefs} lang={lang} onSelect={select} selected={active ?? undefined}
                outcomeOf={(row, ref) => outcomeFor(byRef.get(ref), row, ref)} />
              <MatrixLegend lang={lang} />
            </section>
          )}

          <ClaimsPanel consensus={synthesis.consensus ?? []} conflicts={synthesis.conflicts ?? []} lang={lang} onSelect={select} refs={refs} />

          {hasPapers && <Charts result={result} papers={papers} lang={lang} onSelect={select} />}

          {!!synthesis.research_gaps?.length && (
            <section aria-labelledby="h-gaps" className="grid gap-2">
              <h2 id="h-gaps" className="text-lg font-semibold">{L(lang, "สิ่งที่ยังไม่รู้", "Research gaps")}</h2>
              <ul className="list-disc pl-5 text-[0.95rem]">{synthesis.research_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </section>
          )}

          {hasPapers && (
            <section aria-labelledby="h-papers">
              <h2 id="h-papers" className="mb-2 text-lg font-semibold">{L(lang, "งานวิจัยที่อ่าน", "Papers read")}</h2>
              <PaperList papers={papers} lang={lang} onSelect={select} selectedRef={active?.ref} />
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
