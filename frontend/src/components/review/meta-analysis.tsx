"use client";

import { useId, useMemo } from "react";
import type { Lang } from "@/lib/i18n";
import { metaView, type MetaPoolView, type MetaView } from "@/lib/meta-view";
import type { ComparisonRow, MetaAnalysis, Paper, Quality } from "@/lib/types";
import { MetaForestFigure } from "../charts/figures";
import { readTokens, type ChartTokens } from "../charts/tokens";
import { useTheme } from "../theme-toggle";
import { ComputedNumber, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

/** The exact banner over every pooled analysis (Plan 14b honest-display rule). */
export const META_BANNER_TH = "คำนวณโดยระบบจากตัวเลขที่ตรวจกับบทคัดย่อแล้ว — ไม่ใช่ผลจากงานวิจัยฉบับใด";
const META_BANNER_EN = "Computed by the system from numbers checked against the abstracts — not a result of any single study";

type Select = (ref: string, outcome?: string) => void;

const H3 = "font-display text-base font-semibold";
const REF_BTN = "inline-flex min-h-11 min-w-11 items-center justify-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0 md:min-w-0";

/**
 * The meta-analysis section: banner, then per pooled analysis the computed estimate (ComputedNumber only), the
 * heterogeneity line, its warnings, a forest plot with an outlined lozenge and the "วิธีคำนวณ" inputs; then the
 * GRADE-lite effect, the SR/MA reference rows (verified paper numbers) and the exclusions summarised by reason.
 * Pooling covers every paper of the review, so the filters do not change it. Offline-safe (no next/* imports).
 */
export function MetaAnalysisSection({ meta, papers, rows, lang, english, filtered, quality, onSelect }: {
  meta: MetaAnalysis | null | undefined; papers: Paper[]; rows: ComparisonRow[]; lang: Lang; english: boolean;
  filtered: boolean; quality?: Quality; onSelect: Select;
}) {
  const theme = useTheme();
  const tokens = useMemo(() => (theme ? readTokens() : null), [theme]);
  const view = useMemo(() => (meta ? metaView(meta, papers, rows, lang, english) : null), [meta, papers, rows, lang, english]);
  return (
    <section aria-labelledby="h-meta" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <h2 id="h-meta" className={SECTION_H2}>{L(lang, "การวิเคราะห์อภิมาน: ค่ารวม", "Meta-analysis: pooled estimates")}</h2>
      {!view ? (
        <p className="text-[0.95rem]">
          {L(lang, "รีวิวนี้ไม่มีค่ารวม เพราะขั้นตอนรวมผลทำไม่สำเร็จ ผลแต่ละงานยังอยู่ในตารางและแผนภาพด้านบน",
            "This review has no pooled estimates because the pooling step did not complete; each study's result is still in the table and charts above.")}
        </p>
      ) : (
        <MetaBody view={view} tokens={tokens} lang={lang} filtered={filtered} quality={quality} onSelect={onSelect} />
      )}
    </section>
  );
}

function MetaBody({ view, tokens, lang, filtered, quality, onSelect }: {
  view: MetaView; tokens: ChartTokens | null; lang: Lang; filtered: boolean; quality?: Quality; onSelect: Select;
}) {
  const removed = quality?.pooled_numbers?.removed ?? 0;
  return (
    <>
      <div role="note" className="grid gap-2 rounded-sm bg-info-bg p-3 sm:p-4">
        <p className="font-display font-semibold text-balance">{L(lang, META_BANNER_TH, META_BANNER_EN)}</p>
        <p className="text-[0.88rem]">
          {L(lang, "รวมเฉพาะงานวิจัยหลักที่วัดผลด้วยตัววัดเดียวกัน ตั้งแต่ 3 ฉบับ แยก RCT กับงานเชิงสังเกต ไม่รวมงานทบทวนอย่างเป็นระบบ",
            "Only primary studies with the same measure are pooled, at least 3 of them, RCTs apart from observational studies; systematic reviews are never pooled.")}
          {" "}<Term k="metaAnalysis" lang={lang}>{L(lang, "การวิเคราะห์อภิมานคืออะไร", "what is a meta-analysis")}</Term>
        </p>
        {view.general.length > 0 && (
          <ul aria-label={L(lang, "ข้อจำกัดของทุกค่ารวม", "Limits of every pooled estimate")} className="grid list-disc gap-0.5 pl-5 text-[0.85rem]">
            {view.general.map((w) => <li key={w.code}>{w.label}</li>)}
          </ul>
        )}
        {filtered && (
          <p className="text-[0.85rem]">{L(lang, "ค่ารวมคำนวณจากงานวิจัยทั้งหมดในรีวิว ไม่เปลี่ยนตามตัวกรอง", "Pooled from every study in the review; the filters do not change it.")}</p>
        )}
      </div>

      {view.pools.length === 0 ? (
        <p className="text-[0.95rem]">
          {L(lang, "ไม่มีผลลัพธ์ใดที่มีงานวิจัยหลักตั้งแต่ 3 ฉบับ วัดผลแบบเดียวกัน และมีตัวเลขที่ตรวจผ่านครบ จึงไม่ได้คำนวณค่ารวม",
            "No outcome had at least 3 primary studies with the same measure and fully verified numbers, so nothing was pooled.")}
        </p>
      ) : view.pools.map((p) => <PoolBlock key={p.key} pool={p} tokens={tokens} lang={lang} onSelect={onSelect} removed={removed} />)}

      {view.grade.length > 0 && (
        <div className="grid gap-1.5">
          <h3 className={H3}>{L(lang, "ผลต่อระดับความแข็งแรงของหลักฐาน", "Effect on the evidence strength")}</h3>
          <ul className="grid list-disc gap-1 pl-5 text-[0.92rem]">{view.grade.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}

      {view.reference.length > 0 && <ReferenceRows view={view} lang={lang} onSelect={onSelect} />}
      {view.excluded.length > 0 && <ExcludedList view={view} lang={lang} />}
    </>
  );
}

function PoolBlock({ pool, tokens, lang, onSelect, removed }: {
  pool: MetaPoolView; tokens: ChartTokens | null; lang: Lang; onSelect: Select; removed: number;
}) {
  const id = useId();
  return (
    <article aria-labelledby={id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-rule pt-4">
      <h3 id={id} className={`${H3} break-words`}>
        {pool.outcome} · {pool.groupLabel} · {pool.measure}
      </h3>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[1.05rem]">
        <span className="inline-flex items-baseline gap-2">
          <span className="font-display">{L(lang, "ค่ารวม", "Pooled")} {pool.measure}</span>
          <ComputedNumber value={pool.estText} lang={lang} className="text-[1.2rem]" />
        </span>
        <span className="inline-flex items-baseline gap-2">
          <span className="font-display text-muted">95% CI</span>
          <ComputedNumber value={pool.ciText} lang={lang} tag={false} />
        </span>
      </p>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-[0.9rem] tabular-nums">
        <span>k = {pool.k}</span>
        <span>I² <ComputedNumber value={pool.i2Text} lang={lang} tag={false} /></span>
        <span>τ²{pool.ratio ? " (ln)" : ""} <ComputedNumber value={pool.tau2Text} lang={lang} tag={false} /></span>
        <span>Q <ComputedNumber value={pool.qText} lang={lang} tag={false} /> (df {pool.df}, p {pool.pText.startsWith("<") ? "" : "= "}<ComputedNumber value={pool.pText} lang={lang} tag={false} />)</span>
        <Term k="heterogeneity" lang={lang}>{L(lang, "ค่าเหล่านี้คืออะไร", "what these mean")}</Term>
      </p>
      {pool.warnings.length > 0 && (
        <div className="grid gap-1 rounded-sm bg-warn-bg p-3">
          <p className="font-display font-semibold">{L(lang, "ข้อควรระวังของค่ารวมนี้", "Cautions for this estimate")}</p>
          <ul className="grid list-disc gap-0.5 pl-5 text-[0.88rem]">{pool.warnings.map((w) => <li key={w.code}>{w.label}</li>)}</ul>
        </div>
      )}
      {tokens && <MetaForestFigure pool={pool} tokens={tokens} lang={lang} onSelect={onSelect} />}
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm border border-rule px-3 font-display hover:border-ink md:min-h-0 md:py-1.5">
          <span aria-hidden="true" className="inline-block text-[0.7rem] text-muted group-open:rotate-90">▶</span>
          <span>{L(lang, "วิธีคำนวณ", "How it was computed")}</span>
        </summary>
        <div className="grid gap-2 pt-2">
          <div className="overflow-x-auto rounded-sm border border-rule" tabIndex={0} role="region"
            aria-label={L(lang, "ตัวเลขที่ใช้คำนวณ (เลื่อนดูได้)", "Inputs of the calculation (scrollable)")}>
            <table className="w-full min-w-[520px] border-collapse text-[0.88rem]">
              <caption className="sr-only">{L(lang, `ตัวเลขที่ใช้คำนวณค่ารวม ${pool.outcome}`, `Inputs of the pooled estimate for ${pool.outcome}`)}</caption>
              <thead><tr className="bg-ground text-left">
                <th scope="col" className="px-2.5 py-2 label">{L(lang, "งานวิจัย", "Study")}</th>
                <th scope="col" className="px-2.5 py-2 label">{pool.measure} {L(lang, "(จากบทคัดย่อ)", "(from the abstract)")}</th>
                <th scope="col" className="px-2.5 py-2 label">95% CI</th>
                <th scope="col" className="px-2.5 py-2 label">SE{pool.ratio ? " (ln)" : ""} {L(lang, "(คำนวณ)", "(computed)")}</th>
                <th scope="col" className="px-2.5 py-2 label">{L(lang, "น้ำหนัก (คำนวณ)", "Weight (computed)")}</th>
              </tr></thead>
              <tbody>
                {pool.studies.map((s) => (
                  <tr key={s.ref} className="border-t border-rule">
                    <th scope="row" className="px-2.5 py-1.5 text-left font-normal">
                      <button type="button" className={REF_BTN} onClick={() => onSelect(s.ref, s.outcomeKey ?? undefined)}>{s.ref}</button>
                    </th>
                    <td className="px-2.5 py-1.5"><VerifiedNumber value={s.effectText} onSelect={() => onSelect(s.ref, s.outcomeKey ?? undefined)} /></td>
                    <td className="px-2.5 py-1.5"><VerifiedNumber value={s.ciText} /></td>
                    <td className="px-2.5 py-1.5"><ComputedNumber value={s.seText} lang={lang} tag={false} /></td>
                    <td className="px-2.5 py-1.5"><ComputedNumber value={s.weightText} lang={lang} tag={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[0.85rem] text-muted">
            {L(lang, "วิธี", "Method")}: {pool.method} · {L(lang, "รุ่น", "version")} {pool.version}
            {" · "}{pool.ratio
              ? L(lang, "SE คำนวณจากช่วงความเชื่อมั่น 95% บนสเกล log (ln) แล้วแปลงค่ารวมกลับ", "SE from the 95% CI on the log (ln) scale; the pooled value is transformed back")
              : L(lang, "SE คำนวณจากช่วงความเชื่อมั่น 95%", "SE from the 95% CI")}
            {removed > 0 && <> · {L(lang, `ตัดประโยคในบทสรุปที่ทวนตัวเลขรวม ${removed} ประโยค`, `${removed} summary sentence(s) restating a pooled number were removed`)}</>}
          </p>
        </div>
      </details>
    </article>
  );
}

function ReferenceRows({ view, lang, onSelect }: { view: MetaView; lang: Lang; onSelect: Select }) {
  return (
    <div className="grid gap-1.5">
      <h3 className={H3}>{L(lang, "งานทบทวนอย่างเป็นระบบที่พบ (แสดงเพื่ออ้างอิง ไม่นำมารวม)", "Systematic reviews found (shown for reference, never pooled)")}</h3>
      <p className="text-[0.85rem] text-muted">{L(lang, "อาจรวมงานวิจัยหลักชุดเดียวกับค่ารวมข้างบน", "They may contain the same primary studies as the estimates above")}</p>
      <ul className="grid gap-0">
        {view.reference.map((r) => (
          <li key={`${r.ref}|${r.outcome}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-rule py-1.5 text-[0.92rem]">
            <button type="button" className={REF_BTN} onClick={() => onSelect(r.ref, r.outcomeKey ?? undefined)}>{r.ref}</button>
            <span className="break-words">{r.outcome}</span>
            {r.design && <span className="text-muted">{r.design}</span>}
            {r.effectText ? (
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                {r.measure && <span className="font-display">{r.measure}</span>}
                <VerifiedNumber value={r.effectText} onSelect={() => onSelect(r.ref, r.outcomeKey ?? undefined)} />
                {r.ciText && <><span className="font-display text-muted">95% CI</span><VerifiedNumber value={r.ciText} /></>}
              </span>
            ) : (
              <span className="text-muted">{L(lang, "ไม่มีตัวเลขที่ตรวจผ่าน", "No verified number")}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExcludedList({ view, lang }: { view: MetaView; lang: Lang }) {
  return (
    <div className="grid gap-1.5">
      <h3 className={H3}>{L(lang, "ผลที่ไม่ได้นำมารวม", "Results not pooled")}</h3>
      <ul className="grid gap-0">
        {view.excluded.map((g) => (
          <li key={g.reason} className="grid gap-0.5 border-b border-rule py-2 text-[0.92rem]">
            <span>
              <span className="font-medium">{g.label}</span>{" "}
              <span className="font-display text-muted tabular-nums">· {g.count} {L(lang, "รายการ", g.count === 1 ? "result" : "results")}</span>
            </span>
            <span className="text-[0.88rem] text-muted break-words">
              {g.items.map((it, i) => (
                <span key={it.outcome}>{i > 0 && " · "}{it.outcome}: <span className="font-display text-ink">{it.refs.join(", ")}</span></span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
