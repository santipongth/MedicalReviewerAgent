"use client";

import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import type { SofEffect, SofRow } from "@/lib/report-view";
import { Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { CertaintyMark } from "./certainty";
import { PooledValue, StudyEffectValue } from "./key-findings";
import { themeFoundText, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

const TH = "px-3 py-2 text-left align-bottom label";
const TD = "px-3 py-2.5 align-top";
const COUNT = new Intl.NumberFormat("en-US");

function Participants({ row, lang }: { row: SofRow; lang: Lang }) {
  const p = row.participants;
  if (!p) return <Hole lang={lang} />;
  return (
    <span className="grid gap-0.5">
      <span className="font-display font-semibold tabular-nums">{COUNT.format(p.total)}</span>
      <span className="text-[0.78rem] text-muted">
        {L(lang, `รวมจากที่ตรวจได้ ${p.counted} จาก ${p.of} การศึกษา`, `sum of the verified sizes, ${p.counted} of ${p.of} ${p.of === 1 ? "study" : "studies"}`)}
        {p.reviews > 0 && L(lang, " · ไม่นับ SR/MA", " · SR/MA not counted")}
      </span>
    </span>
  );
}

function Effect({ effect, lang, onSelect }: { effect: SofEffect; lang: Lang; onSelect: Select }) {
  switch (effect.kind) {
    case "pooled":
      return <span className="grid gap-1">{effect.pools.map((p) => <PooledValue key={p.key} pool={p} lang={lang} />)}</span>;
    case "range":
      return (
        <span className="grid gap-0.5">
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            {effect.measure && <span className="font-display">{effect.measure}</span>}
            <VerifiedNumber value={effect.lo.num} onSelect={() => onSelect(effect.lo.ref, effect.lo.outcomeKey)} title={effect.lo.ref} />
            <span className="font-display text-muted">{L(lang, "ถึง", "to")}</span>
            <VerifiedNumber value={effect.hi.num} onSelect={() => onSelect(effect.hi.ref, effect.hi.outcomeKey)} title={effect.hi.ref} />
          </span>
          <span className="text-[0.78rem] text-muted">
            {L(lang, `ช่วงของค่าที่ตรวจผ่านจาก ${effect.n} การศึกษา (${effect.lo.ref}, ${effect.hi.ref})`,
              `range of the verified values from ${effect.n} studies (${effect.lo.ref}, ${effect.hi.ref})`)}
            {effect.other > 0 && L(lang, ` · ค่าอื่นอีก ${effect.other} ค่า`, ` · ${effect.other} more`)}
          </span>
        </span>
      );
    case "single":
      return (
        <span className="grid gap-0.5">
          <StudyEffectValue state={{ kind: "verified", effect: effect.effect }} lang={lang} onSelect={onSelect} />
          <span className="text-[0.78rem] text-muted">
            {effect.effect.ref}{effect.other > 0 && L(lang, ` · ค่าอื่นอีก ${effect.other} ค่า`, ` · ${effect.other} more`)}
          </span>
        </span>
      );
    case "blanked":
      return <StudyEffectValue state={effect} lang={lang} onSelect={onSelect} />;
    default:
      return <span className="text-[0.88rem] text-muted">{L(lang, "ดูรายงานแต่ละการศึกษา", "See each study's report")}</span>;
  }
}

function Statement({ row, lang }: { row: SofRow; lang: Lang }) {
  if (row.statement) return <span className="break-words">{row.statement}</span>;
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
 * Summary of findings (Plan 20; SLR and meta-analysis): one row per outcome with the number of studies and their
 * designs, the participants (sum of verified sample sizes, a labelled count), the effect (pooled value as computed,
 * else the range of verified values, else a pointer to the studies), the certainty (⊕, an LLM-assisted GRADE-lite
 * judgement, not an expert GRADE assessment) and a plain statement. A real table: caption, scoped headers.
 */
export function SofTable({ rows, lang, onSelect, graded }: { rows: SofRow[]; lang: Lang; onSelect: Select; graded: boolean }) {
  if (!rows.length) return null;
  const caption = L(lang, "ตารางสรุปผลการศึกษาตามผลลัพธ์", "Summary of findings by outcome");
  return (
    <section aria-labelledby="h-sof" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="h-sof" className={SECTION_H2}>{L(lang, "ตารางสรุปผลการศึกษา", "Summary of findings")}</h2>
      <p className="max-w-[65ch] text-[0.85rem] text-muted" id="sof-note">
        {L(lang, "ระดับความแข็งแรงของหลักฐานเป็นการประเมินโดยโมเดลภาษา (GRADE-lite) ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ ตัวเลขที่มีเส้นใต้ลายเทปตรวจกับบทคัดย่อแล้ว ค่ารวมคำนวณโดยระบบ",
          "Certainty is an LLM-assisted judgement (GRADE-lite), not an expert GRADE assessment. Numbers with the striped underline were checked against the abstracts; pooled values are computed by the system.")}
      </p>
      <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto rounded-sm border border-rule">
        <table className="w-full min-w-[860px] border-collapse text-[0.9rem]" aria-describedby="sof-note">
          <caption className="sr-only">
            {caption} {L(lang, "(ระดับความแข็งแรงของหลักฐานประเมินโดยโมเดลภาษา ไม่ใช่ GRADE โดยผู้เชี่ยวชาญ)", "(certainty judged by a language model, not an expert GRADE assessment)")}
          </caption>
          <thead>
            <tr className="bg-ground">
              <th scope="col" className={`${TH} min-w-[10rem]`}>{L(lang, "ผลลัพธ์", "Outcome")}</th>
              <th scope="col" className={`${TH} min-w-[9.5rem]`}>{L(lang, "การศึกษา (รูปแบบ)", "Studies (designs)")}</th>
              <th scope="col" className={`${TH} min-w-[8.5rem]`}>{L(lang, "ผู้เข้าร่วม", "Participants")}</th>
              <th scope="col" className={`${TH} min-w-[11rem]`}>{L(lang, "ขนาดผล", "Effect")}</th>
              <th scope="col" className={`${TH} min-w-[7.5rem]`}><Term k="evidenceStrength" lang={lang}>{L(lang, "ความแข็งแรงของหลักฐาน", "Certainty")}</Term></th>
              <th scope="col" className={`${TH} min-w-[13rem]`}>{L(lang, "สรุป", "What it means")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.outcome} className="border-t border-rule" data-sof-row>
                <th scope="row" className={`${TD} text-left font-display font-semibold break-words`}>{r.outcome}</th>
                <td className={TD}>
                  <span className="font-display font-semibold tabular-nums">{r.k}</span>
                  {r.designs.length > 0 && (
                    <ul className="mt-0.5 grid text-[0.8rem] text-muted" aria-label={L(lang, "รูปแบบการศึกษา", "Designs")}>
                      {r.designs.map((d) => <li key={d.label}>{d.label} <span className="font-display tabular-nums">{d.count}</span></li>)}
                    </ul>
                  )}
                </td>
                <td className={TD}><Participants row={r} lang={lang} /></td>
                <td className={TD}><Effect effect={r.effect} lang={lang} onSelect={onSelect} /></td>
                <td className={TD}>
                  {graded && r.certainty ? <CertaintyMark level={r.certainty} lang={lang} />
                    : <span className="text-[0.88rem] text-muted">{L(lang, "ไม่ได้ประเมิน", "Not assessed")}</span>}
                </td>
                <td className={TD}><Statement row={r} lang={lang} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
