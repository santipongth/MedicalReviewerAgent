"use client";

import type { Lang } from "@/lib/i18n";
import type { EffectState, FindingView, PooledText } from "@/lib/report-view";
import { ComputedNumber, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { READING, RefButtons, themeFoundText, type Select } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

/** "k การศึกษา": a count of studies (display face, tabular figures), never a verified number. */
export function StudyCount({ k, lang, themes = false }: { k: number; lang: Lang; themes?: boolean }) {
  if (themes) return <span className="font-display">{themeFoundText(k, lang)}</span>;
  return (
    <span className="font-display whitespace-nowrap">
      <span className="tabular-nums">{k}</span> {L(lang, "การศึกษา", k === 1 ? "study" : "studies")}
    </span>
  );
}

/** A pooled value of the outcome: computed (ComputedNumber), with its design group and k. */
export function PooledValue({ pool, lang }: { pool: PooledText; lang: Lang }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-pooled>
      <span className="font-display">{L(lang, "ค่ารวม", "Pooled")} {pool.measure}</span>
      <ComputedNumber value={pool.est} lang={lang} />
      {/* the interval and its brackets never break apart */}
      <span className="whitespace-nowrap">
        <span className="font-display text-muted">(95% CI </span>
        <ComputedNumber value={pool.ci} lang={lang} tag={false} />
        <span className="font-display text-muted">)</span>
      </span>
      <span className="font-display text-muted">{pool.group} · k = <span className="tabular-nums">{pool.k}</span></span>
    </span>
  );
}

/** A one-study outcome with no effect size for it: plain text, never a gap (nothing failed verification). */
export function NoEffectText({ lang }: { lang: Lang }) {
  return <span className="text-[0.88rem] text-muted" data-no-effect>{L(lang, "ไม่ได้รายงานขนาดผล", "No effect size reported")}</span>;
}

/** One study's number: verified (tape, opens its sentence in the rail) or a not-verified gap. */
export function StudyEffectValue({ state, lang, onSelect }: { state: NonNullable<EffectState>; lang: Lang; onSelect: Select }) {
  if (state.kind === "blanked") {
    return <span className="inline-flex items-baseline gap-1.5"><Hole lang={lang} /> <span className="font-display text-[0.85rem] text-muted">{state.ref}</span></span>;
  }
  const e = state.effect;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <VerifiedNumber value={e.text} onSelect={() => onSelect(e.ref, e.outcomeKey)} title={e.ref} />
      {e.ci && <><Term k="ci95" lang={lang}><span className="text-muted">95% CI</span></Term> <VerifiedNumber value={e.ci} onSelect={() => onSelect(e.ref, e.outcomeKey)} title={e.ref} /></>}
    </span>
  );
}

/**
 * Key findings (Plan 20): 3–5 bullets, each with its outcome, the model's one-sentence statement (no numbers), how
 * many studies it rests on, their codes (open the rail) and the one number that fits: the outcome's pooled value
 * (computed) or, when it rests on a single study, that study's verified effect. Never a number the UI computed.
 */
export function KeyFindings({ findings, lang, onSelect }: { findings: FindingView[]; lang: Lang; onSelect: Select }) {
  if (!findings.length) return null;
  return (
    <section aria-labelledby="h-key-findings" className="grid gap-3">
      <h2 id="h-key-findings" className={SECTION_H2}>{L(lang, "ผลการศึกษาที่สำคัญ", "Key findings")}</h2>
      <ol className="grid gap-0 border-t border-rule">
        {findings.map((f, i) => (
          <li key={`${f.outcome}-${i}`} className="grid gap-1.5 border-b border-rule py-3" data-key-finding>
            <p className="font-display font-semibold break-words">{f.outcome}</p>
            <p className={`max-w-[65ch] ${READING}`} data-prose>{f.statement}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.9rem]">
              <StudyCount k={f.k} lang={lang} themes={f.themes} />
              {f.pools.map((p) => <PooledValue key={p.key} pool={p} lang={lang} />)}
              {!f.pools.length && f.effect && <StudyEffectValue state={f.effect} lang={lang} onSelect={onSelect} />}
              {!f.pools.length && !f.effect && f.k === 1 && !f.themes && <NoEffectText lang={lang} />}
              {f.refs.length > 0 && <RefButtons refs={f.refs} onSelect={onSelect} lang={lang} />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
