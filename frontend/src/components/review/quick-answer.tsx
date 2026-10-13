"use client";

import Link from "next/link";
import { Fragment } from "react";
import type { Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import { fullReviewHref, quickParts, quickRefId, quickRefs } from "@/lib/quick";
import { alignMarkers, citationOf, isChecked } from "@/lib/support";
import type { Paper, Review, ReviewResult, SupportClaim } from "@/lib/types";
import { ReportNotices } from "./audience";
import { citedQuestion } from "./report-cite";
import { CitationText } from "./references";
import { useDocumentLang } from "./report";
import { L, Lw } from "./text";

const Q = RC.quick;
const BUTTON = "inline-flex min-h-12 w-fit items-center rounded-sm border border-primary bg-primary px-6 font-display text-[1.05rem] font-semibold text-on-primary no-underline hover:brightness-110";

/** One citation group of the answer: "[1, 3]", each number a link to its reference, ✓ when the sentence-support
 * check found the sentence in that study's abstract with its numbers verified (Plan 25). */
function Cite({ refs, numbers, claim, byRef, lang }: {
  refs: string[]; numbers: number[]; claim: SupportClaim | null; byRef: Map<string, Paper>; lang: Lang;
}) {
  if (!numbers.length) return null;
  return (
    <span data-quick-cite className="nw font-display text-[0.92em]">
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

/**
 * Plan 27: a quick answer ("ถามเร็ว"): the question, a fixed scope line, the public safety notices (Plan 26), the
 * 2–4 sentence answer with numbered citations, the certainty-and-limits line, the numbered references with their
 * PubMed, DOI, PubMed Central or ThaiJO links, and "ทำรีวิวฉบับเต็ม". One presentation (the public view's notices);
 * the text is shown in the language it was written in.
 */
export function QuickAnswer({ review }: { review: Review }) {
  const result: ReviewResult = review.result ?? {};
  const lang: Lang = (result.language ?? review.language) === "en" ? "en" : "th";
  useDocumentLang(lang);
  const refs = quickRefs(result);
  const byRef = new Map((result.papers ?? []).map((p) => [p.ref, p]));
  const text = result.summary ?? result.synthesis?.executive_summary ?? "";
  const closing = result.synthesis?.answer ?? "";
  const claims = alignMarkers(text, result.support);
  const parts = quickParts(text, refs);
  const anyChecked = parts.some((p) => p.kind === "cite" && p.refs.some((r) => {
    const claim = claims[p.marker] ?? null;
    return isChecked(citationOf(claim, r), byRef.get(r), claim ?? undefined);
  }));
  const question = citedQuestion(review, result, lang);
  const read = result.quick?.papers_read;
  return (
    <article data-quick-answer className="grid max-w-[75ch] gap-8 pt-12">
      <header className="grid gap-3">
        <h1 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold leading-snug">{question}</h1>
        {question !== review.topic && (
          <p className="text-[0.95rem] text-muted"><span className="label mr-2">{L(lang, Q.asked)}</span>
            <span lang={fieldLang(review.topic, lang)}>{review.topic}</span></p>
        )}
        <p data-quick-scope className="rounded-sm bg-info-bg px-4 py-3 text-[0.92rem]">
          <span className="font-display font-semibold">{Lw(lang, Q.kind)}</span>
          {" · "}{L(lang, read != null ? Q.scope(read) : Q.scopeNone)}
        </p>
      </header>
      <ReportNotices result={result} audience="public" lang={lang} hasPapers={refs.length > 0} />
      <section aria-labelledby="quick-answer-h" className="grid gap-3">
        <h2 id="quick-answer-h" className="font-display text-[1.25rem] font-semibold">{Lw(lang, Q.answer)}</h2>
        <p data-quick-text className="text-[1.0625rem] leading-[1.75]" lang={fieldLang(text, lang)}>
          {parts.map((p, i) => (p.kind === "text"
            ? <Fragment key={i}>{p.text}</Fragment>
            : <Cite key={i} refs={p.refs} numbers={p.numbers} claim={claims[p.marker] ?? null} byRef={byRef} lang={lang} />))}
        </p>
        {closing && <p data-quick-closing className="text-[0.95rem]" lang={fieldLang(closing, lang)}>{closing}</p>}
        {anyChecked && <p className="text-[0.85rem] text-muted">✓ {L(lang, RC.support.state.checked)}</p>}
      </section>
      <section aria-labelledby="quick-refs-h" className="grid gap-2">
        <h2 id="quick-refs-h" className="font-display text-[1.25rem] font-semibold">{Lw(lang, Q.refsTitle)}</h2>
        {refs.length ? (
          <>
            <p className="text-[0.88rem] text-muted">{L(lang, Q.refsNote)}</p>
            <ol aria-label={L(lang, Q.refsTitle)} className="grid">
              {refs.map((ref, i) => {
                const paper = byRef.get(ref);
                return (
                  <li key={ref} id={quickRefId(i + 1)} tabIndex={-1} data-quick-ref={ref}
                    className="grid scroll-mt-24 grid-cols-[2.6rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-3 outline-none target:bg-ground">
                    <span className="pt-0.5 font-display font-semibold tabular-nums">[{i + 1}]</span>
                    {paper ? <CitationText paper={paper} lang={lang} /> : <span className="text-muted">{ref}</span>}
                  </li>
                );
              })}
            </ol>
          </>
        ) : <p className="text-muted">{L(lang, Q.noRefs)}</p>}
      </section>
      <div data-quick-upgrade className="grid gap-2 border-t border-rule pt-6">
        <Link href={fullReviewHref(review)} className={BUTTON}>{L(lang, Q.upgrade)}</Link>
        <p className="max-w-[65ch] text-[0.92rem] text-muted">{L(lang, Q.upgradeHint)}</p>
      </div>
    </article>
  );
}
