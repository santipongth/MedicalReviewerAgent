"use client";

import { exportUrl } from "@/lib/api";
import { DIRECTION_LABEL, LIT_COLUMN_LABEL, ROB_LABEL, type Lang } from "@/lib/i18n";
import { litColumns, litRows, type LitColumn, type LitRow } from "@/lib/lit-matrix";
import type { ReviewTypeOrLegacy } from "@/lib/review-type";
import type { Paper } from "@/lib/types";
import { Glyph, Hole, UncertainFlag, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

const CLAMP = "line-clamp-4 break-words";
const TD = "min-h-9 px-2.5 py-2 align-top";

function Number_({ cell, lang }: { cell: LitRow["n"]; lang: Lang }) {
  if (cell.kind === "value") return <VerifiedNumber value={cell.text} />;
  if (cell.kind === "blanked") return <Hole lang={lang} />;
  return <span className="text-muted">–</span>;
}

function Outcomes({ row, lang }: { row: LitRow; lang: Lang }) {
  if (!row.outcomes.length) return <span className="text-muted">{L(lang, "ไม่รายงานตัวเลข", "No numbers reported")}</span>;
  return (
    <ul className="grid gap-1">
      {row.outcomes.map((o, i) => (
        <li key={i} className="break-words">
          <span>{o.name}</span>{" "}
          {o.effect && "blanked" in o.effect ? <Hole lang={lang} />
            : o.effect ? <><VerifiedNumber value={o.effect.label} />{o.effect.ci && <> (95% CI <VerifiedNumber value={o.effect.ci} />)</>}</>
            : <span className="text-muted">{L(lang, "ไม่รายงานตัวเลข", "no numbers reported")}</span>}
        </li>
      ))}
    </ul>
  );
}

function Cell({ col, row, lang }: { col: LitColumn; row: LitRow; lang: Lang }) {
  switch (col) {
    case "design":
      return row.design?.pooled ? <Term k="srma" lang={lang}>{row.design.label}</Term> : <>{row.design?.label}</>;
    case "population": return <p className={CLAMP}>{row.population}</p>;
    case "exposure": return <p className={CLAMP}>{row.exposure}</p>;
    case "comparator": return <p className={CLAMP}>{row.comparator || "–"}</p>;
    case "outcomes": return <Outcomes row={row} lang={lang} />;
    case "findings": return <p className={CLAMP}>{row.findings || "–"}</p>;
    case "direction":
      return row.direction ? (
        <span className="grid gap-1">
          <span className="inline-flex items-center gap-1.5"><Glyph direction={row.direction} lang={lang} />{DIRECTION_LABEL[lang][row.direction]}</span>
          {row.uncertain && <UncertainFlag lang={lang} />}
        </span>
      ) : null;
    case "risk": return <>{row.risk ? ROB_LABEL[lang][row.risk] : "–"}</>;
    case "n": return <Number_ cell={row.n} lang={lang} />;
    case "limitations": return <p className={CLAMP}>{row.limitations || "–"}</p>;
    default: return null;
  }
}

/** Literature review matrix: one row per paper, scrolling inside its own container with a sticky first column. */
export function LitMatrixSection({ papers, lang, type, onSelect, reviewId, offline = false }: {
  papers: Paper[]; lang: Lang; type: ReviewTypeOrLegacy; onSelect: (ref: string) => void; reviewId: string; offline?: boolean;
}) {
  const rows = litRows(papers, lang);
  const cols = litColumns(type, rows);
  const others = cols.slice(1);
  return (
    <section aria-labelledby="h-litmatrix" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="h-litmatrix" className={SECTION_H2}>{L(lang, "ตารางงานวิจัย", "Literature review matrix")}</h2>
        {!offline && (
          <a href={exportUrl(reviewId, "csv")} download
            className="inline-flex min-h-11 items-center font-display text-[0.9rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
            {L(lang, "ดาวน์โหลด CSV", "Download CSV")}
          </a>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีงานวิจัยที่ตรงกับตัวกรอง", "No studies match the filters")}</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-rule">
          <table aria-label={L(lang, "ตารางสรุปงานวิจัย", "Study summary table")} className="w-full min-w-[1100px] border-collapse text-[0.85rem]">
            <thead>
              <tr className="bg-ground">
                {cols.map((c) => (
                  <th key={c} scope="col" className={`label px-2.5 py-2 text-left ${c === "ref" ? "sticky left-0 z-10 min-w-[9rem] bg-ground" : ""}`}>
                    {LIT_COLUMN_LABEL[lang][c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ref} className="border-t border-rule">
                  <th scope="row" className="sticky left-0 z-10 min-w-[9rem] bg-surface px-2.5 py-2 text-left align-top font-body font-medium">
                    <button type="button" onClick={() => onSelect(row.ref)} title={row.title}
                      aria-label={`${row.ref} ${row.title}`}
                      className="inline-flex min-h-11 min-w-11 flex-col items-start justify-center text-left text-primary underline underline-offset-2">
                      <span className="font-display font-semibold">{row.ref}</span>
                      {row.byline && <span className="text-[0.75rem] font-normal text-muted no-underline">{row.byline}</span>}
                    </button>
                  </th>
                  {row.failed ? (
                    <td colSpan={others.length} className={`${TD} text-err`}>{L(lang, "สกัดข้อมูลไม่สำเร็จ", "Extraction failed")}</td>
                  ) : others.map((c) => <td key={c} className={TD}><Cell col={c} row={row} lang={lang} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
