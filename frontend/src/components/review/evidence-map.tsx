"use client";

import { useState } from "react";
import { rampLevel, type EvidenceMap, type MapTable } from "@/lib/evidence-map";
import type { Lang } from "@/lib/i18n";
import { plural } from "@/lib/plural";
import { SectionHeading } from "./report-nav";
import { ScrollRegion } from "./scroll-region";
import { L } from "./text";

/** Concept rows shown before "show all" (Plan 20 Task 5). */
export const EVIDENCE_MAP_TOP = 15;

/** One hue (the ink token tinted into the surface) in five steps; the count is always printed, so colour is never the only cue. */
const RAMP = ["", "color-mix(in srgb, var(--ink) 7%, var(--surface))", "color-mix(in srgb, var(--ink) 13%, var(--surface))",
  "color-mix(in srgb, var(--ink) 19%, var(--surface))", "color-mix(in srgb, var(--ink) 26%, var(--surface))"];

function Count({ n, max, strong = false }: { n: number | undefined; max: number; strong?: boolean }) {
  const level = rampLevel(n, max);
  return (
    <td className={`h-11 px-2 text-center font-display tabular-nums md:h-9 ${strong ? "font-semibold" : ""}`}
      style={level ? { background: RAMP[level] } : undefined} data-ramp={level}>
      {n ? n : <span className="text-muted">–</span>}
    </td>
  );
}

/** Counts only (font-display tabular-nums, never VerifiedNumber): rows × (total, then design categories). */
function CountTable({ table, label, corner, lang, limit }: { table: MapTable; label: string; corner: string; lang: Lang; limit?: number }) {
  const [all, setAll] = useState(false);
  const rows = limit && !all ? table.rows.slice(0, limit) : table.rows;
  const max = Math.max(0, ...table.rows.flatMap((r) => Object.values(r.counts)));
  const maxTotal = Math.max(0, ...table.rows.map((r) => r.total));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <ScrollRegion lang={lang} label={L(lang, `${label} (เลื่อนดูได้)`, `${label} (scrollable)`)}>
        <table className="w-full border-collapse text-[0.88rem]">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="bg-ground">
              <th scope="col" className="sticky left-0 z-10 min-w-[9rem] bg-ground px-2.5 py-2 text-left label sm:min-w-[190px]">{corner}</th>
              <th scope="col" className="border-r border-rule px-2 py-2 text-center label">{L(lang, "รวม", "Total")}</th>
              {table.designs.map((d) => <th key={d.key} scope="col" className="px-2 py-2 text-center label whitespace-nowrap">{d.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-rule">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-2.5 py-2 text-left font-body font-medium break-words">{row.label}</th>
                <Count n={row.total} max={maxTotal} strong />
                {table.designs.map((d) => <Count key={d.key} n={row.counts[d.key]} max={max} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {limit != null && table.rows.length > limit && (
        <button type="button" onClick={() => setAll((a) => !a)} aria-pressed={all}
          className="inline-flex min-h-11 w-fit items-center font-display text-[0.9rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
          {all ? L(lang, `แสดง ${limit} อันดับแรก`, `Show the top ${limit}`) : L(lang, `แสดงทั้งหมด (${table.rows.length})`, `Show all (${table.rows.length})`)}
        </button>
      )}
    </div>
  );
}

/** Scoping evidence map: how many studies per concept × design (most studies first), and per five-year period × design. */
export function EvidenceMapSection({ map, lang }: { map: EvidenceMap; lang: Lang }) {
  if (!map.byConcept.rows.length && !map.byYear.rows.length) return null;
  return (
    <section aria-labelledby="h-evidence-map" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <SectionHeading id="h-evidence-map">{L(lang, "แผนที่หลักฐาน", "Evidence map")}</SectionHeading>
      <p className="text-[0.85rem] text-muted">
        {L(lang, "จำนวนงานที่พบ ไม่ใช่การประเมินว่าได้ผล · สีเข้มขึ้นตามจำนวน (ตัวเลขอยู่ในทุกช่อง)",
          "Number of studies found, not an assessment of whether something works · darker cells hold more studies (every cell shows its number)")}
      </p>
      {map.byConcept.rows.length > 0 && (
        <CountTable table={map.byConcept} lang={lang} limit={EVIDENCE_MAP_TOP}
          label={L(lang, "จำนวนงานวิจัยตามประเด็นและชนิดงานวิจัย", "Studies by concept and design")}
          corner={L(lang, "ประเด็น", "Concept")} />
      )}
      {map.byConcept.rows.length > 0 && (
        <p className="text-[0.82rem] text-muted">
          {L(lang, "ตารางแรกนับงานวิจัยตามแนวคิดหรือประเด็นในตารางเปรียบเทียบ เรียงจากประเด็นที่มีงานมากที่สุด งานเดียวอาจอยู่หลายแถว",
            "The first table counts papers per concept (comparison row), most studies first; one paper can appear in several rows")}
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
          {L(lang, `ตารางช่วงปีไม่รวม ${map.unplaced} ฉบับที่ไม่มีปีหรืออ่านไม่สำเร็จ`, `The period table leaves out ${map.unplaced} ${plural(map.unplaced, "study", "studies")} without a year or that could not be read`)}
        </p>
      )}
    </section>
  );
}
