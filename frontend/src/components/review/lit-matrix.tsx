"use client";

import { useMemo, useState, type ReactNode } from "react";
import { exportUrl } from "@/lib/api";
import { isNonQuantitative } from "@/lib/charts-data";
import { DIRECTION_LABEL, ROB_LABEL, type Lang } from "@/lib/i18n";
import { SOURCE_ABBR, SOURCE_LABEL } from "@/lib/citation-network";
import {
  litColumnLabel, litColumns, litFramework, litRows, outcomesClamped, paginate, type LitColumn, type LitFramework, type LitRow,
} from "@/lib/lit-matrix";
import type { ReviewTypeOrLegacy } from "@/lib/review-type";
import type { Citations, Paper, QuestionBlock } from "@/lib/types";
import { DesignMismatchFlag, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { SectionHeading } from "./report-nav";
import { ReadingFlag } from "./report-parts";
import { ScrollRegion } from "./scroll-region";
import { useWide } from "./stage/use-wide";
import { L } from "./text";

/** Rows per page (Plan 20 Task 5): a long matrix is paged, never a 10,000px wall. */
export const LIT_PAGE_SIZE = 15;

const CLAMP = "line-clamp-3 break-words";
const TD = "px-2.5 py-2 align-top";

function NCell({ cell, lang }: { cell: LitRow["n"]; lang: Lang }) {
  if (cell.kind === "value") return <VerifiedNumber value={cell.text} />;
  if (cell.kind === "blanked") return <Hole lang={lang} />;
  return <span className="text-muted">{L(lang, "ไม่ได้รายงาน", "not reported")}</span>;
}

/**
 * A count from OpenAlex / Europe PMC (display face, never the verified-number face) with a visible source tag
 * ("OA" / "EPMC"; the full name for screen readers), since the two sources count differently.
 */
function CitedBy({ row, lang }: { row: LitRow; lang: Lang }) {
  const c = row.citedBy;
  if (!c || c.count == null) {
    // relative: keeps the absolutely positioned sr-only text inside the matrix's scroll container (no page overflow)
    return <span className="relative text-muted" title={L(lang, "ไม่มีข้อมูล", "No data")}>–<span className="sr-only">{L(lang, "ไม่มีข้อมูล", "No data")}</span></span>;
  }
  const source = c.source ? SOURCE_LABEL[c.source] : L(lang, "ไม่ทราบแหล่ง", "source unknown");
  return (
    <span className="relative inline-flex items-baseline gap-1 whitespace-nowrap" title={L(lang, `จำนวนครั้งที่ถูกอ้างอิงทั้งหมด จาก ${source}`, `Total cited-by count, from ${source}`)}>
      <span className="font-display tabular-nums">{c.count.toLocaleString("en-US")}</span>
      <span className="font-display text-[0.7rem] text-muted">
        <span aria-hidden="true">{c.source ? SOURCE_ABBR[c.source] : "?"}</span>
        <span className="sr-only">{` (${source})`}</span>
      </span>
    </span>
  );
}

/** Says what the column counts and what the source tags mean, once under the matrix. */
function CitedByNote({ lang }: { lang: Lang }) {
  return (
    <p className="text-[0.82rem] text-muted">
      {L(lang, "ถูกอ้างอิง: จำนวนครั้งที่ถูกอ้างอิงในวรรณกรรมทั้งหมด · OA = OpenAlex · EPMC = Europe PMC (สองแหล่งนับต่างกัน) · – = ไม่มีข้อมูล",
        "Cited by: total cited-by count in all literature · OA = OpenAlex · EPMC = Europe PMC (the two count differently) · – = no data")}
    </p>
  );
}

/** One outcome with its verified effect (or the reason there is none), inline. */
function OutcomeItem({ o, row, lang }: { o: LitRow["outcomes"][number]; row: LitRow; lang: Lang }) {
  return (
    <span className="break-words">
      <span>{o.name}</span>{" "}
      {o.effect && "blanked" in o.effect ? <Hole lang={lang} />
        : o.effect ? <><VerifiedNumber value={o.effect.label} />{o.effect.ci && <> (95% CI <VerifiedNumber value={o.effect.ci} />)</>}</>
        : row.theme ? <span className="text-muted">{L(lang, "(ประเด็น)", "(theme)")}</span>
        : o.reportsNone ? <span className="text-muted">{L(lang, "ไม่รายงานตัวเลข", "no numbers reported")}</span>
        : <span className="text-muted">{L(lang, "ไม่ได้สกัดตัวเลข", "number not extracted")}</span>}
      {o.otherComparison && (
        <span className="text-sm text-muted" data-other-comparison>
          {" "}({L(lang, "การเปรียบเทียบอื่น ไม่นำไปสรุป", "other comparison, not used in the synthesis")}{o.comparison ? `: ${o.comparison}` : ""})
        </span>
      )}
    </span>
  );
}

/** The outcomes cell: clamped to two lines when long, with "show all" opening the paper (every outcome) in the rail. */
function Outcomes({ row, lang, onSelect }: { row: LitRow; lang: Lang; onSelect: (ref: string) => void }) {
  if (!row.outcomes.length) return <span className="text-muted">{row.theme ? "–" : L(lang, "ไม่ได้สกัดผลลัพธ์", "No outcomes extracted")}</span>;
  const clamped = outcomesClamped(row);
  const items = row.outcomes.map((o, i) => <span key={i}>{i > 0 && <span className="text-muted"> · </span>}<OutcomeItem o={o} row={row} lang={lang} /></span>);
  if (!clamped) return <p className="break-words">{items}</p>;
  return (
    <span className="grid justify-items-start gap-0.5">
      <p className="line-clamp-2 break-words" data-clamped>{items}</p>
      <button type="button" onClick={() => onSelect(row.ref)}
        aria-label={L(lang, `แสดงผลลัพธ์ทั้งหมดของ ${row.ref} (${row.outcomes.length})`, `Show all outcomes of ${row.ref} (${row.outcomes.length})`)}
        className="inline-flex min-h-11 items-center font-display text-[0.8rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
        {L(lang, `แสดงทั้งหมด (${row.outcomes.length})`, `Show all (${row.outcomes.length})`)}
      </button>
    </span>
  );
}

function Cell({ col, row, lang, onSelect }: { col: LitColumn; row: LitRow; lang: Lang; onSelect: (ref: string) => void }) {
  switch (col) {
    case "year": return <span className="font-display tabular-nums">{row.year ?? "–"}</span>;
    case "design":
      return (
        <span className="grid gap-1">
          {row.design?.pooled ? <Term k="srma" lang={lang}>{row.design.label}</Term> : <span>{row.design?.label}</span>}
          {row.designMismatch && <DesignMismatchFlag lang={lang} />}
        </span>
      );
    case "population":
      return (
        <span className="grid gap-0.5">
          <span className={CLAMP} title={row.population}>{row.population || "–"}</span>
          <span className="text-[0.8rem]"><span className="text-muted">n = </span><NCell cell={row.n} lang={lang} /></span>
        </span>
      );
    case "exposure":
      return (
        <span className="grid gap-0.5">
          <span className={CLAMP} title={row.exposure}>{row.exposure || "–"}</span>
          {row.comparator && <span className="line-clamp-2 text-[0.8rem] break-words" title={row.comparator}><span className="text-muted">{L(lang, "เทียบกับ ", "vs ")}</span>{row.comparator}</span>}
        </span>
      );
    case "outcomes": return <Outcomes row={row} lang={lang} onSelect={onSelect} />;
    case "direction":
      return row.direction ? (
        <span className="grid gap-1">
          <span className="inline-flex items-center gap-1.5"><Glyph direction={row.direction} lang={lang} />{DIRECTION_LABEL[lang][row.direction]}</span>
          {row.uncertain && <ReadingFlag lang={lang} />}
        </span>
      ) : row.theme ? (
        <span className="grid gap-1">
          <span className="text-muted" data-theme-paper>{L(lang, "ประเด็น ไม่มีทิศทางผล", "Themes, no direction")}</span>
          {row.uncertain && <ReadingFlag lang={lang} />}
        </span>
      ) : row.uncertain ? <ReadingFlag lang={lang} /> : null;
    case "risk": return <>{row.risk ? ROB_LABEL[lang][row.risk] : "–"}</>;
    case "citedBy": return <CitedBy row={row} lang={lang} />;
    default: return null;
  }
}

/** A failed extraction spans the card columns; year and the cited-by count do not depend on the card. */
function FailedCells({ others, row, lang }: { others: LitColumn[]; row: LitRow; lang: Lang }) {
  const at = others.indexOf("citedBy");
  const failed = (span: number) => <td colSpan={span} className={`${TD} text-err`}>{L(lang, "สกัดข้อมูลไม่สำเร็จ", "Extraction failed")}</td>;
  if (at < 0) return failed(others.length);
  const after = others.length - at - 1;
  return (
    <>
      {at > 0 && failed(at)}
      <td className={TD}><CitedBy row={row} lang={lang} /></td>
      {after > 0 && <td colSpan={after} className={TD} />}
    </>
  );
}

function RefButton({ row, onSelect }: { row: LitRow; onSelect: (ref: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(row.ref)} title={row.title} aria-label={`${row.ref} ${row.title}`}
      className="inline-flex min-h-11 min-w-11 flex-col items-start justify-center text-left text-primary underline underline-offset-2">
      <span className="font-display font-semibold">{row.ref}</span>
      {row.byline && <span className="text-[0.75rem] font-normal text-muted no-underline">{row.byline}</span>}
    </button>
  );
}

function MatrixTable({ rows, cols, framework, lang, onSelect, caption }: {
  rows: LitRow[]; cols: LitColumn[]; framework: LitFramework; lang: Lang; onSelect: (ref: string) => void; caption: string;
}) {
  const others = cols.slice(1);
  return (
    <ScrollRegion lang={lang} label={L(lang, `${caption} (เลื่อนดูได้)`, `${caption} (scrollable)`)}>
      <table aria-label={caption} className="w-full min-w-[880px] border-collapse text-[0.85rem]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-ground">
            {cols.map((c) => (
              <th key={c} scope="col" className={`label px-2.5 py-2 text-left ${COL_WIDTH[c]} ${c === "ref" ? "sticky left-0 z-10 bg-ground" : c === "citedBy" ? "whitespace-nowrap" : ""}`}>
                {litColumnLabel(c, framework, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ref} className="border-t border-rule">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2.5 py-2 text-left align-top font-body font-medium">
                <RefButton row={row} onSelect={onSelect} />
                {/* the direction column is dropped (scoping, themes), so the uncertain flag lives next to the ref */}
                {!cols.includes("direction") && row.uncertain && <ReadingFlag lang={lang} />}
              </th>
              {row.failed ? (
                <FailedCells others={others} row={row} lang={lang} />
              ) : others.map((c) => <td key={c} className={TD}><Cell col={c} row={row} lang={lang} onSelect={onSelect} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** Minimum column widths: the text columns get room to read, short columns stay narrow. */
const COL_WIDTH: Record<LitColumn, string> = {
  ref: "min-w-[8rem]", year: "", design: "min-w-[7.5rem]", population: "min-w-[11rem]", exposure: "min-w-[10rem]",
  outcomes: "min-w-[15rem]", direction: "min-w-[8rem]", risk: "min-w-[6rem]", citedBy: "",
};

/** Below 1024px: one ruled card per study (no nested card chrome), the same cells as the table. */
function MatrixCards({ rows, cols, framework, lang, onSelect, caption }: {
  rows: LitRow[]; cols: LitColumn[]; framework: LitFramework; lang: Lang; onSelect: (ref: string) => void; caption: string;
}) {
  const fields = cols.filter((c) => c !== "ref" && c !== "year");
  return (
    <ul aria-label={caption} className="grid border-t border-rule" data-lit-cards>
      {rows.map((row) => (
        <li key={row.ref} className="grid gap-2 border-b border-rule py-3" data-lit-card={row.ref}>
          <div className="flex flex-wrap items-center gap-x-3">
            <RefButton row={row} onSelect={onSelect} />
            {row.year != null && !row.byline.includes(String(row.year)) && <span className="font-display tabular-nums text-muted">{row.year}</span>}
            {!cols.includes("direction") && row.uncertain && <ReadingFlag lang={lang} />}
          </div>
          {row.failed ? (
            <p className="text-err">{L(lang, "สกัดข้อมูลไม่สำเร็จ", "Extraction failed")}</p>
          ) : (
            <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.88rem] sm:grid-cols-[9rem_minmax(0,1fr)]">
              {fields.map((c) => (
                <CardField key={c} label={litColumnLabel(c, framework, lang)}><Cell col={c} row={row} lang={lang} onSelect={onSelect} /></CardField>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="label pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Pager({ page, pages, start, end, total, lang, onPage }: {
  page: number; pages: number; start: number; end: number; total: number; lang: Lang; onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-rule px-3 font-display text-[0.85rem] hover:border-ink disabled:opacity-45 disabled:hover:border-rule";
  return (
    <nav aria-label={L(lang, "หน้าของตารางงานวิจัย", "Literature matrix pages")} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-lit-pager>
      <button type="button" className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>{L(lang, "← ก่อนหน้า", "← Previous")}</button>
      <span className="font-display text-[0.85rem] tabular-nums text-muted" aria-live="polite">
        {L(lang, `${start + 1}–${end} จาก ${total} งาน · หน้า ${page + 1}/${pages}`, `${start + 1}–${end} of ${total} studies · page ${page + 1}/${pages}`)}
      </span>
      <button type="button" className={btn} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{L(lang, "ถัดไป →", "Next →")}</button>
    </nav>
  );
}

/**
 * Literature review matrix (Plan 20 Task 5): compact columns (study, year, design, population/sample, intervention,
 * outcomes, direction), framework-aware labels (PICO, PCC, PICo, SPIDER-like), 15 rows a page, a table with a sticky
 * first column from 1024px and ruled cards below it.
 */
export function LitMatrixSection({ papers, allPapers = papers, lang, type, onSelect, reviewId, offline = false, citations = null, question = null }: {
  papers: Paper[]; allPapers?: Paper[]; lang: Lang; type: ReviewTypeOrLegacy; onSelect: (ref: string) => void; reviewId: string; offline?: boolean;
  citations?: Citations | null; question?: QuestionBlock | null;
}) {
  const wide = useWide();
  const rows = useMemo(() => litRows(papers, lang, citations), [papers, lang, citations]);
  const allRows = useMemo(() => (allPapers === papers ? rows : litRows(allPapers, lang, citations)), [allPapers, papers, rows, lang, citations]);
  // The columns and framework follow the whole review, so they do not change while the reader filters.
  const framework = litFramework(type, allPapers, question);
  const cols = litColumns(type, allRows, framework);
  const [page, setPage] = useState(0);
  const pg = paginate(rows, page, LIT_PAGE_SIZE);
  const caption = L(lang, "ตารางสรุปงานวิจัย", "Study summary table");
  const context = question?.context?.trim();
  return (
    <section aria-labelledby="h-litmatrix" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-lit-framework={framework}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionHeading id="h-litmatrix">{L(lang, "ตารางงานวิจัย", "Literature review matrix")}</SectionHeading>
        {!offline && (
          <a href={exportUrl(reviewId, "csv")} download
            className="inline-flex min-h-11 items-center font-display text-[0.9rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
            {L(lang, "ดาวน์โหลด CSV", "Download CSV")}
          </a>
        )}
      </div>
      <p className="text-[0.82rem] text-muted">
        {framework === "pico_qual" ? L(lang, "กรอบ PICo: ประชากร ปรากฏการณ์ที่สนใจ และบริบท", "PICo framework: population, phenomenon of interest and context")
          : framework === "spider" ? L(lang, "กรอบแบบ SPIDER: กลุ่มตัวอย่าง ปรากฏการณ์ที่สนใจ รูปแบบ การประเมิน และชนิดงานวิจัย", "SPIDER-like framework: sample, phenomenon of interest, design, evaluation and research type")
            : L(lang, "ข้อค้นพบหลักและข้อจำกัดของแต่ละงานอยู่ในแถบต้นฉบับ (แตะชื่องาน) และไฟล์ CSV", "Each study's key findings and limitations are in the source rail (tap the study) and the CSV")}
        {(framework === "pico_qual" || framework === "spider" || framework === "pcc") && context && (
          <> · <span data-lit-context>{L(lang, `บริบท (Co): ${context}`, `Context (Co): ${context}`)}</span></>
        )}
      </p>
      {rows.length === 0 ? (
        <p className="text-[0.9rem] text-muted">{L(lang, "ไม่มีงานวิจัยที่ตรงกับตัวกรอง", "No studies match the filters")}</p>
      ) : wide ? (
        <MatrixTable rows={pg.items} cols={cols} framework={framework} lang={lang} onSelect={onSelect} caption={caption} />
      ) : (
        <MatrixCards rows={pg.items} cols={cols} framework={framework} lang={lang} onSelect={onSelect} caption={caption} />
      )}
      <Pager page={pg.page} pages={pg.pages} start={pg.start} end={pg.end} total={rows.length} lang={lang} onPage={setPage} />
      {rows.length > 0 && cols.includes("citedBy") && <CitedByNote lang={lang} />}
      {allPapers.some((p) => isNonQuantitative(p.card_en ?? p.card)) && (
        <p className="text-[0.82rem] text-muted" data-note="qualitative">
          {L(lang, "งานเชิงคุณภาพและแบบผสมผสานสรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข และไม่นับในทิศทางผล แผนภาพ หรือค่ารวม",
            "Qualitative and mixed-methods studies are summarised as themes from the abstract: no effect numbers, and not counted in directions, plots or pooled estimates")}
        </p>
      )}
    </section>
  );
}
