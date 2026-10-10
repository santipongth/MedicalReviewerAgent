"use client";

import { useMemo } from "react";
import type { ChartsContent } from "@/lib/charts-content";
import type { Lang } from "@/lib/i18n";
import type { ReviewResult } from "@/lib/types";
import { StudyMapFigure } from "../charts/figures";
import { DtaFigure, ForestPanel, type Arms } from "../charts/forest-plot";
import { readTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { SectionHeading } from "./report-nav";
import { L } from "./text";

/**
 * Results figures, built only from verified values in the (filtered) papers: a forest panel per outcome and measure,
 * the diagnostic-accuracy family, and the study map. The study selection flow is PrismaFlow (Plan 20 Task 4).
 */
export function Charts({ content, result, lang, onSelect }: {
  content: ChartsContent; result: ReviewResult; lang: Lang; onSelect: (ref: string, outcome?: string) => void;
}) {
  const theme = useTheme();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const pico = result.question?.pico;
  const arms: Arms = { intervention: pico?.intervention_or_exposure?.trim() || null, comparator: pico?.comparator?.trim() || null };
  if (content.empty) return null;
  const { forest, dta, map } = content;
  const unverified = forest.unplaced.length ? (
    <p className="text-[0.82rem] text-muted" data-forest-left-out>
      <span className="hole mr-2">{L(lang, "ไม่ยืนยัน", "not verified")}</span>
      {L(lang, "ไม่แสดงในกราฟเพราะตรวจกับต้นฉบับไม่ผ่าน:", "Left out because they failed verification:")}{" "}
      {forest.unplaced.map((u) => `${u.ref} (${u.outcome})`).join(", ")}
    </p>
  ) : null;
  return (
    <section aria-labelledby="h-charts" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      <SectionHeading id="h-charts">{L(lang, "แผนภาพหลักฐาน", "Evidence charts")}</SectionHeading>
      {forest.panels.length > 0 ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10" data-forest-panels>
          <p className="max-w-[65ch] text-[0.85rem] text-muted">
            {L(lang, "ขนาดผลแยกตามผลลัพธ์และตัววัด (ไม่รวมตัววัดต่างชนิดบนแกนเดียวกัน) ตัวเลขทุกค่าตรวจกับบทคัดย่อแล้ว แตะชื่องานเพื่อดูประโยคต้นฉบับ",
              "Effect sizes by outcome and measure (never two measures on one axis). Every number was checked against the abstract; tap a study to see its source sentence.")}
            {content.narrative && <> {L(lang, "การทบทวนแบบบรรยายแสดงเฉพาะผลลัพธ์ที่มีขนาดผลตั้งแต่ 3 ค่า", "A narrative review shows only outcomes with at least 3 effect sizes.")}</>}
          </p>
          {forest.panels.map((p) => <ForestPanel key={p.key} panel={p} arms={arms} lang={lang} onSelect={onSelect} />)}
          {unverified}
        </div>
      ) : !content.narrative && !dta && (
        <div className="grid gap-2">
          <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีขนาดผลที่ตรวจกับต้นฉบับผ่านสำหรับวาดกราฟ", "No verified effect sizes to plot")}</p>
          {unverified}
        </div>
      )}
      {dta && <DtaFigure data={dta} lang={lang} onSelect={onSelect} />}
      {map && tokens && <StudyMapFigure points={map.points} missing={map.missing} tokens={tokens} lang={lang} onSelect={onSelect} />}
    </section>
  );
}
