"use client";

import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import type { SofEffect, SofRow } from "@/lib/report-view";
import { ComputedNumber, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { CertaintyMark } from "./certainty";
import { NoEffectText, PooledValue, StudyEffectValue } from "./key-findings";
import { themeFoundText, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { ScrollRegion } from "./scroll-region";
import { L } from "./text";

const TH = "px-3 py-2 text-left align-bottom label";
// From md up a table cell; below md each outcome is a stacked card and every cell shows its column name first.
const TD = "px-3 py-2.5 align-top max-md:block max-md:px-0 max-md:py-1.5 max-md:before:mb-0.5 max-md:before:block "
  + "max-md:before:font-display max-md:before:text-[0.72rem] max-md:before:font-semibold max-md:before:tracking-[0.04em] "
  + "max-md:before:text-muted max-md:before:content-[attr(data-label)]";
const COUNT = new Intl.NumberFormat("en-US");
const NOTE = "text-[0.78rem] text-muted";

function Participants({ row, lang }: { row: SofRow; lang: Lang }) {
  const p = row.participants;
  switch (p.kind) {
    case "sum":
      return (
        <span className="grid gap-0.5" data-participants="sum">
          {/* a sum the system added up: a computed number, never a paper's own figure */}
          <ComputedNumber value={COUNT.format(p.total)} lang={lang} />
          <span className={NOTE}>
            {L(lang, `รวมจากที่ตรวจได้ ${p.counted} จาก ${p.of} การศึกษา`, `sum of the verified sizes, ${p.counted} of ${p.of} ${p.of === 1 ? "study" : "studies"}`)}
            {p.reviews > 0 && L(lang, " · ไม่นับ SR/MA", " · SR/MA not counted")}
          </span>
        </span>
      );
    case "blanked":
      return <Hole lang={lang} />;
    case "reviews_only":
      return (
        <span className="grid gap-0.5" data-participants="reviews_only">
          <span aria-hidden="true">—</span>
          <span className={NOTE}>{L(lang, "มีแต่ SR/MA ซึ่งซ้อนกับงานวิจัยหลัก จึงไม่นับ", "SR/MA only; they overlap with primary studies, so none are summed")}</span>
        </span>
      );
    default:
      return <span className="text-[0.88rem] text-muted" data-participants="not_reported">{L(lang, "ไม่ได้รายงาน", "Not reported")}</span>;
  }
}

function Effect({ effect, k, lang, onSelect }: { effect: SofEffect; k: number; lang: Lang; onSelect: Select }) {
  switch (effect.kind) {
    case "pooled":
      return <span className="grid gap-1">{effect.pools.map((p) => <PooledValue key={p.key} pool={p} lang={lang} />)}</span>;
    case "range":
      return (
        <span className="grid gap-0.5">
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-display">{effect.measure}</span>
            <VerifiedNumber value={effect.lo.num} onSelect={() => onSelect(effect.lo.ref, effect.lo.outcomeKey)} title={effect.lo.ref} />
            <span className="font-display text-muted">{L(lang, "ถึง", "to")}</span>
            <VerifiedNumber value={effect.hi.num} onSelect={() => onSelect(effect.hi.ref, effect.hi.outcomeKey)} title={effect.hi.ref} />
          </span>
          <span className={NOTE}>
            {L(lang, `ช่วงของค่าที่ตรวจผ่านจาก ${effect.n} การศึกษา (${effect.lo.ref}, ${effect.hi.ref})`,
              `range of the verified values from ${effect.n} studies (${effect.lo.ref}, ${effect.hi.ref})`)}
            {effect.other > 0 && L(lang, ` · อีก ${effect.other} ค่าใช้ตัววัดต่างกัน`, ` · ${effect.other} more with a different measure`)}
          </span>
        </span>
      );
    case "single":
      return (
        <span className="grid gap-0.5">
          <StudyEffectValue state={{ kind: "verified", effect: effect.effect }} lang={lang} onSelect={onSelect} />
          <span className={NOTE}>
            {effect.effect.ref}{effect.other > 0 && L(lang, ` · อีก ${effect.other} ค่า`, ` · ${effect.other} more`)}
          </span>
        </span>
      );
    case "mixed":
      return (
        <span className="grid gap-0.5" data-effect="mixed">
          <span className="text-[0.88rem]">{L(lang, "ตัววัดต่างกัน เทียบเป็นช่วงไม่ได้", "Measures differ; no range")}</span>
          <span className={NOTE}>
            {effect.measures.map((m) => `${m.measure ?? L(lang, "ไม่ระบุตัววัด", "unnamed measure")} ${m.count}`).join(" · ")}
            {L(lang, " การศึกษา", " studies")}
          </span>
        </span>
      );
    case "blanked":
      return <StudyEffectValue state={effect} lang={lang} onSelect={onSelect} />;
    default:
      return k === 1 ? <NoEffectText lang={lang} />
        : <span className="text-[0.88rem] text-muted">{L(lang, "ดูรายงานแต่ละการศึกษา", "See each study's report")}</span>;
  }
}

function Statement({ row, lang }: { row: SofRow; lang: Lang }) {
  if (row.statement) return <span className="line-clamp-3 break-words" title={row.statement}>{row.statement}</span>;
  if (!row.tally.length && !row.themes) return <span className="text-muted">–</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 font-display text-[0.88rem]">
      {row.tally.map((t) => (
        <span key={t.direction} className="inline-flex items-center gap-1">
          <Glyph direction={t.direction} lang={lang} />{DIRECTION_LABEL[lang][t.direction]} <span className="tabular-nums">{t.count}</span>
        </span>
      ))}
      {row.themes > 0 && <span>{themeFoundText(row.themes, lang)}</span>}
    </span>
  );
}

/**
 * Summary of findings (Plan 20; SLR and meta-analysis): per outcome the studies (k, designs, participants: the sum of
 * verified sample sizes, computed), the effect (pooled value as computed, else the range of verified values of one
 * named measure, else a single verified value, else why there is none), the certainty (⊕, an LLM-assisted GRADE-lite
 * judgement, not an expert GRADE assessment) and, on a full-width line under it, what it means. Fits the reading
 * column with no sideways scrolling; below 768px every outcome is a stacked card. A real table: caption, scoped headers.
 */
export function SofTable({ rows, lang, onSelect, graded }: { rows: SofRow[]; lang: Lang; onSelect: Select; graded: boolean }) {
  if (!rows.length) return null;
  const caption = L(lang, "ตารางสรุปผลการศึกษาตามผลลัพธ์", "Summary of findings by outcome");
  const reviewLevel = graded && rows.some((r) => r.certaintySource === "review");
  const col = {
    studies: L(lang, "การศึกษาและผู้เข้าร่วม", "Studies and participants"),
    effect: L(lang, "ขนาดผล", "Effect"),
    certainty: L(lang, "ความแข็งแรงของหลักฐาน", "Certainty"),
    means: L(lang, "ความหมาย", "What it means"),
  };
  return (
    <section aria-labelledby="h-sof" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="h-sof" className={SECTION_H2}>{L(lang, "ตารางสรุปผลการศึกษา", "Summary of findings")}</h2>
      <p className="max-w-[65ch] text-[0.85rem] text-muted" id="sof-note">
        {L(lang, "ระดับความแข็งแรงของหลักฐานเป็นการประเมินโดยโมเดลภาษา (GRADE-lite) ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ ตัวเลขที่มีเส้นใต้ลายเทปตรวจกับบทคัดย่อแล้ว ค่ารวมและผลรวมผู้เข้าร่วมคำนวณโดยระบบ",
          "Certainty is an LLM-assisted judgement (GRADE-lite), not an expert GRADE assessment. Numbers with the striped underline were checked against the abstracts; pooled values and participant sums are computed by the system.")}
        {reviewLevel && <>{" "}<b className="font-semibold" data-review-level>{L(lang, "ระดับเดียวกันทุกผลลัพธ์ (ระดับของทั้งรีวิว ไม่ได้ประเมินแยกตามผลลัพธ์)",
          "The same level for every outcome (the review-level certainty, not graded per outcome).")}</b></>}
      </p>
      {/* Fits without scrolling since Task 3; the region keeps the scroll cue in case a long word ever widens it. */}
      <ScrollRegion label={caption} lang={lang} bordered={false} className="rounded-sm md:border md:border-rule">
        <table className="w-full border-collapse text-[0.9rem] max-md:block" aria-describedby="sof-note">
          <caption className="sr-only">
            {caption} {L(lang, "(ระดับความแข็งแรงของหลักฐานประเมินโดยโมเดลภาษา ไม่ใช่ GRADE โดยผู้เชี่ยวชาญ)", "(certainty judged by a language model, not an expert GRADE assessment)")}
          </caption>
          <thead className="max-md:sr-only">
            <tr className="bg-ground">
              <th scope="col" className={`${TH} w-[24%]`}>{L(lang, "ผลลัพธ์", "Outcome")}</th>
              <th scope="col" className={`${TH} w-[26%]`}>{col.studies}</th>
              <th scope="col" className={TH}>{col.effect}</th>
              <th scope="col" className={`${TH} w-[7.5rem]`}><Term k="evidenceStrength" lang={lang}>{col.certainty}</Term></th>
            </tr>
          </thead>
          {rows.map((r) => (
            <tbody key={r.key} data-sof-row
              className="border-t border-rule max-md:mb-3 max-md:block max-md:rounded-sm max-md:border max-md:border-rule max-md:bg-surface max-md:px-3 max-md:py-2">
              <tr className="max-md:block">
                <th scope="row" className="px-3 pt-2.5 text-left align-top font-display font-semibold break-words max-md:block max-md:px-0 max-md:pt-0.5">{r.outcome}</th>
                <td className={TD} data-label={col.studies}>
                  <span className="font-display font-semibold">
                    <span className="tabular-nums">{r.k}</span> {L(lang, "การศึกษา", r.k === 1 ? "study" : "studies")}
                  </span>
                  {r.designs.length > 0 && (
                    <ul className="mt-0.5 grid text-[0.8rem] text-muted" aria-label={L(lang, "รูปแบบการศึกษา", "Designs")}>
                      {r.designs.map((d) => <li key={d.label}>{d.label} <span className="font-display tabular-nums">{d.count}</span></li>)}
                    </ul>
                  )}
                  <span className="mt-1.5 grid gap-0.5">
                    <span className="label">{L(lang, "ผู้เข้าร่วม", "Participants")}</span>
                    <Participants row={r} lang={lang} />
                  </span>
                </td>
                <td className={TD} data-label={col.effect}><Effect effect={r.effect} k={r.k} lang={lang} onSelect={onSelect} /></td>
                <td className={TD} data-label={col.certainty}>
                  {graded && r.certainty ? (
                    <span className="grid gap-0.5">
                      <CertaintyMark level={r.certainty} lang={lang} />
                      {r.certaintySource === "review" && <span className={NOTE}>{L(lang, "ระดับของทั้งรีวิว", "review-level")}</span>}
                    </span>
                  ) : <span className="text-[0.88rem] text-muted">{L(lang, "ไม่ได้ประเมิน", "Not assessed")}</span>}
                </td>
              </tr>
              <tr className="max-md:block">
                <td colSpan={4} className="px-3 pb-3 text-[0.92rem] max-md:block max-md:px-0 max-md:pb-1" data-sof-statement>
                  <span className="label mr-2">{col.means}</span>
                  <Statement row={r} lang={lang} />
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </ScrollRegion>
    </section>
  );
}
