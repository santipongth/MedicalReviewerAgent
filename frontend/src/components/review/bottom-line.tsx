"use client";

import { directionTally, hasPooledPapers, themePapers } from "@/lib/charts-data";
import { META_POOL_COPY } from "@/lib/copy";
import { DIRECTION_LABEL, DIRECTION_ORDER, type Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { DESIGN_GROUP_LABEL, fixed } from "@/lib/meta-view";
import { metaPoolGap, reviewTypeOf, showsDirection } from "@/lib/review-type";
import type { Paper, Pool, ReviewResult, Synthesis } from "@/lib/types";
import { ComputedNumber, Glyph } from "../ui/evidence";
import { Term } from "../ui/term";
import { CitedText, READING, StrengthLine, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L, Lw } from "./text";

const B = RC.bottom;

/** The pools in reading order: the graded (primary) outcome first, as the backend computed them. */
function orderedPools(result: ReviewResult): Pool[] {
  const pools = result.meta_analysis?.pools ?? [];
  const primary = result.meta_analysis?.grade?.primary_outcome;
  return [...pools].sort((a, b) => Number(b.outcome === primary) - Number(a.outcome === primary));
}

/** One pooled estimate in a sentence: outcome, group, k, then the computed value and interval (ComputedNumber only). */
export function PooledLine({ pool, lang, english }: { pool: Pool; lang: Lang; english: boolean }) {
  const outcome = english ? pool.outcome : pool.outcome_display || pool.outcome;
  const group = DESIGN_GROUP_LABEL[pool.design_group]?.[lang] ?? pool.design_group;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-pooled-line>
      <span className="font-display font-semibold break-words" lang={fieldLang(outcome, lang)}>{outcome}</span>
      <span className="text-[0.88rem] text-muted">{group} · k = <span className="tabular-nums">{pool.k}</span></span>
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display">{pool.measure}</span>
        <ComputedNumber value={fixed(pool.pooled.est, 2)} lang={lang} />
        <span className="whitespace-nowrap">
          <span className="font-display text-muted">(95% CI </span>
          <ComputedNumber value={`${fixed(pool.pooled.ci_lower, 2)}–${fixed(pool.pooled.ci_upper, 2)}`} lang={lang} tag={false} />
          <span className="font-display text-muted">)</span>
        </span>
      </span>
    </li>
  );
}

/**
 * The bottom line (Plan 20): the direct answer with its certainty, the pooled value(s) of a meta-analysis (computed)
 * or "could not pool", how the papers split, and the grading rationale behind a disclosure. A result stored before
 * Plan 20 has no `answer`: its executive summary leads here instead (and no Discussion section repeats it).
 */
export function BottomLine({ synthesis, result, papers, lang, onSelect, refs, english }: {
  synthesis: Synthesis; result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: Select; refs: Set<string>;
  /** the reader switched a Thai review to English: English pool names */
  english: boolean;
}) {
  const hasPapers = papers.length > 0;
  const type = reviewTypeOf(result);
  const tally = directionTally(papers, type === "narrative");
  // Scoping maps what exists; it never tallies a direction of effect.
  const shown = showsDirection(type) ? DIRECTION_ORDER.filter((d) => tally[d] > 0) : [];
  // Qualitative / mixed-methods studies are never tallied by direction; they are counted as themes instead.
  const themes = type === "scoping" ? 0 : themePapers(papers).length;
  const poolGap = metaPoolGap(result);
  const pools = type === "meta_analysis" ? orderedPools(result) : [];
  const lead = synthesis.answer?.trim() || synthesis.executive_summary || result.summary || "";
  return (
    <section aria-labelledby="h-answer" className="grid gap-4">
      <h2 id="h-answer" className={SECTION_H2}>{Lw(lang, B.h2)}</h2>
      {poolGap && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-[0.92rem]" data-not-pooled={poolGap}>
          {/* a short chip: never wraps (Plan 20 Task 7) */}
          <span className="label nw rounded-sm bg-warn-bg px-2 py-1">{META_POOL_COPY[poolGap].label[lang]}</span>
          <span className="text-muted">{META_POOL_COPY[poolGap].reason[lang]}</span>
        </p>
      )}
      {/* Model prose: plain text only. A number in it is never styled as verified (no tape, no verified face). The
          engine can leave the answer "" (docs/api.md): the summary then leads, and with no text at all the certainty
          line and the key findings carry the bottom line (never an empty paragraph). */}
      {lead.trim() ? (
        <p className={`max-w-[65ch] ${READING}`} data-prose data-answer={synthesis.answer?.trim() ? "" : undefined} lang={fieldLang(lead, lang)}>
          <CitedText text={lead} onSelect={onSelect} refs={refs} />
        </p>
      ) : hasPapers && (
        <p className="max-w-[65ch] text-[0.92rem] text-muted" data-no-answer>
          {/* "" also when the model wrote none or the narrative step failed (api.md): never blamed on the checks */}
          {L(lang, B.noAnswer)}
        </p>
      )}
      {hasPapers && <StrengthLine synthesis={synthesis} lang={lang} quality={result.quality} type={type} bar={!poolGap} />}
      {pools.length > 0 && (
        <div className="grid gap-1.5" data-bottom-pools>
          <p className="label">{L(lang, B.pooledLabel)}</p>
          <ul className="grid gap-1.5">
            {pools.map((p, i) => <PooledLine key={`${p.outcome}|${p.design_group}|${p.measure}|${i}`} pool={p} lang={lang} english={english} />)}
          </ul>
        </div>
      )}
      {hasPapers && <p className="text-[0.8rem] text-muted">
        {L(lang, type === "scoping" ? B.modelNoteScoping : B.modelNote)}
      </p>}
      {shown.length > 0 && (
        <div className="grid gap-1.5 text-[0.92rem]">
          <p className="text-muted">
            <Term k="directionTally" lang={lang}>{L(lang, B.tally)}</Term>
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5" data-direction-tally>
            {shown.map((d) => (
              <li key={d} data-direction={d} className="inline-flex items-center gap-1.5 font-display">
                <Glyph direction={d} lang={lang} />
                {DIRECTION_LABEL[lang][d]} <span className="tabular-nums font-semibold">{tally[d]}</span>
              </li>
            ))}
          </ul>
          {hasPooledPapers(papers) && (
            <p className="text-[0.82rem] text-muted">
              {L(lang, B.overlap)}
            </p>
          )}
        </div>
      )}
      {themes > 0 && (
        <p className="text-[0.92rem] text-muted" data-theme-count>
          {L(lang, B.themes(themes))}
        </p>
      )}
    </section>
  );
}
