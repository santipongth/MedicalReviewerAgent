"use client";

import Link from "next/link";
import { Fragment } from "react";
import { designKey, designLabel, directionTally, isNonQuantitative, questionDirection } from "@/lib/charts-data";
import { asReported, isBlankedSampleSize } from "@/lib/evidence";
import { DIRECTION_LABEL, DIRECTION_ORDER, type Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { fullReviewHref, quickBlocks, quickRefId, quickRefs } from "@/lib/quick";
import { alignMarkers, citationOf, isChecked } from "@/lib/support";
import { isNotEvidence } from "@/lib/trial-reports";
import type { Paper, Review, ReviewResult, SupportClaim } from "@/lib/types";
import { Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { ReportNotices } from "./audience";
import { CertaintyMark } from "./certainty";
import { citedQuestion } from "./report-cite";
import { CitationText } from "./references";
import { useDocumentLang } from "./report";
import { L, Lw } from "./text";

const Q = RC.quick;
const BUTTON = "inline-flex min-h-12 w-fit items-center rounded-sm border border-primary bg-primary px-6 font-display text-[1.05rem] font-semibold text-on-primary no-underline hover:brightness-110";
const H2 = "font-display text-[1.25rem] font-semibold";

/** One citation group of the answer: "[1, 3]", each number a link to its reference, ✓ when the sentence-support
 * check found the sentence in that study's abstract with its numbers verified (Plan 25). */
function Cite({ refs, numbers, claim, byRef, lang }: {
  refs: string[]; numbers: number[]; claim: SupportClaim | null; byRef: Map<string, Paper>; lang: Lang;
}) {
  if (!numbers.length) return null;
  return (
    <span data-quick-cite className="nw font-display text-[0.86em]">
      [{numbers.map((n, i) => {
        const checked = isChecked(citationOf(claim, refs[i]), byRef.get(refs[i]), claim ?? undefined);
        return (
          <Fragment key={n}>
            {i > 0 && ", "}
            <a href={`#${quickRefId(n)}`} aria-label={L(lang, checked ? Q.citeChecked(n) : Q.cite(n))}
              className="font-semibold text-primary underline underline-offset-2">{n}</a>
            {checked && <span aria-hidden data-checked className="font-semibold text-ink">✓</span>}
          </Fragment>
        );
      })}]
    </span>
  );
}

/** A reference's facts at a glance: design · year · n (verified, or the not-verified slot) · direction (glyph + words).
 * Every part comes from the paper's card; the direction is left out for themes-only and not-evidence papers. */
function QuickRefFacts({ paper, lang }: { paper: Paper; lang: Lang }) {
  const card = paper.card_en ?? paper.card;
  if (!card) return null;
  const n = card.sample_size;
  const showDirection = !isNonQuantitative(card) && !isNotEvidence(paper);
  const direction = questionDirection(card);
  const facts = [
    <span key="d" className="font-display font-semibold text-ink">{designLabel(designKey(card), lang)}</span>,
    paper.year != null && <span key="y" className="font-display tabular-nums">{paper.year}</span>,
    n != null ? <span key="n" className="nw">n = <VerifiedNumber value={asReported(n, card.sample_size_quote)} /></span>
      : isBlankedSampleSize(paper) ? <span key="n" className="nw">n = <Hole lang={lang} /></span> : null,
    showDirection && (
      <span key="g" className="nw inline-flex items-center gap-1.5">
        <Glyph direction={direction} lang={lang} />
        <span aria-hidden>{DIRECTION_LABEL[lang][direction] ?? DIRECTION_LABEL[lang].unclear}</span>
      </span>
    ),
  ].filter(Boolean);
  return (
    <p data-quick-facts className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.88rem] text-muted">
      {/* the separator travels with the fact after it, so a wrapped line never starts with "·" */}
      {facts.map((f, i) => <span key={i} className="nw inline-flex items-center gap-2">{i > 0 && <span aria-hidden>·</span>}{f}</span>)}
    </p>
  );
}

/** What the answer rests on: papers read and cited (plain counts of studies), and the cited papers counted by
 * direction (`directionTally`: a count of papers, never a claim of the model). */
function QuickEvidence({ cited, read, lang }: { cited: Paper[]; read: number | null | undefined; lang: Lang }) {
  const tally = directionTally(cited);
  const shown = DIRECTION_ORDER.filter((d) => tally[d] > 0);
  return (
    <section aria-labelledby="quick-evidence-h" data-quick-evidence className="grid content-start gap-3">
      <h2 id="quick-evidence-h" className="label">{Lw(lang, Q.evidenceTitle)}</h2>
      <p className="font-display text-[1.05rem] font-semibold tabular-nums">
        {L(lang, read != null ? Q.counts(read, cited.length) : Q.citedCount(cited.length))}
      </p>
      {shown.length > 0 && (
        <ul aria-label={L(lang, Q.tallyTitle)} className="grid gap-1.5">
          {shown.map((d) => (
            <li key={d} data-direction={d} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 text-[0.95rem]">
              <Glyph direction={d} lang={lang} />
              <span aria-hidden>{DIRECTION_LABEL[lang][d]}</span>
              <span className="font-display font-semibold tabular-nums">{tally[d]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Plan 27, redesigned 2026-10-13 at the owner's request (full width, understood at a glance): the question; one
 * bordered frame with the answer (one sentence per line, numbered citations) and, beside it from 1024px, how sure it is
 * (the certainty meter only when graded) and what it rests on (counts and the direction tally); the public view's
 * notices (Plan 26); the numbered references, each with its design, year, verified n and direction; "ทำรีวิวฉบับเต็ม".
 * One presentation; the text is shown in the language it was written in.
 */
export function QuickAnswer({ review }: { review: Review }) {
  const result: ReviewResult = review.result ?? {};
  const lang: Lang = (result.language ?? review.language) === "en" ? "en" : "th";
  useDocumentLang(lang);
  const refs = quickRefs(result);
  const byRef = new Map((result.papers ?? []).map((p) => [p.ref, p]));
  const cited = refs.map((r) => byRef.get(r)).filter((p): p is Paper => !!p);
  const text = result.summary ?? result.synthesis?.executive_summary ?? "";
  const closing = result.synthesis?.answer ?? "";
  const strength = refs.length ? result.synthesis?.evidence_strength ?? null : null;
  const claims = alignMarkers(text, result.support);
  const blocks = quickBlocks(text, refs);
  const anyChecked = blocks.flat().some((p) => p.kind === "cite" && p.refs.some((r) => {
    const claim = claims[p.marker] ?? null;
    return isChecked(citationOf(claim, r), byRef.get(r), claim ?? undefined);
  }));
  const question = citedQuestion(review, result, lang);
  const read = result.quick?.papers_read;
  const showCertainty = strength != null || !!closing || refs.length > 0;
  return (
    <article data-quick-answer className="grid gap-8 pt-10 pb-4 lg:gap-10">
      <header className="grid max-w-[75ch] gap-3">
        <h1 className="text-[clamp(1.5rem,2.6vw,2rem)] font-bold leading-snug">{question}</h1>
        {question !== review.topic && (
          <p className="text-[0.95rem] text-muted"><span className="label mr-2">{L(lang, Q.asked)}</span>
            <span lang={fieldLang(review.topic, lang)}>{review.topic}</span></p>
        )}
        <p data-quick-scope className="w-fit rounded-sm bg-info-bg px-3 py-2 text-[0.88rem]">
          <span className="font-display font-semibold">{Lw(lang, Q.kind)}</span>
          {" · "}{L(lang, read != null ? Q.scope(read) : Q.scopeNone)}
        </p>
      </header>

      <div className="grid rounded-sm border border-rule bg-surface motion-safe:animate-[thought-in_250ms_ease-out] lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section aria-labelledby="quick-answer-h" className="grid content-start gap-4 p-5 sm:p-8 lg:p-10">
          <h2 id="quick-answer-h" className="label">{Lw(lang, Q.answer)}</h2>
          <p data-quick-text className="grid max-w-[62ch] gap-3 text-[clamp(1.2rem,1.6vw,1.375rem)] leading-[1.75]" lang={fieldLang(text, lang)}>
            {blocks.map((parts, b) => (
              <Fragment key={b}>
                {b > 0 && " "}
                <span data-quick-sentence className="block">
                  {parts.map((p, i) => (p.kind === "text"
                    ? <Fragment key={i}>{p.text}</Fragment>
                    : <Cite key={i} refs={p.refs} numbers={p.numbers} claim={claims[p.marker] ?? null} byRef={byRef} lang={lang} />))}
                </span>
              </Fragment>
            ))}
          </p>
          {anyChecked && <p className="max-w-[62ch] text-[0.85rem] text-muted">{L(lang, Q.checkedLegend)}</p>}
        </section>
        <div className="grid content-start gap-6 border-t border-rule p-5 sm:p-8 lg:border-t-0 lg:border-l">
          {showCertainty && (
            <section aria-labelledby="quick-certainty-h" data-quick-certainty className="grid content-start gap-2">
              <h2 id="quick-certainty-h" className="label">{Lw(lang, Q.certaintyTitle)}</h2>
              {strength != null && (
                <CertaintyMark level={strength} lang={lang}
                  className="font-display text-[1.25rem] font-semibold [&_svg]:h-[18px] [&_svg]:w-auto" />
              )}
              {closing
                ? <p data-quick-closing className="text-[0.95rem] leading-[1.7]" lang={fieldLang(closing, lang)}>{closing}</p>
                : strength == null && <p className="text-[0.95rem] text-muted">{L(lang, Q.notGraded)}</p>}
            </section>
          )}
          <div className={showCertainty ? "border-t border-rule pt-6" : ""}>
            <QuickEvidence cited={cited} read={read} lang={lang} />
          </div>
        </div>
      </div>

      <div className="empty:hidden [&_aside]:content-start lg:[&>[data-report-notices]]:grid-cols-2">
        <ReportNotices result={result} audience="public" lang={lang} hasPapers={refs.length > 0} />
      </div>

      <section aria-labelledby="quick-refs-h" className="grid gap-2">
        <h2 id="quick-refs-h" className={H2}>{Lw(lang, Q.refsTitle)}</h2>
        {refs.length ? (
          <>
            <p className="max-w-[75ch] text-[0.88rem] text-muted">{L(lang, Q.refsNote)}</p>
            <ol aria-label={L(lang, Q.refsTitle)} className="grid border-t border-rule xl:grid-cols-2 xl:gap-x-10">
              {refs.map((ref, i) => {
                const paper = byRef.get(ref);
                return (
                  <li key={ref} id={quickRefId(i + 1)} tabIndex={-1} data-quick-ref={ref}
                    className="grid scroll-mt-24 grid-cols-[2.6rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-4 outline-none target:bg-rail">
                    <span className="pt-0.5 font-display font-semibold tabular-nums">[{i + 1}]</span>
                    {paper ? (
                      <div className="grid content-start gap-1.5">
                        <CitationText paper={paper} lang={lang} />
                        <QuickRefFacts paper={paper} lang={lang} />
                      </div>
                    ) : <span className="text-muted">{ref}</span>}
                  </li>
                );
              })}
            </ol>
          </>
        ) : <p className="text-muted">{L(lang, Q.noRefs)}</p>}
      </section>

      <div data-quick-upgrade className="grid gap-2 pt-2">
        <Link href={fullReviewHref(review)} className={BUTTON}>{L(lang, Q.upgrade)}</Link>
        <p className="max-w-[65ch] text-[0.92rem] text-muted">{L(lang, Q.upgradeHint)}</p>
      </div>
    </article>
  );
}
