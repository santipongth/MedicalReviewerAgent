"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { DIRECTION_LABEL, type Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import type { SofEffect, SofRow } from "@/lib/report-view";
import { ComputedNumber, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { ThaiNodes, ThaiText } from "../ui/thai-text";
import { CertaintyMark } from "./certainty";
import { usePrinting } from "./print-mode";
import { NoEffectText, PooledValue, StudyEffectValue } from "./key-findings";
import { themeFoundText, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { ScrollRegion } from "./scroll-region";
import { L, Lw } from "./text";

const S = RC.sof;

const TH = "px-3 py-2 text-left align-bottom label";
// From md up a table cell; below md each outcome is a stacked card and every cell shows its column name first.
const TD_CARD = "max-md:block max-md:px-0 max-md:py-1.5 max-md:before:mb-0.5 max-md:before:block "
  + "max-md:before:font-display max-md:before:text-[0.72rem] max-md:before:font-semibold max-md:before:tracking-[0.04em] "
  + "max-md:before:text-muted max-md:before:content-[attr(data-label)]";
const TD = "px-3 py-2.5 align-top";

/**
 * The stacked-card classes below md, none in print (Plan 20 Task 8): a sheet of paper is narrower than md, but the
 * summary of findings prints as the table it is (its header repeated on each page).
 */
function cards(printing: boolean) {
  return printing
    ? { table: "", head: "", body: "", row: "", rowHead: "", td: "", statement: "" }
    : {
      table: "max-md:block", head: "max-md:sr-only", row: "max-md:block", td: TD_CARD,
      body: "max-md:mb-3 max-md:block max-md:rounded-sm max-md:border max-md:border-rule max-md:bg-surface max-md:px-3 max-md:py-2",
      rowHead: "max-md:block max-md:px-0 max-md:pt-0.5", statement: "max-md:block max-md:px-0 max-md:pb-1",
    };
}
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
            <ThaiText>{L(lang, S.sum(p.counted, p.of)) + (p.reviews > 0 ? L(lang, S.srmaNotCounted) : "")}</ThaiText>
          </span>
        </span>
      );
    case "blanked":
      return <Hole lang={lang} />;
    case "reviews_only":
      return (
        <span className="grid gap-0.5" data-participants="reviews_only">
          <span aria-hidden="true">—</span>
          <span className={NOTE}><ThaiText>{L(lang, S.reviewsOnly)}</ThaiText></span>
        </span>
      );
    default:
      return <span className="text-[0.88rem] text-muted" data-participants="not_reported">{L(lang, S.notReported)}</span>;
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
            <span className="font-display text-muted">{L(lang, S.to)}</span>
            <VerifiedNumber value={effect.hi.num} onSelect={() => onSelect(effect.hi.ref, effect.hi.outcomeKey)} title={effect.hi.ref} />
          </span>
          <span className={NOTE}>
            <ThaiText>{L(lang, S.range(effect.n, effect.lo.ref, effect.hi.ref)) + (effect.other > 0 ? L(lang, S.otherMeasure(effect.other)) : "")}</ThaiText>
          </span>
        </span>
      );
    case "single":
      return (
        <span className="grid gap-0.5">
          <StudyEffectValue state={{ kind: "verified", effect: effect.effect }} lang={lang} onSelect={onSelect} />
          <span className={NOTE}>
            {effect.effect.ref}{effect.other > 0 && L(lang, S.more(effect.other))}
          </span>
        </span>
      );
    case "mixed":
      return (
        <span className="grid gap-0.5" data-effect="mixed">
          <span className="text-[0.88rem]">{L(lang, S.measuresDiffer)}</span>
          <span className={NOTE}>
            <ThaiText>{effect.measures.map((m) => `${m.measure ?? L(lang, S.unnamedMeasure)} ${m.count}`).join(" · ") + L(lang, S.studiesSuffix)}</ThaiText>
          </span>
        </span>
      );
    case "blanked":
      return <StudyEffectValue state={effect} lang={lang} onSelect={onSelect} />;
    default:
      return k === 1 ? <NoEffectText lang={lang} />
        : <span className="text-[0.88rem] text-muted">{L(lang, S.seeEach)}</span>;
  }
}

/**
 * The statement, clamped to three lines with a "more" button when it is longer (Task 9, T3 N2: `title` alone reaches
 * neither keyboard nor touch). Screen readers get the whole text either way; print unclamps it (globals.css).
 */
function ClampedStatement({ text, lang }: { text: string; lang: Lang }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <>
      <span ref={ref} id={id} data-clamp className={`break-words ${open ? "block" : "line-clamp-3"}`} title={open ? undefined : text}
        lang={fieldLang(text, lang)}>{text}</span>
      {(clamped || open) && (
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
          className="mt-0.5 inline-flex min-h-11 items-center font-display text-[0.85rem] font-semibold text-primary underline underline-offset-2 md:min-h-0 print:hidden">
          {L(lang, open ? S.less : S.more_)}
        </button>
      )}
    </>
  );
}

function Statement({ row, lang }: { row: SofRow; lang: Lang }) {
  if (row.statement) return <ClampedStatement text={row.statement} lang={lang} />;
  if (!row.tally.length && !row.themes) return <span className="text-muted">–</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 font-display text-[0.88rem]">
      {row.tally.map((t) => (
        <span key={t.direction} className="inline-flex items-center gap-1 nw">
          <Glyph direction={t.direction} lang={lang} />{DIRECTION_LABEL[lang][t.direction]} <span className="tabular-nums">{t.count}</span>
        </span>
      ))}
      {row.themes > 0 && <span className="nw">{themeFoundText(row.themes, lang)}</span>}
    </span>
  );
}

/**
 * Summary of findings (Plan 20; SLR and meta-analysis): per outcome the studies (k, designs, participants: the sum of
 * verified sample sizes, computed), the effect (pooled value as computed, else the range of verified values of one
 * named measure, else a single verified value, else why there is none), the certainty (an LLM-assisted GRADE-lite
 * judgement, not an expert GRADE assessment) and, on a full-width line under it, what it means. Fits the reading
 * column with no sideways scrolling; below 768px every outcome is a stacked card. A real table: caption, scoped headers.
 * Thai cell text wraps only between words (ThaiText, Plan 20 Task 7); short labels never wrap.
 */
export function SofTable({ rows, lang, onSelect, graded }: { rows: SofRow[]; lang: Lang; onSelect: Select; graded: boolean }) {
  const c = cards(usePrinting());
  if (!rows.length) return null;
  const caption = L(lang, S.caption);
  // Every certainty here is the review's single grade: the engine's per-finding value is that grade copied onto each
  // finding (docs/api.md), so finding rows are labelled review-level too (Task 11 fix round 1).
  const reviewLevel = graded && rows.some((r) => r.certainty != null);
  const col = {
    studies: L(lang, S.colStudies),
    effect: L(lang, S.colEffect),
    certainty: L(lang, S.colCertainty),
    means: L(lang, S.colMeans),
  };
  return (
    <section aria-labelledby="h-sof" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="h-sof" className={SECTION_H2}>{Lw(lang, S.h2)}</h2>
      <p className="max-w-[65ch] text-[0.85rem] text-muted" id="sof-note">
        <ThaiNodes>
          {L(lang, S.note)}
          {reviewLevel && <>{" "}<b className="font-semibold" data-review-level>{L(lang, S.reviewLevelNote)}</b></>}
        </ThaiNodes>
      </p>
      {/* Fits without scrolling since Task 3; the region keeps the scroll cue in case a long word ever widens it. */}
      <ScrollRegion label={caption} lang={lang} bordered={false} className="rounded-sm md:border md:border-rule">
        <table role="table" className={`w-full border-collapse text-[0.9rem] ${c.table}`} aria-describedby="sof-note">
          <caption className="sr-only">
            {caption} {L(lang, S.captionNote)}
          </caption>
          <thead role="rowgroup" className={c.head}>
            <tr role="row" className="bg-ground">
              <th scope="col" role="columnheader" className={`${TH} w-[24%]`}>{L(lang, S.colOutcome)}</th>
              <th scope="col" role="columnheader" className={`${TH} w-[26%]`}>{col.studies}</th>
              <th scope="col" role="columnheader" className={TH}>{col.effect}</th>
              <th scope="col" role="columnheader" className={`${TH} w-[7.5rem]`}><Term k="evidenceStrength" lang={lang}>{col.certainty}</Term></th>
            </tr>
          </thead>
          {rows.map((r) => (
            <tbody key={r.key} role="rowgroup" data-sof-row className={`border-t border-rule ${c.body}`}>
              <tr role="row" className={c.row}>
                <th scope="row" role="rowheader" lang={fieldLang(r.outcome, lang)}
                  className={`px-3 pt-2.5 text-left align-top font-display font-semibold break-words ${c.rowHead}`}>
                  <ThaiText>{r.outcome}</ThaiText>
                </th>
                <td role="cell" className={`${TD} ${c.td}`} data-label={col.studies}>
                  <span className="font-display font-semibold nw">
                    <span className="tabular-nums">{r.k}</span> {L(lang, S.studies(r.k))}
                  </span>
                  {r.designs.length > 0 && (
                    <ul className="mt-0.5 grid text-[0.8rem] text-muted" aria-label={L(lang, S.designs)}>
                      {/* a no-break space keeps the count with the design's last word */}
                      {r.designs.map((d) => <li key={d.label}><ThaiText>{d.label}</ThaiText>{"\u00a0"}<span className="font-display tabular-nums">{d.count}</span></li>)}
                    </ul>
                  )}
                  <span className="mt-1.5 grid gap-0.5">
                    <span className="label">{L(lang, S.participants)}</span>
                    <Participants row={r} lang={lang} />
                  </span>
                </td>
                <td role="cell" className={`${TD} ${c.td}`} data-label={col.effect}><Effect effect={r.effect} k={r.k} lang={lang} onSelect={onSelect} /></td>
                <td role="cell" className={`${TD} ${c.td}`} data-label={col.certainty}>
                  {graded && r.certainty ? (
                    <span className="grid gap-0.5">
                      <CertaintyMark level={r.certainty} lang={lang} />
                      <span className={`${NOTE} nw`} data-row-review-level>{L(lang, S.reviewLevel)}</span>
                    </span>
                  ) : <span className="text-[0.88rem] text-muted nw">{L(lang, S.notAssessed)}</span>}
                </td>
              </tr>
              <tr role="row" className={c.row}>
                <td role="cell" colSpan={4} className={`px-3 pb-3 text-[0.92rem] ${c.statement}`} data-sof-statement>
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
