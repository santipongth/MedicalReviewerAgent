"use client";

import { useMemo, useState, type ReactNode } from "react";
import { exportUrl } from "@/lib/api";
import { isNonQuantitative } from "@/lib/charts-data";
import { DIRECTION_LABEL, ROB_LABEL, type Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { SOURCE_ABBR, SOURCE_LABEL } from "@/lib/citation-network";
import {
  litColumnLabel, litColumns, litFramework, litRows, outcomesClamped, paginate, showsCitedBy, type LitColumn, type LitFramework, type LitRow,
} from "@/lib/lit-matrix";
import { showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { relatedLabel } from "@/lib/trial-reports";
import type { Citations, Paper, QuestionBlock } from "@/lib/types";
import { DesignMismatchFlag, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { ThaiText } from "../ui/thai-text";
import { SectionHeading } from "./report-nav";
import { ReadingFlag } from "./report-parts";
import { ScrollRegion } from "./scroll-region";
import { useMinWidth } from "./use-min-width";
import { L } from "./text";

const T = RC.lit;

/** Rows per page (Plan 20 Task 5): a long matrix is paged, never a 10,000px wall. */
export const LIT_PAGE_SIZE = 15;
/** The table needs the reading column of the 1280px layout; narrower screens get ruled cards. */
export const LIT_TABLE_MIN_WIDTH = 1280;

const CLAMP = "line-clamp-3 break-words";
const TD = "px-2.5 py-2 align-top";

function NCell({ cell, lang }: { cell: LitRow["n"]; lang: Lang }) {
  if (cell.kind === "value") return <VerifiedNumber value={cell.text} />;
  if (cell.kind === "blanked") return <Hole lang={lang} />;
  return <span className="text-muted">{L(lang, T.notReported)}</span>;
}

/**
 * A count from OpenAlex / Europe PMC (display face, never the verified-number face) with a visible source tag
 * ("OA" / "EPMC"; the full name for screen readers), since the two sources count differently.
 */
function CitedBy({ row, lang }: { row: LitRow; lang: Lang }) {
  const c = row.citedBy;
  if (!c || c.count == null) {
    // relative: keeps the absolutely positioned sr-only text inside the matrix's scroll container (no page overflow)
    return <span className="relative text-muted" title={L(lang, T.noData)}>–<span className="sr-only">{L(lang, T.noData)}</span></span>;
  }
  const source = c.source ? SOURCE_LABEL[c.source] : L(lang, T.sourceUnknown);
  return (
    <span className="relative inline-flex items-baseline gap-1 whitespace-nowrap" title={L(lang, T.citedByFrom(source))}>
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
    <p className="text-[0.82rem] text-muted">{L(lang, T.citedByNote)}</p>
  );
}

/** One outcome with its verified effect (or the reason there is none), inline. */
function OutcomeItem({ o, row, lang }: { o: LitRow["outcomes"][number]; row: LitRow; lang: Lang }) {
  return (
    <span className="break-words">
      <span lang={fieldLang(o.name, lang)}>{o.name}</span>{" "}
      {o.effect && "blanked" in o.effect ? <Hole lang={lang} />
        : o.effect ? <><VerifiedNumber value={o.effect.label} />{o.effect.ci && <> (95% CI <VerifiedNumber value={o.effect.ci} />)</>}</>
        : row.theme ? <span className="text-muted">{L(lang, T.theme)}</span>
        : o.reportsNone ? <span className="text-muted">{L(lang, T.noNumbers)}</span>
        : <span className="text-muted">{L(lang, T.notExtracted)}</span>}
      {o.otherComparison && (
        <span className="text-sm text-muted" data-other-comparison>
          {" "}({L(lang, T.otherComparison)}{o.comparison ? `: ${o.comparison}` : ""})
        </span>
      )}
    </span>
  );
}

/** The outcomes cell: clamped to two lines when long, with "show all" opening the paper (every outcome) in the rail. */
function Outcomes({ row, lang, onSelect }: { row: LitRow; lang: Lang; onSelect: (ref: string) => void }) {
  if (!row.outcomes.length) return <span className="text-muted">{row.theme ? "–" : L(lang, T.noOutcomes)}</span>;
  const clamped = outcomesClamped(row);
  const items = row.outcomes.map((o, i) => <span key={i}>{i > 0 && <span className="text-muted"> · </span>}<OutcomeItem o={o} row={row} lang={lang} /></span>);
  if (!clamped) return <p className="break-words">{items}</p>;
  return (
    <span className="grid justify-items-start gap-0.5">
      <p className="line-clamp-2 break-words" data-clamped>{items}</p>
      <button type="button" onClick={() => onSelect(row.ref)}
        aria-label={L(lang, T.showAllOf(row.ref, row.outcomes.length))}
        className="inline-flex min-h-11 items-center font-display text-[0.8rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
        {L(lang, T.showAll(row.outcomes.length))}
      </button>
    </span>
  );
}

function Cell({ col, row, lang, onSelect, risk }: { col: LitColumn; row: LitRow; lang: Lang; onSelect: (ref: string) => void; risk: boolean }) {
  switch (col) {
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
          <span className={CLAMP} title={row.population} lang={fieldLang(row.population, lang)}>{row.population || "–"}</span>
          <span className="text-[0.8rem]"><span className="text-muted">n = </span><NCell cell={row.n} lang={lang} /></span>
        </span>
      );
    case "exposure":
      return (
        <span className="grid gap-0.5">
          <span className={CLAMP} title={row.exposure} lang={fieldLang(row.exposure, lang)}>{row.exposure || "–"}</span>
          {row.comparator && <span className="line-clamp-2 text-[0.8rem] break-words" title={row.comparator}>
            <span className="text-muted">{L(lang, T.vs)}</span><span lang={fieldLang(row.comparator, lang)}>{row.comparator}</span></span>}
        </span>
      );
    case "outcomes": return <Outcomes row={row} lang={lang} onSelect={onSelect} />;
    case "direction":
      return (
        <span className="grid gap-1">
          {row.direction ? (
            // a narrow column: the direction word wraps only between Thai words (Plan 20 Task 7)
            <span className="inline-flex items-center gap-1.5"><Glyph direction={row.direction} lang={lang} /><ThaiText>{DIRECTION_LABEL[lang][row.direction]}</ThaiText></span>
          ) : row.theme ? <span className="text-muted" data-theme-paper><ThaiText>{L(lang, T.themesNoDirection)}</ThaiText></span> : null}
          {row.uncertain && <ReadingFlag lang={lang} />}
          {/* risk of bias sits under the direction (fix round 1: six columns fit the reading column) */}
          {risk && <span className="text-[0.8rem] text-muted" data-risk><ThaiText>{L(lang, T.rob)}</ThaiText>{row.risk ? ROB_LABEL[lang][row.risk] : "–"}</span>}
        </span>
      );
    case "risk": return <>{row.risk ? ROB_LABEL[lang][row.risk] : "–"}</>;
    default: return null;
  }
}

/** The study cell: ref and byline (author and year, the year shown once), then the cited-by count when the review has counts. */
function StudyCell({ row, onSelect, lang, citedBy, flag }: { row: LitRow; onSelect: (ref: string) => void; lang: Lang; citedBy: boolean; flag: boolean }) {
  return (
    <span className="grid justify-items-start gap-0.5">
      <button type="button" onClick={() => onSelect(row.ref)} title={row.title} aria-label={`${row.ref} ${row.title}`}
        className="inline-flex min-h-11 min-w-11 flex-col items-start justify-center text-left text-primary underline underline-offset-2">
        <span className="font-display font-semibold">{row.ref}</span>
        {row.byline && <span className="text-[0.75rem] font-normal text-muted no-underline">{row.byline}</span>}
      </button>
      {citedBy && (
        <span className="text-[0.75rem] text-muted" data-cited-by>{L(lang, T.citedBy)}<CitedBy row={row} lang={lang} /></span>
      )}
      {row.relatedTo && <span className="text-[0.75rem] text-muted" data-related-to={row.relatedTo}>{relatedLabel(row.relatedTo, lang)}</span>}
      {/* without a direction column (scoping, themes), the uncertain flag lives next to the ref */}
      {flag && row.uncertain && <ReadingFlag lang={lang} />}
    </span>
  );
}

/**
 * From 1280px: a fixed-layout table whose six columns fit the reading column (no sideways scroll), cells clamped and
 * wrapped; it stays in a scroll region so an unexpectedly long word still scrolls inside it, never the page.
 */
function MatrixTable({ rows, cols, framework, lang, onSelect, caption, citedBy, risk }: {
  rows: LitRow[]; cols: LitColumn[]; framework: LitFramework; lang: Lang; onSelect: (ref: string) => void; caption: string;
  citedBy: boolean; risk: boolean;
}) {
  const others = cols.slice(1);
  return (
    <ScrollRegion lang={lang} label={L(lang, RC.parts.scrollable(caption))}>
      <table aria-label={caption} className="w-full table-fixed border-collapse text-[0.82rem]">
        <caption className="sr-only">{caption}</caption>
        <colgroup>{cols.map((c) => <col key={c} style={{ width: COL_WIDTH[c] }} />)}</colgroup>
        <thead>
          <tr className="bg-ground">
            {cols.map((c) => (
              <th key={c} scope="col" className={`label px-2 py-2 text-left break-words ${c === "ref" ? "sticky left-0 z-10 bg-ground" : ""}`}>
                {litColumnLabel(c, framework, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ref} className="border-t border-rule">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left align-top font-body font-medium">
                <StudyCell row={row} onSelect={onSelect} lang={lang} citedBy={citedBy} flag={!cols.includes("direction")} />
              </th>
              {row.failed ? (
                <td colSpan={others.length} className={`${TD} text-err`}>{L(lang, T.failed)}</td>
              ) : others.map((c) => <td key={c} className={TD}><Cell col={c} row={row} lang={lang} onSelect={onSelect} risk={risk} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** Column shares of the fixed layout (they sum to 100%): outcomes get the most room. */
const COL_WIDTH: Record<LitColumn, string> = {
  ref: "14%", design: "12%", population: "16%", exposure: "14%", outcomes: "26%", direction: "18%", risk: "18%",
};

/** Below 1280px (phones and 1024–1279 alike): one ruled card per study (no nested card chrome), the same cells. */
function MatrixCards({ rows, cols, framework, lang, onSelect, caption, citedBy, risk }: {
  rows: LitRow[]; cols: LitColumn[]; framework: LitFramework; lang: Lang; onSelect: (ref: string) => void; caption: string;
  citedBy: boolean; risk: boolean;
}) {
  const fields = cols.filter((c) => c !== "ref");
  return (
    <ul aria-label={caption} className="grid border-t border-rule" data-lit-cards>
      {rows.map((row) => (
        <li key={row.ref} className="grid gap-2 border-b border-rule py-3" data-lit-card={row.ref}>
          <StudyCell row={row} onSelect={onSelect} lang={lang} citedBy={citedBy} flag={!cols.includes("direction")} />
          {row.failed ? (
            <p className="text-err">{L(lang, T.failed)}</p>
          ) : (
            <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.88rem] sm:grid-cols-[9rem_minmax(0,1fr)]">
              {fields.map((c) => (
                <CardField key={c} label={litColumnLabel(c, framework, lang)}><Cell col={c} row={row} lang={lang} onSelect={onSelect} risk={risk} /></CardField>
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
    <nav aria-label={L(lang, T.pages)} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-lit-pager>
      <button type="button" className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>{L(lang, T.previous)}</button>
      <span className="font-display text-[0.85rem] tabular-nums text-muted" aria-live="polite">
        {/* rows are records: a further report of a trial is a row too, so the pager never calls them studies */}
        {L(lang, T.pager(start + 1, end, total, page + 1, pages))}
      </span>
      <button type="button" className={btn} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{L(lang, T.next)}</button>
    </nav>
  );
}

/**
 * Literature review matrix (Plan 20 Task 5): six compact columns (study with its year and cited-by count, design,
 * population/sample, intervention, outcomes, direction with risk of bias under it), framework-aware labels (PICO, PCC,
 * PICo, SPIDER-like), 15 rows a page. From 1280px a fixed-layout table that fits the reading column (no sideways
 * scroll, sticky first column); below 1280px (1024–1279 included) ruled cards.
 */
export function LitMatrixSection({ papers, allPapers = papers, lang, type, onSelect, reviewId, offline = false, citations = null, question = null }: {
  papers: Paper[]; allPapers?: Paper[]; lang: Lang; type: ReviewTypeOrLegacy; onSelect: (ref: string) => void; reviewId: string; offline?: boolean;
  citations?: Citations | null; question?: QuestionBlock | null;
}) {
  // A table only where all six columns fit (>= 1280px); cards below, 1024–1279 included (fix round 1)
  const wide = useMinWidth(LIT_TABLE_MIN_WIDTH);
  const rows = useMemo(() => litRows(papers, lang, citations), [papers, lang, citations]);
  const allRows = useMemo(() => (allPapers === papers ? rows : litRows(allPapers, lang, citations)), [allPapers, papers, rows, lang, citations]);
  // The columns and framework follow the whole review, so they do not change while the reader filters.
  const framework = litFramework(type, allPapers, question);
  const cols = litColumns(type, allRows, framework);
  const citedBy = showsCitedBy(allRows);
  // risk of bias under the direction; a review without a direction column has its own risk column instead
  const riskUnder = showsRiskOfBias(type) && cols.includes("direction");
  const [page, setPage] = useState(0);
  const pg = paginate(rows, page, LIT_PAGE_SIZE);
  const caption = L(lang, T.caption);
  const context = question?.context?.trim();
  return (
    <section aria-labelledby="h-litmatrix" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-lit-framework={framework}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionHeading id="h-litmatrix">{L(lang, T.h)}</SectionHeading>
        {!offline && (
          <a href={exportUrl(reviewId, "csv")} download
            className="inline-flex min-h-11 items-center font-display text-[0.9rem] font-semibold text-primary underline underline-offset-2 md:min-h-0">
            {L(lang, T.csv)}
          </a>
        )}
      </div>
      <p className="text-[0.82rem] text-muted">
        {L(lang, framework === "pico_qual" ? T.pico : framework === "spider" ? T.spider : T.inRail)}
        {(framework === "pico_qual" || framework === "spider" || framework === "pcc") && context && (
          <> · <span data-lit-context>{L(lang, T.context)}{context}</span></>
        )}
      </p>
      {rows.length === 0 ? (
        <p className="text-[0.9rem] text-muted">{L(lang, T.noMatch)}</p>
      ) : wide ? (
        <MatrixTable rows={pg.items} cols={cols} framework={framework} lang={lang} onSelect={onSelect} caption={caption} citedBy={citedBy} risk={riskUnder} />
      ) : (
        <MatrixCards rows={pg.items} cols={cols} framework={framework} lang={lang} onSelect={onSelect} caption={caption} citedBy={citedBy} risk={riskUnder} />
      )}
      <Pager page={pg.page} pages={pg.pages} start={pg.start} end={pg.end} total={rows.length} lang={lang} onPage={setPage} />
      {rows.length > 0 && citedBy && <CitedByNote lang={lang} />}
      {allPapers.some((p) => isNonQuantitative(p.card_en ?? p.card)) && (
        <p className="text-[0.82rem] text-muted" data-note="qualitative">
          {L(lang, T.qualitative)}
        </p>
      )}
    </section>
  );
}
