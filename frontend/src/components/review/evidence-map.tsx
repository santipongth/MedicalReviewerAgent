"use client";

import type { EvidenceMap, MapTable } from "@/lib/evidence-map";
import type { Lang } from "@/lib/i18n";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

function Count({ n }: { n: number | undefined }) {
  return <td className="h-11 px-2 text-center font-display tabular-nums md:h-9">{n ? n : <span className="text-muted">–</span>}</td>;
}

/** Counts only (font-display tabular-nums, never VerifiedNumber): rows × design categories, then a total. */
function CountTable({ table, label, corner, lang }: { table: MapTable; label: string; corner: string; lang: Lang }) {
  return (
    <div className="overflow-x-auto rounded-sm border border-rule" tabIndex={0} role="region" aria-label={L(lang, `${label} (เลื่อนดูได้)`, `${label} (scrollable)`)}>
      <table aria-label={label} className="w-full border-collapse text-[0.88rem]">
        <thead>
          <tr className="bg-ground">
            <th scope="col" className="sticky left-0 z-10 min-w-[9rem] bg-ground px-2.5 py-2 text-left label sm:min-w-[190px]">{corner}</th>
            {table.designs.map((d) => <th key={d.key} scope="col" className="px-2 py-2 text-center label whitespace-nowrap">{d.label}</th>)}
            <th scope="col" className="px-2 py-2 text-center label">{L(lang, "รวม", "Total")}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key} className="border-t border-rule">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2.5 py-2 text-left font-body font-medium break-words">{row.label}</th>
              {table.designs.map((d) => <Count key={d.key} n={row.counts[d.key]} />)}
              <td className="h-11 px-2 text-center font-display font-semibold tabular-nums md:h-9">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Scoping evidence map: how many studies per concept × design, and per five-year period × design. */
export function EvidenceMapSection({ map, lang }: { map: EvidenceMap; lang: Lang }) {
  if (!map.byConcept.rows.length && !map.byYear.rows.length) return null;
  return (
    <section aria-labelledby="h-evidence-map" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h2 id="h-evidence-map" className={SECTION_H2}>{L(lang, "แผนที่หลักฐาน", "Evidence map")}</h2>
      <p className="text-[0.85rem] text-muted">{L(lang, "จำนวนงานที่พบ ไม่ใช่การประเมินว่าได้ผล", "Number of studies found, not an assessment of whether something works")}</p>
      {map.byConcept.rows.length > 0 && (
        <CountTable table={map.byConcept} lang={lang}
          label={L(lang, "จำนวนงานวิจัยตามประเด็นและชนิดงานวิจัย", "Studies by concept and design")}
          corner={L(lang, "ประเด็น", "Concept")} />
      )}
      {map.byConcept.rows.length > 0 && (
        <p className="text-[0.82rem] text-muted">
          {L(lang, "ตารางแรกนับงานวิจัยตามแนวคิดหรือประเด็นในตารางเปรียบเทียบ งานเดียวอาจอยู่หลายแถว", "The first table counts papers per concept (comparison row); one paper can appear in several rows")}
          {map.outsideConcepts > 0 && ` · ${L(lang, `ไม่ได้จัดเข้าแนวคิดใด ${map.outsideConcepts} งาน`, `${map.outsideConcepts} not placed under any concept`)}`}
        </p>
      )}
      {map.byYear.rows.length > 0 && (
        <CountTable table={map.byYear} lang={lang}
          label={L(lang, "จำนวนงานวิจัยตามช่วงปีและชนิดงานวิจัย", "Studies by period and design")}
          corner={L(lang, "ช่วงปี (5 ปี)", "Period (5 years)")} />
      )}
      {map.unplaced > 0 && (
        <p className="text-[0.82rem] text-muted">
          {L(lang, `ตารางช่วงปีไม่รวม ${map.unplaced} ฉบับที่ไม่มีปีหรืออ่านไม่สำเร็จ`, `The period table leaves out ${map.unplaced} studies without a year or that could not be read`)}
        </p>
      )}
    </section>
  );
}
