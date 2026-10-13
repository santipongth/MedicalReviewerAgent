"use client";

import Link from "next/link";
import { Fragment } from "react";
import { designKey, designLabel, directionTally, hasPooledPapers, isNonQuantitative, questionDirection, themePapers } from "@/lib/charts-data";
import { asReported, isBlankedSampleSize } from "@/lib/evidence";
import { DIRECTION_LABEL, DIRECTION_ORDER, type Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { fullReviewHref, quickBlocks, quickRefId, quickRefs, type QuickPart } from "@/lib/quick";
import { alignMarkers, citationOf, isChecked } from "@/lib/support";
import { hasThai, thaiChunks } from "@/lib/text-wrap";
import { isNotEvidence } from "@/lib/trial-reports";
import type { Paper, Review, ReviewResult, SupportClaim } from "@/lib/types";
import { Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { THAI_WORD_MAX, ThaiText } from "../ui/thai-text";
import { ReportNotices } from "./audience";
import { CertaintyMark } from "./certainty";
import { citedQuestion } from "./report-cite";
import { CitationText } from "./references";
import { useDocumentLang } from "./report";
import { L, Lw } from "./text";

const Q = RC.quick;
const B = RC.bottom;
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

/** The last word of a text part (a Thai word from the segmenter, else the last space-separated token) and what comes
 * before it, so the citation group after it can be glued to it. Joined, the two give back the text. */
function splitLastWord(text: string): [string, string] {
  const trimmed = text.replace(/\s+$/, "");
  // a short closing parenthetical ("(HR 0.80)") stays whole with the group
  const paren = /\([^()]{1,24}\)$/.exec(trimmed)?.[0];
  const token = paren ?? /\S+$/.exec(trimmed)?.[0] ?? "";
  let word = token;
  if (hasThai(token)) {
    const chunks = thaiChunks(token);
    const last = chunks[chunks.length - 1] ?? "";
    word = [...last].length <= THAI_WORD_MAX ? last : "";
  }
  const at = trimmed.length - word.length;
  return [text.slice(0, at), text.slice(at)];
}

/** One sentence of the answer: its text Thai-segmented (never broken mid-word), each citation group glued to the word
 * before it so a group never wraps onto a line by itself. */
function Sentence({ parts, claims, byRef, lang }: {
  parts: QuickPart[]; claims: (SupportClaim | null)[]; byRef: Map<string, Paper>; lang: Lang;
}) {
  const cite = (p: QuickPart | undefined, key?: string) => (p?.kind === "cite" && p.numbers.length > 0
    ? <Cite key={key} refs={p.refs} numbers={p.numbers} claim={claims[p.marker] ?? null} byRef={byRef} lang={lang} /> : null);
  return (
    <>
      {parts.map((p, i) => {
        // a group with no text before it (at the start, or right after another group) is drawn alone
        if (p.kind === "cite") return i === 0 || parts[i - 1].kind !== "text" ? cite(p, `c${i}`) : null;
        const group = cite(parts[i + 1]);
        if (!group) {
          // Plan 30: a group with no numberable ref is left out, and so is the space before it when punctuation or
          // another space follows (no "risk . Next" or double space)
          // (a dropped group followed directly by a valid group keeps its space: "risk [P9][P1]." -> "risk [1].")
          let j = i + 2;
          while (parts[j]?.kind === "cite" && !cite(parts[j])) j++;
          const next = parts[j];
          const trim = parts[i + 1]?.kind === "cite" && (!next || (next.kind === "text" && /^[\s.,;:!?)]/.test(next.text)));
          return <ThaiText key={i}>{trim ? p.text.replace(/\s+$/, "") : p.text}</ThaiText>;
        }
        const [head, tail] = splitLastWord(p.text);
        return (
          <Fragment key={i}>
            <ThaiText>{head}</ThaiText>
            <span className="nw"><ThaiText>{tail}</ThaiText>{group}</span>
          </Fragment>
        );
      })}
    </>
  );
}

/** A reference's facts at a glance: design · n (verified, or the not-verified slot) · direction (glyph + words); the
 * year is already in the citation. The design comes from the card in the reader's language, the direction from the
 * English card; the direction is left out for themes-only and not-evidence papers. */
function QuickRefFacts({ paper, lang }: { paper: Paper; lang: Lang }) {
  const local = paper.card ?? paper.card_en;
  const card = paper.card_en ?? paper.card;
  if (!card || !local) return null;
  const n = card.sample_size;
  const showDirection = !isNonQuantitative(card) && !isNotEvidence(paper);
  const direction = questionDirection(card);
  const design = designLabel(designKey(local), lang);
  const facts = [
    <span key="d" className="font-display font-semibold text-ink" lang={local.design_category ? undefined : fieldLang(design, lang)}>{design}</span>,
    n != null ? <span key="n">n = <VerifiedNumber value={asReported(n, card.sample_size_quote)} /></span>
      : isBlankedSampleSize(paper) ? <span key="n">n = <Hole lang={lang} /></span> : null,
    showDirection && (
      <span key="g" className="inline-flex items-center gap-1.5">
        <Glyph direction={direction} lang={lang} />
        <span aria-hidden>{DIRECTION_LABEL[lang][direction] ?? DIRECTION_LABEL[lang].unclear}</span>
      </span>
    ),
  ].filter(Boolean);
  return (
    <p data-quick-facts className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.88rem] text-muted">
      {/* the separator ends the fact before it, so a wrapped line never starts with "·" */}
      {facts.map((f, i) => (
        <span key={i} className="nw inline-flex items-center gap-2">{f}{i < facts.length - 1 && <span aria-hidden>·</span>}</span>
      ))}
    </p>
  );
}

/** What the answer rests on: papers read and cited (plain counts of studies), and the cited papers counted by
 * direction (`directionTally`: a count of papers, never a claim of the model), with the full report's caveats: the
 * tally's term, the SR/MA overlap and the themes-only count. */
function QuickEvidence({ cited, read, lang }: { cited: Paper[]; read: number | null | undefined; lang: Lang }) {
  const tally = directionTally(cited);
  const shown = DIRECTION_ORDER.filter((d) => tally[d] > 0);
  const themes = themePapers(cited).length;
  return (
    <section aria-labelledby="quick-evidence-h" data-quick-evidence className="grid content-start gap-3">
      <h2 id="quick-evidence-h" className="label">{Lw(lang, Q.evidenceTitle)}</h2>
      <p className="font-display text-[1.05rem] font-semibold tabular-nums">
        {L(lang, read != null ? Q.counts(read, cited.length) : Q.citedCount(cited.length))}
      </p>
      {shown.length > 0 && (
        <>
          <p className="text-[0.85rem] text-muted"><Term k="directionTally" lang={lang}>{L(lang, B.tally)}</Term></p>
          <ul role="list" aria-label={L(lang, Q.tallyTitle)} className="grid gap-1.5">
            {shown.map((d) => (
              <li key={d} data-direction={d} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 text-[0.95rem]">
                <Glyph direction={d} lang={lang} />
                <span aria-hidden>{DIRECTION_LABEL[lang][d]}</span>
                <span className="font-display font-semibold tabular-nums">{tally[d]}</span>
              </li>
            ))}
          </ul>
          {hasPooledPapers(cited) && <p data-quick-overlap className="text-[0.82rem] text-muted">{L(lang, B.overlap)}</p>}
        </>
      )}
      {themes > 0 && <p data-theme-count className="text-[0.85rem] text-muted">{L(lang, B.themes(themes))}</p>}
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
        <h1 className="text-[clamp(1.5rem,2.6vw,2rem)] font-bold leading-snug"><ThaiText>{question}</ThaiText></h1>
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
        <section aria-labelledby="quick-answer-h" className="flex flex-col gap-4 p-5 sm:p-8 lg:p-10">
          <h2 id="quick-answer-h" className="label">{Lw(lang, Q.answer)}</h2>
          <p data-quick-text className="grid max-w-[62ch] gap-3 text-[clamp(1.2rem,1.6vw,1.375rem)] leading-[1.75] lg:gap-4 lg:text-[clamp(1.3rem,1.9vw,1.6rem)] lg:leading-[1.65]" lang={fieldLang(text, lang)}>
            {blocks.map((parts, b) => (
              <Fragment key={b}>
                {b > 0 && " "}
                <span data-quick-sentence className="block">
                  <Sentence parts={parts} claims={claims} byRef={byRef} lang={lang} />
                </span>
              </Fragment>
            ))}
          </p>
          {anyChecked && <p className="mt-auto max-w-[62ch] pt-2 text-[0.85rem] text-muted">{L(lang, Q.checkedLegend)}</p>}
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

      {/* two notices or more sit side by side from 1024px; a single one keeps the full width */}
      <div className="empty:hidden [&_aside]:content-start lg:[&>[data-report-notices]:has(>:nth-child(2))]:grid-cols-2">
        <ReportNotices result={result} audience="public" lang={lang} hasPapers={refs.length > 0} guideLabel={L(lang, Q.guideLabel)} />
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
                    ) : <span className="text-muted">{L(lang, Q.missingPaper)}</span>}
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
